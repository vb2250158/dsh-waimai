import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WaimaiLogin, LOGIN_TOOLS } from '../lib/login.js'
import { createHash } from 'node:crypto'

const protocol = JSON.parse(await readFile(new URL('../lib/login-protocol.json', import.meta.url), 'utf8'))
const response = (data, url = 'https://login.taobao.com/havanaone/login/login.htm') => ({ ok: () => true, status: () => 200,
  url: () => url, headers: () => ({}), text: async () => data, json: async () => data })
const bootstrap = (form, config) => `window.viewData=${JSON.stringify({ loginFormData: form })};window.viewConfig=${JSON.stringify(config)};`
const tbPage = bootstrap({ _csrf: 'synthetic-qr-csrf' }, { loginTypes: [{ type: 'qrcode' }], api: {
  getQRCodeApi: '/havanaone/loginLegacy/qrCode/generate.do', checkQRCodeApi: '/havanaone/loginLegacy/qrCode/query.do',
} })
const elePage = bootstrap({ _csrf_token: 'synthetic-ele-csrf' }, { api: protocol.apiPaths })

async function fixture(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'waimai-qr-')), path = join(dir, 'login-state.json'), calls = []
  const original = { version: 1, authenticated: true, storageState: { cookies: [{ name: 'SID', domain: '.ele.me', value: 'synthetic-original-cookie' }], origins: [] } }
  await writeFile(path, JSON.stringify(original))
  let contexts = 0, disposed = 0, businessActive = false, restored
  const qr = {
    async get(url, args) {
      calls.push({ url, args })
      if (url.includes('/member/login.jhtml')) return response(options.page || tbPage)
      if (url.includes('/qrCode/generate.do')) return response({ content: { data: { ck: 'synthetic-ck', t: '1700000000',
        codeContent: options.codeContent || 'https://login.m.taobao.com/qrcodeCheck.htm?token=synthetic-code' } } })
      if (url.includes('/mini_login.htm')) return response(elePage, 'https://ipassport.ele.me/mini_login.htm')
      if (url.includes('mtop.alsc.user.session.ele.check/')) return response({ ret: ['SUCCESS::synthetic'], data: { value: options.linked || businessActive ? { localId: '12345', havanaId: options.foreignHavana ? '99999' : '54321' } : {} } })
      if (url.includes('/eus/v3/users/')) return response({ user_id: options.foreignProfile ? '999' : '12345', username: '示例淘宝授权用户', mobile: null })
      if (url.includes('fulfillment.queryorderlist/')) return response({ ret: ['SUCCESS::synthetic'], data: { result: { accountBindWrong: false, orderList: [], moreInfo: { hasMore: false } } } })
      return response({})
    },
    async post(url, args) {
      calls.push({ url, args })
      if (url.includes('mtop.alibaba.ucc.taobao.apply.usertoken')) return response(options.ucc ? { ret: ['SUCCESS::synthetic'], data: { actionType: 'SUCCESS', code: 1, returnValue: { userToken: 'synthetic-user-token' } } } : { ret: ['FAIL_SYS_SESSION_EXPIRED::synthetic'] })
      if (url.includes('mtop.alibaba.ucc.oauthlogin')) return response(options.oauth || { ret: ['SUCCESS::synthetic'], data: { actionType: 'OTHER', code: 3000, returnValue: JSON.stringify({ site: 25, data: { userId: 54321, loginServiceExt: { localId: '12345' }, cookies: [
        'SID=synthetic-business-session; Domain=.ele.me; Path=/; HttpOnly', 'USERID=12345; Domain=.ele.me; Path=/; HttpOnly' ] } }) } })
      return response({ content: { data: { qrCodeStatus: options.status || 'NEW', ...options.result } } })
    },
    storageState: async () => ({ cookies: [{ name: 'cookie2', domain: '.taobao.com', value: 'synthetic-new-cookie' },
      { name: '_m_h5_tk', domain: '.ele.me', value: 'synthetic-ele_9999' }, { name: '_m_h5_tk', domain: '.taobao.com', value: 'synthetic-taobao_9999' }], origins: [] }),
    dispose: async () => { disposed++ },
  }
  const old = { dispose: async () => { disposed++ } }
  const events = []
  const login = new WaimaiLogin({ statePath: path, diagnostic: event => events.push(event), createContext: async args => {
    if (contexts++ === 0) return old
    if (contexts === 2) return qr
    restored = args.storageState; businessActive = true
    return { ...qr, storageState: async () => restored }
  } })
  await login.init()
  return { login, qr, old, calls, events, original, path, restored: () => restored, disposed: () => disposed, close: async () => { await login.close(); await rm(dir, { recursive: true, force: true }) } }
}

