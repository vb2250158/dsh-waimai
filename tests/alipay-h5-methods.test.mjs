import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AlipayH5Session } from '../lib/alipay-h5.js'

const method = (value, combinationIndex, extra = {}) => ({ value, name: '测试资金来源', params: { combinationIndex }, ...extra })
const choices = () => [method('test-balance', 'combo-balance'), method('test-card', 'combo-card', { tail: '1234567812345678' })]
const ready = (biz = {}) => ({ success: true, data: { controlType: 'cashier_pre_confirm', bizData: {
  orderAmount: '45.90', combinationIndex: 'combo-balance', npwdPay: true, channelInfo: { payments: choices() }, ...biz } } })
function fixture(replies) {
  const calls = []
  const http = { async post(url, options) {
    calls.push({ url, options })
    const reply = replies.shift()
    if (reply instanceof Error) throw reply
    const raw = typeof reply === 'function' ? await reply() : reply
    return { ok: () => true, json: async () => raw, dispose: async () => {} }
  }, dispose: async () => {} }
  const client = new AlipayH5Session({ http, entryUrl: 'https://maliprod.alipay.com/h5pay/cashierPreConfirm/index.html?contextId=test-session&pageToken=test-page',
    environment: { clientId: 'test-client', device: {} }, timeoutMs: 100, now: () => 10 })
  return { client, calls }
}

test('method labels and references expose no provider identifier or full card tail; malformed items do not hide usable choices', async () => {
  const { client, calls } = fixture([ready({ channelInfo: { payments: [...choices(), null,
    method('test-action', 'combo-action', { action: '/cashierPay' }), method('test-disabled', 'combo-disabled', { disable: true }),
    method('test-new', 'combo-new', { pwdValidateType: 'newCard' }), method('test-protocol', 'combo-protocol', { protocols: [{}] }),
    method('test-duplicate', 'combo-card'), method('test-duplicate', 'combo-duplicate'),
    { value: 'test-unverifiable', name: '没有组合标识' }] } })])
  await client.initialize()
  const view = await client.methods()
  assert.equal(view.state, 'ready'); assert.equal(view.amountCents, 4590)
  assert.equal(view.methods.length, 1); assert.equal(view.methods[0].selected, true)
  assert.match(view.methods[0].methodRef, /^[a-f\d-]{36}$/)
  assert.equal(JSON.stringify(view).includes('combo'), false)
  assert.equal(JSON.stringify(view).includes('test-balance'), false)
  assert.deepEqual(await client.methods(), view)
  assert.equal(calls.length, 1)
})

test('pure list accepts data without controlType and does not replace navigation tokens', async () => {
  const { client, calls } = fixture([ready({ channelInfo: { showAll: true, payments: [] } }), {
    success: true, params: { contextId: 'must-not-adopt' }, pageToken: 'must-not-adopt',
    data: { bizData: { payments: choices(), groups: [] } },
  }])
  await client.initialize()
  const before = client.entry.href, params = { ...client.params }, view = await client.methods()
  assert.equal(view.methods.length, 2)
  assert.equal(view.methods[1].label, '测试资金来源（尾号 5678）')
  assert(!JSON.stringify(view).includes('1234567812345678'))
  assert.equal(client.entry.href, before); assert.deepEqual({ ...client.params }, params)
  assert.match(calls[1].url, /\/cashierSwitchChannel\.json$/)
  assert.equal(calls[1].options.data.formCashier, true)
  assert.equal(Object.hasOwn(calls[1].options.data, 'lastReferer'), false)
  await client.methods(); assert.equal(calls.length, 2)
})

test('parent selection confirms the combination and amount, preserves the list, expires refs and never pays', async () => {
  const response = ready({ combinationIndex: 'combo-card', channelInfo: undefined })
  response.params = { contextId: 'must-not-adopt' }
  const { client, calls } = fixture([ready(), response])
  await client.initialize()
  const view = await client.methods(), oldRef = view.methods[1].methodRef
  const result = await client.selectMethod(oldRef)
  assert.equal(result.state, 'ready'); assert.equal(result.submitted, false)
  assert.deepEqual(result.methods.map(item => item.selected), [false, true])
  assert.notEqual(result.methods[1].methodRef, oldRef)
  assert.equal(client.params.contextId, 'test-session')
  assert.match(calls[1].url, /\/cashierSwitchChannelSel\.json$/)
  assert.equal(calls[1].options.data.selected_channel, 'test-card')
  assert.equal(calls[1].options.data.child_channel, '')
  assert.equal(Object.hasOwn(calls[1].options.data, 'combinationIndex'), false)
  assert.equal(Object.hasOwn(calls[1].options.data, 'envData'), false)
  await assert.rejects(client.selectMethod(oldRef), { code: 'h5-method-expired' })
  assert.equal(calls.length, 2)
})

