import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'
import { Config } from '../lib/index.js'

test('recorded product queries retain identical items in different stores and open the selected merchant within the recorded account', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/agent-product-search.json', import.meta.url), 'utf8')), calls = [], addressRef = 'a'.repeat(64)
  const mounted = await mount({ async call(_channel, method, payload) {
    calls.push({ method, payload })
    if (method === 'profile') return ok(profile)
    if (method === 'probeMenu') return ok({ accountId: profile.id, addressRef, shopId: payload.shopId, categories: [] })
    if (method === 'nearbyShops') return ok({ accountId: profile.id, addressRef, shops: [] })
    throw Error('unexpected product card operation')
  } }, { tool: { name: 'mcp__waimai__search_products', props: fixture },
    addresses: async () => ok({ accountId: profile.id, selectedRef: addressRef, addresses: [{ ref: addressRef, address: '示例地址', usable: true }] }) })
  try {
    const value = text(mounted.renderer.toJSON())
    assert(value.includes('仅查询已选店铺')); assert(value.includes('暂无可售商品，请改天再来')); assert(value.includes('商品读取失败'))
    assert(!value.includes('market-a')); assert(!value.includes('failed'))
    const buttons = mounted.renderer.root.findAllByType('button').filter(button => text(button.props.children) === '选规格并点餐')
    assert.equal(buttons.length, 2); assert.equal(calls.length, 0)
    await act(async () => buttons[1].props.onClick())
    assert(calls.some(call => call.method === 'probeMenu' && call.payload.shopId === 'market-b'))
    assert(calls.every(call => call.payload.accountRef === '11111111-1111-4111-8111-111111111111'))
  } finally { mounted.close() }
})

test('a recorded menu tool renders actionable dishes and keeps private ordering scoped to its recorded account', async () => {
  const recorded = JSON.parse(await readFile(new URL('./fixtures/agent-order-card.json', import.meta.url), 'utf8'))
  const duplicateMenu = JSON.parse(recorded.props.block.content[0].text)
  duplicateMenu.data.categories.push(duplicateMenu.data.categories[0])
  recorded.props.block.content[0].text = JSON.stringify(duplicateMenu)
  const accountRef = '11111111-1111-4111-8111-111111111111', addressRef = 'a'.repeat(64), calls = []
  const item = { id: 'food-1', name: '示例饭', price: '20', imageUrl: null, description: '', availability: 'available', options: [], tips: [] }
  const menu = { platformId: 'taobao', shopId: 'store-17', categories: [{ id: 'main', name: '主食', items: [item] }] }
  const mounted = await mount({ async call(_channel, method, payload) {
    calls.push({ method, payload })
    if (method === 'profile') return ok(profile)
    if (method === 'probeMenu') return ok({ ...menu, accountId: profile.id, addressRef })
    throw Error('Unexpected chat request: ' + method)
  } }, { tool: recorded,
    addresses: async payload => { calls.push({ method: 'addresses', payload }); return ok({ accountId: profile.id, selectedRef: addressRef, addresses: [{ ref: addressRef, address: '示例地址', contact: '', maskedPhone: '', usable: true }] }) } })
  try {
    assert(text(mounted.renderer.toJSON()).includes(recorded.expected.dish))
    assert.equal(mounted.renderer.root.findAllByType('button').filter(node => text(node.props.children) === recorded.expected.action).length, 1)
    const button = mounted.renderer.root.findAllByType('button').find(node => text(node.props.children) === recorded.expected.action)
    assert.equal(button.props.disabled, false)
    await act(async () => button.props.onClick()); await act(async () => {})
    assert(calls.length > 0); assert(calls.every(call => call.payload.accountRef === accountRef))
    assert(text(mounted.renderer.toJSON()).includes('加入购物车'), text(mounted.renderer.toJSON()) + JSON.stringify(calls))
    assert.equal(mounted.renderer.root.findAllByType('aside').length, 0)
  } finally { mounted.close() }
})

test('payment cards read official order states without requiring a delivery address or creating an order', async () => {
  const accountRef = '11111111-1111-4111-8111-111111111111', calls = []
  const mounted = await mount({ async call(_channel, method, payload) { calls.push({ method, payload }); if (method === 'profile') return ok(profile); if (method === 'orders') return ok({ accountId: profile.id, orders: [{ id: '123', status: '已支付' }] }); throw Error('Unexpected request: ' + method) } }, {
    tool: { name: 'mcp__waimai__request_payment', props: { phase: 'result', sessionId: 'payment-session', callId: 'payment-call', block: { content: [{ type: 'text', text: JSON.stringify({ success: true,
      data: { view: 'payment', platformId: 'taobao', accountRef, attempts: [{ orderRef: accountRef }] } }) }] } } },
    addresses: async () => { throw Error('Payment must not request addresses') },
    trade: async (method, payload) => { calls.push({ method, payload }); return ok(method === 'tradeHistory' ? { accountId: profile.id, attempts: [{ orderRef: accountRef, merchant: '示例店', amountCents: 2100, status: 'created', orderIds: ['123'], paymentUrl: null }] }
      : { accountId: profile.id, orders: [{ id: '123', status: '已支付' }] }) },
  })
  try {
    assert(text(mounted.renderer.toJSON()).includes('官方订单状态: 已支付'))
    assert(!text(mounted.renderer.toJSON()).includes('付款待确认'))
    assert(calls.every(call => call.payload.accountRef === accountRef))
    assert.deepEqual(calls.map(call => call.method).sort(), ['orders', 'profile', 'tradeHistory'])
  } finally { mounted.close() }
})

