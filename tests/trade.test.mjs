import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { cartData, checkoutData, paymentDestination, submittedOrder, cents } from '../lib/trade-data.js'
import { TaobaoTrade } from '../lib/taobao-trade.js'

const zip = value => gzipSync(JSON.stringify(value)).toString('base64')
const address = { ref: 'a'.repeat(64), nativeId: '77', geohash: 'wtw3sjq6', coordinates: { latitude: 31, longitude: 121 },
  display: { address: '示例配送地址', contact: '示例用户', maskedPhone: '130****0000' } }
const baseLine = { cart_id: 'cart-1', id: 'food-1', sku_id: 'sku-1', food_type: 1, tb_item_id: 'tb-item-1', tb_sku_id: 'tb-sku-1',
  name: '示例饭', quantity: 1, price: 20, total_price: 20, is_valid: 1, is_selected: true, attrs: [], new_specs: [], garnish: [] }
const cartRaw = () => ({ total_quantity: 2, invalid_foods: [], cart: { restaurant: { encrypted_id: 'store-17' }, total: 20, minimum_order_amount: 10 },
  couple_group: [{ cart_item_d_t_o_list: [structuredClone(baseLine), { ...baseLine, cart_id: 'cart-2', id: 'food-2', sku_id: 'sku-2', tb_item_id: 'tb-item-2',
    tb_sku_id: 'tb-sku-2', name: '无需餐具', price: 0, total_price: 0 }] }], tb_order: JSON.stringify({ buyParam: 'synthetic-selection', exParams: '{}' }) })
function quoteRaw(cart = cartData(cartRaw(), 'store-17'), total = 2100) {
  const component = fields => ({ fields, props: { isSubmit: 'true' } })
  const quantity = cart.display.quantity
  return { data: {
    trade_checkout_global: component({ userId: '87654', uniqueId: 'synthetic-id', checkoutParamStr: JSON.stringify({
      checkOutBizParam: { address_id: 'uic-77', selectedAdditionalServiceIds: [] }, checkOutItemParam: { encryptedShopId: 'store-17',
        entities: cart.lines.map(item => ({ itemId: item.tb_item_id, skuId: item.tb_sku_id, buyAmount: item.quantity })) } }) }),
    trade_checkout_order_submit: component({ addressId: 'uic-77', orderTotalFee: total, priceStr: String(total / 100), goodsTotalQuantity: quantity, isClosed: false, discountedPrice: 0 }),
    trade_checkout_subtotal: component({ centPrice: total }),
    trade_checkout_restaurant_info: component({ name: '示例店', totalQuantity: quantity, statusTip: { text: '明天 10:00 开始配送' },
      foodList: cart.lines.map(item => ({ name: item.name, quantity: item.quantity, price: item.price, spec: '' })) }),
    trade_checkout_payment_cashier: component({ paymentExternalInfo: { selectedPayOptionList: '["ALIPAY_BATCH_ESCROW_APP"]' } }),
    trade_checkout_coupon: component({ feeList: [{ name: '配送费', price: 1 }] }),
    tracking_only: { fields: { privateTracking: 'synthetic-tracking' }, props: { isSubmit: 'false' } },
  }, ext: { linkage: { submit: zip({ buyerId: '87654', orderDTOs: [{ sellerId: 'synthetic-seller' }],
    cashierPaymentDTO: { payOrderAmount: total, payCurrency: 'CNY', orderCurrency: 'CNY' } }),
    adjust: zip({ tradeBuyQuery: { userId: '87654' }, extraParams: { checkoutAddressInfo: JSON.stringify({ selectedEleAddressId: '77' }) } }) } } }
}

test('server quote snapshot projects fees, timing and cents; submit uses only server-selected components', async () => {
  const cart = cartData(cartRaw(), 'store-17'), raw = quoteRaw(cart)
  const result = checkoutData(raw, { buyerId: '87654', addressId: '77', shopId: 'store-17', cart })
  assert.deepEqual(result.display, JSON.parse(await readFile(new URL('./fixtures/trade-quote.expected.json', import.meta.url), 'utf8')))
  const params = JSON.parse(gunzipSync(Buffer.from(result.request.params, 'base64')).toString())
  assert(!params.tracking_only); assert.equal(result.request.linkage, raw.ext.linkage.submit)
  assert.deepEqual(JSON.parse(result.request.feature), { paramsZip: 'true' })
  for (const bad of [NaN, -1, '1.001', 0.001]) assert.throws(() => cents(bad))
})

