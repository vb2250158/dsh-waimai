import { test } from 'node:test'
import { paymentSessionUuid } from '../lib/alipay-agent.js'
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
  const order = { ref: orderRef, accountId: 'owner', status: 'created', orderIds: ['123'], amountCents: 300, merchant: '示例店', itemSummary: '示例商品 ×1',
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

test('private H5 continuation uses the original order and reserves before one backend payment', async () => {
  const f = await fixture(), httpCalls = []
  f.control.submit.targetUrl = 'https://maliprod.alipay.com/h5pay/index.html?contextId=synthetic-private-context'
  f.cashier.agentPayments = { prepare: async () => assert.fail('H5 must not invoke CLI'), submit: async () => assert.fail('H5 must not invoke CLI') }
  f.trade.login.timeoutMs = 1000
  let disposed = false
  f.trade.login.createContext = async () => ({
    async get(url, options) {
      assert.equal(url, f.control.submit.targetUrl); assert.equal(options.maxRedirects, 0)
      return { status: () => 200, ok: () => true, text: async () => '<html></html>', dispose: async () => {} }
    },
    async post(url, options) {
      httpCalls.push({ url, options })
      if (url.endsWith('cashierPay.json')) {
        const record = (await f.cashier.ledger()).attempts[0]
        assert.equal(record.h5Submitted, true); assert.equal(record.state, 'unknown')
        return { ok: () => true, json: async () => ({ success: true, data: { controlType: 'pay_success' } }), dispose: async () => {} }
      }
      return { ok: () => true, json: async () => ({ success: true, data: { controlType: 'cashier_pre_confirm',
        bizData: { orderAmount: '3.00', npwdPay: true } } }), dispose: async () => {} }
    }, dispose: async () => { disposed = true },
  })
  const args = { orderRef, confirmed: true, confirmedCents: 300, maxAmountCents: 1000, cookies: [], environment: { device: { userAgent: 'synthetic' } } }
  try {
    const started = await f.cashier.h5Start(args)
    assert.equal(started.state, 'ready')
    f.cashier.h5Sessions.get(orderRef).envData = 'synthetic-private-environment'
    const ready = await f.cashier.prepare({ orderRef })
    assert.equal(ready.state, 'h5-ready')
    const result = await f.pay(ready)
    assert.equal(result.state, 'requires-reconciliation')
    assert.equal(result.paymentStatus, 'unknown')
    assert.equal(httpCalls[1].options.data.envData, 'synthetic-private-environment')
    assert.equal((await f.cashier.ledger()).attempts[0].state, 'unknown')
    await assert.rejects(f.cashier.h5Submit({ ...args, h5Ref: started.h5Ref }), { code: 'payment-already-attempted' })
    await assert.rejects(f.cashier.h5Start(args), { code: 'h5-session-unavailable' })
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
    assert.equal(httpCalls.filter(call => call.url.endsWith('cashierPay.json')).length, 1)
    assert.ok(!JSON.stringify({ started, result, logs: f.logs, ledger: await f.cashier.ledger() }).includes('synthetic-private'))
    await f.cashier.close(); assert.equal(disposed, true)
  } finally { await f.dispose() }
})

test('H5 rejects canceled orders, stale references and changed budgets before backend payment', async () => {
  const f = await fixture()
  const args = { orderRef, h5Ref: '11111111-1111-4111-8111-111111111111', confirmed: true, confirmedCents: 300, maxAmountCents: 1000 }
  const client = { submit: async () => assert.fail('must not send payment') }
  try {
    await assert.rejects(f.cashier.h5Submit(args), { code: 'h5-session-expired' })
    f.cashier.h5Sessions.set(orderRef, { ref: args.h5Ref, accountId: 'owner', client })
    await assert.rejects(f.cashier.h5Submit({ ...args, confirmedCents: 301 }), { code: 'payment-amount-unconfirmed' })
    await assert.rejects(f.cashier.h5Submit({ ...args, maxAmountCents: 299 }), { code: 'payment-amount-unconfirmed' })
    f.control.status = '订单已取消'
    await assert.rejects(f.cashier.h5Submit(args), { code: 'payment-not-pending' })
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 0)
  } finally { await f.dispose() }
})

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