test('QR generation and polling use a fresh jar, render locally, and keep tokens out of the settings response', async () => {
  const f = await fixture()
  try {
    const start = await f.login.qrStart()
    assert.equal(start.qr.state, 'waiting'); assert.match(start.qr.image, /^data:image\/png;base64,/)
    assert.equal(f.login.http, f.old)
    for (const secret of ['synthetic-ck', 'synthetic-code', 'synthetic-qr-csrf', 'synthetic-new-cookie']) assert(!JSON.stringify(start).includes(secret))
    assert.equal((await f.login.qrPoll(start.qr.attemptId)).qr.state, 'waiting')
    const poll = f.calls.find(value => value.url.includes('/query.do'))
    assert.equal(poll.args.form.ck, 'synthetic-ck'); assert.equal(poll.args.form._csrf, 'synthetic-qr-csrf')
    await f.login.qrPoll(start.qr.attemptId)
    assert.equal(f.calls.filter(value => value.url.includes('/query.do')).length, 1)
    assert.deepEqual(JSON.parse(await readFile(f.path, 'utf8')), f.original)
    assert(LOGIN_TOOLS.includes('login_qr_start') && LOGIN_TOOLS.includes('login_qr_poll'))
  } finally { await f.close() }
})

test('confirmed Taobao login cannot replace the old account without independent takeaway confirmation', async () => {
  const f = await fixture({ status: 'CONFIRMED' })
  try {
    const start = await f.login.qrStart(), result = await f.login.qrPoll(start.qr.attemptId)
    assert.equal(result.qr.state, 'taobao-session-unconfirmed'); assert.equal(f.login.http, f.old)
    const failed = f.events.find(event => event.stage === 'mtop.alibaba.ucc.taobao.apply.usertoken')
    assert.deepEqual(failed.ret, ['FAIL_SYS_SESSION_EXPIRED'])
    assert.equal(failed.attemptId, start.qr.attemptId)
    assert(f.events.some(event => event.stage === 'ucc-unconfirmed'))
    assert(!JSON.stringify(f.events).includes('synthetic'))
    assert.deepEqual(JSON.parse(await readFile(f.path, 'utf8')), f.original)
    await assert.rejects(readFile(f.path + '.previous.json'), { code: 'ENOENT' })
  } finally { await f.close() }
})

test('only a verified fresh account with readable profile and orders is saved; previous credentials are backed up', async () => {
  const f = await fixture({ status: 'CONFIRMED', linked: true })
  try {
    const start = await f.login.qrStart(), result = await f.login.qrPoll(start.qr.attemptId)
    assert.equal(result.qr.state, 'linked'); assert.equal(result.authenticated, true); assert.equal(result.loginMethod, 'taobao-qr')
    assert.equal(f.login.http, f.qr); assert.equal(f.login.accountId, '12345')
    assert.deepEqual(JSON.parse(await readFile(f.path + '.previous.json', 'utf8')), f.original)
    assert.equal(JSON.parse(await readFile(f.path, 'utf8')).loginMethod, 'taobao-qr')
    const orders = f.calls.find(value => value.url.includes('fulfillment.queryorderlist/'))
    assert.equal(JSON.parse(new URL(orders.url).searchParams.get('data')).sourceFrom, 'TAOBAO')
    assert.equal(f.disposed(), 1)
  } finally { await f.close() }
})

test('confirmed Taobao QR exchanges UCC credentials in a new jar and verifies both business identifiers before saving', async () => {
  const f = await fixture({ status: 'CONFIRMED', ucc: true })
  try {
    const start = await f.login.qrStart(), result = await f.login.qrPoll(start.qr.attemptId)
    assert.equal(result.qr.state, 'linked'); assert.equal(result.loginMethod, 'taobao-qr')
    for (const stage of ['business-profile-verified', 'business-orders-verified', 'qr-linked']) assert(f.events.some(event => event.stage === stage))
    assert(!JSON.stringify(f.events).includes('synthetic'))
    assert.notEqual(f.login.http, f.qr); assert.notEqual(f.login.http, f.old)
    assert.equal(f.restored().cookies.find(c => c.name === 'SID').value, 'synthetic-business-session')
    assert.equal(f.disposed(), 2)
    const tokenCall = f.calls.find(c => c.url.includes('ucc.taobao.apply')), oauth = f.calls.find(c => c.url.includes('ucc.oauthlogin'))
    const endpoint = new URL(tokenCall.url)
    assert.equal(endpoint.searchParams.get('sign'), createHash('md5').update(`synthetic-taobao&${endpoint.searchParams.get('t')}&12574478&{}`).digest('hex'))
    assert.equal(endpoint.searchParams.has('data'), false); assert.equal(endpoint.searchParams.get('ecode'), '1')
    assert.deepEqual(JSON.parse(JSON.parse(oauth.args.form.data).authorizationRequest), { appName: '12574478', localSite: 'taobao', targetSite: 'eleme', userToken: 'synthetic-user-token', scene: 'tb_eleme_h5_quick_auth', ext: {} })
    assert(!JSON.stringify(result).includes('synthetic-user-token')); assert(!JSON.stringify(result).includes('synthetic-business-session'))
    assert.equal(JSON.parse(await readFile(f.path, 'utf8')).loginMethod, 'taobao-qr')
  } finally { await f.close() }
})