test('foreign buyer/address/SKU, contradictory amount, extra service and closed store quotes cannot be submitted', () => {
  const cart = cartData(cartRaw(), 'store-17'), owner = { buyerId: '87654', addressId: '77', shopId: 'store-17', cart }
  for (const mutate of [
    raw => { raw.data.trade_checkout_global.fields.userId = '999' },
    raw => { raw.ext.linkage.adjust = zip({ tradeBuyQuery: { userId: '87654' }, extraParams: { checkoutAddressInfo: '{"selectedEleAddressId":"88"}' } }) },
    raw => { const v = JSON.parse(raw.data.trade_checkout_global.fields.checkoutParamStr); v.checkOutItemParam.entities[0].skuId = 'other'; raw.data.trade_checkout_global.fields.checkoutParamStr = JSON.stringify(v) },
    raw => { raw.data.trade_checkout_order_submit.fields.orderTotalFee++ },
    raw => { const value = JSON.parse(gunzipSync(Buffer.from(raw.ext.linkage.submit, 'base64')).toString()); value.cashierPaymentDTO.payOrderAmount++; raw.ext.linkage.submit = zip(value) },
    raw => { raw.data.trade_checkout_order_submit.fields.isClosed = true },
    raw => { const v = JSON.parse(raw.data.trade_checkout_global.fields.checkoutParamStr); v.checkOutBizParam.selectedAdditionalServiceIds = ['paid-service']; raw.data.trade_checkout_global.fields.checkoutParamStr = JSON.stringify(v) },
  ]) { const raw = quoteRaw(); mutate(raw); assert.throws(() => checkoutData(raw, owner)) }
  const invalid = cartRaw(); invalid.cart.restaurant.encrypted_id = 'foreign'; assert.throws(() => cartData(invalid, 'store-17'))
})

test('payment handoffs accept official HTTPS destinations and never execute payment', () => {
  for (const url of ['https://r.ele.me/payment?synthetic=1', 'https://h5.ele.me/cashier/postcashier?synthetic=1']) assert.equal(paymentDestination(url), url)
  for (const url of ['http://r.ele.me/payment', 'https://r.ele.me.attacker.test/payment', 'https://attacker.test/', 'javascript:alert(1)', 'https://user:password@r.ele.me/payment', 'https://r.ele.me:444/payment']) assert.equal(paymentDestination(url), null)
  assert.deepEqual(submittedOrder({ bizOrderId: '123,456', nextUrl: 'https://r.ele.me/payment?synthetic=1' }),
    { orderIds: ['123', '456'], paymentUrl: 'https://r.ele.me/payment?synthetic=1' })
})

