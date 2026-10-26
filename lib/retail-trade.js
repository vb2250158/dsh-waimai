/** Native supermarket requests share the account owner and the ordinary order ledger. */
import { createHash, randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { z } from 'zod'
import { TradeError, cents } from './trade-data.js'

const id = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative().safe()]).transform(String)
const text = z.string().min(1).max(500)
const money = z.number().int().nonnegative().safe()
const itemSchema = z.object({ itemId: id, title: text, startWith: z.number().int().positive(), itemStatus: z.number().int(),
  currentPrice: z.object({ price: money }), stockModel: z.object({ quantity: z.number().int().nonnegative() }),
  storeModel: z.object({ storeBasicModel: z.object({ storeId: id }) }), itemCustomPropertyModelList: z.array(z.unknown()),
  skuModel: z.unknown().optional(), itemCombineModel: z.unknown().optional() }).passthrough()

/** @param raw - private native cart response. @param storeId - independently resolved store. @returns revision, private lines and display. */
export function retailCartData(raw, storeId) {
  const groups = z.array(z.object({ id, bundles: z.array(z.object({ orders: z.array(z.object({
    cartId: id, itemId: id, skuId: id, title: z.string().optional(), name: z.string().optional(),
    amount: z.object({ now: z.number().int().positive() }), checked: z.boolean(), isValid: z.boolean(),
    price: z.object({ now: money, sum: money }),
  }).passthrough()) })), extendData: z.object({ extraInfo: z.object({ urlFlags: z.object({
    dyBuyParams: z.string().optional(), buyBuildParams: z.string().optional(),
  }).passthrough() }).passthrough() }).passthrough().optional() }).passthrough()).max(1).parse(raw.list)
  if (groups.some(group => group.id !== storeId)) throw new Error('foreign retail cart')
  const group = groups[0], lines = group?.bundles.flatMap(bundle => bundle.orders) || []
  if (new Set(lines.map(line => line.cartId)).size !== lines.length) throw new Error('duplicate retail cart line')
  const revision = createHash('sha256').update(JSON.stringify([storeId, lines.map(line => [line.cartId, line.itemId, line.skuId,
    line.amount.now, line.checked, line.isValid, line.price.now, line.price.sum]).sort((a, b) => a[0].localeCompare(b[0]))])).digest('hex')
  return { group, lines, revision, display: { quantity: lines.reduce((sum, line) => sum + line.amount.now, 0),
    invalidCount: lines.filter(line => !line.isValid).length, totalCents: lines.reduce((sum, line) => sum + line.price.sum, 0),
    minimumCents: 0, items: lines.map(line => ({ ref: createHash('sha256').update(`${storeId}:${line.cartId}`).digest('hex'),
      name: line.title || line.name || line.itemId, quantity: line.amount.now, selected: line.checked, available: line.isValid,
      priceCents: line.price.now, totalCents: line.price.sum })) } }
}

const decode = value => JSON.parse(value.startsWith('H4sI')
  ? gunzipSync(Buffer.from(value, 'base64'), { maxOutputLength: 2000000 }).toString('utf8') : value)

/** Resolve the platform's explicit delivery-address link without matching personal text.
 * @param raw - authenticated address query response data.
 * @param addressId - currently selected Eleme address ID.
 * @returns the corresponding private Taobao address ID.
 */
export function retailAddressLink(raw, addressId) {
  const rows = z.array(z.object({ id_string: id, address_id_string: id })).max(200).parse(raw.addressList)
  const matches = rows.filter(row => row.id_string === addressId)
  if (matches.length !== 1 || matches[0].address_id_string === '0') throw new Error('retail address link missing or ambiguous')
  return matches[0].address_id_string
}

