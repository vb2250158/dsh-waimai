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
  const primitives = Object.fromEntries(['Button', 'Input', 'Switch', 'Menu', 'Checkbox', 'Tag', 'IconPlusOutlineRegular', 'IconChevronDownOutlineRegular', 'IconTrashOutlineRegular'].map(name =>
    [name, props => React.createElement(name === 'Button' ? 'button' : 'span', props, props.children)]))
  runInNewContext(await readFile(new URL('../lib/client/index.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(entry) { module = entry.factory(name => name === 'react' ? React : primitives) } } },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
    structuredClone, setInterval, clearInterval, crypto: { randomUUID: () => 'synthetic-id' },
  })
  const snapshot = { status: 'ready', writable: true, revision: 1, value: Config({}).get() }
  const form = { subscribe: () => () => {}, getSnapshot: () => snapshot, mutate: async () => true }
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
    assert.equal(select().props.disabled, true)
    assert(text(mounted.renderer.toJSON()).includes('当前配送地址'))
    assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call.endpoint === 'selectAddress').payload)), { platformId: 'taobao', accountId: profile.id, addressRef })
    accountId = '999'
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '刷新地址').props.onClick())
    assert(!text(mounted.renderer.toJSON()).includes('示例街道'))
    assert(text(mounted.renderer.toJSON()).includes('账号已变化'))
  } finally { mounted.close() }
})

test('ordering shows only server merchants, surfaces verification and keeps purchase buttons disabled', async () => {
  const mounted = await mount({ async call(_channel, endpoint) {
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in' })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'recentShops') return ok({ accountId: profile.id, shops: [{ id: 'synthetic-shop', name: '示例店' }] })
    if (endpoint === 'probeMenu') return { ok: false, error: { code: 'verification-required', message: '平台要求人工验证' } }
    throw new Error('Unexpected request')
  } })
  try {
    const root = mounted.renderer.root
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '点餐').props.onClick())
    const selector = root.findAll(node => node.type === 'span' && node.props.className === 'waimai-choice').find(node => node.props.items.some(item => item.id === 'synthetic-shop'))
    await act(async () => selector.props.onSelect('synthetic-shop'))
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '检查菜单接口').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('平台要求人工验证'))
    for (const label of ['创建订单', '支付']) assert.equal(root.findAllByType('button').find(button => text(button.props.children) === label).props.disabled, true)
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