async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-trade-')), calls = [], raw = cartRaw()
  let now = 100000, rejectSubmit = false, accountId = '12345', selected = address, checkoutTotal = 2100
  let chain = Promise.resolve()
  const login = { protocol: Object.fromEntries(['menuHead', 'menu', 'itemOptions', 'cart', 'checkout', 'submit', 'taobaoIdentity'].map(api => [api, { api }])),
    http: { async storageState() { return { cookies: [{ name: 'unb', domain: '.ele.me', value: '87654' }, { name: 'unb', domain: '.taobao.com', value: '98765' }] } } },
    get accountId() { return accountId }, async requireAccount() {},
    run(operation) { const promise = chain.then(operation); chain = promise.catch(() => {}); return promise },
    async mtop(spec, payload, retry) {
      calls.push({ api: spec.api, payload, retry })
      if (spec.api === 'menuHead') return { ret: ['SUCCESS::ok'], data: { resultMap: { storeHead: { storeInfo: { storeId: 'store-17', sellerId: 'seller-17', tbStoreId: 'tb-17' } }, storeMiniAppTab: [{ tbRestaurantId: '1717' }] } } }
      if (spec.api === 'menu') return { ret: ['SUCCESS::ok'], data: { resultMap: { menu: { itemGroups: [{ groupId: 'main', name: '主食', groupType: 2, items: [{
        itemId: 'food-1', tbItemId: 'tb-item-1', storeId: 'store-17', name: '示例饭', price: '20', inSaleTime: true, attributes: [],
        purchaseButton: { needMultiSpecs: 0, minPurchase: 1, stock: 10, commodityDict: { id: 'food-1', skuId: 'sku-1', foodType: 1, tbItemId: 'tb-item-1', tbSkuId: 'tb-sku-1', itemId: 'food-1' } } }] }] } } } }
      if (spec.api === 'cart') {
        const params = JSON.parse(JSON.parse(payload.bizInfos).cartOperateParam)
        assert.deepEqual(params.extra_action, [])
        for (const change of params.operating_entities) {
          const line = raw.couple_group[0].cart_item_d_t_o_list.find(item => item.id === change.id)
          line.quantity += change.step; line.total_price = line.quantity * line.price
        }
        raw.total_quantity = raw.couple_group[0].cart_item_d_t_o_list.reduce((sum, item) => sum + item.quantity, 0)
        return { ret: ['SUCCESS::ok'], data: structuredClone(raw) }
      }
      if (spec.api === 'taobaoIdentity') return { ret: ['SUCCESS::ok'], data: { userNumId: '98765' } }
      if (spec.api === 'checkout') return { ret: ['SUCCESS::ok'], data: quoteRaw(cartData(raw, 'store-17'), checkoutTotal) }
      if (spec.api === 'submit') { if (rejectSubmit) throw Error('timeout'); return { ret: ['SUCCESS::ok'], data: { bizOrderId: '123456', nextUrl: 'https://r.ele.me/payment?synthetic=1' } } }
      throw Error('unexpected endpoint')
    } }
  const service = { login, async selectedAddress(ref) { if (ref !== undefined && ref !== selected.ref) throw Error('stale address'); return selected },
    checkReply(raw) { assert(raw.ret.some(value => value.startsWith('SUCCESS::'))) } }
  const trade = new TaobaoTrade(service, { journalDirectory: directory, dryRun: false, now: () => now, ...options })
  return { trade, calls, raw, directory, service, changeAccount: () => { accountId = '999' }, advance: (milliseconds = 121000) => { now += milliseconds },
    rejectSubmit: () => { rejectSubmit = true }, setCheckoutTotal: value => { checkoutTotal = value }, close: () => rm(directory, { recursive: true, force: true }) }
}
const getQuote = async f => {
  const cart = await f.trade.cart('store-17', address.ref)
  return f.trade.checkout({ shopId: 'store-17', addressRef: address.ref, revision: cart.revision })
}
const submitArgs = quote => ({ quoteRef: quote.quoteRef, confirmed: true, confirmedCents: quote.totalCents })

test('submitted orders retain the confirmed product summary instead of caller-supplied content, while old records remain readable', async () => {
  const f = await fixture()
  try {
    const quote = await getQuote(f)
    await f.trade.submit({ ...submitArgs(quote), itemSummary: 'caller-supplied different goods' })
    const journal = await f.trade.journal()
    assert.equal(journal.attempts[0].itemSummary, '示例饭×1；无需餐具×1')
    assert.equal(journal.attempts[0].status, 'created')
    delete journal.attempts[0].itemSummary
    await writeFile(join(f.directory, 'trade-attempts.json'), JSON.stringify(journal))
    assert.equal((await f.trade.journal()).attempts[0].itemSummary, undefined)
  } finally { await f.close() }
})

test('an empty confirmed product list cannot create an order and retained summaries are bounded', async () => {
  for (const empty of [true, false]) {
    const f = await fixture()
    try {
      const quote = await getQuote(f), stored = f.trade.quotes.get(quote.quoteRef)
      stored.display.items = empty ? [] : Array.from({ length: 10 }, () => ({ name: '商品'.repeat(200), quantity: 1 }))
      if (empty) {
        await assert.rejects(f.trade.submit(submitArgs(quote)), error => error.code === 'order-items-missing')
        assert.equal((await f.trade.journal()).attempts.length, 0)
        assert(!f.calls.some(call => call.api === 'submit'))
      } else {
        await f.trade.submit(submitArgs(quote))
        const summary = (await f.trade.journal()).attempts[0].itemSummary
        assert.equal(summary.length, 2000)
        assert(summary.startsWith('商品'))
      }
    } finally { await f.close() }
  }
})

