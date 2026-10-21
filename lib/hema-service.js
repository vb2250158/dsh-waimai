/** Hema delivery locations and store groups from the authenticated address API. */
import { PlatformService, PlatformError } from './platform-service.js'
import { hemaAddresses, hemaProducts, hemaProductDetail, hemaCart, HemaProductCursor } from './hema-data.js'
import { randomUUID } from 'node:crypto'
import { MerchantId } from './browse-data.js'
import { z } from 'zod'
import { HemaCartActions, hemaCartRevision } from './hema-cart.js'
import { HemaTrade } from './hema-trade.js'

/** Reuse local account-bound delivery selection while retaining Hema's request protocol. */
export class HemaService extends PlatformService {
  /** @param options - independent Hema account and local settings. */
  constructor(options) {
    super({ ...options, selectionPlatform: 'hema' })
    this.productPageSize = z.number().int().min(1).max(50).parse(options.productPageSize ?? 30)
    this.productReads = new Map(); this.productPages = new Map()
    this.cartActions = new HemaCartActions(this, options.directory)
    this.trade = new HemaTrade(this, { journalDirectory: options.directory, ...options.tradeOptions })
  }

  /** @param platformId - Hema. @param args - current quote and its delivery reference. @returns a freshly verified delivery quote without creating an order. */
  selectDelivery(platformId, args) { this.requirePlatform(platformId); return this.trade.selectDelivery(args) }

  /** @param entries - private read references. @param value - account/address-owned metadata. @param limit - hard retention bound. @returns opaque reference. */
  retain(entries, value, limit) {
    const ref = randomUUID(); entries.set(ref, value)
    while (entries.size > limit) entries.delete(entries.keys().next().value)
    return ref
  }

  /** @returns freshly validated private Hema addresses; identity is checked again before any display data leaves the owner. */
  async fetchAddresses() {
    const expected = this.login.accountId
    const raw = await this.login.mtop(this.login.protocol.addresses, { requestType: 1, geoCode: '', source: 'HEMA_APP', terminal: 'HEMA_APP', channelCode: 'HM' })
    this.login.checkReply(raw)
    let records
    try { records = hemaAddresses(raw.data, expected) }
    catch { throw new PlatformError('addresses-invalid', '盒马配送地址无法确认，请刷新后重试') }
    await this.login.verifyIdentity(expected); return records
  }

  /** @param platformId - Hema. @param cursor - absent for the single group list. @param addressRef - current delivery revision. @returns stores assigned to this address, not restaurant recommendations. */
  nearbyShops(platformId, cursor, addressRef) {
    this.requirePlatform(platformId)
    if (cursor !== undefined) throw new PlatformError('bad-request', '盒马配送门店没有店铺分页，请刷新门店')
    return this.login.run(async () => {
      await this.login.requireAccount(); const selected = await this.selectedAddress(addressRef)
      return { platformId, accountId: this.login.accountId, addressRef: selected.ref, scope: 'delivery-stores', nextCursor: null,
        shops: selected.groups.map(group => ({ id: group.groupId, name: group.groupName, tags: group.serviceName ? [group.serviceName] : [] })) }
    })
  }

  /** @param platformId - Hema. @param keyword - recent store name. @param addressRef - delivery revision. @returns recent order stores; historic orders do not imply current delivery availability. */
  recentShops(platformId, keyword = '', addressRef) {
    this.requirePlatform(platformId)
    return this.login.run(async () => {
      await this.login.requireAccount(); const selected = await this.selectedAddress(addressRef)
      const page = await this.login.readOrders(), shops = new Map()
      for (const order of page.orders) if (order.merchantName.includes(keyword)) {
        const matching = selected.groups.find(group => group.ext.shopIds.split(',').includes(order.merchantId))
        if (matching) shops.set(matching.groupId, { id: matching.groupId, name: matching.groupName })
      }
      return { platformId, accountId: this.login.accountId, addressRef: selected.ref, scope: 'recent-orders-only', shops: [...shops.values()], nextCursor: null }
    })
  }

