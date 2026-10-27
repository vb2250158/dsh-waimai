import test from 'node:test'
import assert from 'node:assert/strict'
import { AlipayAgentPayments, alipayAgentDestination, alipayAgentReferences, paymentSessionUuid, inspectAlipayAgent } from '../lib/alipay-agent.js'

const sessionId = '008283f7-fee1-4219-be64-06cf151e20b3'
const queryRef = '20260617008282174448790088372682'

test('connection check uses the configured executable and distinguishes setup from wallet authorization', async () => {
  const options = { executable: '', timeoutMs: 1000 }
  assert.deepEqual(await inspectAlipayAgent(options), { configured: false, available: false, version: null, reason: 'not-configured' })
  assert.equal((await inspectAlipayAgent({ ...options, executable: 'relative-path' })).reason, 'invalid-path')
  assert.equal((await inspectAlipayAgent({ ...options, executable: import.meta.dirname })).reason, 'invalid-path')
  assert.equal((await inspectAlipayAgent({ ...options, executable: process.execPath + '.missing' })).reason, 'invalid-path')
  // A different valid program must not be reported as an available payment provider.
  assert.deepEqual(await inspectAlipayAgent({ ...options, executable: process.execPath }),
    { configured: true, available: false, version: null, reason: 'unexpected-version' })
})

test('payment session uses the Host UUID and rejects missing or fabricated identifiers', () => {
  assert.equal(paymentSessionUuid('session-' + sessionId), sessionId)
  assert.equal(paymentSessionUuid(sessionId), sessionId)
  for (const value of [undefined, '', 'session-example', 'prefix-' + sessionId]) assert.throws(() => paymentSessionUuid(value))
})

test('original Alipay cashier bytes are preserved and unrelated hosts are not handed to the CLI', () => {
  const link = 'https://excashier.alipay.com/standard?sign=synthetic%2bvalue+%20&part=1&part=2'
  assert.equal(alipayAgentDestination(link), link)
  const mobile = 'https://maliprod.alipay.com/wap?sign=synthetic%2bvalue+%20&part=1&part=2'
  assert.equal(alipayAgentDestination(mobile), mobile)
  for (const value of ['https://alipay.com.attacker.test/', 'https://cashier.alipay.com.attacker.test/',
    'https://u:p@excashier.alipay.com/', 'http://excashier.alipay.com/', 'https://excashier.alipay.com:444/',
    'https://maliprod.alipay.com.attacker.test/', 'https://r.ele.me/payment?termNos=original', 'https://excashier.alipay.com/\n', 'unrecognized-sdk-data']) {
    assert.equal(alipayAgentDestination(value), null)
  }
})

test('only current final receipt fields supply verification and query references', () => {
  const shortUrl = 'https://u.alipay.com/synthetic-current'
  assert.deepEqual(alipayAgentReferences({ code: 200, shortUrl, outShakeNo: queryRef }), { paymentUrl: shortUrl, queryRef })
  assert.deepEqual(alipayAgentReferences({ code: 200, data: { shortUrl, outShakeNo: queryRef } }), { paymentUrl: shortUrl, queryRef })
  assert.deepEqual(alipayAgentReferences({ success: true, status: 'PENDING', shortUrl, outShakeNo: queryRef }), { paymentUrl: shortUrl, queryRef })
  assert.deepEqual(alipayAgentReferences({ success: false, status: 'UNKNOWN', shortUrl, outShakeNo: queryRef }), { paymentUrl: null, queryRef: null })
  assert.deepEqual(alipayAgentReferences({ code: 200, diagnostics: { shortUrl, outShakeNo: queryRef } }), { paymentUrl: null, queryRef: null })
  assert.equal(alipayAgentReferences({ code: 500, shortUrl }).paymentUrl, null)
  assert.deepEqual(alipayAgentReferences({ code: 200, shortUrl: 'https://attacker.test/', outShakeNo: 'old-order' }), { paymentUrl: null, queryRef: null })
})

test('private process captures final JSON without equating process success with payment', async () => {
  const provider = new AlipayAgentPayments({ executable: process.execPath, timeoutMs: 2000 })
  assert.equal(await provider.prepare('session-' + sessionId), sessionId)
  const response = await provider.run(['-e', 'process.stdout.write(JSON.stringify({code:200,status:"pending"}))', '--'])
  assert.deepEqual(response, { completed: true, receipt: { code: 200, status: 'pending' } })
  const failed = await provider.run(['-e', 'process.stderr.write("synthetic-secret-url");process.exit(1)', '--'])
  assert.deepEqual(failed, { completed: false, receipt: null })
  assert(!JSON.stringify(failed).includes('synthetic-secret'))
})

test('private process reads only the terminal command result after diagnostic output', async () => {
  const provider = new AlipayAgentPayments({ executable: process.execPath, timeoutMs: 10000 })
  const run = stdout => provider.run(['-e', `process.stdout.write(${JSON.stringify(stdout)})`, '--'])
  const result = { code: 200, data: { status: 'pending', outShakeNo: queryRef } }
  const response = await run('Update recommended\nINFO diagnostic {"shortUrl":"https://u.alipay.com/synthetic-log"}\n' + JSON.stringify(result, null, 2) + '\n')
  assert.deepEqual(response, { completed: true, receipt: result })
  assert.deepEqual(alipayAgentReferences(response.receipt), { paymentUrl: null, queryRef })
  const cliResult = { entry: 'submit-payment', errorCode: 'INVALID_PARAMETER', errorMessage: '参数异常', outShakeNo: 'invalid', status: 'UNKNOWN', success: false }
  assert.deepEqual((await run(JSON.stringify(cliResult, null, 2))).receipt, cliResult)
  for (const stdout of [
    JSON.stringify(result) + '\ntruncated result',
    'INFO diagnostic ' + JSON.stringify(result),
    JSON.stringify({ code: 200, level: 'info', shortUrl: 'https://u.alipay.com/synthetic-log' }),
    JSON.stringify({ data: { shortUrl: 'https://u.alipay.com/synthetic-log' } }),
  ]) assert.equal((await run(stdout)).receipt, null)
})

test('submit uses one private argv invocation and a verified summary, while query cannot submit', async () => {
  const provider = new AlipayAgentPayments({ executable: process.execPath, timeoutMs: 2000 })
  const calls = []
  provider.run = async args => { calls.push(args); return { completed: true, receipt: { code: 200 } } }
  const paymentLink = 'https://excashier.alipay.com/?signed=synthetic&unchanged=1'
  await provider.submit({ paymentLink, sessionId, amountCents: 4710, merchant: '示例店', serviceContent: '矿泉水570ml×24，1箱' })
  assert.deepEqual(calls[0], ['submit-payment', '--session-id', sessionId, '--payment-link', paymentLink,
    '--intent-summary', '服务内容：矿泉水570ml×24，1箱，支付金额：¥47.10，支付对象：示例店'])
  assert.throws(() => provider.submit({ paymentLink, sessionId, amountCents: 4710, merchant: '示例店' }), { code: 'payment-summary-missing' })
  await provider.query(queryRef)
  assert.deepEqual(calls[1], ['query-payment-status', '--out-shake-no', queryRef])
  await provider.queryLink('https://u.alipay.com/synthetic-current')
  assert.deepEqual(calls[2], ['query-payment-status', '-p', 'https://u.alipay.com/synthetic-current'])
  assert.throws(() => provider.query('invalid'))
  assert.throws(() => provider.queryLink('https://attacker.test/'))
  assert.equal(calls.length, 3)
})