/** @param raw - native checkout. @param owner - verified cart, buyer and delivery. @returns common display and submit fields. */
export function retailCheckoutData(raw, { cart, storeId, buyerId, addressId, uicAddressId, merchant }) {
  const nodes = raw.data, submit = nodes.retail_lmagex_checkout_submitOrder.fields
  const linkage = decode(raw.ext.linkage.submit), adjust = decode(raw.ext.linkage.adjust)
  const totalCents = cents(submit.discountedTotalPrice), delivery = JSON.parse(adjust.extraParams.checkoutAddressInfo)
  const itemKey = (itemId, skuId, quantity) => `${itemId}:${skuId}:${quantity}`
  const expected = cart.lines.map(line => itemKey(line.itemId, line.skuId, line.amount.now)).sort()
  const entities = adjust.itemParams
  const received = entities.map(line => itemKey(line.itemId, line.skuId, line.quantity)).sort()
  const real = linkage.orderDTOs.flatMap(order => order.orderLineDTOs).filter(line => !line.fictitiousItemDTO)
  const submitted = real.map(line => itemKey(line.itemId.itemId, line.itemId.skuId, line.buyQuantity)).sort()
  const payment = JSON.parse(nodes.retail_lmagex_payment_cashier.fields.writeback.selectedPayOptions)
  if (!totalCents || String(linkage.buyerId) !== buyerId || String(adjust.tradeBuyQuery.userId) !== buyerId
    || String(adjust.extraParams.storeId) !== storeId || String(delivery.selectedEleAddressId) !== addressId
    || String(delivery.selectedUicAddressId) !== uicAddressId
    || submit.isAddrSelected !== true || nodes.retail_lmagex_checkout_DeliveryInfo.fields.noAddress !== false
    || entities.some(line => line.valid !== true) || JSON.stringify(expected) !== JSON.stringify(received)
    || JSON.stringify(expected) !== JSON.stringify(submitted) || linkage.cashierPaymentDTO.payOrderAmount !== totalCents
    || linkage.cashierPaymentDTO.payCurrency !== 'CNY' || linkage.cashierPaymentDTO.orderCurrency !== 'CNY'
    || payment.length !== 1 || payment[0].payOptionCode !== 'ALIPAY_BATCH_ESCROW_APP' || payment[0].signSelected !== false) {
    throw new Error('retail checkout ownership, contents or payment differs')
  }
  const items = nodes.retail_lmagex_checkout_shopgoodslist.fields.elemeOrderLineList.map(line => ({
    name: text.parse(line.name), quantity: z.number().int().positive().parse(line.quantity),
    priceCents: cart.display.items[cart.lines.findIndex(item => item.itemId === String(line.itemId))]?.priceCents || 0,
  }))
  if (items.reduce((sum, line) => sum + line.quantity, 0) !== cart.display.quantity) throw new Error('retail display count differs')
  const coupons = (nodes.retail_lmagex_checkout_eleme_red_package_list?.fields?.alscNewretailCouponInfoList || []).filter(coupon => coupon.isSelected)
  const couponCents = coupons.reduce((sum, coupon) => sum + cents(coupon.amount), 0)
  const time = nodes.retail_lmagex_timeselect?.fields
  if (time && Object.keys(time).length && !Number(time.deliveryReachTimeInMills)) throw new TradeError('retail-delivery-required', '请先选择配送时间；可重新报价并明确选择最早可配送时段')
  const params = Object.fromEntries(Object.entries(nodes).filter(([, node]) => node.props && node.fields)
    .map(([key, node]) => [key, ['alscNrCheckoutBodyTyings_lgx', 'retail_lmagex_timeselect'].includes(key) && node.fields.writeback
      ? { writeback: node.fields.writeback } : node.fields]))
  return { display: { merchant, items, totalCents, couponCents, fees: [], deliveryTime: time ? text.parse(time.deliveryReachTime) : '' },
    request: { linkage: raw.ext.linkage.submit, params: gzipSync(JSON.stringify(params)).toString('base64'), feature: JSON.stringify({ paramsZip: 'true' }) } }
}

/** Account-scoped supermarket search and cart adapter; order submission stays in TaobaoTrade. */
export class RetailTrade {
  /** @param trade - common budget, identity, serialization and order owner. */
  constructor(trade) { this.trade = trade; this.login = trade.login; this.service = trade.service; this.products = new Map(); this.deviceId = randomUUID() }

