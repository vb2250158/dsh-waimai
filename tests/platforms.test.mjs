import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addressCoordinates, addressRecords } from '../lib/address-data.js'
import { PlatformService } from '../lib/platform-service.js'
import { WaimaiLogin } from '../lib/login.js'

const raw = { id: 17, user_id: 12345, address: '示例街道', address_detail: '示例房间', name: '示例联系人', phone: '13800000000',
  city_name: '示例城市', tag: '家', is_valid: 1, st_geohash: 'wx4g0ec1', geohash: null }
async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-platform-'))
  const calls = []
  const login = { accountId: '12345', historyPageSize: 10, protocol: { orders: { client: {} }, menu: { api: 'captured-menu' } },
    run: operation => operation(), requireAccount: async () => { calls.push('account') },
    get: async url => { calls.push(url); return { json: async () => login.raw } }, raw: [raw],
    mtop: async (spec, payload) => { calls.push({ spec, payload }); return login.reply },
    reply: { ret: ['SUCCESS::synthetic'], data: { result: { orderList: [ { eleMeStoreId: 'store-17', storeName: '示例店' }, { eleMeStoreId: 'store-17', storeName: '示例店' } ] } } } }
  const service = new PlatformService({ login, directory, ...options })
  return { directory, calls, login, service, close: () => rm(directory, { recursive: true, force: true }) }
}

test('address projection masks contact phone and rejects foreign, duplicate and malformed records', () => {
  const [result] = addressRecords([raw], '12345')
  assert.equal(result.display.usable, true)
  assert.equal(result.display.maskedPhone, '138****0000')
  assert(!JSON.stringify(result.display).includes(raw.phone))
  assert.equal(result.display.nativeId, undefined)
  assert.throws(() => addressRecords([raw], '999'))
  assert.throws(() => addressRecords([raw, raw], '12345'))
  assert.throws(() => addressRecords([{ ...raw, is_valid: -1 }], '12345'))
  assert.equal(addressRecords([{ ...raw, st_geohash: null }], '12345')[0].display.usable, false)
  assert.notEqual(result.ref, addressRecords([{ ...raw, user_id: 999 }], '999')[0].ref)
})

test('geohash decoder returns the documented coordinate cell and rejects invalid locations', () => {
  const centre = addressCoordinates('ezs42')
  assert(Math.abs(centre.latitude - 42.60498046875) < 1e-9)
  assert(Math.abs(centre.longitude + 5.60302734375) < 1e-9)
  for (const value of [null, '', 'abc', 'abcde!', 'iiiiiiii']) assert.equal(addressCoordinates(value), null)
})

test('unsupported platforms reject before account reads and all purchasing capabilities are disabled', async () => {
  const f = await fixture()
  try {
    for (const id of ['meituan', 'jd', 'invalid']) assert.throws(() => f.service.addresses(id))
    for (const id of ['taobao', 'meituan', 'jd']) for (const capability of ['checkout', 'createOrder', 'payment']) assert.throws(() => f.service.requireOrdering(id, capability))
    assert.deepEqual(f.calls, [])
    const definitions = f.service.list(); definitions[0].capabilities.createOrder = true
    assert.equal(f.service.list()[0].capabilities.createOrder, false)
  } finally { await f.close() }
})

test('delivery selection survives reload, requires fresh account ownership and cannot survive an account change', async () => {
  const f = await fixture()
  try {
    const page = await f.service.addresses('taobao')
    assert.equal(page.selectedRef, null)
    await assert.rejects(f.service.prepare('taobao'), error => error.code === 'address-required')
    await assert.rejects(f.service.selectAddress('taobao', '999', page.addresses[0].ref), error => error.code === 'account-changed')
    await f.service.selectAddress('taobao', page.accountId, page.addresses[0].ref)
    const saved = await readFile(f.service.selectionPath, 'utf8')
    assert(!saved.includes(raw.name)); assert(!saved.includes(raw.phone)); assert(!saved.includes(raw.address))
    const reload = new PlatformService({ login: f.login, directory: f.directory })
    assert.equal((await reload.addresses('taobao')).selectedRef, page.addresses[0].ref)
    const summary = await reload.prepare('taobao')
    assert.equal(summary.transport, 'http'); assert(!JSON.stringify(summary).includes(page.accountId))
    f.login.accountId = '999'; f.login.raw = [{ ...raw, user_id: 999 }]
    assert.equal((await reload.addresses('taobao')).selectedRef, null)
    await assert.rejects(reload.prepare('taobao'), error => error.code === 'address-required')
  } finally { await f.close() }
})

