import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { Config } from '../lib/index.js'

const profile = { id: '12345', nickname: '示例用户', maskedPhone: '138****0000', avatarUrl: 'https://cube.elemecdn.com/a/aa/' + 'a'.repeat(29) + 'png.png' }
const order = { id: 'synthetic-order', merchantName: '示例店', createdAt: 1700000000000, amount: '25.50', status: '已完成', items: [{ name: '示例饭', count: 2 }] }
const ok = value => ({ ok: true, value })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const text = node => typeof node === 'string' ? node : (Array.isArray(node) ? node : node?.children || []).map(text).join('')
const accountTree = node => typeof node === 'string' ? node : { type: node.type,
  props: Object.fromEntries(Object.entries(node.props).filter(([key]) => ['className', 'aria-label', 'src', 'alt', 'width', 'height', 'referrerPolicy'].includes(key))),
  children: node.children.map(accountTree) }

async function mount(rpc, options = {}) {
  const originalCall = rpc.call.bind(rpc)
  const platforms = JSON.parse(await readFile(new URL('../lib/platforms.json', import.meta.url), 'utf8'))
  rpc = { call(channel, endpoint, payload) {
    if (endpoint === 'platforms') return Promise.resolve(ok(platforms))
    if (endpoint === 'addresses') return options.addresses ? options.addresses(payload) : Promise.resolve(ok({ accountId: profile.id, addresses: [], selectedRef: null }))
    return originalCall(channel, endpoint, payload)
  } }
  let module, Card, cardProps, dictionary
  const disposers = []
  const primitives = Object.fromEntries(['Button', 'Input', 'Switch', 'Menu', 'Checkbox', 'Tag', 'StateDot', 'IconPlusOutlineRegular', 'IconChevronDownOutlineRegular', 'IconTrashOutlineRegular'].map(name =>
    [name, props => React.createElement(name === 'Button' ? 'button' : 'span', props, props.children)]))
  runInNewContext(await readFile(new URL('../lib/client/index.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(entry) { module = entry.factory(name => name === 'react' ? React : primitives) } } },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
    structuredClone, setInterval, clearInterval, setTimeout, clearTimeout, crypto: { randomUUID: () => 'synthetic-id' },
  })
  const snapshot = { status: 'ready', writable: true, revision: 1, value: Config(options.config || {}).get() }
  const form = { subscribe: () => () => {}, getSnapshot: () => snapshot, mutate: options.mutate || (async () => true) }
  const ctx = {
    effect(fn) { disposers.push(fn()) }, connection: { rpc },
    locale: { register(_namespace, values) { dictionary = values.zh; return () => {} }, bind: () => key => dictionary[key] },
    configForms: { get: () => form, whileServed(_names, fn) { fn(); return () => {} } },
    slots: { inject(_slot, fn) { return fn() }, register(spec, component) { Card = component; cardProps = spec.inject(); return () => {} } },
  }
  module.apply(ctx)
  let renderer
  await act(async () => { renderer = create(React.createElement(Card, cardProps)) })
  return { renderer, close: () => { act(() => renderer.unmount()); for (const dispose of disposers.reverse()) dispose?.() } }
}

test('Taobao QR renders in the private plugin page, preserves the current account until linked and cancels on tab change', async () => {
  const calls = [], attemptId = '11111111-1111-4111-8111-111111111111'
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in', loginMethod: 'sms' })
    if (endpoint === 'accountBegin') return ok({ authenticated: true, state: 'logged-in', loginMethod: 'sms', addingAccount: true })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'qrStart') return ok({ authenticated: true, state: 'logged-in', addingAccount: true, qr: { attemptId, state: 'business-unconfirmed', image: 'data:image/png;base64,synthetic', pollAfterMs: 2000 } })
    if (endpoint === 'qrCancel') return ok({ qr: { attemptId, state: 'canceled' } })
    return ok({ accountId: profile.id, orders: [], nextCursor: null })
  } })
  try {
    const root = mounted.renderer.root
    const click = label => root.findAllByType('button').find(button => text(button.props.children) === label).props.onClick()
    assert(!root.findAllByType('button').some(button => text(button.props.children) === '获取淘宝登录二维码'))
    await act(async () => click('添加账号'))
    await act(async () => click('获取淘宝登录二维码'))
    const image = root.findAllByType('img').find(value => value.props.alt === '淘宝扫码')
    assert.equal(image.props.src, 'data:image/png;base64,synthetic')
    assert(text(mounted.renderer.toJSON()).includes('闪购账号授权尚未确认'))
    assert(text(mounted.renderer.toJSON()).includes(profile.nickname))
    assert(!calls.some(value => value.endpoint === 'qrPoll'))
    await act(async () => click('历史订单'))
    assert(!root.findAllByType('img').some(value => value.props.alt === '淘宝扫码'))
    assert(calls.some(value => value.endpoint === 'qrCancel' && value.payload.attemptId === attemptId))
  } finally { mounted.close() }
})

