import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync, gunzipSync } from 'node:zlib'
import { retailAddressLink, retailCartData, retailCheckoutData, RetailTrade } from '../lib/retail-trade.js'
import { registerAgentOrdering } from '../lib/agent-ordering.js'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { retailPaymentDestination } from '../lib/trade-data.js'

const zip = value => gzipSync(JSON.stringify(value)).toString('base64')
const cartRaw = () => ({ list: [{ id: '201', bundles: [{ orders: [{ cartId: '901', itemId: '301', skuId: '0', title: '示例水 570ml×24',
  amount: { now: 1 }, checked: true, isValid: true, price: { now: 5090, sum: 5090 } }] }],
  extendData: { extraInfo: { urlFlags: { dyBuyParams: 'synthetic', buyBuildParams: '{}' } } } }] })
const owner = cart => ({ cart, storeId: '201', buyerId: '501', addressId: '601', uicAddressId: '701', merchant: '示例便利店' })
function quoteRaw() {
  const node = fields => ({ fields, props: { isSubmit: 'true' } })
  return { data: { retail_lmagex_checkout_submitOrder: node({ discountedTotalPrice: 48.2, isAddrSelected: true }),
    retail_lmagex_checkout_DeliveryInfo: node({ noAddress: false }),
    retail_lmagex_checkout_shopgoodslist: node({ elemeOrderLineList: [{ itemId: '301', name: '示例水 570ml×24', quantity: 1 }] }),
    retail_lmagex_payment_cashier: node({ writeback: { selectedPayOptions: JSON.stringify([{ payOptionCode: 'ALIPAY_BATCH_ESCROW_APP', signSelected: false }]) } }),
    retail_lmagex_checkout_eleme_red_package_list: node({ alscNewretailCouponInfoList: [{ isSelected: true, amount: 11, explosionFirstDiscount: 8 }] }) },
    ext: { linkage: { submit: zip({ buyerId: '501', cashierPaymentDTO: { payOrderAmount: 4820, payCurrency: 'CNY', orderCurrency: 'CNY' },
      orderDTOs: [{ orderLineDTOs: [{ itemId: { itemId: '301', skuId: '0' }, buyQuantity: 1 }] }] }),
      adjust: zip({ tradeBuyQuery: { userId: '501' }, extraParams: { storeId: '201', checkoutAddressInfo: '{"selectedEleAddressId":"601","selectedUicAddressId":"701"}' },
        itemParams: [{ itemId: '301', skuId: '0', quantity: 1, valid: true }] }) } } }
}

test('native supermarket prices retain integer cents and revisions detect cart changes', () => {
  const source = cartRaw(), cart = retailCartData(source, '201')
  assert.equal(cart.display.totalCents, 5090); assert.equal(cart.display.items[0].name, '示例水 570ml×24')
  source.list[0].bundles[0].orders[0].amount.now = 2
  assert.notEqual(retailCartData(source, '201').revision, cart.revision)
  assert.throws(() => retailCartData(source, '202'))
  source.list[0].bundles[0].orders.push(source.list[0].bundles[0].orders[0])
  assert.throws(() => retailCartData(source, '201'))
  assert.equal(retailCartData({ list: [] }, '201').display.quantity, 0)
})

test('native quote preserves the server coupon and final total without adding an explosion amount', () => {
  const quote = retailCheckoutData(quoteRaw(), owner(retailCartData(cartRaw(), '201')))
  assert.equal(quote.display.totalCents, 4820); assert.equal(quote.display.couponCents, 1100)
  assert.equal(quote.display.items[0].priceCents, 5090)
  assert(JSON.parse(gunzipSync(Buffer.from(quote.request.params, 'base64'))).retail_lmagex_checkout_submitOrder)
})

