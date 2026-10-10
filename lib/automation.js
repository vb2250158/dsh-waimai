/**
 * Pure scheduling and menu-selection logic for takeaway automation tasks.
 *
 * The harness timer service exposes only `timeout`, `interval`, `throttle`,
 * and `debounce` — there is no `cron()` entry point — so a task's wall-clock
 * rule is matched by a once-a-minute poll rather than by registering a cron
 * job. `buildCron` still exists because it renders the same rule into the
 * five-field form a person can read in a summary or a log line.
 *
 * Everything in this module is a pure function of its arguments, which is what
 * makes the rules testable without a browser, a timer, or a running harness.
 *
 * @module dsh-waimai/automation
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Weekday token to the Cron/Vixie day-of-week number (Sunday is 0). */
export const DAY_MAP = Object.freeze({
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
})

/** Weekday token to JavaScript's `Date.getDay()` number (Sunday is 0). */
const JS_DAY_BY_TOKEN = Object.freeze({
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
})

const WORKDAY_TOKENS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri'])
const WEEKEND_TOKENS = Object.freeze(['sat', 'sun'])

/**
 * Render a task's wall-clock rule as a five-field cron expression.
 *
 * @param time - `HH:mm` local trigger time.
 * @param rule - one of `workday`, `weekend`, `everyday`, `custom`.
 * @param customDays - weekday tokens used when `rule` is `custom`.
 * @returns the canonical `minute hour day-of-month month day-of-week` expression.
 */
export function buildCron(time, rule, customDays = []) {
  const [hour, minute] = parseTime(time)
  let dayPart
  switch (rule) {
    case 'weekend':
      dayPart = '0,6'
      break
    case 'everyday':
      dayPart = '*'
      break
    case 'custom': {
      const days = customDays
        .map(token => DAY_MAP[String(token).toLowerCase()])
        .filter(day => day !== undefined)
      dayPart = days.length > 0 ? [...new Set(days)].sort((a, b) => a - b).join(',') : '1-5'
      break
    }
    case 'workday':
    default:
      dayPart = '1-5'
      break
  }
  return `${minute} ${hour} * * ${dayPart}`
}

/**
 * Parse an `HH:mm` string into a numeric hour and minute.
 *
 * @param time - candidate time string.
 * @returns `[hour, minute]`, falling back to `[11, 0]` for unusable input.
 */
export function parseTime(time) {
  if (typeof time !== 'string') return [11, 0]
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (match === null) return [11, 0]
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return [11, 0]
  return [hour, minute]
}

/**
 * Format a date as a local `YYYY-MM-DD` key.
 *
 * @param date - date to format.
 * @returns the local-date key used by skip lists and once-a-day deduplication.
 */
export function toDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Whether a date appears in the task's extra skip list.
 *
 * @param date - date to test.
 * @param skipDates - `YYYY-MM-DD` entries.
 * @returns whether the date must be skipped.
 */
export function isSkipDate(date, skipDates = []) {
  return skipDates.includes(toDateKey(date))
}

/**
 * Whether the task's date rule admits this date.
 *
 * @param date - date to test.
 * @param rule - one of `workday`, `weekend`, `everyday`, `custom`.
 * @param customDays - weekday tokens used when `rule` is `custom`.
 * @returns whether an order may run on this date.
 */
export function matchesDateRule(date, rule, customDays = []) {
  const day = date.getDay()
  switch (rule) {
    case 'weekend':
      return day === 0 || day === 6
    case 'everyday':
      return true
    case 'custom': {
      const allowed = customDays
        .map(token => JS_DAY_BY_TOKEN[String(token).toLowerCase()])
        .filter(value => value !== undefined)
      if (allowed.length === 0) return WORKDAY_TOKENS.includes(toJsDayName(day))
      return allowed.includes(day)
    }
    case 'workday':
    default:
      return day >= 1 && day <= 5
  }
}

/**
 * Map `Date.getDay()` back to a weekday token.
 *
 * @param day - JavaScript weekday number.
 * @returns the matching token.
 */
function toJsDayName(day) {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day] ?? 'mon'
}

/**
 * Parse the menu pool text into usable entries.
 *
 * Each line is `店铺 | 菜品 | 价格`; a line missing a part, or carrying a
 * non-numeric price, is dropped rather than guessed at.
 *
 * @param menuPool - raw menu lines.
 * @returns parsed entries in declaration order.
 */
export function parseMenuPool(menuPool = []) {
  const entries = []
  for (const line of menuPool) {
    if (typeof line !== 'string') continue
    const [shop, dish, price] = line.split('|').map(part => part.trim())
    if (!shop || !dish) continue
    const amount = Number(price)
    if (!Number.isFinite(amount) || amount < 0) continue
    entries.push({ shop, dish, price: amount })
  }
  return entries
}

