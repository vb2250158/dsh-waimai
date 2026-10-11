/** Allowlisted shop and menu reads. Tracking, cart actions and contact data are excluded. */
import { z } from 'zod'
import { avatarUrl } from './account-data.js'

/** Platform merchant or item reference; numeric values must retain exact precision. */
export const MerchantId = z.union([z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/), z.number().int().positive().safe()]).transform(String)
/** A page position is bound to the verified account and current delivery selection. */
export const ShopCursor = z.object({ offset: z.number().int().min(1).max(10000), rankId: z.string().min(1).max(200),
  addressRef: z.string().regex(/^[a-f0-9]{64}$/), accountId: z.string().regex(/^[1-9]\d*$/) }).strict()
const text = z.string().max(2000)
const short = z.string().max(200)
const money = z.union([z.string().regex(/^\d{1,7}(?:\.\d{1,2})?$/), z.number().finite().min(0).max(9999999)])
  .transform(value => String(value))
const optionalText = text.nullish()
const collection = schema => z.array(schema).max(2000).nullish()

/** Accept only passive HTTPS images on the platform's image CDNs.
 * @param value - image URL or platform image hash.
 * @returns safe image URL or null.
 */
export function browseImage(value) {
  const hash = avatarUrl(value)
  if (hash) return hash
  if (typeof value !== 'string' || value.length > 2000) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null
    if (!['cube.elemecdn.com', 'es.elemecdn.com', 'img.alicdn.com', 'gw.alicdn.com'].includes(url.hostname)) return null
    return url.href
  } catch { return null }
}

const metric = z.object({ text: short.nullish() }).nullish()
const adMarker = z.union([z.boolean(), z.enum(['true', 'false'])]).nullish()
  .transform(value => value === true || value === 'true')
const adMetadata = z.object({ isAd: adMarker }).nullish()
const restaurant = z.object({ id: MerchantId, name: short.min(1), imagePath: optionalText, status: z.number().int().nullish(),
  shopRatingRegion: metric, recentOrderNumDisplay: optionalText,
  fieldMap: z.object({ shopDeliveryDistance: metric, shopDeliveryTime: metric,
    shopDeliveryFee: z.object({ tips: short.nullish(), floatMinimumOrderAmount: money.nullish() }).nullish() }).nullish(),
  floatMinimumOrderAmount: money.nullish(), supportTags: collection(z.object({ text: short.nullish() })),
  recommend: adMetadata, adInfo: adMetadata, adShopExt: adMetadata,
})

/** Project a nearby recommendation page without links or personalized tracking.
 * @param raw - successful homepage response data.
 * @param pageSize - configured maximum merchant count.
 * @param context - verified account, address and request offset.
 * @param hideSponsoredShops - omit merchants explicitly marked as sponsored.
 * @returns shops with accurate ad markers, the filtered count and a next position based on the unfiltered page.
 */
export function shopPage(raw, pageSize, context, hideSponsoredShops = true) {
  if (raw?.exceptionDTO) throw new Error('shop response contains an exception')
  const component = z.object({ error: z.object({}).strict().nullish(), fields: z.object({ items: z.array(z.object({
    bizCode: short, fields: z.object({ restaurant: restaurant.optional() }),
  })).max(pageSize + 20) }), customized: z.object({ hasNext: z.boolean(), rankId: short.min(1).optional() }) })
    .parse(raw?.data?.frontend_page_shop_list_recommend)
  const seen = new Set(), shops = []
  let filteredAds = 0
  for (const row of component.fields.items) {
    const shop = row.fields.restaurant
    if (!shop || seen.has(shop.id)) continue
    seen.add(shop.id)
    const isAd = Boolean(shop.recommend?.isAd || shop.adInfo?.isAd || shop.adShopExt?.isAd)
    if (hideSponsoredShops && isAd) { filteredAds++; continue }
    shops.push({ id: shop.id, name: shop.name, imageUrl: browseImage(shop.imagePath),
      rating: shop.shopRatingRegion?.text || null, sales: shop.recentOrderNumDisplay || null,
      distance: shop.fieldMap?.shopDeliveryDistance?.text || null, deliveryTime: shop.fieldMap?.shopDeliveryTime?.text || null,
      deliveryFee: shop.fieldMap?.shopDeliveryFee?.tips || null,
      minimumOrder: shop.fieldMap?.shopDeliveryFee?.floatMinimumOrderAmount ?? shop.floatMinimumOrderAmount ?? null,
      tags: [...new Set((shop.supportTags || []).map(tag => tag.text).filter(Boolean))].slice(0, 5),
      isAd, status: shop.status ?? null })
  }
  if (seen.size > pageSize) throw new Error('oversized shop page')
  const nextCursor = component.customized.hasNext ? ShopCursor.parse({ ...context,
    offset: context.offset + pageSize, rankId: component.customized.rankId }) : null
  return { shops, filteredAds, nextCursor }
}

