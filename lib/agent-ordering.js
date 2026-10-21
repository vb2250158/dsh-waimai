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
  register('get_order_status', '按本机订单引用核对官方订单状态；返回的未确认付款不能解释为已付款。', historyInput, status)
  register('request_payment', '在聊天中展示订单及官方付款入口卡片。支付链接仅由鉴权界面读取，不进入模型，不自动执行扣款；付款后 get_order_status 核对官方状态。', historyInput, status)
}
