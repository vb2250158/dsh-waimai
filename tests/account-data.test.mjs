import { test } from 'node:test'
import assert from 'node:assert/strict'
import { profileData, avatarUrl, orderPage, OrderCursor, taobaoDisplayProfile, taobaoPortrait } from '../lib/account-data.js'

const entry = { orderId: 'synthetic-order', storeName: '示例店', orderCreateTime: 1700000000000, orderAmount: '25.50',
  orderStatusBar: { title: '已完成' }, orderItemList: [{ name: '示例饭', count: 2, cover: 'untrusted-url' }], address: 'private-address', paymentAction: 'private-action' }
const position = { pageNum: 0, fromTime: 0, lastBillMonth: '00' }
const result = { orderList: [entry], moreInfo: { hasMore: true, moreInfoParams: { pageNum: 1, fromTime: 1700000000000, privateField: 'secret' } } }

test('Taobao self-profile prefers the display nickname and keeps absent nicknames unnamed', () => {
  const profile = data => taobaoDisplayProfile({ ret: ['SUCCESS::synthetic'], data: { userNumId: '87654', ...data } })
  assert.deepEqual(profile({ displayNick: ' 昵称 ', nick: 'opaque-login-name', token: 'private' }), { id: '87654', nickname: '昵称', nativeNickname: 'opaque-login-name' })
  assert.equal(profile({ displayNick: ' ', nick: '账户昵称' }).nickname, '账户昵称')
  assert.equal(profile({}).nickname, null)
  assert.throws(() => taobaoDisplayProfile({ ret: ['FAIL_SYS_USER_NOT_LOGIN::synthetic'], data: { userNumId: '87654', nick: 'other' } }))
  assert.throws(() => profile({ userNumId: 'not-an-id' }))
})

test('Taobao portraits bind the native nickname and accept only passive CDN images', () => {
  const raw = userLogo => ({ ret: ['SUCCESS::synthetic'], data: { model: { userNick: 'original-nickname', userLogo } } })
  assert.equal(taobaoPortrait(raw('http://img.alicdn.com/sns_logo/test-avatar.jpg'), 'original-nickname'), 'https://img.alicdn.com/sns_logo/test-avatar.jpg')
  assert.throws(() => taobaoPortrait(raw('https://img.alicdn.com/other.jpg'), 'other-account'))
  for (const value of ['https://evil.example/avatar.png','https://img.alicdn.com/avatar.png?token=private','https://private@img.alicdn.com/avatar.png','javascript:alert(1)']) assert.equal(taobaoPortrait(raw(value), 'original-nickname'), null)
  assert.equal(taobaoPortrait(raw(null), 'original-nickname'), null)
})

test('profile projection binds the account, masks phone and accepts only the platform avatar hash', () => {
  const user = profileData({ user_id: 12345, username: '示例用户', mobile: '13800000000', avatar: 'a'.repeat(32) + 'png', email: 'private' }, '12345')
  assert.deepEqual(user, { id: '12345', nickname: '示例用户', maskedPhone: '138****0000', avatarUrl: 'https://cube.elemecdn.com/a/aa/' + 'a'.repeat(29) + 'png.png' })
  assert.throws(() => profileData({ user_id: 99, username: 'other' }, '12345'), /mismatch/)
  for (const value of ['https://evil.example/image.png', 'javascript:alert(1)', '../avatar.png', '', null]) assert.equal(avatarUrl(value), null)
  assert.equal(profileData({ user_id: 12345, username: '', mobile: 'unexpected' }, '12345').maskedPhone, null)
  assert.equal(profileData({ user_id: 12345, username: '淘宝用户', mobile: null, avatar: 'a'.repeat(32) + 'png' }, '12345').avatarUrl, user.avatarUrl)
})

test('order projection strips address, images, payment actions and extra cursor fields', () => {
  assert.deepEqual(orderPage(result, 10, position), { orders: [{ id: 'synthetic-order', merchantName: '示例店', createdAt: 1700000000000,
    amount: '25.50', status: '已完成', items: [{ name: '示例饭', count: 2 }] }], nextCursor: { pageNum: 1, fromTime: 1700000000000 } })
  assert.deepEqual(orderPage({ orderList: [], moreInfo: { hasMore: false } }, 10, position), { orders: [], nextCursor: null })
})

test('history rejects duplicate IDs, oversized pages, malformed prices and cursors that cannot advance', () => {
  for (const invalid of [ { ...result, accountBindWrong: true }, { ...result, orderList: [entry, entry] }, { ...result, orderList: Array(11).fill(entry) },
    { ...result, orderList: [{ ...entry, orderAmount: '-1' }] }, { ...result, moreInfo: { hasMore: true } },
    { ...result, moreInfo: { hasMore: true, moreInfoParams: position } } ]) assert.throws(() => orderPage(invalid, 10, position))
  for (const cursor of [{ pageNum: -1, fromTime: 0 }, { pageNum: 1, fromTime: 0, accountId: '12345' }, { pageNum: 1, fromTime: 0, lastBillMonth: 'javascript' }]) assert.equal(OrderCursor.safeParse(cursor).success, false)
})