test('an item that cannot be ordered alone reports the platform restriction before creation', async () => {
  const f = await fixture(), original = f.service.login.mtop.bind(f.service.login)
  f.service.login.mtop = (spec, ...args) => spec.api === 'checkout'
    ? Promise.resolve({ ret: ['B_10006_01_18_024::synthetic-private-platform-message'] }) : original(spec, ...args)
  try {
    await assert.rejects(getQuote(f), error => error.code === 'item-requires-other-goods' && !error.message.includes('private'))
    assert(!f.calls.some(call => call.api === 'submit'))
  } finally { await f.close() }
})

test('each newly authorized retry must name the latest unknown attempt and preserves the complete chain', async () => {
  const f = await fixture()
  try {
    f.rejectSubmit()
    const first = await getQuote(f)
    await assert.rejects(f.trade.submit(submitArgs(first)), error => error.code === 'order-unknown')
    const second = await getQuote(f)
    const retry = { ...submitArgs(second), retryOf: first.quoteRef, previousOrderAbsent: true, manualConfirmation: true }
    await assert.rejects(f.trade.submit({ ...retry, previousOrderAbsent: undefined }), error => error.code === 'retry-invalid')
    await assert.rejects(f.trade.submit({ ...retry, manualConfirmation: false }), error => error.code === 'retry-invalid')
    await assert.rejects(f.trade.submit({ ...retry, retryOf: '11111111-1111-4111-8111-111111111111' }), error => error.code === 'retry-invalid')
    await assert.rejects(f.trade.submit(retry), error => error.code === 'order-unknown')
    const third = await getQuote(f)
    const nextRetry = { ...submitArgs(third), retryOf: second.quoteRef, previousOrderAbsent: true, manualConfirmation: true }
    await assert.rejects(f.trade.submit({ ...nextRetry, retryOf: first.quoteRef }), error => error.code === 'retry-invalid')
    await assert.rejects(f.trade.submit({ ...nextRetry, previousOrderAbsent: undefined }), error => error.code === 'retry-invalid')
    await assert.rejects(f.trade.submit({ ...nextRetry, manualConfirmation: false }), error => error.code === 'retry-invalid')
    await assert.rejects(f.trade.submit(nextRetry), error => error.code === 'order-unknown')
    await assert.rejects(f.trade.submit(nextRetry), error => error.code === 'quote-expired')
    const fourth = await getQuote(f)
    await assert.rejects(f.trade.submit({ ...nextRetry, ...submitArgs(fourth) }), error => error.code === 'retry-invalid')
    await assert.rejects(f.trade.submit(submitArgs(fourth)), error => error.code === 'order-unknown')
    const records = (await f.trade.journal()).attempts
    assert.equal(records.length, 3)
    assert.equal(records[1].retryOf, records[0].ref); assert.equal(records[2].retryOf, records[1].ref)
    assert.deepEqual(records.map(record => record.ref), [first.quoteRef, second.quoteRef, third.quoteRef])
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 3)
  } finally { await f.close() }
})

test('a new retry cannot increase the last attempt amount or exceed the daily reserved budget', async () => {
  for (const scenario of ['amount', 'budget']) {
    const f = await fixture({ budget: scenario === 'budget' ? 42 : 0 })
    try {
      f.rejectSubmit()
      const first = await getQuote(f)
      await assert.rejects(f.trade.submit(submitArgs(first)), error => error.code === 'order-unknown')
      const second = await getQuote(f)
      await assert.rejects(f.trade.submit({ ...submitArgs(second), retryOf: first.quoteRef, previousOrderAbsent: true, manualConfirmation: true }), error => error.code === 'order-unknown')
      if (scenario === 'amount') f.setCheckoutTotal(2101)
      const third = await getQuote(f)
      await assert.rejects(f.trade.submit({ ...submitArgs(third), retryOf: second.quoteRef, previousOrderAbsent: true, manualConfirmation: true }),
        error => error.code === (scenario === 'amount' ? 'retry-invalid' : 'over-budget'))
      assert.equal((await f.trade.journal()).attempts.length, 2)
      assert.equal(f.calls.filter(call => call.api === 'submit').length, 2)
    } finally { await f.close() }
  }
})

