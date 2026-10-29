/** HTTP-only takeaway tools. Private account endpoints are filtered by the Host bridge. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { h5StartFields, h5SubmitFields, h5AuthenticationFields, h5MethodsFields } from './alipay-h5-input.js'
import { stateDir } from './paths.js'
import { LoginError } from './login.js'
import { AccountPool } from './account-pool.js'
import { OrderCursor } from './account-data.js'
import { HemaOrderCursor, HemaProductCursor } from './hema-data.js'
import { ShopCursor } from './browse-data.js'
import { readFile } from 'node:fs/promises'
import { PlatformService, PlatformError } from './platform-service.js'
import { registerAgentOrdering } from './agent-ordering.js'
import { registerAgentBrowse } from './agent-browse.js'

const numberEnv = (name, fallback, min, max) => z.coerce.number().finite().min(min).max(max).parse(process.env[name] ?? fallback)
const loginOptions = { persistLogin: process.env.PERSIST_LOGIN !== 'false',
  timeoutMs: numberEnv('LOGIN_TIMEOUT_MS', 20000, 1000, 120000), resendSeconds: numberEnv('SMS_RESEND_SECONDS', 60, 60, 600),
  historyPageSize: numberEnv('HISTORY_PAGE_SIZE', 10, 1, 20),
  browsePageSize: numberEnv('BROWSE_PAGE_SIZE', 10, 1, 20),
  hemaProductPageSize: numberEnv('HEMA_PRODUCT_PAGE_SIZE', 30, 1, 50),
  hideSponsoredShops: z.enum(['true', 'false']).parse(process.env.HIDE_SPONSORED_SHOPS ?? 'true') === 'true',
  qrLifetimeSeconds: numberEnv('QR_LIFETIME_SECONDS', 180, 60, 600), qrPollSeconds: numberEnv('QR_POLL_SECONDS', 2, 2, 15),
  qrAuthorizationSeconds: numberEnv('QR_AUTHORIZATION_SECONDS', 60, 15, 300),
  diagnostic: z.enum(['true', 'false']).parse(process.env.LOGIN_DIAGNOSTICS ?? 'true') === 'true'
    ? event => console.error(event.group === 'waimai-cart' ? '[waimai-cart]' : event.group === 'waimai-order' ? '[waimai-order]' : '[waimai-login]', JSON.stringify(event)) : () => {} }
const platforms = new PlatformService({ directory: stateDir() })
const accounts = new AccountPool({ directory: stateDir(), definitions: platforms.list(), loginOptions,
  maxAccounts: numberEnv('MAX_ACCOUNTS_PER_PLATFORM', 10, 1, 100) })
const defaultPlatform = process.env.DEFAULT_PLATFORM || 'taobao'
if (!platforms.list().some(value => value.id === defaultPlatform)) throw new Error('Unknown default takeaway platform')
const platformId = z.string().regex(/^[a-z]+$/).default(defaultPlatform)
const accountRef = z.uuid().optional()
const dryRun = process.env.DRY_RUN !== 'false'
const cap = numberEnv('MAX_ORDER_AMOUNT', 35, 1, Number.MAX_SAFE_INTEGER)
const budget = numberEnv('DAILY_BUDGET', 0, 0, Number.MAX_SAFE_INTEGER)
loginOptions.tradeOptions = { dryRun, cap, budget, quoteSeconds: numberEnv('CHECKOUT_QUOTE_SECONDS', 120, 30, 300),
  h5BrowserChannel: z.enum(['chrome', 'msedge', 'chromium']).parse(process.env.ALIPAY_H5_BROWSER_CHANNEL ?? 'chrome'),
  alipayAgent: { executable: process.env.ALIPAY_AGENT_EXECUTABLE || '', timeoutMs: numberEnv('ALIPAY_AGENT_TIMEOUT_MS', 30000, 1000, 120000) } }
const shopId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/)
const server = new McpServer({ name: 'dsh-waimai', version: JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version })
const addressRef = z.string().regex(/^[a-f0-9]{64}$/).optional()
const ok = data => ({ content: [{ type: 'text', text: JSON.stringify({ success: true, data }) }] })
const fail = error => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false,
  code: error instanceof LoginError && error.code ? error.code : 'login-failed',
  error: error instanceof LoginError ? error.message : '请求失败或结果未确认，请检查插件状态' }) }] })
const register = (name, description, inputSchema, operation) => server.registerTool(name, { description, inputSchema }, async (args, extra) => {
  try { return ok(await operation(args, extra)) } catch (error) { return fail(error) }
})
const blockPreview = () => { if (dryRun) throw new PlatformError('preview-only', '预览模式下不创建订单或支付') }

register('platform_list', '插件页面平台列表', {}, () => platforms.list())
register('login_status', '插件页面登录状态', { platformId, accountRef }, args => accounts.dispatch('status', args))
register('login_send_code', '插件页面发送验证码', { platformId, accountRef, loginMethod: z.enum(['sms', 'taobao-sms']).optional(), phone: z.string().regex(/^1[3-9]\d{9}$/) }, args => {
  return accounts.dispatch('sendCode', args)
})
register('login_complete', '插件页面完成短信登录', { platformId, accountRef, loginMethod: z.enum(['sms', 'taobao-sms']).optional(), smsAttemptId: z.uuid().optional(), code: z.string().regex(/^\d{4,8}$/) }, args => {
  return accounts.dispatch('complete', args)
})
register('login_qr_start', '插件页面获取所选方式的扫码二维码', { platformId, accountRef, loginMethod: z.enum(['taobao-qr', 'hema-qr']).optional() }, args => {
  return accounts.dispatch('qrStart', args)
})
register('login_qr_poll', '插件页面检查淘宝扫码与闪购授权状态', { platformId, accountRef, attemptId: z.uuid() }, args => {
  return accounts.dispatch('qrPoll', args)
})
register('login_qr_cancel', '插件页面取消本次淘宝扫码', { platformId, accountRef, attemptId: z.uuid() }, args => {
  return accounts.dispatch('qrCancel', args)
})
register('account_profile', '插件页面账号资料', { platformId, accountRef }, args => accounts.dispatch('profile', args))
register('account_orders', '插件页面历史订单', { platformId, accountRef, cursor: z.union([OrderCursor, HemaOrderCursor]).optional() }, args => accounts.dispatch('orders', args))
register('account_addresses', '插件页面配送地址', { platformId, accountRef }, args => accounts.dispatch('addresses', args))
register('account_select_address', '插件页面绑定当前账号配送地址', { platformId, accountRef, accountId: z.string().regex(/^[1-9]\d*$/), addressRef: z.string().regex(/^[a-f0-9]{64}$/) },
  args => accounts.dispatch('selectAddress', args))
register('account_recent_shops', '插件页面最近点过的店铺', { platformId, accountRef, addressRef }, args => accounts.dispatch('recentShops', args))
register('account_nearby_shops', '插件页面附近店铺', { platformId, accountRef, addressRef, cursor: ShopCursor.optional() }, args => accounts.dispatch('nearbyShops', args))
register('account_probe_menu', '插件页面读取菜单或搜索盒马商品', { platformId, accountRef, addressRef, shopId, keyword: z.string().max(100).optional(), cursor: HemaProductCursor.optional() }, args => accounts.dispatch('probeMenu', args))
register('account_product_detail', '插件页面读取盒马商品规格', { platformId: z.literal('hema'), accountRef, addressRef, productRef: z.uuid() }, args => accounts.dispatch('productDetail', args))
register('account_cart_add', '插件页面按已读取规格加入盒马购物车；结果未确认时仅回读，不重发。', {
  platformId: z.literal('hema'), accountRef: z.uuid(), addressRef: z.string().regex(/^[a-f0-9]{64}$/), productRef: z.uuid(),
  skuId: z.string().regex(/^[1-9]\d*$/), quantity: z.number().int().min(1).max(100), revision: z.string().regex(/^[a-f0-9]{64}$/), operationRef: z.uuid(),
}, args => accounts.dispatch('cartAdd', args))
register('account_cart', '插件页面读取当前账号购物车', { platformId: z.enum(['hema', 'taobao']), accountRef, addressRef, shopId: shopId.optional() }, args => {
  if (args.platformId === 'taobao' && (!args.accountRef || !args.addressRef || !args.shopId)) throw new PlatformError('bad-request', '请先选择账号、地址和店铺')
  return accounts.dispatch('cart', args)
})
register('account_item_options', '插件页面读取当前店铺商品的规格和可售选项', { platformId: z.literal('taobao'), accountRef: z.uuid(),
  addressRef: z.string().regex(/^[a-f0-9]{64}$/), shopId, itemId: shopId }, args => accounts.dispatch('itemOptions', args))
register('account_cart_change', '插件页面修改当前规格商品，不清空购物车', { platformId: z.literal('taobao'), accountRef: z.uuid(),
  addressRef: z.string().regex(/^[a-f0-9]{64}$/), shopId, revision: z.string().regex(/^[a-f0-9]{64}$/), operationRef: z.uuid(),
  step: z.union([z.literal(1), z.literal(-1)]), itemId: shopId.optional(), lineRef: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  selectionRef: z.uuid().optional(), variantRef: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  choiceRefs: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(30).optional(), quantity: z.number().int().min(1).max(100).optional() }, args => {
    if (args.step === 1 ? !args.itemId || args.lineRef : !args.lineRef || args.itemId) throw new PlatformError('bad-request', '购物车操作参数无效')
    if (args.selectionRef ? args.step !== 1 || !args.variantRef || !args.choiceRefs || !args.quantity : args.variantRef || args.choiceRefs || args.quantity) throw new PlatformError('bad-request', '商品规格参数不完整')
    return accounts.dispatch('cartChange', args)
  })
register('account_checkout', '插件页面读取平台实时报价，不创建订单', { platformId: z.enum(['taobao', 'hema']), accountRef: z.uuid(),
  addressRef: z.string().regex(/^[a-f0-9]{64}$/), shopId: shopId.optional(), lineIds: z.array(z.string().regex(/^[1-9]\d*$/)).min(1).max(50).optional(), revision: z.string().regex(/^[a-f0-9]{64}$/) }, args => {
    if (args.platformId === 'taobao' ? !args.shopId || args.lineIds : !args.lineIds) throw new PlatformError('bad-request', '结算商品或门店参数无效')
    return accounts.dispatch('checkout', args)
  })
register('account_select_delivery', '插件页面选择当前盒马报价中的配送方式并重新计价，不创建订单', {
  platformId: z.literal('hema'), accountRef: z.uuid(), quoteRef: z.uuid(), deliveryRef: z.uuid() }, args => accounts.dispatch('selectDelivery', args))
register('account_submit', '插件页面明确确认实付金额后创建订单，不执行扣款', { platformId: z.enum(['taobao', 'hema']), accountRef: z.uuid(),
  quoteRef: z.uuid(), confirmed: z.literal(true), confirmedCents: z.number().int().positive().safe(),
  manualConfirmation: z.literal(true).optional(), maxAmountCents: z.number().int().positive().safe().optional(), retryOf: z.uuid().optional(), previousOrderAbsent: z.literal(true).optional() }, args => {
    if (args.retryOf || args.previousOrderAbsent) {
      if (args.manualConfirmation !== true || !args.retryOf || args.previousOrderAbsent !== true) throw new PlatformError('bad-request', '请先核对原订单，再明确确认重试')
    }
    return accounts.dispatch('submit', args)
  })
register('account_trade_history', '插件页面读取本机下单记录和官方支付入口', { platformId: z.enum(['taobao', 'hema']), accountRef: z.uuid() }, args => accounts.dispatch('tradeHistory', args))
register('account_payment_status', '插件页面核对当前订单付款状态', { platformId: z.literal('taobao'), accountRef: z.uuid(), orderRef: z.uuid() }, args => accounts.dispatch('paymentStatus', args))
register('account_payment_provider_receipt', '私有页面读取当前订单付款服务回执，不发起付款', { platformId: z.literal('taobao'), accountRef: z.uuid(), orderRef: z.uuid() }, args => accounts.dispatch('paymentProviderReceipt', args))
register('account_payment_h5_methods', '私有支付设置读取或选择当前收银台付款方式，不提交付款', h5MethodsFields, args => accounts.dispatch('paymentH5Methods', args))
register('account_payment_h5_authenticate', '私有页面打开或连接支付宝登录验证', h5AuthenticationFields, args => accounts.dispatch('paymentH5Authenticate', args))
register('account_payment_h5_start', '私有页面初始化当前订单 H5 会话，凭据不得传入模型', h5StartFields, args => { blockPreview(); return accounts.dispatch('paymentH5Start', args) })
register('account_payment_h5_submit', '私有页面为当前订单提交一次 H5 付款验证', h5SubmitFields, args => { blockPreview(); return accounts.dispatch('paymentH5Submit', args) })
register('account_list', '插件页面本机平台账号列表', { platformId, accountRef }, args => accounts.dispatch('accountsList', args))
register('account_begin', '插件页面添加账号', { platformId, accountRef }, args => accounts.dispatch('accountBegin', args))
register('account_cancel', '插件页面取消添加账号', { platformId, accountRef }, args => accounts.dispatch('accountCancel', args))
register('account_view', '插件页面查看指定账号', { platformId, accountRef: z.uuid() }, args => accounts.dispatch('accountView', args))
register('account_use_taobao', '插件页面用已登录淘宝账号登录盒马', { platformId: z.literal('hema'), accountRef, sourceAccountRef: z.uuid() }, args => accounts.dispatch('useTaobao', args))

register('list_platforms', '列出外卖平台和已经验证的能力；未接入平台不能登录或点餐。', {}, () => platforms.list())
register('list_connections', '列出每个平台已保存的账号引用，不返回昵称、手机号或凭据；调用账号工具时使用对应 accountRef。', {}, () => accounts.connections())
register('get_status', '查看 HTTP 点餐可用能力、预览模式和预算上限，不返回私人账号资料。', { platformId }, args => {
  const platform = platforms.list().find(value => value.id === args.platformId)
  if (!platform) throw new PlatformError('unknown-platform', '未找到该外卖平台')
  return { platformId: args.platformId, transport: 'http', capabilities: platform.capabilities,
    dryRun, maxOrderAmount: cap, dailyBudget: budget, paymentMode: 'official-cashier', orderingAvailable: platform.capabilities.manualOrder === true, automaticPaymentAvailable: false,
    manualOrderingAvailable: platform.capabilities.manualOrder === true, paymentInitiationAvailable: args.platformId === 'taobao',
    userConfirmationRequired: true, reason: platform.reason }
})
register('prepare_ordering', '复核指定账号和插件页选择的配送地址。地址信息不进入模型。', { platformId, accountRef }, args => accounts.dispatch('prepare', args))
registerAgentBrowse(register, accounts, { defaultPlatform, cursorSeconds: numberEnv('BROWSE_CURSOR_SECONDS', 600, 30, 3600),
  cursorLimit: numberEnv('BROWSE_CURSOR_LIMIT', 100, 1, 1000) })
register('get_menu', '通过 HTTP 读取店铺菜品或盒马商品的标价和库存状态。盒马须提供商品名称 keyword，后续页传回 nextCursor。需插件页已选择配送地址；标价不是结算金额；用 show_order 展示点餐卡片，用 submit_order 获取下单确认卡片。', { platformId, accountRef, shopId, keyword: z.string().max(100).optional(), cursor: HemaProductCursor.optional() }, async args => {
  const { accountId: _account, addressRef: _address, ...result } = await accounts.dispatch('probeMenu', args)
  return result
})
register('get_product_details', '读取盒马搜索结果中 productRef 对应的规格、计价单位和库存；不加入购物车或购买。', { platformId: z.literal('hema'), accountRef, productRef: z.uuid() }, async args => {
  const { accountId: _account, addressRef: _address, ...result } = await accounts.dispatch('productDetail', args)
  return result
})
register('preview_checkout', '读取淘宝闪购或盒马购物车实时报价，不返回地址、原生参数或支付链接，不创建订单。盒马需明确传 lineIds。',
  { platformId: z.enum(['taobao', 'hema']), accountRef: z.uuid(), shopId: shopId.optional(), lineIds: z.array(z.string().regex(/^[1-9]\d*$/)).min(1).max(50).optional() }, async args => {
    if (args.platformId === 'taobao' ? !args.shopId || args.lineIds : !args.lineIds) throw new PlatformError('bad-request', '请明确结算商品或门店')
    const cart = await accounts.dispatch('cart', args)
    const quote = await accounts.dispatch('checkout', { ...args, addressRef: cart.addressRef, revision: cart.revision })
    return { view: 'checkout', accountRef: args.accountRef, revision: quote.revision, maxAmountCents: quote.maxOrderCents, ...(args.lineIds ? { lineIds: args.lineIds } : {}),
      state: 'awaiting-user-confirmation', platformId: quote.platformId, shopId: quote.shopId, merchant: quote.merchant, items: quote.items, fees: quote.fees,
      totalCents: quote.totalCents, discountCents: quote.discountCents, deliveryTime: quote.deliveryTime, previewOnly: quote.previewOnly }
  })
registerAgentOrdering(register, accounts)

await server.connect(new StdioServerTransport())
const close = async () => { await accounts.close(); await server.close() }
process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