test('the chat checkout card refreshes its quote and requires the user to confirm the bounded amount during automation preview', async () => {
  const accountRef = '11111111-1111-4111-8111-111111111111', addressRef = 'a'.repeat(64), revision = 'b'.repeat(64), calls = []
  const display = { platformId: 'taobao', shopId: 'store-17', revision, items: [{ ref: 'c'.repeat(64), name: '示例饭', quantity: 1, priceCents: 2000, totalCents: 2000 }], quantity: 1, invalidCount: 0, totalCents: 2100 }
  const privateQuote = { ...display, accountId: profile.id, addressRef, quoteRef: '22222222-2222-4222-8222-222222222222', merchant: '示例店',
    address: { address: '示例地址', contact: '', maskedPhone: '' }, fees: [{ name: '配送费', amountCents: 100 }], discountCents: 0,
    expiresAt: Date.now() + 60000, deliveryTime: '30分钟', previewOnly: true, maxOrderCents: 3500 }
  const mounted = await mount({ async call(_channel, method) { if (method === 'profile') return ok(profile); throw Error('unexpected chat call') } }, {
    tool: { name: 'mcp__waimai__submit_order', props: { phase: 'result', sessionId: 'session-fixture', callId: 'quote-call', block: { content: [{ type: 'text', text: JSON.stringify({ success: true,
      data: { ...display, view: 'checkout', accountRef, maxAmountCents: 2500 } }) }] } } },
    addresses: async () => ok({ accountId: profile.id, selectedRef: addressRef, addresses: [{ ref: addressRef, address: '示例地址', contact: '', maskedPhone: '', usable: true }] }),
    trade: async (method, payload) => { calls.push({ method, payload }); return ok(method === 'tradeHistory' ? { accountId: profile.id, attempts: [] }
      : method === 'checkout' ? privateQuote : method === 'submit' ? { accountId: profile.id, orderIds: ['123'], paymentStatus: 'unconfirmed', paymentUrl: 'https://r.ele.me/payment?synthetic=1' }
        : { ...display, accountId: profile.id, addressRef }) },
  })
  try {
    const button = () => mounted.renderer.root.findAllByType('button').find(node => text(node.props.children) === '确认创建订单')
    assert.equal(button().props.disabled, true)
    assert(!calls.some(call => call.method === 'submit'))
    const checkbox = mounted.renderer.root.findAll(node => node.type === 'span' && node.props.checked !== undefined)[0]
    await act(async () => checkbox.props.onChange({ target: { checked: true } }))
    assert.equal(button().props.disabled, false)
    await act(async () => button().props.onClick())
    assert.equal(calls.filter(call => call.method === 'submit').length, 1)
    const submitted = calls.find(call => call.method === 'submit').payload
    assert.equal(submitted.accountRef, accountRef); assert.equal(submitted.maxAmountCents, 2500); assert.equal(submitted.manualConfirmation, true)
    assert(text(mounted.renderer.toJSON()).includes('付款待确认'))
    assert.equal(mounted.renderer.root.findAllByType('a')[0].props.href, 'https://r.ele.me/payment?synthetic=1')
  } finally { mounted.close() }
})

