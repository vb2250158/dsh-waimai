import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TaobaoCashier, cashierQuote, cashierParameters, cashierResult, providerPaymentUrl, providerPaymentDestination, retailPaymentStatus, paymentHandoffUrl, cashierPaymentStatus, paymentResponseDiagnostic } from '../lib/cashier.js'

const orderRef = '11111111-1111-4111-8111-111111111111'
const envelope = value => ({ succeeded: true, result: JSON.stringify([value]) })
const quote = () => ({ cashierOrderNo: 'V2_synthetic', payAmount: 300, payCurrency: 'CNY', timeoutSeconds: 300,
  payOptionInfos: [{ payOptionCode: 'ALIPAY_BATCH_ESCROW_WAP', payOptionName: '支付宝', available: true, selected: true }],
  payToolPayVOList: JSON.stringify([{ payOptionCode: 'ALIPAY_BATCH_ESCROW_WAP', payActualAmount: 300, payActualAmountCurrency: 'CNY', extAttrMap: { privateToken: 'secret' } }]) })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-cashier-')), calls = [], logs = []
  const order = { ref: orderRef, accountId: 'owner', status: 'created', orderIds: ['123'], amountCents: 300, merchant: '示例店',
    paymentUrl: 'https://r.ele.me/payment?checkoutOrderNos=private-order&returnUrl=https%3A%2F%2Fh5.ele.me%2F&payEntrance=TAOBAO_APPLET' }
  const control = { now: 1000, accountId: 'owner', status: '待支付', amount: '3.00', quote: quote(), transportFailure: false,
    query: { value: { batchStatus: 'U' } }, queryFailure: false,
    retailConsult: { data: { cashierUrl: 'https://r.ele.me/payment?termNos=synthetic' } },
    submit: { payResult: 'UNKNOWN', payAction: 'H5_URL', targetUrl: 'https://mclient.alipay.com/cashier?private=secret' } }
  let chain = Promise.resolve()
  const login = { get accountId() { return control.accountId }, async requireAccount() {},
    protocol: { orders: { api: 'orders', client: {} }, cashier: { consult: { api: 'consult' }, submit: { api: 'submit' }, status: { api: 'status' }, retailConsult: { api: 'retailConsult' } } },
    diagnostic: value => logs.push(value),
    run(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p },
    async mtop(spec, data, retry) {
      calls.push({ api: spec.api, data, retry })
      if (spec.api === 'orders') return { ret: ['SUCCESS::ok'], data: { result: { orderList: [{ orderId: '123', orderAmount: control.amount,
        storeName: '示例店', orderStatusBar: { title: control.status } }] } } }
      if (spec.api === 'submit' && control.transportFailure) throw new Error('private transport url')
      if (spec.api === 'retailConsult') return { ret: ['SUCCESS::ok'], data: control.retailConsult }
      if (spec.api === 'status') {
        if (control.queryFailure) throw new Error('private query token')
        return { ret: ['SUCCESS::ok'], data: control.query }
      }
      return { ret: ['SUCCESS::ok'], data: envelope(spec.api === 'consult' ? control.quote : control.submit) }
    } }
  const trade = { login, journalPath: join(directory, 'trade-attempts.json'), async journal() { return { attempts: [order] } },
    quoteSeconds: 120, capCents: 1000, now: () => control.now, service: { checkReply(raw) { assert(raw.ret[0].startsWith('SUCCESS::')) } } }
  const cashier = new TaobaoCashier(trade)
  const pay = prepared => cashier.submit({ orderRef, paymentRef: prepared.paymentRef, confirmed: true, confirmedCents: 300, maxAmountCents: 1000 })
  return { cashier, trade, order, control, calls, logs, pay, dispose: () => rm(directory, { recursive: true, force: true }) }
}