test('children use their explicit parent identity and child identifier, not display names', async () => {
  const payments = [{ value: 'test-parent', name: '同名银行', children: [
    { parentValue: 'test-parent', childValue: 'test-child-a', name: '同名银行', params: { combinationIndex: 'combo-a' } },
    { parentValue: 'test-parent', childValue: 'test-child-b', name: '同名银行', params: { combinationIndex: 'combo-b' } },
    { parentValue: 'wrong-parent', childValue: 'test-child-c', name: '错误关联', params: { combinationIndex: 'combo-c' } },
  ] }]
  const { client, calls } = fixture([ready({ channelInfo: { payments }, combinationIndex: 'combo-a' }), ready({ combinationIndex: 'combo-b' })])
  await client.initialize()
  const view = await client.methods(); assert.equal(view.methods.length, 2)
  const result = await client.selectMethod(view.methods[1].methodRef)
  assert.deepEqual(result.methods.map(item => item.selected), [false, true])
  assert.equal(calls[1].options.data.selected_channel, 'test-parent')
  assert.equal(calls[1].options.data.child_channel, 'test-child-b')
})

test('failed, ambiguous and amount-changing selections block payment until readback confirms the intended combination and original amount', async () => {
  for (const failure of [new Error('test-only-private'), { success: true, data: {} }, ready({ combinationIndex: 'wrong' }),
    ready({ combinationIndex: 'combo-card', orderAmount: '45.91' }), { ...ready({ combinationIndex: 'combo-card' }), wnd: {} },
    ready({ combinationIndex: 'combo-card', defaultAction: { action: '/cashierPay' } }),
    { success: true, data: { controlType: 'pay_success' } },
    { ...ready({ combinationIndex: 'combo-card' }), needRedirect: true }]) {
    const { client, calls } = fixture([ready(), failure, ready(), ready({ combinationIndex: 'combo-card' })])
    await client.initialize()
    const view = await client.methods()
    await assert.rejects(client.selectMethod(view.methods[1].methodRef), error => !error.message.includes('test-only-private'))
    assert.deepEqual(client.summary(), { state: 'requires-reconciliation', submitted: false, reason: 'payment-method-unconfirmed' })
    await assert.rejects(client.submit({ amountCents: 4590, reserve: async () => assert.fail('must not reserve') }), { code: 'h5-not-ready' })
    assert.equal(calls.length, 2)
    await assert.rejects(client.methods(), { code: 'h5-not-ready' })
    assert.equal(client.summary().state, 'requires-reconciliation')
    assert.equal((await client.methods()).state, 'ready')
    assert.equal(calls.filter(call => /\/cashierSwitchChannelSel\.json$/.test(call.url)).length, 1)
    assert.equal(client.submitted, false)
    assert(calls.every(call => !/\/(cashierPay|h5ContinuePay)\.json$/.test(call.url)))
  }
})

test('concurrent selects serialize and stale references cannot submit a second selection', async () => {
  const { client, calls } = fixture([ready(), ready({ combinationIndex: 'combo-card' })])
  await client.initialize()
  const view = await client.methods(), ref = view.methods[1].methodRef
  const results = await Promise.allSettled([client.selectMethod(ref), client.selectMethod(ref)])
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.code, 'h5-method-expired')
  assert.equal(calls.length, 2)
  await client.close()
  assert.equal(client.methodRefs.size, 0)
  await assert.rejects(client.methods(), { code: 'h5-session-expired' })
})

test('unverified, already-submitted or unfamiliar list states cannot be used for selection', async () => {
  const { client, calls } = fixture([{ success: true, data: { controlType: 'unified_login' } }, ready()])
  await client.initialize(); await assert.rejects(client.methods(), { code: 'h5-not-ready' })
  await client.initialize(); const view = await client.methods()
  client.submitted = true
  await assert.rejects(client.selectMethod(view.methods[0].methodRef), { code: 'payment-already-attempted' })
  assert.equal(calls.length, 2)
  const invalid = fixture([ready({ channelInfo: { showAll: true, payments: choices() } }),
    { success: true, data: { controlType: 'unified_login', bizData: { payments: choices() } } }])
  await invalid.client.initialize()
  await assert.rejects(invalid.client.methods(), { code: 'h5-method-unconfirmed' })
})
