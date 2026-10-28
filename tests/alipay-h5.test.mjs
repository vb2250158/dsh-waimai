import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'
import { AlipayH5Session, h5Amount, h5Entry, h5Password, h5Query, resolveH5Entry } from '../lib/alipay-h5.js'

const entryUrl = 'https://maliprod.alipay.com/h5pay/index.html?contextId=synthetic&from=test'
const preconfirm = (biz = {}) => ({ success: true, params: { contextId: 'next' }, pageToken: 'fresh',
  data: { controlType: 'cashier_pre_confirm', bizData: { orderAmount: '47.10', npwdPay: true, ...biz } } })
function setup(replies) {
  const calls = [], disposed = []
  const http = { async post(url, options) {
    calls.push({ url, options })
    const reply = replies.shift()
    if (reply instanceof Error) throw reply
    return { ok: () => true, json: async () => reply, dispose: async () => disposed.push('response') }
  }, dispose: async () => disposed.push('context') }
  return { calls, disposed, client: new AlipayH5Session({ http, entryUrl, timeoutMs: 1000,
    environment: { device: { userAgent: 'test-client' }, clientId: 'synthetic' }, now: () => 123 }) }
}

test('H5 query retains literal plus, duplicate values and one decoding pass', () => {
  assert.deepEqual({ ...h5Query('?x=a+b%252Bc&x=two&v=a=b&empty=&missing') },
    { x: ['a+b%2Bc', 'two'], v: 'a', empty: '', missing: 'undefined' })
  assert.throws(() => h5Query('?x=%ZZ'), { code: 'h5-entry-invalid' })
  for (const value of ['http://maliprod.alipay.com/h5pay/', 'https://attacker.test/h5pay/',
    'https://user:password@maliprod.alipay.com/h5pay/', 'https://maliprod.alipay.com/else']) {
    assert.throws(() => h5Entry(value), { code: 'h5-entry-invalid' })
  }
})

test('H5 initialization matches same-origin JSON and updates continuation for the next request', async () => {
  const { client, calls, disposed } = setup([preconfirm(), { success: true, data: { controlType: 'pay_success' } }])
  assert.deepEqual(await client.initialize(), { state: 'ready', submitted: false })
  let reserved = false
  await client.submit({ amountCents: 4710, envData: 'synthetic-environment', reserve: async () => { reserved = true } })
  assert.equal(reserved, true)
  assert.equal(calls[1].url, 'https://maliprod.alipay.com/wapcashier/api/cashierPay.json')
  assert.equal(calls[1].options.data.contextId, 'next')
  assert.equal(calls[1].options.data.pageToken, 'fresh')
  assert.equal(calls[1].options.data.from, 'test')
  assert.equal(calls[1].options.data.envData, 'synthetic-environment')
  assert.equal(calls[0].options.maxRedirects, 0)
  assert.equal(calls[0].options.headers.Origin, 'https://maliprod.alipay.com')
  assert.deepEqual(client.summary(), { state: 'requires-reconciliation', submitted: true })
  assert.equal(disposed.length, 2)
})

test('same-page responses preserve the current page token and replace other parameters', async () => {
  const next = { ...preconfirm(), params: { contextId: 'third' }, pageToken: 'do-not-use' }
  const { client } = setup([preconfirm(), next])
  await client.initialize(); await client.initialize()
  assert.equal(client.params.contextId, 'third')
  assert.equal(client.params.pageToken, 'fresh')
})

test('price or currency mismatch prevents reservation and submission', async () => {
  for (const biz of [{ orderAmount: '47.11' }, { orderAmount: '-1' }, { orderAmount: '47.10', orderCurrency: 'USD' }]) {
    const { client, calls } = setup([preconfirm(biz)])
    await client.initialize()
    await assert.rejects(client.submit({ amountCents: 4710, reserve: async () => assert.fail('unexpected reservation') }),
      { code: 'payment-amount-changed' })
    assert.equal(calls.length, 1)
  }
  assert.equal(h5Amount(preconfirm({ cost: '46.90' }).data), 4690)
})

test('server-requested password is not replaced by a client passwordless flag', async () => {
  const { client, calls } = setup([preconfirm({ npwdPay: false })])
  await client.initialize()
  assert.deepEqual(await client.submit({ amountCents: 4710, reserve: async () => assert.fail('unexpected reservation') }),
    { state: 'requires-password', submitted: false })
  assert.equal(calls.length, 1)
})

