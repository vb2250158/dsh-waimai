/** Search the current delivery area using the official H5 search result endpoint. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { browseImage, MerchantId } from './browse-data.js'
import { PlatformError } from './platform-service.js'

const cursorSchema = z.object({ platformId: z.literal('taobao'), ref: z.uuid() }).strict()
const requestSchema = z.object({ keyword: z.string().trim().min(1).max(100),
  addressRef: z.string().regex(/^[a-f0-9]{64}$/).optional(), cursor: cursorSchema.optional(),
  platformId: z.literal('taobao').optional(), accountRef: z.uuid().optional() }).strict()
const safeText = z.string().min(1).max(2000)
const marker = z.union([z.boolean(), z.enum(['true', 'false'])]).nullish()
const price = z.union([z.number().finite().min(0).max(9999999), z.string().regex(/^\d{1,7}(?:\.\d{1,2})?$/)]).nullish()
const food = z.object({ itemIdStr: MerchantId, restaurantId: MerchantId.optional(), name: safeText,
  imagePath: z.string().max(2000).nullish(), price, stock: z.number().finite().nullish(), multiSpec: z.boolean().nullish() })
const restaurant = z.object({ id: MerchantId, name: safeText, isAd: marker, isRetailShop: z.boolean().nullish(),
  recommend: z.object({ isAd: marker }).nullish(), adInfo: z.object({ isAd: marker }).nullish(),
  adShopExt: z.object({ isAd: marker }).nullish() })
const itemTypes = new Set(['mat_shopmode-shop-item-v2', 'mat_catemode-bigfood-item'])
const isAd = value => value === true || value === 'true'

/** Project search results without provider links, query tokens, tracking or personal data.
 * @param raw - successful MTOP response data.
 * @param hideSponsored - omit explicitly sponsored shops.
 * @returns display items and provider pagination; unknown cards are counted.
 */
export function taobaoSearchPage(raw, hideSponsored = true) {
  const page = z.object({ listItems: z.array(z.object({ tItemType: z.string().max(200), info: z.unknown().optional() })).max(200),
    pageInfo: z.object({ page: z.number().int().min(1), pageSize: z.number().int().min(1).max(100),
      finished: z.boolean(), rankId: z.string().min(1).max(500).optional() }) }).parse(raw?.result?.[0])
  const items = [], seen = new Set()
  let unknownCards = 0
  for (const card of page.listItems) {
    if (!itemTypes.has(card.tItemType)) { unknownCards++; continue }
    const info = z.object({ restaurant, foods: z.array(food).max(200) }).parse(card.info)
    const shop = info.restaurant
    const sponsored = [shop.isAd, shop.recommend?.isAd, shop.adInfo?.isAd, shop.adShopExt?.isAd].some(isAd)
    if (hideSponsored && sponsored) continue
    for (const product of info.foods) {
      if (product.restaurantId !== undefined && product.restaurantId !== shop.id) throw new Error('search product merchant mismatch')
      const key = `${shop.id}:${product.itemIdStr}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ shopId: shop.id, shopName: shop.name, shopIsAd: sponsored, shopIsRetail: shop.isRetailShop ?? null, id: product.itemIdStr,
        name: product.name, imageUrl: browseImage(product.imagePath), price: product.price == null ? null : String(product.price),
        availability: product.stock === 0 ? 'sold-out' : 'unknown', requiresSelection: product.multiSpec === true })
    }
  }
  if (!page.pageInfo.finished && !page.pageInfo.rankId) throw new Error('missing search continuation')
  return { items, unknownCards, pageInfo: page.pageInfo }
}

/** Account-owned bounded search continuations. */
export class TaobaoSearch {
  /** @param service - platform identity and selected-address owner. */
  constructor(service, now = Date.now) { this.service = service; this.pages = new Map(); this.now = now }

  /** @param input - keyword, selected address and optional opaque continuation.
   * @returns one verified page of platform search results.
   */
  search(input) {
    const args = requestSchema.parse(input), service = this.service, login = service.login
    return login.run(async () => {
      await login.requireAccount()
      for (const [ref, entry] of this.pages) if (entry.expiresAt <= this.now()) this.pages.delete(ref)
      const accountId = String(login.accountId), position = args.cursor ? this.pages.get(args.cursor.ref) : null
      if (args.cursor && !position) throw new PlatformError('search-changed', '搜索分页已失效，请重新搜索')
      if (position && (position.accountId !== accountId || position.keyword !== args.keyword ||
        (args.addressRef && position.addressRef !== args.addressRef))) throw new PlatformError('search-changed', '账号、地址或搜索词已变化，请重新搜索')
      const address = await service.selectedAddress(args.addressRef ?? position?.addressRef)
      const query = { _input_charset: 'UTF-8', _output_charset: 'UTF-8', gatewayApiType: 'mtop', mtop_api_version: '1.0',
        appId: '26551', 'x-ele-scene': 'search', sversion: '15.0', channelCode: '20202', platform: '6', alipayChannel: 1,
        latitude: address.coordinates.latitude, longitude: address.coordinates.longitude, keyword: args.keyword,
        limit: service.pageSize, n: service.pageSize, page: position?.page ?? 1, searchMode: 1,
        fixSearch: position ? '0' : '1', ...(position ? { offset: position.offset, rankId: position.rankId } : {}) }
      const raw = await login.mtop(login.protocol.catalogSearch, { type: 'originaljson', appId: '26551', params: JSON.stringify(query) })
      service.checkReply(raw, 'search-unavailable', '闪购商品搜索暂时不可用，请稍后重试')
      let page
      try { page = taobaoSearchPage(raw.data, service.hideSponsoredShops) }
      catch { throw new PlatformError('search-invalid', '闪购搜索结果无法确认，请重新搜索') }
      if (page.pageInfo.page !== (position?.page ?? 1)) throw new PlatformError('search-invalid', '闪购搜索分页不匹配，请重新搜索')
      await login.requireAccount()
      if (String(login.accountId) !== accountId) throw new PlatformError('account-changed', '账号已变化，请重新搜索')
      await service.selectedAddress(address.ref)
      let nextCursor = null
      if (!page.pageInfo.finished) {
        const ref = randomUUID()
        this.pages.set(ref, { accountId, addressRef: address.ref, keyword: args.keyword,
          page: page.pageInfo.page + 1, offset: page.pageInfo.page * page.pageInfo.pageSize, rankId: page.pageInfo.rankId,
          expiresAt: this.now() + service.cursorSeconds * 1000 })
        while (this.pages.size > service.cursorLimit) this.pages.delete(this.pages.keys().next().value)
        nextCursor = { platformId: 'taobao', ref }
      }
      return { platformId: 'taobao', accountId, addressRef: address.ref, scope: 'platform-search', items: page.items,
        unknownCards: page.unknownCards, hasMore: Boolean(nextCursor), nextCursor }
    })
  }
}