test('official Agent Pay uses Host identity and keeps verification material out of model results and logs', async () => {
  const f = await fixture(), calls = []
  const sessionId = 'session-008283f7-fee1-4219-be64-06cf151e20b3'
  const queryRef = '20260617008282174448790088372682'
  const shortUrl = 'https://u.alipay.com/synthetic-private-verification'
  f.control.submit.targetUrl = 'https://maliprod.alipay.com/?signed=synthetic-private-material'
  f.control.submit.extraMap = { cashierOrderNo: 'V2_synthetic' }
  f.cashier.agentPayments = {
    prepare: async id => paymentSessionUuid(id),
    submit: async args => {
      calls.push(args)
      assert.equal((await f.cashier.ledger()).attempts[0].state, 'unknown')
      return { completed: true, receipt: { code: 200, shortUrl, outShakeNo: queryRef } }
    },
    query: async ref => { assert.equal(ref, queryRef); return { completed: true, receipt: { code: 200, message: '支付成功' } } },
  }
  try {
    const prepared = await f.cashier.prepare({ orderRef })
    const args = { orderRef, paymentRef: prepared.paymentRef, confirmed: true, confirmedCents: 300, maxAmountCents: 1000, paymentSessionId: sessionId }
    const result = await f.cashier.submit(args)
    assert.equal(result.paymentStatus, 'requires-verification')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].paymentLink, f.control.submit.targetUrl)
    assert.equal(calls[0].sessionId, sessionId.slice(8))
    assert.equal(calls[0].serviceContent, f.order.itemSummary)
    assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentUrl, shortUrl)
    assert.equal((await f.cashier.providerReceipt({ orderRef })).submit.receipt.outShakeNo, queryRef)
    for (const privateValue of [shortUrl, queryRef, 'synthetic-private-material', sessionId.slice(8)]) {
      assert(!JSON.stringify({ result, logs: f.logs }).includes(privateValue))
    }
    await assert.rejects(f.cashier.submit(args))
    assert.equal(calls.length, 1)
    assert.equal((await f.cashier.status({ orderRef })).paymentStatus, 'requires-verification')
    f.control.query = { value: { batchStatus: 'S' } }
    assert.equal((await f.cashier.status({ orderRef })).paymentStatus, 'paid')
  } finally { await f.dispose() }
})

test('missing Host identity stops configured Agent Pay before creating any payment attempt', async () => {
  const f = await fixture()
  f.cashier.agentPayments = { prepare: async id => paymentSessionUuid(id), submit: async () => assert.fail('must not submit') }
  try {
    const prepared = await f.cashier.prepare({ orderRef })
    await assert.rejects(f.pay(prepared), { code: 'payment-session-missing' })
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 0)
    assert.deepEqual((await f.cashier.ledger()).attempts, [])
  } finally { await f.dispose() }
})

test('legacy orders without confirmed item summaries cannot initiate Agent Pay', async () => {
  const f = await fixture()
  delete f.order.itemSummary
  f.cashier.agentPayments = { prepare: async () => assert.fail('must not prepare'), submit: async () => assert.fail('must not submit') }
  try {
    await assert.rejects(f.pay(await f.cashier.prepare({ orderRef })), { code: 'payment-summary-missing' })
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 0)
    assert.deepEqual((await f.cashier.ledger()).attempts, [])
  } finally { await f.dispose() }
})

