import { test } from 'node:test'
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
  let loggedIn = false, generation = 0
  const cookies = [{ name: 'synthetic-session', value: 'synthetic-cookie-secret', domain: 'ipassport.ele.me', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }]
  const http = {
    get: async url => {
      calls.push({ method: 'GET', url })
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
      if (url.includes('/sms/login.do')) { loggedIn = options.loginAccepted !== false; return response(options.login || { user_id: '12345' }) }
      return response(loggedIn && !options.unconfirmed ? { user_id: '12345' } : { resultCode: 100, titleMsg: 'synthetic expired session' })
    },
    storageState: async () => ({ cookies, origins: [] }), dispose: async () => {},
  }
  const statePath = join(dir, 'login-state.json')
  const login = new WaimaiLogin({ statePath, persistLogin: options.persistLogin !== false, createContext: async () => http })
  return { login, calls, statePath, close: async () => { await login.close(); await rm(dir, { recursive: true, force: true }) } }
}

test('bootstrap reads JSON without executing scripts and accepts braces within JSON strings', () => {
  assert.deepEqual(assignedJson('window.viewData = {"text":"x } \\" {", "n":{}};', 'viewData'), { text: 'x } " {', n: {} })
  assert.throws(() => assignedJson('window.viewData = {run: alert(1)};', 'viewData'))
  assert.throws(() => assignedJson('window.viewData = {"x":', 'viewData'))
})

test('login URLs reject unrelated hosts, credentials, cleartext and unexpected ports', () => {
  assert.equal(loginUrl('/newlogin/sms/send.do', protocol), `${protocol.origin}/newlogin/sms/send.do`)
  for (const url of ['https://evil.example/', 'https://ipassport.ele.me.evil.example/', 'http://ipassport.ele.me/', 'https://secret@ipassport.ele.me/', 'https://ipassport.ele.me:444/']) assert.throws(() => loginUrl(url, protocol))
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
    assert.equal((await f.login.cookies()).length, 1)
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
    assert.equal((await f.login.cookies()).length, 1)
    await assert.rejects(readFile(f.statePath), { code: 'ENOENT' })
  } finally { await f.close() }
})

test('login RPC validates private payloads before the bridge call and owns an authenticated channel', async () => {
  let handler, called = 0
  const ctx = { inject(names, callback) {
    assert.deepEqual(names, ['connection'])
    callback({ effect:create => create(), connection: { rpc: { handle(channel, fn) { assert.equal(channel, '/waimai-login'); handler = fn; return () => {} } } } })
  } }
  registerLoginRpc(ctx, { async call(name) { called++; assert(LOGIN_TOOLS.includes(name)); return { success: true, data: { state: 'logged-out' } } } })
  assert.equal((await handler('sendCode', { phone: 'invalid' })).ok, false)
  assert.equal((await handler('status', { url: 'https://evil.example' })).ok, false)
  assert.equal((await handler('__proto__', {})).ok, false)
  assert.equal(called, 0)
  assert.equal((await handler('status', {})).ok, true)
})
