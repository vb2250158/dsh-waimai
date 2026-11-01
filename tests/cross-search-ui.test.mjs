import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
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
  const entries = new Map()
  const localStorage = options.storage || { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
  const originalCall = rpc.call.bind(rpc)
  const platforms = JSON.parse(await readFile(new URL('../lib/platforms.json', import.meta.url), 'utf8'))
  rpc = { call(channel, endpoint, payload) {
    if (endpoint === 'platforms') return options.platforms ? options.platforms() : Promise.resolve(ok(platforms))
    if (endpoint === 'addresses') return options.addresses ? options.addresses(payload) : Promise.resolve(ok({ accountId: profile.id, addresses: [], selectedRef: null }))
    if (payload.platformId === 'taobao' && ['cart', 'tradeHistory', 'itemOptions', 'cartChange', 'checkout', 'submit'].includes(endpoint)) {
      if (options.trade) return options.trade(endpoint, payload)
      return Promise.resolve(ok(endpoint === 'tradeHistory' ? { platformId: 'taobao', accountId: profile.id, attempts: [] }
        : { platformId: 'taobao', accountId: profile.id, addressRef: payload.addressRef, shopId: payload.shopId,
          revision: 'b'.repeat(64), items: [], quantity: 0, invalidCount: 0, totalCents: 0 }))
    }
    return originalCall(channel, endpoint, payload)
  } }
  let module, Card, cardProps, dictionary
  const toolCards = new Map()
  const disposers = []
  const primitives = Object.fromEntries(['Button', 'Input', 'Switch', 'Menu', 'Checkbox', 'Tag', 'StateDot', 'IconPlusOutlineRegular', 'IconChevronDownOutlineRegular', 'IconTrashOutlineRegular'].map(name =>
    [name, props => React.createElement(name === 'Button' ? 'button' : 'span', props, props.children)]))
  primitives.Checkbox = props => {
    assert.equal(typeof props.label, 'string'); assert.equal(typeof props.checked, 'boolean')
    return React.createElement('span', props, props.label)
  }
  primitives.Modal = props => props.open ? React.createElement('section', { role: 'dialog', 'aria-label': props.title, onClose: props.onClose }, props.children, props.footer) : null
  primitives.Toast = props => React.createElement('div', { role: 'alert' }, props.text)
  runInNewContext(await readFile(new URL('../lib/client/index.js', import.meta.url), 'utf8'), {
    window: { localStorage, __ModuleLoader__: { load(entry) { module = entry.factory(name => name === 'react' ? React : primitives) } } },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
    navigator: { userAgent: 'synthetic-browser' },
    structuredClone, setInterval, clearInterval, setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout, crypto: { randomUUID },
  })
  const snapshot = { status: 'ready', writable: true, revision: 1, value: Config(options.config || {}).get() }
  const listeners = new Set()
  let currentSnapshot = snapshot
  const form = { subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) }, getSnapshot: () => currentSnapshot, mutate: options.mutate || (async () => true) }
  const ctx = {
    effect(fn) { disposers.push(fn()) }, connection: { rpc },
    locale: { register(_namespace, values) { dictionary = values.zh; return () => {} }, bind: () => key => dictionary[key] },
    configForms: { get: () => form, whileServed(_names, fn) { fn(); return () => {} } },
    slots: { inject(_slot, fn) { return fn() }, register(spec, component) { if (spec.name === "tool.call.toolview") toolCards.set(spec.key, { component, props: spec.inject() }); else { Card = component; cardProps = spec.inject(); } return () => {} } },
  }
  module.apply(ctx)
  let renderer
  await act(async () => { const selected = options.tool ? toolCards.get(options.tool.name) : { component: Card, props: cardProps }; renderer = create(React.createElement(selected.component, { ...selected.props, toolName: options.tool?.name, ...options.tool?.props })) })
  return { renderer, updateConfig: config => {
    currentSnapshot = { ...currentSnapshot, revision: currentSnapshot.revision + 1, value: Config(config).get() }
    for (const listener of listeners) listener()
  }, close: () => { act(() => renderer.unmount()); for (const dispose of disposers.reverse()) dispose?.() } }
}

