import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HemaLogin } from '../lib/hema-login.js'

const protocol = JSON.parse(await readFile(new URL('../lib/hema-protocol.json', import.meta.url), 'utf8'))
const cookie = value => ({ name: 'synthetic-auth', value, domain: '.taobao.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' })
const envelope = data => ({ ret: ['SUCCESS::synthetic'], data })
const phone = '13800000000', code = '5678'
const page = `window.viewData=${JSON.stringify({ appName: 'taobao', loginFormData: { _csrf: 'synthetic', bizName: 'taobao', bizEntrance: 'taobao_pc' } })};window.viewConfig=${JSON.stringify({
  api: { sendSmsApi: '/havanaone/loginLegacy/sms/sendSms.do?appName=taobao', smsLoginApi: '/havanaone/loginLegacy/sms/login.do?appName=taobao' }, smsCodeLength: 4, defaultView: 'password' })};`
const response = data => ({ ok: () => true, status: () => 200, headers: () => ({}), url: () => 'https://login.taobao.com/member/login.jhtml',
  text: async () => typeof data === 'string' ? data : JSON.stringify(data), json: async () => data })

async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hema-sms-')), path = join(directory, 'login-state.json'), requests = []
  const original = JSON.stringify({ version: 1, platformId: 'hema', authenticated: true, loginMethod: 'taobao-qr', storageState: { cookies: [cookie('original')], origins: [] } })
  await writeFile(path, original)
  const createContext = async settings => {
    let cookies = structuredClone(settings.storageState?.cookies || [])
    return { async storageState() { return { cookies, origins: [] } }, async dispose() {},
      async get(url) {
        if (url.includes('/member/login.jhtml')) return response(page)
        const api = new URL(url).searchParams.get('api'), authenticated = cookies.length > 0
        if (api === protocol.session.api) return response(authenticated ? envelope({ userNumId: cookies[0].value === 'original' ? '54321' : '12345' }) : { ret: ['FAIL_SYS_USER_NOT_LOGIN::synthetic'], data: {} })
        if (api === protocol.profile.api) return response(envelope({ isSelf: !options.foreign, nick: 'Verified Hema user' }))
        if (api === protocol.orders.api) return response(envelope({ data: { pageNo: 1, pageSize: 10, hasMore: false, orderList: [] } }))
        throw Error('Unexpected API')
      }, async post(url, request) {
        requests.push({ url, form: request.form })
        if (url.includes('sendSms.do')) return response({ content: { data: { smsToken: 'synthetic-token' } } })
        if (options.registration) return response({ content: { data: { smsRegToken: 'synthetic-register' } } })
        cookies = [cookie('sms')]; return response({ content: { data: {} } })
      } }
  }
  const login = new HemaLogin({ statePath: path, createContext, resendSeconds: 60 })
  return { login, path, original, requests, createContext, close: () => rm(directory, { recursive: true, force: true }) }
}

test('Hema SMS preserves the old account while pending and saves only after self-profile and history verification', async () => {
  const f = await fixture()
  try {
    await f.login.status(); assert.equal(f.login.accountId, '54321')
    const sent = await f.login.sendCode(phone)
    assert.equal(sent.maskedPhone, '138****0000'); assert.equal(f.login.accountId, '54321')
    assert.equal(await readFile(f.path, 'utf8'), f.original)
    const linked = await f.login.complete(code, sent.attemptId)
    assert.equal(linked.authenticated, true); assert.equal(linked.loginMethod, 'taobao-sms'); assert.equal(f.login.accountId, '12345')
    const saved = await readFile(f.path, 'utf8'), parsed = JSON.parse(saved)
    assert.equal(parsed.version, 2); assert.equal(parsed.platformId, 'hema')
    assert(!saved.includes(phone)); assert(!saved.includes(code)); assert(!saved.includes('synthetic-token'))
    const backups = (await readdir(f.path.slice(0, f.path.lastIndexOf('login-state.json')))).filter(name => name.startsWith('login-state.json.backup-'))
    assert.equal(backups.length, 1)
    assert.equal(await readFile(join(f.path, '..', backups[0]), 'utf8'), f.original)
    const restored = new HemaLogin({ statePath: f.path, createContext: f.createContext })
    try { assert.equal((await restored.status()).loginMethod, 'taobao-sms') } finally { await restored.close() }
  } finally { await f.login.close(); await f.close() }
})

test('failed Hema verification and registration leave the original credentials unchanged', async () => {
  for (const options of [{ foreign: true }, { registration: true }]) {
    const f = await fixture(options)
    try {
      const sent = await f.login.sendCode(phone)
      if (options.foreign) await assert.rejects(f.login.complete(code, sent.attemptId), /资料无法确认/)
      else assert.equal((await f.login.complete(code, sent.attemptId)).state, 'registration-required')
      assert.equal(await readFile(f.path, 'utf8'), f.original)
      assert(!f.requests.some(request => request.url.includes('loginReg')))
      await assert.rejects(f.login.sendCode(phone), /间隔/)
    } finally { await f.login.close(); await f.close() }
  }
})

test('switching from SMS to another authorization method discards pending codes', async () => {
  const f = await fixture()
  try {
    const sent = await f.login.sendCode(phone); await f.login.cancelSms()
    await assert.rejects(f.login.complete(code, sent.attemptId), /获取验证码/)
    assert.equal(await readFile(f.path, 'utf8'), f.original)
  } finally { await f.login.close(); await f.close() }
})