  /** @param shopId - encrypted merchant ID. @returns independently resolved native store and current delivery. */
  async context(shopId) {
    await this.login.requireAccount()
    const address = await this.service.selectedAddress()
    const raw = await this.login.mtop(this.login.protocol.menuHead, { channel: 'H5', eleStoreId: shopId, ...address.coordinates,
      comeFrom: 'h5', addressId: address.nativeId, v: '12.0.2' })
    this.service.checkReply(raw, 'retail-store-unavailable', '商超店铺暂时无法核对')
    const info = raw.data?.resultMap?.storeHead?.storeInfo
    if (info?.storeId !== shopId) throw new TradeError('retail-store-invalid', '商超店铺身份不匹配')
    return { retail: true, shopId, nativeShopId: id.parse(info.tbRestaurantId), merchant: text.parse(info.name), accountId: this.login.accountId, address }
  }

  /** @param context - verified store and delivery. @returns native client query fields. */
  extra(context) {
    return { ...this.login.protocol.retail.client, storeId: context.nativeShopId, addressId: context.address.nativeId,
      lat: context.address.coordinates.latitude, lng: context.address.coordinates.longitude, deviceId: this.deviceId }
  }

  /** @param context - verified store. @param keyword - product name. @returns validated source products. */
  async query(context, keyword) {
    const raw = await this.login.mtop(this.login.protocol.retail.search, { ...this.extra(context), shop_id: context.nativeShopId,
      keyword, rn: 20, pn: 1, type: 1, sortBy: 'default', isChangeSortType: 0, deliveryType: 0, rankId: '', menuFilter: '',
      onlyEmptySearchRecommend: 0, searchMenuFilter: '[]', scentExtend: '{"PROCESS_NEW_ITEM_STRUCTURE":true}' })
    this.service.checkReply(raw, 'retail-search-unavailable', '商超商品查询失败，请稍后重试')
    const rows = z.array(z.object({ item: itemSchema })).max(100).parse(raw.data?.data?.skuList)
    if (rows.some(row => row.item.storeModel.storeBasicModel.storeId !== context.nativeShopId)) throw new TradeError('retail-item-invalid', '返回的商品不属于当前店铺')
    return rows.map(row => row.item)
  }

  /** @param args - merchant and keyword. @returns display products with account-bound references. */
  search(args) {
    return this.login.run(async () => {
      const context = await this.context(args.shopId), items = await this.query(context, args.keyword)
      await this.trade.verify(context)
      if (this.products.size + items.length > 200) this.products.clear()
      return { merchant: context.merchant, shopId: args.shopId, priceKind: 'listed', items: items.map(item => {
        const productRef = randomUUID(), simple = !item.skuModel && item.itemCustomPropertyModelList.length === 0
        this.products.set(productRef, { context, keyword: args.keyword, itemId: item.itemId, name: item.title })
        return { productRef, name: item.title, priceCents: item.currentPrice.price, stock: item.stockModel.quantity,
          minimumQuantity: item.startWith, simpleSku: simple, available: item.itemStatus === 0 && item.stockModel.quantity > 0 }
      }) }
    })
  }

  /** @param context - store and delivery owner. @returns native cart and common display revision. */
  async requestCart(context) {
    const raw = await this.login.mtop(this.login.protocol.retail.cart, { extStatus: 0, netType: 0, isPage: false, cartFrom: 'eleme_newretail',
      exParams: JSON.stringify({ ...this.extra(context), needBuyBuildParams: 1 }), lat: context.address.coordinates.latitude, lng: context.address.coordinates.longitude })
    this.service.checkReply(raw, 'retail-cart-unavailable', '商超购物车暂时无法读取')
    try { return retailCartData(raw.data, context.nativeShopId) }
    catch { throw new TradeError('retail-cart-invalid', '商超购物车内容无法确认') }
  }

  /** @param args - merchant. @returns current cart without mutation. */
  cart(args) {
    return this.login.run(async () => { const context = await this.context(args.shopId), cart = await this.requestCart(context)
      await this.trade.verify(context); return this.trade.displayCart(context, cart) })
  }

