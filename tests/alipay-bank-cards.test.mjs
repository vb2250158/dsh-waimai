import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAlipayBankCards, readAlipayBankCards } from '../lib/alipay-bank-cards.js'
const card = { partnerId: 'TESTBANK', providerName: '测试银行', providerUserName: '1234', cardType: 'DC', signId: 'synthetic-binding' }

test('card projection retains only private binding identity and masked display fields', () => {
  const value = parseAlipayBankCards({ stat: 'ok', results: [{ ...card, encryptCardNo: 'secret', providerUserId: 'secret', showUserName: 'private person' }] })
  assert.deepEqual(value, [{ bankCode: 'TESTBANK', bankName: '测试银行', lastFour: '1234', cardType: 'DC', bindingId: 'synthetic-binding' }])
  assert.deepEqual(parseAlipayBankCards({ stat: 'ok', results: [] }), [])
})

test('failed, malformed, duplicate and unmasked card records are not treated as empty success', () => {
  for (const raw of [{ stat: 'fail', results: [] }, { stat: 'ok' },
    { stat: 'ok', results: [card, card] },
    ...[{ providerUserName: '1234567890123456' }, { providerName: '<script>private</script>' }, { cardType: 'unknown' }, { signId: '' }]
      .map(change => ({ stat: 'ok', results: [{ ...card, ...change }] }))]) {
    assert.throws(() => parseAlipayBankCards(raw), error => error.code === 'alipay-cards-unconfirmed' && !error.message.includes('private'))
  }
})

test('discovery uses only the observed fixed GET with redirects disabled and releases every response', async () => {
  let disposed = 0
  const http = { async get(url, options) {
    assert.equal(url, 'https://zht.alipay.com/asset/bindQuery.json')
    assert.equal(options.maxRedirects, 0)
    assert.equal(options.headers.Referer, 'https://zht.alipay.com/asset/bankList.htm')
    assert.deepEqual(options.params, { _input_charset: 'utf-8', providerType: 'BANK', t: '123' })
    return { status: () => 200, headers: () => ({ 'content-type': 'application/json;charset=UTF-8' }),
      body: async () => Buffer.from(JSON.stringify({ stat: 'ok', results: [card] })), dispose: async () => { disposed++ } }
  } }
  assert.equal((await readAlipayBankCards(http, { now: () => 123 })).length, 1)
  assert.equal(disposed, 1)
})

test('login redirects and HTML responses never claim an empty card list', async () => {
  for (const [status, type, code] of [[302, 'text/html', 'alipay-cards-verification-required'], [403, 'text/html', 'alipay-cards-verification-required'], [200, 'text/html', 'alipay-cards-unconfirmed']]) {
    let disposed = false
    await assert.rejects(readAlipayBankCards({ get: async () => ({ status: () => status, headers: () => ({ 'content-type': type }),
      json: async () => assert.fail('must not parse'), dispose: async () => { disposed = true } }) }), { code })
    assert(disposed)
  }
  await assert.rejects(readAlipayBankCards({ get: async () => { throw Error('secret provider URL') } }), error => error.code === 'alipay-cards-unavailable' && !error.message.includes('secret'))
})


test('official GB18030 responses preserve bank names rather than replacement characters', async () => {
  const raw = JSON.stringify({ stat: 'ok', results: [{ ...card, providerName: 'BANKNAME' }] })
  const [before, after] = raw.split('BANKNAME')
  const bytes = Buffer.concat([Buffer.from(before), Buffer.from('d6d0b9fad2f8d0d0', 'hex'), Buffer.from(after)])
  const http = { get: async () => ({ status: () => 200, headers: () => ({ 'content-type': 'application/json;charset=GB18030' }), body: async () => bytes, dispose: async () => {} }) }
  assert.equal((await readAlipayBankCards(http))[0].bankName, '中国银行')
})
