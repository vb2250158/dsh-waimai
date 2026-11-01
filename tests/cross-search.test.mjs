import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { crossSearch, crossSearchPage } from '../lib/cross-search.js'
import { registerLoginRpc } from '../lib/login-rpc.js'
import { LOGIN_TOOLS } from '../lib/login.js'
import { PlatformError } from '../lib/platform-service.js'

const accountRef = '11111111-1111-4111-8111-111111111111', addressRef = 'a'.repeat(64)
const cursor = { platformId: 'hema', ref: '22222222-2222-4222-8222-222222222222' }
const owner = { platformId: 'hema', accountRef }, keyword = 'water'
const shops = [{ id: 'group-1', name: 'One' }, { id: 'group-2', name: 'Two' }]

function pool({ fail, changeOnFinal = false } = {}) {
  const calls = []
  return { calls, async dispatch(method, args) {
    calls.push({ method, args })
    if (changeOnFinal && method === 'nearbyShops' && args.addressRef) throw new PlatformError('address-changed', 'address changed')
    if (method === 'nearbyShops') return { accountId: '123', addressRef, shops }
    if (fail) throw fail
    return { accountId: '123', addressRef, shopId: args.shopId, categories: [{ items: [{ id: 'item-1', name: 'water' }] }],
      hasMore: !args.cursor, nextCursor: args.cursor ? null : cursor }
  } }
}

test('search preserves platform scope and defers groups without claiming other platforms', async () => {
  const p = pool(), result = await crossSearch(p, { keyword: ' water ', accounts: [owner,
    { platformId: 'jd', accountRef }, { platformId: 'meituan', accountRef: null }] })
  assert.equal(result.keyword, keyword)
  const [hema, taobao, meituan] = result.platforms
  assert.equal(hema.state, 'partial'); assert.equal(hema.scope, 'delivery-stores')
  assert.equal(hema.groups[0].state, 'ready'); assert.deepEqual(hema.groups[0].items, [{ id: 'item-1', name: 'water' }])
  assert.deepEqual(hema.groups[0].nextCursor, cursor); assert.equal(hema.groups[1].state, 'deferred')
  assert.equal(taobao.state, 'unavailable'); assert.equal(meituan.state, 'unavailable')
  assert.equal(p.calls.filter(call => call.method === 'probeMenu').length, 1)
  assert.equal(p.calls.at(-1).args.addressRef, addressRef)
  assert(!JSON.stringify(result).includes('accountId'))
})

test('Taobao cross-store results preserve individual shops and platform-owned pagination', async () => {
  const calls = [], taobao = { platformId: 'taobao', accountRef }
  const next = { platformId: 'taobao', ref: cursor.ref }
  const p = { async dispatch(method, args) {
    calls.push({ method, args })
    return { addressRef, items: [{ shopId: 'shop-1', shopName: 'Store', name: 'water' }], unknownCards: 1, hasMore: !args.cursor, nextCursor: args.cursor ? null : next }
  } }
  const result = await crossSearch(p, { keyword, accounts: [taobao] }), platform = result.platforms[0]
  assert.equal(platform.scope, 'platform'); assert.equal(platform.state, 'partial')
  assert.deepEqual(platform.groups[0].items[0], { shopId: 'shop-1', shopName: 'Store', name: 'water' })
  const page = await crossSearchPage(p, { ...taobao, keyword, shopId: 'platform', addressRef, cursor: next })
  assert.equal(page.hasMore, false); assert.equal(page.unknownCards, 1); assert.deepEqual(calls[1].args.cursor, next)
  const last = await crossSearch({ dispatch: async () => ({ addressRef, items: [], hasMore: false, nextCursor: null, unknownCards: 1 }) },
    { keyword, accounts: [taobao] })
  assert.equal(last.platforms[0].state, 'partial'); assert.equal(last.platforms[0].groups[0].unknownCards, 1)
  await assert.rejects(crossSearchPage(p, { ...taobao, keyword, shopId: 'shop-1', addressRef, cursor: next }), { code: 'bad-request' })
  await assert.rejects(crossSearchPage(p, { ...taobao, keyword, shopId: 'platform', addressRef, cursor }))
})

test('page revalidates the selected address and group, and forwards opaque continuation', async () => {
  const p = pool(), result = await crossSearchPage(p, { ...owner, keyword, shopId: 'group-2', addressRef, cursor })
  assert.equal(result.shopName, 'Two'); assert.equal(result.hasMore, false); assert.equal(result.nextCursor, null)
  assert.deepEqual(p.calls.find(call => call.method === 'probeMenu').args.cursor, cursor)
  assert.equal(p.calls.at(-1).args.addressRef, addressRef)
  await assert.rejects(crossSearchPage(p, { ...owner, keyword, shopId: 'wrong', addressRef }), { code: 'address-changed' })
})

test('ordinary group errors stay retryable but address and account changes discard all groups', async () => {
  const temporary = await crossSearch(pool({ fail: new PlatformError('menu-unavailable', 'try again') }), { keyword, accounts: [owner] })
  assert.equal(temporary.platforms[0].state, 'partial'); assert.equal(temporary.platforms[0].groups[0].state, 'error')
  const changed = await crossSearch(pool({ fail: new PlatformError('account-changed', 'changed') }), { keyword, accounts: [owner] })
  assert.equal(changed.platforms[0].state, 'error'); assert.deepEqual(changed.platforms[0].groups, [])
  const late = await crossSearch(pool({ changeOnFinal: true }), { keyword, accounts: [owner] })
  assert.equal(late.platforms[0].error.code, 'address-changed'); assert.deepEqual(late.platforms[0].groups, [])
})

test('unknown errors never reveal remote response data', async () => {
  const result = await crossSearch(pool({ fail: new Error('cookie=private') }), { keyword, accounts: [owner] })
  assert(!JSON.stringify(result).includes('cookie=private'))
})

test('private search RPC enforces authentication and exact request fields', async () => {
  let route; const calls = []
  registerLoginRpc({ inject(_names, callback) { callback({ effect: create => create(),
    connection: { requestRejection: req => req.headers.authorization === 'session' ? undefined : 401 },
    webServer: { register(value) { route = value; return () => {} } } }) } },
  { call: async (name, args) => { calls.push({ name, args }); return { success: true, data: {} } } })
  const server = createServer((req, res) => { void route.handler(req, res) }); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (endpoint, payload, auth = 'session') => fetch(`http://127.0.0.1:${server.address().port}/waimai-login/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: endpoint, payload }) })
  try {
    assert.equal((await call('crossSearch', { keyword, accounts: [owner] }, '')).status, 401)
    for (const [endpoint, payload] of [
      ['crossSearch', { keyword, accounts: [owner, owner] }],
      ['crossSearch', { keyword, accounts: [{ ...owner, extra: true }] }],
      ['crossSearchPage', { ...owner, keyword, shopId: 'group-1' }],
      ['crossSearchPage', { ...owner, keyword, shopId: 'group-1', addressRef, cursor: { ...cursor, url: 'https://invalid.example' } }],
    ]) assert.equal((await (await call(endpoint, payload)).json()).result.ok, false)
    assert.equal(calls.length, 0)
    assert.equal((await (await call('crossSearch', { keyword, accounts: [owner] })).json()).result.ok, true)
    assert.equal((await (await call('crossSearchPage', { ...owner, keyword, shopId: 'group-1', addressRef, cursor })).json()).result.ok, true)
    assert.deepEqual(calls.map(call => call.name), ['account_cross_search', 'account_cross_search_page'])
    assert(calls.every(call => LOGIN_TOOLS.includes(call.name)))
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
