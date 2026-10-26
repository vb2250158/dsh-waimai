import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { WaimaiLogin } from '../lib/login.js'

// Official lib-mtop serializes top-level asac into the query, outside signed data.
const expectedAsac = 'alscGpdG4bag44EYyJBRPX'
const expectedClient = 'RenderWay/h5 AppName/tb channel/miniapp subChannel/miniapp.taobao subSubChannel/miniapp.taobao.et'

for (const operation of ['checkout', 'submit', 'adjust']) {
  test(`${operation} sends the platform risk application code in the URL and retains signed form data`, async t => {
    const calls = []
    const login = new WaimaiLogin({ persistLogin: false, createContext: async () => ({
      storageState: async () => ({ cookies: [{ name: '_m_h5_tk', value: 'fixture_9999999999999', domain: '.ele.me' }], origins: [] }),
      post: async (url, options) => {
        calls.push({ url: new URL(url), options })
        return { ok: () => true, json: async () => ({ ret: ['SUCCESS::fixture'], data: {} }) }
      },
      dispose: async () => {},
    }) })
    t.after(() => login.close())
    await login.init()
    const spec = operation === 'adjust' ? login.protocol.retail.adjust : login.protocol[operation]
    const payload = { fixture: '晚饭 + 汤', quantity: 1 }
    await login.mtop(spec, payload, false)

    assert.equal(calls.length, 1)
    const { url, options } = calls[0]
    assert.equal(url.origin, 'https://alsc-buy2.ele.me')
    const action = operation === 'checkout' ? 'build' : operation
    assert.equal(url.pathname, `/h5/mtop.alsc.bpgw.trade.order.${action}/1.0/`)
    assert.deepEqual(url.searchParams.getAll('asac'), [expectedAsac])
    assert.equal(Object.keys(options.headers).some(name => name.toLowerCase() === 'asac'), false)
    assert.equal(options.headers['x-ele-ua'], expectedClient)
    assert.equal(url.searchParams.has('data'), false)
    assert.deepEqual(JSON.parse(options.form.data), payload)
    assert.equal(url.searchParams.get('sign'), createHash('md5')
      .update(`fixture&${url.searchParams.get('t')}&12574478&${options.form.data}`).digest('hex'))
    assert.equal(options.maxRedirects, 0)
  })
}
