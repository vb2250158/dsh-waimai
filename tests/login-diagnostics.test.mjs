import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginResponseDiagnostic, registerLoginDiagnosticOutput } from '../lib/login-diagnostics.js'
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
  assert.deepEqual(loginResponseDiagnostic({ ret: ['FAIL_BIZ_DELIVERY_TIME_REQUIRED::' + secret,
    'FAIL_BIZ_' + secret, 'FAIL_BIZ_PRIVATE_123456789'] }).ret,
  ['FAIL_BIZ_DELIVERY_TIME_REQUIRED', 'unrecognized', 'unrecognized'])
  assert.equal(result.action, 'unrecognized'); assert.equal(result.code, null)
  assert.equal(result.codeType, 'string'); assert.equal(result.site, 25)
  assert.equal(result.cookieCount, 1); assert.equal(result.hasChallenge, true)
  assert.deepEqual(result.sessionFields, ['cookies', 'userId', 'loginServiceExt'])
  assert(!JSON.stringify(result).includes(secret))
  assert.deepEqual(loginResponseDiagnostic({ ret: ['B_10006_01_18_024::' + secret, 'F-10008-11-10-006::' + secret,
    'B_10006_01_18_024_' + secret] }).ret, ['B_10006_01_18_024', 'F-10008-11-10-006', 'unrecognized'])
  assert.equal(loginResponseDiagnostic({ content: { data: { qrCodeStatus: 'CONFIRMED' } } }).qrStatus, 'CONFIRMED')
  for (const input of [null, {}, { ret: 'secret', data: { returnValue: 'not-json-secret' } }]) assert.doesNotThrow(() => loginResponseDiagnostic(input))
})

test('the Host exporter captures only the sanitized login group and uses the logger lifecycle', () => {
  let exporter, removed = false
  const lines = []
  const dispose = registerLoginDiagnosticOutput({ logger: { exporter(value) { exporter = value; return () => { removed = true } } } }, line => lines.push(line))
  exporter.export({ ts: 0, args: ['unrelated synthetic-secret'] })
  exporter.export({ ts: 0, args: ['waimai-mcp: [waimai-login] ' + JSON.stringify({ stage: 'qr-linked' })] })
  assert.deepEqual(lines, ['1970-01-01T00:00:00.000Z waimai-mcp: [waimai-login] {"stage":"qr-linked"}'])
  dispose(); assert(removed)
})

test('login diagnostics can be disabled through the plugin configuration', () => {
  assert.equal(childEnv({}).LOGIN_DIAGNOSTICS, 'true')
  assert.equal(childEnv({ loginDiagnostics: false }).LOGIN_DIAGNOSTICS, 'false')
})

test('the Host exporter captures projected cart outcomes without enabling other log groups', () => {
  let exporter; const lines = []
  registerLoginDiagnosticOutput({ logger: { exporter(value) { exporter = value; return () => {} } } }, line => lines.push(line))
  exporter.export({ ts: 0, args: ['waimai-mcp: [waimai-cart] {"stage":"quantity-confirmed","quantityDelta":1}'] })
  exporter.export({ ts: 0, args: ['waimai-mcp: [unrelated] synthetic-secret'] })
  assert.equal(lines.length, 1); assert(lines[0].includes('quantity-confirmed')); assert(!lines[0].includes('synthetic-secret'))
})
