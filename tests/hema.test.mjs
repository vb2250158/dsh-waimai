import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HemaLogin, hemaStorage } from '../lib/hema-login.js'
import { hemaJson, hemaOrders, hemaProfile, hemaAddresses, hemaProducts, hemaProductDetail, hemaCart, HemaProductCursor } from '../lib/hema-data.js'
import { HemaService } from '../lib/hema-service.js'
import { AccountPool } from '../lib/account-pool.js'
import { WaimaiLogin } from '../lib/login.js'
import { PlatformService } from '../lib/platform-service.js'

const cookie = { name: 'synthetic-session', value: 'private-test-value', domain: '.taobao.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }
const storageState = { cookies: [cookie], origins: [] }
const profile = { isSelf: true, nick: 'Hema test user', avatar: 'http://img.alicdn.com/test-avatar.png' }
const address = { addreid: 17, addrName: 'Synthetic road', addrDetail: 'Synthetic room', linkMan: 'Private contact', linkPhone: '13800000000', geoCode: 'private-location',
  decidedShopData: { groupList: [{ groupId: 'group-1', groupName: 'Delivery store', groupType: 'FRESH_GROUP', deliveryType: 'DELIVERY', ext: { shopIds: '123,456' } }] } }
const order = { bizOrderId: '900719925474099312345', shopVO: { shopId: '123', shopName: 'Delivery store' }, statusVO: { statusText: 'Delivered' },
  orderTimeVO: { createTime: '2026-10-11 18:24:46' }, payInfoVO: { actualPayFee: 290 },
  itemVOList: [{ itemTitle: 'Eggs', buyAmount: 1, buyQuantity: '1盒', buyUnit: '盒' }], tracking: 'must-not-leak' }
const product = { serviceId: 'item-1', shopId: '123', serviceTitle: 'Eggs', subTitle: 'Box', mainImage: 'https://img.alicdn.com/eggs.png',
  price: '699', priceUnit: '盒', inventory: '3', shopClosed: '0', tracking: 'must-not-leak', cartAction: 'must-not-leak' }
const search = { isSuccess: true, module: { dataList: [{ service: product }, { service: { serviceType: 10 } }], totalCount: 1, hasMorePage: '0' } }

test('source export checks Taobao identity separately from the Eleme site identity and refuses a changing root session', async () => {
  const login = new WaimaiLogin({ statePath: 'unused', persistLogin: false })
  login.loginMethod = 'taobao-qr'; login.havanaId = '88888'; login.protocol = { taobaoIdentity: { api: 'root-identity' } }
  login.requireAccount = async () => { login.accountId = '77777' }
  login.http = { storageState: async () => structuredClone(storageState) }
  let rootId = '12345', calls = 0, change = false
  login.mtop = async spec => { assert.equal(spec.api, 'root-identity'); return { ret: ['SUCCESS::synthetic'], data: { userNumId: change && ++calls === 2 ? '99999' : rootId } } }
  const exported = await login.exportTaobaoSession()
  assert.equal(exported.accountId, '12345'); assert.equal(exported.businessAccountId, '77777'); assert.notEqual(exported.accountId, login.havanaId)
  assert.deepEqual(exported.storageState, storageState)
  change = true; await assert.rejects(login.exportTaobaoSession(), /身份已变化/)
  login.loginMethod = 'sms'; await assert.rejects(login.exportTaobaoSession(), /扫码登录/)
})

const detailResponse = { templateVO: { global: { itemId: '777', shopId: '123', itemName: 'Eggs', subTitle: 'Box',
  mainImageUrl: 'https://img.alicdn.com/eggs.png', originPrice: 806, discountPrice: 699, showUnit: '盒', saleFlag: true, ifOutRange: false,
  encryptionParams: { convert: false, dynamicParamToK: 'must-not-leak' }, skuItemList: [{ skuId: '888', saleSpec: '400g/盒',
    increment: 1, startWith: 1, stockQuantity: 3, saleUnit: '盒', chargeUnit: '盒' }] } } }

test('Hema pagination retains platform tokens privately and rejects cross-query, cross-address and replayed products', async () => {
  let duplicate = false
  const f = await fixture({ catalog(payload) {
    const position = JSON.parse(payload.pageParam).index, ext = JSON.parse(payload.extParam)
    if (position) assert.equal(ext.exposeRn, 'synthetic-exposure')
    return { isSuccess: true, module: { totalCount: 2, hasMorePage: position ? '0' : '1',
      RN: 'synthetic-rank', first_rn: 'synthetic-first', exposeInfo: { exposeRn: 'synthetic-exposure' },
      dataList: [{ service: { ...product, serviceId: position && !duplicate ? '778' : '777' } }] } }
  }, detail: () => detailResponse })
  try {
    const profile = await f.login.profile(), addresses = await f.service.addresses('hema')
    const ref = addresses.addresses[0].ref
    await f.service.selectAddress('hema', profile.id, ref)
    const first = await f.service.probeMenu('hema', 'group-1', ref, 'eggs')
    assert(HemaProductCursor.safeParse(first.nextCursor).success)
    assert(!JSON.stringify(first).includes('synthetic-exposure')); assert(!JSON.stringify(first).includes('nativeShopId'))
    assert.equal(first.categories[0].items[0].productRef.length, 36)
    const before = f.calls.filter(x => x.api === 'mtop.wdk.search.item').length
    await assert.rejects(f.service.probeMenu('hema', 'group-1', ref, 'milk', first.nextCursor), /分页已失效/)
    assert.equal(f.calls.filter(x => x.api === 'mtop.wdk.search.item').length, before)
    const second = await f.service.probeMenu('hema', 'group-1', ref, 'eggs', first.nextCursor)
    assert.equal(second.nextCursor, null); assert.equal(second.categories[0].items[0].id, '778')
    assert.equal(JSON.parse(f.calls.findLast(x => x.api === 'mtop.wdk.search.item').payload.pageParam).index, 30)
    duplicate = true
    await assert.rejects(f.service.probeMenu('hema', 'group-1', ref, 'eggs', first.nextCursor), /重复或空/)
    const detail = await f.service.productDetail('hema', first.categories[0].items[0].productRef, ref)
    assert.equal(detail.product.price, '6.99'); assert.equal(detail.product.variants[0].name, '400g/盒')
    assert(!JSON.stringify(detail).includes('must-not-leak'))
    await assert.rejects(f.service.productDetail('hema', '11111111-1111-4111-8111-111111111111', ref), /选择已失效/)
    f.change({ identity: '99999' })
    await assert.rejects(f.service.probeMenu('hema', 'group-1', ref, 'eggs', first.nextCursor), /配送地址|分页已失效/)
  } finally { await f.close() }
})

test('Hema detail validates item, native store, SKU identity and quantities before exposing specifications', () => {
  assert.equal(hemaProductDetail(detailResponse, { id: '777', nativeShopId: '123' }).variants[0].stockQuantity, 3)
  assert.throws(() => hemaProductDetail(detailResponse, { id: '778', nativeShopId: '123' }))
  assert.throws(() => hemaProductDetail(detailResponse, { id: '777', nativeShopId: '456' }))
  const invalid = structuredClone(detailResponse); invalid.templateVO.global.skuItemList[0].increment = 0
  assert.throws(() => hemaProductDetail(invalid, { id: '777', nativeShopId: '123' }))
  invalid.templateVO.global.skuItemList[0].increment = 1
  invalid.templateVO.global.skuItemList.push(invalid.templateVO.global.skuItemList[0])
  assert.throws(() => hemaProductDetail(invalid, { id: '777', nativeShopId: '123' }))
  assert(!HemaProductCursor.safeParse({ platformId: 'taobao', ref: '11111111-1111-4111-8111-111111111111' }).success)
})

const cartResponse = { global: { controlParas: { hema: '1' } }, hierarchy: { root: 'root', structure: { root: ['valid', 'invalid'] } }, data: {
  root: { tag: 'cartHemaGlobal', fields: {} }, valid: { tag: 'mainItem', fields: { cartId: '999', title: 'Eggs', quantity: '1',
    isChecked: 'false', canCheck: true, pay: { afterPromPrice: 699, nowTitle: '￥6.99', payUnit: '/盒' }, sku: { skuInvalid: false },
    outerUrl: 'must-not-leak', settlement: 'must-not-leak' } }, invalid: { tag: 'invalidMainItem', fields: { cartId: '998', title: 'Milk', quantity: '2',
      isChecked: 'false', canCheck: false, pay: { afterPromPrice: 1000, nowTitle: '￥5.00', payUnit: '/瓶' }, sku: { skuInvalid: true }, codeMsg: 'Unavailable' } } } }

test('converted detail prices remain unknown and cart display prices are not replaced with line totals', () => {
  const detail = structuredClone(detailResponse); detail.templateVO.global.encryptionParams.convert = true
  let projected = hemaProductDetail(detail, { id: '777', nativeShopId: '123' })
  assert.equal(projected.price, null); assert.equal(projected.originalPrice, null)
  assert.equal(projected.variants.length, 1); assert(!JSON.stringify(projected).includes('dynamicParamToK'))
  delete detail.templateVO.global.encryptionParams
  assert.equal(hemaProductDetail(detail, { id: '777', nativeShopId: '123' }).price, null)
  const cart = structuredClone(cartResponse); cart.data.invalid.fields.pay.afterPromPrice = 640; cart.data.invalid.fields.pay.nowTitle = '￥3.2'
  assert.equal(hemaCart(cart).items[1].price, '3.20'); assert.equal(hemaCart(cart).items[1].quantity, '2')
  cart.data.invalid.fields.pay.nowTitle = '￥unknown'; assert.throws(() => hemaCart(cart))
})

test('Hema passive image URLs use HTTPS while rejecting credentials, ports, tracking and foreign hosts', () => {
  for (const source of ['//img.alicdn.com/egg.jpg', 'http://img.alicdn.com/egg.jpg', 'https://img.alicdn.com/egg.jpg']) {
    assert.equal(hemaProfile({ ...profile, avatar: source }, '12345').avatarUrl, 'https://img.alicdn.com/egg.jpg')
    assert.equal(hemaProducts({ ...search, module: { ...search.module, dataList: [{ service: { ...product, mainImage: source } }] } }, new Set(['123'])).items[0].imageUrl, 'https://img.alicdn.com/egg.jpg')
    const detail = structuredClone(detailResponse); detail.templateVO.global.mainImageUrl = source
    assert.equal(hemaProductDetail(detail, { id: '777', nativeShopId: '123' }).imageUrl, 'https://img.alicdn.com/egg.jpg')
    const cart = structuredClone(cartResponse); cart.data.valid.fields.pic = source
    assert.equal(hemaCart(cart).items[0].imageUrl, 'https://img.alicdn.com/egg.jpg')
  }
  for (const source of ['//img.alicdn.com@127.0.0.1/egg.jpg', 'http://img.alicdn.com:8080/egg.jpg', '//img.alicdn.com/egg.jpg?token=private', '//other.example/egg.jpg', 'javascript:alert(1)', 'http://img.alicdn.com.evil.example/egg.jpg']) {
    assert.equal(hemaProfile({ ...profile, avatar: source }, '12345').avatarUrl, null)
  }
})

test('Hema cart reads current-address availability without editing items and refuses incomplete or foreign results', async () => {
  const projected = hemaCart(cartResponse)
  assert.equal(projected.items.length, 2); assert.equal(projected.availableCount, 1); assert.equal(projected.items[0].price, '6.99')
  assert.equal(projected.items[1].reason, 'Unavailable'); assert(!JSON.stringify(projected).includes('must-not-leak'))
  for (const corrupt of [value => { value.hierarchy.structure.root.pop() }, value => { value.data.invalid.fields.cartId = '999' },
    value => { value.hierarchy.structure.valid = ['root'] }, value => { value.global.controlParas.hema = '0' },
    value => { value.data.valid.fields.quantity = '0' }]) {
    const copy = structuredClone(cartResponse); corrupt(copy); assert.throws(() => hemaCart(copy))
  }
  const f = await fixture({ cart: () => cartResponse })
  try {
    const profile = await f.login.profile(), addresses = await f.service.addresses('hema'), ref = addresses.addresses[0].ref
    await f.service.selectAddress('hema', profile.id, ref)
    const result = await f.service.cart('hema', ref)
    assert.equal(result.addressRef, ref); assert.equal(result.orderingAvailable, true)
    const call = f.calls.findLast(x => x.api === 'mtop.trade.query.bag')
    assert.equal(call.payload.cartFrom, 'wdk_hema_client'); assert.equal(call.payload.isPage, false)
    assert.equal(JSON.parse(call.payload.exParams).poi, address.geoCode)
    assert.equal(JSON.parse(call.payload.exParams).locShopIds, '123,456')
    await assert.rejects(f.service.cart('hema', 'b'.repeat(64)), /配送地址/)
    assert.equal(f.calls.filter(x => x.api === 'mtop.trade.query.bag').length, 1)
    f.change({ identity: '99999' }); await assert.rejects(f.service.cart('hema', ref), /配送地址/)
    assert(!f.calls.some(x => /addBag|update.bag|confirm|create|pay/i.test(x.api)))
  } finally { await f.close() }
})

async function fixture({ catalog, detail, cart } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-hema-')), calls = [], jars = []
  let identity = '12345', changedIdentity, self = true, ordersRejected = false, challenge = false
  const createContext = async options => {
    const jar = { state: structuredClone(options.storageState || { cookies: [], origins: [] }), disposed: false,
      storageState: async () => structuredClone(jar.state), dispose: async () => { jar.disposed = true },
      get: async url => {
        const parsed = new URL(url), api = parsed.searchParams.get('api'), payload = JSON.parse(parsed.searchParams.get('data'))
        calls.push({ api, payload, host: parsed.hostname })
        let data, ret = ['SUCCESS::synthetic']
        if (api === 'mtop.user.getUserSimple') data = { userNumId: changedIdentity || identity }
        else if (api === 'mtop.wdk.iseeku.user.profile.get') { data = { ...profile, isSelf: self }; if (changedIdentity) identity = changedIdentity }
        else if (api === 'mtop.hema.trade.order.buyer.list.search') {
          data = { data: { pageNo: payload.pageIndex, pageSize: payload.pageSize, hasMore: payload.pageIndex === 1,
            orderList: [{ ...order, bizOrderId: order.bizOrderId + payload.pageIndex }] } }
          if (ordersRejected) ret = ['FAIL_SYS_SESSION_EXPIRED::synthetic']
        } else if (api === 'mtop.wdk.lbs.location.UserAddressReadApi.getAllAddress') data = { addressList: [address] }
        else if (api === 'mtop.wdk.search.item') data = catalog ? catalog(payload) : search
        else if (api === 'mtop.wdk.detail.openservice' && detail) data = detail(payload)
        else if (api === 'mtop.trade.query.bag' && cart) data = cart(payload)
        else throw new Error('unexpected endpoint')
        if (challenge) ret = ['FAIL_SYS_USER_VALIDATE::private-url']
        return { ok: () => true, text: async () => JSON.stringify({ ret, data }) }
      } }
    jars.push(jar); return jar
  }
  const login = new HemaLogin({ statePath: join(directory, 'login-state.json'), createContext })
  return { directory, login, calls, jars, createContext, service: new HemaService({ login, directory }),
    change: options => { if (options.identity) identity = options.identity; if (options.changedIdentity) changedIdentity = options.changedIdentity;
      if ('self' in options) self = options.self; if ('ordersRejected' in options) ordersRejected = options.ordersRejected; if ('challenge' in options) challenge = options.challenge },
    close: async () => { await login.close(); assert(directory.startsWith(join(tmpdir(), 'waimai-hema-'))); await rm(directory, { recursive: true, force: true }) } }
}

test('Hema projection retains exact order IDs, China time, cents, units and safe HTTPS avatars', () => {
  const exact = hemaJson('{"id":900719925474099312345,"count":2,"weight":1.5}')
  assert.equal(exact.id, order.bizOrderId); assert.equal(exact.count, 2); assert.equal(exact.weight, 1.5)
  assert.throws(() => hemaJson('{"price":1e500}')); assert.throws(() => hemaJson('{"id":1,"id":2}'))
  const page = hemaOrders({ pageNo: 1, pageSize: 10, hasMore: true, orderList: [order] }, 10, 1, '12345')
  assert.equal(page.orders[0].id, order.bizOrderId); assert.equal(page.orders[0].amount, '2.90')
  assert.equal(page.orders[0].createdAt, Date.parse('2026-10-11T18:24:46+08:00'))
  assert.equal(page.orders[0].items[0].unit, '盒'); assert(!JSON.stringify(page).includes('must-not-leak'))
  assert.deepEqual(page.nextCursor, { platformId: 'hema', accountId: '12345', pageIndex: 2 })
  assert.throws(() => hemaOrders({ pageNo: 2, pageSize: 10, hasMore: true, orderList: [order] }, 10, 1, '12345'))
  assert.equal(hemaProfile(profile, '12345').avatarUrl, 'https://img.alicdn.com/test-avatar.png')
  assert.throws(() => hemaProfile({ ...profile, isSelf: false }, '12345'))
  for (const avatar of ['http://evil.test/a.png', 'https://img.alicdn.com/a.png?token=x', 'https://u:p@img.alicdn.com/a.png']) {
    assert.equal(hemaProfile({ ...profile, avatar }, '12345').avatarUrl, null)
  }
})

test('Hema address and product projections isolate ownership and strip contacts, actions and tracking', () => {
  const records = hemaAddresses({ addressList: [address] }, '12345')
  assert.equal(records[0].display.maskedPhone, '138****0000')
  assert(!JSON.stringify(records[0].display).includes(address.geoCode)); assert(!JSON.stringify(records[0].display).includes(address.linkPhone))
  assert.notEqual(records[0].ref, hemaAddresses({ addressList: [address] }, '67890')[0].ref)
  assert.throws(() => hemaAddresses({ addressList: [address, address] }, '12345'))
  const data = hemaProducts(search, new Set(['123']))
  assert.equal(data.items.length, 1); assert.equal(data.items[0].price, '6.99'); assert.equal(data.items[0].priceUnit, '盒')
  assert(!JSON.stringify(data).includes('must-not-leak'))
  assert.throws(() => hemaProducts(search, new Set(['999'])))
  assert.throws(() => hemaProducts({ ...search, isSuccess: false }, new Set(['123'])))
  assert.throws(() => hemaProducts({ ...search, module: { ...search.module, dataList: [{ service: product }, { service: product }] } }, new Set(['123'])))
})

test('an explicit Taobao session creates independent Hema credentials only after self profile and order verification', async () => {
  const f = await fixture()
  try {
    const source = structuredClone(storageState)
    await f.login.acceptTaobaoSession(source, '12345')
    assert.deepEqual(source, storageState)
    assert(f.jars[0].disposed); assert.notEqual(f.jars[0], f.jars[1])
    const saved = JSON.parse(await readFile(f.login.statePath, 'utf8'))
    assert.equal(saved.platformId, 'hema'); assert.equal(saved.loginMethod, 'taobao-qr')
    assert(!JSON.stringify(f.login.summary()).includes(cookie.value))
    const first = await f.login.orders(), second = await f.login.orders(first.nextCursor)
    assert.notEqual(first.orders[0].id, second.orders[0].id)
    await assert.rejects(f.login.orders({ ...first.nextCursor, accountId: '99999' }), /不属于/)
    await assert.rejects(f.login.orders({ pageNum: 1, fromTime: 0 }))
    assert(f.calls.every(call => call.host === 'h5api.m.taobao.com'))
    assert(!f.calls.some(call => /bind|pay|create|ucc/i.test(call.api)))
    const filtered = hemaStorage({ cookies: [...source.cookies, { ...cookie, domain: '.ele.me' }], origins: [{ origin: 'https://example.test' }] })
    assert.deepEqual(filtered, storageState)
  } finally { await f.close() }
})

test('failed Hema activation, challenges and corrupt state preserve previous credentials and return no private response', async () => {
  const f = await fixture()
  try {
    await f.login.acceptTaobaoSession(storageState, '12345')
    const before = await readFile(f.login.statePath, 'utf8')
    f.change({ identity: '67890' })
    await assert.rejects(f.login.acceptTaobaoSession(storageState, '12345'), /身份不一致/)
    assert.equal(await readFile(f.login.statePath, 'utf8'), before)
    f.change({ identity: '12345', self: false })
    await assert.rejects(f.login.acceptTaobaoSession(storageState, '12345'), /资料无法确认/)
    f.change({ self: true, ordersRejected: true })
    await assert.rejects(f.login.acceptTaobaoSession(storageState, '12345'), /可用数据/)
    assert.equal(await readFile(f.login.statePath, 'utf8'), before)
    f.change({ ordersRejected: false, challenge: true })
    await assert.rejects(f.login.profile(), error => /人工验证/.test(error.message) && !error.message.includes('private-url'))
    await f.login.close(); await writeFile(f.login.statePath, '{broken')
    await assert.rejects(f.login.init(), /原记录仍保留/); assert.equal(await readFile(f.login.statePath, 'utf8'), '{broken')
  } finally { await f.close() }
})

test('a fresh Hema QR jar is independently confirmed, canceled attempts stay separate and reads reject an identity change', async () => {
  const f = await fixture()
  try {
    await f.login.init()
    f.login.qr.id = '11111111-1111-4111-8111-111111111111'
    f.login.qr.http = await f.createContext({ storageState })
    f.login.qr.state = 'business-unconfirmed'
    f.login.qr.poll = async () => f.login.qr.summary()
    const result = await f.login.qrPoll(f.login.qr.id)
    assert.equal(result.qr.state, 'linked'); assert.equal(result.authenticated, true)
    const before = await readFile(f.login.statePath, 'utf8'), mtop = f.login.mtop.bind(f.login)
    f.login.mtop = async (spec, payload) => {
      const raw = await mtop(spec, payload)
      if (spec.api === 'mtop.wdk.iseeku.user.profile.get') f.change({ identity: '67890' })
      return raw
    }
    await assert.rejects(f.login.profile(), /身份已变化/)
    assert.equal(await readFile(f.login.statePath, 'utf8'), before)
    await assert.rejects(f.login.qrCancel('22222222-2222-4222-8222-222222222222'), /二维码已更新/)
    assert.equal(await readFile(f.login.statePath, 'utf8'), before)
  } finally { await f.close() }
})

test('Hema address selection persists independently and products require a current delivery group and explicit query', async () => {
  const f = await fixture()
  try {
    await f.login.acceptTaobaoSession(storageState, '12345')
    await assert.rejects(f.service.nearbyShops('hema'), error => error.code === 'address-required')
    const addresses = await f.service.addresses('hema')
    await f.service.selectAddress('hema', '12345', addresses.addresses[0].ref)
    const saved = await readFile(f.service.selectionPath, 'utf8'); assert(!saved.includes(address.linkMan)); assert(!saved.includes(address.geoCode))
    assert.equal((await new HemaService({ login: f.login, directory: f.directory }).addresses('hema')).selectedRef, addresses.addresses[0].ref)
    const stores = await f.service.nearbyShops('hema'); assert.equal(stores.scope, 'delivery-stores')
    assert(!JSON.stringify(stores).includes(address.linkPhone))
    assert.equal((await f.service.probeMenu('hema', 'group-1', stores.addressRef)).queryRequired, true)
    assert(!f.calls.some(call => call.api === 'mtop.wdk.search.item'))
    await assert.rejects(f.service.probeMenu('hema', 'foreign-group', stores.addressRef, 'Eggs'), error => error.code === 'shop-unavailable')
    const products = await f.service.probeMenu('hema', 'group-1', stores.addressRef, 'Eggs')
    assert.equal(products.categories[0].items[0].price, '6.99'); assert.equal(products.orderingAvailable, true)
    const request = f.calls.find(call => call.api === 'mtop.wdk.search.item')
    assert.equal(request.payload.searchType, 'mainSearch'); assert.equal(JSON.parse(request.payload.pageParam).index, 0)
    assert.doesNotThrow(() => f.service.requireOrdering('hema', 'checkout'))
    for (const capability of ['createOrder', 'payment']) assert.throws(() => f.service.requireOrdering('hema', capability))
    f.change({ identity: '67890' })
    await assert.rejects(f.service.nearbyShops('hema'), error => error.code === 'address-required')
    assert.equal(await readFile(f.service.selectionPath, 'utf8'), saved)
  } finally { await f.close() }
})

test('account pool chooses a Hema adapter, refuses unsupported SMS and foreign source references before accessing another jar', async () => {
  const f = await fixture(), pool = new AccountPool({ directory: f.directory, definitions: new PlatformService({ directory: f.directory }).list(),
    loginOptions: { persistLogin: true, createContext: f.createContext } })
  let serviceCloses = 0
  try {
    await pool.init()
    await assert.rejects(pool.dispatch('qrStart', { platformId: 'hema', loginMethod: 'hema-qr' }), error => error.code === 'login-method-unavailable')
    assert.equal(pool.sessions.size, 0)
    await assert.rejects(pool.dispatch('sendCode', { platformId: 'hema', loginMethod: 'sms', phone: '13800000000' }), error => error.code === 'login-method-unavailable')
    assert.equal(pool.sessions.size, 0)
    await assert.rejects(pool.dispatch('useTaobao', { platformId: 'hema', sourceAccountRef: '11111111-1111-4111-8111-111111111111' }), error => error.code === 'account-missing')
    assert.equal(pool.sessions.size, 0)
    const ref = '22222222-2222-4222-8222-222222222222'
    pool.index.platforms.taobao = { activeRef: ref, accounts: [{ ref, externalId: '77777', loginMethod: 'taobao-qr' }] }
    const source = { profile: async () => ({ id: '77777' }), exportTaobaoSession: async () => ({ accountId: '12345', businessAccountId: '77777', storageState }), close: async () => {} }
    pool.sessions.set('taobao:' + ref, { ref, login: source, service: { close: async () => { serviceCloses++ } } })
    await pool.save(pool.index)
    const beforeSource = structuredClone(pool.index.platforms.taobao)
    const status = await pool.dispatch('useTaobao', { platformId: 'hema', sourceAccountRef: ref })
    assert.equal(status.accounts.length, 1); assert.equal(status.authenticated, true)
    assert.deepEqual(pool.index.platforms.taobao, beforeSource)
    assert(pool.active('hema').login instanceof HemaLogin); assert(pool.active('hema').service instanceof HemaService)
    assert(!JSON.stringify(await pool.connections()).includes(profile.nick))
    const index = await readFile(pool.indexPath, 'utf8')
    f.change({ identity: '99999' })
    await assert.rejects(pool.dispatch('useTaobao', { platformId: 'hema', sourceAccountRef: ref }), /身份不一致/)
    assert.equal(await readFile(pool.indexPath, 'utf8'), index)
  } finally { await pool.close(); await f.close() }
  assert.equal(serviceCloses, 1)
})