  /** @param context - verified store and selected address. @returns its server-linked private Taobao address ID. */
  async deliveryAddress(context) {
    const raw = await this.login.mtop(this.login.protocol.retail.addressQuery, { sourceFrom: 'H5', bizType: 'RETAIL_SUBMIT_ORDER',
      bizExtInfo: JSON.stringify({ storeId: context.nativeShopId }), bizCustomInfos: '{}' })
    this.service.checkReply(raw, 'retail-address-unavailable', '商超配送地址暂时无法核对')
    try { return retailAddressLink(raw.data, context.address.nativeId) }
    catch { throw new TradeError('retail-address-unmapped', '当前配送地址没有唯一的平台地址关联，请在官方客户端核对地址') }
  }

  /** @param raw - fresh native quote. @returns a repriced quote for its earliest available delivery slot; never submits an order. */
  async earliestDelivery(raw) {
    const fields = raw.data.retail_lmagex_timeselect?.fields
    if (!fields || !Object.keys(fields).length || Number(fields.deliveryReachTimeInMills)) return raw
    const groups = z.array(z.object({ productId: id, bookTimeList: z.array(z.object({ bookTimePointList: z.array(z.object({
      isAllowOrder: z.boolean(), isBookOrder: z.boolean(), timeInMills: z.string().regex(/^[1-9]\d{12}$/),
    })) })) })).parse(fields.alscNrTimeTab?.bookTimeList)
    const slots = groups.flatMap(group => group.bookTimeList.flatMap(day => day.bookTimePointList
      .filter(slot => slot.isAllowOrder).map(slot => ({ ...slot, productId: group.productId }))))
      .sort((a, b) => Number(a.timeInMills) - Number(b.timeInMills))
    const slot = slots[0]
    if (!slot) throw new TradeError('retail-delivery-unavailable', '当前没有可配送时段，未创建订单')
    const params = { retail_lmagex_timeselect: { ...fields, writeback: { ...fields.writeback,
      isBookOrder: slot.isBookOrder ? 1 : 0, isDeliverNow: 0, productId: slot.productId,
      selectedDaytime: slot.timeInMills, storeId: fields.storeId } } }
    const address = raw.data.retail_lmagex_general_address_expand?.fields
    if (address?.writeback) params.retail_lmagex_general_address_expand = address
    const reply = await this.login.mtop(this.login.protocol.retail.adjust, { linkage: raw.ext.linkage.adjust,
      params: gzipSync(JSON.stringify(params)).toString('base64'), feature: JSON.stringify({ paramsZip: 'true' }) })
    this.service.checkReply(reply, 'retail-delivery-unavailable', '配送时段重新计价失败，未创建订单')
    if (String(reply.data?.data?.retail_lmagex_timeselect?.fields?.deliveryReachTimeInMills) !== slot.timeInMills) {
      throw new TradeError('retail-delivery-changed', '平台返回的配送时段与选择不一致，未创建订单')
    }
    return reply.data
  }

  /** @param args - search reference, cart revision and stable operation ID. @returns verified single-SKU add result. */
  add(args) {
    return this.login.run(async () => {
      const product = this.products.get(args.productRef)
      if (!product) throw new TradeError('retail-product-expired', '请重新查询商超商品')
      const context = await this.context(product.context.shopId)
      if (context.accountId !== product.context.accountId || context.address.ref !== product.context.address.ref) throw new TradeError('account-changed', '账号或配送地址已变化')
      const cart = await this.requestCart(context)
      if (cart.revision !== args.revision) throw new TradeError('cart-changed', '购物车已变化，请重新读取')
      if (this.trade.mutations.has(args.operationRef)) throw new TradeError('cart-duplicate', '本次加购已发送，请回读购物车')
      const item = (await this.query(context, product.keyword)).find(value => value.itemId === product.itemId)
      if (!item || item.title !== product.name || item.itemStatus !== 0 || item.stockModel.quantity < args.quantity
        || item.startWith > args.quantity || item.skuModel || item.itemCustomPropertyModelList.length) throw new TradeError('retail-spec-required', '商品规格、库存或起购数量已变化，请重新查询')
      const before = cart.lines.filter(line => line.itemId === item.itemId && line.skuId === '0').reduce((sum, line) => sum + line.amount.now, 0)
      if (before + args.quantity > item.stockModel.quantity) throw new TradeError('retail-stock', '商品库存不足')
      await this.trade.verify(context)
      this.trade.mutations.add(args.operationRef); this.trade.invalidateQuotes(context)
      this.login.diagnostic?.({ group: 'waimai-cart', attemptId: args.operationRef, stage: 'retail-add-sent', quantityDelta: args.quantity })
      const raw = await this.login.mtop(this.login.protocol.retail.add, { cartFrom: 'eleme_newretail', itemId: item.itemId, skuId: '0', quantity: args.quantity,
        exParams: JSON.stringify({ ...this.extra(context), version_newretail: '1.0.2', itemNextCount: before + args.quantity, cartItemAttrs: [] }) }, false)
      this.service.checkReply(raw, 'cart-result-unconfirmed', '加购结果未确认，请读取购物车，勿重复提交')
      const after = await this.requestCart(context)
      const count = after.lines.filter(line => line.itemId === item.itemId && line.skuId === '0').reduce((sum, line) => sum + line.amount.now, 0)
      if (count !== before + args.quantity) throw new TradeError('cart-result-unconfirmed', '加购数量未确认，请回读购物车')
      await this.trade.verify(context)
      return this.trade.displayCart(context, after)
    })
  }