test('an Alipay query failure does not prevent reconciliation through the original cashier', async () => {
  const f = await fixture(), shortUrl = 'https://u.alipay.com/synthetic-current'
  f.control.submit.extraMap = { cashierOrderNo: 'V2_synthetic' }
  f.cashier.agentPayments = { prepare: async () => '008283f7-fee1-4219-be64-06cf151e20b3',
    submit: async () => ({ completed: true, receipt: { code: 200, shortUrl } }),
    queryLink: async link => { assert.equal(link, shortUrl); throw new Error('private-provider-error') } }
  try {
    await f.pay(await f.cashier.prepare({ orderRef }))
    f.control.query = { value: { batchStatus: 'S' } }
    assert.equal((await f.cashier.status({ orderRef })).paymentStatus, 'paid')
    assert(!JSON.stringify(f.logs).includes('private-provider-error'))
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
  } finally { await f.dispose() }
})

test('CLI transport success without a supported receipt remains unknown and cannot fall back to another payment', async () => {
  const f = await fixture()
  f.cashier.agentPayments = { prepare: async () => '008283f7-fee1-4219-be64-06cf151e20b3',
    submit: async () => ({ completed: true, receipt: { code: 200, message: '支付成功' } }) }
  try {
    const result = await f.pay(await f.cashier.prepare({ orderRef }))
    assert.equal(result.paymentStatus, 'unknown')
    assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentUrl, null)
    await assert.rejects(f.cashier.prepare({ orderRef }), { code: 'payment-already-attempted' })
  } finally { await f.dispose() }
})

test('unstructured process failures stay private while logs retain execution diagnostics', async () => {
  const f = await fixture()
  const response = { completed: false, receipt: null,
    execution: { reason: 'nonzero-exit', exitCode: 1, stdoutBytes: 0, stderrBytes: 24 },
    output: { stdout: '', stderr: 'synthetic-private-output' } }
  f.cashier.agentPayments = { prepare: async () => '008283f7-fee1-4219-be64-06cf151e20b3', submit: async () => response }
  try {
    const result = await f.pay(await f.cashier.prepare({ orderRef }))
    assert.equal(result.paymentStatus, 'unknown')
    assert.deepEqual((await f.cashier.providerReceipt({ orderRef })).submit, response)
    const log = f.logs.find(value => value.stage === 'agent-payment-response')
    assert.equal(log.executionReason, 'nonzero-exit')
    assert.equal(log.exitCode, 1)
    assert.equal(log.stderrBytes, 24)
    for (const value of [result, f.logs, await f.cashier.ledger()]) assert(!JSON.stringify(value).includes('synthetic-private-output'))
    await assert.rejects(f.cashier.prepare({ orderRef }), { code: 'payment-already-attempted' })
  } finally { await f.dispose() }
})

test('a rejected CLI link retains the original cashier without retrying or using it as an Agent Pay query', async () => {
  const f = await fixture()
  f.control.submit.targetUrl = 'https://maliprod.alipay.com/?signed=synthetic-private-material'
  f.cashier.agentPayments = { prepare: async () => '008283f7-fee1-4219-be64-06cf151e20b3',
    queryLink: async () => assert.fail('original cashier is not an Agent Pay query link'),
    submit: async () => ({ completed: false, receipt: { command: 'submit-payment', schemaVersion: '1.0',
      success: false, errorCode: 'PAYMENT_LINK_UNSUPPORTED', errorMsg: 'private provider details' } }) }
  try {
    const result = await f.pay(await f.cashier.prepare({ orderRef }))
    assert.equal(result.paymentStatus, 'requires-verification')
    assert.equal(result.providerErrorCode, 'PAYMENT_LINK_UNSUPPORTED')
    assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentUrl, f.control.submit.targetUrl)
    assert.equal((await f.cashier.ledger()).attempts[0].provider, undefined)
    const status = await f.cashier.status({ orderRef })
    assert.equal(status.providerErrorCode, 'PAYMENT_LINK_UNSUPPORTED')
    assert.equal(status.paymentStatus, 'requires-verification')
    assert.equal(status.paymentQueryAvailable, false)
    assert(!JSON.stringify({result,status,logs:f.logs}).includes('private provider details'))
    assert(!JSON.stringify({result,status,logs:f.logs,ledger:await f.cashier.ledger()}).includes('synthetic-private-material'))
    await assert.rejects(f.cashier.prepare({ orderRef }), { code: 'payment-already-attempted' })
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
    const restarted = new TaobaoCashier(f.trade)
    assert.equal((await restarted.history([f.order])).get(orderRef).paymentHandoffAvailable, false)
    await assert.rejects(restarted.prepare({ orderRef }), { code: 'payment-already-attempted' })
  } finally { await f.dispose() }
})