test('cross-platform search binds accounts and automatically searches a deferred store with its original address', async () => {
  const taobao = '11111111-1111-4111-8111-111111111111', hema = '22222222-2222-4222-8222-222222222222'
  const addressRef = 'a'.repeat(64), calls = []
  const item = { id: 'item-1', name: '示例水', description: '一箱', price: '20.00', priceUnit: '箱', productRef: '33333333-3333-4333-8333-333333333333' }
  const group = { shopId: 'store-1', shopName: '示例店', addressRef, items: [], state: 'deferred', hasMore: false, nextCursor: null }
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload: structuredClone(payload) })
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: [{ ref: payload.platformId === 'taobao' ? taobao : hema, nickname: payload.platformId }] })
    if (endpoint === 'crossSearch') return ok({ keyword: payload.keyword, platforms: [
      { platformId: 'taobao', accountRef: taobao, state: 'unavailable', scope: 'unavailable', groups: [] },
      { platformId: 'hema', accountRef: hema, state: 'partial', scope: 'delivery-stores', groups: [group] },
    ] })
    if (endpoint === 'crossSearchPage') return ok({ ...group, ...payload, state: 'ready', items: [item] })
    throw Error('Unexpected operation ' + endpoint)
  } })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
    await act(async () => button('跨平台搜索').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('美团外卖'))
    assert(text(mounted.renderer.toJSON()).includes('尚未接入'))
    const field = root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0]
    await act(async () => field.props.onChange({ target: { value: '矿泉水' } }))
    await act(async () => button('搜索').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('配送范围内门店'))
    assert.deepEqual(calls.find(call => call.endpoint === 'crossSearch').payload, { keyword: '矿泉水', accounts: [
      { platformId: 'taobao', accountRef: taobao }, { platformId: 'hema', accountRef: hema },
    ] })
    assert(text(mounted.renderer.toJSON()).includes('示例水'))
    assert(!text(mounted.renderer.toJSON()).includes('部分结果未返回'))
    assert(text(mounted.renderer.toJSON()).includes('搜索结果遵循隐藏推广店铺设置'))
    assert.deepEqual(calls.find(call => call.endpoint === 'crossSearchPage').payload, {
      platformId: 'hema', accountRef: hema, keyword: '矿泉水', shopId: 'store-1', addressRef,
    })
    assert(button('查看商品'))
    assert(!calls.some(call => ['submit', 'paymentPay', 'cartAdd'].includes(call.endpoint)))
  } finally { mounted.close() }
})

