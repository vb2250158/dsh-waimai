/**
 * Host half of the dsh-waimai plugin.
 *
 * Owns three things:
 *
 * 1. The takeaway MCP bridge, spawned from this package and published as
 *    `mcp__waimai__*` tools.
 * 2. A skill provider over this package's `skills/` directory, so the
 *    interactive ordering and automation skills are discoverable.
 * 3. The automation poll for previews; unverified purchasing APIs stop execution.
 *
 * The settings form writes the volatile Config snapshot into the profile.
 * Configuration changes restart the MCP child after any active scheduled run.
 *
 * @module dsh-waimai
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { WaimaiMcpBridge } from './mcp-bridge.js'
import { registerLoginRpc } from './login-rpc.js'
import { registerLoginDiagnosticOutput } from './login-diagnostics.js'
import { stateDir } from './paths.js'
import { childEnv } from './env.js'
import { createSkillProvider } from './skill-provider.js'
import {
  buildCron,
  isTaskDue,
  readState,
  toDateKey,
  writeState,
  validateTasks,
  previewTask,
} from './automation.js'

/** Package root, derived from this module so no machine path is hardcoded. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Directory holding the packaged skills. */
const SKILLS_DIR = join(PACKAGE_ROOT, 'skills')

/** Automation poll period in ms. A task fires during its trigger minute. */
const POLL_INTERVAL_MS = 60_000

/** Fields describing one automation task. */
const AutoTask = z.object({
  platformId: z.union(['taobao', 'hema', 'meituan', 'jd']).default('taobao')
    .description({ zh: '外卖平台', en: 'Takeaway platform' }),
  id: z.string().default('').description({ zh: '任务 ID（留空则不会被调度）', en: 'Task id' }),
  name: z.string().default('').description({ zh: '任务名称', en: 'Task name' }),
  enabled: z.boolean().default(false).description({ zh: '启用该任务', en: 'Enabled' }),
  triggerTime: z.string().default('11:00').description({ zh: '触发时间 HH:mm', en: 'Trigger time' }),
  dateRule: z.union(['workday', 'weekend', 'everyday', 'custom'])
    .default('workday')
    .description({ zh: '日期规则', en: 'Date rule' }),
  customDays: z.array(z.string()).default(['mon', 'tue', 'wed', 'thu', 'fri'])
    .description({ zh: '自定义日期（dateRule=custom 时生效）', en: 'Custom days' }),
  skipDates: z.array(z.string()).default([])
    .description({ zh: '额外跳过日期 YYYY-MM-DD', en: 'Skip dates' }),
  menuPool: z.array(z.string()).default([])
    .description({ zh: '菜单池，每项「店铺 | 菜品 | 价格」', en: 'Menu pool' }),
  menuStrategy: z.union(['rotate', 'random', 'history'])
    .default('rotate')
    .description({ zh: '选择策略', en: 'Menu strategy' }),
  maxOrderAmount: z.number().step(1).min(1).default(35)
    .description({ zh: '该任务单笔上限（元）', en: 'Per-task order cap' }),
  dailyBudget: z.number().step(1).min(1).default(50)
    .description({ zh: '该任务每日累计上限（元）', en: 'Per-task daily budget' }),
  paymentMode: z.union(['auto', 'manual']).default('manual')
    .description({ zh: '支付模式：auto 自动支付 / manual 仅提交', en: 'Payment mode' }),
  merchantWhitelist: z.array(z.string()).default([])
    .description({ zh: '商家白名单（留空不限制）', en: 'Merchant whitelist' }),
  notifyOnSuccess: z.boolean().default(true).description({ zh: '成功时通知', en: 'Notify on success' }),
  notifyOnFailure: z.boolean().default(true).description({ zh: '失败时通知', en: 'Notify on failure' }),
})