test('concurrent owners cannot create two successors for the same unknown attempt', async () => {
  const f = await fixture()
  try {
    f.rejectSubmit()
    const first = await getQuote(f)
    await assert.rejects(f.trade.submit(submitArgs(first)), error => error.code === 'order-unknown')
    const otherService = { ...f.service, login: { ...f.service.login, run: operation => operation() } }
    const other = new TaobaoTrade(otherService, { journalDirectory: f.directory, dryRun: false, now: () => 100000 })
    const second = await getQuote(f), competing = await getQuote({ trade: other })
    const results = await Promise.allSettled([f.trade.submit({ ...submitArgs(second), retryOf: first.quoteRef, previousOrderAbsent: true, manualConfirmation: true }),
      other.submit({ ...submitArgs(competing), retryOf: first.quoteRef, previousOrderAbsent: true, manualConfirmation: true })])
    assert(results.every(result => result.status === 'rejected'))
    assert.equal(results.filter(result => result.reason.code === 'order-unknown').length, 1)
    assert(results.some(result => ['trade-locked', 'retry-invalid'].includes(result.reason.code)))
    const records = (await f.trade.journal()).attempts
    assert.equal(records.length, 2); assert.equal(records[1].retryOf, records[0].ref)
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 2)
  } finally { await f.close() }
})

test('checkout and submission diagnostics share a quote reference without retaining private response values', async () => {
  const f = await fixture(), events = [], secret = 'synthetic-private-response'
  f.service.login.diagnostic = value => events.push(value)
  try {
    const quote = await getQuote(f), original = f.service.login.mtop.bind(f.service.login)
    f.service.login.mtop = async (...args) => args[0].api === 'submit'
      ? { ret: ['FAIL_SYS_USER_VALIDATE::' + secret], data: { code: 10000, url: 'https://example.test/' + secret } }
      : original(...args)
    await assert.rejects(f.trade.submit(submitArgs(quote)), error => error.code === 'order-unknown')
    const response = events.find(value => value.stage === 'submit-response')
    assert.deepEqual(response.ret, ['FAIL_SYS_USER_VALIDATE']); assert.equal(response.code, 10000)
    for (const stage of ['checkout-request', 'checkout-response', 'checkout-verified', 'submit-sent', 'submit-response', 'result-unconfirmed']) {
      assert.equal(events.find(value => value.stage === stage)?.attemptId, quote.quoteRef)
    }
    assert(!JSON.stringify(events).includes(secret))
    const record = JSON.parse(await readFile(join(f.directory, 'trade-attempts.json'), 'utf8')).attempts[0]
    assert.equal(record.status, 'unknown')
  } finally { await f.close() }
})

test('checkout diagnostics separate transport failures and invalid quotes without creating an order', async () => {
  for (const scenario of ['transport', 'invalid']) {
    const f = await fixture(), events = [], original = f.service.login.mtop.bind(f.service.login)
    f.service.login.diagnostic = value => events.push(value)
    f.service.login.mtop = async (...args) => {
      if (args[0].api !== 'checkout') return original(...args)
      if (scenario === 'transport') throw Error('synthetic-private-transport')
      return { ret: ['SUCCESS::synthetic-private-response'], data: {} }
    }
    try {
      await assert.rejects(getQuote(f))
      const stage = scenario === 'transport' ? 'checkout-transport-failed' : 'checkout-invalid'
      assert.equal(events.find(value => value.stage === stage)?.attemptId, events[0].attemptId)
      assert(!events.some(value => value.stage === 'checkout-verified'))
      assert(!f.calls.some(value => value.api === 'submit'))
      assert(!JSON.stringify(events).includes('synthetic-private'))
    } finally { await f.close() }
  }
})