test('delivery groups load sequentially, retain earlier results and isolate one failed store for manual retry', async () => {
  const ref = '22222222-2222-4222-8222-222222222222', addressRef = 'a'.repeat(64), calls = [], third = deferred()
  const group = (shopId, name, state, items = []) => ({ shopId, shopName: name, addressRef, state, items, hasMore: false, nextCursor: null })
  const item = (id, name) => ({ id, name, price: '20' })
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload: structuredClone(payload) })
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: payload.platformId === 'hema' ? [{ ref, nickname: '盒马账号' }] : [] })
    if (endpoint === 'crossSearch') return ok({ keyword: payload.keyword, platforms: [{ platformId: 'hema', accountRef: ref, state: 'partial', scope: 'delivery-stores', groups: [
      group('one', '第一店', 'ready', [item('a', '第一商品')]), group('two', '第二店', 'deferred'), group('three', '第三店', 'deferred'),
    ] }] })
    if (endpoint === 'crossSearchPage' && payload.shopId === 'two') {
      if (calls.filter(call => call.endpoint === 'crossSearchPage' && call.payload.shopId === 'two').length === 1) return { ok: false, error: { code: 'menu-unavailable', message: '第二店暂不可用' } }
      return ok({ ...payload, ...group('two', '第二店', 'ready', [item('b', '第二商品')]) })
    }
    if (endpoint === 'crossSearchPage' && payload.shopId === 'three') return third.promise
    throw Error('Unexpected operation ' + endpoint)
  } })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
    await act(async () => button('跨平台搜索').props.onClick())
    await act(async () => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0].props.onChange({ target: { value: '水' } }))
    await act(async () => button('搜索').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('第一商品'))
    assert(text(mounted.renderer.toJSON()).includes('第二店暂不可用'))
    assert(text(mounted.renderer.toJSON()).includes('正在搜索…'))
    assert.deepEqual(calls.filter(call => call.endpoint === 'crossSearchPage').map(call => call.payload.shopId), ['two', 'three'])
    await act(async () => third.resolve(ok({ platformId: 'hema', accountRef: ref, keyword: '水', ...group('three', '第三店', 'ready', [item('c', '第三商品')]),
      hasMore: true, nextCursor: { platformId: 'hema', ref: '33333333-3333-4333-8333-333333333333' } })))
    assert(text(mounted.renderer.toJSON()).includes('第三商品'))
    assert.equal(calls.filter(call => call.endpoint === 'crossSearchPage').length, 2)
    await act(async () => button('重试').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('第二商品'))
    assert(button('下一页商品'))
    assert.equal(calls.filter(call => call.endpoint === 'crossSearchPage').length, 3)
  } finally { mounted.close() }
})

test('changing the query while a deferred store is loading discards its late reply', async () => {
  const ref = '22222222-2222-4222-8222-222222222222', addressRef = 'a'.repeat(64), late = deferred()
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: payload.platformId === 'hema' ? [{ ref, nickname: '账号' }] : [] })
    if (endpoint === 'crossSearch') return ok({ keyword: payload.keyword, platforms: [{ platformId: 'hema', accountRef: ref, state: 'partial', scope: 'delivery-stores',
      groups: payload.keyword === '旧词' ? [{ shopId: 'old', shopName: '旧店', addressRef, state: 'deferred', items: [], hasMore: false }]
        : [{ shopId: 'new', shopName: '新店', addressRef, state: 'ready', items: [], hasMore: false }] }] })
    if (endpoint === 'crossSearchPage') return late.promise
    throw Error('Unexpected operation ' + endpoint)
  } })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
    await act(async () => button('跨平台搜索').props.onClick())
    const input = () => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0]
    await act(async () => input().props.onChange({ target: { value: '旧词' } }))
    await act(async () => button('搜索').props.onClick())
    await act(async () => input().props.onChange({ target: { value: '新词' } }))
    await act(async () => button('搜索').props.onClick())
    await act(async () => late.resolve(ok({ platformId: 'hema', accountRef: ref, keyword: '旧词', shopId: 'old', shopName: '旧店', addressRef,
      state: 'ready', items: [{ id: 'late', name: '旧商品', price: '20' }], hasMore: false })))
    assert(text(mounted.renderer.toJSON()).includes('新店'))
    assert(!text(mounted.renderer.toJSON()).includes('旧商品'))
  } finally { mounted.close() }
})

