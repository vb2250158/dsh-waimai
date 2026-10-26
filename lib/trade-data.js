/** Private cart and checkout validation; only display fields leave the Host. */
import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { z } from 'zod'
import { LoginError } from './login.js'

/** Trade failures never include signed URLs or native request parameters. */
export class TradeError extends LoginError {
  constructor(code, message) { super(message); this.code = code }
}

const identifier = z.union([z.string().min(1).max(200), z.number().int().safe()]).transform(String)
const money = z.union([z.number(), z.string().regex(/^\d+(\.\d{1,2})?$/)]).transform(Number)
const cartIngredient = z.object({ id: identifier, sku_id: identifier, tb_item_id: identifier, tb_sku_id: identifier,
  tb_package_id: identifier, name: z.string().max(500), quantity: z.number().int().min(1).max(100),
  price: money.optional(), attrs: z.array(z.unknown()).default([]), new_specs: z.array(z.unknown()).default([]) })
const line = z.object({ cart_id: identifier, id: identifier, sku_id: identifier, food_type: z.number().int(),
  tb_item_id: identifier, tb_sku_id: identifier, name: z.string().min(1).max(500),
  quantity: z.number().int().min(0).max(10000), price: money, total_price: money,
  is_valid: z.union([z.literal(0), z.literal(1), z.boolean()]).transform(Boolean), is_selected: z.boolean(), attrs: z.array(z.unknown()), new_specs: z.array(z.unknown()),
  ingredients: z.array(cartIngredient).max(100).default([]), garnish: z.array(z.unknown()).optional(), group_id: z.number().int().optional(),
  create_at: z.union([z.number(), z.string()]).optional(), update_at: z.union([z.number(), z.string()]).optional() })

/** @param yuan - decimal server amount. @returns integer cents, rejecting fractional cents. */
export function cents(yuan) {
  const value = money.parse(yuan), rounded = Math.round(value * 100)
  if (!Number.isSafeInteger(rounded) || rounded < 0 || Math.abs(value * 100 - rounded) > 0.000001) throw new Error('invalid amount')
  return rounded
}

