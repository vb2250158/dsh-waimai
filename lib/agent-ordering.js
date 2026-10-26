/** Model-facing cart tools share the account owner; private addresses and cashier URLs stay in browser RPC. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { PlatformError } from './platform-service.js'

/** Remove private owner fields from a display-only response. */
export function agentDisplay(value) {
  const { accountId, addressRef, address, paymentUrl, ...display } = value
  return display
}

/** Register interactive ordering tools without exposing the private submit endpoint.
 * @param register - existing MCP registration helper.
 * @param accounts - sole account and cart owner.
 */
export function registerAgentOrdering(register, accounts) {
  const accountRef = z.uuid(), shopId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/)
  const context = { platformId: z.literal('taobao').default('taobao'), accountRef, shopId }
  const revision = z.string().regex(/^[a-f0-9]{64}$/), optionRef = revision
  register('get_payment_options', '读取本机已创建订单的官方收银台方式和实付，返回短期 paymentRef，不扣款。付款方式由平台当前选择；不会开通免密、信贷或充值。',
    { platformId: z.literal('taobao').default('taobao'), accountRef, orderRef: z.uuid() }, async args => ({
      ...agentDisplay(await accounts.dispatch('paymentPrepare', args)), accountRef: args.accountRef }))
  register('pay_order', '用户已明确授权付款后，通过官方收银台接口发起一次付款。使用刚获取的 paymentRef、confirmedCents 和用户 maxAmountCents。可能实际扣款；需要验证时返回 requires-verification，不能说已付款。未知结果只查 get_payment_status，不能重复付款。',
    { platformId: z.literal('taobao').default('taobao'), accountRef, orderRef: z.uuid(), paymentRef: z.uuid(),
      confirmed: z.literal(true), confirmedCents: z.number().int().positive().safe(), maxAmountCents: z.number().int().positive().safe() }, async args => ({
      view: 'payment', platformId: 'taobao', accountRef: args.accountRef,
      attempts: [{ ...agentDisplay(await accounts.dispatch('paymentSubmit', args)) }] }))
  register('get_payment_status', '核对当前账号本机订单的官方状态和付款尝试记录，不再发起付款。未确认或待验证不能解释为付款成功。',
    { platformId: z.literal('taobao').default('taobao'), accountRef, orderRef: z.uuid() }, async args => ({
      view: 'payment', platformId: 'taobao', accountRef: args.accountRef,
      attempts: [{ ...agentDisplay(await accounts.dispatch('paymentStatus', args)) }] }))
  register('search_retail_products', '查询已选商超门店的原生商品目录；使用 search_shops 的真实 shopId，返回商品引用、规格名称、库存和标价。标价不是实付价。',
    { ...context, keyword: z.string().trim().min(1).max(100) }, async args => ({ ...agentDisplay(await accounts.dispatch('retailSearch', args)), accountRef: args.accountRef }))
  register('get_retail_cart', '读取商超门店原生购物车及 revision，不加购或下单。', context,
    async args => ({ ...agentDisplay(await accounts.dispatch('retailCart', args)), accountRef: args.accountRef }))
  register('add_retail_product', '按 search_retail_products 返回的 productRef 加购单规格商超商品。先读取购物车 revision；operationRef 固定，未知结果只回读，不重试。',
    { platformId: z.literal('taobao').default('taobao'), accountRef, productRef: z.uuid(), revision, operationRef: z.uuid(), quantity: z.number().int().min(1).max(100) },
    async args => ({ ...agentDisplay(await accounts.dispatch('retailAdd', args)), accountRef: args.accountRef }))
  register('preview_retail_checkout', '获取商超原生购物车的真实优惠后含运费报价，返回 quoteRef 与整数分 totalCents，不下单。deliveryPreference=earliest 明确选择最早可配送时段并重新计价；platform 保留平台已选时段，未选择则停止。只结算用户指定的商品，超预算停止。',
    { ...context, deliveryPreference: z.enum(['platform', 'earliest']).default('platform'), maxAmount: z.number().positive().multipleOf(0.01).max(Number.MAX_SAFE_INTEGER / 100) }, async args => {
      const cart = await accounts.dispatch('retailCart', args)
      const quote = await accounts.dispatch('retailCheckout', { ...args, revision: cart.revision })
      const limit = Math.min(Math.round(args.maxAmount * 100), quote.maxOrderCents)
      if (quote.totalCents > limit) throw new PlatformError('over-cap', '优惠后含运费实付超出预算，未创建订单')
      return { ...agentDisplay(quote), accountRef: args.accountRef, maxAmountCents: limit, state: 'awaiting-confirmation' }
    })
  register('confirm_order', '仅在用户已明确授权购买指定商品且实付不超过其预算时，确认当前 quoteRef 并真实创建一次订单。confirmedCents 必须等于刚读取的 totalCents，maxAmountCents 为用户预算。未知结果不自动重试；经官方订单核对无新单且获重试授权后，可传 retryOf 原记录和 previousOrderAbsent=true，只重试一次、金额不得增加。不执行扣款；淘宝订单之后可 get_payment_options，获付款授权后 pay_order。',
    { platformId: z.enum(['taobao', 'hema']).default('taobao'), accountRef, quoteRef: z.uuid(), confirmed: z.literal(true),
      confirmedCents: z.number().int().positive().safe(), maxAmountCents: z.number().int().positive().safe(),
      retryOf: z.uuid().optional(), previousOrderAbsent: z.literal(true).optional() }, async args => {
      const result = await accounts.dispatch('submit', { ...args, manualConfirmation: true })
      return { view: 'payment', platformId: args.platformId, accountRef: args.accountRef,
        attempts: [{ ...agentDisplay(result), status: 'created', officialOrders: [] }] }
    })
  register('get_cart', '读取淘宝店铺或盒马账号真实购物车、规格、数量和版本；未确认的盒马加购仅回读核对。',
    { platformId: z.enum(['taobao', 'hema']).default('taobao'), accountRef, shopId: shopId.optional() }, async args => {
      if (args.platformId === 'taobao' && !args.shopId) throw new PlatformError('bad-request', '淘宝购物车需要店铺引用')
      return { ...agentDisplay(await accounts.dispatch('cart', args)), accountRef: args.accountRef, view: 'cart' }
    })
  register('add_product_to_cart', '将已读取的盒马 productRef、skuId 和数量加入购物车。先 get_cart 获取 revision；operationRef 必须固定，未知结果只 get_cart 回读。保留其他商品，不下单。',
    { platformId: z.literal('hema'), accountRef, productRef: z.uuid(), skuId: z.string().regex(/^[1-9]\d*$/),
      quantity: z.number().int().min(1).max(100), revision, operationRef: z.uuid() }, async args => ({
      ...agentDisplay(await accounts.dispatch('cartAdd', args)), accountRef: args.accountRef, view: 'cart',
    }))
  register('get_item_options', '读取菜单 itemId 的当前规格、必选配料、库存和加价；按返回的引用选择，不猜测规格。',
    { ...context, itemId: shopId }, async args => agentDisplay(await accounts.dispatch('itemOptions', args)))
  register('change_cart', '按已读取的购物车 revision 加购或减一件；不清空购物车、不下单。未知结果先 get_cart 核对，不重试。多规格需 selectionRef、variantRef、choiceRefs、quantity。',
    { ...context, revision, operationRef: z.uuid().optional(), step: z.union([z.literal(1), z.literal(-1)]),
      itemId: shopId.optional(), lineRef: optionRef.optional(), selectionRef: z.uuid().optional(), variantRef: optionRef.optional(),
      choiceRefs: z.array(optionRef).max(30).optional(), quantity: z.number().int().min(1).max(100).optional() }, async args => {
      if (args.step === 1 ? !args.itemId || args.lineRef : !args.lineRef || args.itemId) throw new PlatformError('bad-request', '请明确加购商品或减购行')
      if (args.selectionRef ? args.step !== 1 || !args.variantRef || !args.choiceRefs || !args.quantity : args.variantRef || args.choiceRefs || args.quantity) throw new PlatformError('bad-request', '请先读取并完成商品规格')
      return agentDisplay(await accounts.dispatch('cartChange', { ...args, operationRef: args.operationRef || randomUUID() }))
    })
  register('show_order', '在本次工具结果中展示可操作的点餐卡片。用真实菜单 itemIds 推荐餐品，用户可直接选规格、加购、结算和确认下单。此工具不加购或创建订单。',
    { ...context, itemIds: z.array(shopId).min(1).max(20), maxAmount: z.number().min(0.01).multipleOf(0.01).max(Number.MAX_SAFE_INTEGER / 100).optional() }, async args => {
      const menu = await accounts.dispatch('probeMenu', args)
      const wanted = new Set(args.itemIds), items = [...new Map(menu.categories.flatMap(group => group.items).filter(item => wanted.has(item.id)).map(item => [item.id, item])).values()]
      if (new Set(items.map(item => item.id)).size !== wanted.size) throw new PlatformError('item-unavailable', '推荐商品不在当前菜单中，请重新读取菜单')
      return { view: 'ordering', platformId: 'taobao', accountRef: args.accountRef, shopId: args.shopId,
        merchant: menu.shopName || menu.merchant || '', itemIds: args.itemIds, items,
        ...(args.maxAmount ? { maxAmountCents: Math.round(args.maxAmount * 100) } : {}) }
    })
  register('submit_order', '读取淘宝闪购或盒马真实结算报价并展示下单确认卡片。盒马传 get_cart 中明确选中的 lineIds，每种商品数量须为1。此调用不创建订单或扣款。maxAmount 是本次预算上限。',
    { platformId: z.enum(['taobao', 'hema']).default('taobao'), accountRef, shopId: shopId.optional(), lineIds: z.array(z.string().regex(/^[1-9]\d*$/)).min(1).max(50).optional(),
      maxAmount: z.number().min(0.01).multipleOf(0.01).max(Number.MAX_SAFE_INTEGER / 100) }, async args => {
      if (args.platformId === 'taobao' && (!args.shopId || args.lineIds)) throw new PlatformError('bad-request', '淘宝结算需要店铺引用')
      if (args.platformId === 'hema' && !args.lineIds?.length) throw new PlatformError('bad-request', '请明确选择本次盒马结算商品')
      const cart = await accounts.dispatch('cart', args)
      const quote = await accounts.dispatch('checkout', { ...args, addressRef: cart.addressRef, revision: cart.revision })
      const limit = Math.min(Math.round(args.maxAmount * 100), quote.maxOrderCents)
      if (quote.totalCents > limit) throw new PlatformError('over-cap', '平台实付金额超过本次预算或单笔上限，未创建订单')
      return { ...agentDisplay(quote), view: 'checkout', accountRef: args.accountRef, ...(args.lineIds ? { lineIds: args.lineIds } : {}), maxAmountCents: limit,
        state: 'awaiting-user-confirmation', paymentStatus: 'unconfirmed' }
    })
  const status = async args => {
    const local = await accounts.dispatch('tradeHistory', args)
    const attempts = local.attempts.filter(item => !args.orderRef || item.orderRef === args.orderRef)
    if (args.orderRef && !attempts.length) throw new PlatformError('order-missing', '此账号没有该下单记录')
    const page = attempts.length ? await accounts.dispatch('orders', args) : null
    return { view: 'payment', platformId: args.platformId, accountRef: args.accountRef,
      attempts: attempts.map(item => ({ ...agentDisplay(item),
        officialOrders: (page?.orders || []).filter(order => item.orderIds?.includes(order.id)).map(order => ({
          id: order.id, status: order.status, amount: order.amount, merchantName: order.merchantName,
        })) })) }
  }
  const historyInput = { platformId: z.enum(['taobao', 'hema']).default('taobao'), accountRef, orderRef: z.uuid().optional() }
  register('get_order_status', '按本机订单引用核对官方订单和付款状态；返回的未确认付款不能解释为已付款。', historyInput,
    async args => args.platformId === 'taobao' && args.orderRef ? { view: 'payment', platformId: 'taobao', accountRef: args.accountRef,
      attempts: [{ ...agentDisplay(await accounts.dispatch('paymentStatus', args)) }] } : status(args))
  register('request_payment', '在聊天中展示订单及官方付款入口卡片。支付链接仅由鉴权界面读取，不进入模型，不自动执行扣款；付款后 get_order_status 核对官方状态。', historyInput, status)
}