test('switching the selected account discards a late deferred result from the previous account', async () => {
  const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222'
  const addressRef = 'a'.repeat(64), late = deferred()
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: payload.platformId === 'hema' ? [{ ref: first, nickname: '第一账号' }, { ref: second, nickname: '第二账号' }] : [] })
    if (endpoint === 'crossSearch') { const ref = payload.accounts[0].accountRef; return ok({ keyword: payload.keyword, platforms: [{ platformId: 'hema', accountRef: ref, state: 'partial', scope: 'delivery-stores',
      groups: ref === first ? [{ shopId: 'old', shopName: '旧账号店', addressRef, state: 'deferred', items: [], hasMore: false }]
        : [{ shopId: 'new', shopName: '新账号店', addressRef, state: 'ready', items: [], hasMore: false }] }] }) }
    if (endpoint === 'crossSearchPage') return late.promise
    throw Error('Unexpected operation ' + endpoint)
  } })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
    await act(async () => button('跨平台搜索').props.onClick())
    await act(async () => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0].props.onChange({ target: { value: '水' } }))
    await act(async () => button('搜索').props.onClick())
    const choice = root.findAll(node => node.type === 'span' && node.props.className === 'waimai-choice' && node.props.selectedId === first)[0]
    await act(async () => choice.props.onSelect(second))
    await act(async () => button('搜索').props.onClick())
    await act(async () => late.resolve(ok({ platformId: 'hema', accountRef: first, keyword: '水', shopId: 'old', shopName: '旧账号店', addressRef,
      state: 'ready', items: [{ id: 'late', name: '旧账号商品', price: '20' }], hasMore: false })))
    assert(text(mounted.renderer.toJSON()).includes('新账号店'))
    assert(!text(mounted.renderer.toJSON()).includes('旧账号商品'))
  } finally { mounted.close() }
})

test('unknown platform cards keep the incomplete indicator after the final page', async () => {
  const ref = '11111111-1111-4111-8111-111111111111', addressRef = 'a'.repeat(64)
  const cursor = { platformId: 'taobao', ref: '22222222-2222-4222-8222-222222222222' }
  const group = { shopId: 'platform', shopName: '', addressRef, items: [], state: 'ready', hasMore: true, nextCursor: cursor, unknownCards: 1 }
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: payload.platformId === 'taobao' ? [{ ref, nickname: '账号' }] : [] })
    if (endpoint === 'crossSearch') return ok({ keyword: payload.keyword, platforms: [{ platformId: 'taobao', accountRef: ref, state: 'partial', scope: 'platform', groups: [group] }] })
    if (endpoint === 'crossSearchPage') return ok({ ...group, ...payload, state: 'ready', hasMore: false, nextCursor: null, unknownCards: 0 })
    throw Error('Unexpected operation ' + endpoint)
  } })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
    await act(async () => button('跨平台搜索').props.onClick())
    await act(async () => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0].props.onChange({ target: { value: '水' } }))
    await act(async () => button('搜索').props.onClick())
    await act(async () => button('下一页商品').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('部分结果未返回'))
    assert(!button('下一页商品'))
  } finally { mounted.close() }
})

test('a changed address during pagination removes the platform results and their purchase actions', async () => {
  const ref = '11111111-1111-4111-8111-111111111111', addressRef = 'a'.repeat(64)
  const cursor = { platformId: 'taobao', ref: '22222222-2222-4222-8222-222222222222' }
  const item = { id: 'item-1', shopId: 'shop-1', shopName: '旧店', name: '旧商品', price: '20' }
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: payload.platformId === 'taobao' ? [{ ref, nickname: '账号' }] : [] })
    if (endpoint === 'crossSearch') return ok({ keyword: payload.keyword, platforms: [{ platformId: 'taobao', accountRef: ref, state: 'partial', scope: 'platform',
      groups: [{ shopId: 'platform', shopName: '', addressRef, items: [item], state: 'ready', hasMore: true, nextCursor: cursor }] }] })
    if (endpoint === 'crossSearchPage') return { ok: false, error: { code: 'address-changed', message: '配送地址已变化' } }
    throw Error('Unexpected operation ' + endpoint)
  } })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
    await act(async () => button('跨平台搜索').props.onClick())
    await act(async () => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0].props.onChange({ target: { value: '水' } }))
    await act(async () => button('搜索').props.onClick())
    assert(button('查看商品'))
    await act(async () => button('下一页商品').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('配送地址已变化'))
    assert(!text(mounted.renderer.toJSON()).includes('旧商品'))
    assert(!button('查看商品'))
  } finally { mounted.close() }
})

