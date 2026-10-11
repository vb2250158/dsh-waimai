/**
 * Child-process environment for the takeaway MCP server.
 *
 * These values are the safety limits the server re-checks at payment time, so
 * building them is a pure function of the configuration rather than something
 * assembled inline at the spawn site: the same function is used for the
 * interactive bridge and for each automation task's bridge, and both are
 * covered by tests.
 *
 * @module dsh-waimai/env
 */

/**
 * Narrow the effective per-order cap.
 *
 * A task may lower the plugin-wide cap but never raise it.
 *
 * @param config - plugin configuration.
 * @param task - automation task, omitted for interactive ordering.
 * @returns the effective cap in yuan.
 */
export function effectiveCap(config, task) {
  const global = Number.isFinite(config.maxOrderAmount) ? config.maxOrderAmount : 0
  if (task === undefined) return global
  const local = Number.isFinite(task.maxOrderAmount) ? task.maxOrderAmount : global
  return Math.min(local, global)
}

/**
 * Narrow the effective daily budget.
 *
 * A plugin-wide budget of 0 means "no global limit", so the task's own budget
 * stands alone there; otherwise the tighter of the two applies.
 *
 * @param config - plugin configuration.
 * @param task - automation task, omitted for interactive ordering.
 * @returns the effective daily budget in yuan, 0 meaning unlimited.
 */
export function effectiveDailyBudget(config, task) {
  const global = Number.isFinite(config.dailyBudget) ? config.dailyBudget : 0
  if (task === undefined) return global
  const local = Number.isFinite(task.dailyBudget) ? task.dailyBudget : 0
  if (global <= 0) return local
  if (local <= 0) return global
  return Math.min(local, global)
}

/**
 * Choose the merchant whitelist for one bridge generation.
 *
 * A task-level whitelist replaces the plugin-wide one rather than adding to
 * it, so a restrictive global list is never silently widened by a task.
 * Only a non-empty task list wins; an empty one falls back to the global list.
 *
 * @param config - plugin configuration.
 * @param task - automation task, omitted for interactive ordering.
 * @returns the merchant names that may be paid automatically.
 */
export function effectiveWhitelist(config, task) {
  if (task?.merchantWhitelist !== undefined && task.merchantWhitelist.length > 0) {
    return task.merchantWhitelist
  }
  return config.merchantWhitelist ?? []
}

/**
 * Build the environment entries the takeaway server validates payments against.
 *
 * @param config - plugin configuration.
 * @param task - automation task, omitted for interactive ordering.
 * @returns the string-valued environment entries.
 */
export function childEnv(config, task) {
  return {
    AUTO_CLAIM_COUPONS: String(config.autoClaimCoupons !== false),
    AUTO_USE_COUPONS: String(config.autoUseCoupons !== false),
    COUPON_CLAIM_LIMIT: String(config.couponClaimLimit ?? 10),
    DRY_RUN: String(config.dryRun !== false),
    BROWSER_CHANNEL: config.browserChannel ?? 'chrome',
    TASK_ID: task?.id ?? '',
    GLOBAL_DAILY_BUDGET: String(config.dailyBudget ?? 0),
    TASK_DAILY_BUDGET: String(task?.dailyBudget ?? 0),
    HEADLESS: String(config.headless === true),
    PERSIST_LOGIN: String(config.persistLogin !== false),
    LOGIN_TIMEOUT_MS: String(config.loginTimeoutMs ?? 20000),
    SMS_RESEND_SECONDS: String(config.smsResendSeconds ?? 60),
    HISTORY_PAGE_SIZE: String(config.historyPageSize ?? 10),
    MAX_ORDER_AMOUNT: String(effectiveCap(config, task)),
    DAILY_BUDGET: String(effectiveDailyBudget(config, task)),
    PAYMENT_MODE: task?.paymentMode ?? config.paymentMode ?? 'manual',
    MERCHANT_WHITELIST: JSON.stringify(effectiveWhitelist(config, task)),
  }
}