const attribute = z.object({ name: short, details: z.array(z.object({ name: short, saleStatus: z.number().int().nullish() })).max(100),
  minPurchased: z.number().int().min(0).nullish(), maxPurchased: z.number().int().min(0).nullish() })
const item = z.object({ itemId: MerchantId, storeId: MerchantId, name: text.min(1), description: optionalText,
  imageHash: optionalText, price: money.nullish(), originPrice: money.nullish(), inSaleTime: z.boolean().nullish(),
  attributes: z.array(attribute).max(100).nullish(), tipTextList: z.array(short).max(100).nullish(),
  purchaseButton: z.object({ soldOut: z.boolean().nullish(), stock: z.number().finite().nullish() }).nullish(),
})
const group = z.object({ groupId: z.union([z.string().max(160), z.number().int().safe()]).transform(String), name: short,
  groupType: z.number().int(), items: collection(z.unknown()), foldItems: collection(z.unknown()), soldOutItems: collection(z.unknown()),
  subItemCategoryList: collection(z.object({ groupId: z.union([z.string(), z.number().int().safe()]).transform(String), name: short,
    items: collection(z.unknown()), foldItems: collection(z.unknown()), soldOutItems: collection(z.unknown()) })),
})

/** Read menu categories, advertised prices, availability and options without creating a cart.
 * @param raw - successful menu response data.
 * @param shopId - independently requested merchant reference.
 * @returns displayable categories; advertised prices are not checkout quotes.
 */
export function menuData(raw, shopId) {
  const groups = z.array(group).max(200).parse(raw?.resultMap?.menu?.itemGroups)
  const categories = [], categoryIds = new Set()
  const verifiedItems = new Map()
  for (const current of groups) for (const value of [...(current.items || []), ...(current.soldOutItems || [])]) {
    if (value?.itemId !== undefined && String(value.storeId) === shopId) verifiedItems.set(String(value.itemId), value)
  }
  const nativeAliases = new Set(groups.flatMap(current => current.foldItems || [])
    .filter(value => /^\d+$/.test(value?.storeId) && verifiedItems.has(String(value.itemId))).map(value => value.storeId))
  if (nativeAliases.size > 1) throw new Error('conflicting native merchant aliases')
  let total = 0
  const project = current => {
    const items = new Map()
    for (const [rows, soldOut] of [[current.items, false], [current.foldItems, false], [current.soldOutItems, true]]) {
      for (const value of rows || []) {
        if (value?.itemType === -1 && value.floorType === 0 && value.itemId === undefined) continue // Category headings have no purchasable item identity.
        let parsed = item.parse(value)
        if (parsed.storeId !== shopId) {
          // Folded and sold-out records use the native merchant alias identified by matching items in an encrypted-ID category.
          if (!nativeAliases.has(parsed.storeId) || (rows !== current.foldItems && rows !== current.soldOutItems)) throw new Error('foreign merchant item')
          if (verifiedItems.has(parsed.itemId)) parsed = item.parse(verifiedItems.get(parsed.itemId))
        }
        if (items.has(parsed.itemId)) continue
        items.set(parsed.itemId, { id: parsed.itemId, name: parsed.name, description: parsed.description || '',
          imageUrl: browseImage(parsed.imageHash), price: parsed.price ?? null, originalPrice: parsed.originPrice ?? null,
          availability: soldOut || parsed.purchaseButton?.soldOut || parsed.purchaseButton?.stock === 0 ? 'sold-out'
            : parsed.inSaleTime === false ? 'outside-sale-time' : parsed.inSaleTime === true ? 'available' : 'unknown',
          tips: parsed.tipTextList || [], options: (parsed.attributes || []).map(option => ({ name: option.name,
            minimum: option.minPurchased ?? null, maximum: option.maxPurchased ?? null,
            values: option.details.map(detail => ({ name: detail.name, available: detail.saleStatus === 1 ? true : detail.saleStatus === 0 ? false : null })) })) })
      }
    }
    if (!items.size) return
    total += items.size
    if (total > 5000 || categoryIds.has(current.groupId)) throw new Error('invalid menu size or category')
    categoryIds.add(current.groupId)
    categories.push({ id: current.groupId, name: current.name, items: [...items.values()] })
  }
  for (const current of groups) {
    if (current.groupType === 11) continue // Recent purchases contain order actions rather than menu items.
    project(current)
    for (const sub of current.subItemCategoryList || []) project(sub)
  }
  return { shopId, categories, priceUnit: 'CNY', orderingAvailable: false }
}
