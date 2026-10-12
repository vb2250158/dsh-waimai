import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginResponseDiagnostic } from '../lib/login-diagnostics.js'
import { childEnv } from '../lib/env.js'

test('login diagnostics retain protocol outcomes while rejecting all remote free text, identity and credentials', () => {
  const secret = 'synthetic-private-cookie-token-phone-url'
  const raw = { ret: ['FAIL_SYS_SESSION_EXPIRED::' + secret, secret], data: {
    actionType: secret, code: secret, qrCodeStatus: secret, userToken: secret, conToken: secret,
    returnValue: JSON.stringify({ site: 25, data: { userId: secret, cookies: [secret], loginServiceExt: { localId: secret } } }),
    [secret]: secret,
  } }
  const result = loginResponseDiagnostic(raw)
  assert.deepEqual(result.ret, ['FAIL_SYS_SESSION_EXPIRED', 'unrecognized'])
  assert.equal(result.action, 'unrecognized'); assert.equal(result.code, null)
  assert.equal(result.codeType, 'string'); assert.equal(result.site, 25)
  assert.equal(result.cookieCount, 1); assert.equal(result.hasChallenge, true)
  assert.deepEqual(result.sessionFields, ['cookies', 'userId', 'loginServiceExt'])
  assert(!JSON.stringify(result).includes(secret))
  assert.equal(loginResponseDiagnostic({ content: { data: { qrCodeStatus: 'CONFIRMED' } } }).qrStatus, 'CONFIRMED')
  for (const input of [null, {}, { ret: 'secret', data: { returnValue: 'not-json-secret' } }]) assert.doesNotThrow(() => loginResponseDiagnostic(input))
})

test('login diagnostics can be disabled through the plugin configuration', () => {
  assert.equal(childEnv({}).LOGIN_DIAGNOSTICS, 'true')
  assert.equal(childEnv({ loginDiagnostics: false }).LOGIN_DIAGNOSTICS, 'false')
})
