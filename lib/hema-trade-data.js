/** Hema checkout validation and SDK-compatible private submission serialization. */
import { gzipSync } from 'node:zlib'
import { z } from 'zod'
import { cents } from './trade-data.js'

const identifier = z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive().safe()]).transform(String)
const amount = value => cents(z.string().regex(/^[￥¥]\d{1,9}(?:\.\d{1,2})?$/).parse(value).slice(1))
const bounded = z.string().min(1).max(2000000)

/** @param raw - fresh address-decision response. @param selected - original private address. @param groupId - selected delivery group. @returns verified native address and serviceable IDs. */
export function hemaDeliveryContext(raw, selected, groupId) {
  const data = z.object({ userAddress: z.object({ addreid: identifier, geoCode: z.string(), addrName: z.string(), addrDetail: z.string(),
    linkPhone: z.string().regex(/^1\d{10}$/), linkMan: z.string(), addressType: z.union([z.string(), z.number()]), deliveryDockId: z.string() }),
    groupList: z.array(z.object({ groupId: identifier, deliveryType: z.string(), shopIds: z.string().regex(/^[1-9]\d*(?:,[1-9]\d*)*$/), locationIds: z.string().min(1).max(16000) })).max(50) }).parse(raw)
  const address = data.userAddress, group = data.groupList.find(row => row.groupId === groupId)
  if (new Set(data.groupList.map(row => row.groupId)).size !== data.groupList.length) throw Error('ambiguous delivery groups')
  if (address.addreid !== String(selected.nativeId) || address.geoCode !== selected.geoCode || !group || group.deliveryType !== 'DELIVERY'
    || [address.addrName, address.addrDetail].filter(Boolean).join(' ') !== selected.display.address
    || address.linkMan !== selected.display.contact || address.linkPhone.slice(0, 3) + '****' + address.linkPhone.slice(-4) !== selected.display.maskedPhone) throw Error('address decision changed')
  return { address, group }
}

/** @param confirmed - native cart confirmation. @param context - verified address decision. @returns private build parameters; no cart changes or order submission. */
export function hemaBuildParameters(confirmed, { address, group }) {
  const value = z.object({ buyParam: bounded, selectedShopIds: z.string().min(1).max(4000), exParams: bounded,
    confirmAlertInfo: z.record(z.string(), z.unknown()).optional() }).parse(confirmed)
  if (value.confirmAlertInfo && Object.keys(value.confirmAlertInfo).length) throw Error('cart confirmation needs interaction')
  const extra = z.record(z.string(), z.unknown()).parse(JSON.parse(value.exParams))
  return { buyParam: value.buyParam, exParams: JSON.stringify({ ...extra, newUltron: 'true', sptCashier: '1', coupon: 'true', coVersion: '2.0', priceEncrypt: '1',
    wdk_channel: 'APP', orgCode: '91', wdksgll: address.geoCode, wdk_addressId: address.addreid, wdk_mobile: address.linkPhone,
    wdk_addressDetail: address.addrDetail + address.addrName, wdk_fullName: address.linkMan, wdksgp: address.addrDetail,
    addressType: String(address.addressType), deliveryDockId: address.deliveryDockId, locationIds: group.locationIds, allLocatedShopIds: group.shopIds }) }
}