test('Hema view uses explicit Taobao sign-in, private account scope and remote product search without purchasing controls', async () => {
  const calls = [], ref = '11111111-1111-4111-8111-111111111111', source = '22222222-2222-4222-8222-222222222222', addressRef = 'a'.repeat(64)
  let linked = false
  let failNext = false
  let failCart = false, foreignCart = false
  let unknownDetailPrice = false
  const productRef = '33333333-3333-4333-8333-333333333333', cursor = { platformId: 'hema', ref: '44444444-4444-4444-8444-444444444444' }
  const status = () => ({ authenticated: linked, state: linked ? 'logged-in' : 'logged-out', loginMethod: 'taobao-qr',
    viewAccountRef: linked ? ref : null, accounts: linked ? [{ ref, nickname: '示例盒马用户', externalId: profile.id, loginMethod: 'taobao-qr' }] : [],
    taobaoAccounts: [{ ref: source, nickname: '示例淘宝用户' }] })
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    if (endpoint === 'status') return ok(payload.platformId === 'hema' ? status() : { state: 'logged-out', authenticated: false })
    if (endpoint === 'useTaobao') { assert.equal(payload.platformId, 'hema'); assert.equal(payload.sourceAccountRef, source); linked = true; return ok(status()) }
    if (endpoint === 'profile') return ok({ ...profile, nickname: '示例盒马用户' })
    if (endpoint === 'addresses') return ok({ platformId: 'hema', accountId: profile.id, selectedRef: addressRef,
      addresses: [{ ref: addressRef, address: '示例配送地址', contact: '', maskedPhone: '', usable: true }] })
    if (endpoint === 'nearbyShops') return ok({ platformId: 'hema', accountId: profile.id, addressRef, scope: 'delivery-stores', nextCursor: null,
      shops: [{ id: 'group-1', name: '示例盒马门店' }] })
    if (endpoint === 'probeMenu') {
      if (payload.cursor && failNext) return { ok: false, error: { code: 'search-failed', message: '商品分页读取失败' } }
      if (payload.cursor) assert.deepEqual(payload.cursor, cursor)
      return ok({ platformId: 'hema', accountId: profile.id, addressRef, shopId: 'group-1', query: payload.keyword,
        nextCursor: payload.keyword && !payload.cursor ? cursor : null,
        queryRequired: !payload.keyword, categories: payload.keyword ? [{ id: 'results', name: payload.keyword, items: [
          { id: payload.cursor ? 'item-2' : 'item-1', productRef, name: payload.cursor ? '示例下一页鸡蛋' : '示例鸡蛋',
            description: '', imageUrl: null, price: '6.99', priceUnit: '盒', availability: 'available', options: [], tips: [] } ] }] : [] })
    }
    if (endpoint === 'productDetail') return ok({ platformId: 'hema', accountId: profile.id, addressRef, shopId: 'group-1', productRef,
      product: { id: 'item-1', name: '示例鸡蛋', price: unknownDetailPrice ? null : '7.99', originalPrice: unknownDetailPrice ? null : '8.06', priceUnit: '盒', available: true,
        variants: [{ id: 'sku-1', name: '400g/盒', minimumQuantity: 1, quantityStep: 1, stockQuantity: 3, saleUnit: '盒', chargeUnit: '盒' }] } })
    if (endpoint === 'cart') return failCart ? { ok: false, error: { code: 'verification-required', message: '购物车读取需要验证' } } : ok({ platformId: 'hema',
      accountId: foreignCart ? '99999' : profile.id, addressRef, availableCount: 1, selectedCount: 0,
      items: [{ id: 'synthetic-cart', name: '示例购物车鸡蛋', quantity: '1', quantityUnit: '盒', specification: '', price: '6.99', priceUnit: '/盒', available: true, selected: false }] })
    throw Error('unexpected request')
  } }, { addresses: async () => ok({ platformId: 'hema', accountId: profile.id, selectedRef: addressRef,
    addresses: [{ ref: addressRef, address: '示例配送地址', contact: '', maskedPhone: '', usable: true }] }) })
  try {
    const root = mounted.renderer.root
    const click = label => root.findAllByType('button').find(button => text(button.props.children) === label).props.onClick()
    await act(async () => root.findAll(node => node.type === 'span' && node.props.className === 'waimai-choice')[0].props.onSelect('hema'))
    assert(!root.findAllByType('button').some(button => text(button.props.children) === '手机号短信'))
    const loginMethods = ['手机号短信（淘宝授权）', '盒马 App 扫码', '淘宝授权扫码', '使用淘宝账号'].filter(label => root.findAllByType('button').some(button => text(button.props.children) === label))
    assert.equal(loginMethods.length, 4)
    assert(root.findAllByType('button').find(button => text(button.props.children) === '手机号短信（淘宝授权）').props['aria-pressed'])
    await act(async () => click('盒马 App 扫码'))
    assert(text(mounted.renderer.toJSON()).includes('盒马 App 扫码尚未接通'))
    assert(root.findAllByType('button').find(button => text(button.props.children) === '盒马 App 扫码').props['aria-pressed'])
    assert(!calls.some(value => value.endpoint === 'qrStart' && value.payload.platformId === 'hema'))
    await act(async () => click('使用淘宝账号'))
    await act(async () => click('使用已登录淘宝账号'))
    assert(text(mounted.renderer.toJSON()).includes('示例盒马用户'))
    await act(async () => click('门店与商品'))
    const stores = root.findAllByProps({ className: 'waimai-food-card' }).map(node => text(node.findByType('strong').props.children))
    await act(async () => click('查询商品'))
    assert(!calls.some(call => call.endpoint === 'probeMenu' && call.payload.keyword))
    await act(async () => root.findAllByProps({ 'aria-label': '输入商品名称' })[0].props.onChange({ target: { value: '鸡蛋' } }))
    await act(async () => click('搜索商品'))
    const price = text(root.findByProps({ className: 'waimai-price' }).props.children)
    const view = { platform: '盒马', tabs: root.findByType('nav').findAllByType('button').map(button => text(button.props.children)), loginMethods, stores,
      search: calls.find(call => call.endpoint === 'probeMenu' && call.payload.keyword)?.payload.keyword, price,
      ordering: '可查询商品，下单与支付暂未开放。' }
    assert.deepEqual(view, JSON.parse(await readFile(new URL('./fixtures/hema-view.json', import.meta.url), 'utf8')))
    await act(async () => click('查看规格'))
    const specs = { price: root.findAllByProps({ className: 'waimai-price' }).map(value => text(value.props.children)),
      labels: ['返回商品', '商品规格', '400g/盒', '最低数量: 1 盒', '数量步长: 1 盒', '库存: 3', '计价单位: 盒'].filter(value => text(mounted.renderer.toJSON()).includes(value)) }
    assert.deepEqual(specs, JSON.parse(await readFile(new URL('./fixtures/hema-specifications.json', import.meta.url), 'utf8')))
    await act(async () => click('返回商品'))
    unknownDetailPrice = true; await act(async () => click('查看规格'))
    assert(text(mounted.renderer.toJSON()).includes('价格暂无法确认')); assert(!text(mounted.renderer.toJSON()).includes('¥null'))
    await act(async () => click('返回商品'))
    failNext = true
    await act(async () => click('下一页商品'))
    assert(text(mounted.renderer.toJSON()).includes('示例鸡蛋')); assert(text(mounted.renderer.toJSON()).includes('商品分页读取失败'))
    failNext = false
    await act(async () => click('下一页商品'))
    assert(text(mounted.renderer.toJSON()).includes('示例下一页鸡蛋'))
    assert(!root.findAllByProps({ className: 'waimai-food-card' }).some(value => text(value.props.children).includes('示例鸡蛋')))
    assert.equal(root.findAllByType('button').find(button => text(button.props.children) === '下一页商品').props.disabled, true)
    await act(async () => click('返回首批'))
    assert(text(mounted.renderer.toJSON()).includes('示例鸡蛋'))
    await act(async () => click('查看购物车'))
    const cartView = text(mounted.renderer.toJSON())
    assert.deepEqual({ labels: ['购物车', '刷新购物车', '商品条目: 1', '可售商品: 1', '示例购物车鸡蛋', '数量: 1 盒', '标价 ¥6.99 /盒'].filter(value => cartView.includes(value)) },
      JSON.parse(await readFile(new URL('./fixtures/hema-cart.json', import.meta.url), 'utf8')))
    failCart = true; await act(async () => click('刷新购物车'))
    assert(text(mounted.renderer.toJSON()).includes('示例购物车鸡蛋')); assert(text(mounted.renderer.toJSON()).includes('购物车读取需要验证'))
    failCart = false; foreignCart = true; await act(async () => click('刷新购物车'))
    assert(!text(mounted.renderer.toJSON()).includes('示例购物车鸡蛋'))
    assert(calls.filter(call => ['profile', 'addresses', 'nearbyShops', 'probeMenu', 'productDetail', 'cart'].includes(call.endpoint)).every(call => call.payload.accountRef === ref && call.payload.platformId === 'hema'))
    assert(!calls.some(call => /create|pay|bind/i.test(call.endpoint)))
    assert(!text(mounted.renderer.toJSON()).includes('示例淘宝用户'))
  } finally { mounted.close() }
})

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
  primitives.Modal = props => props.open ? React.createElement('section', { role: 'dialog', 'aria-label': props.title, onClose: props.onClose }, props.children, props.footer) : null
  primitives.Toast = props => React.createElement('div', { role: 'alert' }, props.text)
  runInNewContext(await readFile(new URL('../lib/client/index.js', import.meta.url), 'utf8'), {
    window: { localStorage, __ModuleLoader__: { load(entry) { module = entry.factory(name => name === 'react' ? React : primitives) } } },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
    structuredClone, setInterval, clearInterval, setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout, crypto: { randomUUID },
  })
  const snapshot = { status: 'ready', writable: true, revision: 1, value: Config(options.config || {}).get() }
  const form = { subscribe: () => () => {}, getSnapshot: () => snapshot, mutate: options.mutate || (async () => true) }
  const ctx = {
    effect(fn) { disposers.push(fn()) }, connection: { rpc },
    locale: { register(_namespace, values) { dictionary = values.zh; return () => {} }, bind: () => key => dictionary[key] },
    configForms: { get: () => form, whileServed(_names, fn) { fn(); return () => {} } },
    slots: { inject(_slot, fn) { return fn() }, register(spec, component) { if (spec.name === "tool.call.toolview") toolCards.set(spec.key, { component, props: spec.inject() }); else { Card = component; cardProps = spec.inject(); } return () => {} } },
  }
  module.apply(ctx)
  let renderer
  await act(async () => { const selected = options.tool ? toolCards.get(options.tool.name) : { component: Card, props: cardProps }; renderer = create(React.createElement(selected.component, { ...selected.props, toolName: options.tool?.name, ...options.tool?.props })) })
  return { renderer, close: () => { act(() => renderer.unmount()); for (const dispose of disposers.reverse()) dispose?.() } }
}

