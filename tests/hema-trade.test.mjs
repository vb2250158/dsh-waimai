import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { HemaTrade } from '../lib/hema-trade.js'
import { hemaAddresses } from '../lib/hema-data.js'
import { hemaCheckoutData, hemaSubmitParameters, hemaPaymentDestination, hemaAdjustParameters, hemaReturnCode } from '../lib/hema-trade-data.js'

const addressRef = 'a'.repeat(64), revision = 'b'.repeat(64)
const address = { addreid: '123', geoCode: 'private-coordinates', addrName: 'Synthetic road', addrDetail: 'Synthetic room', linkPhone: '13800000000', linkMan: 'Test user', addressType: 1, deliveryDockId: '' }
const selected = { nativeId: '123', ref: addressRef, geoCode: address.geoCode, display: { address: address.addrName + ' ' + address.addrDetail, contact: address.linkMan, maskedPhone: '138****0000' }, groups: [{ groupId: '456' }] }
const line = { cartId: '321', itemId: '789', skuId: '987', quantity: '1', selected: false }
const node = (tag, fields, submit = false) => ({ tag, fields, submit })
function quoteBody() {
  return { data: {
    root: node('confirmOrder', {}, true), address: node('wdkAddress', { selectedId: 123, coordinate: address.geoCode, mobile: address.linkPhone, fullName: address.linkMan, addressDetail: address.addrDetail + address.addrName }, true),
    item: node('wdkItemInfo', { itemId: 789, skuId: 987, count: 'x1', title: 'Synthetic mineral water', itemSpecification: '570ml×24', price: '¥42.90', valid: true }, true),
    submit: node('wdkSubmitOrder', { price: '¥52.90', payBtn: { enable: true } }, true), bottom: node('wdkBottomTotal', { price: '¥52.90' }),
    header: node('hemaFeeHeader', { itemPriceValue: '¥49.90' }), freight: node('wdkFreight', { freight: 1000, freightValue: '¥10.00', freightDetail: { produce: [{ feeType: 'postFee', freightValue: '¥6.00', freightDesc: 'Delivery' }, { feeType: 'postFee', freightValue: '¥4.00', freightDesc: 'Weight surcharge' }] } }, true),
    discount: node('wdkSplitPromotion', { totalPromotionPrice: '-¥7.00' }), merchant: node('orderInfo', { title: 'Synthetic national store' }), time: node('wdkSendTime', { selectTime: 'Next day' }, true),
    extra: { ...node('hmPayMore', {}), hidden: { extensionMap: { visible: 'false' } } }, contract: node('wdkServiceContract', {}),
  }, hierarchy: { root: 'root', structure: { root: ['address', 'item', 'submit'] } }, linkage: { common: { compress: true, submitParams: 'opaque-submit', validateParams: 'opaque-validate' }, signature: 'opaque-signature' }, endpoint: { protocolVersion: '4.0' } }
}
async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hema-trade-')), calls = [], events = []
  let currentRevision = revision, failCreate = false, identity = '555', body = quoteBody(), now = 1792580000000
  const login = { accountId: identity, run: fn => fn(), requireAccount: async () => {}, verifyIdentity: async expected => { if (identity !== expected) throw Error('changed') },
    diagnostic: event => events.push(event), checkReply: reply => { if (!reply.ret.some(code => code.startsWith('SUCCESS::'))) throw Error('native failure') },
    protocol: JSON.parse(await readFile(new URL('../lib/hema-protocol.json', import.meta.url), 'utf8')),
    async mtop(spec, payload, retry) {
      calls.push({ api: spec.api, payload, retry })
      if (spec.api.includes('decideByAddressId')) return { ret: ['SUCCESS::fixture'], data: { userAddress: address, groupList: [{ groupId: '456', deliveryType: 'DELIVERY', shopIds: '111,222', locationIds: 'verified-location-map' }] } }
      if (spec.api === 'mtop.wdk.hema.cart.confirm') return { ret: ['SUCCESS::fixture'], data: { buyParam: 'native-buy-params', exParams: '{}', selectedShopIds: '222', confirmAlertInfo: {} } }
      if (spec.api === 'mtop.trade.order.build') return { ret: ['SUCCESS::fixture'], data: body }
      if (spec.api === 'mtop.trade.order.adjust') {
        const adjusted = JSON.parse(gunzipSync(Buffer.from(payload.params, 'base64')))
        body.data.time.fields.selectedId = adjusted.data.time.fields.selectedId
        body.data.time.fields.selectTime = 'Verified delivery option ' + body.data.time.fields.selectedId
        return { ret: ['SUCCESS::fixture'], data: body }
      }
      if (spec.api === 'mtop.trade.order.create') { if (failCreate) throw Error('transport lost'); return { ret: ['SUCCESS::fixture'], data: { bizOrderId: '10001', nextUrl: 'private-must-not-persist' } } }
      throw Error('unexpected API')
    } }
  const service = { login, selectedAddress: async ref => { if (ref && ref !== addressRef) throw Error('address changed'); return selected },
    readCart: async () => ({ raw: { data: { target: { tag: 'mainItem', fields: { ...line, sku: { skuId: line.skuId }, isChecked: 'false' } } } },
      display: { revision: currentRevision, items: [{ id: line.cartId, available: true, selected: false }] } }) }
  const trade = new HemaTrade(service, { journalDirectory: directory, cap: 60, now: () => now, ...options })
  return { trade, calls, events, directory, args: { addressRef, revision, lineIds: [line.cartId], shopId: '456' },
    change: value => { if (value.body) body = value.body; if (value.revision) currentRevision = value.revision; if ('failCreate' in value) failCreate = value.failCreate; if (value.expire) now += 121000; if (value.identity) { identity = value.identity; login.accountId = identity } }, close: () => rm(directory, { recursive: true, force: true }) }
}