  /** @param platformId - Hema. @param shopId - delivery group. @param addressRef - delivery revision. @param keyword - product name. @param cursor - private continuation reference. @returns one validated product page. */
  probeMenu(platformId, shopId, addressRef, keyword = '', cursor) {
    this.requirePlatform(platformId)
    const groupId = MerchantId.parse(shopId), query = z.string().max(100).parse(keyword).trim()
    return this.login.run(async () => {
      await this.login.requireAccount(); const selected = await this.selectedAddress(addressRef)
      const group = selected.groups.find(value => value.groupId === groupId)
      if (!group) throw new PlatformError('shop-unavailable', '该盒马门店不属于当前配送地址，请刷新门店')
      const result = { platformId, accountId: this.login.accountId, addressRef: selected.ref, shopId: groupId, orderingAvailable: true }
      if (!query) return { ...result, queryRequired: true, categories: [] }
      const previous = cursor ? this.productPages.get(HemaProductCursor.parse(cursor).ref) : null
      if (cursor && (!previous || previous.accountId !== this.login.accountId || previous.addressRef !== selected.ref || previous.groupId !== groupId || previous.query !== query)) {
        throw new PlatformError('search-changed', '商品分页已失效，请重新搜索')
      }
      const expected = this.login.accountId, raw = await this.login.mtop(this.login.protocol.products, {
        clientType: 'hema', storeIds: group.ext.shopIds, poi: selected.geoCode, keyword: query,
        pageParam: JSON.stringify({ index: previous?.index || 0, pageSize: this.productPageSize }), needCatTree: false, searchType: 'mainSearch',
        extParam: JSON.stringify({ useC: true, allShopIds: group.ext.shopIds, ...(previous ? previous.tokens : {}) }),
      })
      this.login.checkReply(raw)
      let page
      try { page = hemaProducts(raw.data, new Set(group.ext.shopIds.split(','))) }
      catch { throw new PlatformError('menu-invalid', '盒马商品或所属门店无法确认，请重新搜索') }
      await this.login.verifyIdentity(expected)
      const seen = new Set(previous?.seen || [])
      if (page.items.some(x => seen.has(x.id)) || (page.hasMore && !page.items.length)) throw new PlatformError('menu-invalid', '商品分页返回重复或空结果，请重新搜索')
      for (const item of page.items) seen.add(item.id)
      if (seen.size > 1000) throw new PlatformError('search-limit', '本次搜索结果过多，请输入更具体的商品名称')
      const context = { accountId: expected, addressRef: selected.ref, groupId, query,
        catalogPage: { index: previous?.index || 0, tokens: previous?.tokens || {} } }
      const items = page.items.map(item => ({ ...item, productRef: this.retain(this.productReads, { ...context, id: item.id,
        nativeShopId: page.nativeShops.get(item.id) }, 1000) }))
      const nextCursor = page.hasMore ? { platformId, ref: this.retain(this.productPages, { ...context, seen: [...seen],
        index: (previous?.index || 0) + this.productPageSize, tokens: { RN: page.continuation.RN,
          firstRn: previous?.tokens.firstRn || page.continuation.first_rn, exposeRn: page.continuation.exposeInfo.exposeRn } }, 32) } : null
      return { ...result, query, totalCount: page.totalCount, hasMore: Boolean(nextCursor), nextCursor,
        categories: [{ id: 'search-results', name: query, items }] }
    })
  }

  /** @param platformId - Hema. @param productRef - catalog-issued reference. @param addressRef - selected delivery address. @returns current specifications checked against the catalog store. */
  productDetail(platformId, productRef, addressRef) {
    this.requirePlatform(platformId)
    return this.login.run(async () => {
      await this.login.requireAccount(); const selected = await this.selectedAddress(addressRef)
      return (await this.readProduct(productRef, selected)).display
    })
  }

