import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AlipaySignIn, alipayLoginNavigation } from '../lib/alipay-sign-in.js'
import { TaobaoCashier } from '../lib/cashier.js'
import { createLoginDispatcher } from '../lib/login-rpc.js'
import { LOGIN_TOOLS } from '../lib/login.js'


function walletResponse() {
  return { status: () => 200, headers: () => ({ 'content-type': 'application/json' }),
    body: async () => Buffer.from(JSON.stringify({ stat: 'ok', results: [] })), dispose: async () => {} }
}

function fixture() {
  const state = { url: 'https://auth.alipay.com/login/index.htm', classes: 'barcode-container', status: 302, launches: 0, closed: 0, probes: 0 }
  const context = { async route(_pattern, handler) { state.route = handler }, async newPage() { return page },
    request: { async get(url, options) { state.probes++; if (url.includes('/asset/bindQuery.json')) return walletResponse(); assert.equal(url, 'https://sweb.alipay.com/'); assert.equal(options.maxRedirects, 0)
      return { status: () => state.status, headers: () => ({ 'content-type': 'text/html' }), async dispose() {} } } },
    async storageState() { return { cookies: [{ name: 'secret', value: 'private', domain: '.alipay.com' }, { name: 'other', domain: '.example.com' }], origins: [] } } }
  const page = { isClosed: () => Boolean(state.pageClosed), url: () => state.url, async goto() {}, async evaluate() { return { userAgent: 'test' } },
    locator() { return { async waitFor() {}, async count() { return 1 }, async getAttribute() { return state.classes }, async isVisible() { return true }, async screenshot() { return Buffer.from('qr') } } } }
  const client = new AlipaySignIn({ channel: 'msedge', timeoutMs: 1000, launch: async () => { state.launches++; return { async newContext() { return context }, async close() { state.closed++ } } } })
  return { client, state }
}

test('QR login starts without an order and repeated starts preserve the current QR', async () => {
  const { client, state } = fixture()
  assert.deepEqual(await client.status(), { state: 'signed-out' })
  const first = await client.start(), second = await client.start()
  assert.equal(first.state, 'waiting-scan'); assert.equal(second.loginRef, first.loginRef); assert.equal(state.launches, 1)
  assert.equal(client.authentication, null)
  state.classes = 'barcode-container confirmed'
  assert.equal((await client.status()).state, 'confirm-on-phone'); assert.equal(client.authentication, null)
  state.classes = 'barcode-container timeout'
  assert.equal((await client.status()).state, 'expired')
  await client.close(); assert.equal(state.closed, 1); assert.equal((await client.status()).state, 'signed-out')
})

test('a stale QR window recovers a valid saved login without replacing the live browser jar or requiring another scan', async () => {
  const { client, state } = fixture()
  await client.start()
  const browserContext = client.context
  const authentication = { storageState: { cookies: [], origins: [] }, environment: { device: { userAgent: 'synthetic' } } }
  let accepted = false, loads = 0
  client.store = { load: async () => { loads++; return structuredClone(authentication) }, save: async () => {} }
  client.createRequest = async () => ({ get: async url => url.includes('/asset/bindQuery.json') ? walletResponse() : ({ status: () => accepted ? 200 : 302,
    headers: () => ({ 'content-type': 'text/html', location: 'https://auth.alipay.com/login/index.htm' }), dispose: async () => {} }),
    storageState: async () => authentication.storageState, dispose: async () => {} })
  assert.equal((await client.status()).state, 'waiting-scan')
  assert.equal(client.context, browserContext)
  accepted = true
  assert.equal((await client.status()).state, 'signed-in')
  assert.equal(loads, 2)
  assert.equal(state.launches, 1)
  assert.equal(state.closed, 1)
  assert.equal(client.page, null)
  assert.equal((await client.status()).state, 'signed-in')
  await client.close()
})