test('editing the query discards a late search result and never displays it under a different keyword', async () => {
  const ref = '11111111-1111-4111-8111-111111111111', pending = deferred()
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: payload.platformId === 'taobao' ? [{ ref, nickname: '账号' }] : [] })
    if (endpoint === 'crossSearch') return pending.promise
    throw Error('Unexpected operation ' + endpoint)
  } })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
    await act(async () => button('跨平台搜索').props.onClick())
    const field = () => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0]
    await act(async () => field().props.onChange({ target: { value: '旧查询' } }))
    await act(async () => button('搜索').props.onClick())
    await act(async () => field().props.onChange({ target: { value: '新查询' } }))
    await act(async () => pending.resolve(ok({ keyword: '旧查询', platforms: [{ platformId: 'taobao', accountRef: ref, state: 'ready', scope: 'platform',
      groups: [{ shopId: 'old', shopName: '旧店铺', items: [], hasMore: false }] }] })))
    assert(!text(mounted.renderer.toJSON()).includes('旧店铺'))
    assert.equal(field().props.value, '新查询')
    assert.equal(button('搜索').props.disabled, false)
  } finally { mounted.close() }
})

test('a later platform-wide Taobao page opens its real merchant under the searched account and address', async () => {
  const ref = '11111111-1111-4111-8111-111111111111', addressRef = 'a'.repeat(64), calls = []
  const product = { id: 'item-1', shopId: 'real-store', shopName: '真实店铺', name: '示例水', description: '', price: '20', tips: [], options: [], availability: 'available' }
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload: structuredClone(payload) })
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: payload.platformId === 'taobao' ? [{ ref, nickname: '账号' }] : [] })
    if (endpoint === 'crossSearch') return ok({ keyword: payload.keyword, platforms: [{ platformId: 'taobao', accountRef: ref,
      state: 'partial', scope: 'platform', groups: [{ shopId: 'platform', shopName: '', addressRef, items: [], hasMore: true, nextCursor: { page: 2 } }] }] })
    if (endpoint === 'crossSearchPage') return ok({ platformId: 'taobao', accountRef: ref, keyword: payload.keyword, shopId: 'platform', shopName: '', addressRef, state: 'ready', items: [product], hasMore: false })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'probeMenu') return ok({ accountId: profile.id, addressRef, shopId: payload.shopId, categories: [{ id: 'a', name: '商品', items: [product] }] })
    throw Error('Unexpected operation ' + endpoint)
  } }, { addresses: async payload => { calls.push({ endpoint: 'addresses', payload: structuredClone(payload) }); return ok({ accountId: profile.id, selectedRef: addressRef,
    addresses: [{ ref: addressRef, address: '示例地址', usable: true }] }) } })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
    await act(async () => button('跨平台搜索').props.onClick())
    await act(async () => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0].props.onChange({ target: { value: '水' } }))
    await act(async () => button('搜索').props.onClick())
    await act(async () => button('下一页商品').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('真实店铺'))
    await act(async () => button('查看商品').props.onClick())
    const call = calls.find(value => value.endpoint === 'probeMenu')
    assert.equal(call.payload.shopId, 'real-store')
    assert.equal(call.payload.accountRef, ref)
    assert.equal(call.payload.addressRef, addressRef)
    assert.deepEqual(calls.find(value => value.endpoint === 'crossSearchPage').payload, { platformId: 'taobao', accountRef: ref, keyword: '水', shopId: 'platform', addressRef, cursor: { page: 2 } })
    assert(!calls.some(value => ['submit', 'paymentPay', 'cartChange'].includes(value.endpoint)))
  } finally { mounted.close() }
})