test('stale platform metadata shows a retry and never starts a login with missing methods', async () => {
  let ready = false; const calls = []
  const definitions = JSON.parse(await readFile(new URL('../lib/platforms.json', import.meta.url), 'utf8'))
  const mounted = await mount({ async call(_channel, endpoint) { calls.push(endpoint); return ok({ state: 'logged-out', authenticated: false }) } }, {
    platforms: async () => ok(ready ? definitions : definitions.map(({ loginMethods: _methods, defaultLoginMethod: _default, ...entry }) => entry)) })
  try {
    assert(mounted.renderer.root.findAllByProps({ role: 'alert' }).some(node => node.type === 'p'))
    assert.equal(calls.length, 0)
    ready = true
    await act(async () => mounted.renderer.root.findAllByType('button').find(button => text(button.props.children) === '重新加载平台').props.onClick())
    assert(calls.includes('status')); assert(text(mounted.renderer.toJSON()).includes('淘宝扫码'))
  } finally { mounted.close() }
})

test('Hema SMS stays in private RPC, defaults to phone authorization and displays the masked pending state', async () => {
  const calls = []; let pending
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    if (endpoint === 'sendCode') { assert.equal(payload.loginMethod, 'taobao-sms'); pending = { state: 'code-sent', codePending: true, maskedPhone: '138****0000', retryAfterSeconds: 60, attemptId: '11111111-1111-4111-8111-111111111111' } }
    if (endpoint === 'complete') { assert.equal(payload.loginMethod, 'taobao-sms'); assert.equal(payload.smsAttemptId, pending.attemptId); pending = { ...pending, state: 'registration-required' } }
    return ok({ authenticated: false, state: 'logged-out', pendingLogin: pending, accounts: [] })
  } })
  try {
    const root = mounted.renderer.root
    await act(async () => root.findAll(node => node.type === 'span' && node.props.className === 'waimai-choice')[0].props.onSelect('hema'))
    const phoneInput = root.findAll(node => node.type === 'span' && node.props.type === 'tel')[0]
    await act(async () => phoneInput.props.onChange({ target: { value: '13800000000' } }))
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '获取验证码').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('138****0000'))
    const codeInput = root.findAll(node => node.type === 'span' && node.props.autoComplete === 'one-time-code')[0]
    await act(async () => codeInput.props.onChange({ target: { value: '5678' } }))
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '登录').props.onClick())
    assert(root.findAllByType('button').find(button => text(button.props.children) === '登录').props.disabled)
    assert(!calls.some(call => call.endpoint === 'qrStart' && call.payload.platformId === 'hema'))
    const recorded = { method: '手机号短信（淘宝授权）', pending: '138****0000', sends: calls.filter(call => call.endpoint === 'sendCode').length,
      registrationStopped: root.findAllByType('button').find(button => text(button.props.children) === '登录').props.disabled }
    assert.deepEqual(recorded, JSON.parse(await readFile(new URL('./fixtures/hema-sms-view.json', import.meta.url), 'utf8')))
  } finally { mounted.close() }
})

