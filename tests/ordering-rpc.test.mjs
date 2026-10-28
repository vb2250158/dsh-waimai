import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { registerLoginRpc } from '../lib/login-rpc.js'
import { registerAgentOrdering } from '../lib/agent-ordering.js'
import { PaymentCredentials } from '../lib/payment-credentials.js'

const owner = { platformId: 'taobao', accountRef: '11111111-1111-4111-8111-111111111111' }
const shop = { ...owner, shopId: 'synthetic-shop' }
const ref = '22222222-2222-4222-8222-222222222222'
const payment = { ...owner, orderRef: ref, paymentRef: ref, confirmed: true, confirmedCents: 4710, maxAmountCents: 5000 }

async function fixture(bridge) {
  let route
  registerLoginRpc({ inject(_names, callback) {
    callback({ effect: create => create(), connection: { requestRejection: req => req.headers.authorization === 'synthetic-session' ? undefined : 401 },
      webServer: { register(value) { route = value; return () => {} } } })
  } }, bridge)
  const server = createServer((req, res) => { void route.handler(req, res) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return {
    call: (method, payload, authorized = true) => fetch(`http://127.0.0.1:${server.address().port}/waimai-login/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: authorized ? 'synthetic-session' : '' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'synthetic-request', method, payload }),
    }),
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) },
  }
}

test('authenticated retail and payment routes call the existing tools once and preserve references', async () => {
  const calls = [], cases = [
    ['retailSearch', 'search_retail_products', { ...shop, keyword: 'water' }],
    ['retailCart', 'get_retail_cart', shop],
    ['retailAdd', 'add_retail_product', { ...owner, productRef: ref, revision: 'a'.repeat(64), operationRef: ref, quantity: 1 }],
    ['retailCheckout', 'preview_retail_checkout', { ...shop, deliveryPreference: 'earliest', maxAmount: 50 }],
    ['paymentOptions', 'get_payment_options', { ...owner, orderRef: ref }],
    ['paymentPay', 'pay_order', payment],
  ]
  const f = await fixture({ call: async (name, args) => { calls.push({ name, args }); return { success: true, data: { state: 'unknown' } } } })
  try {
    for (const [endpoint, name, args] of cases) {
      assert.equal((await f.call(endpoint, args, false)).status, 401)
      const response = await f.call(endpoint, args)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.deepEqual(await response.json(), { type: 'server-response', rpcId: 'synthetic-request', result: { ok: true, value: { state: 'unknown' } } })
      assert.deepEqual(calls.at(-1), { name, args })
    }
    assert.equal(calls.length, cases.length)
  } finally { await f.close() }
})

test('invalid owner, amount, credentials and arbitrary destinations cannot reach ordering tools', async () => {
  let calls = 0
  const f = await fixture({ call: async () => { calls++; throw Error('must not be called') } })
  try {
    const invalid = [
      ['paymentPay', { ...payment, confirmed: false }], ['paymentPay', { ...payment, maxAmountCents: undefined }],
      ['paymentPay', { ...payment, confirmedCents: 47.1 }], ['paymentPay', { ...payment, password: '000000' }],
      ['paymentPay', { ...payment, paymentUrl: 'https://untrusted.example' }], ['paymentPay', { ...payment, paymentRef: undefined }],
      ['paymentOptions', { ...owner, orderRef: ref, accountRef: undefined }],
      ['retailCart', { ...shop, platformId: 'hema' }], ['retailSearch', { ...shop, keyword: '' }],
      ['retailAdd', { ...owner, productRef: ref, revision: 'a'.repeat(64), operationRef: ref, quantity: 0 }],
      ['retailCheckout', { ...shop, maxAmount: 50 }],
    ]
    for (const [endpoint, args] of invalid) assert.equal((await (await f.call(endpoint, args)).json()).result.ok, false)
    assert.equal(calls, 0)
  } finally { await f.close() }
})

test('payment RPC uses Host credentials and preserves unknown outcomes without a second dispatch', async () => {
  const methods = new Map(), calls = [], records = new Map()
  const credentials = new PaymentCredentials({ credentials: {
    readRecord: async key => records.get(key), modifyRecord: async (key, update) => records.set(key, await update(records.get(key))),
    describeRecord: async key => ({ configured: records.has(key), writable: true }),
  }, accounts: async () => ({ success: true, data: { accounts: [{ ref: owner.accountRef, externalId: 'synthetic-owner' }] } }) })
  await credentials.configure({ ...owner, operation: 'save', password: '000000' })
  registerAgentOrdering((name, _description, _fields, execute) => methods.set(name, execute), {
    dispatch: async (method, args) => { calls.push({ method, args }); return { accountId: 'synthetic-owner', paymentStatus: 'unknown' } },
  })
  const f = await fixture({ call: async (name, args) => {
    const prepared = await credentials.prepareCall(name, args)
    return { success: true, data: await methods.get(prepared.name)(prepared.arguments, {}) }
  } })
  try {
    const result = await (await f.call('paymentPay', payment)).json()
    assert.equal(result.result.value.attempts[0].paymentStatus, 'unknown')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'paymentH5Pay')
    assert.equal(calls[0].args.password, '000000')
    assert.equal(calls[0].args.maxAmountCents, 5000)
    assert(!JSON.stringify(result).includes('000000'))
  } finally { await f.close() }
})
