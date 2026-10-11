/** Platform registry, HTTP account reads and account-bound local delivery selections. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeJsonState } from './automation.js'
import { addressRecords } from './address-data.js'
import { LoginError } from './login.js'

const capabilities = z.record(z.string(), z.boolean())
const platformSchema = z.object({ id: z.string().regex(/^[a-z]+$/), names: z.object({ zh: z.string(), en: z.string() }),
  adapter: z.enum(['taobao']).nullable(), capabilities, reason: z.string() }).strict()
const definitions = z.array(platformSchema).parse(JSON.parse(await readFile(new URL('./platforms.json', import.meta.url), 'utf8')))
const registry = new Map(definitions.map(platform => [platform.id, platform]))
if (registry.size !== definitions.length) throw new Error('Duplicate takeaway platform')
const selectionSchema = z.object({ version: z.literal(1), platformId: z.literal('taobao'), accountId: z.string().regex(/^[1-9]\d*$/),
  addressRef: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const merchantId = z.union([z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/), z.number().int().positive().safe()]).transform(String)

/** Structured failures contain local messages, never request URLs or tokens. */
export class PlatformError extends LoginError {
  constructor(code, message) { super(message); this.code = code }
}

/** Own the current platform account and its private local address binding. */
export class PlatformService {
  /** @param options - login owner and local state directory. */
  constructor({ login, directory }) { this.login = login; this.selectionPath = join(directory, 'delivery-selection.json') }

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
    try { return selectionSchema.parse(JSON.parse(await readFile(this.selectionPath, 'utf8'))) }
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
      const saved = await this.readSelection(), records = await this.fetchAddresses()
      if (!saved || saved.accountId !== this.login.accountId || !records.some(record => record.ref === saved.addressRef && record.display.usable)) {
        throw new PlatformError('address-required', '请先在插件页为当前账号选择配送地址')
      }
      return { platformId, addressSelected: true, transport: 'http', orderingAvailable: false, reason: 'ordering-unverified' }
    })
  }

  /** Search only the account's recent merchants; does not claim full platform search.
   * @param platformId - selected platform.
   * @param keyword - exact or partial recent merchant name.
   * @returns bounded recent merchants with stable IDs and explicit search scope.
   */
  recentShops(platformId, keyword = '') {
    this.requirePlatform(platformId)
    return this.login.run(async () => {
      await this.login.requireAccount()
      const spec = this.login.protocol.orders
      const raw = await this.login.mtop(spec, { tabCode: 'ALL', pageSize: this.login.historyPageSize, pageNum: 0, fromTime: 0, lastBillMonth: '00',
        latitude: '', longitude: '', cityId: '', extInfo: JSON.stringify({ ...spec.client, lastBillMonth: '00' }), sourceFrom: 'H5' })
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
      return { platformId, accountId: this.login.accountId, scope: 'recent-orders-only', shops: [...shops.values()] }
    })
  }

  /** Probe the captured menu endpoint using a freshly verified selected address.
   * @param platformId - selected platform.
   * @param shopId - stable platform merchant ID.
   * @returns protocol availability; unparsed menus never become orderable items.
   */
  probeMenu(platformId, shopId) {
    this.requirePlatform(platformId)
    const parsedId = merchantId.parse(shopId)
    return this.login.run(async () => {
      await this.login.requireAccount()
      const saved = await this.readSelection(), records = await this.fetchAddresses()
      const selected = saved?.accountId === this.login.accountId ? records.find(record => record.ref === saved.addressRef && record.display.usable) : null
      if (!selected) throw new PlatformError('address-required', '请先在插件页为当前账号选择配送地址')
      const raw = await this.login.mtop(this.login.protocol.menu, { channel: 'H5', eleStoreId: parsedId, ...selected.coordinates,
        comeFrom: 'h5', privateDomainActivityId: '', pdUserTag: '', shareTransmit: '', storeTransmit: '', businessType: '',
        addressId: selected.nativeId, addressType: '', v: '12.0.2', extraInfo: encodeURIComponent('{}'), bookTime: '' })
      if (raw.ret.some(value => /^(FAIL_SYS_USER_VALIDATE|RGV587_ERROR)::/.test(value))) {
        throw new PlatformError('verification-required', '平台要求人工验证，菜单、结算和提交已停止')
      }
      if (!raw.ret.some(value => value.startsWith('SUCCESS::'))) throw new PlatformError('menu-unavailable', '平台暂未返回可用菜单，请稍后重试')
      throw new PlatformError('menu-unverified', '已收到菜单响应，但商品规格和结算协议尚未完成验证，未开放下单')
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
}
