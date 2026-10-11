import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WaimaiLogin, LOGIN_TOOLS } from '../lib/login.js'

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
  let contexts = 0, disposed = 0
  const qr = {
    async get(url, args) {
      calls.push({ url, args })
      if (url.includes('/member/login.jhtml')) return response(options.page || tbPage)
      if (url.includes('/qrCode/generate.do')) return response({ content: { data: { ck: 'synthetic-ck', t: '1700000000',
        codeContent: options.codeContent || 'https://login.m.taobao.com/qrcodeCheck.htm?token=synthetic-code' } } })
      if (url.includes('/mini_login.htm')) return response(elePage, 'https://ipassport.ele.me/mini_login.htm')
      if (url.includes('mtop.alsc.user.session.ele.check/')) return response({ ret: ['SUCCESS::synthetic'], data: { value: options.linked ? { localId: '12345', havanaId: '54321' } : {} } })
      if (url.includes('/eus/v3/users/')) return response({ user_id: options.foreignProfile ? '999' : '12345', username: '示例淘宝授权用户' })
      if (url.includes('fulfillment.queryorderlist/')) return response({ ret: ['SUCCESS::synthetic'], data: { result: { accountBindWrong: false, orderList: [], moreInfo: { hasMore: false } } } })
      return response({})
    },
    async post(url, args) { calls.push({ url, args }); return response({ content: { data: { qrCodeStatus: options.status || 'NEW', ...options.result } } }) },
    storageState: async () => ({ cookies: [{ name: 'cookie2', domain: '.taobao.com', value: 'synthetic-new-cookie' }], origins: [] }),
    dispose: async () => { disposed++ },
  }
  const old = { dispose: async () => { disposed++ } }
  const login = new WaimaiLogin({ statePath: path, createContext: async () => contexts++ === 0 ? old : qr })
  await login.init()
  return { login, qr, old, calls, original, path, disposed: () => disposed, close: async () => { await login.close(); await rm(dir, { recursive: true, force: true }) } }
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
    assert.equal(result.qr.state, 'business-unconfirmed'); assert.equal(f.login.http, f.old)
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
