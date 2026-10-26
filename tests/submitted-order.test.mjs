import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paymentDestination, submittedOrder } from '../lib/trade-data.js'
import { cashierParameters } from '../lib/cashier.js'

test('official post-cashier JSON preserves created order IDs and supplies the browser cashier', () => {
  const payUrl = 'https://r.ele.me/payment?termNos=synthetic&deviceExtParams=%7B%7D'
  assert.deepEqual(submittedOrder({ bizOrderId: '123,123', nextUrl: JSON.stringify({ cashierType: 'POST_STANDARD', payUrl }) }),
    { orderIds: ['123'], paymentUrl: payUrl })
  assert.equal(submittedOrder({ bizOrderId: '123', nextUrl: payUrl }).paymentUrl, payUrl)
})

test('official native cashier maps to the same HTTPS endpoint with its query unchanged', () => {
  const nextUrl = JSON.stringify({ cashierType: 'POST_STANDARD', payUrl: 'eleme://cashier?termNos=synthetic%2Breference&deviceExtParams=%7B%7D' })
  const order = submittedOrder({ bizOrderId: '123', nextUrl })
  assert.equal(order.paymentUrl, 'https://r.ele.me/payment?termNos=synthetic%2Breference&deviceExtParams=%7B%7D')
  assert.equal(cashierParameters(order.paymentUrl).termNos, 'synthetic+reference')
  assert.equal(paymentDestination('eleme://cashier?checkoutOrderNos=synthetic'), 'https://r.ele.me/payment?checkoutOrderNos=synthetic')
})

test('native cashier conversion does not admit credentials, alternate hosts, paths, ports or fragments', () => {
  for (const payUrl of ['eleme://cashier.attacker.test?termNos=synthetic', 'eleme://u:p@cashier?termNos=synthetic',
    'eleme://cashier:123?termNos=synthetic', 'eleme://cashier/other?termNos=synthetic', 'eleme://cashier?termNos=synthetic#other',
    'alipays://cashier?termNos=synthetic', 'https://r.ele.me.attacker.test/payment?termNos=synthetic']) {
    assert.equal(submittedOrder({ bizOrderId: '123', nextUrl: JSON.stringify({ cashierType: 'POST_STANDARD', payUrl }) }).paymentUrl, null)
  }
})

test('pre-cashier SDK payloads and malformed handoffs do not discard created orders or invent a cashier', () => {
  for (const nextUrl of ['{broken', JSON.stringify({ cashierType: 'PRE_STANDARD', payUrl: 'sdk-private-payload' }),
    JSON.stringify({ cashierType: 'PRE_STANDARD', payUrl: 'https://r.ele.me/payment?termNos=synthetic' }),
    JSON.stringify({ cashierType: 'POST_STANDARD', payUrl: 'https://mclient.alipay.com/cashier' }), '{}', 'null']) {
    assert.deepEqual(submittedOrder({ bizOrderId: '123', nextUrl }), { orderIds: ['123'], paymentUrl: null })
  }
  assert.throws(() => submittedOrder({ bizOrderId: 'unknown', nextUrl: 'https://r.ele.me/payment?termNos=synthetic' }))
})