function deliveryBody(count) {
  const body = quoteBody()
  body.linkage.common.queryParams = 'opaque-query'
  body.linkage.input = ['root', 'address']
  body.data.time.fields.selectTime = '选择时间'
  body.data.time.hidden = { extensionMap: { context: JSON.stringify({ disable: false, hidden: false, recommendSelectId: '0,0',
    availableDates: [{ date: '2026-10-23', displayLabel: 'Synthetic day',
      availableTimes: Array.from({ length: count }, (_, index) => ({ time: `Synthetic slot ${index}`, postFee: '10.00' })) }] }) } }
  return body
}

test('a sole Hema delivery option is selected and repriced before a submittable quote is returned', async () => {
  const f = await fixture()
  try {
    f.change({ body: deliveryBody(1) })
    const quote = await f.trade.checkout(f.args)
    assert.equal(quote.requiresDeliveryChoice, false); assert.equal(quote.deliveryOptions.length, 1)
    assert.equal(quote.deliveryOptions[0].selected, true); assert.match(quote.deliveryTime, /Verified delivery/)
    const call = f.calls.find(row => row.api === 'mtop.trade.order.adjust')
    const request = JSON.parse(gunzipSync(Buffer.from(call.payload.params, 'base64')))
    assert.equal(request.operator, 'time'); assert.equal(request.data.time.fields.selectedId, '0,0')
    assert.equal(request.linkage.common.queryParams, 'opaque-query'); assert(!request.linkage.common.submitParams)
    assert.deepEqual(Object.keys(request.data).sort(), ['address', 'root', 'time'])
    assert(!JSON.stringify(quote).includes('opaque-')); assert.equal(call.retry, false)
  } finally { await f.close() }
})