test('invalid durable selections and removed addresses stop requests without overwriting the original', async () => {
  const f = await fixture()
  try {
    await writeFile(f.service.selectionPath, '{damaged')
    await assert.rejects(f.service.addresses('taobao'), error => error.code === 'selection-invalid')
    assert.equal(await readFile(f.service.selectionPath, 'utf8'), '{damaged')
    await assert.rejects(f.service.selectAddress('taobao', '12345', '0'.repeat(64)), error => error.code === 'address-unavailable')
  } finally { await f.close() }
})

test('recent merchants are deduplicated and limited to real latest-page orders', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.service.recentShops('taobao'), error => error.code === 'address-required')
    assert(!f.calls.some(value => value.spec))
    const page = await f.service.addresses('taobao')
    await f.service.selectAddress('taobao', page.accountId, page.addresses[0].ref)
    const result = await f.service.recentShops('taobao', '示例')
    assert.equal(result.scope, 'recent-orders-only')
    assert.deepEqual(result.shops, [{ id: 'store-17', name: '示例店' }])
    assert.equal((await f.service.recentShops('taobao', 'no-match')).shops.length, 0)
    f.login.reply.data.result.accountBindWrong = true
    await assert.rejects(f.service.recentShops('taobao'), error => error.code === 'orders-unavailable')
  } finally { await f.close() }
})

test('menus use the selected address, stop on verification and reject missing display data', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.service.probeMenu('taobao', 'store-17'), error => error.code === 'address-required')
    assert(!f.calls.some(value => value.spec))
    const page = await f.service.addresses('taobao')
    await f.service.selectAddress('taobao', page.accountId, page.addresses[0].ref)
    f.login.reply = { ret: ['FAIL_SYS_USER_VALIDATE::synthetic'], data: {} }
    await assert.rejects(f.service.probeMenu('taobao', 'store-17'), error => error.code === 'verification-required')
    const request = f.calls.find(value => value.spec)
    assert.equal(request.payload.addressId, String(raw.id))
    assert.deepEqual({ latitude: request.payload.latitude, longitude: request.payload.longitude }, addressCoordinates(raw.st_geohash))
    f.login.reply = { ret: ['SUCCESS::synthetic'], data: {} }
    await assert.rejects(f.service.probeMenu('taobao', 'store-17'), error => error.code === 'menu-invalid')
    f.login.reply.data = JSON.parse(await readFile(new URL('./fixtures/menu.json', import.meta.url), 'utf8'))
    const result = await f.service.probeMenu('taobao', 'store-17', page.addresses[0].ref)
    assert.equal(result.categories[0].items.length, 2)
    const requests = f.calls.filter(value => value.spec).length
    await assert.rejects(f.service.probeMenu('taobao', 'store-17', 'b'.repeat(64)), error => error.code === 'address-changed')
    assert.equal(f.calls.filter(value => value.spec).length, requests)
  } finally { await f.close() }
})

