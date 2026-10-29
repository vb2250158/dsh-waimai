import { test } from 'node:test'
import assert from 'node:assert/strict'
import { H5InlineLogin, loginInput, loginDiagnostic, loginAgreements } from '../lib/alipay-h5-login.js'

const agreementsPage = () => ({ controlType: 'unified_login', bizData: { h5RegisterBindPay: true,
  protocols: [{ name: '测试登录协议', url: 'https://render.alipay.com/p/yuyan/180020010001196791/preview.html?agreementId=AG00000011' }],
  channelInfoMap: { balanceChannel: [{ value: 'synthetic-balance', name: '测试余额' }] } } })

function fixture(timeoutMs = 50) {
  const calls = [], controls = { count: 1, enabled: true }
  let form, action = async () => {}
  const locator = selector => ({ filter() { return this }, count: async () => controls.count,
    isEnabled: async () => controls.enabled,
    fill: async value => { calls.push({ type: 'fill', selector, length: value.length }); if (selector.includes('one-time-code')) await action() },
    click: async () => { calls.push({ type: 'click', selector }); await action() } })
  const page = { isClosed: () => false, url: () => 'https://maliprod.alipay.com/h5pay/unifiedLogin/index.html',
    locator, getByPlaceholder: () => locator('phone') }
  form = new H5InlineLogin(page, timeoutMs)
  return { form, calls, controls, page, respond: fn => { action = fn } }
}

test('provider data projects only phone, exact SMS length or an external step', () => {
  assert.deepEqual(loginInput({ controlType: 'unified_login', bizData: { mobile: 'private' } }), { kind: 'phone' })
  assert.deepEqual(loginInput({ controlType: 'need_loginsms_verify', bizData: { use4sms: 'true' } }), { kind: 'sms', codeLength: 4 })
  assert.equal(loginInput({ controlType: 'need_loginsms_verify', bizData: {} }).codeLength, 6)
  assert.equal(loginInput({ controlType: 'cashier_pre_confirm', bizData: {} }), null)
  for (const bizData of [{ registering: true }, { h5AutoRegisterQuser: true }, { protocols: [{}] }, { protocolName: 'private' }, { pwdValidateType: 'openService' }]) {
    assert.equal(loginInput({ controlType: 'unified_login', bizData }).kind, 'external')
  }
  assert.equal(loginInput({ controlType: 'unknown' }).diagnostic.reason, 'unsupported-step')
})

test('register-bind page exposes only inspected action-free channels before the hidden phone panel', () => {
  const channel = { value: 'test-balance', name: '测试余额' }
  const data = { controlType: 'unified_login', bizData: { h5RegisterBindPay: true, channelInfoMap: { balanceChannel: [channel] } } }
  assert.deepEqual(loginInput(data), { kind: 'channel' })
  for (const extra of [{ action: '/cashierPay' }, { disable: true }, { registering: true }, { protocols: [{}] },
    { pwdValidateType: 'newCard' }, { params: { pwdValidateType: 'openService' } }]) {
    const result = loginInput({ ...data, bizData: { ...data.bizData, channelInfoMap: { balanceChannel: [{ ...channel, ...extra }] } } })
    assert.equal(result.kind, 'external'); assert.equal(result.diagnostic.reason, 'no-eligible-channel')
    assert.equal(result.diagnostic.flags.hasChannelMap, true); assert.equal(result.diagnostic.flags.hasEligibleChannel, false)
  }
  assert.equal(loginInput({ ...data, bizData: { ...data.bizData, groups: [{ groupCode: 'unknown' }] } }).diagnostic.reason, 'no-eligible-channel')
  assert.equal(loginInput({ ...data, bizData: { ...data.bizData, protocols: [{}] } }).diagnostic.reason, 'provider-confirmation')
})

test('phone dispatch clicks the official button once; SMS fills once without a second submit', async () => {
  const f = fixture()
  f.form.observe({ controlType: 'unified_login', bizData: {} }, 'refresh')
  f.respond(async () => f.form.observe({ controlType: 'need_loginsms_verify', bizData: { use4sms: 'true' } }, 'unifiedLogin'))
  assert.deepEqual(await f.form.submit({ operation: 'phone', phone: '13000000000' }), { kind: 'sms', codeLength: 4, canResend: true })
  assert.equal(f.calls.filter(x => x.type === 'click').length, 1)
  f.respond(async () => f.form.observe({ controlType: 'cashier_pre_confirm', bizData: {} }, 'smsValidateLogin'))
  assert.equal(await f.form.submit({ operation: 'sms', code: '0000' }), null)
  assert.equal(f.calls.filter(x => x.type === 'click').length, 1)
  assert.equal(f.calls.filter(x => x.selector.includes('one-time-code')).length, 1)
  assert(!JSON.stringify(f.form).includes('13000000000'))
  assert(!JSON.stringify(f.form).includes('0000'))
})