test('cashier quote validates final cents and projects no private provider parameters', () => {
  const result = cashierQuote(envelope(quote()), 300)
  assert.equal(result.display.amountCents, 300)
  assert(!JSON.stringify(result.display).includes('secret'))
  for (const change of [q => q.payAmount++, q => q.payCurrency = 'USD', q => q.timeoutSeconds = 0,
    q => q.payOptionInfos[0].payOptionCode = 'CREDIT_PAY', q => q.payOptionInfos[0].available = false,
    q => q.payToolPayVOList = '[]']) { const q = quote(); change(q); assert.throws(() => cashierQuote(envelope(q), 300)) }
  assert.throws(() => cashierResult({ succeeded: false, result: '[{}]' }))
  assert.throws(() => cashierResult({ succeeded: true, result: '[{},{}]' }))
})

test('cashier browser parameters require a single official checkout reference', () => {
  assert.equal(cashierParameters('https://r.ele.me/payment?checkoutOrderNos=123&payEntrance=TAOBAO_APPLET').payEntrance, 'WAP')
  for (const value of ['https://r.ele.me/payment', 'https://r.ele.me/payment?termNos=1&termNos=2',
    'https://r.ele.me/payment?termNos=1&mtopType=TANWAI', 'https://attacker.test/?termNos=1']) assert.throws(() => cashierParameters(value))
  assert.equal(providerPaymentUrl('https://mclient.alipay.com/cashier?synthetic=1'), 'https://mclient.alipay.com/cashier?synthetic=1')
  for (const value of ['https://mclient.alipay.com.attacker.test/', 'https://u:p@mclient.alipay.com/', 'alipays://start', 'sdk-secret']) assert.equal(providerPaymentUrl(value), null)
})

test('payment preparation does not charge and one submit persists before sending without retry', async () => {
  const f = await fixture()
  try {
    const prepared = await f.cashier.prepare({ orderRef })
    assert(!f.calls.some(c => c.api === 'submit'))
    assert(!JSON.stringify(prepared).includes('private'))
    const result = await f.pay(prepared)
    assert.equal(result.paymentStatus, 'requires-verification')
    assert(!JSON.stringify(result).includes('secret'))
    assert.equal(f.calls.filter(c => c.api === 'submit').length, 1)
    assert.equal(f.calls.find(c => c.api === 'submit').retry, false)
    assert.equal((await f.cashier.ledger()).attempts[0].state, 'requires-verification')
    assert(!JSON.stringify(await f.cashier.ledger()).includes('secret'))
    assert(!JSON.stringify(f.logs).includes('secret'))
    const history = await f.cashier.history([f.order])
    assert.equal(history.get(orderRef).paymentUrl, 'https://mclient.alipay.com/cashier?private=secret')
    await assert.rejects(f.pay(prepared))
    await assert.rejects(f.cashier.prepare({ orderRef }), e => e.code === 'payment-already-attempted')
    assert.equal(f.calls.filter(c => c.api === 'submit').length, 1)
  } finally { await f.dispose() }
})

test('transport ambiguity remains reserved after restart and cannot initiate another payment', async () => {
  const f = await fixture()
  try {
    const prepared = await f.cashier.prepare({ orderRef }); f.control.transportFailure = true
    await assert.rejects(f.pay(prepared), e => e.code === 'payment-unknown' && !e.message.includes('private'))
    assert.equal((await f.cashier.ledger()).attempts[0].state, 'unknown')
    const restarted = new TaobaoCashier(f.trade)
    await assert.rejects(restarted.prepare({ orderRef }), e => e.code === 'payment-already-attempted')
    assert.equal(f.calls.filter(c => c.api === 'submit').length, 1)
  } finally { await f.dispose() }
})

test('changed account, paid order, changed amount and expired reference stop before charging', async () => {
  for (const mutate of [f => f.control.accountId = 'other', f => f.control.status = '商家已接单',
    f => f.control.amount = '4.00', f => f.control.now = 122000, f => f.control.quote.payAmount = 400]) {
    const f = await fixture()
    try { const prepared = await f.cashier.prepare({ orderRef }); mutate(f); await assert.rejects(f.pay(prepared)); assert(!f.calls.some(c => c.api === 'submit')) }
    finally { await f.dispose() }
  }
})

