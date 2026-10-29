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

async function inlineFixture() {
  let handler, currentUrl = entry, rendered = Promise.resolve()
  const locator = { filter() { return this }, first() { return this }, count: async () => 1, isEnabled: async () => true,
    waitFor: async () => rendered }
  const page = { isClosed: () => false, url: () => currentUrl, locator: () => locator,
    getByPlaceholder: () => locator, waitForURL: async predicate => { await rendered; assert(predicate(new URL(currentUrl))) },
    goto: async () => dispatch('cashierMain', { success: true, data: { controlType: 'unified_login' } }) }
  const context = { newPage: async () => page, route: async (_pattern, callback) => { handler = callback } }
  const browser = new H5VerificationWindow({ channel: 'msedge', timeoutMs: 100,
    launch: async options => { assert.equal(options.headless, true); return { newContext: async () => context, close: async () => {} } } })
  async function dispatch(action, data, options = {}) {
    const events = []
    await handler({ request: () => ({ url: () => 'https://maliprod.alipay.com/wapcashier/api/' + action + '.json' }),
      fetch: async () => { events.push('fetch'); if (options.fetchError) throw options.fetchError; await options.fetching; return {
        json: async () => { if (options.jsonError) throw options.jsonError; return data }, dispose: async () => { events.push('dispose') },
      } },
      fulfill: async () => { events.push('fulfill'); options.fulfilled?.() },
      abort: async () => { events.push('abort') },
    })
    return events
  }
  await browser.open(entry, { cookies: [], origins: [] }, { inline: true })
  return { browser, dispatch, render: promise => { rendered = promise }, navigate: url => { currentUrl = url } }
}

test('inline verification does not publish readiness before the official page has navigated', async () => {
  const f = await inlineFixture()
  let release, fulfilled = false
  f.render(new Promise(resolve => { release = resolve }))
  f.browser.form.pending = true; f.browser.form.expectedAction = 'smsValidateLogin'
  const request = f.dispatch('smsValidateLogin', { success: true, data: { controlType: 'cashier_pre_confirm' } }, { fulfilled: () => { fulfilled = true } })
  await new Promise(resolve => setImmediate(resolve))
  assert(fulfilled)
  assert.deepEqual(await f.browser.input({ operation: 'refresh' }), { kind: 'pending' })
  f.navigate('https://maliprod.alipay.com/h5pay/cashierPreConfirm/index.html'); release()
  assert.deepEqual(await request, ['fetch', 'fulfill', 'dispose'])
  assert.equal(await f.browser.input({ operation: 'refresh' }), null)
  await f.browser.close()
})

test('inline verification rejects unknown, redirect and agreement responses before page execution', async () => {
  for (const raw of [
    { success: true, data: { controlType: 'phone_register', bizData: {} } },
    { success: true, needRedirect: true, data: { controlType: 'unified_login' } },
    { success: true, data: { controlType: 'unified_login', bizData: { protocols: [{}] } } },
  ]) {
    const f = await inlineFixture()
    assert.deepEqual(await f.dispatch('refresh', raw), ['fetch', 'abort', 'dispose'])
    assert.equal((await f.browser.input({ operation: 'refresh' })).kind, 'external')
    assert.deepEqual(await f.dispatch('accountLogin', {}), ['abort'])
    await f.browser.close()
  }
})

test('automatic login transitions are diagnosed and remain blocked before any request', async () => {
  for (const action of ['toUnifiedLogin', 'accountLogin', 'toAccountLogin', 'testOnlyPrivateAction']) {
    const f = await inlineFixture()
    assert.deepEqual(await f.dispatch(action, {}), ['abort'])
    if (action === 'testOnlyPrivateAction') {
      assert.equal((await f.browser.input({ operation: 'refresh' })).kind, 'phone')
      f.browser.form.requireExternal('presentation-timeout')
    }
    const result = await f.browser.input({ operation: 'refresh' })
    assert.equal(result.kind, 'external')
    assert.equal(result.diagnostic.reason, action === 'testOnlyPrivateAction' ? 'unsupported-request' : 'unexpected-write')
    assert.equal(result.diagnostic.action, action === 'testOnlyPrivateAction' ? 'other' : action)
    assert(!JSON.stringify(result).includes('testOnlyPrivateAction'))
    await f.browser.close()
  }
})