test('known login agreements may be displayed without admitting registration, enrollment or private links', () => {
  const data = agreementsPage()
  assert.equal(loginInput(data).kind, 'channel')
  assert.deepEqual(loginAgreements(data), data.bizData.protocols)
  for (const extra of [{ registering: true }, { h5AutoRegisterQuser: true }, { pwdValidateType: 'newCard' },
    { pwdValidateType: 'openService' }, { chargeMsg: 'charge' }, { protocolName: 'additional-agreement' }]) {
    assert.equal(loginInput({ ...data, bizData: { ...data.bizData, ...extra } }).kind, 'external')
  }
  for (const url of ['javascript:alert(1)', 'https://example.test/p/terms', 'http://render.alipay.com/p/terms',
    'https://render.alipay.com/p/terms?token=test-only-private', 'https://render.alipay.com/p/terms#test-only-private',
    'https://name:password@render.alipay.com/p/terms']) {
    const rejected = { ...data, bizData: { ...data.bizData, protocols: [{ name: '测试', url }] } }
    assert.equal(loginAgreements(rejected), null); assert.equal(loginInput(rejected).kind, 'external')
  }
  assert.equal(loginAgreements({ ...data, bizData: { ...data.bizData, protocols: {} } }), null)
})

test('phone submission requires the user acknowledgement for the current agreement set before touching controls', async () => {
  const f = fixture(), data = agreementsPage()
  f.form.observe(data, 'refreshNoAuth')
  const current = await f.form.describe()
  assert.equal(current.kind, 'phone'); assert.equal(current.agreements.length, 1)
  assert.match(current.agreementRef, /^[0-9a-f-]{36}$/)
  await assert.rejects(f.form.submit({ operation: 'phone', phone: '13000000000' }), { code: 'h5-login-agreement-required' })
  assert.equal(f.calls.length, 0)
  f.form.observe(structuredClone(data), 'refreshNoAuth')
  await assert.rejects(f.form.submit({ operation: 'phone', phone: '13000000000', agreementRef: current.agreementRef }), { code: 'h5-login-agreement-required' })
  assert.equal(f.calls.length, 0)
  const refreshed = await f.form.describe()
  f.respond(async () => f.form.observe({ controlType: 'need_loginsms_verify', bizData: {} }, 'unifiedLogin'))
  assert.equal((await f.form.submit({ operation: 'phone', phone: '13000000000', agreementRef: refreshed.agreementRef })).kind, 'sms')
  assert.equal(f.calls.filter(x => x.type === 'click').length, 1)
  await assert.rejects(f.form.submit({ operation: 'sms', code: '000000', agreementRef: refreshed.agreementRef }), { code: 'h5-login-input-invalid' })
  f.form.close(); assert.equal(f.form.agreementRef, null)
})

test('SMS resend follows the official available button and preserves the SMS stage', async () => {
  const f = fixture()
  f.form.observe({ controlType: 'need_loginsms_verify', bizData: {} })
  f.controls.count = 0
  assert.equal((await f.form.describe()).canResend, false)
  await assert.rejects(f.form.submit({ operation: 'resend' }), { code: 'h5-login-input-invalid' })
  assert.equal(f.calls.length, 0)
  f.controls.count = 1; f.respond(async () => f.form.acknowledgeResend())
  assert.equal((await f.form.submit({ operation: 'resend' })).kind, 'sms')
  assert.equal(f.calls.length, 1)
})

test('missing or ambiguous controls, unsupported steps and incorrect lengths send nothing', async () => {
  const f = fixture()
  f.form.observe({ controlType: 'unified_login', bizData: {} })
  f.controls.count = 2
  await assert.rejects(f.form.submit({ operation: 'phone', phone: '13000000000' }), { code: 'h5-login-control-unavailable' })
  f.form.observe({ controlType: 'need_loginsms_verify', bizData: { use4sms: 'true' } })
  await assert.rejects(f.form.submit({ operation: 'sms', code: '123456' }), { code: 'h5-login-input-invalid' })
  f.form.observe({ controlType: 'unified_login', bizData: { protocols: [{}] } })
  await assert.rejects(f.form.submit({ operation: 'phone', phone: '13000000000' }), { code: 'h5-login-input-invalid' })
  assert.equal(f.calls.length, 0)
})

test('unknown login result does not resend; unrelated polling cannot release the pending attempt', async () => {
  const f = fixture(5)
  f.form.observe({ controlType: 'unified_login', bizData: {} })
  f.respond(async () => f.form.observe({ controlType: 'unified_login' }, 'cashierPayResultQuery'))
  const result = await f.form.submit({ operation: 'phone', phone: '13000000000' })
  assert.equal(result.kind, 'external'); assert.equal(result.diagnostic.reason, 'input-timeout')
  await assert.rejects(f.form.submit({ operation: 'phone', phone: '13000000000' }), { code: 'h5-login-pending' })
  assert.equal(f.calls.filter(x => x.type === 'click').length, 1)
  f.form.observe({ controlType: 'need_loginsms_verify', bizData: {} }, 'unifiedLogin')
  assert.equal((await f.form.describe()).kind, 'sms')
})