test('account dropdown changes only the current view and scopes orders to the chosen account', async () => {
  const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222'
  const calls = [], accounts = [{ ref: first, externalId: profile.id, nickname: profile.nickname }, { ref: second, externalId: '67890', nickname: '第二账号' }]
  const rpc = { async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    const ref = payload.accountRef || first
    if (endpoint === 'status' || endpoint === 'accountView') return ok({ authenticated: true, state: 'logged-in', loginMethod: 'sms', viewAccountRef: ref, accounts })
    if (endpoint === 'profile') return ok(ref === first ? profile : { ...profile, id: '67890', nickname: '第二账号' })
    return ok({ accountId: ref === first ? profile.id : '67890', orders: [{ ...order, merchantName: ref === first ? '第一账号的店' : '第二账号的店' }], nextCursor: null })
  } }
  const a = await mount(rpc), b = await mount(rpc)
  try {
    const selector = a.renderer.root.findAll(node => node.props.selectedId === first && Array.isArray(node.props.items)).find(node => node.type === 'span')
    assert.deepEqual(JSON.parse(JSON.stringify(selector.props.items)), JSON.parse(await readFile(new URL('./fixtures/account-selector.json', import.meta.url), 'utf8')))
    await act(async () => selector.props.onSelect(second))
    assert(text(a.renderer.toJSON()).includes('第二账号'))
    assert(text(b.renderer.toJSON()).includes('账号 ID: 12345'))
    await act(async () => a.renderer.root.findAllByType('button').find(button => text(button.props.children) === '历史订单').props.onClick())
    assert(text(a.renderer.toJSON()).includes('第二账号的店'))
    assert(!text(a.renderer.toJSON()).includes('第一账号的店'))
    assert.equal(calls.findLast(value => value.endpoint === 'orders').payload.accountRef, second)
    assert(!calls.some(value => value.endpoint === 'accountSelect'))
  } finally { a.close(); b.close() }
})

test('adding a SMS account retains the saved account while entering the new phone and code', async () => {
  let adding = false, pending
  const calls = [], first = '11111111-1111-4111-8111-111111111111'
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'accountBegin') { adding = true; pending = { state: 'not-checked', codePending: false } }
    if (endpoint === 'sendCode') pending = { state: 'code-sent', codePending: true, maskedPhone: '139****0000', retryAfterSeconds: 60 }
    if (endpoint === 'accountCancel') { adding = false; pending = undefined }
    return ok({ authenticated: true, state: 'logged-in', loginMethod: 'sms', viewAccountRef: first,
      accounts: [{ ref: first, externalId: profile.id, nickname: profile.nickname }], addingAccount: adding, pendingLogin: pending })
  } })
  try {
    const root = mounted.renderer.root, click = label => root.findAllByType('button').find(button => text(button.props.children) === label).props.onClick()
    await act(async () => click('添加账号'))
    await act(async () => click('手机号短信'))
    let phone = root.findAll(node => node.props.type === 'tel').find(node => node.type === 'span')
    act(() => phone.props.onChange({ target: { value: '13900000000' } }))
    await act(async () => click('获取验证码'))
    phone = root.findAll(node => node.props.type === 'tel').find(node => node.type === 'span')
    assert.equal(phone.props.value, '13900000000')
    assert(text(mounted.renderer.toJSON()).includes('账号 ID: 12345'))
    assert(text(mounted.renderer.toJSON()).includes('139****0000'))
    assert.equal(calls.find(value => value.endpoint === 'sendCode').payload.accountRef, first)
    await act(async () => click('取消添加'))
    assert(!root.findAll(node => node.props.type === 'tel').some(node => node.type === 'span'))
  } finally { mounted.close() }
})