test('unmounting during retail product lookup does not start a cart request', async () => {
  const ref = '11111111-1111-4111-8111-111111111111', addressRef = 'a'.repeat(64), calls = [], pending = deferred()
  const item = { id: 'item-1', shopId: 'store', shopName: '商超', shopIsRetail: true, name: '水', price: '20', availability: 'available' }
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push(endpoint)
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: payload.platformId === 'taobao' ? [{ ref, nickname: '账号' }] : [] })
    if (endpoint === 'crossSearch') return ok({ keyword: payload.keyword, platforms: [{ platformId: 'taobao', accountRef: ref, state: 'ready', scope: 'platform',
      groups: [{ shopId: 'platform', shopName: '', addressRef, items: [item], hasMore: false }] }] })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'retailResolveSearch') return pending.promise
    throw Error('Unexpected operation ' + endpoint)
  } }, { addresses: async () => ok({ accountId: profile.id, selectedRef: addressRef, addresses: [{ ref: addressRef, address: '示例地址', usable: true }] }) })
  const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
  await act(async () => button('跨平台搜索').props.onClick())
  await act(async () => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0].props.onChange({ target: { value: '水' } }))
  await act(async () => button('搜索').props.onClick())
  await act(async () => button('查看商品').props.onClick())
  assert(calls.includes('retailResolveSearch'))
  mounted.close()
  await act(async () => pending.resolve(ok({ accountId: profile.id, addressRef, shopId: 'store' })))
  assert(!calls.includes('retailCart'))
})

test('retail product can be resolved, added once and quoted before explicit order confirmation', async () => {
  const ref = '11111111-1111-4111-8111-111111111111', productRef = '22222222-2222-4222-8222-222222222222'
  const addressRef = 'a'.repeat(64), revision = 'b'.repeat(64), quoteRef = '33333333-3333-4333-8333-333333333333', calls = [], owner = { accountId: profile.id, addressRef, shopId: 'real-store' }
  let count = 0, resolveAdd, addRef
  const item = { id: 'item-1', shopId: 'real-store', shopName: '商超', name: '示例水', price: '20', availability: 'available' }
  const cart = () => ({ ...owner, revision, items: count ? [{ ref: 'line-1', name: '示例水', quantity: count, totalCents: 2000 }] : [], totalCents: count ? 2000 : 0,
    ...(addRef && count ? { mutation: { operationRef: addRef, state: 'verified' } } : {}) })
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload: structuredClone(payload) })
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: payload.platformId === 'taobao' ? [{ ref, nickname: '账号' }] : [] })
    if (endpoint === 'crossSearch') return ok({ keyword: payload.keyword, platforms: [{ platformId: 'taobao', accountRef: ref, state: 'ready', scope: 'platform',
      groups: [{ shopId: 'platform', shopName: '', addressRef, items: [item], hasMore: false }] }] })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'probeMenu') return ok({ ...owner, categories: [], menuState: 'empty' })
    if (endpoint === 'retailResolveSearch') return ok({ ...owner, productRef, name: item.name, priceCents: 2000, stock: 5, minimumQuantity: 1, simpleSku: true, available: true })
    if (endpoint === 'retailCart') return ok(cart())
    if (endpoint === 'retailAdd') { addRef = payload.operationRef; return new Promise(resolve => { resolveAdd = () => { count++; resolve(ok(cart())) } }) }
    if (endpoint === 'retailCheckout') return ok({ ...cart(), merchant: '商超', address: { address: '示例地址', contact: '用户', maskedPhone: '138****0000' },
      items: [{ name: item.name, quantity: 1, priceCents: 2000 }], fees: [], totalCents: 2100, quoteRef, maxOrderCents: 3500, maxAmountCents: 3500, expiresAt: Date.now() + 120000, deliveryTime: '今天' })
    if (endpoint === 'orders') return ok({ accountId: profile.id, orders: [] })
    throw Error('Unexpected operation ' + endpoint)
  } }, { addresses: async () => ok({ accountId: profile.id, selectedRef: addressRef, addresses: [{ ref: addressRef, address: '示例地址', usable: true }] }),
    trade: async (endpoint, payload) => {
      calls.push({ endpoint, payload: structuredClone(payload) })
      if (endpoint === 'submit') return ok({ ...owner, orderRef: quoteRef, orderIds: ['123'], paymentStatus: 'unconfirmed' })
      if (endpoint === 'tradeHistory') return ok({ accountId: profile.id, attempts: [] })
      if (endpoint === 'cart') return ok({ ...owner, revision, items: [], quantity: 0, totalCents: 0 })
      throw Error('Unexpected trade operation ' + endpoint)
    } })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
    await act(async () => button('跨平台搜索').props.onClick())
    await act(async () => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0].props.onChange({ target: { value: '水' } }))
    await act(async () => button('搜索').props.onClick())
    await act(async () => button('查看商品').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('餐饮菜单未必包含商超商品'))
    await act(async () => button('商超商品').props.onClick())
    assert.deepEqual(calls.find(call => call.endpoint === 'retailResolveSearch').payload, { platformId: 'taobao', accountRef: ref,
      shopId: 'real-store', addressRef, itemId: 'item-1', keyword: '水' })
    await act(async () => { button('加入购物车').props.onClick(); button('加入购物车').props.onClick() })
    assert.equal(calls.filter(call => call.endpoint === 'retailAdd').length, 1)
    const add = calls.find(call => call.endpoint === 'retailAdd').payload
    assert.equal(add.addressRef, addressRef); assert.equal(add.accountRef, ref); assert.equal(add.productRef, productRef)
    assert.equal(Object.hasOwn(add, 'shopId'), false)
    await act(async () => resolveAdd())
    await act(async () => button('去结算').props.onClick())
    const checkout = calls.find(call => call.endpoint === 'retailCheckout').payload
    assert.equal(checkout.addressRef, addressRef); assert.equal(checkout.revision, revision); assert.equal(checkout.shopId, 'real-store')
    assert.equal(Object.hasOwn(checkout, 'maxAmount'), false)
    assert(text(mounted.renderer.toJSON()).includes('示例地址'))
    assert(text(mounted.renderer.toJSON()).includes('实付: ¥21.00'))
    assert(button('确认创建订单').props.disabled)
    const confirm = root.findAll(node => node.type === 'span' && node.props.label === '我已核对商品、配送地址、时间和实付金额')[0]
    await act(async () => confirm.props.onChange(true))
    assert(!button('确认创建订单').props.disabled)
    assert(!calls.some(call => call.endpoint === 'submit'))
    await act(async () => button('确认创建订单').props.onClick())
    assert.equal(calls.filter(call => call.endpoint === 'submit').length, 1)
    assert(!calls.some(call => call.endpoint === 'paymentPay'))
  } finally { mounted.close() }
})