test('one-item cart change retains unrelated lines and duplicate/stale operations stop before mutation', async () => {
  const f = await fixture()
  try {
    const cart = await f.trade.cart('store-17', address.ref), other = structuredClone(f.raw.couple_group[0].cart_item_d_t_o_list[1])
    const args = { shopId: 'store-17', addressRef: address.ref, revision: cart.revision, operationRef: '11111111-1111-4111-8111-111111111111', itemId: 'food-1', step: 1 }
    const changed = await f.trade.cartChange(args)
    assert.equal(changed.quantity, 3); assert.deepEqual(f.raw.couple_group[0].cart_item_d_t_o_list[1], other)
    await assert.rejects(f.trade.cartChange(args), error => error.code === 'cart-duplicate')
    await assert.rejects(f.trade.cartChange({ ...args, operationRef: '22222222-2222-4222-8222-222222222222' }), error => error.code === 'cart-changed')
    const mutations = f.calls.filter(call => call.api === 'cart' && JSON.parse(JSON.parse(call.payload.bizInfos).cartOperateParam).operating_entities.length)
    assert.equal(mutations.length, 1); assert.equal(mutations[0].retry, false)
  } finally { await f.close() }
})

test('preview, expiry, cap, confirmation and changed cart reject before any order request', async () => {
  for (const scenario of ['preview', 'expiry', 'cap', 'confirmation', 'cart']) {
    const f = await fixture({ dryRun: scenario === 'preview', cap: scenario === 'cap' ? 20 : 35 })
    try {
      const quote = await getQuote(f), args = submitArgs(quote)
      if (scenario === 'expiry') f.advance()
      if (scenario === 'confirmation') args.confirmedCents++
      if (scenario === 'cart') f.raw.couple_group[0].cart_item_d_t_o_list[0].quantity++
      await assert.rejects(f.trade.submit(args)); assert(!f.calls.some(value => value.api === 'submit'))
    } finally { await f.close() }
  }
})

test('refreshing checkout retains an earlier unexpired quote and never permits a second order for its cart', async () => {
  const f = await fixture()
  try {
    const first = await getQuote(f), refreshed = await getQuote(f)
    assert.notEqual(first.quoteRef, refreshed.quoteRef)
    const order = await f.trade.submit(submitArgs(first))
    assert.deepEqual(order.orderIds, ['123456'])
    await assert.rejects(f.trade.submit(submitArgs(first)), error => error.code === 'quote-expired')
    await assert.rejects(f.trade.submit(submitArgs(refreshed)), error => error.code === 'order-duplicate')
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
  } finally { await f.close() }
})

test('each retained quote expires on its own deadline while a later refresh remains usable', async () => {
  const f = await fixture()
  try {
    const first = await getQuote(f)
    f.advance(60000)
    const refreshed = await getQuote(f)
    f.advance(61000)
    await assert.rejects(f.trade.submit(submitArgs(first)), error => error.code === 'quote-expired')
    assert.equal((await f.trade.submit(submitArgs(refreshed))).amountCents, 2100)
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
  } finally { await f.close() }
})

test('retained quotes still reject changed carts or accounts before any submission', async () => {
  for (const scenario of ['cart', 'account']) {
    const f = await fixture()
    try {
      const first = await getQuote(f), refreshed = await getQuote(f)
      if (scenario === 'cart') f.raw.couple_group[0].cart_item_d_t_o_list[0].update_at = 200000
      else f.changeAccount()
      await assert.rejects(f.trade.submit(submitArgs(first)), error => error.code === (scenario === 'cart' ? 'cart-changed' : 'account-changed'))
      await assert.rejects(f.trade.submit(submitArgs(refreshed)))
      assert.equal(f.calls.filter(call => call.api === 'submit').length, 0)
    } finally { await f.close() }
  }
})

test('single-attempt submission persists first, returns a payment link and rejects duplicate confirmation', async () => {
  const f = await fixture()
  try {
    const quote = await getQuote(f), order = await f.trade.submit(submitArgs(quote))
    assert.deepEqual(order.orderIds, ['123456']); assert.equal(order.paymentStatus, 'unconfirmed')
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
    assert.equal(f.calls.find(call => call.api === 'submit').retry, false)
    await assert.rejects(f.trade.submit(submitArgs(quote)), error => error.code === 'quote-expired')
    const reloaded = new TaobaoTrade(f.service, { journalDirectory: f.directory })
    const history = await reloaded.tradeHistory(); assert.equal(history.attempts[0].status, 'created'); assert.equal(history.attempts[0].paymentUrl, order.paymentUrl)
    assert(!f.calls.some(call => /payment/.test(call.api)))
  } finally { await f.close() }
})