test('budget and confirmation must match the current order; corrupt ledger is not reset', async () => {
  const f = await fixture()
  try {
    const prepared = await f.cashier.prepare({ orderRef })
    for (const extra of [{ maxAmountCents: 299 }, { confirmedCents: 299 }, { confirmed: false }]) {
      await assert.rejects(f.cashier.submit({ orderRef, paymentRef: prepared.paymentRef, confirmed: true, confirmedCents: 300, maxAmountCents: 1000, ...extra }))
    }
    await writeFile(f.cashier.path, '{broken')
    await assert.rejects(f.pay(prepared), e => e.code === 'payment-ledger-invalid')
    assert.equal(await readFile(f.cashier.path, 'utf8'), '{broken')
    assert(!f.calls.some(c => c.api === 'submit'))
  } finally { await f.dispose() }
})

test('payment outcome distinguishes official success, decline and verification', async () => {
  for (const [payResult, state] of [['SUCCESS', 'paid'], ['FAIL', 'failed'], ['UNKNOWN', 'requires-verification']]) {
    const f = await fixture()
    try { f.control.submit.payResult = payResult; const result = await f.pay(await f.cashier.prepare({ orderRef })); assert.equal(result.paymentStatus, state) }
    finally { await f.dispose() }
  }
})

test('concurrent confirmations produce one payment submission', async () => {
  const f = await fixture()
  try {
    const prepared = await f.cashier.prepare({ orderRef })
    const results = await Promise.allSettled([f.pay(prepared), f.pay(prepared)])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(f.calls.filter(c => c.api === 'submit').length, 1)
  } finally { await f.dispose() }
})

test('official paid timestamp remains distinct from cancellation and must match the owned order amount', () => {
  const raw = { orderId: '123', eleUserId: 'owner', payTime: 1793008600000, paidAmountActual: 3,
    statusText: '等待商家处理取消申请', statusCode: '100006' }
  const order = { orderIds: ['123'], accountId: 'owner', amountCents: 300 }
  assert.deepEqual(retailPaymentStatus(raw, order), { paymentStatus: 'paid', paidAt: 1793008600000,
    officialStatus: '等待商家处理取消申请', officialStatusCode: '100006' })
  for (const extra of [{ orderId: '456' }, { eleUserId: 'other' }, { paidAmountActual: 4 }]) assert.throws(() => retailPaymentStatus({ ...raw, ...extra }, order))
  assert.equal(retailPaymentStatus({ ...raw, payTime: 0 }, order).paymentStatus, 'unconfirmed')
  const { payTime, ...unpaid } = raw
  assert.deepEqual(retailPaymentStatus({ ...unpaid, statusText: '在线支付', statusCode: '100001' }, order),
    { paymentStatus: 'unconfirmed', paidAt: null, officialStatus: '在线支付', officialStatusCode: '100001' })
})

test('third-party verification unwraps the official envelope and rejects unsafe destinations', async () => {
  const f = await fixture()
  try {
    f.control.submit = { payResult: 'UNKNOWN', extraMap: { payAction: 'THIRD_PAY' },
      targetUrl: JSON.stringify({ targetUrl: 'https://mclient.alipay.com/cashier?private=secret' }) }
    assert.equal((await f.pay(await f.cashier.prepare({ orderRef }))).paymentStatus, 'requires-verification')
    assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentUrl, 'https://mclient.alipay.com/cashier?private=secret')
    for (const targetUrl of ['broken', JSON.stringify({ targetUrl: 'https://attacker.test/' }), '{}']) {
      assert.equal(paymentHandoffUrl({ ...f.control.submit, targetUrl }), null)
    }
    assert(!JSON.stringify(await f.cashier.ledger()).includes('secret'))
  } finally { await f.dispose() }
})

