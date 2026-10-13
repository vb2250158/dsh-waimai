import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HemaService } from '../lib/hema-service.js'
import { HemaCartActions } from '../lib/hema-cart.js'

const addressRef = 'a'.repeat(64), productRef = '11111111-1111-4111-8111-111111111111', operationRef = '22222222-2222-4222-8222-222222222222'
const makeLine = (cartId, itemId, skuId, quantity, selected = false) => ({ tag: 'mainItem', fields: { cartId, itemId, title: 'Synthetic water', quantity: String(quantity),
  isChecked: String(selected), canCheck: true, sku: { skuId, skuInvalid: false }, pay: { nowTitle: '￥42.90', payUnit: '/箱' } } })
const other = makeLine('9001', '8001', '7001', 2)
const detail = { templateVO: { global: { itemId: '8002', shopId: '123', itemName: 'Synthetic case', originPrice: 4990, discountPrice: 4290,
  encryptionParams: { convert: false }, showUnit: '箱', saleFlag: true, ifOutRange: false, ifWeight: false, ifTmallItem: false,
  skuItemList: [{ skuId: '7002', saleSpec: '570ml×24', saleUnit: '箱', chargeUnit: '箱', increment: 1, startWith: 1, stockQuantity: 5 }] } } }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'hema-cart-')), calls = [], events = [], nodes = [structuredClone(other)]
  let delay = false, fail = false, foreignChange = false, identity = '12345', readsAfterAdd = 0
  const selected = { ref: addressRef, geoCode: 'private-address', groups: [{ groupId: 'group', ext: { shopIds: '123' } }] }
  const login = { accountId: identity, run: fn => fn(), requireAccount: async () => {}, verifyIdentity: async expected => { if (identity !== expected) throw Error('identity changed') },
    diagnostic: event => events.push(event), protocol: JSON.parse(await readFile(new URL('../lib/hema-protocol.json', import.meta.url), 'utf8')),
    async mtop(spec, payload, retry = true) {
      calls.push({ api: spec.api, method: spec.method || 'GET', payload, retry })
      if (spec.api === 'mtop.wdk.detail.openservice') return { ret: ['SUCCESS::fixture'], data: structuredClone(detail) }
      if (spec.api === 'mtop.wdk.cart.add') { if (fail) throw Error('private network response'); readsAfterAdd = 0; nodes.push(makeLine('9002', payload.itemId, payload.skuId, payload.quantity, true)); return { ret: ['SUCCESS::fixture'], data: {} } }
      if (spec.api !== 'mtop.trade.query.bag') throw Error('unexpected request')
      const items = delay && calls.some(c => c.api === 'mtop.wdk.cart.add') && readsAfterAdd++ === 0 ? nodes.slice(0, 1) : nodes
      const data = { global: { controlParas: { hema: '1' } }, hierarchy: { root: 'root', structure: { root: items.map((_, i) => 'line' + i) } },
        data: { root: { tag: 'cartHemaGlobal', fields: {} }, ...Object.fromEntries(items.map((node, i) => ['line' + i, structuredClone(node)])) } }
      if (foreignChange && calls.some(c => c.api === 'mtop.wdk.cart.add')) data.data.line0.fields.quantity = '9'
      return { ret: ['SUCCESS::fixture'], data }
    }, checkReply: raw => { assert(raw.ret.some(row => row.startsWith('SUCCESS::'))) } }
  const service = new HemaService({ login, directory }); service.selectedAddress = async ref => { if (ref && ref !== addressRef) throw Error('address changed'); return selected }
  service.productReads.set(productRef, { accountId: identity, addressRef, groupId: 'group', id: '8002', nativeShopId: '123' })
  return { service, calls, events, nodes, directory, change: options => { if ('delay' in options) delay = options.delay; if ('fail' in options) fail = options.fail;
    if ('foreignChange' in options) foreignChange = options.foreignChange; if ('identity' in options) identity = options.identity },
    close: () => rm(directory, { recursive: true, force: true }) }
}
async function args(f) { return { addressRef, productRef, skuId: '7002', quantity: 1, revision: (await f.service.cart('hema', addressRef)).revision, operationRef } }

