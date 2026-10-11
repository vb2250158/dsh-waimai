import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uccSession } from '../lib/taobao-ucc.js'

const value = { site: 25, data: { userId: 54321, loginServiceExt: { localId: '12345' }, cookies: [
  'SID=synthetic%2Fopaque; Domain=.ele.me; Path=/; HttpOnly; Max-Age=3600',
  'USERID=12345; Domain=.ele.me; Path=/; HttpOnly',
  'SID=synthetic-native; Domain=.eleme.cn; Path=/; HttpOnly' ] } }
const response = data => ({ ret: ['SUCCESS::synthetic'], data: { actionType: 'OTHER', code: 3000, returnValue: JSON.stringify(data) } })

test('UCC parses only the verified Eleme business session and retains opaque cookie values', () => {
  const result = uccSession(response(value))
  assert.equal(result.accountId, '12345'); assert.equal(result.havanaId, '54321'); assert.equal(result.cookies.length, 2)
  assert.equal(result.cookies[0].value, 'synthetic%2Fopaque'); assert.equal(result.cookies[0].secure, true)
  assert(result.cookies[0].expires > Date.now() / 1000); assert(result.cookies.every(c => c.domain === '.ele.me'))
  for (const raw of [null, { ret: 'SUCCESS' }, { ret: ['FAIL::synthetic'] }, { ...response(value), data: { actionType: 'H5', code: 3000 } }, { ...response(value), data: { actionType: 'OTHER', code: 1 } }]) assert.equal(uccSession(raw), null)
})

test('untrusted domains, malformed or expired cookies and mismatched identity are rejected without leaking credentials', () => {
  for (const changed of [ { ...value, site: 1 }, { ...value, data: { ...value.data, userId: Number.MAX_SAFE_INTEGER + 1 } },
    ...['SID=synthetic-secret; Domain=.evil.example; Path=/', 'SID=synthetic-secret; Domain=.ele.me; Path=/private',
      'SID=synthetic-secret; Domain=.ele.me; Path=/; Expires=bad', 'SID=synthetic-secret; Domain=.ele.me; Path=/; Max-Age=0',
      'SID=synthetic-secret; Domain=.ele.me; Path=/; SameSite=bad', 'USERID=999; Domain=.ele.me; Path=/'].map(cookie => ({ ...value, data: { ...value.data, cookies: [cookie, value.data.cookies[1]] } })),
    { ...value, data: { ...value.data, cookies: [...value.data.cookies, value.data.cookies[0]] } },
    { ...value, data: { ...value.data, cookies: ['__proto__=synthetic-secret; Domain=.ele.me; Path=/', ...value.data.cookies] } } ]) {
    assert.throws(() => uccSession(response(changed)), e => /授权响应无法确认/.test(e.message) && !e.message.includes('synthetic-secret'))
  }
})