test('malformed verification links remain unknown instead of presenting an unusable verification step', async () => {
  const f = await fixture()
  try {
    f.control.submit.targetUrl = 'https://attacker.test/'
    assert.equal((await f.pay(await f.cashier.prepare({ orderRef }))).paymentStatus, 'unknown')
    assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentUrl, null)
    assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentHandoffAvailable, false)
    assert.deepEqual(f.logs.find(value => value.stage === 'payment-response'), { group: 'waimai-order', attemptId: (await f.cashier.ledger()).attempts[0].ref,
      stage: 'payment-response', payResult: 'UNKNOWN', payAction: 'H5_URL', handoffAccepted: false,
      handoffRejected: true, handoffReason: 'unapproved-destination', destinationReason: 'unrecognized-host' })
  } finally { await f.dispose() }
})

test('restaurant verification queries the official payment result and persists success across restart', async () => {
  const f = await fixture()
  try {
    f.control.submit.extraMap = { payAction: 'H5_URL', cashierOrderNo: 'V2_synthetic', requestId: 'private-query-reference' }
    await f.pay(await f.cashier.prepare({ orderRef }))
    f.control.query.value.batchStatus = 'S'
    f.control.status = '商家已接单'
    const status = await f.cashier.status({ orderRef })
    assert.equal(status.paymentStatus, 'paid')
    assert.equal(f.calls.filter(call => call.api === 'status').length, 1)
    assert.deepEqual(f.calls.find(call => call.api === 'status').data, f.control.submit.extraMap)
    assert.equal((await f.cashier.ledger()).attempts[0].state, 'paid')
    assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentUrl, null)
    assert.equal((await new TaobaoCashier(f.trade).status({ orderRef })).paymentStatus, 'paid')
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
    for (const output of [status, await f.cashier.ledger(), f.logs]) assert(!JSON.stringify(output).includes('private-query-reference'))
  } finally { await f.dispose() }
})

test('pending, failed and unavailable official payment queries do not charge again or infer payment from order text', async () => {
  for (const mode of ['unknown', 'failed', 'transport', 'invalid']) {
    const f = await fixture()
    try {
      f.control.submit = { payResult: 'UNKNOWN', extraMap: { payAction: 'NEED_QUERY', cashierOrderNo: 'V2_synthetic' } }
      await f.pay(await f.cashier.prepare({ orderRef }))
      f.control.status = '订单已完成'
      if (mode === 'failed') f.control.query.value.batchStatus = 'F'
      if (mode === 'transport') f.control.queryFailure = true
      if (mode === 'invalid') f.control.query = {}
      assert.equal((await f.cashier.status({ orderRef })).paymentStatus, mode === 'failed' ? 'failed' : 'unknown')
      assert.equal((await f.cashier.ledger()).attempts[0].state, mode === 'failed' ? 'failed' : 'unknown')
      assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
      assert(!JSON.stringify(f.logs).includes('private'))
    } finally { await f.dispose() }
  }
  assert.equal(cashierPaymentStatus({ value: { batchStatus: 'S' } }), 'paid')
  assert.throws(() => cashierPaymentStatus({ value: { batchStatus: 'SUCCESS' } }), error => error.code === 'payment-status-invalid')
})

test('a mismatched cashier query reference is never used to settle the owned order', async () => {
  const f = await fixture()
  try {
    f.control.submit.extraMap = { cashierOrderNo: 'different-cashier' }
    await f.pay(await f.cashier.prepare({ orderRef }))
    f.control.query.value.batchStatus = 'S'
    assert.equal((await f.cashier.status({ orderRef })).paymentStatus, 'requires-verification')
    assert(!f.calls.some(call => call.api === 'status'))
  } finally { await f.dispose() }
})

