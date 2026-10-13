import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browseImage, menuData, menuMerchantIdentity, MenuMerchantIdentityRequired, shopPage } from '../lib/browse-data.js'
const menu = JSON.parse(await readFile(new URL('./fixtures/menu.json', import.meta.url), 'utf8'))
const context = { accountId: '12345', addressRef: 'a'.repeat(64), offset: 0 }
const shops = { data: { frontend_page_shop_list_recommend: { error: {}, customized: { hasNext: true, rankId: 'synthetic-rank' },
  fields: { items: [{ bizCode: 'shop', fields: { restaurant: { id: 'store-17', name: '示例店', status: 1,
    imagePath: 'https://img.alicdn.com/imgextra/example.png', fieldMap: { shopDeliveryTime: { text: '20~30分钟' }, shopDeliveryFee: { tips: '配送约¥2', floatMinimumOrderAmount: 20 } },
    scheme: 'https://h5.ele.me/private', userTrack: { token: 'private-tracking' } } } }] } } } }

test('menu display includes folded and sold-out items, options and listed prices without purchase or tracking data', () => {
  const result = menuData(menu, 'store-17')
  assert.equal(result.categories.length, 1)
  assert.equal(result.categories[0].items.length, 2)
  const [food, soup] = result.categories[0].items
  assert.equal(food.price, '20.50'); assert.equal(food.options[0].values[1].available, false)
  assert.equal(soup.availability, 'sold-out'); assert.equal(result.orderingAvailable, true)
  assert.equal(result.automaticOrderingAvailable, false); assert.equal(result.userConfirmationRequired, true)
  for (const secret of ['private-order', 'private-tracking', 'private-action', 'useCouponPrice']) assert(!JSON.stringify(result).includes(secret))
})

test('menus reject foreign merchants, unsupported headings, invalid prices and conflicting native merchant aliases', () => {
  for (const mutate of [
    value => { value.resultMap.menu.itemGroups[1].items[1].storeId = 'foreign' },
    value => { value.resultMap.menu.itemGroups[1].items[0].itemType = 0 },
    value => { value.resultMap.menu.itemGroups[1].items[1].price = '-3' },
    value => { value.resultMap.menu.itemGroups[1].foldItems.push({ itemId: 'food-1', storeId: '1818', name: '示例饭' }) },
    value => { value.resultMap.menu.itemGroups[1].soldOutItems[0].storeId = 'foreign' },
  ]) { const value = structuredClone(menu); mutate(value); assert.throws(() => menuData(value, 'store-17')) }
})

test('sold-out numeric merchant identities are resolved by the matching shop header without requiring a folded duplicate', () => {
  const value = structuredClone(menu), category = value.resultMap.menu.itemGroups[1]
  category.foldItems = []
  assert.throws(() => menuData(value, 'store-17'), MenuMerchantIdentityRequired)
  const head = { resultMap: { storeHead: { storeInfo: { storeId: 'store-17' } },
    storeHeadBusinessInfo: { storeId: 'store-17' }, storeMiniAppTab: [{ tbRestaurantId: '1717' }, { tbRestaurantId: 1717 }] } }
  const identity = menuMerchantIdentity(head, 'store-17')
  const result = menuData(value, 'store-17', identity)
  assert.equal(result.categories[0].items[1].availability, 'sold-out')
  for (const mutate of [h => { h.resultMap.storeHead.storeInfo.storeId = 'foreign' },
    h => { h.resultMap.storeHeadBusinessInfo.storeId = 'foreign' },
    h => { h.resultMap.storeMiniAppTab.push({ tbRestaurantId: '9999' }) },
    h => { h.resultMap.storeMiniAppTab = [] }]) {
    const invalid = structuredClone(head); mutate(invalid); assert.throws(() => menuMerchantIdentity(invalid, 'store-17'))
  }
  category.soldOutItems[0].storeId = '9999'
  assert.throws(() => menuData(value, 'store-17', identity))
  category.items[1].storeId = '1717'
  assert.throws(() => menuData(value, 'store-17', identity))
})