test('Hema add sends one native request, retains every other line and persists verified outcome', async () => {
  const f = await fixture()
  try {
    const result = await f.service.cartAdd('hema', await args(f)), sent = f.calls.filter(c => c.api === 'mtop.wdk.cart.add')
    assert.equal(sent.length, 1); assert.equal(sent[0].method, 'POST'); assert.equal(sent[0].retry, false); assert.equal(sent[0].payload.quantity, 1)
    assert.equal(result.mutation.state, 'verified'); assert.equal(result.items.length, 2); assert.equal(result.items[0].quantity, '2'); assert.equal(result.items[0].selected, false)
    assert.deepEqual(f.events.map(e => e.stage), ['hema-add-sent', 'hema-add-verified'])
    const saved = JSON.parse(await readFile(join(f.directory, 'hema-cart-attempts.json'), 'utf8'))
    assert.equal(saved.attempts[0].before.length, 1); assert.equal(saved.attempts[0].state, 'verified'); assert(!JSON.stringify(result).includes('private-address'))
    await assert.rejects(f.service.cartAdd('hema', await args(f)), e => e.code === 'cart-duplicate'); assert.equal(f.calls.filter(c => c.api === 'mtop.wdk.cart.add').length, 1)
  } finally { await f.close() }
})

test('a delayed cart becomes verified by readback without resending, including after account service reload', async () => {
  const f = await fixture()
  try {
    f.change({ delay: true }); const result = await f.service.cartAdd('hema', await args(f))
    assert.equal(result.mutation.state, 'unconfirmed'); assert.equal(result.items.length, 1)
    f.service.cartActions = new HemaCartActions(f.service, f.directory)
    const read = await f.service.cart('hema', addressRef); assert.equal(read.mutation.state, 'verified')
    const again = await f.service.cart('hema', addressRef); assert.equal(again.mutation.operationRef, operationRef); assert.equal(again.mutation.state, 'verified')
    assert.equal(f.calls.filter(c => c.api === 'mtop.wdk.cart.add').length, 1)
  } finally { await f.close() }
})

test('unknown transport outcomes and changed unrelated lines block subsequent add requests', async () => {
  for (const change of [{ fail: true }, { foreignChange: true }]) {
    const f = await fixture()
    try {
      f.change(change)
      if (change.fail) await assert.rejects(f.service.cartAdd('hema', await args(f)), e => e.code === 'cart-result-unconfirmed')
      else assert.equal((await f.service.cartAdd('hema', await args(f))).mutation.state, 'unconfirmed')
      await assert.rejects(f.service.cartAdd('hema', { ...await args(f), operationRef: productRef }), e => e.code === 'cart-result-unconfirmed')
      assert.equal(f.calls.filter(c => c.api === 'mtop.wdk.cart.add').length, 1)
    } finally { await f.close() }
  }
})

test('stale revision, wrong SKU, invalid quantity and corrupt journals stop before native writes', async () => {
  const f = await fixture()
  try {
    const current = await args(f)
    await assert.rejects(f.service.cartAdd('hema', { ...current, revision: 'b'.repeat(64) }), e => e.code === 'cart-changed')
    await assert.rejects(f.service.cartAdd('hema', { ...current, skuId: '9999' }), e => e.code === 'item-unavailable')
    await assert.rejects(f.service.cartAdd('hema', { ...current, quantity: 0 }), e => e.code === 'spec-required')
    await writeFile(join(f.directory, 'hema-cart-attempts.json'), '{broken')
    await assert.rejects(f.service.cartAdd('hema', current), e => e.code === 'cart-journal-invalid')
    assert.equal(await readFile(join(f.directory, 'hema-cart-attempts.json'), 'utf8'), '{broken'); assert(!f.calls.some(c => c.api === 'mtop.wdk.cart.add'))
  } finally { await f.close() }
})

test('another journal lock blocks writes while cart reads retain its lock and current data', async () => {
  const f = await fixture()
  try {
    const current = await args(f), lock = join(f.directory, 'hema-cart-attempts.json.lock')
    await mkdir(lock)
    await assert.rejects(f.service.cartAdd('hema', current), e => e.code === 'cart-locked')
    assert.equal((await f.service.cart('hema', addressRef)).items.length, 1)
    await rmdir(lock); assert(!f.calls.some(c => c.api === 'mtop.wdk.cart.add'))
  } finally { await f.close() }
})