test('diagnostic projection retains no raw strings and unknown values become fixed other enums', () => {
  const secret = 'test-only-private-material'
  const raw = { success: true, needRedirect: secret, wnd: {}, data: { controlType: secret, wnd: { text: secret },
    bizData: { protocolName: secret, account: secret, channelInfoMap: { balanceChannel: [{ value: secret, name: secret, action: secret }] } } } }
  const result = loginDiagnostic(secret, { action: secret, raw })
  assert.equal(result.reason, 'other'); assert.equal(result.action, 'other'); assert.equal(result.step, 'other')
  assert.equal(result.flags.topWindow, true); assert.equal(result.flags.topWindowEmpty, true)
  assert.equal(result.flags.dataWindow, true); assert.equal(result.flags.dataWindowEmpty, false)
  assert.equal(result.flags.namedProtocol, true); assert.equal(result.agreementCheck, 'none')
  assert(Object.values(result.flags).every(value => typeof value === 'boolean'))
  assert.equal(JSON.stringify(result).includes(secret), false)
})

test('agreement rejection diagnostics identify the failing field without exposing its value', () => {
  const page = { controlType: 'unified_login', bizData: { h5RegisterBindPay: true } }
  const publicUrl = 'https://render.alipay.com/p/f/test.html?agreementId=AG00000011'
  const cases = [
    [{ name: '', url: publicUrl }, 'invalid-name'],
    [{ name: 'test', url: null }, 'invalid-url'],
    [{ name: 'test', url: 'http://render.alipay.com/p/test' }, 'non-https'],
    [{ name: 'test', url: 'https://example.test/p/private' }, 'unsupported-host'],
    [{ name: 'test', url: 'https://private@render.alipay.com/p/test' }, 'url-authority'],
    [{ name: 'test', url: 'https://render.alipay.com/private' }, 'unsupported-path'],
    [{ name: 'test', url: publicUrl + '#private' }, 'url-fragment'],
    [{ name: 'test', url: publicUrl + '&private=hidden' }, 'unsupported-query'],
    [{ name: 'test', url: publicUrl.replace('AG00000011', 'private') }, 'invalid-agreement-id'],
    [{ name: 'test', url: publicUrl }, 'accepted'],
  ]
  for (const [protocol, expected] of cases) {
    const data = { ...page, bizData: { ...page.bizData, protocols: [protocol] } }
    const diagnostic = loginDiagnostic('provider-confirmation', { data })
    assert.equal(diagnostic.agreementCheck, expected)
    assert.equal(JSON.stringify(diagnostic).includes('private'), false)
    assert.equal(loginAgreements(data) !== null, expected === 'accepted')
  }
  assert.equal(loginDiagnostic('provider-confirmation', { data: { ...page, bizData: { protocols: [{}] } } }).agreementCheck, 'unsupported-page')
  assert.equal(loginDiagnostic('provider-confirmation', { data: { ...page, bizData: { ...page.bizData, protocols: {} } } }).agreementCheck, 'invalid-list')
})

test('first external cause survives later timeout and is cleared on a successful new step or disposal', async () => {
  const f = fixture()
  f.form.observe({ controlType: 'unified_login' })
  f.form.requireExternal('unexpected-write', { action: 'toUnifiedLogin' })
  f.form.requireExternal('presentation-timeout', { data: { controlType: 'test-only-private' } })
  const result = await f.form.describe()
  assert.equal(result.diagnostic.reason, 'unexpected-write'); assert.equal(result.diagnostic.action, 'toUnifiedLogin')
  assert(!JSON.stringify(result).includes('test-only-private'))
  f.form.observe({ controlType: 'need_loginsms_verify' }, 'smsValidateLogin')
  assert.equal(f.form.diagnostic, null); assert.equal((await f.form.describe()).kind, 'sms')
  f.page.url = () => 'https://example.test/test-only-private'
  assert.equal((await f.form.describe()).diagnostic.reason, 'origin-changed')
  f.form.close(); assert.equal(f.form.diagnostic, null)
})

test('business rejection permits explicit correction but never exposes provider text', async () => {
  const f = fixture()
  f.form.observe({ controlType: 'need_loginsms_verify', bizData: {} })
  f.respond(async () => f.form.observe({ controlType: 'need_loginsms_verify', bizError: true, bizData: { msg: 'private-code' } }, 'smsValidateLogin'))
  await assert.rejects(f.form.submit({ operation: 'sms', code: '000000' }), error => error.code === 'h5-login-rejected' && !error.message.includes('private-code'))
  assert.equal((await f.form.describe()).kind, 'sms')
  f.form.close()
  assert.equal(f.form.data, null)
  await assert.rejects(f.form.describe(), { code: 'h5-verification-unavailable' })
})