test('header-verified menu identity snapshot retains display fields and excludes recent purchases from alias confirmation', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/menu-native-identities.json', import.meta.url), 'utf8'))
  const expected = JSON.parse(await readFile(new URL('./fixtures/menu-native-identities.expected.json', import.meta.url), 'utf8'))
  assert.deepEqual(menuData(fixture.menu, 'store-17', menuMerchantIdentity(fixture.header, 'store-17')), expected)
  const value = structuredClone(menu), parent = value.resultMap.menu.itemGroups[1]
  const original = parent.items[1]
  parent.items = []; parent.soldOutItems = []
  value.resultMap.menu.itemGroups[0].items = [original]
  assert.throws(() => menuData(value, 'store-17'), MenuMerchantIdentityRequired)
  parent.subItemCategoryList = [{ groupId: 'nested', name: '嵌套菜单', items: [original] }]
  assert.equal(menuData(value, 'store-17').categories[0].items[0].id, original.itemId)
})

test('nearby pages preserve delivery display fields and bind their next position to account and address', () => {
  const result = shopPage(shops, 10, context)
  assert.equal(result.shops[0].deliveryTime, '20~30分钟'); assert.equal(result.shops[0].minimumOrder, '20')
  assert.deepEqual(result.nextCursor, { ...context, offset: 10, rankId: 'synthetic-rank' })
  assert(!JSON.stringify(result).includes('private'))
  assert.throws(() => shopPage({ ...shops, exceptionDTO: {} }, 10, context))
  assert.throws(() => shopPage({ data: {} }, 10, context))
  const failed = structuredClone(shops); failed.data.frontend_page_shop_list_recommend.error = { code: 'exception' }
  assert.throws(() => shopPage(failed, 10, context))
})

test('image URLs reject action endpoints, private hosts, credentials and queries', () => {
  for (const url of ['http://img.alicdn.com/a.png', 'https://user@img.alicdn.com/a.png', 'https://h5.ele.me/a.png', 'https://img.alicdn.com/a.png?token=secret']) assert.equal(browseImage(url), null)
  assert.equal(browseImage('https://img.alicdn.com/a.png'), 'https://img.alicdn.com/a.png')
})

test('ordinary ad metadata and explicit false markers never classify shops as sponsored', () => {
  for (const fields of [{ adInfo: {} }, { adInfo: { isAd: 'false', productType: 'ordinary' } },
    { recommend: { isAd: false }, adShopExt: { isAd: 'false' } }, { adInfo: null, adShopExt: {} }]) {
    const raw = structuredClone(shops)
    Object.assign(raw.data.frontend_page_shop_list_recommend.fields.items[0].fields.restaurant, fields)
    const result = shopPage(raw, 10, context)
    assert.equal(result.shops.length, 1); assert.equal(result.shops[0].isAd, false); assert.equal(result.filteredAds, 0)
  }
})

test('explicit sponsored markers are filtered without changing pagination, including all-ad pages', () => {
  for (const key of ['recommend', 'adInfo', 'adShopExt']) for (const flag of [true, 'true']) {
    const raw = structuredClone(shops), component = raw.data.frontend_page_shop_list_recommend
    component.fields.items[0].fields.restaurant[key] = { isAd: flag }
    const result = shopPage(raw, 10, context)
    assert.deepEqual(result.shops, []); assert.equal(result.filteredAds, 1)
    const shown = shopPage(raw, 10, context, false)
    assert.equal(shown.shops.length, 1); assert.equal(shown.shops[0].isAd, true); assert.equal(shown.filteredAds, 0)
    assert.deepEqual(result.nextCursor, { ...context, offset: 10, rankId: 'synthetic-rank' })
    component.fields.items.push(structuredClone(shops.data.frontend_page_shop_list_recommend.fields.items[0]))
    component.fields.items[1].fields.restaurant.id = 'ordinary-shop'
    assert.deepEqual(shopPage(raw, 10, context).shops.map(shop => shop.id), ['ordinary-shop'])
    assert.deepEqual(shopPage(raw, 10, context, false).shops.map(shop => shop.isAd), [true, false])
    assert.throws(() => shopPage(raw, 1, context))
    component.fields.items[0].fields.restaurant[key].isAd = 'unsupported'
    assert.throws(() => shopPage(raw, 10, context))
  }
})
