import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemOptionsData, selectedItemEntity } from '../lib/item-options.js'

const item = { itemId: '17', tbItemId: '23', attributes: [], specFoods: [{ foodId: '31', skuId: '41', tbSkuId: '51' }] }
const detail = () => ({ itemId: '17', storeId: 'store-17', tbItemId: '23', itemType: 0, name: '示例奶茶', error: false, minPurchase: 1, specFoods: [{ foodId: '31', skuId: '41', itemId: '17', tbItemId: '23', tbSkuId: '51',
    stock: 10, price: '15.50', specs: [{ name: '份量', value: '大杯' }] }], brand: { attributes: [{ name: '温度', minPurchased: 1, maxPurchased: 1,
    details: [{ name: '少冰', saleStatus: 1, selected: true }, { name: '热', saleStatus: 0 }] }] } })

test('verified official variants project prices and required choices without exposing raw request fields', () => {
  const options = itemOptionsData(detail(), item, 'store-17')
  assert.equal(options.display.variants[0].name, '份量: 大杯')
  assert.equal(options.display.variants[0].priceCents, 1550)
  assert(!JSON.stringify(options.display).includes('tbSkuId'))
  const args = { variantRef: options.variants[0].ref, choiceRefs: [options.display.variants[0].groups[0].choices[0].ref], quantity: 2 }
  assert.deepEqual(selectedItemEntity(options, args), { id: '31', sku_id: '41', food_type: 0, tbItemId: '23', tbSkuId: '51',
    attrs: [{ name: '温度', value: '少冰' }], new_specs: [{ name: '份量', value: '大杯' }], ingredients: [], group_index: 0, step: 2 })
  for (const changed of [ { ...args, variantRef: 'foreign' }, { ...args, choiceRefs: [] }, { ...args, choiceRefs: [options.display.variants[0].groups[0].choices[1].ref] },
    { ...args, choiceRefs: [...args.choiceRefs, ...args.choiceRefs] }, { ...args, quantity: 11 } ]) assert.throws(() => selectedItemEntity(options, changed))
})

test('foreign SKUs, changed item identity, duplicate options and unreadable prices cannot authorize a cart change', () => {
  for (const mutate of [raw=>{raw.storeId='foreign'},raw=>{raw.itemId='other'},raw=>{raw.specFoods[0].tbSkuId='foreign'},
    raw=>{raw.specFoods[0].price='unreadable'},raw=>{raw.brand.attributes[0].details.push(raw.brand.attributes[0].details[0])},raw=>{raw.error=true}]) {
    const raw=detail(); mutate(raw); assert.throws(()=>itemOptionsData(raw,item,'store-17'))
  }
})

test('variant-specific required ingredients include verified native IDs and refuse missing or conflicting choices', () => {
  const raw = detail(), choice = (name, skuId, packageId, extra = {}) => ({ name, foodId: skuId, skuId, itemId: skuId,
    tbItemId: skuId, tbSkuId: skuId, tbPackageId: packageId, packageId, price: 0, stock: 10, selected: true, ...extra })
  raw.brandList = [{ skuId: '41', ingredientInfo: { ingredients: [
    { name: '糖', isRequired: true, multiSelected: false, minPurchased: 1, maxPurchased: 1,
      skus: [choice('冰糖', '61', '71', { price: 1, exclusionList: [{ skuId: '62', packageId: '72' }] })] },
    { name: '温度', isRequired: true, multiSelected: false, minPurchased: 1, maxPurchased: 1, skus: [choice('热', '62', '72')] }] } }]
  const options = itemOptionsData(raw, item, 'store-17'), variant = options.variants[0]
  const refs = variant.groups.map(group => group.choices[0].ref), args = { variantRef: variant.ref, choiceRefs: refs, quantity: 1 }
  assert.throws(() => selectedItemEntity(options, args), error => error.code === 'spec-conflict')
  assert.throws(() => selectedItemEntity(options, { ...args, choiceRefs: refs.slice(0, 1) }), error => error.code === 'spec-required')
  raw.brandList[0].ingredientInfo.ingredients[0].skus[0].exclusionList = []
  const accepted = itemOptionsData(raw, item, 'store-17'), entity = selectedItemEntity(accepted, args)
  assert.equal(entity.ingredients.length, 2); assert.equal(entity.ingredients[0].tbPackageId, '71')
  assert.equal(accepted.display.variants[0].groups[1].choices[0].priceCents, 100)
  assert(!JSON.stringify(accepted.display).includes('tbPackageId'))
})
