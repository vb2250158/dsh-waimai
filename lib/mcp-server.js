/** HTTP-only takeaway tools. Private account endpoints are filtered by the Host bridge. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { stateDir } from './paths.js'
import { LoginError } from './login.js'
import { AccountPool } from './account-pool.js'
import { OrderCursor } from './account-data.js'
import { HemaOrderCursor, HemaProductCursor } from './hema-data.js'
import { ShopCursor } from './browse-data.js'
import { readFile } from 'node:fs/promises'
import { PlatformService, PlatformError } from './platform-service.js'

const numberEnv = (name, fallback, min, max) => z.coerce.number().finite().min(min).max(max).parse(process.env[name] ?? fallback)
const loginOptions = { persistLogin: process.env.PERSIST_LOGIN !== 'false',
  timeoutMs: numberEnv('LOGIN_TIMEOUT_MS', 20000, 1000, 120000), resendSeconds: numberEnv('SMS_RESEND_SECONDS', 60, 60, 600),
  historyPageSize: numberEnv('HISTORY_PAGE_SIZE', 10, 1, 20),
  browsePageSize: numberEnv('BROWSE_PAGE_SIZE', 10, 1, 20),
  hemaProductPageSize: numberEnv('HEMA_PRODUCT_PAGE_SIZE', 30, 1, 50),
  hideSponsoredShops: z.enum(['true', 'false']).parse(process.env.HIDE_SPONSORED_SHOPS ?? 'true') === 'true',
  qrLifetimeSeconds: numberEnv('QR_LIFETIME_SECONDS', 180, 60, 600), qrPollSeconds: numberEnv('QR_POLL_SECONDS', 2, 2, 15),
  diagnostic: z.enum(['true', 'false']).parse(process.env.LOGIN_DIAGNOSTICS ?? 'true') === 'true'
    ? event => console.error('[waimai-login]', JSON.stringify(event)) : () => {} }
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
loginOptions.tradeOptions = { dryRun, cap, budget, quoteSeconds: numberEnv('CHECKOUT_QUOTE_SECONDS', 120, 30, 300) }
const shopId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/)
const server = new McpServer({ name: 'dsh-waimai', version: JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version })
const addressRef = z.string().regex(/^[a-f0-9]{64}$/).optional()
const ok = data => ({ content: [{ type: 'text', text: JSON.stringify({ success: true, data }) }] })
const fail = error => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false,
  code: error instanceof LoginError && error.code ? error.code : 'login-failed',
  error: error instanceof LoginError ? error.message : '请求失败或结果未确认，请检查插件状态' }) }] })
const register = (name, description, inputSchema, operation) => server.registerTool(name, { description, inputSchema }, async args => {
  try { return ok(await operation(args)) } catch (error) { return fail(error) }
})
const blockPreview = () => { if (dryRun) throw new PlatformError('preview-only', '预览模式下不创建订单或支付') }

register('platform_list', '插件页面平台列表', {}, () => platforms.list())
register('login_status', '插件页面登录状态', { platformId, accountRef }, args => accounts.dispatch('status', args))
register('login_send_code', '插件页面发送验证码', { platformId, accountRef, phone: z.string().regex(/^1[3-9]\d{9}$/) }, args => {
  return accounts.dispatch('sendCode', args)
})
register('login_complete', '插件页面完成短信登录', { platformId, accountRef, code: z.string().regex(/^\d{4,8}$/) }, args => {
  return accounts.dispatch('complete', args)
})
register('login_qr_start', '插件页面获取淘宝扫码二维码', { platformId, accountRef }, args => {
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
register('account_cart', '插件页面读取当前账号购物车', { platformId: z.enum(['hema', 'taobao']), accountRef, addressRef, shopId: shopId.optional() }, args => {
  if (args.platformId === 'taobao' && (!args.accountRef || !args.addressRef || !args.shopId)) throw new PlatformError('bad-request', '请先选择账号、地址和店铺')
  return accounts.dispatch('cart', args)
})
register('account_cart_change', '插件页面修改一件当前规格商品，不清空购物车', { platformId: z.literal('taobao'), accountRef: z.uuid(),
  addressRef: z.string().regex(/^[a-f0-9]{64}$/), shopId, revision: z.string().regex(/^[a-f0-9]{64}$/), operationRef: z.uuid(),
  step: z.union([z.literal(1), z.literal(-1)]), itemId: shopId.optional(), lineRef: z.string().regex(/^[a-f0-9]{64}$/).optional() }, args => {
    if (args.step === 1 ? !args.itemId || args.lineRef : !args.lineRef || args.itemId) throw new PlatformError('bad-request', '购物车操作参数无效')
    return accounts.dispatch('cartChange', args)
  })
register('account_checkout', '插件页面读取平台实时报价，不创建订单', { platformId: z.literal('taobao'), accountRef: z.uuid(),
  addressRef: z.string().regex(/^[a-f0-9]{64}$/), shopId, revision: z.string().regex(/^[a-f0-9]{64}$/) }, args => accounts.dispatch('checkout', args))
register('account_submit', '插件页面明确确认实付金额后创建订单，不执行扣款', { platformId: z.literal('taobao'), accountRef: z.uuid(),
  quoteRef: z.uuid(), confirmed: z.literal(true), confirmedCents: z.number().int().positive().safe() }, args => accounts.dispatch('submit', args))
register('account_trade_history', '插件页面读取本机下单记录和官方支付入口', { platformId: z.literal('taobao'), accountRef: z.uuid() }, args => accounts.dispatch('tradeHistory', args))
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
    dryRun, maxOrderAmount: cap, dailyBudget: budget, paymentMode: 'manual', orderingAvailable: false,
    manualOrderingAvailable: platform.capabilities.manualOrder === true, reason: platform.reason }
})
register('prepare_ordering', '复核指定账号和插件页选择的配送地址。地址信息不进入模型。', { platformId, accountRef }, args => accounts.dispatch('prepare', args))
register('search_shops', '查询当前配送地址的首批附近推荐店铺，或最近一页订单里的店铺。关键词只筛选本批结果；需插件页已选择地址。',
  { platformId, accountRef, scope: z.enum(['nearby', 'recent']).default('nearby'), keyword: z.string().max(100).default('') }, async args => {
  const result = await accounts.dispatch(args.scope === 'recent' ? 'recentShops' : 'nearbyShops', args)
  return { platformId: result.platformId, scope: result.scope, shops: result.shops.filter(shop => shop.name.includes(args.keyword)), hasMore: Boolean(result.nextCursor) }
})
register('get_menu', '通过 HTTP 读取店铺菜品或盒马商品的标价和库存状态。盒马须提供商品名称 keyword，后续页传回 nextCursor。需插件页已选择配送地址；标价不是结算金额，下单仍不可用。', { platformId, accountRef, shopId, keyword: z.string().max(100).optional(), cursor: HemaProductCursor.optional() }, async args => {
  const { accountId: _account, addressRef: _address, ...result } = await accounts.dispatch('probeMenu', args)
  return result
})
register('get_product_details', '读取盒马搜索结果中 productRef 对应的规格、计价单位和库存；不加入购物车或购买。', { platformId: z.literal('hema'), accountRef, productRef: z.uuid() }, async args => {
  const { accountId: _account, addressRef: _address, ...result } = await accounts.dispatch('productDetail', args)
  return result
})
register('preview_checkout', '读取淘宝闪购购物车的实时报价，不返回地址、原生参数或支付链接，不创建订单。需插件页已选择地址。',
  { platformId: z.literal('taobao'), accountRef: z.uuid(), shopId }, async args => {
    const cart = await accounts.dispatch('cart', args)
    const quote = await accounts.dispatch('checkout', { ...args, addressRef: cart.addressRef, revision: cart.revision })
    return { platformId: quote.platformId, shopId: quote.shopId, merchant: quote.merchant, items: quote.items, fees: quote.fees,
      totalCents: quote.totalCents, discountCents: quote.discountCents, deliveryTime: quote.deliveryTime, previewOnly: quote.previewOnly }
  })
register('submit_order', '模型不可创建订单；请在插件页面读取结算单并明确确认金额。',
  { platformId, quoteId: z.string().max(200).optional(), maxAmount: z.number().positive().optional() }, args => {
    blockPreview(); platforms.requireOrdering(args.platformId, 'createOrder')
  })
register('request_payment', '支付接口尚未验证，当前禁止扣款。不接受调用方金额或商家参数。', {}, () => {
  blockPreview(); platforms.requireOrdering(defaultPlatform, 'payment')
})

await server.connect(new StdioServerTransport())
const close = async () => { await accounts.close(); await server.close() }
process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
