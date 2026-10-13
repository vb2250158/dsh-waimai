import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { registerAgentOrdering } from '../lib/agent-ordering.js'

const ref = '11111111-1111-4111-8111-111111111111', address = 'a'.repeat(64), revision = 'b'.repeat(64)
function tools(dispatch) {
  const registrations = new Map()
  registerAgentOrdering((name, description, schema, run) => registrations.set(name, { description, schema: z.object(schema).strict(), run }), { dispatch })
  return async (name, args) => { const tool = registrations.get(name); return tool.run(tool.schema.parse(args)) }
}
const cart = { platformId: 'taobao', accountId: 'private-account', addressRef: address, shopId: 'store-17', revision, items: [], quantity: 1 }
const quote = { ...cart, address: { address: 'private address' }, quoteRef: '22222222-2222-4222-8222-222222222222', merchant: '示例店', totalCents: 2100, maxOrderCents: 3500 }

test('agent submit returns a capped confirmation card without calling the private submit or exposing an address', async () => {
  const calls = [], call = tools(async (method, args) => { calls.push({ method, args }); return method === 'cart' ? cart : quote })
  const result = await call('submit_order', { accountRef: ref, shopId: 'store-17', maxAmount: 25 })
  assert.equal(result.state, 'awaiting-user-confirmation'); assert.equal(result.maxAmountCents, 2500)
  assert.equal(result.accountRef, ref); assert.equal(result.revision, revision)
  assert(!JSON.stringify(result).includes('private')); assert.deepEqual(calls.map(c => c.method), ['cart', 'checkout'])
  await assert.rejects(call('submit_order', { accountRef: ref, shopId: 'store-17', maxAmount: 20 }), error => error.code === 'over-cap')
  assert(!calls.some(c => c.method === 'submit'))
})

test('agent cart changes resolve the selected address and use only validated current selection fields', async () => {
  const calls = [], call = tools(async (method, args) => { calls.push({ method, args }); return cart })
  const result = await call('change_cart', { accountRef: ref, shopId: 'store-17', revision, step: 1, itemId: 'food-1' })
  assert.equal(result.revision, revision); assert(!result.accountId); assert.match(calls[0].args.operationRef, /^[a-f0-9-]{36}$/)
  await assert.rejects(call('change_cart', { accountRef: ref, shopId: 'store-17', revision, step: -1, itemId: 'food-1' }))
  await assert.rejects(call('change_cart', { accountRef: ref, shopId: 'store-17', revision, step: 1, itemId: 'food-1', selectionRef: ref }))
  assert.equal(calls.length, 1)
})

test('recommendation cards use existing menu identities and never add items', async () => {
  const calls = [], call = tools(async method => { calls.push(method); return { categories: [{ items: [{ id: 'food-1', name: '示例饭', price: '20' }] }] } })
  const result = await call('show_order', { accountRef: ref, shopId: 'store-17', itemIds: ['food-1'], maxAmount: 40 })
  assert.equal(result.view, 'ordering'); assert.deepEqual(result.itemIds, ['food-1']); assert.equal(result.maxAmountCents, 4000)
  await assert.rejects(call('show_order', { accountRef: ref, shopId: 'store-17', itemIds: ['missing'] }), error => error.code === 'item-unavailable')
  assert(calls.every(method => method === 'probeMenu'))
})

test('payment cards project official order status without credentials or payment URLs and never charge', async () => {
  const calls = [], call = tools(async method => {
    calls.push(method)
    return method === 'tradeHistory' ? { attempts: [{ orderRef: ref, status: 'created', orderIds: ['123'], amountCents: 2100, paymentUrl: 'https://r.ele.me/payment?private=secret', paymentStatus: 'unconfirmed' }] }
      : { orders: [{ id: '123', status: '待支付', amount: '21', merchantName: '示例店' }, { id: '456', status: '其他账号订单' }] }
  })
  const result = await call('request_payment', { accountRef: ref, orderRef: ref })
  assert(!JSON.stringify(result).includes('secret')); assert.equal(result.attempts[0].officialOrders.length, 1)
  assert.equal(result.attempts[0].officialOrders[0].status, '待支付'); assert.equal(result.attempts[0].paymentStatus, 'unconfirmed')
  assert.deepEqual(calls, ['tradeHistory', 'orders'])
})

test('Hema agent cart and SKU add use the shared account owner and retain the action identity', async () => {
  const calls = [], call = tools(async (method, args) => { calls.push({ method, args }); return { platformId: 'hema', accountId: 'private-account',
    addressRef: address, revision, items: [], mutation: { operationRef: ref, state: 'unconfirmed' } } })
  const current = await call('get_cart', { platformId: 'hema', accountRef: ref })
  assert.equal(current.view, 'cart'); assert.equal(current.accountRef, ref); assert(!JSON.stringify(current).includes('private-account')); assert(!current.addressRef)
  const result = await call('add_product_to_cart', { platformId: 'hema', accountRef: ref, productRef: ref, skuId: '7002', quantity: 1, revision, operationRef: ref })
  assert.deepEqual(calls.map(row => row.method), ['cart', 'cartAdd']); assert.equal(calls[1].args.operationRef, ref); assert.equal(result.mutation.state, 'unconfirmed')
})