/** @param raw - successful native build. @param owner - verified address and explicit cart lines. @returns safe quote and private native response for one later submission. */
export function hemaCheckoutData(raw, { address, lines }) {
  const body = z.object({ data: z.record(z.string(), z.object({ tag: z.string(), fields: z.record(z.string(), z.unknown()) }).passthrough()),
    hierarchy: z.object({ root: z.string(), structure: z.record(z.string(), z.array(z.string())) }),
    linkage: z.object({ common: z.object({ compress: z.boolean(), submitParams: bounded, validateParams: bounded }), signature: bounded }),
    endpoint: z.record(z.string(), z.unknown()) }).parse(raw)
  const nodes = Object.values(body.data)
  const one = tag => { const matches = nodes.filter(node => node.tag === tag); if (matches.length !== 1) throw Error('ambiguous checkout component'); return matches[0].fields }
  const destination = one('wdkAddress'), submit = one('wdkSubmitOrder')
  if (String(destination.selectedId) !== address.addreid || destination.mobile !== address.linkPhone || destination.fullName !== address.linkMan
    || destination.coordinate !== address.geoCode || destination.addressDetail !== address.addrDetail + address.addrName) throw Error('checkout address changed')
  if (submit.payBtn?.enable !== true || submit.hidePrice === true) throw Error('order submission unavailable')
  const items = nodes.filter(node => node.tag === 'wdkItemInfo').map(node => {
    const item = z.object({ itemId: identifier, skuId: identifier, count: z.string().regex(/^x[1-9]\d*$/),
      title: z.string().min(1).max(512), itemSpecification: z.string().max(512), price: z.string(), valid: z.literal(true) }).parse(node.fields)
    return { id: item.itemId, skuId: item.skuId, name: item.title, specification: item.itemSpecification, quantity: Number(item.count.slice(1)), totalCents: amount(item.price) }
  })
  const key = row => `${row.itemId || row.id}:${row.skuId}:${Number(row.quantity)}`
  if (!items.length || items.length !== lines.length || new Set(items.map(key)).size !== items.length
    || JSON.stringify(items.map(key).sort()) !== JSON.stringify(lines.map(key).sort())) throw Error('checkout items changed')
  const totalCents = amount(submit.price), bottom = amount(one('wdkBottomTotal').price), itemPriceCents = amount(one('hemaFeeHeader').itemPriceValue)
  const freight = one('wdkFreight'), deliveryCents = z.number().int().nonnegative().safe().parse(freight.freight)
  const promotions = one('wdkSplitPromotion'), discountCents = amount(z.string().regex(/^-[￥¥]/).parse(promotions.totalPromotionPrice).slice(1))
  const netItems = items.reduce((sum, item) => sum + item.totalCents, 0)
  if (totalCents <= 0 || totalCents !== bottom || deliveryCents !== amount(freight.freightValue)
    || itemPriceCents - discountCents !== netItems || netItems + deliveryCents !== totalCents) throw Error('checkout amounts inconsistent')
  for (const node of nodes) if (['conditionalSale', 'wdkServiceContract'].includes(node.tag) && Object.keys(node.fields).length) throw Error('checkout needs additional consent')
  const more = nodes.find(node => node.tag === 'hmPayMore')
  if (more && more.hidden?.extensionMap?.visible !== 'false') throw Error('additional payment option requires review')
  const freightRows = z.array(z.object({ feeType: z.literal('postFee'), freightValue: z.string(), freightDesc: z.string().max(512) })).max(20).parse(freight.freightDetail?.produce)
  if (freightRows.reduce((sum, row) => sum + amount(row.freightValue), 0) !== deliveryCents) throw Error('freight breakdown inconsistent')
  return { raw: body, display: { totalCents, itemPriceCents, deliveryCents, discountCents, items,
    merchant: z.string().max(512).parse(one('orderInfo').title),
    deliveryTime: z.string().max(512).parse(one('wdkSendTime').selectTime),
    fees: freightRows.map(row => ({ name: row.freightDesc, amountCents: amount(row.freightValue) })) } }
}

/** @param raw - validated quote retained by its owner. @returns gzip/base64 Ultron create payload; this function never sends it. */
export function hemaSubmitParameters(raw) {
  const common = raw.linkage.common
  const data = Object.fromEntries(Object.entries(raw.data).filter(([, node]) => node.submit === true || node.submit === 'true'))
  if (!Object.values(data).some(node => node.tag === 'confirmOrder') || !Object.values(data).some(node => node.tag === 'wdkAddress')) throw Error('missing submit components')
  const payload = { data, linkage: { common: { compress: common.compress, submitParams: common.submitParams, validateParams: common.validateParams }, signature: raw.linkage.signature },
    hierarchy: { structure: raw.hierarchy.structure }, endpoint: raw.endpoint }
  return { params: gzipSync(JSON.stringify(payload)).toString('base64'), feature: JSON.stringify({ gzip: 'true' }) }
}

/** @param value - platform-returned cashier URL. @returns allowlisted HTTPS cashier handoff or null; callers must keep it out of logs and durable records. */
export function hemaPaymentDestination(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null
    if (url.hostname === 'mclient.alipay.com' && url.pathname.startsWith('/cashier/')) return url.href
    if (url.hostname === 'cashier.alipay.com' && url.pathname.startsWith('/standard/')) return url.href
    return null
  } catch { return null }
}