test('password uses current server RSA key and official per-character framing', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 })
  const modulus = Buffer.from(publicKey.export({ format: 'jwk' }).n, 'base64url').toString('hex')
  const first = h5Password('123456', modulus)
  assert.notEqual(first, h5Password('123456', modulus))
  first.split(',').forEach((part, index) => {
    const padded = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, Buffer.from(part, 'base64'))
    assert.equal(padded[0], 0); assert.equal(padded[1], 2)
    const separator = padded.indexOf(0, 2)
    assert.ok(separator >= 10)
    assert.equal(padded.subarray(separator + 1).toString(), String(index + 1))
  })
  const ready = preconfirm({ npwdPay: false, spasswordPay: true, nextAction: '/cashierPay', combinationIndex: '2' })
  ready.data.rsaPubKey = modulus
  const { client, calls } = setup([ready, { success: true, data: { controlType: 'pay_success' } }])
  await client.initialize()
  await client.submit({ amountCents: 4710, password: '123456', reserve: async () => {} })
  assert.equal(calls[1].options.data.spwd.split(',').length, 6)
  assert.equal(calls[1].options.data.combinationIndex, '2')
  assert.ok(!JSON.stringify(calls).includes('123456'))
})

test('an unknown payment response cannot be submitted again, including concurrent callers', async () => {
  const { client, calls } = setup([preconfirm(), new Error('private-url-and-cookie')])
  await client.initialize()
  const options = { amountCents: 4710, reserve: async () => {} }
  const results = await Promise.allSettled([client.submit(options), client.submit(options)])
  assert.equal(results[0].reason.code, 'h5-response-unconfirmed')
  assert.equal(results[1].reason.code, 'payment-already-attempted')
  assert.ok(!results[0].reason.message.includes('private-url'))
  assert.equal(calls.length, 2)
})

test('reservation failure stops the request before the financial action', async () => {
  const { client, calls } = setup([preconfirm()])
  await client.initialize()
  await assert.rejects(client.submit({ amountCents: 4710, reserve: async () => { throw new Error('ledger unavailable') } }))
  assert.equal(calls.length, 1)
  assert.equal(client.submitted, false)
})

test('unsupported server actions cannot redirect credentials to another endpoint', async () => {
  for (const btnAction of ['https://attacker.test/pay', '//attacker.test/pay', '/../pay', '/cashierPay?secret=x']) {
    const { client, calls } = setup([preconfirm({ btnAction })])
    await client.initialize()
    await assert.rejects(client.submit({ amountCents: 4710, reserve: async () => assert.fail('unexpected reservation') }),
      { code: 'h5-action-unsupported' })
    assert.equal(calls.length, 1)
  }
})

test('login, redirected and unfamiliar responses never claim successful payment', async () => {
  for (const response of [{ success: true, data: { controlType: 'unified_login' } },
    { success: true, needRedirect: true, data: { controlType: 'pay_success' } },
    { success: true, data: { controlType: 'future_control', h5HalfScreen: true } }]) {
    const { client } = setup([response])
    const result = await client.initialize()
    assert.notEqual(result.state, 'ready')
    assert.notEqual(result.state, 'paid')
  }
})

test('closing releases the authentication context and prevents further calls', async () => {
  const { client, disposed } = setup([preconfirm()])
  await client.initialize(); await client.close(); await client.close()
  assert.deepEqual(disposed, ['response', 'context'])
  await assert.rejects(client.initialize(), { code: 'h5-session-expired' })
})

test('business errors and additional agreements cannot trigger backend payment', async () => {
  for (const change of [r => { r.data.bizError = true }, r => { r.data.bizData.protocolName = 'new service' },
    r => { r.data.bizData.pwdValidateType = 'newCard' }, r => { r.data.bizData.chargeMsg = 'extra fee' }]) {
    const reply = preconfirm(); change(reply)
    const { client, calls } = setup([reply])
    await client.initialize()
    await assert.rejects(client.submit({ amountCents: 4710, reserve: async () => assert.fail('must not reserve') }))
    assert.equal(calls.length, 1)
  }
})

test('original handoff follows only validated Alipay redirects and does not evaluate landing JavaScript', async () => {
  const calls = [], responses = [
    { status: 302, location: '/h5pay/landing/index.html' },
    { status: 200, html: '<script>https://maliprod.alipay.com/h5pay/index.html?contextId=synthetic&amp;x=a+b</script>' },
    { status: 200, html: '<html></html>' },
  ]
  const http = { async get(url, options) {
    calls.push({ url, options }); const next = responses.shift()
    return { status: () => next.status, headers: () => ({ location: next.location }), ok: () => next.status === 200,
      text: async () => next.html, dispose: async () => {} }
  } }
  const result = await resolveH5Entry(http, 'https://maliprod.alipay.com/w/trade_pay.do?synthetic=yes', 1000)
  assert.equal(result, 'https://maliprod.alipay.com/h5pay/index.html?contextId=synthetic&x=a+b')
  assert.equal(calls.length, 3)
  responses.push({ status: 302, location: 'https://attacker.test/' })
  await assert.rejects(resolveH5Entry(http, entryUrl, 1000), { code: 'h5-entry-invalid' })
  assert.equal(calls.length, 4)
})