test('UCC challenges and mismatched business identity cannot replace the previous account', async () => {
  for (const options of [{ foreignHavana: true }, { foreignProfile: true }, { oauth: { ret: ['SUCCESS::synthetic'], data: { actionType: 'H5', code: 1001, returnValue: 'https://evil.example/private' } } }]) {
    const f = await fixture({ status: 'CONFIRMED', ucc: true, ...options })
    try {
      const start = await f.login.qrStart()
      if (options.oauth) assert.equal((await f.login.qrPoll(start.qr.attemptId)).qr.state, 'verification-required')
      else await assert.rejects(f.login.qrPoll(start.qr.attemptId))
      assert.equal(f.login.http, f.old); assert.deepEqual(JSON.parse(await readFile(f.path, 'utf8')), f.original)
      await assert.rejects(readFile(f.path + '.previous.json'), { code: 'ENOENT' })
    } finally { await f.close() }
  }
})

test('mismatched profiles, verification and registration preserve the original credentials', async () => {
  for (const options of [{ status: 'CONFIRMED', linked: true, foreignProfile: true }, { status: 'CONFIRMED', result: { conToken: 'synthetic-challenge' } },
    { status: 'CONFIRMED', result: { smsRegToken: 'synthetic-register' } }]) {
    const f = await fixture(options)
    try {
      const start = await f.login.qrStart()
      try { await f.login.qrPoll(start.qr.attemptId) } catch (error) { assert.equal(options.foreignProfile, true); assert(!error.message.includes('synthetic')) }
      assert.equal(f.login.http, f.old); assert.deepEqual(JSON.parse(await readFile(f.path, 'utf8')), f.original)
    } finally { await f.close() }
  }
})

test('stale, canceled and expired attempts do not send another poll or change accounts', async () => {
  const f = await fixture()
  try {
    const first = await f.login.qrStart(), second = await f.login.qrStart()
    await assert.rejects(f.login.qrPoll(first.qr.attemptId), /已更新/)
    await f.login.qrCancel(second.qr.attemptId)
    await assert.rejects(f.login.qrPoll(second.qr.attemptId), /已更新/)
    const third = await f.login.qrStart(); f.login.qr.expiresAt = Date.now() - 1; f.login.nextQrPollAt = 0
    assert.equal((await f.login.qrPoll(third.qr.attemptId)).qr.state, 'expired')
    assert(!f.calls.some(value => value.url.includes('/query.do'))); assert.equal(f.login.http, f.old)
  } finally { await f.close() }
})

test('confirmed scans receive a separate bounded authorization deadline and stop automatically when it expires', async () => {
  const f = await fixture({ status: 'CONFIRMED', ucc: true, oauth: { ret: ['SUCCESS::synthetic'], data: { actionType: 'OTHER', code: 99 } } })
  try {
    const start = await f.login.qrStart()
    f.login.qr.expiresAt = Date.now() + 1000
    const result = await f.login.qrPoll(start.qr.attemptId)
    assert.equal(result.qr.state, 'business-unconfirmed')
    assert(result.qr.authorizationExpiresAt > Date.now() + 50000)
    f.login.qr.authorizationExpiresAt = Date.now() - 1; f.login.nextQrPollAt = 0
    assert.equal((await f.login.qrPoll(start.qr.attemptId)).qr.state, 'authorization-timeout')
    assert.equal(f.login.qr.http, undefined)
    assert.deepEqual(JSON.parse(await readFile(f.path, 'utf8')), f.original)
  } finally { await f.close() }
})

test('QR URLs and redirected SSO credentials cannot reach unrelated hosts', async () => {
  for (const codeContent of ['https://evil.example/qrcodeCheck.htm', 'http://login.m.taobao.com/qrcodeCheck.htm', 'https://login.m.taobao.com:444/qrcodeCheck.htm']) {
    const f = await fixture({ codeContent })
    try { await assert.rejects(f.login.qrStart(), /未支持/); assert.equal(f.login.http, f.old) } finally { await f.close() }
  }
  const f = await fixture({ status: 'CONFIRMED', result: { redirectUrl: 'https://evil.example/?token=synthetic-private' } })
  try {
    const start = await f.login.qrStart()
    await assert.rejects(f.login.qrPoll(start.qr.attemptId), error => /未支持/.test(error.message) && !error.message.includes('synthetic-private'))
    assert(!f.calls.some(value => value.url.includes('evil.example')))
  } finally { await f.close() }
})
