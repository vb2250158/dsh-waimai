import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PaymentCredentials } from '../lib/payment-credentials.js'
import { registerAgentOrdering } from '../lib/agent-ordering.js'
import { LOGIN_TOOLS } from '../lib/login.js'

const selection = { platformId: 'taobao', accountRef: '11111111-1111-4111-8111-111111111111' }
function fixture() {
  const records = new Map(), state = { externalId: 'synthetic-owner', accountRef: selection.accountRef, calls: 0 }
  const credentials = {
    readRecord: async key => records.get(key),
    modifyRecord: async (key, update) => records.set(key, await update(records.get(key))),
    deleteRecord: async key => records.delete(key),
    describeRecord: async key => ({ configured: records.has(key), writable: true }),
    listRecords: async () => [...records].map(([key, record]) => ({ key, kind: record.kind })),
  }
  return { records, state, credentials, owner: new PaymentCredentials({ credentials, accounts: async () => {
    state.calls++; return { success: true, data: { accounts: [{ ref: state.accountRef, externalId: state.externalId }] } }
  } }) }
}

test('settings return presence only; rotation and removal affect the next private payment call', async () => {
  const f = fixture(), args = Object.freeze({ ...selection, confirmed: true })
  assert.deepEqual(await f.owner.configure({ operation: 'status' }), { configured: false, writable: true })
  for (const password of ['000000', '111111']) {
    assert.deepEqual(await f.owner.configure({ operation: 'save', password }), { configured: true, writable: true })
    const prepared = await f.owner.prepareCall('pay_order', args)
    assert.equal(prepared.name, 'account_payment_h5_pay'); assert.equal(prepared.arguments.password, password)
    assert.equal(args.password, undefined)
    assert.equal((await f.owner.prepareCall('account_payment_h5_submit', args)).arguments.password, password)
  }
  assert.deepEqual(await f.owner.configure({ operation: 'remove' }), { configured: false, writable: true })
  assert.deepEqual(await f.owner.prepareCall('pay_order', args), { name: 'pay_order', arguments: args })
  assert.deepEqual(f.records.get('dsh-waimai/alipay-payment'), { kind: 'grant', payload: { version: 2, disabled: true } })
})

test('payment settings are independent of shopping login while payment still checks its current account', async () => {
  const f = fixture()
  await f.owner.configure({ operation: 'save', password: '000000' })
  assert.equal(f.state.calls, 0)
  f.state.accountRef = '22222222-2222-4222-8222-222222222222'
  // Reconnecting the same shopping identity creates a new local account reference.
  assert.equal((await f.owner.prepareCall('pay_order', { ...selection, accountRef: f.state.accountRef })).arguments.password, '000000')
  f.state.externalId = 'other-synthetic-owner'
  assert.equal((await f.owner.prepareCall('pay_order', { ...selection, accountRef: f.state.accountRef })).arguments.password, '000000')
  assert.deepEqual(await f.owner.configure({ operation: 'status' }), { configured: true, writable: true })
  await assert.rejects(f.owner.prepareCall('pay_order', selection), { code: 'payment-credential-account' })
  await assert.rejects(f.owner.prepareCall('pay_order', { ...selection, accountRef: '../other' }), { code: 'payment-credential-account' })
  assert.equal(f.records.size, 1)
})

test('one legacy password migrates privately even after its shopping account reference is gone', async () => {
  const f = fixture(), key = 'dsh-waimai/alipay-' + selection.accountRef
  f.records.set(key, { kind: 'grant', payload: { version: 1, externalId: 'old-account', password: '000000' } })
  f.records.set('unrelated/api-key', { kind: 'api-key', value: 'unrelated-private' })
  const read = f.credentials.readRecord
  f.credentials.readRecord = async address => { assert.notEqual(address, 'unrelated/api-key'); return read(address) }
  const result = await f.owner.configure({ operation: 'status' })
  assert.deepEqual(result, { configured: true, writable: true }); assert.equal(f.state.calls, 0)
  assert.equal(f.records.get('dsh-waimai/alipay-payment').payload.password, '000000')
  assert(!JSON.stringify(result).includes('000000'))
  await f.owner.configure({ operation: 'remove' })
  assert(!f.records.has(key)); assert(f.records.has('unrelated/api-key'))
  const restarted = new PaymentCredentials({ credentials: f.credentials, accounts: async () => assert.fail('status must not depend on login') })
  assert.deepEqual(await restarted.configure({ operation: 'status' }), { configured: false, writable: true })
})