test('Taobao cart shows an expiring server quote; creation requires explicit confirmation and payment is an official link', async () => {
  const addressRef = 'a'.repeat(64), ref = '11111111-1111-4111-8111-111111111111', calls = []
  const quoteRef = '22222222-2222-4222-8222-222222222222'
  let quantity = 0, failSubmit = false
  const cart = () => ({ platformId: 'taobao', accountId: profile.id, addressRef, shopId: 'store-17', revision: 'b'.repeat(64), quantity,
    invalidCount: 0, items: quantity ? [{ ref: 'c'.repeat(64), name: '示例饭', quantity, totalCents: 2000, available: true }] : [], totalCents: 2000 })
  const mounted = await mount({ async call(_channel, endpoint) {
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in', viewAccountRef: ref, accounts: [{ ref, externalId: profile.id }] })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'nearbyShops') return ok({ accountId: profile.id, addressRef, shops: [{ id: 'store-17', name: '示例店' }], nextCursor: null })
    if (endpoint === 'probeMenu') return ok({ accountId: profile.id, addressRef, shopId: 'store-17', categories: [{ id: 'main', name: '主食', items: [
      { id: 'food-1', name: '示例饭', description: '', imageUrl: null, price: '20', availability: 'available', tips: [], options: [] }] }] })
    throw Error('unexpected request')
  } }, { config: { dryRun: false }, addresses: async () => ok({ accountId: profile.id, selectedRef: addressRef,
    addresses: [{ ref: addressRef, address: '示例地址', usable: true }] }), trade: async (endpoint, payload) => {
      calls.push({ endpoint, payload }); assert.equal(payload.accountRef, ref)
      if (endpoint === 'tradeHistory') return ok({ accountId: profile.id, attempts: [] })
      if (endpoint === 'cart') return ok(cart())
      if (endpoint === 'cartChange') { assert.equal(payload.itemId, 'food-1'); quantity++; return ok(cart()) }
      if (endpoint === 'checkout') return ok({ ...cart(), merchant: '示例店', address: { address: '示例地址', contact: '示例用户', maskedPhone: '130****0000' },
        items: [{ name: '示例饭', quantity: 1, priceCents: 2000 }], fees: [{ name: '配送费', amountCents: 100 }], discountCents: 0,
        totalCents: 2100, deliveryTime: '明天 10:00 开始配送', quoteRef, expiresAt: Date.now() + 120000, previewOnly: false, maxOrderCents: 3500 })
      if (endpoint === 'submit') return failSubmit ? { ok: false, error: { code: 'order-unknown', message: '下单结果未确认，勿重复提交' } }
        : ok({ ...cart(), orderRef: quoteRef, orderIds: ['123456'], amountCents: 2100, paymentUrl: 'https://r.ele.me/payment?synthetic=1', paymentStatus: 'unconfirmed' })
      throw Error('unexpected trade operation')
    } })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(value => text(value.props.children) === label)
    await act(async () => button('点餐').props.onClick())
    await act(async () => button('查看菜单').props.onClick())
    await act(async () => button('加入购物车').props.onClick())
    assert.equal(calls.filter(call => call.endpoint === 'cartChange').length, 1)
    assert(text(mounted.renderer.toJSON()).includes('已加入购物车'))
    await act(async () => root.findByProps({ className: 'waimai-cart-trigger' }).props.onClick())
    await act(async () => button('去结算').props.onClick())
    assert.equal(button('确认创建订单').props.disabled, true)
    assert(text(mounted.renderer.toJSON()).includes('实付: ¥21.00'))
    assert(text(mounted.renderer.toJSON()).includes('明天 10:00 开始配送'))
    const confirm = () => root.findAllByType('label').find(node => text(node.props.children) === '我已核对商品、配送地址、时间和实付金额').findByType('span')
    await act(async () => confirm().props.onChange({ target: { checked: true } }))
    assert.equal(button('确认创建订单').props.disabled, false)
    await act(async () => { button('确认创建订单').props.onClick(); button('确认创建订单').props.onClick() })
    assert.equal(calls.filter(call => call.endpoint === 'submit').length, 1)
    assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call.endpoint === 'submit').payload)), { platformId: 'taobao', accountRef: ref, quoteRef, confirmed: true, confirmedCents: 2100, manualConfirmation: true, maxAmountCents: 3500 })
    assert.equal(root.findByType('a').props.href, 'https://r.ele.me/payment?synthetic=1')
    assert(!calls.some(call => /pay/.test(call.endpoint)))
    assert.equal(button('去结算').props.disabled, true)
    await act(async () => button('刷新购物车').props.onClick())
    failSubmit = true
    await act(async () => button('去结算').props.onClick())
    await act(async () => confirm().props.onChange({ target: { checked: true } }))
    await act(async () => button('确认创建订单').props.onClick())
    assert(text(mounted.renderer.toJSON()).includes('勿重复提交'))
    assert(!button('确认创建订单'))
  } finally { mounted.close() }
})

