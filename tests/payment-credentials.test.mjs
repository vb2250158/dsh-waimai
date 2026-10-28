import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PaymentCredentials } from '../lib/payment-credentials.js'
import { registerAgentOrdering } from '../lib/agent-ordering.js'
import { LOGIN_TOOLS } from '../lib/login.js'

const selection = { platformId: 'taobao', accountRef: '11111111-1111-4111-8111-111111111111' }
function fixture() {
  const records = new Map(), state = { externalId: 'synthetic-owner', calls: 0 }
  const credentials = {
    readRecord: async key => records.get(key),
    modifyRecord: async (key, update) => records.set(key, await update(records.get(key))),
    deleteRecord: async key => records.delete(key),
    describeRecord: async key => ({ configured: records.has(key), writable: true }),
  }
  return { records, state, credentials, owner: new PaymentCredentials({ credentials, accounts: async () => {
    state.calls++; return { success: true, data: { accounts: [{ ref: selection.accountRef, externalId: state.externalId }] } }
  } }) }
}

test('settings return presence only; rotation and removal affect the next private payment call', async () => {
  const f = fixture(), args = Object.freeze({ ...selection, confirmed: true })
  assert.deepEqual(await f.owner.configure({ ...selection, operation: 'status' }), { configured: false, writable: true })
  for (const password of ['000000', '111111']) {
    assert.deepEqual(await f.owner.configure({ ...selection, operation: 'save', password }), { configured: true, writable: true })
    const prepared = await f.owner.prepareCall('pay_order', args)
    assert.equal(prepared.name, 'account_payment_h5_pay'); assert.equal(prepared.arguments.password, password)
    assert.equal(args.password, undefined)
    assert.equal((await f.owner.prepareCall('account_payment_h5_submit', args)).arguments.password, password)
  }
  assert.deepEqual(await f.owner.configure({ ...selection, operation: 'remove' }), { configured: false, writable: true })
  assert.deepEqual(await f.owner.prepareCall('pay_order', args), { name: 'pay_order', arguments: args })
  assert.equal(f.records.size, 0)
})

test('stored passwords cannot move to a different account identity or an arbitrary key', async () => {
  const f = fixture()
  await f.owner.configure({ ...selection, operation: 'save', password: '000000' })
  f.state.externalId = 'other-synthetic-owner'
  await assert.rejects(f.owner.prepareCall('pay_order', selection), { code: 'payment-credential-changed' })
  await assert.rejects(f.owner.configure({ ...selection, operation: 'status' }), { code: 'payment-credential-changed' })
  await assert.rejects(f.owner.configure({ ...selection, accountRef: '../other', operation: 'remove' }), { code: 'payment-credential-account' })
  assert.equal(f.records.size, 1)
  await f.owner.configure({ ...selection, operation: 'remove' })
  assert.equal(f.records.size, 0)
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
