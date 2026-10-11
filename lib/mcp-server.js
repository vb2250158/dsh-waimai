/** HTTP-only takeaway tools. Private account endpoints are filtered by the Host bridge. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { stateDir } from './paths.js'
import { LoginError } from './login.js'
import { AccountPool } from './account-pool.js'
import { OrderCursor } from './account-data.js'
import { ShopCursor } from './browse-data.js'
import { readFile } from 'node:fs/promises'
import { PlatformService, PlatformError } from './platform-service.js'

const numberEnv = (name, fallback, min, max) => z.coerce.number().finite().min(min).max(max).parse(process.env[name] ?? fallback)
const loginOptions = { persistLogin: process.env.PERSIST_LOGIN !== 'false',
  timeoutMs: numberEnv('LOGIN_TIMEOUT_MS', 20000, 1000, 120000), resendSeconds: numberEnv('SMS_RESEND_SECONDS', 60, 60, 600),
  historyPageSize: numberEnv('HISTORY_PAGE_SIZE', 10, 1, 20),
  browsePageSize: numberEnv('BROWSE_PAGE_SIZE', 10, 1, 20),
  qrLifetimeSeconds: numberEnv('QR_LIFETIME_SECONDS', 180, 60, 600), qrPollSeconds: numberEnv('QR_POLL_SECONDS', 2, 2, 15) }
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
const shopId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/)
const server = new McpServer({ name: 'dsh-waimai', version: JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version })
const addressRef = z.string().regex(/^[a-f0-9]{64}$/).optional()
const ok = data => ({ content: [{ type: 'text', text: JSON.stringify({ success: true, data }) }] })
const fail = error => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false,
  code: error instanceof PlatformError ? error.code : 'login-failed',
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
register('account_orders', '插件页面历史订单', { platformId, accountRef, cursor: OrderCursor.optional() }, args => accounts.dispatch('orders', args))
register('account_addresses', '插件页面配送地址', { platformId, accountRef }, args => accounts.dispatch('addresses', args))
register('account_select_address', '插件页面绑定当前账号配送地址', { platformId, accountRef, accountId: z.string().regex(/^[1-9]\d*$/), addressRef: z.string().regex(/^[a-f0-9]{64}$/) },
  args => accounts.dispatch('selectAddress', args))
register('account_recent_shops', '插件页面最近点过的店铺', { platformId, accountRef, addressRef }, args => accounts.dispatch('recentShops', args))
register('account_nearby_shops', '插件页面附近店铺', { platformId, accountRef, addressRef, cursor: ShopCursor.optional() }, args => accounts.dispatch('nearbyShops', args))
register('account_probe_menu', '插件页面读取店铺菜单', { platformId, accountRef, addressRef, shopId }, args => accounts.dispatch('probeMenu', args))
register('account_list', '插件页面本机平台账号列表', { platformId, accountRef }, args => accounts.dispatch('accountsList', args))
register('account_begin', '插件页面添加账号', { platformId, accountRef }, args => accounts.dispatch('accountBegin', args))
register('account_cancel', '插件页面取消添加账号', { platformId, accountRef }, args => accounts.dispatch('accountCancel', args))
register('account_view', '插件页面查看指定账号', { platformId, accountRef: z.uuid() }, args => accounts.dispatch('accountView', args))

register('list_platforms', '列出外卖平台和已经验证的能力；未接入平台不能登录或点餐。', {}, () => platforms.list())
register('list_connections', '列出每个平台已保存的账号引用，不返回昵称、手机号或凭据；调用账号工具时使用对应 accountRef。', {}, () => accounts.connections())
register('get_status', '查看 HTTP 点餐可用能力、预览模式和预算上限，不返回私人账号资料。', { platformId }, args => {
  const platform = platforms.list().find(value => value.id === args.platformId)
  if (!platform) throw new PlatformError('unknown-platform', '未找到该外卖平台')
  return { platformId: args.platformId, transport: 'http', capabilities: platform.capabilities,
    dryRun, maxOrderAmount: cap, dailyBudget: budget, paymentMode: 'manual', orderingAvailable: false, reason: platform.reason }
})
register('prepare_ordering', '复核指定账号和插件页选择的配送地址。地址信息不进入模型。', { platformId, accountRef }, args => accounts.dispatch('prepare', args))
register('search_shops', '查询当前配送地址的首批附近推荐店铺，或最近一页订单里的店铺。关键词只筛选本批结果；需插件页已选择地址。',
  { platformId, accountRef, scope: z.enum(['nearby', 'recent']).default('nearby'), keyword: z.string().max(100).default('') }, async args => {
  const result = await accounts.dispatch(args.scope === 'recent' ? 'recentShops' : 'nearbyShops', args)
  return { platformId: result.platformId, scope: result.scope, shops: result.shops.filter(shop => shop.name.includes(args.keyword)), hasMore: Boolean(result.nextCursor) }
})
register('get_menu', '通过 HTTP 读取店铺菜品分类、标价、售罄状态与只读口味选项。需插件页已选择配送地址；标价不是结算金额，下单仍不可用。', { platformId, accountRef, shopId }, async args => {
  const { accountId: _account, addressRef: _address, ...result } = await accounts.dispatch('probeMenu', args)
  return result
})
register('preview_checkout', '结算接口尚未验证，当前会明确返回不可用，不能用菜单标价代替实付金额。', { platformId }, args => platforms.requireOrdering(args.platformId, 'checkout'))
register('submit_order', '创建订单接口尚未验证，当前禁止提交。未来需要有效结算引用及金额上限。',
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
