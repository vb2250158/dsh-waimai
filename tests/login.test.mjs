import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assignedJson, loginUrl, WaimaiLogin, LOGIN_TOOLS } from '../lib/login.js'
import { registerLoginRpc } from '../lib/login-rpc.js'

const protocol = JSON.parse(await readFile(new URL('../lib/login-protocol.json', import.meta.url), 'utf8'))
// These identities never reach the platform. The request adapter below is synthetic.
const phone = '13800000000'
const response = body => ({ ok: () => true, status: () => 200, headers: () => ({}), json: async () => ({ content: { data: body } }) })

async function fixture(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'waimai-login-test-'))
  const calls = []
  let loggedIn = options.authenticated === true, generation = 0
  const cookies = [{ name: 'synthetic-session', value: 'synthetic-cookie-secret', domain: 'ipassport.ele.me', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }]
  const http = {
    get: async url => {
      calls.push({ method: 'GET', url })
      if (url.startsWith(protocol.profileUrl)) return { ...response({}), json: async () => options.profile || { user_id: '12345', username: '示例用户', mobile: phone, avatar: 'a'.repeat(32) + 'png', balance: 'private-balance' } }
      if (url.includes('/h5/mtop.alsc.order.fulfillment.queryorderlist/')) {
        const request = JSON.parse(new URL(url).searchParams.get('data'))
        return { ...response({}), ok: () => !options.ordersHttpError, json: async () => options.orders || { ret: ['SUCCESS::synthetic'], data: { result: { orderList: [], moreInfo: { hasMore: true, moreInfoParams: { pageNum: request.pageNum + 1, fromTime: 1700000000000 + request.pageNum } } } } } }
      }
      if (url.includes('/h5/mtop.alsc.user.session.ele.check/')) {
        if (!cookies.some(c=>c.name==='_m_h5_tk') || options.expiredToken) {
          if (!options.expiredToken) cookies.push({ ...cookies[0], name:'_m_h5_tk', domain:'.ele.me', value:'synthetic-mtop-token_9999999999999' })
          return { ...response({}), json: async()=>({ ret:['FAIL_SYS_TOKEN_EMPTY::synthetic'], data:{} }) }
        }
        return { ...response({}), json: async()=> options.session || ({ ret:['SUCCESS::synthetic'], data:{value:loggedIn && !options.unconfirmed ? {localId:'12345',havanaId:'67890'} : {localId:0,havanaId:0}} }) }
      }
      if (url.startsWith('https://pass.eleme.hk/add')) return { ...response({}), status:()=>302, headers:()=>({ location:options.redirect || 'https://tb.eleme.hk/complete' }) }
      if (url.startsWith('https://tb.eleme.hk/')) return response({})
      const seed = { loginFormData: { _csrf_token: `synthetic-csrf-${++generation}`, appName: 'eleme', appEntrance: 'eleme_sms_h5', fromSite: '25' }, umidToken: 'synthetic-umid' }
      const config = { api: Object.fromEntries(Object.entries(protocol.apiPaths).map(([k,v]) => [k, `${v}?appName=eleme&fromSite=25`])), smsCodeLength: 6 }
      return { ...response({}), text: async () => `window.viewData = ${JSON.stringify(seed)};\nwindow.viewConfig = ${JSON.stringify(config)};` }
    },
    post: async (url, args) => {
      calls.push({ method: 'POST', url, args })
      if (url.includes('/sms/send.do')) {
        if (options.sendError) throw new Error('network failed with synthetic-private-token')
        return response(options.send || { smsToken: 'synthetic-sms-secret' })
      }
      if (url.includes('/sms/login.do')) {
        loggedIn = options.loginAccepted !== false
        if(loggedIn) cookies.push({ ...cookies[0], name:'SID', domain:'.ele.me' }, { ...cookies[0],name:'last_u_eleme_eleme_sms_h5',value:phone }, { ...cookies[0],name:'last_cc',value:'CN' })
        return response(options.login || { user_id: '12345', asyncUrls:['https://pass.eleme.hk/add?cookie2=synthetic-cookie-secret'] })
      }
      return response(loggedIn && !options.unconfirmed ? { user_id: '12345' } : { resultCode: 100, titleMsg: 'synthetic expired session' })
    },
    storageState: async () => ({ cookies, origins: [] }), dispose: async () => {},
  }
  const statePath = join(dir, 'login-state.json')
  const login = new WaimaiLogin({ statePath, persistLogin: options.persistLogin !== false, historyPageSize: options.historyPageSize || 10, createContext: async () => http })
  return { login, calls, statePath, close: async () => { await login.close(); await rm(dir, { recursive: true, force: true }) } }
}

