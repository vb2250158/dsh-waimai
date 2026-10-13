/** Platform registry, HTTP account reads and account-bound local delivery selections. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeJsonState } from './automation.js'
import { addressRecords } from './address-data.js'
import { LoginError } from './login.js'
import { TaobaoTrade } from './taobao-trade.js'
import { MerchantId, ShopCursor, menuData, menuMerchantIdentity, MenuMerchantIdentityRequired, shopPage } from './browse-data.js'

const capabilities = z.record(z.string(), z.boolean())
const platformSchema = z.object({ id: z.string().regex(/^[a-z]+$/), names: z.object({ zh: z.string(), en: z.string() }),
  adapter: z.enum(['taobao', 'hema']).nullable(), capabilities, reason: z.string() }).strict()
const definitions = z.array(platformSchema).parse(JSON.parse(await readFile(new URL('./platforms.json', import.meta.url), 'utf8')))
const registry = new Map(definitions.map(platform => [platform.id, platform]))
if (registry.size !== definitions.length) throw new Error('Duplicate takeaway platform')
const merchantId = MerchantId

/** Structured failures contain local messages, never request URLs or tokens. */
export class PlatformError extends LoginError {
  constructor(code, message) { super(message); this.code = code }
}

/** Own the current platform account and its private local address binding. */
export class PlatformService {
  /** @param options - login owner and local state directory. */
  constructor({ login, directory, pageSize = 10, hideSponsoredShops = true, selectionPlatform = 'taobao', tradeOptions }) {
    this.login = login; this.selectionPath = join(directory, 'delivery-selection.json')
    this.pageSize = z.number().int().min(1).max(20).parse(pageSize)
    this.hideSponsoredShops = z.boolean().parse(hideSponsoredShops)
    if (login) this.trade = new TaobaoTrade(this, { journalDirectory: directory, ...tradeOptions })
    this.selectionSchema = z.object({ version: z.literal(1), platformId: z.literal(selectionPlatform), accountId: z.string().regex(/^[1-9]\d*$/),
      addressRef: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
  }

  /** @returns copied platform definitions; no credentials or account identifiers. */
  list() { return structuredClone(definitions) }

  /** Reject unknown and unavailable platforms before touching the account jar.
   * @param platformId - platform reference from the registry.
   * @returns available platform definition.
   */
  requirePlatform(platformId) {
    const platform = registry.get(platformId)
    if (!platform) throw new PlatformError('unknown-platform', '未找到该外卖平台')
    if (!platform.adapter) throw new PlatformError('not-integrated', '该平台尚未接入，未执行登录或点餐请求')
    return platform
  }

  /** @param platformId - selected platform. @returns verified login summary. */
  status(platformId) { this.requirePlatform(platformId); return this.login.status() }
  /** @param platformId - selected platform. @returns private account display fields. */
  profile(platformId) { this.requirePlatform(platformId); return this.login.profile() }
  /** @param platformId - selected platform. @param cursor - validated order cursor. @returns private order page. */
  orders(platformId, cursor) { this.requirePlatform(platformId); return this.login.orders(cursor) }

  /** @returns validated local selection, or null when no selection was saved. */
  async readSelection() {
    try { return this.selectionSchema.parse(JSON.parse(await readFile(this.selectionPath, 'utf8'))) }
    catch (error) {
      if (error.code === 'ENOENT') return null
      throw new PlatformError('selection-invalid', '本机配送地址绑定无法读取，请核对备份；未清除原记录')
    }
  }

  /** @returns private adapter records for the independently checked account. */
  async fetchAddresses() {
    const raw = await (await this.login.get(`https://h5.ele.me/restapi/member/v1/users/${this.login.accountId}/addresses`)).json()
    try { return addressRecords(raw, this.login.accountId) }
    catch { throw new PlatformError('addresses-invalid', '平台地址或账号信息无法确认，请刷新账号') }
  }

  /** @param expectedRef - optional view revision. @returns freshly validated private delivery record. */
  async selectedAddress(expectedRef) {
    const saved = await this.readSelection(), records = await this.fetchAddresses()
    const selected = saved?.accountId === this.login.accountId ? records.find(record => record.ref === saved.addressRef && record.display.usable) : null
    if (!selected) throw new PlatformError('address-required', '请先为当前账号选择配送地址')
    if (expectedRef !== undefined && expectedRef !== selected.ref) throw new PlatformError('address-changed', '配送地址已变化，请刷新地址和店铺')
    return selected
  }

  /** @param raw - Mtop envelope. @param code - local failure code. @param message - safe report. */
  checkReply(raw, code, message) {
    if (raw.ret.some(value => /^(FAIL_SYS_USER_VALIDATE|RGV587_ERROR)::/.test(value))) {
      throw new PlatformError('verification-required', '平台要求人工验证，请在官方客户端完成验证后重试')
    }
    if (!raw.ret.some(value => value.startsWith('SUCCESS::'))) throw new PlatformError(code, message)
  }

  /** Read addresses only through the authenticated settings channel.
   * @param platformId - selected platform.
   * @returns account-bound private address display records and current selection.
   */
  addresses(platformId) {
    this.requirePlatform(platformId)
    return this.login.run(async () => {
      await this.login.requireAccount()
      const records = await this.fetchAddresses(), saved = await this.readSelection()
      const selectedRef = saved?.accountId === this.login.accountId && records.some(record => record.ref === saved.addressRef && record.display.usable)
        ? saved.addressRef : null
      return { platformId, accountId: this.login.accountId, addresses: records.map(record => record.display), selectedRef }
    })
  }

  /** Persist only a reference after re-reading the owning account and address.
   * @param platformId - selected platform.
   * @param accountId - UI account revision; stale selections are rejected.
   * @param addressRef - opaque address reference from the private read.
   * @returns confirmed account and selection; contains no contact data.
   */
  selectAddress(platformId, accountId, addressRef) {
    this.requirePlatform(platformId)
    return this.login.run(async () => {
      await this.login.requireAccount()
      if (this.login.accountId !== accountId) throw new PlatformError('account-changed', '账号已变化，请重新读取配送地址')
      const record = (await this.fetchAddresses()).find(value => value.ref === addressRef)
      if (!record?.display.usable) throw new PlatformError('address-unavailable', '该地址已变化或无法用于配送，请重新选择')
      await writeJsonState(this.selectionPath, { version: 1, platformId, accountId, addressRef })
      return { platformId, accountId, selectedRef: addressRef }
    })
  }

  /** Independently bind the selected address before any HTTP ordering request.
   * @param platformId - selected platform.
   * @returns model-safe context summary without personal address fields.
   */
  prepare(platformId) {
    this.requirePlatform(platformId)
    return this.login.run(async () => {
      await this.login.requireAccount()
      await this.selectedAddress()
      return { platformId, addressSelected: true, transport: 'http', orderingAvailable: this.requirePlatform(platformId).capabilities.manualOrder === true,
        automaticOrderingAvailable: false, userConfirmationRequired: true,
        manualOrderingAvailable: this.requirePlatform(platformId).capabilities.manualOrder === true, reason: this.requirePlatform(platformId).reason }
    })
  }

  /** Search only the account's recent merchants; does not claim full platform search.
   * @param platformId - selected platform.
   * @param keyword - exact or partial recent merchant name.
   * @param addressRef - optional delivery view revision.
   * @returns bounded recent merchants, requiring a current address; historical merchants may not deliver there.
   */
  recentShops(platformId, keyword = '', addressRef) {
    this.requirePlatform(platformId)
    return this.login.run(async () => {
      await this.login.requireAccount()
      const selected = await this.selectedAddress(addressRef)
      const spec = this.login.protocol.orders
      const raw = await this.login.mtop(spec, { tabCode: 'ALL', pageSize: this.login.historyPageSize, pageNum: 0, fromTime: 0, lastBillMonth: '00',
        latitude: '', longitude: '', cityId: '', extInfo: JSON.stringify({ ...spec.client, lastBillMonth: '00' }), sourceFrom: this.login.loginMethod === 'taobao-qr' ? 'TAOBAO' : 'H5' })
      if (!raw.ret.some(value => value.startsWith('SUCCESS::')) || raw.data?.result?.accountBindWrong === true) throw new PlatformError('orders-unavailable', '历史店铺暂时无法读取')
      const rows = raw.data?.result?.orderList
      if (!Array.isArray(rows) || rows.length > this.login.historyPageSize) throw new PlatformError('orders-invalid', '历史店铺响应无法确认')
      const shops = new Map()
      for (const row of rows) {
        const parsed = merchantId.safeParse(row.eleMeStoreId)
        if (parsed.success && typeof row.storeName === 'string' && row.storeName.length <= 200 && row.storeName.includes(keyword)) {
          shops.set(parsed.data, { id: parsed.data, name: row.storeName })
        }
      }
      return { platformId, accountId: this.login.accountId, addressRef: selected.ref, scope: 'recent-orders-only', shops: [...shops.values()], nextCursor: null }
    })
  }

  /** Read nearby recommended merchants through the current homepage HTTP endpoint.
   * @param platformId - selected platform.
   * @param cursor - account-bound next page position.
   * @param addressRef - optional delivery view revision.
   * @returns nearby shop page without coordinates or contact fields.
   */
  nearbyShops(platformId, cursor, addressRef) {
    this.requirePlatform(platformId)
    const position = cursor === undefined ? null : ShopCursor.parse(cursor)
    return this.login.run(async () => {
      await this.login.requireAccount()
      const selected = await this.selectedAddress(addressRef ?? position?.addressRef)
      if (position && (position.accountId !== this.login.accountId || position.addressRef !== selected.ref)) {
        throw new PlatformError('address-changed', '账号或配送地址已变化，请重新查询店铺')
      }
      const spec = position ? this.login.protocol.nearbyNext : this.login.protocol.nearby
      const params = { offset: position?.offset || 0, limit: this.pageSize, scene: 'tbmini:subsidy:homepage', needBanner: true,
        ...(position ? { rankId: position.rankId } : {}) }
      const raw = await this.login.mtop(spec, { sceneCode: 'tb_miniapp_hourly_delivery_list', ...selected.coordinates,
        needReverseGeoAddress: 1, pageParams: JSON.stringify(params), bizInfos: JSON.stringify(params),
        ...(position ? { eventAction: 'nextPage', componentCode: 'frontend_page_shop_list_recommend' } : {}) })
      this.checkReply(raw, 'shops-unavailable', '附近店铺暂时无法读取，请稍后重试')
      try {
        return { platformId, accountId: this.login.accountId, addressRef: selected.ref, scope: 'nearby-recommendations',
          ...shopPage(raw.data, this.pageSize, { accountId: this.login.accountId, addressRef: selected.ref, offset: params.offset }, this.hideSponsoredShops) }
      } catch { throw new PlatformError('shops-invalid', '附近店铺响应无法确认，请刷新后重试') }
    })
  }

  /** Read menu display fields using a freshly verified selected address.
   * @param platformId - selected platform.
   * @param shopId - stable platform merchant ID.
   * @param addressRef - optional delivery view revision.
   * @returns categories, advertised prices and read-only options; ordering remains unavailable.
   */
  probeMenu(platformId, shopId, addressRef) {
    this.requirePlatform(platformId)
    const parsedId = merchantId.parse(shopId)
    return this.login.run(async () => {
      await this.login.requireAccount()
      const selected = await this.selectedAddress(addressRef)
      const raw = await this.login.mtop(this.login.protocol.menu, { channel: 'H5', eleStoreId: parsedId, ...selected.coordinates,
        comeFrom: 'h5', privateDomainActivityId: '', pdUserTag: '', shareTransmit: '', storeTransmit: '', businessType: '',
        addressId: selected.nativeId, addressType: '', v: '12.0.2', extraInfo: encodeURIComponent('{}'), bookTime: '' })
      this.checkReply(raw, 'menu-unavailable', '平台暂未返回可用菜单，请稍后重试')
      let menu
      try { menu = menuData(raw.data, parsedId) }
      catch (error) {
        if (!(error instanceof MenuMerchantIdentityRequired)) throw new PlatformError('menu-invalid', '菜单内容无法确认，请刷新后重试')
        const head = await this.login.mtop(this.login.protocol.menuHead, { channel: 'H5', eleStoreId: parsedId, ...selected.coordinates,
          comeFrom: 'h5', addressId: selected.nativeId, v: '12.0.2' })
        this.checkReply(head, 'menu-identity-unavailable', '店铺资料暂时无法核对，请稍后刷新菜单')
        try { menu = menuData(raw.data, parsedId, menuMerchantIdentity(head.data, parsedId)) }
        catch { throw new PlatformError('menu-invalid', '菜单与店铺资料不一致，请刷新后重试') }
      }
      await this.login.requireAccount()
      await this.selectedAddress(selected.ref)
      return { platformId, accountId: this.login.accountId, addressRef: selected.ref, ...menu }
    })
  }

  /** Reject unverified purchasing capabilities before any request or budget change.
   * @param platformId - selected platform.
   * @param capability - required purchasing capability.
   */
  requireOrdering(platformId, capability) {
    const platform = this.requirePlatform(platformId)
    if (!platform.capabilities[capability]) throw new PlatformError('ordering-unverified', '该平台的结算、创建订单或支付接口尚未完成验证，未发起购买请求')
  }

  /** @param platformId - selected platform. @param addressRef - address revision. @param shopId - merchant. @returns HTTP cart display. */
  cart(platformId, addressRef, shopId) { this.requirePlatform(platformId); return this.trade.cart(shopId, addressRef) }
  /** @param platformId - selected platform. @param args - private validated action. @returns refreshed cart. */
  cartChange(platformId, args) { this.requirePlatform(platformId); return this.trade.cartChange(args) }
  /** @param platformId - selected platform. @param args - verified menu item. @returns official item options for the private cart view. */
  itemOptions(platformId, args) { this.requirePlatform(platformId); return this.trade.itemOptions(args) }
  /** @param platformId - selected platform. @param args - cart and address revisions. @returns expiring quote. */
  checkout(platformId, args) { this.requirePlatform(platformId); return this.trade.checkout(args) }
  /** @param platformId - selected platform. @param args - quote and confirmed amount. @returns created order, never payment. */
  submit(platformId, args) { this.requirePlatform(platformId); return this.trade.submit(args) }
  /** @param platformId - selected platform. @returns this account's durable order attempts and handoffs. */
  tradeHistory(platformId) { this.requirePlatform(platformId); return this.trade.tradeHistory() }
}