/** @param raw - cart body. @param shopId - encrypted merchant ID. @returns private lines and safe cart summary. */
export function cartData(raw, shopId) {
  if (raw.cart?.restaurant?.encrypted_id !== shopId || !Array.isArray(raw.couple_group) || !Array.isArray(raw.invalid_foods)) throw new Error('cart identity invalid')
  const lines = raw.couple_group.flatMap(group => group.cart_item_d_t_o_list || []).map(value => line.parse(value)).filter(value => value.quantity > 0)
  const ids = new Set(lines.map(value => value.cart_id))
  if (ids.size !== lines.length || lines.length > 500 || lines.reduce((sum, value) => sum + value.quantity, 0) !== raw.total_quantity) throw new Error('cart count invalid')
  const items = lines.map(value => ({ ref: createHash('sha256').update(`${shopId}:${value.cart_id}`).digest('hex'),
    name: value.name, quantity: value.quantity, priceCents: cents(value.price), totalCents: cents(value.total_price),
    available: value.is_valid, selected: value.is_selected,
    ...(value.attrs.length || value.new_specs.length || value.ingredients.length ? { specification: [
      ...[...value.new_specs, ...value.attrs].filter(spec => typeof spec?.name === 'string' && typeof spec?.value === 'string').map(spec => `${spec.name}: ${spec.value}`),
      ...value.ingredients.map(ingredient => `${ingredient.name}${ingredient.quantity > 1 ? ' × ' + ingredient.quantity : ''}`)].join(' · ') } : {}) }))
  const revision = createHash('sha256').update(JSON.stringify(lines.map(value => [value.cart_id, value.quantity, value.price, value.is_valid, value.is_selected, value.create_at, value.update_at, value.attrs, value.new_specs, value.ingredients])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest('hex')
  return { lines, revision, display: { items, quantity: raw.total_quantity, totalCents: cents(raw.cart.total),
    minimumCents: cents(raw.cart.minimum_order_amount), invalidCount: raw.invalid_foods.length } }
}

/** @param value - opaque server linkage. @returns bounded decoded data for identity validation only. */
function decodeLinkage(value) {
  if (typeof value !== 'string' || value.length > 2000000) throw new Error('invalid linkage')
  return JSON.parse(value.startsWith('H4sI') ? gunzipSync(Buffer.from(value, 'base64'), { maxOutputLength: 2000000 }).toString('utf8') : value)
}

/** Validate ownership, delivery, item counts and consistent totals before constructing a submit request.
 * @param raw - checkout body. @param owner - independently checked Taobao identity, address and cart.
 * @returns display quote and private compressed submit parameters; neither is sent automatically.
 */
export function checkoutData(raw, { buyerId, addressId, shopId, cart }) {
  const components = raw.data, fields = key => components?.[key]?.fields
  const global = fields('trade_checkout_global'), submit = fields('trade_checkout_order_submit'), subtotal = fields('trade_checkout_subtotal')
  const restaurant = fields('trade_checkout_restaurant_info'), cashier = fields('trade_checkout_payment_cashier')
  const source = JSON.parse(global.checkoutParamStr), adjustment = decodeLinkage(raw.ext.linkage.adjust), linkage = decodeLinkage(raw.ext.linkage.submit)
  const delivery = JSON.parse(adjustment.extraParams.checkoutAddressInfo)
  const totalCents = z.number().int().positive().safe().parse(subtotal.centPrice)
  const entityKey = (itemId, skuId, quantity) => `${itemId}:${skuId}:${quantity}`
  const expected = cart.lines.map(item => entityKey(item.tb_item_id, item.tb_sku_id, item.quantity)).sort()
  const received = source.checkOutItemParam.entities.map(item => entityKey(item.itemId, item.skuId, item.buyAmount)).sort()
  if (String(global.userId) !== buyerId || String(linkage.buyerId) !== buyerId || String(adjustment.tradeBuyQuery.userId) !== buyerId
    || String(delivery.selectedEleAddressId) !== addressId || source.checkOutItemParam.encryptedShopId !== shopId
    || source.checkOutBizParam.address_id !== submit.addressId || submit.orderTotalFee !== totalCents
    || cents(submit.priceStr) !== totalCents || submit.goodsTotalQuantity !== cart.display.quantity
    || restaurant.totalQuantity !== cart.display.quantity || !Array.isArray(restaurant.foodList)
    || restaurant.foodList.reduce((sum, item) => sum + item.quantity, 0) !== cart.display.quantity
    || submit.isClosed !== false || !global.uniqueId || !linkage.orderDTOs?.length
    || JSON.stringify(expected) !== JSON.stringify(received) || linkage.cashierPaymentDTO?.payOrderAmount !== totalCents
    || linkage.cashierPaymentDTO.payCurrency !== 'CNY' || linkage.cashierPaymentDTO.orderCurrency !== 'CNY') throw new Error('checkout ownership or total invalid')
  if (!Array.isArray(source.checkOutBizParam.selectedAdditionalServiceIds) || source.checkOutBizParam.selectedAdditionalServiceIds.length
    || JSON.parse(cashier?.paymentExternalInfo?.selectedPayOptionList)?.join(',') !== 'ALIPAY_BATCH_ESCROW_APP') throw new Error('unsupported checkout services')
  const params = {}
  for (const [key, component] of Object.entries(components)) {
    if (String(component.props?.isSubmit) === 'true' && component.fields && Object.keys(component.fields).length) params[key] = component.fields
  }
  const items = restaurant.foodList.map(item => ({ name: z.string().min(1).max(500).parse(item.name),
    quantity: z.number().int().positive().parse(item.quantity), priceCents: cents(item.price), specification: typeof item.spec === 'string' ? item.spec.slice(0, 500) : '' }))
  const fees = (fields('trade_checkout_coupon')?.feeList || []).map(fee => ({ name: z.string().max(200).parse(fee.name), amountCents: cents(fee.price) }))
  return { display: { merchant: z.string().min(1).max(500).parse(restaurant.name), totalCents, items, fees,
    discountCents: cents(submit.discountedPrice), deliveryTime: z.string().max(500).parse(restaurant.statusTip?.text || '') },
    request: { linkage: raw.ext.linkage.submit, params: gzipSync(JSON.stringify(params)).toString('base64'), feature: JSON.stringify({ paramsZip: 'true' }) } }
}

/** @param value - official server payment destination. @returns validated HTTPS handoff, including the official native cashier equivalent. */
export function paymentDestination(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'eleme:' && url.hostname === 'cashier' && !url.username && !url.password && !url.port
      && !url.pathname && !url.hash) {
      const browser = new URL('https://r.ele.me/payment')
      browser.search = url.search
      return browser.href
    }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null
    const allowed = (url.hostname === 'r.ele.me' && url.pathname === '/payment')
      || (url.hostname === 'h5.ele.me' && url.pathname.startsWith('/cashier/postcashier'))
      || (url.hostname === 'cashier.ele.me' && url.pathname.startsWith('/'))
    return allowed ? url.href : null
  } catch (_error) { return null } // Missing or unrecognized destinations require official order history.
}

/** @param value - server-issued supermarket payment action. @param orderId - exact owned order. @returns private HTTPS handoff or null. */
export function retailPaymentDestination(value, orderId) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && url.hostname === 'tb.ele.me' && url.pathname === '/app/eleme-newretail-c-h5/order-detail-unicorn/order-detail'
      && url.searchParams.getAll('orderId').length === 1 && url.searchParams.get('orderId') === orderId ? url.href : null
  } catch (_error) { return null } // An unrecognized action is never opened.
}

/** @param raw - successful submit body. @returns confirmed order IDs and optional official payment handoff. */
export function submittedOrder(raw) {
  const ids = z.string().regex(/^\d+(,\d+)*$/).max(1000).parse(raw.bizOrderId).split(',')
  let paymentUrl = paymentDestination(raw.nextUrl)
  if (!paymentUrl && typeof raw.nextUrl === 'string' && raw.nextUrl.length <= 300000) {
    try {
      const next = JSON.parse(raw.nextUrl)
      if (next?.cashierType === 'POST_STANDARD') paymentUrl = paymentDestination(next.payUrl)
    } catch (error) { /* The created order remains valid when its optional cashier handoff is unavailable. */ }
  }
  return { orderIds: [...new Set(ids)], paymentUrl }
}
