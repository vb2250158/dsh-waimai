/** Account-owned HTTP cart, checkout and single-attempt order submission. */
import { randomUUID, createHash } from 'node:crypto'
import { readFile, mkdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeJsonState, toDateKey } from './automation.js'
import { menuData, menuMerchantIdentity } from './browse-data.js'
import { TradeError, cartData, checkoutData, submittedOrder, paymentDestination, cents } from './trade-data.js'
import { itemOptionsData, selectedItemEntity } from './item-options.js'

const attempt = z.object({ ref: z.uuid(), accountId: z.string(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amountCents: z.number().int().positive().safe(),
  merchant: z.string().max(500), status: z.enum(['unknown', 'created']), orderIds: z.array(z.string().regex(/^\d+$/)).optional(),
  paymentUrl: z.string().url().nullable().optional() }).strict()
const journalSchema = z.object({ version: z.literal(1), attempts: z.array(attempt) }).strict()
const entityId = z.union([z.string().min(1).max(200), z.number().int().safe()])
const commodity = z.object({ id: entityId, skuId: entityId, foodType: z.number().int(), tbItemId: entityId, tbSkuId: entityId, itemId: entityId })

/** Own a single account's ephemeral quote and shared durable order-attempt ledger. */
export class TaobaoTrade {
  /** @param service - account/address owner. @param options - purchasing limits and private journal path. */
  constructor(service, { journalDirectory, quoteSeconds = 120, dryRun = true, cap = 35, budget = 0, now = Date.now } = {}) {
    this.service = service; this.login = service.login; this.quoteSeconds = quoteSeconds; this.dryRun = dryRun
    this.capCents = cents(cap); this.budgetCents = cents(budget); this.now = now
    this.journalPath = join(journalDirectory || '.', 'trade-attempts.json'); this.quote = null; this.mutations = new Set()
  }

  /** @param ref - current address reference. @param shopId - encrypted merchant. @returns fresh private cart request context. */
  async context(ref, shopId) {
    await this.login.requireAccount()
    const address = await this.service.selectedAddress(ref), accountId = this.login.accountId
    const head = await this.login.mtop(this.login.protocol.menuHead, { channel: 'H5', eleStoreId: shopId, ...address.coordinates,
      comeFrom: 'h5', addressId: address.nativeId, v: '12.0.2' })
    this.service.checkReply(head, 'cart-unavailable', '店铺资料暂时无法读取，请刷新菜单')
    const nativeShopId = menuMerchantIdentity(head.data, shopId), info = head.data.resultMap.storeHead.storeInfo
    if (!info.sellerId || !info.tbStoreId) throw new TradeError('cart-invalid', '店铺购物车信息不完整，请刷新菜单')
    return { accountId, address, shopId, nativeShopId, params: { come_from: 'mini_app', scene: 0, add_on_type: 0, tying_supervip: 0,
      geohash: address.geohash, restaurant_id: shopId, user_id: accountId, extra_action: [], operating_entities: [],
      operating_tying_entities: [], operating_packages: [], sub_channel: 'miniapp.taobao', sub_sub_channel: 'miniapp.taobao.et',
      extra_info: {}, encryptTbSellerId: info.sellerId, encryptTbStoreId: info.tbStoreId,
      bizExt: { quickBuyFloatFlag: 'true', extraInfo: { listStatus: 1 } }, passThroughMap: null } }
  }

  /** @param context - captured account/address context. Reject stale identity before dependent requests. */
  async verify(context) {
    await this.login.requireAccount()
    if (this.login.accountId !== context.accountId) throw new TradeError('account-changed', '账号已变化，请重新读取购物车')
    await this.service.selectedAddress(context.address.ref)
  }

  /** @param context - private cart owner. @param entities - server-derived SKU changes. @returns verified cart reply; mutations are never retried. */
  async requestCart(context, entities = []) {
    const raw = await this.login.mtop(this.login.protocol.cart, { bizInfos: JSON.stringify({ cartOperateParam: JSON.stringify({
      ...context.params, operating_entities: entities, operateId: randomUUID() }) }) }, entities.length === 0)
    this.service.checkReply(raw, 'cart-unavailable', '购物车操作未确认，请刷新购物车后核对数量，勿重复点击')
    try { return { raw: raw.data, ...cartData(raw.data, context.shopId) } }
    catch { throw new TradeError('cart-invalid', '购物车内容无法确认，请刷新后核对商品数量') }
  }

  /** @param context - private owner. @param cart - verified cart. @returns account-scoped display and revision. */
  displayCart(context, cart) {
    return { platformId: 'taobao', accountId: context.accountId, addressRef: context.address.ref, shopId: context.shopId,
      revision: cart.revision, ...cart.display }
  }

  /** @param shopId - merchant. @param addressRef - selected address revision. @returns private display cart without changes. */
  cart(shopId, addressRef) {
    return this.login.run(async () => {
      const context = await this.context(addressRef, shopId), cart = await this.requestCart(context)
      await this.verify(context)
      return this.displayCart(context, cart)
    })
  }

  /** @param context - verified shop/address owner. @param itemId - menu item. @returns fresh menu item eligible for cart changes. */
  async menuItem(context, itemId) {
    const raw = await this.login.mtop(this.login.protocol.menu, { channel: 'H5', eleStoreId: context.shopId, ...context.address.coordinates,
      comeFrom: 'h5', addressId: context.address.nativeId, v: '12.0.2', extraInfo: encodeURIComponent('{}') })
    this.service.checkReply(raw, 'menu-unavailable', '菜单暂时无法读取，请刷新后重试')
    const menu = menuData(raw.data, context.shopId, context.nativeShopId)
    if (!menu.categories.some(group => group.items.some(item => item.id === itemId && item.availability === 'available'))) throw new TradeError('item-unavailable', '该商品当前不可购买，请刷新菜单')
    const groups = raw.data.resultMap.menu.itemGroups.filter(group => group.groupType !== 11).flatMap(group => [group, ...(group.subItemCategoryList || [])])
    const item = groups.flatMap(group => group.items || []).find(item => String(item.itemId) === itemId && String(item.storeId) === context.shopId)
    if (!item) throw new TradeError('item-invalid', '商品身份无法确认，请刷新菜单')
    return item
  }

  /** @param context - verified shop/address owner. @param item - current menu item. @returns verified official SKU choices. */
  async readOptions(context, item) {
    const foods = z.array(z.object({ skuId: entityId, tbSkuId: entityId })).min(1).max(200).parse(item.specFoods)
    const raw = await this.login.mtop(this.login.protocol.itemOptions, { eleStoreId: context.shopId, eleItemId: String(item.itemId), icItemId: String(item.tbItemId),
      skuIds: foods.map(value => String(value.skuId)).join(','), icSkuIds: foods.map(value => String(value.tbSkuId)).join(','),
      actionContent: item.purchaseButton.actionContent, ...context.address.coordinates, extInfo: item.purchaseButton.extInfo })
    this.service.checkReply(raw, 'spec-unavailable', '规格读取失败，请重试')
    try { return itemOptionsData(raw.data, item, context.shopId) }
    catch (error) { if (error instanceof TradeError) throw error; throw new TradeError('spec-invalid', '商品规格暂无法确认，请刷新菜单后重试') }
  }

  /** @param args - signed-in shop/address and menu item. @returns a temporary selection and display choices; performs no cart mutation. */
  itemOptions(args) {
    return this.login.run(async () => {
      const context = await this.context(args.addressRef, args.shopId), item = await this.menuItem(context, args.itemId)
      const options = await this.readOptions(context, item)
      await this.verify(context)
      this.selection = { ref: randomUUID(), accountId: context.accountId, addressRef: context.address.ref, shopId: context.shopId,
        itemId: args.itemId, fingerprint: options.fingerprint }
      return { platformId: 'taobao', accountId: context.accountId, addressRef: context.address.ref, shopId: context.shopId,
        selectionRef: this.selection.ref, ...options.display }
    })
  }

  /** Change a verified simple SKU or fully selected variant; other cart lines and selection states are retained.
   * @param args - UI item/cart reference, signed-in view revision, step and unique action reference.
   * @returns freshly verified cart; unknown outcomes require a read before another change.
   */
  cartChange(args) {
    return this.login.run(async () => {
      if (this.mutations.has(args.operationRef)) throw new TradeError('cart-duplicate', '此操作已发送，请刷新购物车核对数量')
      const context = await this.context(args.addressRef, args.shopId), cart = await this.requestCart(context)
      if (cart.revision !== args.revision) throw new TradeError('cart-changed', '购物车已变化，请刷新后再修改')
      let entity
      if (args.step === 1) {
        const item = await this.menuItem(context, args.itemId)
        if (args.selectionRef) {
          const selection = this.selection
          if (!selection || selection.ref !== args.selectionRef || selection.accountId !== context.accountId || selection.addressRef !== context.address.ref
            || selection.shopId !== context.shopId || selection.itemId !== args.itemId) throw new TradeError('spec-stale', '规格选择已失效，请重新打开')
          const options = await this.readOptions(context, item)
          if (selection.fingerprint !== options.fingerprint) throw new TradeError('spec-changed', '规格、价格或库存已变化，请重新选择')
          entity = selectedItemEntity(options, args)
        } else {
          if (!item || item.purchaseButton?.needMultiSpecs !== 0 || item.purchaseButton.minPurchase !== 1
            || !(item.purchaseButton.stock > 0) || item.attributes?.length) throw new TradeError('spec-required', '请先选择商品规格和配料')
          const value = commodity.parse(item.purchaseButton.commodityDict)
          if (String(value.itemId) !== args.itemId || String(value.tbItemId) !== String(item.tbItemId)) throw new TradeError('item-invalid', '商品规格无法确认，请刷新菜单')
          entity = { id: value.id, sku_id: value.skuId, food_type: value.foodType, tbItemId: value.tbItemId, tbSkuId: value.tbSkuId,
            attrs: [], new_specs: [], ingredients: [], group_index: 0, step: 1 }
        }
      } else {
        const index = cart.display.items.findIndex(item => item.ref === args.lineRef), value = cart.lines[index]
        if (!value || value.garnish?.length || ![0, 1].includes(value.food_type)) throw new TradeError('spec-required', '此商品包含组合配料，暂无法减购')
        entity = { id: value.id, sku_id: value.sku_id, food_type: value.food_type, tbItemId: value.tb_item_id, tbSkuId: value.tb_sku_id,
          attrs: value.attrs, new_specs: value.new_specs, ingredients: value.ingredients.map(ingredient => ({ id: ingredient.id, sku_id: ingredient.sku_id, quantity: ingredient.quantity,
            tbSkuId: ingredient.tb_sku_id, tbItemId: ingredient.tb_item_id, tbPackageId: ingredient.tb_package_id })), group_index: 0, step: -1 }
      }
      await this.verify(context); this.quote = null; this.mutations.add(args.operationRef)
      if (this.mutations.size > 1000) throw new TradeError('cart-action-limit', '购物车操作过多，请重新加载插件后核对购物车')
      this.login.diagnostic?.({ group: 'waimai-cart', attemptId: args.operationRef, stage: 'mutation-sent', quantityDelta: entity.step })
      await this.requestCart(context, [entity])
      const refreshed = await this.requestCart(context); await this.verify(context)
      const ingredientKey = values => JSON.stringify(values.map(value => [String(value.id), String(value.sku_id), String(value.tbPackageId ?? value.tb_package_id), value.quantity]).sort((a, b) => a[1].localeCompare(b[1])))
      const same = line => String(line.id) === String(entity.id) && String(line.sku_id) === String(entity.sku_id)
        && JSON.stringify(line.attrs) === JSON.stringify(entity.attrs) && JSON.stringify(line.new_specs) === JSON.stringify(entity.new_specs) && ingredientKey(line.ingredients) === ingredientKey(entity.ingredients)
      const quantity = lines => lines.filter(same).reduce((total, line) => total + line.quantity, 0)
      if (quantity(refreshed.lines) !== quantity(cart.lines) + entity.step) {
        this.login.diagnostic?.({ group: 'waimai-cart', attemptId: args.operationRef, stage: 'quantity-unconfirmed' })
        throw new TradeError('cart-result-unconfirmed', '商品数量未确认，请刷新购物车核对，勿重复加购')
      }
      this.login.diagnostic?.({ group: 'waimai-cart', attemptId: args.operationRef, stage: 'quantity-confirmed', quantityDelta: entity.step })
      return this.displayCart(context, refreshed)
    })
  }

  /** @returns verified Taobao identity and the Eleme trade identity from this same business jar. */
  async buyer() {
    const raw = await this.login.mtop(this.login.protocol.taobaoIdentity, {})
    this.service.checkReply(raw, 'taobao-login-required', '下单需要淘宝账号授权，请添加淘宝扫码账号')
    const parsed = z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive().safe()]).safeParse(raw.data?.userNumId)
    if (!parsed.success) throw new TradeError('taobao-login-required', '淘宝账号身份无法确认，请重新扫码登录')
    const cookies = (await this.login.http.storageState()).cookies
    const tradeIds = new Set(cookies.filter(cookie => cookie.name === 'unb' && ['.ele.me', 'alsc-buy2.ele.me'].includes(cookie.domain))
      .map(cookie => cookie.value))
    if (tradeIds.size !== 1 || !/^[1-9]\d*$/.test([...tradeIds][0])) throw new TradeError('taobao-login-required', '闪购买家会话无法确认，请重新检查登录状态')
    return { taobaoId: String(parsed.data), buyerId: [...tradeIds][0] }
  }

  /** @param args - merchant, address and cart revision. @returns expiring server quote; never submits or pays. */
  checkout(args) {
    return this.login.run(async () => {
      this.quote = null
      const context = await this.context(args.addressRef, args.shopId), cart = await this.requestCart(context)
      if (cart.revision !== args.revision) throw new TradeError('cart-changed', '购物车已变化，请刷新后重新结算')
      if (!cart.display.quantity || cart.display.invalidCount || cart.lines.some(line => !line.is_valid || !line.is_selected)) throw new TradeError('cart-unavailable', '请先在购物车中确认可售商品和勾选状态')
      const identity = await this.buyer(), tb = JSON.parse(cart.raw.tb_order), extra = JSON.parse(tb.exParams)
      extra.subChannel = 'miniapp.taobao'; extra.subSubChannel = 'miniapp.taobao.et'
      const address = context.address, geo = address.geohash, coords = address.coordinates
      const ext = { come_from: 'mini_app', extraInfo: JSON.stringify(extra), geohash: geo, bizInfo: { orderPhoneType: -1, persistMode: -1,
        addressId: address.nativeId, address_select_by: 'user', addressType: '', uicAddressIdForPadding: '', defaultDinnerwareSelect: '',
        terminalParams: '', number_of_meals: '', cancel_disposable_tableware: 0, defaultRemarkType: '', description: '', buyerAlipayUid: '' },
        gps_latitude: coords.latitude, gps_longitude: coords.longitude, useNewAddress: true,
        checkoutAddressInfo: { selectedEleAddressId: address.nativeId, selectedUicAddressId: '', addressType: '', addressSelectBy: 'user', geohash: geo,
          locationBizInfo: { homeAddressId: '', homeEleAddressId: address.nativeId, homeAddressType: '', homeLocationSource: '', homePoiId: '',
            homeLongitude: coords.longitude, homeLatitude: coords.latitude, homeCityId: '', homeAddressDetail: '',
            gpsLatitude: coords.latitude, gpsLongitude: coords.longitude, realtimeLocations: [] } } }
      const raw = await this.login.mtop(this.login.protocol.checkout, { ...tb, exParams: JSON.stringify(ext) })
      this.service.checkReply(raw, 'checkout-unavailable', '结算暂未成功，请检查起送金额、餐具和配送时间后重新结算')
      let result
      try { result = checkoutData(raw.data, { buyerId: identity.buyerId, addressId: address.nativeId, shopId: context.shopId, cart }) }
      catch { throw new TradeError('checkout-invalid', '结算的账号、地址、商品或金额无法核对，未创建订单') }
      await this.verify(context)
      if (JSON.stringify(await this.buyer()) !== JSON.stringify(identity)) throw new TradeError('account-changed', '淘宝账号已变化，请重新结算')
      const expiresAt = this.now() + this.quoteSeconds * 1000, quoteRef = randomUUID()
      this.quote = { context, identity, cartRevision: cart.revision, quoteRef, expiresAt, ...result }
      return { ...this.displayCart(context, cart), ...result.display, address: address.display, quoteRef, expiresAt,
        previewOnly: this.dryRun, maxOrderCents: this.capCents, dailyBudgetCents: this.budgetCents }
    })
  }

  /** @returns durable shared reservations; corrupted state stops financial work. */
  async journal() {
    try { return journalSchema.parse(JSON.parse(await readFile(this.journalPath, 'utf8'))) }
    catch (error) {
      if (error.code === 'ENOENT') return { version: 1, attempts: [] }
      throw new TradeError('trade-journal-invalid', '下单记录无法读取，请核对本机备份；未提交订单')
    }
  }

  /** @returns current account's last twenty attempts and validated payment handoffs, including unknown outcomes. */
  tradeHistory() {
    return this.login.run(async () => {
      await this.login.requireAccount()
      const accountId = this.login.accountId, journal = await this.journal()
      return { platformId: 'taobao', accountId, attempts: journal.attempts.filter(value => value.accountId === accountId).slice(-20).reverse()
        .map(value => ({ orderRef: value.ref, merchant: value.merchant, amountCents: value.amountCents, day: value.day, status: value.status,
          orderIds: value.orderIds || [], paymentUrl: value.status === 'created' ? paymentDestination(value.paymentUrl) : null, paymentStatus: 'unconfirmed' })) }
    })
  }

  /** Create at most one order per quote, reserving the amount durably before the HTTP request.
   * @param args - opaque quote and confirmed displayed cents. @returns confirmed IDs and official payment handoff, never a charge.
   */
  submit(args) {
    return this.login.run(async () => {
      const quote = this.quote
      if (!quote || quote.quoteRef !== args.quoteRef || this.now() >= quote.expiresAt) throw new TradeError('quote-expired', '报价已过期，请重新结算')
      if (this.dryRun && args.manualConfirmation !== true) throw new TradeError('preview-only', '自动任务预览不会创建订单；请在界面核对报价并明确确认本笔订单')
      if (args.confirmedCents !== quote.display.totalCents || args.confirmed !== true) throw new TradeError('amount-unconfirmed', '请重新确认实付金额')
      if (quote.display.totalCents > Math.min(this.capCents, args.maxAmountCents ?? this.capCents)) throw new TradeError('over-cap', '实付金额超过单笔上限，未创建订单')
      await this.verify(quote.context)
      if (JSON.stringify(await this.buyer()) !== JSON.stringify(quote.identity)) throw new TradeError('account-changed', '淘宝账号已变化，未创建订单')
      const cart = await this.requestCart(quote.context)
      if (cart.revision !== quote.cartRevision) { this.quote = null; throw new TradeError('cart-changed', '购物车已变化，请重新结算') }
      const lockPath = this.journalPath + '.lock'
      await mkdir(join(this.journalPath, '..'), { recursive: true, mode: 0o700 })
      try { await mkdir(lockPath, { mode: 0o700 }) }
      catch { throw new TradeError('trade-locked', '已有下单操作或未释放的下单锁，请先核对历史订单和本机记录') }
      try {
        const journal = await this.journal(), day = toDateKey(new Date(this.now()))
        const fingerprint = createHash('sha256').update(`${quote.context.accountId}:${quote.context.shopId}:${quote.cartRevision}`).digest('hex')
        const previous = journal.attempts.find(value => value.fingerprint === fingerprint)
        if (previous) throw new TradeError(previous.status === 'unknown' ? 'order-unknown' : 'order-duplicate', '相同购物车已有下单记录，请先检查官方历史订单，勿重复提交')
        if (this.now() >= quote.expiresAt) throw new TradeError('quote-expired', '报价已过期，请重新结算')
        const reserved = journal.attempts.filter(value => value.day === day).reduce((sum, value) => sum + value.amountCents, 0)
        if (this.budgetCents > 0 && reserved + quote.display.totalCents > this.budgetCents) throw new TradeError('over-budget', '已达到每日下单上限，未创建订单')
        const record = { ref: quote.quoteRef, accountId: quote.context.accountId, fingerprint, day, amountCents: quote.display.totalCents,
          merchant: quote.display.merchant, status: 'unknown' }
        journal.attempts.push(record); await writeJsonState(this.journalPath, journal); this.quote = null
        this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'submit-sent', amountCents: record.amountCents })
        let raw, order
        try {
          raw = await this.login.mtop(this.login.protocol.submit, quote.request, false)
          this.service.checkReply(raw, 'order-unknown', '下单结果未确认，请检查官方历史订单，勿重复提交')
          order = submittedOrder(raw.data)
        } catch { this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'result-unconfirmed' }); throw new TradeError('order-unknown', '下单结果未确认，请检查官方历史订单，勿重复提交；本机已保留此次金额和记录') }
        Object.assign(record, order, { status: 'created' }); await writeJsonState(this.journalPath, journal)
        this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'order-created', amountCents: record.amountCents })
        return { platformId: 'taobao', accountId: record.accountId, addressRef: quote.context.address.ref, shopId: quote.context.shopId,
          orderRef: record.ref, amountCents: record.amountCents, ...order, paymentStatus: 'unconfirmed' }
      } finally { await rmdir(lockPath) }
    })
  }
}
