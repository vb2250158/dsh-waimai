/** Hema read projections; private contacts and server actions never enter model results. */
import { createHash } from 'node:crypto'
import { parse } from 'lossless-json'
import { z } from 'zod'
import { browseImage, MerchantId } from './browse-data.js'

const id = z.union([z.string().regex(/^[1-9]\d*$/).max(128), z.number().int().positive().safe()]).transform(String)
const text = z.string().max(2000)
const short = z.string().max(512)

/** Upgrade only allowlisted passive CDN images; URL credentials, ports and tracking queries remain rejected. */
function hemaImage(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value)
    if (url.protocol === 'http:' && ['img.alicdn.com', 'gw.alicdn.com'].includes(url.hostname)) url.protocol = 'https:'
    return browseImage(url.href)
  } catch { return null }
}

/** Private catalog continuation reference; the platform's search tokens remain on the server. */
export const HemaProductCursor = z.object({ platformId: z.literal('hema'), ref: z.uuid() }).strict()

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
  return { id: id.parse(accountId), nickname: data.nick, avatarUrl: hemaImage(data.avatar), maskedPhone: null }
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
  const seen = new Set(), items = [], nativeShops = new Map()
  for (const row of data.module.dataList || []) {
    // serviceType 10 is a search-word suggestion, without a product or store reference.
    if (row.service.serviceType === 10 && row.service.serviceId === undefined && row.service.shopId === undefined) continue
    const item = product.parse(row.service)
    if (!shops.has(item.shopId) || seen.has(item.serviceId)) throw new Error('foreign or duplicate product')
    seen.add(item.serviceId)
    nativeShops.set(item.serviceId, item.shopId)
    items.push({ id: item.serviceId, name: item.serviceTitle, description: item.subTitle || '', imageUrl: hemaImage(item.mainImage),
      price: (Number(item.price) / 100).toFixed(2), priceUnit: item.priceUnit || '',
      availability: item.shopClosed === '1' ? 'outside-sale-time' : Number(item.inventory) === 0 ? 'sold-out' : 'available', tips: [], options: [] })
  }
  const hasMore = data.module.hasMorePage === '1'
  const continuation = hasMore ? z.object({ RN: short.min(1), first_rn: short.min(1), exposeInfo: z.object({ exposeRn: short.min(1) }) }).parse(raw.module) : null
  return { items, nativeShops, totalCount: data.module.totalCount, hasMore, continuation }
}

/** @param raw - verified detail response. @param expected - original catalog identity. @returns specifications and current listed prices, without server actions or encryption fields. */
export function hemaProductDetail(raw, expected) {
  const variant = z.object({ skuId: id, saleSpec: short, saleUnit: short, chargeUnit: short,
    increment: z.number().positive().finite(), startWith: z.number().positive().finite(), stockQuantity: z.number().finite() })
  const data = z.object({ templateVO: z.object({ global: z.object({ itemId: id, shopId: id, itemName: short.min(1),
    subTitle: text.nullish(), mainImageUrl: text.nullish(), originPrice: z.number().int().min(0).safe(), discountPrice: z.number().int().min(0).safe(),
    showUnit: short, saleFlag: z.boolean(), ifOutRange: z.boolean(), skuItemList: z.array(variant).max(100) }) }) }).parse(raw).templateVO.global
  if (data.itemId !== expected.id || data.shopId !== expected.nativeShopId || new Set(data.skuItemList.map(x => x.skuId)).size !== data.skuItemList.length) throw new Error('foreign product detail')
  return { id: data.itemId, name: data.itemName, description: data.subTitle || '', imageUrl: hemaImage(data.mainImageUrl),
    price: (data.discountPrice / 100).toFixed(2), originalPrice: (data.originPrice / 100).toFixed(2), priceUnit: data.showUnit,
    available: data.saleFlag && !data.ifOutRange, variants: data.skuItemList.map(x => ({ id: x.skuId, name: x.saleSpec,
      quantityStep: x.increment, minimumQuantity: x.startWith, stockQuantity: Math.max(0, x.stockQuantity), saleUnit: x.saleUnit, chargeUnit: x.chargeUnit })) }
}

/** @param raw - address-scoped Hema Ultron cart result. @returns ordered display records without actions, checkout parameters or signatures. */
export function hemaCart(raw) {
  const node = z.object({ tag: short, fields: z.record(z.string(), z.unknown()) })
  const data = z.object({ data: z.record(z.string(), node), global: z.object({ controlParas: z.object({ hema: z.literal('1') }) }),
    hierarchy: z.object({ root: short, structure: z.record(z.string(), z.array(short).max(1000)) }) }).parse(raw)
  if (Object.keys(data.data).length > 2000 || data.data[data.hierarchy.root]?.tag !== 'cartHemaGlobal') throw new Error('invalid cart root')
  const visited = new Set(), items = [], ids = new Set()
  const item = z.object({ cartId: id, title: short.min(1), pic: text.nullish(), quantity: z.string().regex(/^\d{1,9}(?:\.\d{1,6})?$/),
    quantityUnit: short.nullish(), isChecked: z.enum(['true', 'false']), canCheck: z.boolean(), codeMsg: text.nullish(),
    pay: z.object({ afterPromPrice: z.number().int().min(0).safe(), payUnit: short }),
    sku: z.object({ skuInvalid: z.boolean(), title: short.nullish() }) })
  function visit(ref) {
    if (visited.has(ref) || !data.data[ref]) throw new Error('invalid cart hierarchy')
    visited.add(ref)
    const entry = data.data[ref]
    if (['mainItem', 'invalidMainItem'].includes(entry.tag)) {
      const value = item.parse(entry.fields)
      if (ids.has(value.cartId) || Number(value.quantity) <= 0) throw new Error('invalid cart item')
      ids.add(value.cartId)
      items.push({ id: value.cartId, name: value.title, imageUrl: hemaImage(value.pic), quantity: value.quantity,
        quantityUnit: value.quantityUnit || '', specification: value.sku.title || '', price: (value.pay.afterPromPrice / 100).toFixed(2),
        priceUnit: value.pay.payUnit, selected: value.isChecked === 'true',
        available: entry.tag === 'mainItem' && value.canCheck && !value.sku.skuInvalid, reason: value.codeMsg || '' })
    } else if (entry.tag.endsWith('Item')) throw new Error('unsupported cart item')
    for (const child of data.hierarchy.structure[ref] || []) visit(child)
  }
  visit(data.hierarchy.root)
  if (Object.entries(data.data).some(([ref, value]) => ['mainItem', 'invalidMainItem'].includes(value.tag) && !visited.has(ref))) throw new Error('incomplete cart')
  return { items, availableCount: items.filter(x => x.available).length, selectedCount: items.filter(x => x.selected).length }
}