test('reservation quotes require a selected time and submit the official delivery writeback without UI fields', async () => {
  const raw = quoteRaw(), cart = retailCartData(cartRaw(), '201')
  raw.data.retail_lmagex_timeselect = { props: {}, fields: { deliveryReachTime: '选择送达时间', deliveryReachTimeInMills: '',
    storeId: '201', writeback: { isBookOrder: 1, isDeliverNow: 0, storeId: '201' },
    alscNrTimeTab: { bookTimeList: [{ productId: '897008', bookTimeList: [{ bookTimePointList: [
      { isAllowOrder: false, isBookOrder: true, timeInMills: '1793044800000' },
      { isAllowOrder: true, isBookOrder: true, timeInMills: '1793073600000' },
      { isAllowOrder: true, isBookOrder: true, timeInMills: '1793059200000' },
    ] }] }] } } }
  assert.throws(() => retailCheckoutData(raw, owner(cart)), error => error.code === 'retail-delivery-required')
  let calls = 0, mismatch = false
  const retail = new RetailTrade({ service: { checkReply: () => {} }, login: { protocol: { retail: { adjust: { api: 'adjust' } } },
    mtop: async (spec, request) => {
      calls++; assert.equal(spec.api, 'adjust'); assert.equal(request.linkage, raw.ext.linkage.adjust)
      const sent = JSON.parse(gunzipSync(Buffer.from(request.params, 'base64'))).retail_lmagex_timeselect
      assert.equal(sent.writeback.selectedDaytime, '1793059200000'); assert.equal(sent.writeback.productId, '897008')
      const updated = structuredClone(raw)
      updated.data.retail_lmagex_timeselect.fields.deliveryReachTimeInMills = mismatch ? '1793073600000' : '1793059200000'
      updated.data.retail_lmagex_timeselect.fields.deliveryReachTime = '明日08:00–12:00送达'
      updated.data.retail_lmagex_checkout_DeliveryInfo.props = {}
      return { data: updated }
    } } })
  const updated = await retail.earliestDelivery(raw), quote = retailCheckoutData(updated, owner(cart))
  assert.deepEqual(quote.display, JSON.parse(await readFile(new URL('./fixtures/retail-delivery-quote.expected.json', import.meta.url), 'utf8')))
  assert.equal(quote.display.deliveryTime, '明日08:00–12:00送达')
  const sent = JSON.parse(gunzipSync(Buffer.from(quote.request.params, 'base64')))
  assert.deepEqual(sent.retail_lmagex_timeselect, { writeback: raw.data.retail_lmagex_timeselect.fields.writeback })
  assert(sent.retail_lmagex_checkout_DeliveryInfo)
  await retail.earliestDelivery(updated); assert.equal(calls, 1)
  mismatch = true
  await assert.rejects(retail.earliestDelivery(raw), error => error.code === 'retail-delivery-changed')
  raw.data.retail_lmagex_timeselect.fields.alscNrTimeTab.bookTimeList[0].bookTimeList[0].bookTimePointList.forEach(slot => { slot.isAllowOrder = false })
  await assert.rejects(retail.earliestDelivery(raw), error => error.code === 'retail-delivery-unavailable')
  assert.equal(calls, 2)
})

test('merchant delivery uses the selected address server link and rejects missing or duplicate links', () => {
  const row = { id_string: '601', address_id_string: '701' }
  assert.equal(retailAddressLink({ addressList: [row] }, '601'), '701')
  for (const rows of [[], [row, row], [{ ...row, id_string: '602' }], [{ ...row, address_id_string: '0' }]]) {
    assert.throws(() => retailAddressLink({ addressList: rows }, '601'))
  }
  assert.throws(() => retailCheckoutData(quoteRaw(), { ...owner(retailCartData(cartRaw(), '201')), uicAddressId: '702' }))
})

test('fixed-price discounts retain the cashier total when the coupon component has no fields', () => {
  const raw = quoteRaw()
  raw.data.retail_lmagex_checkout_eleme_red_package_list = {}
  raw.data.retail_lmagex_checkout_submitOrder.fields.discountedTotalPrice = 47.1
  const linkage = JSON.parse(gunzipSync(Buffer.from(raw.ext.linkage.submit, 'base64')))
  linkage.cashierPaymentDTO.payOrderAmount = 4710
  raw.ext.linkage.submit = zip(linkage)
  const quote = retailCheckoutData(raw, owner(retailCartData(cartRaw(), '201')))
  assert.equal(quote.display.totalCents, 4710)
  assert.equal(quote.display.couponCents, 0)
})

