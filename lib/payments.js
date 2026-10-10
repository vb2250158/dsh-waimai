/** Durable reservations for payment attempts, including unconfirmed charges. */
import { readFile } from 'node:fs/promises'
import { toDateKey, writeJsonState } from './automation.js'

/** Read the payment ledger; invalid data stops payment instead of resetting totals.
 * @param path - ledger path.
 * @returns ledger with an orders map.
 */
export async function readPayments(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    if (!value || !value.orders || typeof value.orders !== 'object' || Array.isArray(value.orders)) {
      throw new Error('支付记录无效，请先核对记录')
    }
    for (const order of Object.values(value.orders)) {
      if (!Number.isFinite(order.amount) || order.amount <= 0 || typeof order.day !== 'string'
        || typeof order.taskId !== 'string') throw new Error('支付记录金额或身份无效')
    }
    return value
  } catch (error) {
    if (error.code === 'ENOENT') return { orders: {} }
    throw error
  }
}

/** Reserve the observed amount before a payment click; unknown outcomes stay reserved.
 * @param path - ledger path.
 * @param order - observed order id, amount and merchant.
 * @param limits - global/task budgets, task id and per-order cap.
 * @param now - local payment date.
 * @returns ledger containing the committed reservation.
 * @throws for duplicates, invalid page values or exhausted budgets.
 */
export async function reservePayment(path, order, limits, now = new Date()) {
  if (!order.id?.trim()) throw new Error('无法读取稳定订单编号，已拒绝自动支付')
  if (!Number.isFinite(order.amount) || order.amount <= 0 || order.amount > limits.cap) {
    throw new Error('页面金额无效或超过单笔上限')
  }
  if (!order.merchant?.trim()) throw new Error('无法读取商家名，已拒绝自动支付')
  if (limits.whitelist.length && !limits.whitelist.includes(order.merchant.trim())) {
    throw new Error('商家不在白名单内')
  }
  const ledger = await readPayments(path)
  if (ledger.orders[order.id]) throw new Error('该订单已有支付尝试，请先核对结果；不会重复支付')
  const day = toDateKey(now)
  const today = Object.values(ledger.orders).filter(item => item.day === day)
  const spent = today.reduce((sum, item) => sum + item.amount, 0)
  const taskSpent = today.filter(item => item.taskId === limits.taskId).reduce((sum, item) => sum + item.amount, 0)
  if (limits.globalBudget > 0 && spent + order.amount > limits.globalBudget) throw new Error('超过全局每日累计上限')
  if (limits.taskBudget > 0 && taskSpent + order.amount > limits.taskBudget) throw new Error('超过任务每日累计上限')
  ledger.orders[order.id] = { ...order, day, taskId: limits.taskId, status: 'pending' }
  await writeJsonState(path, ledger)
  return ledger
}