test('uncertain order remains reserved after restart and an identical cart cannot be resubmitted', async () => {
  const f = await fixture()
  try {
    f.rejectSubmit(); const quote = await getQuote(f)
    await assert.rejects(f.trade.submit(submitArgs(quote)), error => error.code === 'order-unknown')
    const record = JSON.parse(await readFile(join(f.directory, 'trade-attempts.json'), 'utf8')).attempts[0]
    assert.equal(record.status, 'unknown'); assert.equal(record.amountCents, quote.totalCents)
    const next = await getQuote(f); await assert.rejects(f.trade.submit(submitArgs(next)), error => error.code === 'order-unknown')
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
  } finally { await f.close() }
})

test('confirmed and uncertain orders count toward the shared daily cap', async () => {
  const f = await fixture({ budget: 40 })
  try {
    await f.trade.submit(submitArgs(await getQuote(f)))
    f.raw.couple_group[0].cart_item_d_t_o_list[0].update_at = 200000
    const next = await getQuote(f)
    await assert.rejects(f.trade.submit(submitArgs(next)), error => error.code === 'over-budget')
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
  } finally { await f.close() }
})

async function selectionFixture({ ignoreMutation = false } = {}) {
  const f = await fixture(), original = f.service.login.mtop.bind(f.service.login)
  const item = { itemId: 'food-1', tbItemId: 'tb-item-1', storeId: 'store-17', name: '示例饭', price: 20, inSaleTime: true,
    purchaseButton: { needMultiSpecs: 1, stock: 10, minPurchase: 1 },
    specFoods: [{ foodId: 'food-1', skuId: 'sku-1', itemId: 'food-1', tbItemId: 'tb-item-1', tbSkuId: 'tb-sku-1', stock: 10, price: 20,
      specs: [{ name: '份量', value: '大份' }] }] }
  const detail = { ...item, error: false, minPurchase: 1, itemType: 1, brand: { attributes: [{ name: '辣度', minPurchased: 1, maxPurchased: 1,
    details: [{ name: '微辣', saleStatus: 1, selected: true }] }] } }
  f.service.login.mtop = async (spec, payload, retry) => {
    if (spec.api === 'menu') { f.calls.push({ api: spec.api, payload, retry }); return { ret: ['SUCCESS::ok'], data: { resultMap: { menu: {
      itemGroups: [{ groupId: 'main', groupType: 2, name: '主食', items: [item] }] } } } } }
    if (spec.api === 'itemOptions') { f.calls.push({ api: spec.api, payload, retry }); return { ret: ['SUCCESS::ok'], data: structuredClone(detail) } }
    if (spec.api === 'cart') {
      const changes = JSON.parse(JSON.parse(payload.bizInfos).cartOperateParam).operating_entities
      if (changes.length && ignoreMutation) { f.calls.push({ api: spec.api, payload, retry }); return { ret: ['SUCCESS::ok'], data: structuredClone(f.raw) } }
      for (const change of changes) { const line = f.raw.couple_group[0].cart_item_d_t_o_list.find(line => line.id === change.id)
        line.attrs = change.attrs; line.new_specs = change.new_specs }
    }
    return original(spec, payload, retry)
  }
  f.raw.couple_group[0].cart_item_d_t_o_list[0].attrs = [{ name: '辣度', value: '微辣' }]
  f.raw.couple_group[0].cart_item_d_t_o_list[0].new_specs = [{ name: '份量', value: '大份' }]
  const selection = await f.trade.itemOptions({ shopId: 'store-17', addressRef: address.ref, itemId: item.itemId })
  const cart = await f.trade.cart('store-17', address.ref)
  return { ...f, detail, args: { shopId: 'store-17', addressRef: address.ref, itemId: item.itemId, revision: cart.revision, step: 1,
    operationRef: '11111111-1111-4111-8111-111111111111', selectionRef: selection.selectionRef,
    variantRef: selection.variants[0].ref, choiceRefs: [selection.variants[0].groups[0].choices[0].ref], quantity: 2 } }
}

