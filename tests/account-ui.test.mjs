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

async function mount(rpc) {
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
    assert(text(mounted.renderer.toJSON()).includes('示例饭 × 2'))
    assert(text(mounted.renderer.toJSON()).includes('¥25.50'))
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '下一页').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('更早的店'))
    assert(!text(mounted.renderer.toJSON()).includes('示例店'))
    assert.equal(root.findAllByProps({ className: 'waimai-order' }).length, 1)
    assert.equal(calls.find(call => call.payload.cursor)?.payload.cursor.pageNum, 1)
    act(() => avatar.props.onError())
    assert.equal(root.findAllByType('img').length, 0)
    signedIn = false
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '检查登录状态').props.onClick())
    assert.equal(root.findAllByProps({ className: 'waimai-account' }).length, 0)
    assert.equal(root.findAllByProps({ className: 'waimai-order' }).length, 0)
    assert(!text(mounted.renderer.toJSON()).includes(profile.maskedPhone))
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