test('bootstrap reads JSON without executing scripts and accepts braces within JSON strings', () => {
  assert.deepEqual(assignedJson('window.viewData = {"text":"x } \\" {", "n":{}};', 'viewData'), { text: 'x } " {', n: {} })
  assert.throws(() => assignedJson('window.viewData = {run: alert(1)};', 'viewData'))
  assert.throws(() => assignedJson('window.viewData = {"x":', 'viewData'))
})

test('login URLs reject unrelated hosts, credentials, cleartext and unexpected ports', () => {
  assert.equal(loginUrl('/newlogin/sms/send.do', protocol), `${protocol.origin}/newlogin/sms/send.do`)
  assert.equal(loginUrl('https://pass.eleme.hk/add', protocol), 'https://pass.eleme.hk/add')
  assert.equal(loginUrl('https://tb.eleme.hk/', protocol), 'https://tb.eleme.hk/')
  for (const url of ['https://evil.example/', 'https://ipassport.ele.me.evil.example/', 'https://pass.eleme.hk.evil.example/add', 'https://other.eleme.hk/', 'http://pass.eleme.hk/add', 'http://ipassport.ele.me/', 'https://secret@ipassport.ele.me/', 'https://ipassport.ele.me:444/']) assert.throws(() => loginUrl(url, protocol))
})

test('HTTP login obtains fresh CSRF, keeps SMS secrets private and saves only confirmed cookies', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.login.status()).authenticated, false)
    const sent = await f.login.sendCode(phone)
    assert.equal(sent.state, 'code-sent')
    assert.equal(sent.maskedPhone, '138****0000')
    assert(!JSON.stringify(sent).includes('synthetic-sms-secret'))
    const form = f.calls.find(c => c.url.includes('/sms/send.do')).args.form
    assert.equal(form._csrf_token, 'synthetic-csrf-2')
    assert.equal(form.loginId, phone)
    assert.equal(form.umidToken, 'synthetic-umid')
    const completed = await f.login.complete('123456')
    assert.equal(completed.state, 'logged-in')
    assert.equal(completed.codePending, false)
    const saved = await readFile(f.statePath, 'utf8')
    assert(!saved.includes(phone)); assert(!saved.includes('synthetic-sms-secret')); assert(!saved.includes('123456'))
    assert.equal(JSON.parse(saved).storageState.cookies[0].value, 'synthetic-cookie-secret')
    assert((await f.login.cookies()).some(c=>c.name==='SID'))
    assert(!(await f.login.cookies()).some(c=>c.name.startsWith('last_u_') || c.name==='last_cc'))
    assert(f.calls.some(c=>c.url.startsWith('https://tb.eleme.hk/')))
    assert.equal(f.calls.filter(c=>c.url.includes('/h5/mtop.alsc.user.session.ele.check/')).length, 2)
  } finally { await f.close() }
})

test('status success codes and login claims without independent account confirmation are insufficient', async () => {
  const f = await fixture({ unconfirmed: true })
  try {
    assert.equal((await f.login.status()).state, 'logged-out')
    await f.login.sendCode(phone)
    assert.equal((await f.login.complete('123456')).state, 'login-unconfirmed')
    await assert.rejects(readFile(f.statePath), { code: 'ENOENT' })
  } finally { await f.close() }
})