  /** @param args - current merchant/cart revision. @returns an expiring quote owned by the common submit ledger. */
  checkout(args) {
    return this.login.run(async () => {
      this.trade.pruneQuotes()
      const context = await this.context(args.shopId), cart = await this.requestCart(context)
      if (cart.revision !== args.revision) throw new TradeError('cart-changed', '购物车已变化，请重新读取')
      if (!cart.lines.length || cart.lines.some(line => !line.checked || !line.isValid)) throw new TradeError('retail-cart-unavailable', '请先核对购物车中勾选的可售商品')
      const identity = await this.trade.buyer(), address = context.address, coords = address.coordinates
      const uicAddressId = await this.deliveryAddress(context)
      const flags = cart.group.extendData.extraInfo.urlFlags, build = flags.buyBuildParams ? JSON.parse(flags.buyBuildParams) : {}
      const extra = { ...this.login.protocol.retail.checkoutClient, storeId: context.nativeShopId, deviceId: this.deviceId,
        lat: coords.latitude, lng: coords.longitude, buyerLat: coords.latitude, buyerLng: coords.longitude, gps: JSON.stringify(coords),
        itemCustomProperties: build.itemCustomProperties || cart.lines.map(line => ({ customPropertyList: [], itemAmount: line.amount.now, itemId: line.itemId, cartId: line.cartId })),
        freeGiftInfos: build.freeGiftInfos || [], terminalParams: '', checkoutAddressInfo: JSON.stringify({ selectedEleAddressId: address.nativeId,
          selectedUicAddressId: uicAddressId, addressSelectBy: 'user', addressType: '5', geohash: address.geohash }) }
      const raw = await this.login.mtop(this.login.protocol.checkout, { buyNow: false, buyParam: flags.dyBuyParams,
        exParams: JSON.stringify(extra), longitude: coords.longitude, latitude: coords.latitude })
      this.service.checkReply(raw, 'retail-checkout-unavailable', '商超结算暂未成功，未创建订单')
      let result
      try { result = retailCheckoutData(args.deliveryPreference === 'earliest' ? await this.earliestDelivery(raw.data) : raw.data,
        { cart, storeId: context.nativeShopId, buyerId: identity.buyerId, addressId: address.nativeId, uicAddressId, merchant: context.merchant }) }
      catch (error) { if (error instanceof TradeError) throw error
        throw new TradeError('retail-checkout-invalid', '商超结算的账号、地址、商品或金额无法核对，未创建订单') }
      await this.trade.verify(context)
      const quoteRef = randomUUID(), expiresAt = this.trade.now() + this.trade.quoteSeconds * 1000
      this.trade.retainQuote({ context, identity, cartRevision: cart.revision, quoteRef, expiresAt, ...result })
      return { ...this.trade.displayCart(context, cart), ...result.display, quoteRef, expiresAt, maxOrderCents: this.trade.capCents, previewOnly: this.trade.dryRun }
    })
  }
}