test('multiple Hema delivery options require a current opaque selection and new amount confirmation', async () => {
  const f = await fixture()
  try {
    const body = deliveryBody(2); f.change({ body })
    const quote = await f.trade.checkout(f.args)
    assert.equal(quote.requiresDeliveryChoice, true)
    await assert.rejects(f.trade.submit({ quoteRef: quote.quoteRef, confirmed: true, confirmedCents: 5290, manualConfirmation: true }), /请选择配送/)
    assert.throws(() => hemaSubmitParameters(body), /delivery selection required/)
    await assert.rejects(f.trade.selectDelivery({ quoteRef: quote.quoteRef, deliveryRef: '11111111-1111-4111-8111-111111111111' }), /配送选项已变化/)
    const next = await f.trade.selectDelivery({ quoteRef: quote.quoteRef, deliveryRef: quote.deliveryOptions[1].ref })
    assert.notEqual(next.quoteRef, quote.quoteRef); assert.equal(next.requiresDeliveryChoice, false)
    assert.equal(next.deliveryOptions[1].selected, true)
    await assert.rejects(f.trade.submit({ quoteRef: quote.quoteRef, confirmed: true, confirmedCents: 5290, manualConfirmation: true }), /报价已过期/)
    const decoded = JSON.parse(gunzipSync(Buffer.from(hemaSubmitParameters(f.trade.quote.raw).params, 'base64')))
    assert.equal(decoded.data.time.fields.selectedId, '0,1')
    assert(!f.calls.some(call => call.api === 'mtop.trade.order.create'))
    delete body.linkage.common.queryParams
    assert.throws(() => hemaAdjustParameters(body, 'time', '0,1'), /missing private adjustment/)
  } finally { await f.close() }
})

test('Hema native diagnostics recognize TOP protocol codes without retaining messages or URLs', () => {
  assert.equal(hemaReturnCode('isp.remote-service-error::private-response'), 'isp.remote-service-error')
  assert.equal(hemaReturnCode('isv.invalid-parameter::private-response'), 'isv.invalid-parameter')
  assert.equal(hemaReturnCode('https://private.test/credential::private-response'), 'unrecognized')
})

test('one explicitly confirmed Hema retry retains the unknown attempt and cannot be reused or chained', async () => {
  const f = await fixture()
  try {
    let quote = await f.trade.checkout(f.args)
    f.change({ failCreate: true })
    await assert.rejects(f.trade.submit({ quoteRef: quote.quoteRef, confirmed: true, confirmedCents: 5290, manualConfirmation: true }), /下单结果未确认/)
    const before = JSON.parse(await readFile(join(f.directory, 'trade-attempts.json'), 'utf8')), retryOf = quote.quoteRef
    f.change({ failCreate: false }); quote = await f.trade.checkout(f.args)
    const args = { quoteRef: quote.quoteRef, confirmed: true, confirmedCents: 5290, manualConfirmation: true, retryOf }
    await assert.rejects(f.trade.submit(args), /明确确认重试/)
    const created = await f.trade.submit({ ...args, previousOrderAbsent: true })
    const after = JSON.parse(await readFile(join(f.directory, 'trade-attempts.json'), 'utf8'))
    assert.deepEqual(after.attempts[0], before.attempts[0]); assert.equal(after.attempts.length, 2)
    assert.equal(after.attempts[1].status, 'created'); assert.notEqual(after.attempts[0].fingerprint, after.attempts[1].fingerprint)
    quote = await f.trade.checkout(f.args)
    await assert.rejects(f.trade.submit({ ...args, quoteRef: quote.quoteRef, previousOrderAbsent: true }), /相同商品已有下单记录/)
    await assert.rejects(f.trade.submit({ ...args, quoteRef: quote.quoteRef, retryOf: created.orderRef, previousOrderAbsent: true }), /明确确认重试/)
    assert.equal(f.calls.filter(call => call.api === 'mtop.trade.order.create').length, 2)
  } finally { await f.close() }
})