test('an unsupported CLI result cannot expose an unapproved original destination', async () => {
  const f = await fixture()
  f.control.submit.targetUrl = 'https://attacker.test/?signed=synthetic-private-material'
  f.cashier.agentPayments = { prepare: async () => '008283f7-fee1-4219-be64-06cf151e20b3',
    submit: async () => ({ completed: false, receipt: { success: false, errorCode: 'PAYMENT_LINK_UNSUPPORTED' } }) }
  try {
    assert.equal((await f.pay(await f.cashier.prepare({ orderRef }))).paymentStatus, 'unknown')
    assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentUrl, null)
  } finally { await f.dispose() }
})

test('a provider query reference survives restart without persisting URLs or issuing another submit', async () => {
  const f = await fixture(), queryRef = '20260617008282174448790088372682', queries = []
  f.cashier.agentPayments = { prepare: async () => '008283f7-fee1-4219-be64-06cf151e20b3',
    submit: async () => ({ completed: true, receipt: { code: 200, outShakeNo: queryRef } }) }
  try {
    await f.pay(await f.cashier.prepare({ orderRef }))
    const restarted = new TaobaoCashier(f.trade)
    restarted.agentPayments = { query: async ref => { queries.push(ref); return { completed: true, receipt: { code: 200 } } } }
    const result = await restarted.status({ orderRef })
    assert.equal(result.paymentStatus, 'unknown')
    assert.equal(result.paymentQueryAvailable, true)
    assert.deepEqual(queries, [queryRef])
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 1)
    assert(!String(await readFile(restarted.path)).includes('https:'))
    await assert.rejects(restarted.prepare({ orderRef }), { code: 'payment-already-attempted' })
  } finally { await f.dispose() }
})

test('cashier browser parameters require a single official checkout reference', () => {
  assert.equal(cashierParameters('https://r.ele.me/payment?checkoutOrderNos=123&payEntrance=TAOBAO_APPLET').payEntrance, 'TAOBAO_APPLET')
  assert.equal(cashierParameters('https://r.ele.me/payment?termNos=123').payEntrance, 'WAP')
  for (const suffix of ['&payEntrance=', '&payEntrance=WAP&payEntrance=APP']) {
    assert.throws(() => cashierParameters('https://r.ele.me/payment?termNos=123' + suffix))
  }
  for (const value of ['https://r.ele.me/payment', 'https://r.ele.me/payment?termNos=1&termNos=2',
    'https://r.ele.me/payment?termNos=1&mtopType=TANWAI', 'https://attacker.test/?termNos=1']) assert.throws(() => cashierParameters(value))
  assert.equal(providerPaymentUrl('https://mclient.alipay.com/cashier?synthetic=1'), 'https://mclient.alipay.com/cashier?synthetic=1')
  assert.equal(providerPaymentUrl('https://maliprod.alipay.com/wap?synthetic=1'), 'https://maliprod.alipay.com/wap?synthetic=1')
  assert.equal(providerPaymentUrl('https://maliprod.alipay.com.attacker.test/'), null)
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
      handoffRejected: true, handoffReason: 'unapproved-destination', destinationReason: 'unrecognized-host',
      destinationProtocol: 'https', destinationHostname: 'attacker.test' })
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