test('only a protected official page verified with the same jar completes sign-in', async () => {
  const { client, state } = fixture(); await client.start()
  state.url = 'https://sweb.alipay.com/'
  assert.equal((await client.status()).state, 'verification-required'); assert.equal(client.authentication, null)
  state.status = 200
  const result = await client.status()
  assert.equal(result.state, 'signed-in'); assert.equal(client.authentication.storageState.cookies.length, 1)
  assert(!JSON.stringify(result).includes('private'))
  state.status = 302
  assert.equal((await client.status()).state, 'verification-required'); assert.equal(client.authentication, null)
  await client.close()
})

test('the login browser follows official return and verification pages but blocks cashier navigation', async () => {
  const { client, state } = fixture(); await client.start()
  const actions = []
  const route = (url, navigation = true) => ({ request: () => ({ url: () => url, isNavigationRequest: () => navigation }),
    abort: () => actions.push('abort'), continue: () => actions.push('continue'), fulfill: () => actions.push('placeholder') })
  await state.route(route('https://sweb.alipay.com/'))
  await state.route(route('https://maliprod.alipay.com/h5pay/index.html'))
  await state.route(route('https://maliprod.alipay.com/wapcashier/api/pay.json', false))
  await state.route(route('https://evil.example/'))
  assert.deepEqual(actions, ['continue', 'abort', 'abort', 'abort'])
  assert(alipayLoginNavigation('https://auth.alipay.com/login/redirect.htm'))
  assert(alipayLoginNavigation('https://sweb.alipay.com/portal'))
  assert(alipayLoginNavigation('https://securitycore.alipay.com/verify/index.htm'))
  assert(!alipayLoginNavigation('https://auth.alipay.com.evil.example/login/index.htm'))
  await client.close()
})

test('preview-mode prelogin never accesses order, payment or budget ledgers and is isolated per owner', async () => {
  const trade = { dryRun: true, journalPath: 'synthetic/trades.json', login: { timeoutMs: 1000, run: fn => fn() },
    journal: () => assert.fail('no orders'), capCents: 1 }
  const first = new TaobaoCashier(trade), second = new TaobaoCashier(trade)
  const f = fixture(); first.signIn = f.client
  const started = await first.paymentLogin({ operation: 'start' })
  assert.equal(started.state, 'waiting-scan')
  await assert.rejects(first.paymentLogin({ operation: 'cancel', loginRef: 'foreign' }), { code: 'alipay-login-expired' })
  f.state.url = 'https://sweb.alipay.com/'; f.state.status = 200
  assert.equal((await first.paymentLogin({ operation: 'status', loginRef: started.loginRef })).state, 'signed-in')
  assert(first.h5Authentication); assert.equal(second.h5Authentication, null)
  await first.paymentLogin({ operation: 'cancel', loginRef: started.loginRef }); assert.equal(first.h5Authentication, null)
  await first.close(); await second.close()
})

test('the private login RPC requires an account but rejects order and payment arguments', async () => {
  const calls = [], dispatch = createLoginDispatcher({ async call(name, args) { calls.push({ name, args }); return { success: true, data: { state: 'signed-out' } } } })
  const input = { platformId: 'taobao', accountRef: '11111111-1111-4111-8111-111111111111', operation: 'start' }
  assert((await dispatch('paymentLogin', input)).ok)
  for (const extra of [{ orderRef: input.accountRef }, { confirmedCents: 1 }, { password: 'private' }]) assert.equal((await dispatch('paymentLogin', { ...input, ...extra })).ok, false)
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'account_payment_login')
  assert(LOGIN_TOOLS.includes('account_payment_login'))
})

 test('authenticated redirects do not require the exact original return URL', async () => {
  const { client, state } = fixture(); await client.start()
  state.url = 'https://sweb.alipay.com/portal/index.htm'; state.status = 200
  assert.equal((await client.status()).state, 'signed-in')
  state.status = 302
  assert.equal((await client.status()).state, 'verification-required')
  assert.equal(client.authentication, null)
  await client.close()
})

