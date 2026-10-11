import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browseImage, menuData, shopPage } from '../lib/browse-data.js'
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
  assert.equal(soup.availability, 'sold-out'); assert.equal(result.orderingAvailable, false)
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
    assert.deepEqual(result.nextCursor, { ...context, offset: 10, rankId: 'synthetic-rank' })
    component.fields.items.push(structuredClone(shops.data.frontend_page_shop_list_recommend.fields.items[0]))
    component.fields.items[1].fields.restaurant.id = 'ordinary-shop'
    assert.deepEqual(shopPage(raw, 10, context).shops.map(shop => shop.id), ['ordinary-shop'])
    assert.throws(() => shopPage(raw, 1, context))
    component.fields.items[0].fields.restaurant[key].isAd = 'unsupported'
    assert.throws(() => shopPage(raw, 10, context))
  }
})
