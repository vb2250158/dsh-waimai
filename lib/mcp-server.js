/** HTTP-only takeaway tools. Private account endpoints are filtered by the Host bridge. */
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { stateDir } from './paths.js'
import { WaimaiLogin, LoginError } from './login.js'
import { OrderCursor } from './account-data.js'
import { PlatformService, PlatformError } from './platform-service.js'

const numberEnv = (name, fallback, min, max) => z.coerce.number().finite().min(min).max(max).parse(process.env[name] ?? fallback)
const login = new WaimaiLogin({ statePath: join(stateDir(), 'login-state.json'), persistLogin: process.env.PERSIST_LOGIN !== 'false',
  timeoutMs: numberEnv('LOGIN_TIMEOUT_MS', 20000, 1000, 120000), resendSeconds: numberEnv('SMS_RESEND_SECONDS', 60, 60, 600),
  historyPageSize: numberEnv('HISTORY_PAGE_SIZE', 10, 1, 20),
  qrLifetimeSeconds: numberEnv('QR_LIFETIME_SECONDS', 180, 60, 600), qrPollSeconds: numberEnv('QR_POLL_SECONDS', 2, 2, 15) })
const platforms = new PlatformService({ login, directory: stateDir() })
const defaultPlatform = process.env.DEFAULT_PLATFORM || 'taobao'
if (!platforms.list().some(value => value.id === defaultPlatform)) throw new Error('Unknown default takeaway platform')
const platformId = z.string().regex(/^[a-z]+$/).default(defaultPlatform)
const dryRun = process.env.DRY_RUN !== 'false'
const cap = numberEnv('MAX_ORDER_AMOUNT', 35, 1, Number.MAX_SAFE_INTEGER)
const budget = numberEnv('DAILY_BUDGET', 0, 0, Number.MAX_SAFE_INTEGER)
const shopId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/)
const server = new McpServer({ name: 'dsh-waimai', version: '0.2.1' })
const ok = data => ({ content: [{ type: 'text', text: JSON.stringify({ success: true, data }) }] })
const fail = error => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false,
  code: error instanceof PlatformError ? error.code : 'login-failed',
  error: error instanceof LoginError ? error.message : '请求失败或结果未确认，请检查插件状态' }) }] })
const register = (name, description, inputSchema, operation) => server.registerTool(name, { description, inputSchema }, async args => {
  try { return ok(await operation(args)) } catch (error) { return fail(error) }
})
const blockPreview = () => { if (dryRun) throw new PlatformError('preview-only', '预览模式下不创建订单或支付') }

register('platform_list', '插件页面平台列表', {}, () => platforms.list())
register('login_status', '插件页面登录状态', { platformId }, args => platforms.status(args.platformId))
register('login_send_code', '插件页面发送验证码', { platformId, phone: z.string().regex(/^1[3-9]\d{9}$/) }, args => {
  platforms.requirePlatform(args.platformId); return login.sendCode(args.phone)
})
register('login_complete', '插件页面完成短信登录', { platformId, code: z.string().regex(/^\d{4,8}$/) }, args => {
  platforms.requirePlatform(args.platformId); return login.complete(args.code)
})
register('login_qr_start', '插件页面获取淘宝扫码二维码', { platformId }, args => {
  platforms.requirePlatform(args.platformId); return login.qrStart()
})
register('login_qr_poll', '插件页面检查淘宝扫码与闪购授权状态', { platformId, attemptId: z.uuid() }, args => {
  platforms.requirePlatform(args.platformId); return login.qrPoll(args.attemptId)
})
register('login_qr_cancel', '插件页面取消本次淘宝扫码', { platformId, attemptId: z.uuid() }, args => {
  platforms.requirePlatform(args.platformId); return login.qrCancel(args.attemptId)
})
register('account_profile', '插件页面账号资料', { platformId }, args => platforms.profile(args.platformId))
register('account_orders', '插件页面历史订单', { platformId, cursor: OrderCursor.optional() }, args => platforms.orders(args.platformId, args.cursor))
register('account_addresses', '插件页面配送地址', { platformId }, args => platforms.addresses(args.platformId))
register('account_select_address', '插件页面绑定当前账号配送地址', { platformId, accountId: z.string().regex(/^[1-9]\d*$/), addressRef: z.string().regex(/^[a-f0-9]{64}$/) },
  args => platforms.selectAddress(args.platformId, args.accountId, args.addressRef))
register('account_recent_shops', '插件页面最近点过的店铺', { platformId }, args => platforms.recentShops(args.platformId))
register('account_probe_menu', '插件页面检查菜单接口', { platformId, shopId }, args => platforms.probeMenu(args.platformId, args.shopId))

register('list_platforms', '列出外卖平台和已经验证的能力；未接入平台不能登录或点餐。', {}, () => platforms.list())
register('get_status', '查看 HTTP 点餐可用能力、预览模式和预算上限，不返回私人账号资料。', { platformId }, args => {
  const platform = platforms.list().find(value => value.id === args.platformId)
  if (!platform) throw new PlatformError('unknown-platform', '未找到该外卖平台')
  return { platformId: args.platformId, transport: 'http', capabilities: platform.capabilities,
    dryRun, maxOrderAmount: cap, dailyBudget: budget, paymentMode: 'manual', orderingAvailable: false, reason: platform.reason }
})
register('prepare_ordering', '复核当前账号和插件页选择的配送地址。地址信息不进入模型。', { platformId }, args => platforms.prepare(args.platformId))
register('search_shops', '按名称筛选最近一页历史订单中的店铺；搜索范围仅限最近点过的店铺。', { platformId, keyword: z.string().max(100).default('') }, async args => {
  const { accountId: _privateAccount, ...result } = await platforms.recentShops(args.platformId, args.keyword)
  return result
})
register('get_menu', '通过 HTTP 检查店铺菜单接口。需要插件页已选择地址；遇到平台验证停止。商品规格尚未验证时不能下单。', { platformId, shopId }, args => platforms.probeMenu(args.platformId, args.shopId))
register('preview_checkout', '结算接口尚未验证，当前会明确返回不可用，不能用菜单标价代替实付金额。', { platformId }, args => platforms.requireOrdering(args.platformId, 'checkout'))
register('submit_order', '创建订单接口尚未验证，当前禁止提交。未来需要有效结算引用及金额上限。',
  { platformId, quoteId: z.string().max(200).optional(), maxAmount: z.number().positive().optional() }, args => {
    blockPreview(); platforms.requireOrdering(args.platformId, 'createOrder')
  })
register('request_payment', '支付接口尚未验证，当前禁止扣款。不接受调用方金额或商家参数。', {}, () => {
  blockPreview(); platforms.requireOrdering(defaultPlatform, 'payment')
})

await server.connect(new StdioServerTransport())
const close = async () => { await login.close(); await server.close() }
process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