test('SSO redirects reject unrelated hosts and session verification requires both account identifiers', async () => {
  const redirect = await fixture({ redirect:'https://evil.example/collect?token=synthetic-private-token' })
  try {
    await redirect.login.sendCode(phone)
    await assert.rejects(redirect.login.complete('123456'), error=> /未支持/.test(error.message) && !error.message.includes('synthetic-private-token'))
    assert(!redirect.calls.some(c=>c.url.startsWith('https://evil.example/')))
    await assert.rejects(readFile(redirect.statePath), {code:'ENOENT'})
  } finally { await redirect.close() }
  for (const session of [{ret:['SUCCESS::synthetic'],data:{value:{localId:'12345',havanaId:0}}}, {ret:['UNKNOWN_FAIL_CODE::synthetic'],data:{value:{localId:'12345',havanaId:'67890'}}}]) {
    const f=await fixture({session})
    try {
      await f.login.sendCode(phone)
      assert.equal((await f.login.complete('123456')).state,'login-unconfirmed')
      await assert.rejects(readFile(f.statePath),{code:'ENOENT'})
    } finally {await f.close()}
  }
})

test('Mtop token refresh is bounded and malformed account replies stop login', async () => {
  for (const options of [{expiredToken:true},{session:{ret:[],data:{}}}]) {
    const f=await fixture(options)
    try {
      await f.login.sendCode(phone)
      await assert.rejects(f.login.complete('123456'), /业务登录/)
      assert(f.calls.filter(c=>c.url.includes('/h5/mtop.alsc.user.session.ele.check/')).length<=2)
      await assert.rejects(readFile(f.statePath),{code:'ENOENT'})
    } finally {await f.close()}
  }
})

test('a challenge stops login, registration is not submitted, and rejected SMS does not enable completion', async () => {
  for (const [send, state] of [[{ isCheckCodeShowed: true }, 'verification-required'], [{ smsRegToken: 'synthetic-registration-token' }, 'registration-required'], [{ resultCode: 100 }, 'send-rejected']]) {
    const f = await fixture({ send })
    try {
      assert.equal((await f.login.sendCode(phone)).state, state)
      await assert.rejects(f.login.complete('123456'), /先获取验证码/)
      assert.equal(f.calls.filter(c=>c.url.includes('/sms/login.do')).length, 0)
    } finally { await f.close() }
  }
})

test('uncertain sends consume the cooldown and network exceptions never expose tokens', async () => {
  const f = await fixture({ sendError: true })
  try {
    await assert.rejects(f.login.sendCode(phone), error => !error.message.includes('synthetic-private-token') && /未确认/.test(error.message))
    await assert.rejects(f.login.sendCode(phone), /发送间隔/)
    assert.equal(f.calls.filter(c=>c.url.includes('/sms/send.do')).length, 1)
    assert.equal((await f.login.status()).authenticated, false)
  } finally { await f.close() }
})

test('nonpersistent login shares runtime cookies but never writes durable login data', async () => {
  const f = await fixture({ persistLogin: false })
  try {
    await f.login.sendCode(phone)
    await f.login.complete('123456')
    assert((await f.login.cookies()).some(c=>c.name==='SID'))
    await assert.rejects(readFile(f.statePath), { code: 'ENOENT' })
  } finally { await f.close() }
})

test('profile and order reads verify the account, mask data and use the next cursor with the configured limit', async () => {
  const f = await fixture({ authenticated: true, historyPageSize: 4 })
  try {
    const profile = await f.login.profile()
    assert.equal(profile.nickname, '示例用户')
    assert.equal(profile.maskedPhone, '138****0000')
    assert(!JSON.stringify(profile).includes(phone))
    assert(!JSON.stringify(profile).includes('private-balance'))
    const first = await f.login.orders()
    await f.login.orders(first.nextCursor)
    const requests = f.calls.filter(call => call.url.includes('queryorderlist/')).map(call => JSON.parse(new URL(call.url).searchParams.get('data')))
    assert.equal(requests[0].pageSize, 4)
    assert.equal(requests[0].pageNum, 0)
    assert.equal(requests[1].pageNum, 1)
    assert.equal(requests[1].fromTime, 1700000000000)
    assert.equal(f.calls.filter(call => call.url.includes('session.ele.check/')).length, 4)
    await assert.rejects(readFile(f.statePath), { code: 'ENOENT' })
  } finally { await f.close() }
})