test('checkout sends both linked address IDs and stops before build when the selected address is missing', async () => {
  const calls = [], address = { ref: 'address-ref', nativeId: '601', coordinates: { latitude: 31, longitude: 121 } }
  let rows = [{ id_string: '601', address_id_string: '701' }]
  const login = { protocol: { checkout: { api: 'build' }, retail: { cart: { api: 'cart' }, addressQuery: { api: 'addresses' }, client: {}, checkoutClient: {} } },
    run: fn => fn(), mtop: async (spec, args) => {
      calls.push({ api: spec.api, args })
      return { data: spec.api === 'cart' ? cartRaw() : spec.api === 'addresses' ? { addressList: rows } : quoteRaw() }
    } }
  const trade = { login, service: { checkReply: () => {} }, buyer: async () => ({ buyerId: '501' }), verify: async () => {},
    displayCart: (_context, cart) => cart.display, now: () => 1000, quoteSeconds: 60, capCents: 5000, dryRun: false }
  const retail = new RetailTrade(trade)
  retail.context = async () => ({ nativeShopId: '201', shopId: 'E201', address, merchant: '示例便利店' })
  const args = { shopId: 'E201', revision: retailCartData(cartRaw(), '201').revision }
  assert.equal((await retail.checkout(args)).totalCents, 4820)
  const extra = JSON.parse(calls.find(call => call.api === 'build').args.exParams)
  assert.deepEqual(JSON.parse(extra.checkoutAddressInfo), { selectedEleAddressId: '601', selectedUicAddressId: '701', addressSelectBy: 'user', addressType: '5' })
  rows = []; calls.length = 0
  await assert.rejects(retail.checkout(args), error => error.code === 'retail-address-unmapped')
  assert(!calls.some(call => call.api === 'build'))
  assert.equal(trade.quote, null)
})

test('foreign account, address, SKU and inconsistent cashier total reject native quotes', () => {
  const cart = retailCartData(cartRaw(), '201')
  for (const change of [raw => { raw.data.retail_lmagex_checkout_submitOrder.fields.discountedTotalPrice = 47 },
    raw => { const link = JSON.parse(gunzipSync(Buffer.from(raw.ext.linkage.submit, 'base64'))); link.buyerId = '999'; raw.ext.linkage.submit = zip(link) },
    raw => { const link = JSON.parse(gunzipSync(Buffer.from(raw.ext.linkage.submit, 'base64'))); link.orderDTOs[0].orderLineDTOs[0].itemId.skuId = '99'; raw.ext.linkage.submit = zip(link) },
    raw => { raw.data.retail_lmagex_payment_cashier.fields.writeback.selectedPayOptions = '[{"payOptionCode":"CREDIT","signSelected":true}]' }]) {
    const raw = quoteRaw(); change(raw); assert.throws(() => retailCheckoutData(raw, owner(cart)))
  }
  assert.throws(() => retailCheckoutData(quoteRaw(), { ...owner(cart), addressId: '999' }))
})

test('retail search supplies a device identity and binds references to the independently resolved store', async () => {
  const calls = [], product = { itemId: '301', title: '示例水 570ml×24', startWith: 1, itemStatus: 0,
    currentPrice: { price: 5090 }, stockModel: { quantity: 3 }, storeModel: { storeBasicModel: { storeId: '201' } }, itemCustomPropertyModelList: [] }
  const address = { ref: 'private-address-ref', nativeId: '601', coordinates: { latitude: 31, longitude: 121 } }
  const login = { accountId: 'private-account', protocol: { menuHead: { api: 'head' }, retail: { search: { api: 'search' }, client: {} } },
    run: fn => fn(), requireAccount: async () => {}, mtop: async (spec, args) => {
      calls.push({ spec, args }); return spec.api === 'head'
        ? { data: { resultMap: { storeHead: { storeInfo: { storeId: 'E201', tbRestaurantId: '201', name: '示例便利店' } } } } }
        : { data: { data: { skuList: [{ item: product }] } } }
    } }
  const retail = new RetailTrade({ login, service: { selectedAddress: async () => address, checkReply: () => {} }, verify: async () => {} })
  const result = await retail.search({ shopId: 'E201', keyword: '水' })
  assert.equal(calls[1].args.storeId, '201'); assert(calls[1].args.deviceId)
  assert.equal(result.items[0].simpleSku, true); assert.equal(result.items[0].priceCents, 5090)
  assert(!JSON.stringify(result).includes('private'))
  product.storeModel.storeBasicModel.storeId = '999'
  await assert.rejects(retail.search({ shopId: 'E201', keyword: '水' }), error => error.code === 'retail-item-invalid')
})

