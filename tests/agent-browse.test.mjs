import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { registerAgentBrowse } from '../lib/agent-browse.js'
import { menuData } from '../lib/browse-data.js'
import { PlatformError } from '../lib/platform-service.js'

const accountRef = '11111111-1111-4111-8111-111111111111', privateAddress = 'a'.repeat(64)
const args = { platformId: 'taobao', accountRef, scope: 'nearby', keyword: '超市' }
function tools(dispatch, options = {}) {
  const operations = new Map()
  registerAgentBrowse((name, _description, schema, run) => operations.set(name, input => run(z.object(schema).parse(input))),
    { dispatch }, { cursorSeconds: 60, cursorLimit: 2, ...options })
  return (name, input) => operations.get(name)(input)
}

test('merchant browsing preserves the configured platform when omitted from the request', async () => {
  let received
  const run = tools(async (_method, input) => { received = input; return { platformId: input.platformId, scope: 'nearby', shops: [], nextCursor: null } }, { defaultPlatform: 'hema' })
  const value = await run('search_shops', { accountRef, scope: 'nearby', keyword: '' })
  assert.equal(received.platformId, 'hema'); assert.equal(value.platformId, 'hema')
})

test('an empty filtered page keeps a private next position so the agent can reach a later supermarket', async () => {
  const calls = [], native = { offset: 10, accountId: '12345', addressRef: privateAddress, rankId: 'private-rank' }
  const run = tools(async (_method, input) => {
    calls.push(input)
    return input.cursor ? { platformId: 'taobao', scope: 'nearby-recommendations', shops: [{ id: 'market', name: '示例超市' }], nextCursor: null }
      : { platformId: 'taobao', scope: 'nearby-recommendations', shops: [{ id: 'tea', name: '示例茶店' }], nextCursor: native }
  })
  const first = await run('search_shops', args)
  assert.deepEqual(first.shops, []); assert.equal(first.hasMore, true)
  assert(!JSON.stringify(first).includes('12345')); assert(!JSON.stringify(first).includes(privateAddress)); assert(!JSON.stringify(first).includes('private-rank'))
  const next = await run('search_shops', { ...args, cursor: first.nextCursor })
  assert.equal(next.shops[0].name, '示例超市'); assert.equal(next.nextCursor, null)
  assert.deepEqual(calls[1].cursor, native)
  for (const change of [{ accountRef: '22222222-2222-4222-8222-222222222222' }, { keyword: '' }, { scope: 'recent' }, { platformId: 'hema' }]) {
    await assert.rejects(() => run('search_shops', { ...args, cursor: first.nextCursor, ...change }), { code: 'cursor-invalid' })
  }
})

test('expired and evicted browse positions stop before any account read', async () => {
  let time = 0, reads = 0
  const run = tools(async () => { reads++; return { platformId: 'taobao', scope: 'nearby-recommendations', shops: [], nextCursor: { offset: 10 } } }, { now: () => time, cursorLimit: 1 })
  const first = await run('search_shops', args), second = await run('search_shops', args)
  await assert.rejects(() => run('search_shops', { ...args, cursor: first.nextCursor }), { code: 'cursor-expired' })
  time = 61000
  await assert.rejects(() => run('search_shops', { ...args, cursor: second.nextCursor }), { code: 'cursor-expired' })
  assert.equal(reads, 2)
})

test('product queries keep case sizes, deduplicate items, bind one address and separate empty stores from failed reads', async () => {
  const calls = [], item = { id: 'water', name: '百岁山天然矿泉水 570ml×24瓶 整箱', description: '每瓶570ml', price: '59.9', availability: 'available', options: [], tips: [] }
  const run = tools(async (_method, input) => {
    calls.push(input)
    if (input.shopId === 'failed') throw new PlatformError('menu-invalid', '响应无法确认')
    return { platformId: 'taobao', accountId: '12345', addressRef: privateAddress, categories: input.shopId === 'empty' ? [] : [{ items: [item, item, { ...item, id: 'other', name: '纯净水', description: '' }] }],
      ...(input.shopId === 'empty' ? { menuState: 'empty', notice: '暂无可售商品，请改天再来' } : {}) }
  })
  const result = await run('search_products', { platformId: 'taobao', accountRef, keyword: '百岁山', shopIds: ['market', 'market', 'empty', 'failed'] })
  assert.equal(result.stores.length, 3); assert.equal(result.stores[0].items.length, 1)
  assert.equal(result.stores[0].items[0].name, item.name); assert.equal(result.stores[1].state, 'empty'); assert.equal(result.stores[2].state, 'unreadable')
  assert.equal(result.complete, false); assert.equal(result.priceKind, 'listed'); assert.equal(result.scope, 'selected-stores-only')
  assert.equal(calls[1].addressRef, privateAddress); assert(!JSON.stringify(result).includes(privateAddress)); assert(!JSON.stringify(result).includes('12345'))
})

test('product scans abort on address changes and reject blank or excessive query input', async () => {
  const run = tools(async () => { throw new PlatformError('address-changed', '配送地址变化') })
  const query = { platformId: 'taobao', accountRef, keyword: '百岁山', shopIds: ['market'] }
  await assert.rejects(() => run('search_products', query), { code: 'address-changed' })
  for (const change of [{ keyword: ' ' }, { shopIds: [] }, { shopIds: Array(11).fill('market') }]) {
    assert.throws(() => run('search_products', { ...query, ...change }))
  }
})

test('the recorded platform empty-store response displays its notice and rejects other or missing merchant identities', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/grocery-empty.json', import.meta.url), 'utf8'))
  const result = menuData(fixture, 'store-17')
  assert.equal(result.menuState, 'empty'); assert.deepEqual(result.categories, []); assert.equal(result.orderingAvailable, false)
  assert.equal(result.notice, '暂无可售商品，请改天再来'); assert(!JSON.stringify(result).includes('tracking'))
  for (const mutate of [raw => { raw.resultMap.bottom.storeId = 'foreign' }, raw => { delete raw.resultMap.bottom.storeId }, raw => { raw.resultMap.bottom.type = 99 }, raw => { delete raw.resultMap.bottom }]) {
    const invalid = structuredClone(fixture); mutate(invalid); assert.throws(() => menuData(invalid, 'store-17'))
  }
})