test('selected variants and required flavors are re-read, added once, displayed and retained when removing one', async () => {
  const f = await selectionFixture()
  try {
    const changed = await f.trade.cartChange(f.args)
    assert.equal(changed.quantity, 4); assert(changed.items[0].specification.includes('大份')); assert(changed.items[0].specification.includes('微辣'))
    assert.equal(f.calls.filter(call => call.api === 'itemOptions').length, 2)
    const mutations = f.calls.filter(call => call.api === 'cart' && JSON.parse(JSON.parse(call.payload.bizInfos).cartOperateParam).operating_entities.length)
    assert.equal(mutations.length, 1); assert.equal(mutations[0].retry, false)
    const reduced = await f.trade.cartChange({ shopId: 'store-17', addressRef: address.ref, revision: changed.revision, step: -1,
      operationRef: '22222222-2222-4222-8222-222222222222', lineRef: changed.items[0].ref })
    assert.equal(reduced.quantity, 3); assert.equal(reduced.items[0].specification, changed.items[0].specification)
  } finally { await f.close() }
})

test('changed prices, foreign selections and switched accounts stop before changing the cart', async () => {
  for (const scenario of ['price', 'reference', 'account']) {
    const f = await selectionFixture()
    try {
      if (scenario === 'price') f.detail.specFoods[0].price++
      if (scenario === 'reference') f.args.selectionRef = 'foreign'
      if (scenario === 'account') f.changeAccount()
      await assert.rejects(f.trade.cartChange(f.args), error => ['spec-changed', 'spec-stale'].includes(error.code))
      assert(!f.calls.some(call => call.api === 'cart' && JSON.parse(JSON.parse(call.payload.bizInfos).cartOperateParam).operating_entities.length))
    } finally { await f.close() }
  }
})

test('a successful platform reply without the requested quantity is unconfirmed and cannot be sent again', async () => {
  const f = await selectionFixture({ ignoreMutation: true })
  try {
    await assert.rejects(f.trade.cartChange(f.args), error => error.code === 'cart-result-unconfirmed')
    await assert.rejects(f.trade.cartChange(f.args), error => error.code === 'cart-duplicate')
    assert.equal(f.calls.filter(call => call.api === 'cart' && JSON.parse(JSON.parse(call.payload.bizInfos).cartOperateParam).operating_entities.length).length, 1)
  } finally { await f.close() }
})

test('removed zero-quantity lines disappear and specification changes invalidate the cart revision', () => {
  const raw = cartRaw(), first = cartData(raw, 'store-17'); raw.couple_group[0].cart_item_d_t_o_list[0].attrs = [{ name: '辣度', value: '微辣' }]
  assert.notEqual(first.revision, cartData(raw, 'store-17').revision)
  raw.couple_group[0].cart_item_d_t_o_list[0].quantity = 0; raw.total_quantity = 1
  const reduced = cartData(raw, 'store-17'); assert.equal(reduced.lines.length, 1); assert.equal(reduced.display.quantity, 1)
  raw.total_quantity = 2; assert.throws(() => cartData(raw, 'store-17'))
})

test('private manual confirmation can submit during automation preview but stays bounded by the quote and requested budget', async () => {
  for (const limit of [2000, 2500]) {
    const f = await fixture({ dryRun: true })
    try {
      const quote = await getQuote(f), args = { ...submitArgs(quote), manualConfirmation: true, maxAmountCents: limit }
      if (limit < quote.totalCents) { await assert.rejects(f.trade.submit(args), error => error.code === 'over-cap'); assert(!f.calls.some(c => c.api === 'submit')) }
      else { const result = await f.trade.submit(args); assert.equal(result.paymentStatus, 'unconfirmed'); assert.equal(f.calls.filter(c => c.api === 'submit').length, 1) }
      assert.equal(f.trade.dryRun, true)
    } finally { await f.close() }
  }
})
