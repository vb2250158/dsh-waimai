/**
 * Host half of the dsh-waimai plugin.
 *
 * Owns three things:
 *
 * 1. The takeaway MCP bridge, spawned from this package and published as
 *    `mcp__waimai__*` tools.
 * 2. A skill provider over this package's `skills/` directory, so the
 *    interactive ordering and automation skills are discoverable.
 * 3. The automation poll that turns each configured task into a real order.
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
import { stateDir } from './paths.js'
import { childEnv } from './env.js'
import { createSkillProvider } from './skill-provider.js'
import {
  buildCron,
  isTaskDue,
  menuKey,
  parseMenuPool,
  pickMenuEntry,
  readState,
  recordSpend,
  spentOn,
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
  autoClaimCoupons: z.boolean().default(true)
    .description({ zh: '自动领取免费优惠券', en: 'Automatically claim free coupons' }),
  autoUseCoupons: z.boolean().default(true)
    .description({ zh: '自动使用可用优惠券', en: 'Automatically use eligible coupons' }),
  couponClaimLimit: z.number().step(1).min(1).max(50).default(10)
    .description({ zh: '单次最多领取优惠券数量', en: 'Maximum coupon claims per call' }),
  dryRun: z.boolean().default(true)
    .description({ zh: '预览模式（不提交订单、不支付）', en: 'Preview only; no checkout or payment' }),
  browserChannel: z.union(['chromium', 'chrome', 'msedge']).default('chrome')
    .description({ zh: '使用的浏览器', en: 'Browser channel' }),
  // Foundations.
  deliveryAddress: z.string().default('')
    .description({ zh: '默认配送地址', en: 'Delivery address' }),
  headless: z.boolean().default(false)
    .description({ zh: '无头模式（登录和支付需要可见窗口）', en: 'Headless' }),
  persistLogin: z.boolean().default(true)
    .description({ zh: '登录状态持久化', en: 'Persist login' }),

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
  const statePath = join(stateDir(), 'automation-state.json')
  const notifyLog = join(stateDir(), 'notifications.jsonl')
  const bridge = new WaimaiMcpBridge({ ctx, logger, serverName: 'waimai' })

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
   * Run one task's scripted order through the MCP tools.
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
    const entries = parseMenuPool(task.menuPool)
    if (entries.length === 0) {
      if (task.notifyOnFailure) await notify(`[${task.name}] 菜单池为空，已跳过`, { taskId: task.id })
      return
    }
    const today = toDateKey(now)
    const spent = spentOn(state, today)
    const entry = pickMenuEntry(entries, task.menuStrategy, {
      lastIndex: Number.isFinite(state.rotateIndex?.[task.id]) ? state.rotateIndex[task.id] : -1,
      history: Array.isArray(state.history?.[task.id]) ? state.history[task.id] : [],
    })
    const cap = Number(childEnv(config, task).MAX_ORDER_AMOUNT)
    if (config.autoUseCoupons === false && entry.price > cap) {
      if (task.notifyOnFailure) {
        await notify(`[${task.name}] ${entry.dish} 价格 ${entry.price} 元超过单笔上限 ${cap} 元，已跳过`, {
          taskId: task.id, price: entry.price, cap,
        })
      }
      return
    }
    if (config.autoUseCoupons === false && spent + entry.price > task.dailyBudget) {
      if (task.notifyOnFailure) {
        await notify(
          `[${task.name}] 今日已消费 ${spent} 元，再加 ${entry.price} 元超过每日上限 ${task.dailyBudget} 元，已跳过`,
          { taskId: task.id, spent, price: entry.price, dailyBudget: task.dailyBudget },
        )
      }
      return
    }

    // The child process carries this task's limits, so its payment check
    // enforces the per-task cap rather than the plugin-wide one.
    await bridge.restart(childEnv(config, task))
    const steps = [
      ['open_browser', {}],
      ['search_food', { keyword: entry.shop }],
      ['enter_shop', { shopName: entry.shop }],
      ['claim_coupons', {}],
      ['get_menu', {}],
      ['add_to_cart', { itemName: entry.dish }],
      ['view_cart', {}],
    ]
    for (const [tool, args] of steps) {
      const result = await bridge.call(tool, args)
        .catch(error => ({ success: false, error: String(error) }))
      if (result?.success !== true) {
        if (task.notifyOnFailure) {
          await notify(`[${task.name}] 步骤 ${tool} 失败：${result?.error ?? '未知错误'}`, {
            taskId: task.id, tool,
          })
        }
        return
      }
    }
    const submitted = await bridge.call('submit_order', { maxAmount: cap })
      .catch(error => ({ success: false, error: String(error) }))
    if (submitted?.success !== true) {
      if (task.notifyOnFailure) {
        await notify(`[${task.name}] 提交订单失败：${submitted?.error ?? '未知错误'}`, { taskId: task.id })
      }
      return
    }

    const total = Number(submitted.data?.totalAmount)
    if (!Number.isFinite(total) || total <= 0 || total > cap || spent + total > task.dailyBudget) {
      if (task.notifyOnFailure) await notify(`[${task.name}] 用券后实付金额无法确认或超过预算，已停止`, { taskId: task.id })
      return
    }
    const amount = total
    let paid = false
    if ((task.paymentMode ?? config.paymentMode) === 'auto') {
      const payment = await bridge.call('request_payment', {})
        .catch(error => ({ success: false, error: String(error) }))
      paid = payment?.success === true && payment.data?.status === 'paid'
      if (!paid && task.notifyOnFailure) {
        await notify(`[${task.name}] 已提交订单但未确认支付，请在浏览器中手动完成`, {
          taskId: task.id, amount, detail: payment?.error ?? payment?.data?.note ?? '',
        })
      }
    } else if (task.notifyOnFailure) {
      await notify(`[${task.name}] 已提交订单（手动支付模式），请在浏览器中完成支付`, {
        taskId: task.id, amount,
      })
    }

    state.rotateIndex = { ...state.rotateIndex, [task.id]: entries.indexOf(entry) }
    state.history = {
      ...state.history,
      [task.id]: [menuKey(entry), ...(state.history?.[task.id] ?? []).filter(key => key !== menuKey(entry))]
        .slice(0, 30),
    }
    if (paid) recordSpend(state, today, amount)

    if (paid && task.notifyOnSuccess) {
      await notify(`[${task.name}] 已自动下单并支付 ${amount} 元：${entry.shop} ${entry.dish}`, {
        taskId: task.id, amount,
      })
    }
  }

  /** Whether a tick is currently running; the browser steps outlast the poll period. */
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
        try {
          await runTask(task, state, now, current)
        } finally {
          if (config.dryRun === false) await bridge.restart(childEnv(config))
        }
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
