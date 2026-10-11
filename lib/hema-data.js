/** Hema read projections; private contacts and server actions never enter model results. */
import { createHash } from 'node:crypto'
import { parse } from 'lossless-json'
import { z } from 'zod'
import { browseImage, MerchantId } from './browse-data.js'

const id = z.union([z.string().regex(/^[1-9]\d*$/).max(128), z.number().int().positive().safe()]).transform(String)
const text = z.string().max(2000)
const short = z.string().max(512)

/** @param source - bounded JSON text. @returns exact decimal integer identifiers and ordinary finite numbers. */
export function hemaJson(source) {
  if (source.length > 8_000_000) throw new Error('response too large')
  return parse(source, undefined, { parseNumber(value) {
    const number = Number(value)
    if (!Number.isFinite(number)) throw new Error('non-finite number')
    return /^-?\d+$/.test(value) && !Number.isSafeInteger(number) ? value : number
  } })
}

/** Account-bound Hema history position, distinct from the takeaway history protocol. */
export const HemaOrderCursor = z.object({ platformId: z.literal('hema'), accountId: id,
  pageIndex: z.number().int().min(2).max(1_000_000) }).strict()

/** @param raw - self profile response. @param accountId - independently checked Taobao identity. @returns private display fields. */
export function hemaProfile(raw, accountId) {
  const data = z.object({ isSelf: z.literal(true), nick: short.min(1), avatar: text.nullish() }).parse(raw)
  let image = data.avatar
  if (typeof image === 'string') {
    try {
      const url = new URL(image)
      if (url.protocol === 'http:' && ['img.alicdn.com', 'gw.alicdn.com'].includes(url.hostname) && !url.port) {
        url.protocol = 'https:'; image = url.href
      }
    } catch { image = null }
  }
  return { id: id.parse(accountId), nickname: data.nick, avatarUrl: browseImage(image), maskedPhone: null }
}

/** @param raw - successful Hema history data. @param pageSize - requested bound. @param position - requested page. @param accountId - checked identity. @returns read-only order summaries and a next cursor. */
export function hemaOrders(raw, pageSize, position, accountId) {
  const data = z.object({ hasMore: z.boolean(), pageNo: z.literal(position), pageSize: z.literal(pageSize), orderList: z.array(z.object({
    bizOrderId: id, shopVO: z.object({ shopId: MerchantId, shopName: short }), statusVO: z.object({ statusText: short }),
    orderTimeVO: z.object({ createTime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/) }),
    payInfoVO: z.object({ actualPayFee: z.number().int().min(0).max(999_999_999) }),
    itemVOList: z.array(z.object({ itemTitle: short, buyAmount: z.number().finite().min(0).max(1_000_000), buyUnit: short.nullish() })).max(100),
  })).max(pageSize) }).parse(raw)
  const seen = new Set()
  const orders = data.orderList.map(row => {
    if (seen.has(row.bizOrderId)) throw new Error('duplicate order')
    seen.add(row.bizOrderId)
    const createdAt = Date.parse(row.orderTimeVO.createTime.replace(' ', 'T') + '+08:00')
    if (!Number.isFinite(createdAt)) throw new Error('invalid order time')
    return { id: row.bizOrderId, merchantName: row.shopVO.shopName, merchantId: row.shopVO.shopId, createdAt,
      amount: (row.payInfoVO.actualPayFee / 100).toFixed(2), status: row.statusVO.statusText,
      items: row.itemVOList.map(item => ({ name: item.itemTitle, count: item.buyAmount, ...(item.buyUnit ? { unit: item.buyUnit } : {}) })) }
  })
  if (data.hasMore && !orders.length) throw new Error('empty advancing page')
  return { orders, nextCursor: data.hasMore ? { platformId: 'hema', accountId, pageIndex: position + 1 } : null }
}

const group = z.object({ groupId: MerchantId, groupName: short.min(1), groupType: short, deliveryType: short,
  serviceName: short.nullish(), ext: z.object({ shopIds: z.string().regex(/^[1-9]\d*(?:,[1-9]\d*)*$/).max(4000) }).optional() })
const address = z.object({ addreid: id, addrName: short, addrDetail: short, linkMan: short, linkPhone: z.string().max(32),
  geoCode: z.string().max(128), decidedShopData: z.object({ groupList: z.array(group).max(50) }).nullish() })

/** @param raw - UserAddressReadApi result. @param accountId - checked identity. @returns separated private location and display records. */
export function hemaAddresses(raw, accountId) {
  const rows = z.object({ addressList: z.array(address).max(100) }).parse(raw).addressList, seen = new Set()
  return rows.map(row => {
    if (seen.has(row.addreid)) throw new Error('duplicate address')
    seen.add(row.addreid)
    const groups = (row.decidedShopData?.groupList || []).filter(value => value.deliveryType === 'DELIVERY' && value.ext?.shopIds)
    if (new Set(groups.map(value => value.groupId)).size !== groups.length) throw new Error('duplicate delivery group')
    const ref = createHash('sha256').update(`hema:${accountId}:${row.addreid}`).digest('hex')
    return { ref, nativeId: row.addreid, geoCode: row.geoCode, groups, display: { ref, label: '',
      address: [row.addrName, row.addrDetail].filter(Boolean).join(' '), contact: row.linkMan,
      maskedPhone: /^1\d{10}$/.test(row.linkPhone) ? row.linkPhone.slice(0, 3) + '****' + row.linkPhone.slice(-4) : '',
      usable: Boolean(row.addrName.trim() && row.geoCode && groups.length) } }
  })
}

/** @param raw - successful search result. @param shops - native stores in the selected delivery group. @returns only product display fields from those stores. */
export function hemaProducts(raw, shops) {
  const data = z.object({ isSuccess: z.literal(true), module: z.object({ dataList: z.array(z.object({ service: z.record(z.string(), z.unknown()) })).max(100).nullish(),
    totalCount: z.number().int().min(0), hasMorePage: z.enum(['0', '1']) }) }).parse(raw)
  const product = z.object({ serviceId: MerchantId, shopId: MerchantId, serviceTitle: short.min(1), subTitle: text.nullish(), mainImage: text.nullish(),
    price: z.string().regex(/^\d{1,9}$/), priceUnit: short.nullish(), inventory: z.string().regex(/^\d{1,9}$/), shopClosed: z.enum(['0', '1']) })
  const seen = new Set(), items = []
  for (const row of data.module.dataList || []) {
    // serviceType 10 is a search-word suggestion, without a product or store reference.
    if (row.service.serviceType === 10 && row.service.serviceId === undefined && row.service.shopId === undefined) continue
    const item = product.parse(row.service)
    if (!shops.has(item.shopId) || seen.has(item.serviceId)) throw new Error('foreign or duplicate product')
    seen.add(item.serviceId)
    items.push({ id: item.serviceId, name: item.serviceTitle, description: item.subTitle || '', imageUrl: browseImage(item.mainImage),
      price: (Number(item.price) / 100).toFixed(2), priceUnit: item.priceUnit || '',
      availability: item.shopClosed === '1' ? 'outside-sale-time' : Number(item.inventory) === 0 ? 'sold-out' : 'available', tips: [], options: [] })
  }
  return { items, totalCount: data.module.totalCount, hasMore: data.module.hasMorePage === '1' }
}