test('Hema quote resolves serviceable IDs and validates real totals without changing unchecked cart lines', async () => {
  const f = await fixture()
  try {
    const quote = await f.trade.checkout(f.args)
    assert.equal(quote.totalCents, 5290); assert.equal(quote.discountCents, 700); assert.equal(quote.deliveryCents, 1000)
    assert.equal(f.calls.length, 3); assert.equal(f.calls[1].payload.locationIds, 'verified-location-map'); assert.notEqual(f.calls[1].payload.locationIds, address.addreid)
    assert.equal(f.calls[1].payload.cartIds, '["321"]'); assert.equal(f.calls[1].retry, false); assert.equal(f.calls[2].retry, false)
    assert(!JSON.stringify(quote).includes('opaque-')); assert(!JSON.stringify(f.events).includes(address.linkPhone))
  } finally { await f.close() }
})

test('Hema checkout tolerates reordered store IDs but submission rejects changed store membership', async () => {
  const f = await fixture()
  let reads = 0, changedStores = false
  f.trade.service.selectedAddress = async () => hemaAddresses({ addressList: [{ ...address,
    decidedShopData: { groupList: [{ groupId: '456', groupName: 'Synthetic store', groupType: 'FRESH_GROUP', deliveryType: 'DELIVERY',
      ext: { shopIds: changedStores ? '111,333' : ++reads % 2 ? '222,111' : '111,222' } }] } }] }, '555')[0]
  try {
    const quote = await f.trade.checkout(f.args)
    assert.equal(quote.totalCents, 5290)
    changedStores = true
    await assert.rejects(f.trade.submit({ quoteRef: quote.quoteRef, confirmed: true, confirmedCents: 5290, manualConfirmation: true }), /配送地址已变化/)
    assert(!f.calls.some(call => call.api === 'mtop.trade.order.create'))
  } finally { await f.close() }
})

test('Hema quote rejects changed address, added products, inconsistent totals and extra consent', () => {
  for (const mutate of [body => { body.data.address.fields.selectedId = 999 }, body => { body.data.item.fields.skuId = 999 },
    body => { body.data.bottom.fields.price = '¥51.90' }, body => { body.data.freight.fields.freight = 900 },
    body => { body.data.contract.fields.agreement = 'required' }, body => { body.data.extra.hidden.extensionMap.visible = 'true' },
    body => { body.data.freight.fields.freightDetail.produce[0].feeType = 'subscriptionFee' }]) {
    const body = quoteBody(); mutate(body)
    assert.throws(() => hemaCheckoutData(body, { address: { ...address, addreid: '123' }, lines: [line] }))
  }
})

test('Hema submit serializes only submit components and the native opaque submit linkage', () => {
  const request = hemaSubmitParameters(quoteBody()), decoded = JSON.parse(gunzipSync(Buffer.from(request.params, 'base64')))
  assert.deepEqual(JSON.parse(request.feature), { gzip: 'true' }); assert.equal(decoded.data.item.fields.skuId, 987)
  assert(!decoded.data.extra); assert.equal(decoded.linkage.common.submitParams, 'opaque-submit'); assert(!('queryParams' in decoded.linkage.common))
})

test('Hema cashier handoffs reject foreign hosts, credentials, cleartext and custom schemes', () => {
  const valid = 'https://mclient.alipay.com/cashier/mobilepay.htm?synthetic=1'
  assert.equal(hemaPaymentDestination(valid), valid)
  for (const value of [undefined, 'https://evil.test/cashier/a', 'https://mclient.alipay.com.evil.test/cashier/a',
    'http://mclient.alipay.com/cashier/a', 'https://user:secret@mclient.alipay.com/cashier/a', 'alipays://platformapi/startapp', 'https://mclient.alipay.com:444/cashier/a']) assert.equal(hemaPaymentDestination(value), null)
})