test('retail payment preparation supplies the official browser context without inventing device identity', async () => {
  const f = await fixture()
  try {
    delete f.order.paymentUrl
    assert.equal((await f.cashier.prepare({ orderRef })).paymentStatus, 'unpaid')
    const request = f.calls.find(call => call.api === 'retailConsult').data
    assert.equal(request.containerType, 'web')
    assert.deepEqual(JSON.parse(request.riskInfo), { source: 'WAP' })
    assert.equal(request.orderId, f.order.orderIds[0])
    assert(!f.calls.some(call => call.api === 'submit'))
    const protocol = JSON.parse(await readFile(new URL('../lib/login-protocol.json', import.meta.url), 'utf8'))
    assert.equal(new URL(protocol.cashier.retailConsult.url).host, 'alsc-buy2.ele.me')
  } finally { await f.dispose() }
})

test('payment diagnostics contain only fixed action and handoff classifications', () => {
  const cases = [
    [{ payResult: 'UNKNOWN', payAction: 'NEED_QUERY', extraMap: { privateToken: 'secret' } }, 'query-only'],
    [{ payResult: 'UNKNOWN', payAction: 'H5_URL', targetUrl: 'https://mclient.alipay.com/?secret=private' }, 'browser-url'],
    [{ payResult: 'UNKNOWN', payAction: 'THIRD_PAY', targetUrl: '{private' }, 'invalid-third-party-payload'],
    [{ payResult: 'UNKNOWN', payAction: 'THIRD_PAY', targetUrl: JSON.stringify({ targetUrl: 'https://attacker.test/?secret=private' }) }, 'unapproved-destination'],
    [{ payResult: 'UNKNOWN', payAction: 'ALIPAY_SDK', targetUrl: 'private-sdk-secret' }, 'native-sdk-unavailable'],
    [{ payResult: 'UNKNOWN', payAction: 'H5_URL' }, 'missing-target'],
    [{ payResult: 'UNKNOWN', payAction: 'private-action-secret', targetUrl: 'private-target' }, 'unsupported-action'],
    [{ payResult: 'private-result-secret' }, 'unrecognized-result'],
  ]
  for (const [result, reason] of cases) {
    const diagnostic = paymentResponseDiagnostic(result)
    assert.equal(diagnostic.handoffReason, reason)
    for (const privateValue of ['private', 'secret', 'https:', 'attacker']) assert(!JSON.stringify(diagnostic).includes(privateValue))
  }
})

test('official WAP gateways preserve signed parameters and reject unrelated paths and destinations', async () => {
  for (const host of ['mapi.alipay.com', 'openapi.alipay.com']) {
    const f = await fixture()
    try {
      const targetUrl = `https://${host}/gateway.do?sign=synthetic%2Bsignature&return_url=https%3A%2F%2Fexample.test%2Fdone`
      f.control.submit = { payResult: 'UNKNOWN', extraMap: { payAction: 'H5_URL' }, targetUrl }
      assert.equal(providerPaymentUrl(targetUrl), targetUrl)
      assert.equal((await f.pay(await f.cashier.prepare({ orderRef }))).paymentStatus, 'requires-verification')
      assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentUrl, targetUrl)
      assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
      assert.equal(f.logs.find(value => value.stage === 'payment-response').destinationReason, 'alipay-gateway')
      for (const value of [await f.cashier.ledger(), f.logs]) assert(!JSON.stringify(value).includes('synthetic%2Bsignature'))
    } finally { await f.dispose() }
  }
  for (const [target, reason] of [
    ['http://mapi.alipay.com/gateway.do', 'unsupported-scheme'],
    ['https://openapi.alipay.com/redirect', 'unsupported-gateway-path'],
    ['https://mapi.alipay.com/gateway.do/anything', 'unsupported-gateway-path'],
    ['https://openapi.alipay.com:444/gateway.do', 'unsupported-port'],
    ['https://u:p@mapi.alipay.com/gateway.do', 'embedded-credentials'],
    ['https://mapi.alipay.com.attacker.test/gateway.do?secret=private', 'unrecognized-host'],
    ['not-a-url-private', 'invalid-url'],
    [['https://openapi.alipay.com/gateway.do?synthetic=1'], 'invalid-url'],
    ['https://openapi.alipay.com/gateway.do?sign=synthetic\nvalue', 'invalid-url'],
    [' https://openapi.alipay.com/gateway.do?sign=synthetic', 'invalid-url'],
  ]) {
    assert.deepEqual(providerPaymentDestination(target), { reason, url: null })
    const diagnostic = paymentResponseDiagnostic({ payResult: 'UNKNOWN', payAction: 'H5_URL', targetUrl: target })
    assert.equal(diagnostic.destinationReason, reason)
    assert.equal(diagnostic.handoffAccepted, false)
    for (const secret of ['private', 'attacker', 'https:', 'u:p']) assert(!JSON.stringify(diagnostic).includes(secret))
  }
  const signed = 'https://openapi.alipay.com/gateway.do?sign=synthetic%2bvalue+%20&part=1&part=2'
  assert.equal(providerPaymentUrl(signed), signed)
  assert.equal(paymentHandoffUrl({ payAction: 'THIRD_PAY', targetUrl: JSON.stringify({ targetUrl: [signed] }) }), null)
})