test('the settings page renders avatar, account details and orders, replaces pages and clears data on logout', async () => {
  let signedIn = true
  const calls = []
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    if (endpoint === 'status') return ok({ authenticated: signedIn, state: signedIn ? 'logged-in' : 'logged-out' })
    if (endpoint === 'profile') return ok(profile)
    return ok({ accountId: profile.id, orders: [{ ...order, id: payload.cursor ? 'older-order' : order.id, merchantName: payload.cursor ? '更早的店' : order.merchantName }],
      nextCursor: payload.cursor ? null : { pageNum: 1, fromTime: order.createdAt } })
  } })
  try {
    const root = mounted.renderer.root
    const account = root.findByProps({ className: 'waimai-account' })
    assert.deepEqual(accountTree(account), JSON.parse(await readFile(new URL('./fixtures/account-card.json', import.meta.url), 'utf8')))
    const avatar = root.findByType('img')
    assert.equal(avatar.props.src, profile.avatarUrl)
    assert.equal(avatar.props.referrerPolicy, 'no-referrer')
    assert.equal(avatar.props.alt, '用户头像')
    assert(text(mounted.renderer.toJSON()).includes('账号 ID: 12345'))
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '历史订单').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('示例饭 × 2'))
    assert(text(mounted.renderer.toJSON()).includes('¥25.50'))
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '下一页').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('更早的店'))
    assert(!text(mounted.renderer.toJSON()).includes('示例店'))
    assert.equal(root.findAllByProps({ className: 'waimai-order' }).length, 1)
    assert.equal(calls.find(call => call.payload.cursor)?.payload.cursor.pageNum, 1)
    act(() => root.findByType('img').props.onError())
    assert.equal(root.findAllByType('img').length, 0)
    signedIn = false
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '检查登录状态').props.onClick())
    assert.equal(root.findAllByProps({ className: 'waimai-account' }).length, 0)
    assert.equal(root.findAllByProps({ className: 'waimai-order' }).length, 0)
    assert(!text(mounted.renderer.toJSON()).includes(profile.maskedPhone))
  } finally { mounted.close() }
})

test('platform switching clears the account view and unavailable platforms never receive account requests', async () => {
  const calls = []
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in' })
    if (endpoint === 'profile') return ok(profile)
    return ok({ accountId: profile.id, orders: [], nextCursor: null })
  } })
  try {
    const root = mounted.renderer.root
    const view = { platforms: root.findAll(node => node.type === 'span' && node.props.className === 'waimai-choice')[0].props.items,
      tabs: root.findByType('nav').findAllByType('button').map(button => ({ label: text(button.props.children), selected: button.props['aria-pressed'] })) }
    assert.deepEqual(JSON.parse(JSON.stringify(view)), JSON.parse(await readFile(new URL('./fixtures/platform-card.json', import.meta.url), 'utf8')))
    assert.equal(root.findAllByProps({ className: 'waimai-account' }).length, 1)
    await act(async () => root.findAll(node => node.type === 'span' && node.props.className === 'waimai-choice')[0].props.onSelect('meituan'))
    assert.equal(root.findAllByProps({ className: 'waimai-account' }).length, 0)
    assert(!text(mounted.renderer.toJSON()).includes(profile.nickname))
    assert(text(mounted.renderer.toJSON()).includes('尚未接入'))
    assert(calls.every(call => call.payload.platformId === 'taobao'))
    await act(async () => root.findAll(node => node.type === 'span' && node.props.className === 'waimai-choice')[0].props.onSelect('jd'))
    assert(calls.every(call => call.payload.platformId === 'taobao'))
  } finally { mounted.close() }
})