test('an unconfirmed retail add stays blocked until the same operation is verified by a cart refresh', async () => {
  const ref = '11111111-1111-4111-8111-111111111111', productRef = '22222222-2222-4222-8222-222222222222'
  const addressRef = 'a'.repeat(64), owner = { accountId: profile.id, addressRef, shopId: 'store' }, calls = []
  let attemptedRef, verified = false, alternateRef
  const item = { id: 'item-1', shopId: 'store', shopName: '商超', name: '示例水', price: '20', shopIsRetail: true }
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload: structuredClone(payload) })
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: payload.platformId === 'taobao' ? [{ ref, nickname: '账号' }] : [] })
    if (endpoint === 'crossSearch') return ok({ keyword: payload.keyword, platforms: [{ platformId: 'taobao', accountRef: ref, state: 'ready', scope: 'platform',
      groups: [{ shopId: 'platform', shopName: '', addressRef, items: [item], hasMore: false }] }] })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'probeMenu') return ok({ ...owner, categories: [], menuState: 'empty' })
    if (endpoint === 'retailResolveSearch') return ok({ ...owner, productRef, name: item.name, priceCents: 2000, stock: 5, minimumQuantity: 1, simpleSku: true, available: true })
    if (endpoint === 'retailCart') return ok({ ...owner, revision: 'b'.repeat(64), items: [], totalCents: 0,
      ...(attemptedRef ? { mutation: { operationRef: alternateRef || attemptedRef, state: verified ? 'verified' : 'unconfirmed' } } : {}) })
    if (endpoint === 'retailAdd') { attemptedRef = payload.operationRef; return { ok: false, error: { code: 'cart-result-unconfirmed', message: '加购结果待核对' } } }
    throw Error('Unexpected operation ' + endpoint)
  } }, { addresses: async () => ok({ accountId: profile.id, selectedRef: addressRef, addresses: [{ ref: addressRef, address: '示例地址', usable: true }] }),
    trade: async endpoint => endpoint === 'tradeHistory' ? ok({ accountId: profile.id, attempts: [] })
      : ok({ ...owner, revision: 'b'.repeat(64), items: [], quantity: 0, totalCents: 0 }) })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
    await act(async () => button('跨平台搜索').props.onClick())
    await act(async () => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0].props.onChange({ target: { value: '水' } }))
    await act(async () => button('搜索').props.onClick())
    await act(async () => button('查看商品').props.onClick())
    assert(button('商超商品').props['aria-pressed'])
    await act(async () => button('加入购物车').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('加购结果未确认'))
    assert(button('加入购物车').props.disabled)
    await act(async () => button('刷新购物车').props.onClick())
    assert(button('加入购物车').props.disabled)
    assert(button('去结算').props.disabled)
    verified = true; alternateRef = '33333333-3333-4333-8333-333333333333'
    await act(async () => button('刷新购物车').props.onClick())
    assert(button('加入购物车').props.disabled)
    alternateRef = null
    await act(async () => button('刷新购物车').props.onClick())
    assert(!button('加入购物车').props.disabled)
    assert(!text(mounted.renderer.toJSON()).includes('加购结果未确认，请核对购物车'))
    assert.equal(calls.filter(call => call.endpoint === 'retailAdd').length, 1)
    assert(!calls.some(call => ['retailCheckout', 'submit', 'paymentPay'].includes(call.endpoint)))
  } finally { mounted.close() }
})