test('native SDK requests stay unknown until a supported bridge can deliver the original verification', async () => {
  const f = await fixture()
  try {
    f.control.submit = { payResult: 'UNKNOWN', extraMap: { payAction: 'ALIPAY_SDK', cashierOrderNo: 'V2_synthetic' }, targetUrl: 'private-sdk-secret' }
    const result = await f.pay(await f.cashier.prepare({ orderRef }))
    assert.equal(result.paymentStatus, 'unknown')
    assert.equal(paymentResponseDiagnostic(f.control.submit).handoffAccepted, false)
    assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentHandoffAvailable, false)
    assert.equal((await f.cashier.status({ orderRef })).paymentQueryAvailable, true)
    await assert.rejects(f.cashier.prepare({ orderRef }), error => error.code === 'payment-already-attempted')
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
    assert(!JSON.stringify(await f.cashier.ledger()).includes('private-sdk-secret'))
  } finally { await f.dispose() }
})

test('a restarted verification attempt suppresses generic cashier links when its private handoff is gone', async () => {
  const f = await fixture()
  try {
    await f.pay(await f.cashier.prepare({ orderRef }))
    const before = (await f.cashier.history([f.order])).get(orderRef)
    assert.equal(before.paymentHandoffAvailable, true)
    const after = (await new TaobaoCashier(f.trade).history([f.order])).get(orderRef)
    assert.deepEqual(after, { paymentStatus: 'requires-verification', paymentUrl: null, paymentHandoffAvailable: false })
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
  } finally { await f.dispose() }
})

test('restart loses pending payment query parameters without interpreting order cancellation as payment failure', async () => {
  const f = await fixture()
  try {
    f.control.submit = { payResult: 'UNKNOWN', extraMap: { payAction: 'NEED_QUERY', cashierOrderNo: 'V2_synthetic', requestId: 'private-query-reference' } }
    await f.pay(await f.cashier.prepare({ orderRef }))
    assert.equal((await f.cashier.status({ orderRef })).paymentQueryAvailable, true)
    f.control.status = '已取消'
    const status = await new TaobaoCashier(f.trade).status({ orderRef })
    assert.equal(status.paymentStatus, 'unknown')
    assert.equal(status.paymentQueryAvailable, false)
    assert.equal(status.officialOrders[0].status, '已取消')
    assert.equal(f.calls.filter(call => call.api === 'status').length, 1)
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
    assert(!JSON.stringify(await f.cashier.ledger()).includes('private-query-reference'))
  } finally { await f.dispose() }
})