test('address selection confirms the saved reference and hides addresses from another account', async () => {
  let selectedRef = null
  let accountId = profile.id
  const addressRef = 'a'.repeat(64)
  const calls = []
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in' })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'selectAddress') { selectedRef = payload.addressRef; return ok({ accountId, selectedRef }) }
    throw new Error('Unexpected request')
  } }, { addresses: async () => ok({ accountId, selectedRef, addresses: [{ ref: addressRef, address: '示例街道 示例房间', contact: '示例联系人', maskedPhone: '138****0000', label: '家', usable: true }] }) })
  try {
    const root = mounted.renderer.root
    const select = () => root.findAllByType('button').find(button => text(button.props.children) === '使用此地址')
    assert.equal(select().props.disabled, false)
    await act(async () => select().props.onClick())
    assert.equal(select(), undefined)
    assert(text(mounted.renderer.toJSON()).includes('当前配送地址'))
    assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call.endpoint === 'selectAddress').payload)), { platformId: 'taobao', accountId: profile.id, addressRef })
    accountId = '999'
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '刷新地址').props.onClick())
    assert(!text(mounted.renderer.toJSON()).includes('示例街道'))
    assert(text(mounted.renderer.toJSON()).includes('账号已变化'))
  } finally { mounted.close() }
})

test('ordering shows nearby server merchants after address selection and surfaces verification without purchase actions', async () => {
  const addressRef = 'a'.repeat(64)
  const mounted = await mount({ async call(_channel, endpoint) {
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in' })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'nearbyShops') return ok({ accountId: profile.id, addressRef, shops: [{ id: 'synthetic-shop', name: '示例店' }], nextCursor: null })
    if (endpoint === 'probeMenu') return { ok: false, error: { code: 'verification-required', message: '平台要求人工验证' } }
    throw new Error('Unexpected request')
  } }, { addresses: async () => ok({ accountId: profile.id, selectedRef: addressRef,
    addresses: [{ ref: addressRef, address: '示例地址', contact: '示例联系人', maskedPhone: '', usable: true }] }) })
  try {
    const root = mounted.renderer.root
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '点餐').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('示例店'))
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '查看菜单').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('平台要求人工验证'))
    assert(!root.findAllByType('button').some(button => ['创建订单', '支付'].includes(text(button.props.children))))
    assert(text(mounted.renderer.toJSON()).includes('下单与支付暂未开放'))
  } finally { mounted.close() }
})

test('ordering requires an address, edits it in place and discards late menus when it changes', async () => {
  const refs = ['a'.repeat(64), 'b'.repeat(64)], pending = deferred(), calls = []
  let selectedRef = null
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in' })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'selectAddress') { selectedRef = payload.addressRef; return ok({ accountId: profile.id, selectedRef }) }
    if (endpoint === 'nearbyShops' || endpoint === 'recentShops') return ok({ accountId: profile.id, addressRef: selectedRef,
      shops: [{ id: 'synthetic-shop', name: selectedRef === refs[0] ? '旧地址店铺' : '新地址店铺' }], nextCursor: null })
    if (endpoint === 'probeMenu') return pending.promise
    throw Error('Unexpected request')
  } }, { addresses: async () => ok({ accountId: profile.id, selectedRef,
    addresses: refs.map((ref, i) => ({ ref, address: `示例地址${i}`, contact: '联系人', maskedPhone: '', usable: true })) }) })
  try {
    const root = mounted.renderer.root, click = label => root.findAllByType('button').find(button => text(button.props.children) === label).props.onClick()
    await act(async () => click('点餐'))
    assert(text(mounted.renderer.toJSON()).includes('先选择配送地址'))
    assert(!calls.some(value => ['nearbyShops', 'recentShops'].includes(value.endpoint)))
    await act(async () => click('使用此地址'))
    assert(text(mounted.renderer.toJSON()).includes('旧地址店铺'))
    let read
    act(() => { read = click('查看菜单') })
    await act(async () => click('使用此地址'))
    assert(!text(mounted.renderer.toJSON()).includes('旧地址店铺'))
    assert(text(mounted.renderer.toJSON()).includes('新地址店铺'))
    await act(async () => { pending.resolve(ok({ accountId: profile.id, addressRef: refs[0], shopId: 'synthetic-shop', categories: [{ id: 'old', name: '旧菜单', items: [] }] })); await read })
    assert(!text(mounted.renderer.toJSON()).includes('旧菜单'))
    assert.equal(calls.findLast(value => value.endpoint === 'nearbyShops').payload.addressRef, refs[1])
  } finally { mounted.close() }
})