test('agent supermarket checkout enforces the final payable budget and explicit confirmation shares submit', async () => {
  const registrations = new Map(), calls = [], ref = '11111111-1111-4111-8111-111111111111'
  registerAgentOrdering((name, description, schema, run) => registrations.set(name, { schema: z.object(schema).strict(), run }), {
    dispatch: async (method, args) => { calls.push({ method, args }); return method === 'retailCart' ? { revision: 'a'.repeat(64) }
      : method === 'retailCheckout' ? { quoteRef: ref, totalCents: 4820, maxOrderCents: 5000, accountId: 'private' }
        : { orderRef: ref, orderIds: ['123'], paymentUrl: 'https://r.ele.me/payment?private=1', paymentStatus: 'unconfirmed' } },
  })
  const invoke = (name, args) => { const tool = registrations.get(name); return tool.run(tool.schema.parse(args)) }
  await assert.rejects(invoke('preview_retail_checkout', { accountRef: ref, shopId: 'E201', maxAmount: 48 }), error => error.code === 'over-cap')
  assert(!calls.some(call => call.method === 'submit'))
  const quote = await invoke('preview_retail_checkout', { accountRef: ref, shopId: 'E201', maxAmount: 50 })
  assert.equal(quote.totalCents, 4820); assert(!quote.accountId)
  await assert.rejects(async () => invoke('confirm_order', { accountRef: ref, quoteRef: ref, confirmedCents: 4820, maxAmountCents: 5000 }))
  const result = await invoke('confirm_order', { accountRef: ref, quoteRef: ref, confirmed: true, confirmedCents: 4820, maxAmountCents: 5000 })
  assert.equal(calls.at(-1).method, 'submit'); assert.equal(calls.at(-1).args.manualConfirmation, true)
  assert.equal(result.view, 'payment'); assert(!JSON.stringify(result).includes('private'))
})

test('supermarket handoffs match the owned order and exclude foreign, duplicate and non-HTTPS destinations', () => {
  const url = 'https://tb.ele.me/app/eleme-newretail-c-h5/order-detail-unicorn/order-detail?orderId=123&opType=pay'
  assert.equal(retailPaymentDestination(url, '123'), url)
  assert.equal(retailPaymentDestination(url, '456'), null)
  assert.equal(retailPaymentDestination(url + '&orderId=456', '123'), null)
  assert.equal(retailPaymentDestination(url.replace('tb.ele.me', 'tb.ele.me.attacker.test'), '123'), null)
  assert.equal(retailPaymentDestination(url.replace('https:', 'http:'), '123'), null)
})

test('native add rereads inventory, preserves the action identity and never retries an unknown write', async () => {
  let raw = { list: [] }, unknown = false, writes = 0
  const product = { itemId: '301', title: '示例水 570ml×24', startWith: 1, itemStatus: 0,
    currentPrice: { price: 5090 }, stockModel: { quantity: 3 }, storeModel: { storeBasicModel: { storeId: '201' } }, itemCustomPropertyModelList: [] }
  const address = { ref: 'address', nativeId: '601', coordinates: { latitude: 31, longitude: 121 } }
  const login = { accountId: 'account', protocol: { menuHead: { api: 'head' }, retail: { search: { api: 'search' }, cart: { api: 'cart' }, add: { api: 'add' }, client: {} } },
    run: fn => fn(), requireAccount: async () => {}, mtop: async (spec, args, retry) => {
      if (spec.api === 'head') return { data: { resultMap: { storeHead: { storeInfo: { storeId: 'E201', tbRestaurantId: '201', name: '示例便利店' } } } } }
      if (spec.api === 'search') return { data: { data: { skuList: [{ item: product }] } } }
      if (spec.api === 'cart') return { data: raw }
      assert.equal(spec.api, 'add'); assert.equal(retry, false); writes++
      raw = cartRaw()
      if (unknown) throw Error('transport interrupted')
      return { data: {} }
    } }
  const base = { login, service: { selectedAddress: async () => address, checkReply: () => {} }, verify: async () => {}, mutations: new Set(),
    displayCart: (context, cart) => cart.display }
  const retail = new RetailTrade(base), found = await retail.search({ shopId: 'E201', keyword: '水' })
  const args = { productRef: found.items[0].productRef, operationRef: 'operation-1', quantity: 1, revision: retailCartData(raw, '201').revision }
  product.stockModel.quantity = 0
  await assert.rejects(retail.add(args), error => error.code === 'retail-spec-required'); assert.equal(writes, 0)
  product.stockModel.quantity = 3; unknown = true
  await assert.rejects(retail.add(args), /transport interrupted/); assert.equal(writes, 1)
  await assert.rejects(retail.add({ ...args, revision: retailCartData(raw, '201').revision }), error => error.code === 'cart-duplicate')
  assert.equal(writes, 1); assert.equal((await retail.cart({ shopId: 'E201' })).quantity, 1)
})
