import { test } from 'node:test'
import assert from 'node:assert/strict'
import { H5VerificationWindow, h5VerificationRequest } from '../lib/alipay-h5-browser.js'

const entry = 'https://maliprod.alipay.com/h5pay/unifiedLogin/index.html?contextId=synthetic'

test('verification allows observed sign-in APIs and blocks payment, registration and unfamiliar H5 actions', () => {
  for (const name of ['cashierMain', 'unifiedLogin', 'accountLogin', 'smsValidateLogin', 'smsResendLogin']) {
    assert(h5VerificationRequest('https://maliprod.alipay.com/wapcashier/api/' + name + '.json'))
  }
  for (const name of ['cashierPay', 'h5ContinuePay', 'phoneRegister', 'setSpwd', 'operationAction', 'unexpected']) {
    assert.equal(h5VerificationRequest('https://maliprod.alipay.com/wapcashier/api/' + name + '.json'), false)
  }
})

test('verification uses an isolated browser jar and retains SDK values only in the owning snapshot', async () => {
  let launchOptions, contextOptions, route, closed = 0, sdkCalls = 0
  const jar = { cookies: [{ name: 'session', value: 'synthetic-private', domain: '.alipay.com' },
    { name: 'other', value: 'other-private', domain: '.example.test' }], origins: [{ origin: 'https://example.test' }] }
  const page = { goto: async value => assert.equal(value, entry), isClosed: () => false, url: () => entry,
    evaluate: async (_operation, args) => args ? (++sdkCalls, 'synthetic-sdk-data') : { device: { userAgent: 'test-browser' } } }
  const context = { route: async (_pattern, handler) => { route = handler }, newPage: async () => page, storageState: async () => structuredClone(jar) }
  const browser = new H5VerificationWindow({ channel: 'msedge', timeoutMs: 1000, launch: async options => {
    launchOptions = options
    return { newContext: async options => { contextOptions = options; return context }, close: async () => { closed++ } }
  } })
  await browser.open(entry, { cookies: [], origins: [] })
  assert.equal(launchOptions.channel, 'msedge'); assert.equal(launchOptions.headless, false)
  assert.deepEqual(contextOptions, { storageState: { cookies: [], origins: [] } })
  let aborted = 0
  await route({ request: () => ({ url: () => 'https://maliprod.alipay.com/wapcashier/api/cashierPay.json' }),
    abort: async () => { aborted++ }, continue: async () => assert.fail('browser must not pay') })
  assert.equal(aborted, 1)
  const snapshot = await browser.snapshot()
  assert.equal(snapshot.storageState.cookies.length, 1); assert.deepEqual(snapshot.storageState.origins, [])
  assert.equal(snapshot.envData, 'synthetic-sdk-data'); assert.equal(sdkCalls, 1)
  await browser.close(); await browser.close(); assert.equal(closed, 1)
  await assert.rejects(browser.snapshot(), { code: 'h5-verification-unavailable' })
})

test('verification cleans up partial launches and never exposes raw browser errors', async () => {
  let closed = false
  const browser = new H5VerificationWindow({ channel: 'chrome', timeoutMs: 1000, launch: async () => ({
    newContext: async () => { throw new Error('synthetic-private') }, close: async () => { closed = true },
  }) })
  await assert.rejects(browser.open(entry, { cookies: [], origins: [] }), error =>
    error.code === 'h5-browser-unavailable' && !error.message.includes('synthetic-private'))
  assert(closed)
})