/** Plugin configuration. */
export const Config = z.object({
  defaultPlatform: z.union(['taobao', 'hema', 'meituan', 'jd']).default('taobao')
    .description({ zh: '默认外卖平台', en: 'Default takeaway platform' }),
  autoClaimCoupons: z.boolean().default(true)
    .description({ zh: '自动领取免费优惠券', en: 'Automatically claim free coupons' }),
  autoUseCoupons: z.boolean().default(true)
    .description({ zh: '自动使用可用优惠券', en: 'Automatically use eligible coupons' }),
  couponClaimLimit: z.number().step(1).min(1).max(50).default(10)
    .description({ zh: '单次最多领取优惠券数量', en: 'Maximum coupon claims per call' }),
  dryRun: z.boolean().default(true)
    .description({ zh: '预览模式（不提交订单、不支付）', en: 'Preview only; no checkout or payment' }),
  browserChannel: z.union(['chromium', 'chrome', 'msedge']).default('chrome')
    .description({ zh: '旧浏览器字段（已停用）', en: 'Legacy browser field (inactive)' }),
  // Foundations.
  deliveryAddress: z.string().default('')
    .description({ zh: '旧地址备注（不参与接口点餐）', en: 'Legacy address note (inactive)' }),
  headless: z.boolean().default(false)
    .description({ zh: '旧无头模式字段（已停用）', en: 'Legacy headless field (inactive)' }),
  persistLogin: z.boolean().default(true)
    .description({ zh: '登录状态持久化', en: 'Persist login' }),
  maxAccountsPerPlatform: z.number().step(1).min(1).max(100).default(10)
    .description({ zh: '每个平台的账号数量上限', en: 'Account limit per platform' }),
  loginTimeoutMs: z.number().min(1000).max(120000).default(20000)
    .description({ zh: '登录接口超时（毫秒）', en: 'Login request timeout (ms)' }),
  smsResendSeconds: z.number().min(60).max(600).default(60)
    .description({ zh: '验证码重发间隔（秒）', en: 'SMS resend interval (seconds)' }),
  qrLifetimeSeconds: z.number().step(1).min(60).max(600).default(180)
    .description({ zh: '扫码等待上限（秒）', en: 'QR attempt lifetime (seconds)' }),
  qrPollSeconds: z.number().step(1).min(2).max(15).default(2)
    .description({ zh: '扫码检查间隔（秒）', en: 'QR polling interval (seconds)' }),
  qrAuthorizationSeconds: z.number().step(1).min(15).max(300).default(60)
    .description({ zh: '扫码确认后自动复核上限（秒）', en: 'Automatic verification timeout after scan confirmation (seconds)' }),
  loginDiagnostics: z.boolean().default(true)
    .description({ zh: '记录扫码登录阶段（不含凭据和个人资料）', en: 'Log QR sign-in stages without credentials or personal data' }),
  historyPageSize: z.number().step(1).min(1).max(20).default(10)
    .description({ zh: '历史订单每页条数', en: 'Orders per history page' }),
  hemaProductPageSize: z.number().step(1).min(1).max(50).default(30)
    .description({ zh: '盒马商品每页数量', en: 'Hema products per page' }),
  browsePageSize: z.number().step(1).min(1).max(20).default(10)
    .description({ zh: '附近店铺每页数量', en: 'Nearby shops per page' }),
  hideSponsoredShops: z.boolean().default(true)
    .description({ zh: '隐藏推广店铺', en: 'Hide sponsored shops' }),
  checkoutQuoteSeconds: z.number().step(1).min(30).max(300).default(120)
    .description({ zh: '结算报价有效期（秒）', en: 'Checkout quote validity (seconds)' }),

  // Money and payment.
  maxOrderAmount: z.number().step(1).min(1).default(35)
    .description({ zh: '单笔订单上限（元）', en: 'Max order amount' }),
  dailyBudget: z.number().step(1).min(0).default(0)
    .description({ zh: '每日累计上限（元），0 表示不限制', en: 'Daily budget' }),
  paymentMode: z.union(['auto', 'manual']).default('manual')
    .description({ zh: '支付模式：auto 自动支付 / manual 仅提交', en: 'Payment mode' }),
  merchantWhitelist: z.array(z.string()).default([])
    .description({ zh: '商家白名单（留空不限制）', en: 'Merchant whitelist' }),
  operationLog: z.boolean().default(true)
    .description({ zh: '记录支付操作日志', en: 'Operation log' }),

  // Automation tasks.
  autoTasks: z.array(AutoTask).default([])
    .description({ zh: '外卖自动化任务', en: 'Auto order tasks' }),
}).volatile()

/** Plugin name used by loader diagnostics. */
export const name = 'dsh-waimai'

/** Services required by this plugin. */
export const inject = ['tools', 'skills', 'timer']

/**
 * Mount the takeaway plugin.
 *
 * @param ctx - plugin context carrying the tool, skill, and timer services.
 * @param configRef - live reference to the resolved plugin configuration.
 */