test('payment diagnostics omit credentials, paths and parameters while identifying the destination host', () => {
  const cases = [
    [{ payResult: 'UNKNOWN', payAction: 'NEED_QUERY', extraMap: { privateToken: 'secret' } }, 'query-only'],
    [{ payResult: 'UNKNOWN', payAction: 'H5_URL', targetUrl: 'https://mclient.alipay.com/?secret=private' }, 'browser-url'],
    [{ payResult: 'UNKNOWN', payAction: 'THIRD_PAY', targetUrl: '{private' }, 'invalid-third-party-payload'],
    [{ payResult: 'UNKNOWN', payAction: 'THIRD_PAY', targetUrl: JSON.stringify({ targetUrl: 'https://attacker.test/?secret=private' }) }, 'unapproved-destination'],
    [{ payResult: 'UNKNOWN', payAction: 'ALIPAY_SDK', targetUrl: 'private-sdk-secret' }, 'native-sdk-material'],
    [{ payResult: 'UNKNOWN', payAction: 'H5_URL' }, 'missing-target'],
    [{ payResult: 'UNKNOWN', payAction: 'private-action-secret', targetUrl: 'private-target' }, 'unsupported-action'],
    [{ payResult: 'private-result-secret' }, 'unrecognized-result'],
  ]
  for (const [result, reason] of cases) {
    const diagnostic = paymentResponseDiagnostic(result)
    assert.equal(diagnostic.handoffReason, reason)
    for (const privateValue of ['private', 'secret', 'https:']) assert(!JSON.stringify(diagnostic).includes(privateValue))
  }
  const diagnostic = paymentResponseDiagnostic({ payResult: 'UNKNOWN', payAction: 'H5_URL', targetUrl: 'https://checkout.example.test/private-path?token=secret#private-fragment' })
  assert.equal(diagnostic.destinationHostname, 'checkout.example.test')
  assert.equal(diagnostic.destinationProtocol, 'https')
  for (const privateValue of ['private', 'secret', 'token', 'fragment']) assert(!JSON.stringify(diagnostic).includes(privateValue))
  assert.equal(paymentResponseDiagnostic({ payResult: 'UNKNOWN', payAction: 'H5_URL', targetUrl: 'https://secret:private@checkout.example.test/' }).destinationHostname, null)
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
    for (const secret of ['private', 'https:', 'u:p']) assert(!JSON.stringify(diagnostic).includes(secret))
  }
  const signed = 'https://openapi.alipay.com/gateway.do?sign=synthetic%2bvalue+%20&part=1&part=2'
  assert.equal(providerPaymentUrl(signed), signed)
  assert.equal(paymentHandoffUrl({ payAction: 'THIRD_PAY', targetUrl: JSON.stringify({ targetUrl: [signed] }) }), null)
})

test('SDK orders use the configured CLI once while preserving the official payment entrance', async () => {
  const f = await fixture(), calls = [], material = 'app_id=synthetic&sign=private-sdk%2Bsecret'
  f.control.submit = { payResult: 'UNKNOWN', payAction: 'ALIPAY_SDK', targetUrl: material,
    extraMap: { cashierOrderNo: 'V2_synthetic' } }
  f.cashier.agentPayments = { prepare: async () => '008283f7-fee1-4219-be64-06cf151e20b3',
    submit: async args => { calls.push(args); return { completed: true, receipt: { code: 200, message: '支付成功' } } } }
  try {
    const result = await f.pay(await f.cashier.prepare({ orderRef }))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].materialKind, 'sdk-order')
    assert.equal(calls[0].paymentLink, material)
    for (const call of f.calls.filter(call => ['consult', 'submit'].includes(call.api))) {
      assert.equal(call.data.payEntrance, 'TAOBAO_APPLET')
    }
    assert.equal(result.paymentStatus, 'unknown')
    assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentHandoffAvailable, false)
    assert(!JSON.stringify({ result, logs: f.logs, ledger: await f.cashier.ledger() }).includes(material))
    await assert.rejects(f.cashier.prepare({ orderRef }), { code: 'payment-already-attempted' })
    assert.equal(calls.length, 1)
    f.control.query = { value: { batchStatus: 'S' } }
    assert.equal((await f.cashier.status({ orderRef })).paymentStatus, 'paid')
  } finally { await f.dispose() }
})

