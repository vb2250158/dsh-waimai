import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TaobaoSearch, taobaoSearchPage } from '../lib/taobao-search.js'
import { PlatformError } from '../lib/platform-service.js'

const addressRef = 'a'.repeat(64)
const result = (page = 1, finished = false) => ({ result: [{ pageInfo: { page, pageSize: 10, finished, rankId: 'private-rank' }, listItems: [
  { tItemType: 'mat_shopmode-shop-item-v2', info: { restaurant: { id: 'shop1', name: '示例店', isAd: false }, foods: [
    { itemIdStr: '123456789012345678', restaurantId: 'shop1', name: '饮用水', price: 12.9, stock: 2 },
  ] } },
  { tItemType: 'feedback', info: { privateTracking: 'private' } },
] }] })

test('projects current search cards without tracking and treats price as a display price', () => {
  const page = taobaoSearchPage(result())
  assert.equal(page.items[0].id, '123456789012345678')
  assert.equal(page.items[0].price, '12.9')
  assert.equal(page.items[0].availability, 'unknown')
  assert.equal(page.unknownCards, 1)
  assert(!JSON.stringify(page.items).includes('private'))
  const ad = result(); ad.result[0].listItems[0].info.restaurant.isAd = 'true'
  assert.deepEqual(taobaoSearchPage(ad).items, [])
  assert.equal(taobaoSearchPage(ad, false).items[0].shopIsAd, true)
  const foreign = result(); foreign.result[0].listItems[0].info.foods[0].restaurantId = 'other'
  assert.throws(() => taobaoSearchPage(foreign))
})

test('continuations bind account, address and keyword and never disclose provider pagination', async () => {
  const calls = [], login = { accountId: '123', protocol: { catalogSearch: {} },
    run: fn => fn(), requireAccount: async () => {}, mtop: async (_spec, payload) => {
      const query = JSON.parse(payload.params); calls.push(query); return { ret: ['SUCCESS::ok'], data: result(query.page, query.page === 2) }
    } }
  const service = { login, pageSize: 10, cursorSeconds: 30, cursorLimit: 2, hideSponsoredShops: true, selectedAddress: async ref => {
    if (ref && ref !== addressRef) throw new Error('address mismatch')
    return { ref: addressRef, coordinates: { latitude: '1', longitude: '2' } }
  }, checkReply: () => {} }
  const search = new TaobaoSearch(service), first = await search.search({ keyword: '水' })
  assert.equal(first.items.length, 1); assert(first.hasMore)
  assert(!JSON.stringify(first.nextCursor).includes('private-rank'))
  await assert.rejects(() => search.search({ keyword: '茶', cursor: first.nextCursor }), { code: 'search-changed' })
  const next = await search.search({ keyword: '水', addressRef, cursor: first.nextCursor })
  assert.equal(next.hasMore, false); assert.equal(calls[1].rankId, 'private-rank'); assert.equal(calls[1].offset, 10)
  login.accountId = '456'
  await assert.rejects(() => search.search({ keyword: '水', cursor: first.nextCursor }), { code: 'search-changed' })
})

test('address and identity changes after the network read prevent publishing results', async () => {
  let selected = 0, user = 0
  const login = { accountId: '123', protocol: { catalogSearch: {} }, run: fn => fn(),
    requireAccount: async () => { if (++user > 1) login.accountId = '456' },
    mtop: async () => ({ ret: ['SUCCESS::ok'], data: result(1, true) }) }
  const service = { login, pageSize: 10, cursorSeconds: 30, cursorLimit: 2, hideSponsoredShops: true, selectedAddress: async () => {
    selected++; return { ref: addressRef, coordinates: { latitude: '1', longitude: '2' } }
  }, checkReply: () => {} }
  await assert.rejects(() => new TaobaoSearch(service).search({ keyword: '水' }), { code: 'account-changed' })
  assert.equal(selected, 1)
  user = 0; login.accountId = '123'; login.requireAccount = async () => {}
  service.selectedAddress = async ref => {
    if (ref) throw new PlatformError('address-changed', '地址已变化')
    return { ref: addressRef, coordinates: { latitude: '1', longitude: '2' } }
  }
  await assert.rejects(() => new TaobaoSearch(service).search({ keyword: '水' }), { code: 'address-changed' })
})

test('search continuation expires according to the configured lifetime', async () => {
  let now = 1000
  const service = { cursorSeconds: 30, cursorLimit: 2, pageSize: 10, hideSponsoredShops: true,
    selectedAddress: async () => ({ ref: addressRef, coordinates: { latitude: '1', longitude: '2' } }), checkReply: () => {},
    login: { accountId: '123', protocol: { catalogSearch: {} }, run: fn => fn(), requireAccount: async () => {},
      mtop: async () => ({ ret: ['SUCCESS::ok'], data: result() }) } }
  const search = new TaobaoSearch(service, () => now), first = await search.search({ keyword: '水' })
  now += 30000
  await assert.rejects(() => search.search({ keyword: '水', cursor: first.nextCursor }), { code: 'search-changed' })
})