test('specifications require a variant and mandatory choices before adding; cart feedback stays visible and the cart opens in a modal', async () => {
  const ref = '11111111-1111-4111-8111-111111111111', addressRef = 'a'.repeat(64), calls = []
  const variantRefs = ['b'.repeat(64), 'c'.repeat(64)], choiceRefs = ['d'.repeat(64), 'e'.repeat(64)]
  let quantity = 0, failure = false; const changePending = deferred()
  const cart = () => ({ platformId: 'taobao', accountId: profile.id, addressRef, shopId: 'store-17', revision: 'f'.repeat(64),
    quantity, totalCents: quantity * 1500, invalidCount: 0, items: quantity ? [{ ref: 'g'.repeat(64), name: '示例奶茶', specification: '标准杯 · 少冰', quantity, totalCents: 1500 }] : [] })
  const mounted = await mount({ async call(_channel, endpoint) {
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in', viewAccountRef: ref, accounts: [{ ref, nickname: profile.nickname }] })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'nearbyShops') return ok({ accountId: profile.id, addressRef, shops: [{ id: 'store-17', name: '示例店铺' }], nextCursor: null })
    if (endpoint === 'probeMenu') return ok({ accountId: profile.id, addressRef, shopId: 'store-17', categories: [{ id: 'drinks', name: '饮品', items: [{ id: 'food-1',
      name: '示例奶茶', description: '', price: '15', availability: 'available', requiresSelection: true, options: [], tips: [] }] }] })
    throw Error('unexpected read')
  } }, { addresses: async () => ok({ accountId: profile.id, selectedRef: addressRef, addresses: [{ ref: addressRef, address: '示例地址', usable: true }] }),
    trade: async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      if (endpoint === 'tradeHistory') return ok({ accountId: profile.id, attempts: [] })
      if (endpoint === 'cart') return ok(cart())
      if (endpoint === 'itemOptions') return ok({ ...cart(), name: '示例奶茶', itemId: 'food-1', selectionRef: ref, minimumQuantity: 1,
        variants: [{ ref: variantRefs[0], name: '大杯', priceCents: 1700, available: true }, { ref: variantRefs[1], name: '标准杯', priceCents: 1500, available: true }],
        groups: [{ ref: 'temperature', name: '温度', minimum: 1, maximum: 1, choices: [{ ref: choiceRefs[0], name: '少冰', available: true }, { ref: choiceRefs[1], name: '热', available: false }] }] })
      if (endpoint === 'cartChange') {
        if (failure) return changePending.promise
        assert.equal(payload.variantRef, variantRefs[1]); assert.deepEqual(Array.from(payload.choiceRefs), [choiceRefs[0]]); assert.equal(payload.quantity, 1)
        quantity++; return ok(cart())
      }
      throw Error('unexpected trade')
    } })
  try {
    const root = mounted.renderer.root, button = label => root.findAllByType('button').find(value => text(value.props.children) === label)
    await act(async () => button('点餐').props.onClick()); await act(async () => button('查看菜单').props.onClick())
    assert.equal(root.findAllByProps({ role: 'dialog' }).length, 0)
    await act(async () => button('选规格').props.onClick())
    assert.equal(button('加入购物车').props.disabled, true); assert.equal(button('热').props.disabled, true)
    await act(async () => button('标准杯 · ¥15.00').props.onClick()); assert.equal(button('加入购物车').props.disabled, true)
    await act(async () => button('少冰').props.onClick()); assert.equal(button('加入购物车').props.disabled, false)
    const fixture = JSON.parse(await readFile(new URL('./fixtures/cart-specifications.expected.json', import.meta.url), 'utf8'))
    assert.equal(root.findByProps({ role: 'dialog' }).props['aria-label'], fixture.dialog)
    assert.deepEqual(fixture.choices.filter(label => button(label)).length, fixture.choices.length)
    await act(async () => button('加入购物车').props.onClick())
    assert.equal(root.findAllByProps({ role: 'dialog' }).length, 0)
    assert(text(mounted.renderer.toJSON()).includes(fixture.readyFeedback))
    assert.equal(root.findByProps({ className: 'waimai-cart-trigger' }).findAll(node => ['span', 'strong'].includes(node.type)).map(node => text(node.props.children)).join(''), fixture.floatingCart)
    await act(async () => root.findByProps({ className: 'waimai-cart-trigger' }).props.onClick())
    assert.equal(root.findByProps({ role: 'dialog' }).props['aria-label'], '购物车')
    assert(text(mounted.renderer.toJSON()).includes('标准杯 · 少冰'))
    await act(async () => root.findByProps({ role: 'dialog' }).props.onClose())
    failure = true
    await act(async () => button('选规格').props.onClick()); await act(async () => button('标准杯 · ¥15.00').props.onClick()); await act(async () => button('少冰').props.onClick())
    const add = button('加入购物车'); await act(async () => { add.props.onClick(); add.props.onClick() })
    assert.equal(button('正在加入…').props.disabled, true)
    assert.equal(calls.filter(call => call.endpoint === 'cartChange').length, 2)
    await act(async () => changePending.resolve({ ok: false, error: { code: 'cart-result-unconfirmed', message: '数量未确认，请刷新购物车核对' } }))
    assert.equal(root.findByProps({ role: 'dialog' }).props['aria-label'], '购物车')
    assert(text(mounted.renderer.toJSON()).includes('数量未确认'))
    assert(!text(mounted.renderer.toJSON()).includes('已加入购物车'))
    assert.equal(quantity, 1)
    assert(!calls.some(call => ['checkout', 'submit'].includes(call.endpoint)))
  } finally { mounted.close() }
})

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
    const image = root.findAllByType('img').find(value => value.props.alt === '淘宝扫码')
    assert.equal(image.props.src, 'data:image/png;base64,synthetic')
    assert(text(mounted.renderer.toJSON()).includes('正在完成闪购登录'))
    assert(text(mounted.renderer.toJSON()).includes(profile.nickname))
    assert(!calls.some(value => value.endpoint === 'qrPoll'))
    await act(async () => click('历史订单'))
    assert(!root.findAllByType('img').some(value => value.props.alt === '淘宝扫码'))
    assert(calls.some(value => value.endpoint === 'qrCancel' && value.payload.attemptId === attemptId))
  } finally { mounted.close() }
})