test('account reads stop on expired sessions, account mismatch, rejected transport and invalid pagination', async () => {
  for (const [options, method] of [[{}, 'profile'], [{ authenticated: true, profile: { user_id: '999', username: 'other account' } }, 'profile'],
    [{ authenticated: true, ordersHttpError: true }, 'orders'], [{ authenticated: true, orders: { ret: ['SUCCESS::synthetic'], data: { result: { orderList: [], moreInfo: { hasMore: true } } } } }, 'orders']]) {
    const f = await fixture(options)
    try { await assert.rejects(f.login[method](), error => !error.message.includes('other account') && !error.message.includes('synthetic-mtop-token')) }
    finally { await f.close() }
  }
  const f = await fixture({ authenticated: true })
  try {
    await assert.rejects(f.login.orders({ pageNum: 1, fromTime: 0, accountId: '999' }))
    assert.equal(f.calls.length, 0)
  } finally { await f.close() }
})

test('login HTTP channel authorizes, validates RPC envelopes and excludes secrets from replies', async () => {
  let route, called = 0
  const ctx = { inject(names, callback) {
    assert.deepEqual(names, ['connection', 'webServer'])
    callback({ effect:create => create(), connection: { requestRejection: req => req.headers.authorization === 'synthetic-host-session' ? undefined : 401 }, webServer: { register(value) { route = value; return () => {} } } })
  } }
  registerLoginRpc(ctx, { async call(name) { called++; assert(LOGIN_TOOLS.includes(name)); return { success: true, data: { state: 'logged-out' } } } })
  assert.equal(route.path, '/waimai-login')
  const server = createServer((req, res) => { void route.handler(req, res) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = 'http://127.0.0.1:' + server.address().port + route.path
  const call = (endpoint, payload, extra = {}) => fetch(url + '/' + endpoint, { method: 'POST', headers: { authorization: 'synthetic-host-session', 'content-type': 'application/json', ...extra.headers }, body: JSON.stringify({ type:'client-request', rpcId:'synthetic-id', method:endpoint, payload, ...extra.body }) })
  try {
    assert.equal((await call('status', {}, { headers: { authorization: '' } })).status, 401)
    assert.equal((await call('status', {}, { headers: { 'content-type': 'text/plain' } })).status, 415)
    assert.equal((await call('__proto__', {})).status, 404)
    for (const [endpoint, payload, extra] of [ ['sendCode', { phone:'invalid' }, {}], ['status', { url:'https://evil.example' }, {}], ['status', {}, { body: { method:'complete' } }], ['status', {}, { body: { type:'anything' } }], ['profile', {accountId:'999'}, {}], ['orders', {cursor:{pageNum:1,fromTime:0,url:'https://evil.example'}}, {}] ]) {
      assert.equal((await (await call(endpoint, payload, extra)).json()).result.ok, false)
    }
    assert.equal(called, 0)
    assert.equal((await (await call('status', { oversized: 'x'.repeat(5000) })).json()).result.ok, false)
    assert.equal(called, 0)
    const response = await call('status', {})
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const result = await response.json()
    assert.equal(result.rpcId, 'synthetic-id')
    assert.equal(result.result.ok, true)
    assert.equal(called, 1)
    for (const endpoint of ['profile', 'orders']) assert.equal((await (await call(endpoint, {})).json()).result.ok, true)
    assert.equal(called, 3)
    const owner = { platformId: 'taobao', accountRef: '11111111-1111-4111-8111-111111111111', addressRef: 'a'.repeat(64), shopId: 'store-17' }
    assert.equal((await (await call('itemOptions', { ...owner, itemId: 'food-1', url: 'https://evil.example' })).json()).result.ok, false)
    const change = { ...owner, itemId: 'food-1', step: 1, revision: 'b'.repeat(64), operationRef: '22222222-2222-4222-8222-222222222222',
      selectionRef: '33333333-3333-4333-8333-333333333333', variantRef: 'c'.repeat(64), choiceRefs: [], quantity: 1 }
    assert.equal((await (await call('cartChange', { ...change, variantRef: undefined })).json()).result.ok, false)
    assert.equal(called, 3)
    assert.equal((await (await call('itemOptions', { ...owner, itemId: 'food-1' })).json()).result.ok, true)
    assert.equal((await (await call('cartChange', change)).json()).result.ok, true)
    assert.equal(called, 5)
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)) }
})
