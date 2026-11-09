import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requireH5OrderReadiness } from '../lib/payment-readiness.js'
const args = { platformId: 'taobao', accountRef: '11111111-1111-4111-8111-111111111111' }
function fixture(login, preference) {
  const calls = []
  return { calls, read: async (name, input) => {
    calls.push(name)
    assert.deepEqual(input, { ...args, operation: 'status' })
    return { success: true, data: name === 'account_payment_login' ? login : preference }
  } }
}
test('new orders require current login before any preference query', async () => {
  const f = fixture({ state: 'signed-out' })
  await assert.rejects(requireH5OrderReadiness(args, f.read), { code: 'payment-login-required' })
  assert.deepEqual(f.calls, ['account_payment_login'])
  await assert.rejects(requireH5OrderReadiness({ ...args, platformId: 'hema' }, () => assert.fail('unsupported account')), { code: 'payment-account-required' })
})
test('missing and revoked funding choices stop before order creation while transaction mapping stays at payment', async () => {
  const valid = { bankState: 'available', preferredLabel: 'synthetic choice', requiresCashierVerification: false }
  for (const [patch, code] of [
    [{ preferredLabel: null }, 'payment-method-required'],
    [{ bankState: 'verification-required' }, 'payment-login-required'],
    [{ bankState: 'unavailable' }, 'payment-readiness-unavailable'],
    [{ requiresCashierVerification: true, preferredBindingAvailable: false }, 'payment-method-required'],
    [{ requiresCashierVerification: undefined }, 'payment-readiness-unavailable'],
  ]) {
    const f = fixture({ state: 'signed-in' }, { ...valid, ...patch })
    await assert.rejects(requireH5OrderReadiness(args, f.read), { code })
    assert.deepEqual(f.calls, ['account_payment_login', 'account_payment_preferences'])
  }
  const f = fixture({ state: 'signed-in' }, valid)
  await requireH5OrderReadiness(args, f.read)
  assert.equal(f.calls.length, 2)
  const bank = fixture({ state: 'signed-in' }, { ...valid, requiresCashierVerification: true, preferredBindingAvailable: true })
  await requireH5OrderReadiness(args, bank.read)
  assert.equal(bank.calls.length, 2)
})
test('provider failures expose only fixed diagnostics and never infer readiness', async () => {
  for (const read of [async () => { throw Error('synthetic-private-response') }, async () => ({ success: false, error: 'synthetic-private-response' }), async () => null]) {
    await assert.rejects(requireH5OrderReadiness(args, read), error => error.code === 'payment-readiness-unavailable' && !String(error).includes('synthetic-private'))
  }
})