test('identical legacy values migrate; conflicting or damaged records require an explicit shared setting', async () => {
  for (const mode of ['same', 'different', 'damaged']) {
    const f = fixture()
    f.records.set('dsh-waimai/alipay-' + selection.accountRef, { kind: 'grant', payload: { version: 1, externalId: 'one', password: '000000' } })
    f.records.set('dsh-waimai/alipay-22222222-2222-4222-8222-222222222222', { kind: 'grant', payload:
      mode === 'damaged' ? { version: 3 } : { version: 1, externalId: 'two', password: mode === 'same' ? '000000' : '111111' } })
    const status = await f.owner.configure({ operation: 'status' })
    if (mode === 'same') assert.deepEqual(status, { configured: true, writable: true })
    else {
      assert.deepEqual(status, { configured: false, writable: true, migrationRequired: true })
      assert(!f.records.has('dsh-waimai/alipay-payment'))
      await assert.rejects(f.owner.prepareCall('pay_order', selection), { code: 'payment-credential-conflict' })
    }
    await f.owner.configure({ operation: 'save', password: '222222' })
    assert.equal((await f.owner.prepareCall('pay_order', selection)).arguments.password, '222222')
  }
})

test('migration never replaces a concurrent explicit shared save or removal', async () => {
  for (const payload of [{ version: 2, password: '111111' }, { version: 2, disabled: true }]) {
    const f = fixture()
    f.records.set('dsh-waimai/alipay-' + selection.accountRef, { kind: 'grant', payload: { version: 1, externalId: 'one', password: '000000' } })
    f.credentials.modifyRecord = async (key, update) => {
      f.records.set(key, { kind: 'grant', payload })
      f.records.set(key, await update(f.records.get(key)))
    }
    const result = await f.owner.configure({ operation: 'status' })
    assert.equal(result.configured, !payload.disabled)
    assert.deepEqual(f.records.get('dsh-waimai/alipay-payment').payload, payload)
  }
})

test('failed legacy cleanup leaves payment disabled and never resurrects the old password', async () => {
  const f = fixture()
  f.records.set('dsh-waimai/alipay-' + selection.accountRef, { kind: 'grant', payload: { version: 1, externalId: 'one', password: '000000' } })
  f.credentials.deleteRecord = async () => { throw Error('private-cleanup-detail') }
  await assert.rejects(f.owner.configure({ operation: 'remove' }), error => error.code === 'payment-credential-unavailable' && !error.message.includes('private-cleanup-detail'))
  assert.deepEqual(await f.owner.configure({ operation: 'status' }), { configured: false, writable: true })
  assert.deepEqual(await f.owner.prepareCall('pay_order', selection), { name: 'pay_order', arguments: selection })
})

test('unrelated calls do not access credentials and a private one-time password remains an explicit override', async () => {
  const f = fixture(), args = { ...selection, password: '000000' }
  assert.deepEqual(await f.owner.prepareCall('account_payment_h5_submit', args), { name: 'account_payment_h5_submit', arguments: args })
  assert.deepEqual(await f.owner.prepareCall('account_list', {}), { name: 'account_list', arguments: {} })
  assert.equal(f.state.calls, 0)
})

test('credential provider failures and invalid password data never expose raw details', async () => {
  const f = fixture()
  await assert.rejects(f.owner.configure({ ...selection, operation: 'save', password: 'test-only-private' }), error =>
    error.code === 'payment-credential-unavailable' && !error.message.includes('test-only-private'))
  f.credentials.readRecord = async () => { throw Error('test-only-private') }
  await assert.rejects(f.owner.prepareCall('pay_order', selection), error =>
    error.code === 'payment-credential-unavailable' && !error.message.includes('test-only-private'))
})

test('credential-bearing payment uses only the hidden H5 method and retains safe card output', async () => {
  const methods = new Map(), calls = []
  registerAgentOrdering((name, _description, fields, execute) => methods.set(name, { fields, execute }), {
    dispatch: async (method, args) => { calls.push({ method, args }); return { accountId: 'synthetic-owner', paymentStatus: 'unknown' } },
  })
  assert(LOGIN_TOOLS.includes('account_payment_h5_pay'))
  assert(!Object.hasOwn(methods.get('pay_order').fields, 'password'))
  const result = await methods.get('account_payment_h5_pay').execute({ ...selection, password: '000000' }, { _meta: { 'dsh/sessionId': 'synthetic-session' } })
  assert.equal(calls[0].method, 'paymentH5Pay')
  assert.equal(calls[0].args.paymentSessionId, 'synthetic-session')
  assert.equal(calls[0].args.password, '000000')
  assert.equal(result.view, 'payment')
  assert(!JSON.stringify(result).includes('000000'))
})