test('an all-sponsored page explains filtering and keeps the next page usable', async () => {
  const addressRef = 'a'.repeat(64), cursors = [], cursor = { offset: 10, rankId: 'synthetic', addressRef, accountId: profile.id }
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in' })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'nearbyShops') {
      cursors.push(payload.cursor)
      return ok({ accountId: profile.id, addressRef, shops: payload.cursor ? [{ id: 'store-17', name: '普通店铺', isAd: false }] : [],
        filteredAds: payload.cursor ? 0 : 10, nextCursor: payload.cursor ? null : cursor })
    }
    throw Error('Unexpected request')
  } }, { addresses: async () => ok({ accountId: profile.id, selectedRef: addressRef,
    addresses: [{ ref: addressRef, address: '示例地址', contact: '联系人', maskedPhone: '', usable: true }] }) })
  try {
    const root = mounted.renderer.root, click = label => root.findAllByType('button').find(button => text(button.props.children) === label).props.onClick()
    await act(async () => click('点餐'))
    const empty = root.find(node => node.props.className === 'waimai-empty')
    const output = { empty: text(empty), nextPage: root.findAllByType('button').filter(button => text(button.props.children) === '下一页店铺').length }
    assert.deepEqual(output, JSON.parse(await readFile(new URL('./fixtures/ads-view.json', import.meta.url), 'utf8')))
    assert(!text(mounted.renderer.toJSON()).includes('该地址暂未返回附近店铺'))
    await act(async () => click('下一页店铺'))
    assert.deepEqual(cursors[1], cursor); assert(text(mounted.renderer.toJSON()).includes('普通店铺'))
    assert(!text(mounted.renderer.toJSON()).includes('本页店铺均为推广'))
    assert.equal(root.findAllByType('tag').filter(node => text(node) === '广告').length, 0)
  } finally { mounted.close() }
})

test('menu view renders real categories, listed prices and options, filters dishes and retains data after refresh failure', async () => {
  const addressRef = 'a'.repeat(64)
  const { menuData } = await import('../lib/browse-data.js')
  const menu = menuData(JSON.parse(await readFile(new URL('./fixtures/menu.json', import.meta.url), 'utf8')), 'store-17')
  let fail = false
  const mounted = await mount({ async call(_channel, endpoint) {
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in' })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'nearbyShops') return ok({ accountId: profile.id, addressRef, shops: [{ id: 'store-17', name: '示例店' }], nextCursor: null })
    if (endpoint === 'probeMenu') return fail ? { ok: false, error: { code: 'menu-unavailable', message: '平台暂不可用' } } : ok({ ...menu, accountId: profile.id, addressRef })
    throw Error('Unexpected request')
  } }, { addresses: async () => ok({ accountId: profile.id, selectedRef: addressRef, addresses: [{ ref: addressRef, address: '示例地址', contact: '联系人', maskedPhone: '', usable: true }] }) })
  try {
    const root = mounted.renderer.root, click = label => root.findAllByType('button').find(button => text(button.props.children) === label).props.onClick()
    await act(async () => click('点餐'))
    await act(async () => click('查看菜单'))
    const cards = () => root.findAllByType('article').filter(node => node.props.className === 'waimai-food-card')
    const summary = cards().map(node => ({ name: text(node.findAllByType('strong')[0]), price: text(node.find(node => node.props.className === 'waimai-price')), options: node.findAllByType('summary').map(text) }))
    assert.deepEqual(summary, JSON.parse(await readFile(new URL('./fixtures/browse-view.json', import.meta.url), 'utf8')))
    assert(text(mounted.renderer.toJSON()).includes('已售罄'))
    const input = root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索这家店的菜品')[0]
    act(() => input.props.onChange({ target: { value: '汤' } }))
    assert.equal(cards().length, 1)
    fail = true
    await act(async () => click('刷新菜单'))
    assert.equal(cards().length, 1); assert(text(mounted.renderer.toJSON()).includes('平台暂不可用'))
  } finally { mounted.close() }
})

test('account mismatches hide private data, and late reads after unmount cannot restore it', async () => {
  const pending = deferred()
  const mounted = await mount({ async call(_channel, endpoint) {
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in' })
    if (endpoint === 'profile') return ok(profile)
    return pending.promise
  } })
  try {
    await act(async () => mounted.renderer.root.findAllByType('button').find(button => text(button.props.children) === '历史订单').props.onClick())
    await act(async () => pending.resolve(ok({ accountId: '999', orders: [order], nextCursor: null })))
    assert.equal(mounted.renderer.root.findAllByProps({ className: 'waimai-account' }).length, 0)
    assert.equal(mounted.renderer.root.findAllByProps({ className: 'waimai-order' }).length, 0)
    assert(text(mounted.renderer.toJSON()).includes('账号已变化'))
  } finally { mounted.close() }
  const late = deferred()
  const second = await mount({ async call(_channel, endpoint) { return endpoint === 'status' ? ok({ authenticated: true, state: 'logged-in' }) : late.promise } })
  second.close()
  await act(async () => late.resolve(ok(profile)))
  assert.equal(second.renderer.toJSON(), null)
})

