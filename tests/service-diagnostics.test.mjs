import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectServiceDiagnostic } from '../lib/login-diagnostics.js'
test('service logs retain response codes without raw credentials or provider messages', () => {
  const event = projectServiceDiagnostic('[waimai-order] ' + JSON.stringify({ stage: 'submit-response',
    ret: ['FAIL_SYS_PARAM_MISSING', 'private-cookie'], failureHints: ['parameters', 'private-token'], password: 'private-password' }))
  assert.deepEqual(event, { group: 'waimai-order', stage: 'submit-response', ret: ['FAIL_SYS_PARAM_MISSING'], failureHints: ['parameters'] })
  assert.equal(projectServiceDiagnostic('raw private-cookie'), null)
  assert.equal(projectServiceDiagnostic('[waimai-order] invalid-json'), null)
})
