import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyState, previewTask, validateTasks, readState, writeState } from '../lib/automation.js'
import { reservePayment, readPayments } from '../lib/payments.js'
import { WaimaiMcpBridge } from '../lib/mcp-bridge.js'
import { LOGIN_TOOLS } from '../lib/login.js'

const task = { id: 'demo-lunch', name: '午餐示例', enabled: false, triggerTime: '11:00',
  dateRule: 'workday', customDays: [], skipDates: [], menuPool: ['示例店 | 示例饭 | 28'],
  menuStrategy: 'rotate', maxOrderAmount: 35, dailyBudget: 50, paymentMode: 'manual' }

test('preview returns the selected dish without changing rotation or deduplication', () => {
  const state = emptyState()
  const before = JSON.stringify(state)
  const result = previewTask({ maxOrderAmount: 35, dryRun: true }, task, state, new Date(2026, 9, 12, 11))
  assert.equal(result.entry.dish, '示例饭')
  assert.equal(result.due, false)
  assert.equal(result.withinCap, true)
  assert.equal(JSON.stringify(state), before)
})

test('enabled schedules reject missing identities, invalid times and duplicate IDs', () => {
  assert.throws(() => validateTasks([{ ...task, enabled: true, id: '' }]), /ID/)
  assert.throws(() => validateTasks([{ ...task, enabled: true, triggerTime: '25:00' }]), /HH:mm/)
  assert.throws(() => validateTasks([task, task]), /重复/)
  assert.throws(() => validateTasks([{ ...task, enabled: true, menuPool: [] }]), /菜单/)
})

test('saved claims survive reload and damaged state stops execution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'waimai-state-'))
  try {
    const path = join(dir, 'state.json')
    const state = emptyState()
    state.lastRun[task.id] = `${task.id}:2026-10-12`
    await writeState(path, state)
    assert.equal(JSON.stringify(await readState(path)), JSON.stringify(state))
    await writeFile(path, '{bad-json')
    await assert.rejects(readState(path), SyntaxError)
    assert.equal(await readFile(path, 'utf8'), '{bad-json')
    await writeFile(path, JSON.stringify({ ...state, lastRun: [] }))
    await assert.rejects(readState(path), /lastRun/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('payment reservations enforce cumulative budgets and survive an uncertain result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'waimai-payment-'))
  try {
    const path = join(dir, 'payments.json')
    const limits = { cap: 35, globalBudget: 50, taskBudget: 50, taskId: task.id, whitelist: ['示例店'] }
    const now = new Date(2026, 9, 12)
    const order = { id: 'synthetic-order-1', merchant: '示例店', amount: 28 }
    await reservePayment(path, order, limits, now)
    await assert.rejects(reservePayment(path, order, limits, now), /不会重复支付/)
    await assert.rejects(reservePayment(path, { ...order, id: 'synthetic-order-2' }, limits, now), /全局每日/)
    await assert.rejects(reservePayment(path, { ...order, id: 'task-over-budget' }, { ...limits, globalBudget: 100 }, now), /任务每日/)
    await reservePayment(path, { ...order, id: 'different-task' }, { ...limits, globalBudget: 100, taskId: 'other-task' }, now)
    await assert.rejects(reservePayment(path, { ...order, id: 'synthetic-order-3', merchant: '伪造示例店' }, limits, now), /白名单/)
    await assert.rejects(reservePayment(path, { ...order, id: '' }, limits, now), /订单编号/)
    assert.equal((await readPayments(path)).orders[order.id].status, 'pending')
    await reservePayment(path, { ...order, id: 'next-day-order' }, limits, new Date(2026, 9, 13))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a preview tick persists its claim before notification and does not run twice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'waimai-host-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const disposers = []
  const { apply, Config } = await import('../lib/index.js')
  const now = new Date()
  const triggerTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  let callback
  let previews = 0
  const ctx = {
    inject() {},
    on() {},
    logger: { exporter() { return () => {} }, warn() {}, info(message) { if (message.includes('未下单')) previews++ } },
    effect(create) { disposers.push(create()) },
    tools: { register() { return () => {} } },
    skills: { registerProvider() { return () => {} } },
    timer: { interval(fn) { callback = fn; return () => {} } },
  }
  try {
    apply(ctx, Config({ dryRun: true, headless: true, maxOrderAmount: 35, dailyBudget: 50,
      paymentMode: 'manual', merchantWhitelist: [],
      autoTasks: [{ ...task, enabled: true, triggerTime, dateRule: 'everyday', notifyOnSuccess: true }] }))
    await callback()
    const saved = await readState(join(dir, 'waimai', 'automation-state.json'))
    assert.equal(typeof saved.lastRun[task.id], 'string')
    assert.deepEqual(saved.rotateIndex, {})
    await callback()
    assert.equal(previews, 1)
  } finally {
    for (const dispose of disposers.reverse()) await dispose?.()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(dir, { recursive: true, force: true })
  }
})

test('the Host bridge executes advertised MCP tools and unregisters them on stop', async () => {
  const registered = new Map()
  const logger = { info() {}, warn() {} }
  const bridge = new WaimaiMcpBridge({ logger, ctx: { tools: { register(definition) {
    registered.set(definition.name, definition)
    return () => registered.delete(definition.name)
  } } } })
  try {
    await bridge.start({ DRY_RUN: 'true' })
    assert.equal(bridge.connected, true)
    const direct = await bridge.call('get_status', {})
    assert.equal(direct.success, true)
    assert.equal(direct.data.dryRun, true)
    const tool = registered.get('mcp__waimai__get_status')
    for (const name of LOGIN_TOOLS) assert.equal(registered.has(`mcp__waimai__${name}`), false)
    const result = await tool.execute({}, { signal: new AbortController().signal })
    assert.equal(JSON.parse(result.content[0].text).success, true)
    const restart = bridge.restart({ DRY_RUN: 'false' })
    const afterSave = await bridge.call('get_status', {})
    await restart
    assert.equal(afterSave.data.dryRun, false)
  } finally { await bridge.stop() }
  assert.equal(registered.size, 0)
})
