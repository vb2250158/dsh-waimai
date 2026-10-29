import { test } from 'node:test'
import assert from 'node:assert/strict'
import { H5InlineLogin, loginInput, loginDiagnostic } from '../lib/alipay-h5-login.js'

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
  assert(Object.values(result.flags).every(value => typeof value === 'boolean'))
  assert.equal(JSON.stringify(result).includes(secret), false)
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