test('Hema create diagnostics retain business code punctuation while withholding remote messages', async () => {
  assert.equal(hemaReturnCode('RGV587_ERROR::private-challenge-url'), 'RGV587_ERROR')
  const f = await fixture(), original = f.trade.login.mtop
  f.trade.login.mtop = async (spec, ...args) => spec.api === 'mtop.trade.order.create'
    ? { ret: ['FAIL_BIZ_-123.invalid::private-phone-and-payment-url'], data: {} }
    : original(spec, ...args)
  try {
    const quote = await f.trade.checkout(f.args)
    await assert.rejects(f.trade.submit({ quoteRef: quote.quoteRef, confirmed: true, confirmedCents: 5290, manualConfirmation: true }), /下单结果未确认/)
    assert.deepEqual(f.events.find(event => event.stage === 'hema-create-reply').ret, ['FAIL_BIZ_-123.invalid'])
    assert(!JSON.stringify(f.events).includes('private-phone-and-payment-url'))
    const journal = JSON.parse(await readFile(join(f.directory, 'trade-attempts.json'), 'utf8'))
    assert.equal(journal.attempts[0].status, 'unknown')
  } finally { await f.close() }
})

test('Hema submission reserves once and returns created IDs without persisting cashier credentials', async () => {
  const f = await fixture()
  try {
    const quote = await f.trade.checkout(f.args), result = await f.trade.submit({ quoteRef: quote.quoteRef, confirmed: true, confirmedCents: 5290, manualConfirmation: true })
    assert.deepEqual(result.orderIds, ['10001']); assert.equal(result.paymentStatus, 'unconfirmed'); assert.equal(result.paymentUrl, null)
    await assert.rejects(f.trade.submit({ quoteRef: quote.quoteRef, confirmed: true, confirmedCents: 5290, manualConfirmation: true }), error => error.code === 'quote-expired')
    assert.equal(f.calls.filter(row => row.api === 'mtop.trade.order.create').length, 1)
    const journal = await readFile(join(f.directory, 'trade-attempts.json'), 'utf8'); assert(!journal.includes('private-must-not-persist')); assert.equal(JSON.parse(journal).attempts[0].status, 'created')
    assert.equal((await f.trade.tradeHistory()).platformId, 'hema')
  } finally { await f.close() }
})

test('Hema lost create response reserves amount and blocks retry even after a new quote', async () => {
  const f = await fixture()
  try {
    const quote = await f.trade.checkout(f.args); f.change({ failCreate: true })
    await assert.rejects(f.trade.submit({ quoteRef: quote.quoteRef, confirmed: true, confirmedCents: 5290, manualConfirmation: true }), error => error.code === 'order-unknown')
    const next = await f.trade.checkout(f.args)
    await assert.rejects(f.trade.submit({ quoteRef: next.quoteRef, confirmed: true, confirmedCents: 5290, manualConfirmation: true }), error => error.code === 'order-duplicate')
    assert.equal(f.calls.filter(row => row.api === 'mtop.trade.order.create').length, 1); assert.equal((await f.trade.journal()).attempts[0].status, 'unknown')
  } finally { await f.close() }
})

test('Hema amount, preview, cart, identity, expiry and configured cap stop before creating orders', async () => {
  for (const scenario of ['amount', 'preview', 'cart', 'identity', 'expiry', 'cap', 'budget']) {
    const f = await fixture(scenario === 'cap' ? { cap: 35 } : scenario === 'budget' ? { budget: 50 } : {})
    try {
      const quote = await f.trade.checkout(f.args)
      if (scenario === 'cart') f.change({ revision: 'c'.repeat(64) })
      if (scenario === 'identity') f.change({ identity: '666' })
      if (scenario === 'expiry') f.change({ expire: true })
      await assert.rejects(f.trade.submit({ quoteRef: quote.quoteRef, confirmed: true, confirmedCents: scenario === 'amount' ? 1 : 5290, manualConfirmation: scenario !== 'preview' }))
      assert.equal(f.calls.filter(row => row.api === 'mtop.trade.order.create').length, 0)
    } finally { await f.close() }
  }
})
