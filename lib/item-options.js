/** Project official item variants and validate selections before a cart mutation. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { cents, TradeError } from './trade-data.js'

const id = z.union([z.string().min(1).max(200), z.number().int().safe()]).transform(String)
const text = z.string().min(1).max(500)
const spec = z.object({ name: text, value: text })
const food = z.object({ foodId: id, skuId: id, itemId: id, tbItemId: id, tbSkuId: id,
  stock: z.number().int().min(0), soldOut: z.boolean().optional(), price: z.union([z.string(), z.number()]),
  specs: z.array(spec).max(30) })
const group = z.object({ name: text, minPurchased: z.number().int().min(0).max(100), maxPurchased: z.number().int().min(1).max(100),
  details: z.array(z.object({ name: text, saleStatus: z.union([z.literal(0), z.literal(1)]), selected: z.boolean().optional() })).min(1).max(100) })
const ingredient = z.object({ foodId: id, skuId: id, itemId: id, tbItemId: id, tbSkuId: id, tbPackageId: id, packageId: id,
  name: text, price: z.union([z.string(), z.number()]), hiddenPrice: z.literal(false).optional(), stock: z.number().int().min(0), soldOut: z.boolean().optional(), invalid: z.boolean().optional(),
  selected: z.boolean().optional(), defaultPurchased: z.number().int().min(0).max(1).optional(), minPurchased: z.number().int().min(0).max(1).optional(),
  specs: z.array(spec).max(30).default([]), exclusionList: z.array(z.object({ packageId: id, skuId: id })).max(100).default([]) })
const ingredientInfo = z.object({ ingredients: z.array(z.object({ name: text, isRequired: z.boolean(), multiSelected: z.boolean(),
  minPurchased: z.number().int().min(0).max(100), maxPurchased: z.number().int().min(0).max(100),
  skuGroups: z.array(z.unknown()).max(0).default([]), skus: z.array(ingredient).min(1).max(100) })).max(100) })
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** @param raw - official item detail. @param item - freshly verified menu item. @param shopId - requested shop.
 * @returns display variants and private cart entities; rejects mismatched item and SKU identities.
 */