test('opening QR sign-in creates the code and automatically completes business verification without a check button', async () => {
  const attemptId = '11111111-1111-4111-8111-111111111111', timers = new Map(), calls = []
  let timerId = 0, polls = 0
  const mounted = await mount({ async call(_channel, endpoint) {
    calls.push(endpoint)
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in', loginMethod: 'sms' })
    if (endpoint === 'accountBegin') return ok({ authenticated: true, state: 'logged-in', addingAccount: true })
    if (endpoint === 'profile') return ok(profile)
    if (endpoint === 'qrStart') return ok({ authenticated: true, state: 'logged-in', addingAccount: true,
      qr: { attemptId, state: 'waiting', image: 'data:image/png;base64,synthetic', expiresAt: Date.now() + 180000, pollAfterMs: 2000 } })
    if (endpoint === 'qrPoll') {
      if (++polls === 2) return { ok: false, error: { code: 'temporary-failure', message: '请求暂时失败' } }
      const linked = polls === 3
      return ok({ authenticated: true, state: 'logged-in', addingAccount: !linked,
        qr: { attemptId, state: linked ? 'linked' : 'business-unconfirmed', authorizationExpiresAt: Date.now() + 60000, pollAfterMs: 2000 } })
    }
    if (endpoint === 'qrCancel') return ok({ qr: { attemptId, state: 'canceled' } })
    return ok({ accountId: profile.id, orders: [], nextCursor: null })
  } }, { setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id }, clearTimeout: id => timers.delete(id) })
  const tick = async () => { const [id, fn] = timers.entries().next().value; timers.delete(id); await act(async () => fn()) }
  try {
    const root = mounted.renderer.root
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '添加账号').props.onClick())
    assert.equal(calls.filter(value => value === 'qrStart').length, 1)
    assert(!root.findAllByType('button').some(button => text(button.props.children) === '检查闪购授权'))
    await tick()
    assert(text(mounted.renderer.toJSON()).includes('正在完成闪购登录'))
    assert(!text(mounted.renderer.toJSON()).includes('尚未检查登录状态'))
    assert.deepEqual({ steps: root.findByProps({ className: 'waimai-qr-steps' }).findAllByType('li').map(node => text(node.props.children)),
      status: text(root.findByProps({ className: 'waimai-qr-status' }).props.children),
      actions: root.findByProps({ 'aria-label': '淘宝扫码', 'aria-busy': false }).findAllByType('button').map(node => text(node.props.children)) },
      JSON.parse(await readFile(new URL('./fixtures/qr-flow.json', import.meta.url), 'utf8')))
    await tick()
    assert(text(mounted.renderer.toJSON()).includes('自动重试'))
    await tick()
    assert.equal(polls, 3); assert.equal(timers.size, 0)
    assert(text(mounted.renderer.toJSON()).includes(profile.nickname))
  } finally { mounted.close() }
})

test('account labels keep IDs in details and dropdown changes scope orders to the chosen account', async () => {
  const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222'
  const calls = [], accounts = [{ ref: first, externalId: profile.id, nickname: profile.nickname, loginMethod: 'sms' }, { ref: second, externalId: '67890', nickname: '第二账号', loginMethod: 'sms' }]
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
    assert(selector.props.items.every(item => !/12345|67890/.test(item.label)))
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

test('browser platform and account choices survive remounts without changing other open views', async () => {
  const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222'
  const entries = new Map(), storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }, calls = []
  const rpc = { async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    const ref = payload.accountRef || first
    if (endpoint === 'status' || endpoint === 'accountView') return ok({ authenticated: true, state: 'logged-in', viewAccountRef: ref,
      accounts: [{ ref: first, nickname: '第一账号' }, { ref: second, nickname: '第二账号' }] })
    if (endpoint === 'profile') return ok({ ...profile, nickname: ref === second ? '第二账号' : '第一账号' })
    throw Error('Unexpected request')
  } }
  let a = await mount(rpc, { storage }), b = await mount(rpc, { storage })
  try {
    const pick = (mounted, id, value) => mounted.renderer.root.findAll(node => node.type === 'span' && node.props.selectedId === id && Array.isArray(node.props.items))[0].props.onSelect(value)
    await act(async () => pick(a, first, second))
    assert(text(b.renderer.toJSON()).includes('第一账号')); assert(!text(b.renderer.toJSON()).includes('第二账号登录'))
    const persisted = JSON.parse(entries.get('dsh-waimai.view.v1'))
    assert.deepEqual(persisted, JSON.parse(await readFile(new URL('./fixtures/view-preference.json', import.meta.url), 'utf8')))
    assert(!entries.get('dsh-waimai.view.v1').includes(profile.id))
    a.close(); calls.length = 0; a = await mount(rpc, { storage })
    assert.equal(calls[0].payload.accountRef, second)
    assert(text(a.renderer.toJSON()).includes('第二账号'))
    await act(async () => pick(a, 'taobao', 'jd'))
    a.close(); calls.length = 0; a = await mount(rpc, { storage })
    assert(text(a.renderer.toJSON()).includes('该平台尚未接入'))
    assert.equal(calls.length, 0)
    await act(async () => pick(a, 'jd', 'taobao'))
    assert.equal(calls[0].payload.accountRef, second)
    assert(text(a.renderer.toJSON()).includes('第二账号'))
  } finally { a.close(); b.close() }
})