  /** @param productRef - catalog reference. @param selected - verified address. @returns private native detail and validated display inside account serialization. */
  async readProduct(productRef, selected) {
    const item = this.productReads.get(z.uuid().parse(productRef))
    if (!item || item.accountId !== this.login.accountId || item.addressRef !== selected.ref || !selected.groups.some(x => x.groupId === item.groupId && x.ext.shopIds.split(',').includes(item.nativeShopId))) {
      throw new PlatformError('product-changed', '商品选择已失效，请重新搜索后打开')
    }
    const group = selected.groups.find(value => value.groupId === item.groupId)
    const catalog = await this.login.mtop(this.login.protocol.products, { clientType: 'hema', storeIds: group.ext.shopIds,
      poi: selected.geoCode, keyword: item.query, pageParam: JSON.stringify({ index: item.catalogPage.index, pageSize: this.productPageSize }),
      needCatTree: false, searchType: 'mainSearch', extParam: JSON.stringify({ useC: true, allShopIds: group.ext.shopIds, ...item.catalogPage.tokens }) })
    this.login.checkReply(catalog)
    let current
    try { current = hemaProducts(catalog.data, new Set(group.ext.shopIds.split(','))) }
    catch { throw new PlatformError('product-invalid', '当前商品售卖状态无法核对，请重新搜索') }
    const catalogItem = current.items.find(value => value.id === item.id)
    if (!catalogItem || current.nativeShops.get(item.id) !== item.nativeShopId) throw new PlatformError('product-changed', '当前搜索页已变化，请重新搜索后打开商品')
    const raw = await this.login.mtop(this.login.protocol.productDetail, { itemId: item.id, shopIds: item.nativeShopId,
      poi: selected.geoCode, terminal: 'HEMA_APP', source: 'hema_ultron', ifSkuPanel: true, inShop: false })
    this.login.checkReply(raw)
    let product
    try { product = hemaProductDetail(raw.data, item) }
    catch { throw new PlatformError('product-invalid', '商品规格无法确认，请刷新商品后重试') }
    await this.login.verifyIdentity(item.accountId)
    product.available = product.available && catalogItem.availability === 'available'
    product.availability = catalogItem.availability
    return { item, raw: raw.data.templateVO.global, display: { platformId: 'hema', accountId: item.accountId, addressRef: selected.ref, shopId: item.groupId, productRef, product } }
  }

  /** @param platformId - Hema. @param addressRef - current delivery revision. @returns the account's cart with availability for this address; reading never selects, edits or checks out items. */
  cart(platformId, addressRef) {
    this.requirePlatform(platformId)
    return this.login.run(async () => {
      await this.login.requireAccount(); const selected = await this.selectedAddress(addressRef)
      return this.cartActions.read(selected)
    })
  }

  /** @param selected - freshly verified address. @returns validated display plus private raw cart; never changes selections. */
  async readCart(selected) {
    const expected = this.login.accountId
    const shops = [...new Set(selected.groups.flatMap(x => x.ext.shopIds.split(',')))].join(',')
    const raw = await this.login.mtop(this.login.protocol.cart, { cartFrom: 'wdk_hema_client', isPage: false, extStatus: 0,
      exParams: JSON.stringify({ globalSell: '1', mergeCombo: 'true', version: '1.1.1', locShopIds: shops, poi: selected.geoCode }) })
    this.login.checkReply(raw)
    let result
    try { result = hemaCart(raw.data) }
    catch { throw new PlatformError('cart-invalid', '盒马购物车无法完整确认，请刷新后重试') }
    await this.login.verifyIdentity(expected)
    await this.selectedAddress(selected.ref)
    return { raw: raw.data, display: { ...result, platformId: 'hema', accountId: expected, addressRef: selected.ref,
      revision: hemaCartRevision(expected, selected.ref, raw.data), orderingAvailable: true } }
  }

  /** @param platformId - Hema. @param args - validated SKU, quantity and action reference. @returns cart with verified or pending mutation status. */
  cartAdd(platformId, args) {
    this.requirePlatform(platformId)
    return this.login.run(() => this.cartActions.add(args))
  }
}
