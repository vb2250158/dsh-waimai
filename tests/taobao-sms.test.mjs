import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TaobaoSmsSession } from '../lib/taobao-sms.js'

const protocol = JSON.parse(await readFile(new URL('../lib/hema-protocol.json', import.meta.url), 'utf8'))
const response = value => ({ ok: () => true, status: () => 200, headers: () => ({}), url: () => 'https://login.taobao.com/member/login.jhtml',
  text: async () => value, json: async () => value })
const page = api => `window.viewData=${JSON.stringify({ appName: 'taobao', loginFormData: { _csrf: 'synthetic', bizName: 'taobao', bizEntrance: 'taobao_pc' } })};window.viewConfig=${JSON.stringify({
  api: api || { sendSmsApi: '/havanaone/loginLegacy/sms/sendSms.do?appName=taobao', smsLoginApi: '/havanaone/loginLegacy/sms/login.do?appName=taobao' },
  smsCodeLength: 4, defaultView: 'password' })};`
const phone = '13800000000', code = '1234'

function fixture(options = {}) {
  const calls = [], stages = []; let disposed = 0
  const http = { async get(url) { calls.push({ method: 'GET', url }); return response(url.includes('/member/login.jhtml') ? page(options.api) : {}) },
    async post(url, request) { calls.push({ method: 'POST', url, request }); return response({ content: { data: url.includes('sendSms.do') ? options.send || { smsToken: 'private-synthetic-token' }
      : options.login || { asyncUrls: ['https://login.taobao.com/sso?token=private-synthetic-sso', 'https://outside.invalid/sso'], redirectUrl: 'https://login.taobao.com/finish' }, ...(options.rejected && !url.includes('sendSms.do') ? { hasError: true } : {}) } }) },
    async dispose() { disposed++ } }
  const session = new TaobaoSmsSession({ createContext: async () => http, timeoutMs: 1000, diagnostic: stage => stages.push(stage) })
  return { session, calls, stages, disposed: () => disposed }
}

test('web SMS sends once, exposes only masked pending state and requires business verification after the code', async () => {
  const f = fixture()
  try {
    const sent = await f.session.send(phone, protocol)
    assert.equal(sent.state, 'code-sent'); assert.equal(sent.maskedPhone, '138****0000')
    assert(!JSON.stringify(sent).includes(phone)); assert(!JSON.stringify(sent).includes('private-synthetic-token'))
    const result = await f.session.complete(code, protocol, sent.attemptId)
    assert.equal(result.state, 'login-unconfirmed'); assert(!('authenticated' in result))
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.url.includes('sendSms.do')).length, 1)
    assert(!f.calls.some(call => call.url.includes('outside.invalid')))
    assert(!JSON.stringify(f.stages).includes(phone)); assert(!JSON.stringify(f.stages).includes(code))
    assert(!JSON.stringify(f.stages).includes('private-synthetic'))
  } finally { await f.session.close() }
  assert.equal(f.disposed(), 1); assert.equal(f.session.summary().codePending, false)
})

test('verification and registration stop before login redirects or registration endpoints', async () => {
  for (const [login, expected] of [[{ smsRegToken: 'private-registration-token' }, 'registration-required'], [{ conToken: 'private-challenge-token' }, 'verification-required']]) {
    const f = fixture({ login: { ...login, redirectUrl: 'https://login.taobao.com/finish' } })
    try {
      const sent = await f.session.send(phone, protocol)
      assert.equal((await f.session.complete(code, protocol, sent.attemptId)).state, expected)
      assert(!f.calls.some(call => /finish|loginReg/.test(call.url)))
      assert(!JSON.stringify(f.session.summary()).includes('private-'))
    } finally { await f.session.close() }
  }
})

test('foreign endpoints are rejected before sending a phone and failed codes remain explicitly retryable', async () => {
  const invalid = fixture({ api: { sendSmsApi: 'https://outside.invalid/havanaone/loginLegacy/sms/sendSms.do', smsLoginApi: '/havanaone/loginLegacy/sms/login.do' } })
  try { await assert.rejects(invalid.session.send(phone, protocol)); assert(!invalid.calls.some(call => call.method === 'POST')) }
  finally { await invalid.session.close() }
  const rejected = fixture({ login: {}, rejected: true })
  try {
    const sent = await rejected.session.send(phone, protocol)
    await assert.rejects(rejected.session.complete(code, protocol, sent.attemptId), /验证码未通过/)
    assert.equal(rejected.session.summary().state, 'code-sent')
    assert.equal(rejected.session.summary().codePending, true)
  } finally { await rejected.session.close() }
})

test('canceling and restarting disposes the old SMS jar and discards its transient credentials', async () => {
  const f = fixture()
  const sent = await f.session.send(phone, protocol); await f.session.close()
  await assert.rejects(f.session.complete(code, protocol, sent.attemptId), /获取验证码/)
  await f.session.send(phone, protocol); await f.session.close()
  assert.equal(f.disposed(), 2); assert.equal(f.session.pending, undefined); assert.equal(f.session.form, undefined)
})

test('a code from another SMS attempt never reaches the login endpoint', async () => {
  const f = fixture()
  try {
    const previous = await f.session.send(phone, protocol)
    const current = await f.session.send('13900000000', protocol)
    assert.notEqual(previous.attemptId, current.attemptId)
    await assert.rejects(f.session.complete(code, protocol, previous.attemptId), /更新或取消/)
    assert(!f.calls.some(call => call.method === 'POST' && call.url.includes('/sms/login.do')))
  } finally { await f.session.close() }
})