export function apply(ctx, configRef) {
  let config = configRef.get()
  validateTasks(config.autoTasks)
  const logger = ctx.logger
  registerLoginDiagnosticOutput(ctx)
  const statePath = join(stateDir(), 'automation-state.json')
  const notifyLog = join(stateDir(), 'notifications.jsonl')
  const bridge = new WaimaiMcpBridge({ ctx, logger, serverName: 'waimai' })
  registerLoginRpc(ctx, bridge)

  ctx.effect(() => ctx.tools.register({
    name: 'mcp__waimai__preview_task',
    description: '预览任务的触发规则、下次菜单和金额上限。不打开浏览器、不下单、不修改轮换或执行状态。',
    parameters: { type: 'object', properties: { taskId: { type: 'string' } },
      required: ['taskId'], additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute({ taskId }) {
      const task = config.autoTasks.find(candidate => candidate.id === taskId)
      if (task === undefined) throw new Error(`未找到外卖任务 ${taskId}`)
      return previewTask(config, task, await readState(statePath))
    },
  }), 'waimai: task preview')

  ctx.effect(() => {
    void bridge.start(childEnv(config))
    return async () => { await bridge.stop() }
  }, 'waimai: mcp bridge')

  ctx.effect(
    () => ctx.skills.registerProvider(() => createSkillProvider(SKILLS_DIR)),
    'waimai: packaged skills',
  )

  /**
   * Record one notification for the user.
   *
   * @param message - user-facing summary.
   * @param detail - structured fields attached to the record.
   * @returns settlement after the write attempt.
   */
  const notify = async (message, detail = {}) => {
    const line = `${JSON.stringify({ at: new Date().toISOString(), message, ...detail })}\n`
    logger.info(`waimai: ${message}`)
    try {
      await mkdir(stateDir(), { recursive: true })
      await appendFile(notifyLog, line, 'utf8')
    } catch {
      // A notification that cannot be persisted must not fail the order flow.
    }
  }

  /**
   * Preview one task or report unavailable purchasing APIs.
   *
   * @param task - the due task configuration.
   * @param state - mutable automation state.
   * @param now - the instant the task became due.
   * @returns settlement after the attempt, successful or not.
   */
  const runTask = async (task, state, now, config) => {
    if (config.dryRun !== false) {
      const preview = previewTask(config, task, state, now)
      if (task.notifyOnSuccess) await notify(`[${task.name}] 预览：${preview.entry.shop} ${preview.entry.dish}，未下单`, { taskId: task.id })
      return
    }
    if (task.notifyOnFailure) await notify(`[${task.name}] 平台 ${task.platformId} 的结算和创建订单接口尚未验证，任务已停止；未下单、未扣款`, { taskId: task.id, platformId: task.platformId, code: 'ordering-unverified' })
  }

  /** Whether a tick is currently running; state writes and notifications can outlast the poll period. */
  let ticking = false
  let pendingConfig = false
  ctx.on('app-boot/config-reload', async () => {
    const next = configRef.get()
    if (next === config) return
    validateTasks(next.autoTasks)
    config = next
    if (ticking) pendingConfig = true
    else await bridge.restart(childEnv(config))
  })

  /** One poll tick: evaluate every enabled task against the current clock. */
  const tick = async () => {
    if (ticking) return
    ticking = true
    try {
      const current = config
      const tasks = current.autoTasks
      validateTasks(tasks)
      if (tasks.length === 0) return
      const now = new Date()
      const state = await readState(statePath)
      let changed = false
      for (const task of tasks) {
        if (task.enabled !== true || task.id.length === 0) continue
        if (!isTaskDue(task, now, state.lastRun?.[task.id])) continue
        // Claim the slot before the first await so a later tick cannot re-enter
        // even if this one fails midway.
        state.lastRun = { ...state.lastRun, [task.id]: `${task.id}:${toDateKey(now)}` }
        await writeState(statePath, state)
        changed = true
        await runTask(task, state, now, current)
        await writeState(statePath, state)
      }
      if (changed) await writeState(statePath, state)
    } catch (error) {
      logger.warn(`waimai: automation tick failed: ${String(error)}`)
    } finally {
      ticking = false
      if (pendingConfig) {
        pendingConfig = false
        await bridge.restart(childEnv(config))
      }
    }
  }

  ctx.effect(() => {
    const tasks = Array.isArray(config.autoTasks) ? config.autoTasks : []
    const enabled = tasks.filter(task => task.enabled === true && task.id.length > 0)
    for (const task of enabled) {
      logger.info(
        `waimai: task「${task.name}」scheduled ${buildCron(task.triggerTime, task.dateRule, task.customDays)}`,
      )
    }
    return ctx.timer.interval(() => tick(), POLL_INTERVAL_MS)
  }, 'waimai: automation poll')
}