test('Alipay authsa login redirects render and remain unverified until the protected probe succeeds', async () => {
  const { client, state } = fixture(); await client.start()
  const target = 'https://authsa128.alipay.com/login/index.htm'
  assert(alipayLoginNavigation(target))
  for (const bad of ['https://authsa128.alipay.com.evil.example/login/index.htm', 'http://authsa128.alipay.com/login/index.htm', 'https://maliprod.alipay.com/h5pay/index.html', 'https://authsa128.alipay.com:444/login/index.htm']) assert(!alipayLoginNavigation(bad))
  let continued = false
  await state.route({ request: () => ({ url: () => target, isNavigationRequest: () => true }), continue: () => { continued = true }, abort: () => assert.fail('official login shard blocked') })
  assert(continued)
  state.url = target
  assert.equal((await client.status()).state, 'waiting-scan')
  assert.equal(client.authentication, null)
  state.status = 200
  assert.equal((await client.status()).state, 'signed-in')
  await client.close()
})

test('official post-login pages are allowed while lookalike domains and cashier pages are rejected', () => {
  assert(alipayLoginNavigation('https://c.alipay.com/page/life-account/index?_appScene=CONTENT'))
  assert(alipayLoginNavigation('https://authsa129.alipay.com/login/index.htm'))
  for (const url of ['https://alipay.com.evil.test/page', 'https://evilalipay.com/page', 'http://c.alipay.com/page', 'https://user:pass@c.alipay.com/page', 'https://maliprod.alipay.com/wapcashier/api/pay.json']) assert(!alipayLoginNavigation(url))
})

test('protected authentication probe follows the official account redirect but rejects login redirects and loops', async () => {
  const client = new AlipaySignIn({channel:'msedge',timeoutMs:1000})
  let count = 0, disposed = 0
  client.context = {request:{get:async url => {
    count++
    if (url.includes('/asset/bindQuery.json')) return { ...walletResponse(), dispose: async () => { disposed++ } }
    return {status:()=>url==='https://sweb.alipay.com/'?302:200,
      headers:()=>({'content-type':'text/html',location:'https://c.alipay.com/page/life-account/index?_appScene=CONTENT'}),dispose:async()=>{disposed++}}
  }}}
  assert.equal(await client.verify(), true); assert.equal(count,3); assert.equal(disposed,3)
  client.context.request.get = async () => ({status:()=>302,headers:()=>({location:'https://authsa128.alipay.com/login/index.htm'}),dispose:async()=>{}})
  assert.equal(await client.verify(), false)
  count=0
  client.context.request.get = async () => {count++;return {status:()=>302,headers:()=>({location:'https://c.alipay.com/page'}),dispose:async()=>{}}}
  assert.equal(await client.verify(),false);assert.equal(count,6)
})


test('an HTTP 200 account page alone never proves an authenticated wallet', async () => {
  const client = new AlipaySignIn({ channel: 'msedge', timeoutMs: 1000 })
  let cardStatus = 302, calls = 0
  const http = { get: async url => {
    calls++
    const cards = url.includes('/asset/bindQuery.json')
    return { status: () => cards ? cardStatus : 200,
      headers: () => ({ 'content-type': cards ? 'application/json' : 'text/html' }),
      body: async () => Buffer.from(JSON.stringify({ stat: 'ok', results: [] })), dispose: async () => {} }
  } }
  assert.equal(await client.verify(http), false)
  assert.equal(calls, 2)
  cardStatus = 200
  assert.equal(await client.verify(http), true)
  cardStatus = 503
  await assert.rejects(client.verify(http), { code: 'alipay-cards-unconfirmed' })
})


test('closing the verified login page before polling still saves its owning live context', async () => {
  const { client, state } = fixture()
  let saved = null
  client.store = { load: async () => null, save: async value => { saved = value } }
  await client.start()
  state.status = 200
  state.pageClosed = true
  assert.equal((await client.status()).state, 'signed-in')
  assert.equal(saved.storageState.cookies.length, 1)
  assert.equal(saved.environment.device.userAgent, 'test')
  await client.close()
})


test('a closed unverified login page never persists its cookies', async () => {
  const { client, state } = fixture()
  client.store = { load: async () => null, save: async () => assert.fail('unverified session') }
  await client.start()
  state.pageClosed = true
  assert.equal((await client.status()).state, 'signed-out')
  await client.close()
})