test('navigation retains the account context across settings and only shows login fields while adding an account', async () => {
  const first = '11111111-1111-4111-8111-111111111111', calls = []
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in', loginMethod: 'taobao-qr', viewAccountRef: first,
      accounts: [{ ref: first, nickname: profile.nickname, externalId: profile.id, loginMethod: 'taobao-qr' }] })
    if (endpoint === 'profile') return ok(profile)
    return ok({ accountId: profile.id, orders: [order], nextCursor: null })
  } })
  try {
    const root = mounted.renderer.root, click = label => root.findAllByType('button').find(button => text(button.props.children) === label).props.onClick()
    assert(!root.findAll(node => node.props.type === 'tel').length)
    assert(!root.findAllByType('button').some(button => text(button.props.children) === '获取淘宝登录二维码'))
    assert(root.findAll(node => Array.isArray(node.props.items)).some(node => node.props.items.some(item => item.label.includes('淘宝扫码'))))
    await act(async () => click('点单设置'))
    assert(root.findAll(node => node.props.selectedId === first).length)
    await act(async () => click('历史订单'))
    assert.equal(calls.filter(call => call.endpoint === 'status').length, 1)
    assert.equal(calls.findLast(call => call.endpoint === 'orders').payload.accountRef, first)
    const details = root.findAllByType('details').find(node => text(node).includes(order.id))
    assert(details); assert.notEqual(details.props.open, true)
  } finally { mounted.close() }
})

test('a failed same-account history refresh keeps the last verified page and provides a retry action', async () => {
  let rejected = false
  const mounted = await mount({ async call(_channel, endpoint) {
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in' })
    if (endpoint === 'profile') return ok(profile)
    if (rejected) throw Error('synthetic transport failure')
    return ok({ accountId: profile.id, orders: [order], nextCursor: null })
  } })
  try {
    const root = mounted.renderer.root, click = label => root.findAllByType('button').find(button => text(button.props.children) === label).props.onClick()
    await act(async () => click('历史订单'))
    rejected = true
    await act(async () => click('刷新订单'))
    assert(text(mounted.renderer.toJSON()).includes(order.merchantName))
    assert(text(mounted.renderer.toJSON()).includes('读取失败'))
    assert.equal(root.findAllByType('button').find(button => text(button.props.children) === '刷新订单').props.disabled, false)
  } finally { mounted.close() }
})

test('the task view shows only its platform and edits preserve tasks belonging to other platforms', async () => {
  let operations
  const config = { autoTasks: [{ id: 'other', name: '其他平台任务', platformId: 'jd' }, { id: 'current', name: '当前平台任务', platformId: 'taobao' }] }
  const mounted = await mount({ async call(_channel, endpoint) { return endpoint === 'profile' ? ok(profile) : ok({ authenticated: true, state: 'logged-in' }) } },
    { config, mutate: async ops => { operations = ops; return true } })
  try {
    const root = mounted.renderer.root, click = label => root.findAllByType('button').find(button => text(button.props.children) === label).props.onClick()
    await act(async () => click('自动化任务'))
    assert(text(mounted.renderer.toJSON()).includes('当前平台任务'))
    assert(!text(mounted.renderer.toJSON()).includes('其他平台任务'))
    await act(async () => root.findAllByType('button').find(button => button.props['aria-label'] === '编辑任务: 当前平台任务').props.onClick())
    act(() => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '任务名称')[0].props.onChange({ target: { value: '修改后的任务' } }))
    await act(async () => root.findByType('form').props.onSubmit({ preventDefault() {} }))
    assert.equal(operations[0].value[0].name, '其他平台任务')
    assert.equal(operations[0].value[1].name, '修改后的任务')
  } finally { mounted.close() }
})