test('read-only Mtop POST signs the body without leaking it into the URL and does not follow redirects', async () => {
  const requests = []
  const login = new WaimaiLogin({ statePath: '/unused', persistLogin: false, createContext: async () => ({
    storageState: async () => ({ cookies: [{ name: '_m_h5_tk', domain: '.ele.me', value: 'synthetic-token_999' }] }),
    post: async (url, options) => { requests.push({ url, options }); return { ok: () => true, json: async () => ({ ret: ['FAIL_SYS_USER_VALIDATE::synthetic'] }) } }, dispose: async () => {},
  }) })
  try {
    await login.init()
    await login.mtop(login.protocol.menu, { addressId: 'synthetic-address' })
    assert.equal(requests.length, 1)
    assert.equal(new URL(requests[0].url).searchParams.has('data'), false)
    assert.equal(requests[0].options.maxRedirects, 0)
    assert.equal(requests[0].options.form.data, JSON.stringify({ addressId: 'synthetic-address' }))
    assert(!requests[0].url.includes('synthetic-token'))
  } finally { await login.close() }
})

test('nearby reads require a fresh address, use its coordinates and reject cursors belonging to another account or address', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.service.nearbyShops('taobao'), error => error.code === 'address-required')
    assert(!f.calls.some(value => value.spec))
    const page = await f.service.addresses('taobao'), addressRef = page.addresses[0].ref
    await f.service.selectAddress('taobao', page.accountId, addressRef)
    f.login.protocol.nearby = { api: 'nearby-first' }; f.login.protocol.nearbyNext = { api: 'nearby-next' }
    f.login.reply = { ret: ['SUCCESS::synthetic'], data: { data: { frontend_page_shop_list_recommend: { error: {},
      customized: { hasNext: true, rankId: 'synthetic-rank' }, fields: { items: [{ bizCode: 'shop', fields: { restaurant: { id: 'store-17', name: '示例店' } } }] } } } } }
    const first = await f.service.nearbyShops('taobao', undefined, addressRef)
    const request = f.calls.find(value => value.spec)
    assert.equal(request.spec.api, 'nearby-first')
    assert.deepEqual({ latitude: request.payload.latitude, longitude: request.payload.longitude }, addressCoordinates(raw.st_geohash))
    assert.equal(JSON.parse(request.payload.pageParams).limit, 10)
    await f.service.nearbyShops('taobao', first.nextCursor, addressRef)
    assert.equal(f.calls.filter(value => value.spec).at(-1).spec.api, 'nearby-next')
    const count = f.calls.filter(value => value.spec).length
    for (const cursor of [{ ...first.nextCursor, accountId: '999' }, { ...first.nextCursor, addressRef: 'b'.repeat(64) }]) {
      await assert.rejects(f.service.nearbyShops('taobao', cursor, addressRef), error => error.code === 'address-changed')
    }
    assert.equal(f.calls.filter(value => value.spec).length, count)
    f.login.raw = []
    await assert.rejects(f.service.recentShops('taobao'), error => error.code === 'address-required')
    assert.equal(f.calls.filter(value => value.spec).length, count)
  } finally { await f.close() }
})

test('nearby HTTP reads apply the configured advertising preference without changing their next offset', async () => {
  for (const hideSponsoredShops of [true, false]) {
    const f = await fixture({ hideSponsoredShops })
    try {
      const page = await f.service.addresses('taobao'), ref = page.addresses[0].ref
      await f.service.selectAddress('taobao', page.accountId, ref)
      f.login.protocol.nearby = { api: 'nearby-first' }
      f.login.reply = { ret: ['SUCCESS::synthetic'], data: { data: { frontend_page_shop_list_recommend: { error: {},
        customized: { hasNext: true, rankId: 'synthetic-rank' }, fields: { items: [{ bizCode: 'shop', fields: {
          restaurant: { id: 'store-17', name: '推广店', adInfo: { isAd: 'true' } } } }] } } } } }
      const result = await f.service.nearbyShops('taobao', undefined, ref)
      assert.equal(result.shops.length, hideSponsoredShops ? 0 : 1)
      assert.equal(result.filteredAds, hideSponsoredShops ? 1 : 0)
      if (!hideSponsoredShops) assert.equal(result.shops[0].isAd, true)
      assert.equal(result.nextCursor.offset, 10)
    } finally { await f.close() }
  }
})
