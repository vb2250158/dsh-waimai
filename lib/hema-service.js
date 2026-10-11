/** Hema delivery locations and store groups from the authenticated address API. */
import { PlatformService, PlatformError } from './platform-service.js'
import { hemaAddresses, hemaProducts } from './hema-data.js'
import { MerchantId } from './browse-data.js'
import { z } from 'zod'

/** Reuse local account-bound delivery selection while retaining Hema's request protocol. */
export class HemaService extends PlatformService {
  /** @param options - independent Hema account and local settings. */
  constructor(options) { super({ ...options, selectionPlatform: 'hema' }) }

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

  /** @param platformId - Hema. @param shopId - current address's delivery group. @param addressRef - delivery revision. @param keyword - product name. @returns one search batch; cart and purchase actions remain unavailable. */
  probeMenu(platformId, shopId, addressRef, keyword = '') {
    this.requirePlatform(platformId)
    const groupId = MerchantId.parse(shopId), query = z.string().max(100).parse(keyword).trim()
    return this.login.run(async () => {
      await this.login.requireAccount(); const selected = await this.selectedAddress(addressRef)
      const group = selected.groups.find(value => value.groupId === groupId)
      if (!group) throw new PlatformError('shop-unavailable', '该盒马门店不属于当前配送地址，请刷新门店')
      const result = { platformId, accountId: this.login.accountId, addressRef: selected.ref, shopId: groupId, orderingAvailable: false }
      if (!query) return { ...result, queryRequired: true, categories: [] }
      const expected = this.login.accountId, raw = await this.login.mtop(this.login.protocol.products, {
        clientType: 'hema', storeIds: group.ext.shopIds, poi: selected.geoCode, keyword: query,
        pageParam: JSON.stringify({ index: 0, pageSize: 30 }), needCatTree: false, searchType: 'mainSearch',
      })
      this.login.checkReply(raw)
      let page
      try { page = hemaProducts(raw.data, new Set(group.ext.shopIds.split(','))) }
      catch { throw new PlatformError('menu-invalid', '盒马商品或所属门店无法确认，请重新搜索') }
      await this.login.verifyIdentity(expected)
      return { ...result, query, totalCount: page.totalCount, hasMore: page.hasMore,
        categories: [{ id: 'search-results', name: query, items: page.items }] }
    })
  }
}