test('removed account and platform preferences use verified defaults while failed switches retain the previous choice', async () => {
  const first = '11111111-1111-4111-8111-111111111111', removed = '22222222-2222-4222-8222-222222222222'
  let stored = JSON.stringify({ version: 1, platformId: 'removed', accounts: { taobao: removed } })
  const calls = [], storage = { getItem: () => stored, setItem: (_key, value) => { stored = value } }
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    if (endpoint === 'accountView' || endpoint === 'status' && payload.accountRef) return { ok: false, error: { code: 'account-missing', message: '账号已移除' } }
    if (endpoint === 'status') return ok({ authenticated: true, state: 'logged-in', viewAccountRef: first, accounts: [{ ref: first }] })
    if (endpoint === 'profile') return ok(profile)
    throw Error('Unexpected request')
  } }, { storage })
  try {
    assert.equal(calls[0].payload.accountRef, removed)
    assert.equal(calls[1].payload.accountRef, undefined)
    assert(text(mounted.renderer.toJSON()).includes('账号 ID: 12345'))
    assert.deepEqual(JSON.parse(stored), { version: 1, platformId: 'taobao', accounts: { taobao: first } })
    const selector = mounted.renderer.root.findAll(node => node.type === 'span' && node.props.selectedId === first && Array.isArray(node.props.items))[0]
    await act(async () => selector.props.onSelect(removed))
    assert(text(mounted.renderer.toJSON()).includes('账号已移除'))
    assert.equal(JSON.parse(stored).accounts.taobao, first)
  } finally { mounted.close() }
})

test('unreadable browser storage does not prevent account selection and reports a persistence failure', async () => {
  const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222'
  const mounted = await mount({ async call(_channel, endpoint, payload) {
    if (endpoint === 'status' || endpoint === 'accountView') return ok({ authenticated: true, state: 'logged-in', viewAccountRef: payload.accountRef || first,
      accounts: [{ ref: first }, { ref: second }] })
    if (endpoint === 'profile') return ok(profile)
    throw Error('Unexpected request')
  } }, { storage: { getItem() { throw Error('Storage denied') }, setItem() { throw Error('Storage denied') } } })
  try {
    const selector = mounted.renderer.root.findAll(node => node.type === 'span' && node.props.selectedId === first && Array.isArray(node.props.items))[0]
    await act(async () => selector.props.onSelect(second))
    assert(text(mounted.renderer.toJSON()).includes('无法记住此次选择'))
    assert(mounted.renderer.root.findAll(node => node.type === 'span' && node.props.selectedId === second).length)
  } finally { mounted.close() }
})

test('corrupt preferences do not reach the Host, and a failed restore does not silently query another account', async () => {
  const ref = '22222222-2222-4222-8222-222222222222'
  for (const [stored, expectedRef] of [['invalid-json', undefined], [JSON.stringify({ version: 1, accounts: { taobao: 'not-a-reference' } }), undefined],
    [JSON.stringify({ version: 2, accounts: { taobao: ref } }), undefined], [JSON.stringify({ version: 1, platformId: 'taobao', accounts: { taobao: ref } }), ref]]) {
    const calls = [], mounted = await mount({ async call(_channel, endpoint, payload) {
      calls.push({ endpoint, payload })
      return { ok: false, error: { code: 'verification-required', message: '平台需要验证' } }
    } }, { storage: { getItem: () => stored, setItem() { throw Error('A failed restore must not write preferences') } } })
    try {
      assert.equal(calls.length, 1); assert.equal(calls[0].payload.accountRef, expectedRef)
      assert(text(mounted.renderer.toJSON()).includes('平台需要验证'))
    } finally { mounted.close() }
  }
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
    assert(!root.findAllByType('button').some(button => text(button.props.children) === '去结算'))
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

test('advertising preference defaults to hidden and saves only the changed setting', async () => {
  let operations
  const mounted = await mount({ async call(_channel, endpoint) { return endpoint === 'profile' ? ok(profile) : ok({ authenticated: true, state: 'logged-in' }) } },
    { mutate: async ops => { operations = ops; return true } })
  try {
    const root = mounted.renderer.root
    await act(async () => root.findAllByType('button').find(button => text(button.props.children) === '点单设置').props.onClick())
    const toggle = root.findAll(node => node.type === 'span' && node.props.label === '隐藏推广店铺')[0]
    assert(toggle.props.checked)
    assert.deepEqual({ label: toggle.props.label, checked: toggle.props.checked }, JSON.parse(await readFile(new URL('./fixtures/ads-setting.json', import.meta.url), 'utf8')))
    act(() => toggle.props.onChange(false))
    await act(async () => root.findByType('form').props.onSubmit({ preventDefault() {} }))
    assert.deepEqual(structuredClone(operations), [{ op: 'set', path: ['hideSponsoredShops'], value: false }])
    assert(text(mounted.renderer.toJSON()).includes('已保存'))
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