export function itemOptionsData(raw, item, shopId) {
  const detail = z.object({ itemId: id, storeId: id, tbItemId: id, itemType: z.union([z.literal(0), z.literal(1)]), name: text, error: z.literal(false),
    minPurchase: z.number().int().min(1).max(100), specFoods: z.array(food).min(1).max(200),
    brand: z.object({ attributes: z.array(group).max(100).default([]), ingredientInfo: ingredientInfo.optional(), ingredientRule: z.record(z.string(), z.unknown()).optional() }),
    brandList: z.array(z.object({ skuId: id, attributes: z.array(group).max(100).optional(), ingredientInfo: ingredientInfo.optional(),
      ingredientRule: z.record(z.string(), z.unknown()).optional() })).max(200).optional() }).parse(raw)
  if (detail.itemId !== String(item.itemId) || detail.tbItemId !== String(item.tbItemId) || detail.storeId !== shopId) throw new TradeError('item-invalid', '商品身份已变化，请刷新菜单')
  const variants = detail.specFoods.map(value => {
    if (value.itemId !== detail.itemId || value.tbItemId !== detail.tbItemId || !(item.specFoods || []).some(current =>
      String(current.skuId) === value.skuId && String(current.tbSkuId) === value.tbSkuId && String(current.foodId) === value.foodId)) throw new TradeError('item-invalid', '商品规格身份无法确认，请刷新菜单')
    return { ref: hash([value.foodId, value.skuId, value.tbSkuId]), name: value.specs.map(spec => `${spec.name}: ${spec.value}`).join(' · ') || detail.name,
      priceCents: cents(value.price), stock: value.stock, available: !value.soldOut && value.stock >= detail.minPurchase,
      entity: { id: value.foodId, sku_id: value.skuId, food_type: detail.itemType, tbItemId: value.tbItemId, tbSkuId: value.tbSkuId,
        attrs: [], new_specs: value.specs, ingredients: [], group_index: 0 } }
  })
  if (new Set(variants.map(value => value.ref)).size !== variants.length) throw new TradeError('item-invalid', '商品规格重复，暂无法加购')
  for (const variant of variants) {
    const linked = detail.brandList?.find(value => value.skuId === variant.entity.sku_id)
    if (detail.brandList?.length && !linked) throw new TradeError('spec-invalid', '商品配料未完整返回，请重试')
    const source = linked || detail.brand
    if (Object.keys(source.ingredientRule || {}).length) throw new TradeError('spec-unsupported', '此商品包含组合配料规则，暂无法确认')
    const attributes = (source.attributes || detail.brand.attributes).map(parsed => {
      if (parsed.minPurchased > parsed.maxPurchased || new Set(parsed.details.map(choice => choice.name)).size !== parsed.details.length) throw new TradeError('item-invalid', '商品选项无法确认，请刷新菜单')
      return { ref: hash(['attribute', parsed.name]), name: parsed.name, minimum: parsed.minPurchased, maximum: parsed.maxPurchased,
        choices: parsed.details.map(choice => ({ ref: hash(['attribute', parsed.name, choice.name]), name: choice.name, priceCents: 0,
          available: choice.saleStatus === 1, selected: choice.selected === true, excludes: [], attribute: { name: parsed.name, value: choice.name } })) }
    })
    const ingredients = (source.ingredientInfo?.ingredients || []).map(group => {
      const minimum = group.isRequired ? Math.max(1, group.minPurchased) : 0, maximum = Math.min(group.maxPurchased, group.multiSelected ? group.maxPurchased : 1)
      if (group.minPurchased > group.maxPurchased || maximum === 0 && group.skus.some(choice => choice.selected || choice.defaultPurchased > 0 || choice.minPurchased > 0)) throw new TradeError('spec-invalid', '配料额度与默认选择矛盾，暂无法确认')
      if (minimum > maximum) throw new TradeError('spec-unsupported', '此商品需要组合配料数量，暂无法确认')
      return { ref: hash(['ingredient', group.name]), name: group.name, minimum, maximum,
        choices: group.skus.map(choice => ({ ref: hash([choice.packageId, choice.skuId]), name: choice.name, priceCents: cents(choice.price),
          available: maximum > 0 && !choice.soldOut && !choice.invalid && choice.stock > 0, selected: choice.selected === true,
          excludes: choice.exclusionList.map(other => hash([other.packageId, other.skuId])),
          ingredient: { id: choice.foodId, sku_id: choice.skuId, item_id: choice.itemId, quantity: 1, name: choice.name,
            price: choice.price, new_specs: choice.specs, tbSkuId: choice.tbSkuId, tbItemId: choice.tbItemId, tbPackageId: choice.tbPackageId } })) }
    })
    variant.groups = [...attributes, ...ingredients]
    if (new Set(variant.groups.map(value => value.ref)).size !== variant.groups.length
      || new Set(variant.groups.flatMap(value => value.choices.map(choice => choice.ref))).size !== variant.groups.reduce((sum, value) => sum + value.choices.length, 0)) throw new TradeError('item-invalid', '商品选项重复，暂无法加购')
  }
  const displayGroups = groups => groups.map(group => ({ ...group, choices: group.choices.map(({ attribute, ingredient, ...choice }) => choice) }))
  const display = { itemId: detail.itemId, name: detail.name, minimumQuantity: detail.minPurchase,
    variants: variants.map(({ entity, groups, ...value }) => ({ ...value, groups: displayGroups(groups) })), groups: [] }
  return { display, variants, fingerprint: hash(display) }
}

/** @param options - freshly re-read variants and groups. @param args - private UI selection references.
 * @returns a server-derived cart entity, rejecting unavailable, duplicate or incomplete selections.
 */
export function selectedItemEntity(options, args) {
  const variant = options.variants.find(value => value.ref === args.variantRef), refs = args.choiceRefs || [], quantity = args.quantity ?? 1
  if (!variant?.available || !Number.isInteger(quantity) || quantity < options.display.minimumQuantity || quantity > variant.stock || quantity > 100) throw new TradeError('spec-unavailable', '所选规格或数量暂不可售，请重新选择')
  const all = variant.groups.flatMap(group => group.choices)
  if (new Set(refs).size !== refs.length || refs.some(ref => !all.some(choice => choice.ref === ref && choice.available))) throw new TradeError('spec-invalid', '商品选项已变化，请重新选择')
  const attrs = [], ingredients = []
  for (const group of variant.groups) {
    const choices = group.choices.filter(choice => refs.includes(choice.ref))
    if (choices.length < group.minimum || choices.length > group.maximum) throw new TradeError('spec-required', '请完成所有必选规格')
    for (const choice of choices) {
      if (choice.excludes.some(ref => refs.includes(ref))) throw new TradeError('spec-conflict', '所选配料不能同时使用，请调整选择')
      if (choice.attribute) attrs.push(choice.attribute)
      if (choice.ingredient) ingredients.push(choice.ingredient)
    }
  }
  return { ...variant.entity, attrs, ingredients, step: quantity }
}