test('rejected SDK material has no browser fallback and cannot trigger a second payment', async () => {
  const f = await fixture(), calls = []
  f.control.submit = { payResult: 'UNKNOWN', payAction: 'ALIPAY_SDK', targetUrl: 'private-sdk-secret' }
  f.cashier.agentPayments = { prepare: async () => '008283f7-fee1-4219-be64-06cf151e20b3',
    submit: async args => { calls.push(args); return { completed: false, receipt: {
      schemaVersion: '1.0', command: 'submit-payment', success: false, errorCode: 'PAYMENT_LINK_UNSUPPORTED' } } } }
  try {
    const result = await f.pay(await f.cashier.prepare({ orderRef }))
    assert.equal(result.paymentStatus, 'unknown')
    assert.equal(result.providerErrorCode, 'PAYMENT_LINK_UNSUPPORTED')
    assert.equal((await f.cashier.history([f.order])).get(orderRef).paymentHandoffAvailable, false)
    await assert.rejects(f.cashier.prepare({ orderRef }), { code: 'payment-already-attempted' })
    assert.equal(calls.length, 1)
  } finally { await f.dispose() }
})

test('native SDK requests stay unknown without a configured payment provider', async () => {
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


test('H5 connects verified browser state only to its owned pending order and retains no public credentials', async () => {
  const f = await fixture(), h5Ref = '22222222-2222-4222-8222-222222222222'
  let oldClosed = 0, browserClosed = 0, newClosed = 0
  const oldClient = { submitted: false, close: async () => { oldClosed++ } }
  const snapshot = { entryUrl: 'https://maliprod.alipay.com/h5pay/cashierPreConfirm/index.html?contextId=synthetic-private',
    storageState: { cookies: [], origins: [] }, environment: { device: { userAgent: 'verified-browser' } }, envData: 'synthetic-private-sdk' }
  const current = { ref: h5Ref, accountId: 'owner', client: oldClient, verification: {
    snapshot: async () => snapshot, close: async () => { browserClosed++ } } }
  f.cashier.h5Sessions.set(orderRef, current)
  f.trade.login.createContext = async options => {
    assert.equal(options.userAgent, 'verified-browser')
    return { post: async () => ({ ok: () => true, dispose: async () => {}, json: async () => ({ success: true,
      data: { controlType: 'cashier_pre_confirm', bizData: { orderAmount: f.control.amount, npwdPay: true } } }) }),
    storageState: async () => snapshot.storageState, dispose: async () => { newClosed++ } }
  }
  try {
    await assert.rejects(f.cashier.h5Authenticate({ orderRef, h5Ref: orderRef, operation: 'connect' }), { code: 'h5-session-expired' })
    const result = await f.cashier.h5Authenticate({ orderRef, h5Ref, operation: 'connect' })
    assert.equal(result.state, 'ready'); assert.equal(oldClosed, 1); assert.equal(browserClosed, 1)
    assert.equal(current.envData, 'synthetic-private-sdk')
    assert(!JSON.stringify({ result, logs: f.logs }).includes('synthetic-private'))
    assert.equal(f.calls.filter(call => call.api === 'submit').length, 0)
    await f.cashier.close(); assert.equal(newClosed, 1); assert.equal(f.cashier.h5Authentication, null)
  } finally { await f.dispose() }
})

test('H5 preview cannot create an intent or submit a payment', async () => {
  const f = await fixture(); f.trade.dryRun = true
  try {
    await assert.rejects(f.cashier.h5Start({ orderRef }), { code: 'preview-only' })
    assert.throws(() => f.cashier.h5Submit({ orderRef }), { code: 'preview-only' })
    assert.equal(f.calls.length, 0)
  } finally { await f.dispose() }
})
