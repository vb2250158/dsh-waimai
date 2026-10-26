import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WaimaiLogin } from '../lib/login.js'

test('checkout and submission reach HTTP with the same Taobao coupon channel', async () => {
  const calls = []
  const http = {
    async storageState() { return { cookies: [{ name: '_m_h5_tk', value: 'synthetic-token_9999999999999', domain: '.ele.me' }] } },
    async post(url, options) {
      const ua = options.headers?.['x-ele-ua'] || ''
      const channel = Object.fromEntries(ua.split(' ').map(part => part.split('/')))
      calls.push({ api: new URL(url).searchParams.get('api'), channel, options })
      const taobao = channel.AppName === 'tb' && channel.channel === 'miniapp'
        && channel.subChannel === 'miniapp.taobao' && channel.subSubChannel === 'miniapp.taobao.et'
      return { ok: () => true, json: async () => ({ ret: ['SUCCESS::synthetic'], data: { coupon: taobao ? 11 : 10, payable: taobao ? 48.2 : 49.2 } }) }
    },
    async dispose() {},
  }
  const login = new WaimaiLogin({ persistLogin: false, createContext: async () => http })
  try {
    await login.init()
    const withoutChannel = { ...login.protocol.checkout, headers: { asac: login.protocol.checkout.headers.asac } }
    assert.deepEqual((await login.mtop(withoutChannel, {}, false)).data, { coupon: 10, payable: 49.2 })
    for (const spec of [login.protocol.checkout, login.protocol.submit]) {
      assert.deepEqual((await login.mtop(spec, { linkage: 'synthetic-linkage' }, false)).data, { coupon: 11, payable: 48.2 })
    }
    assert.equal(calls.length, 3)
    assert.deepEqual(calls[1].channel, calls[2].channel)
    assert.equal(calls[1].channel.RenderWay, 'h5')
    assert.equal(calls[2].api, 'mtop.alsc.bpgw.trade.order.submit')
    assert.equal(calls[2].options.maxRedirects, 0)
    assert.equal(JSON.parse(calls[2].options.form.data).linkage, 'synthetic-linkage')
  } finally { await login.close() }
})