test('retail product from another address is rejected before the cart can be read or modified', async () => {
  const ref = '11111111-1111-4111-8111-111111111111', addressRef = 'a'.repeat(64), calls = []
  const item = { id: 'item-1', shopId: 'store', shopName: '商超', name: '示例水', price: '20' }
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push(endpoint)
    if (endpoint === 'status') return ok({ authenticated: false, state: 'logged-out', accounts: [] })
    if (endpoint === 'accountsList') return ok({ accounts: payload.platformId === 'taobao' ? [{ ref, nickname: '账号' }] : [] })
    if (endpoint === 'crossSearch') return ok({ keyword: payload.keyword, platforms: [{ platformId: 'taobao', accountRef: ref, state: 'ready', scope: 'platform',
      groups: [{ shopId: 'platform', shopName: '', addressRef, items: [item], hasMore: false }] }] })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'probeMenu') return ok({ accountId: profile.id, addressRef, shopId: 'store', categories: [], menuState: 'empty' })
    if (endpoint === 'retailResolveSearch') return ok({ accountId: profile.id, addressRef: 'c'.repeat(64), shopId: 'store', name: item.name })
    throw Error('Unexpected operation ' + endpoint)
  } }, { addresses: async () => ok({ accountId: profile.id, selectedRef: addressRef, addresses: [{ ref: addressRef, address: '示例地址', usable: true }] }),
    trade: async endpoint => endpoint === 'tradeHistory' ? ok({ accountId: profile.id, attempts: [] })
      : ok({ accountId: profile.id, addressRef, shopId: 'store', revision: 'b'.repeat(64), items: [], quantity: 0, totalCents: 0 }) })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(node => text(node.props.children) === label)
    await act(async () => button('跨平台搜索').props.onClick())
    await act(async () => root.findAll(node => node.type === 'span' && node.props['aria-label'] === '搜索商品')[0].props.onChange({ target: { value: '水' } }))
    await act(async () => button('搜索').props.onClick())
    await act(async () => button('查看商品').props.onClick())
    await act(async () => button('商超商品').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('配送地址已变化，请重新搜索'))
    assert(!calls.includes('retailCart'))
    assert(!calls.includes('retailAdd'))
  } finally { mounted.close() }
})