/**
 * Choose today's entry from the parsed menu pool.
 *
 * @param entries - parsed menu entries; the caller drops an empty pool first.
 * @param strategy - `rotate`, `random`, or `history`.
 * @param options - rotation state and per-dish history for this task.
 * @returns the chosen entry.
 */
export function pickMenuEntry(entries, strategy, options = {}) {
  const { lastIndex = -1, history = [] } = options
  if (strategy === 'random') {
    return entries[Math.floor(Math.random() * entries.length)]
  }
  if (strategy === 'history') {
    // Prefer the least recently ordered entry, so history steers toward
    // variety instead of repeating whatever ranked highest once.
    const rank = new Map()
    history.forEach((key, position) => rank.set(key, position))
    const ordered = [...entries].sort((left, right) => {
      const leftSeen = rank.get(menuKey(left))
      const rightSeen = rank.get(menuKey(right))
      if (leftSeen === undefined && rightSeen === undefined) return 0
      if (leftSeen === undefined) return -1
      if (rightSeen === undefined) return 1
      return leftSeen - rightSeen
    })
    return ordered[0]
  }
  return entries[(lastIndex + 1) % entries.length]
}

/**
 * Stable identity of one menu entry for history tracking.
 *
 * @param entry - parsed menu entry.
 * @returns the `shop|dish` key.
 */
export function menuKey(entry) {
  return `${entry.shop}|${entry.dish}`
}

/**
 * Decide whether a task is due at this instant.
 *
 * The poll runs once a minute, so a task fires during its trigger minute and
 * the day key makes the second poll of that minute a no-op.
 *
 * @param task - task configuration with `triggerTime`, `dateRule`, `customDays`, `skipDates`.
 * @param now - the current local time.
 * @param alreadyRanKey - the `taskId:date` key recorded for the last run.
 * @returns whether the task should run now.
 */
export function isTaskDue(task, now, alreadyRanKey) {
  const [hour, minute] = parseTime(task.triggerTime)
  if (now.getHours() !== hour || now.getMinutes() !== minute) return false
  const runKey = `${task.id}:${toDateKey(now)}`
  if (alreadyRanKey === runKey) return false
  if (isSkipDate(now, task.skipDates ?? [])) return false
  return matchesDateRule(now, task.dateRule, task.customDays ?? [])
}

/**
 * Read the persisted automation state.
 *
 * @param path - state file path.
 * @returns the decoded state, or empty state when the file is absent or unreadable.
 */
export async function readState(path) {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return emptyState()
    return {
      lastRun: isRecord(parsed.lastRun) ? parsed.lastRun : {},
      rotateIndex: isRecord(parsed.rotateIndex) ? parsed.rotateIndex : {},
      history: isRecord(parsed.history) ? parsed.history : {},
      lastPaymentDay: typeof parsed.lastPaymentDay === 'string' ? parsed.lastPaymentDay : undefined,
      spentByDay: isRecord(parsed.spentByDay) ? parsed.spentByDay : {},
    }
  } catch {
    // A first run, or a corrupt file, both start from empty state; the next
    // write replaces it, so no recovery path is needed.
    return emptyState()
  }
}

/**
 * Persist the automation state.
 *
 * @param path - state file path.
 * @param state - state object to write.
 * @returns settlement after the write attempt.
 */
export async function writeState(path, state) {
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    // Losing the cache costs at most one repeated rotation step.
  }
}

/**
 * Build an empty automation state.
 *
 * @returns the initial state value.
 */
export function emptyState() {
  return { lastRun: {}, rotateIndex: {}, history: {}, spentByDay: {} }
}

/**
 * Narrow an unknown value to a string-keyed record.
 *
 * @param value - candidate value.
 * @returns whether the value is a plain object.
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Sum the amounts already recorded for one local date.
 *
 * @param state - automation state.
 * @param dateKey - `YYYY-MM-DD` key.
 * @returns the recorded spend in yuan.
 */
export function spentOn(state, dateKey) {
  const value = state.spentByDay?.[dateKey]
  return Number.isFinite(value) ? value : 0
}

/**
 * Record one completed payment against the running daily total.
 *
 * @param state - automation state, mutated in place.
 * @param dateKey - `YYYY-MM-DD` key.
 * @param amount - amount paid in yuan.
 * @returns the updated state.
 */
export function recordSpend(state, dateKey, amount) {
  const current = spentOn(state, dateKey)
  state.spentByDay = { ...state.spentByDay, [dateKey]: current + amount }
  return state
}