test('empty provider windows and unsupported response steps have separate redacted evidence', async () => {
  for (const [raw, flag, reason] of [
    [{ success: true, wnd: {}, data: { controlType: 'unified_login' } }, 'topWindowEmpty', 'provider-confirmation'],
    [{ success: true, data: { controlType: 'unified_login', wnd: {} } }, 'dataWindowEmpty', 'provider-confirmation'],
    [{ success: true, data: { controlType: 'test-only-private', bizData: { account: 'test-only-private' } } }, null, 'unsupported-step'],
  ]) {
    const f = await inlineFixture()
    assert.deepEqual(await f.dispatch('refresh', raw), ['fetch', 'abort', 'dispose'])
    const result = await f.browser.input({ operation: 'refresh' })
    assert.equal(result.diagnostic.reason, reason)
    assert.equal(result.diagnostic.action, 'refresh')
    if (flag) assert.equal(result.diagnostic.flags[flag], true)
    else assert.equal(result.diagnostic.step, 'other')
    assert(!JSON.stringify(result).includes('test-only-private'))
    await f.browser.close()
  }
})

test('transport, JSON, presentation mismatch and presentation timeout do not share one diagnosis', async () => {
  for (const failure of ['fetch', 'json', 'presentation', 'timeout']) {
    const f = await inlineFixture(), error = new Error('test-only-private-error')
    const options = {}
    if (failure === 'fetch') options.fetchError = error
    else if (failure === 'json') options.jsonError = error
    else {
      if (failure === 'timeout') error.name = 'TimeoutError'
      const rendering = Promise.reject(error); rendering.catch(() => {})
      f.render(rendering)
    }
    await f.dispatch('refresh', { success: true, data: { controlType: 'unified_login' } }, options)
    const result = await f.browser.input({ operation: 'refresh' })
    assert.equal(result.diagnostic.reason, { fetch: 'response-unavailable', json: 'response-invalid',
      presentation: 'presentation-mismatch', timeout: 'presentation-timeout' }[failure])
    assert(!JSON.stringify(result).includes('test-only-private-error'))
    await f.browser.close()
  }
})

test('channel filtering produces a diagnostic even without an explicit requireExternal call', async () => {
  const f = await inlineFixture()
  await f.dispatch('refresh', { success: true, data: { controlType: 'unified_login', bizData: {
    h5RegisterBindPay: true, channelInfoMap: { balanceChannel: [{ value: 'test-only-private', name: 'test-only-private', action: '/cashierPay' }] },
  } } })
  const result = await f.browser.input({ operation: 'refresh' })
  assert.equal(result.kind, 'external'); assert.equal(result.diagnostic.reason, 'no-eligible-channel')
  assert.equal(result.diagnostic.step, 'channel'); assert.equal(result.diagnostic.flags.hasChannelMap, true)
  assert(!JSON.stringify(result).includes('test-only-private'))
  await f.browser.close()
})

test('inline verification blocks unsolicited login and payment and survives close during fetch', async () => {
  const f = await inlineFixture()
  assert.deepEqual(await f.dispatch('unifiedLogin', {}), ['abort'])
  assert.deepEqual(await f.dispatch('cashierPay', {}), ['abort'])
  let release
  const fetching = new Promise(resolve => { release = resolve })
  const request = f.dispatch('refresh', { success: true, data: { controlType: 'unified_login' } }, { fetching })
  await new Promise(resolve => setImmediate(resolve))
  await f.browser.close(); release()
  assert.deepEqual(await request, ['fetch', 'dispose'])
})

test('inline resend remains pending until the official countdown replaces its button', async () => {
  const f = await inlineFixture()
  f.browser.form.observe({ controlType: 'need_loginsms_verify' }, 'refresh')
  f.browser.form.pending = true; f.browser.form.expectedAction = 'smsResendLogin'
  let release
  f.render(new Promise(resolve => { release = resolve }))
  const request = f.dispatch('smsResendLogin', { success: true, data: {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(await f.browser.input({ operation: 'refresh' }), { kind: 'pending' })
  release(); await request
  assert.equal((await f.browser.input({ operation: 'refresh' })).kind, 'sms')
  await f.browser.close()
})

test('one explicit login input permits only one request even while its response is pending', async () => {
  const f = await inlineFixture()
  f.browser.form.pending = true; f.browser.form.expectedAction = 'unifiedLogin'
  let release
  const fetching = new Promise(resolve => { release = resolve })
  const first = f.dispatch('unifiedLogin', { success: true, data: { controlType: 'need_loginsms_verify' } }, { fetching })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(await f.dispatch('unifiedLogin', {}), ['abort'])
  release()
  assert.deepEqual(await first, ['fetch', 'fulfill', 'dispose'])
  assert.equal((await f.browser.input({ operation: 'refresh' })).kind, 'sms')
  assert.deepEqual(await f.dispatch('unifiedLogin', {}), ['abort'])
  await f.browser.close()
})
