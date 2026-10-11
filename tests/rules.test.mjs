/**
 * Rule tests for the takeaway plugin: cron rendering, date rules, menu-pool
 * parsing, rotation, and the safety-limit narrowing.
 *
 * These cover the acceptance criteria that decide whether an order is allowed
 * at all, so they run without a browser, a timer, or a running harness.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildCron,
  isSkipDate,
  isTaskDue,
  matchesDateRule,
  menuKey,
  parseMenuPool,
  parseTime,
  pickMenuEntry,
  recordSpend,
  spentOn,
  toDateKey,
} from '../lib/automation.js'
import { childEnv, effectiveCap, effectiveDailyBudget, effectiveWhitelist } from '../lib/env.js'
import { createSkillProvider, parseSkillFile } from '../lib/skill-provider.js'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('buildCron renders each date rule into five fields', () => {
  assert.equal(buildCron('11:00', 'workday'), '0 11 * * 1-5')
  assert.equal(buildCron('17:30', 'weekend'), '30 17 * * 0,6')
  assert.equal(buildCron('15:00', 'everyday'), '0 15 * * *')
  assert.equal(buildCron('22:15', 'custom', ['fri', 'mon', 'wed']), '15 22 * * 1,3,5')
})

test('buildCron falls back to workdays for unusable input', () => {
  assert.equal(buildCron('not-a-time', 'workday'), '0 11 * * 1-5')
  assert.equal(buildCron('25:00', 'workday'), '0 11 * * 1-5')
  assert.equal(buildCron('09:05', 'custom', []), '5 9 * * 1-5')
})

test('parseTime accepts only HH:mm inside the clock', () => {
  assert.deepEqual(parseTime('00:00'), [0, 0])
  assert.deepEqual(parseTime('23:59'), [23, 59])
  assert.deepEqual(parseTime('7:05'), [7, 5])
  assert.deepEqual(parseTime('24:00'), [11, 0])
  assert.deepEqual(parseTime(undefined), [11, 0])
})

test('date rules match the intended weekdays', () => {
  const monday = new Date(2026, 9, 12)
  const saturday = new Date(2026, 9, 17)
  assert.equal(monday.getDay(), 1)
  assert.equal(saturday.getDay(), 6)

  assert.equal(matchesDateRule(monday, 'workday'), true)
  assert.equal(matchesDateRule(saturday, 'workday'), false)
  assert.equal(matchesDateRule(saturday, 'weekend'), true)
  assert.equal(matchesDateRule(monday, 'weekend'), false)
  assert.equal(matchesDateRule(saturday, 'everyday'), true)
  assert.equal(matchesDateRule(saturday, 'custom', ['sat']), true)
  assert.equal(matchesDateRule(monday, 'custom', ['sat']), false)
})

test('skip dates exclude an otherwise due date', () => {
  const day = new Date(2026, 9, 12, 11, 0)
  assert.equal(isSkipDate(day, ['2026-10-12']), true)
  assert.equal(isSkipDate(day, ['2026-10-13']), false)
  assert.equal(toDateKey(day), '2026-10-12')
})

test('a task fires only during its trigger minute and once a day', () => {
  const task = { id: 'lunch', triggerTime: '11:00', dateRule: 'workday', customDays: [], skipDates: [] }
  const due = new Date(2026, 9, 12, 11, 0)
  const early = new Date(2026, 9, 12, 10, 59)

  assert.equal(isTaskDue(task, due, undefined), true)
  assert.equal(isTaskDue(task, due, 'lunch:2026-10-12'), false)
  assert.equal(isTaskDue(task, early, undefined), false)
  assert.equal(isTaskDue({ ...task, skipDates: ['2026-10-12'] }, due, undefined), false)
  assert.equal(isTaskDue({ ...task, dateRule: 'weekend' }, due, undefined), false)
})

test('menu pool parsing drops lines it cannot trust', () => {
  const entries = parseMenuPool([
    '真功夫 | 香菇滑鸡饭 | 28',
    '老乡鸡|农家小炒肉|32.5',
    '缺少价格 | 只有两段',
    '价格非数字 | 菜品 | 贵',
    '   ',
    '沙县小吃 | 拌面 | 0',
  ])
  assert.deepEqual(entries, [
    { shop: '真功夫', dish: '香菇滑鸡饭', price: 28 },
    { shop: '老乡鸡', dish: '农家小炒肉', price: 32.5 },
    { shop: '沙县小吃', dish: '拌面', price: 0 },
  ])
  assert.deepEqual(parseMenuPool(undefined), [])
})

test('rotation advances through the pool and wraps', () => {
  const entries = parseMenuPool(['A | a | 10', 'B | b | 10', 'C | c | 10'])
  assert.equal(pickMenuEntry(entries, 'rotate', { lastIndex: -1 }).shop, 'A')
  assert.equal(pickMenuEntry(entries, 'rotate', { lastIndex: 0 }).shop, 'B')
  assert.equal(pickMenuEntry(entries, 'rotate', { lastIndex: 2 }).shop, 'A')
})

test('history strategy prefers entries not ordered recently', () => {
  const entries = parseMenuPool(['A | a | 10', 'B | b | 10', 'C | c | 10'])
  const history = [menuKey(entries[0]), menuKey(entries[1])]
  assert.equal(pickMenuEntry(entries, 'history', { history }).shop, 'C')
})

test('random strategy always returns a pool member', () => {
  const entries = parseMenuPool(['A | a | 10', 'B | b | 10'])
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.ok(entries.includes(pickMenuEntry(entries, 'random')))
  }
})

test('daily spend accumulates per date', () => {
  const state = { spentByDay: {} }
  recordSpend(state, '2026-10-12', 28)
  recordSpend(state, '2026-10-12', 12.5)
  recordSpend(state, '2026-10-13', 20)
  assert.equal(spentOn(state, '2026-10-12'), 40.5)
  assert.equal(spentOn(state, '2026-10-13'), 20)
  assert.equal(spentOn(state, '2026-10-14'), 0)
})

test('a task limit can only narrow the plugin limit', () => {
  const config = { maxOrderAmount: 35, dailyBudget: 100 }
  assert.equal(effectiveCap(config), 35)
  assert.equal(effectiveCap(config, { maxOrderAmount: 20 }), 20)
  assert.equal(effectiveCap(config, { maxOrderAmount: 90 }), 35)
  assert.equal(effectiveDailyBudget(config, { dailyBudget: 40 }), 40)
  assert.equal(effectiveDailyBudget(config, { dailyBudget: 500 }), 100)
})

test('a zero plugin budget leaves the task budget standing alone', () => {
  const config = { maxOrderAmount: 35, dailyBudget: 0 }
  assert.equal(effectiveDailyBudget(config), 0)
  assert.equal(effectiveDailyBudget(config, { dailyBudget: 50 }), 50)
})

test('a non-empty task whitelist replaces the global one', () => {
  const config = { merchantWhitelist: ['Global'] }
  assert.deepEqual(effectiveWhitelist(config, undefined), ['Global'])
  assert.deepEqual(effectiveWhitelist(config, { merchantWhitelist: ['Task'] }), ['Task'])
  assert.deepEqual(effectiveWhitelist(config, { merchantWhitelist: [] }), ['Global'])
})

test('childEnv carries the narrowed limits to the server', () => {
  const config = {
    headless: false,
    maxOrderAmount: 35,
    dailyBudget: 100,
    paymentMode: 'auto',
    merchantWhitelist: ['Global'],
  }
  const env = childEnv(config, undefined)
  assert.equal(env.MAX_ORDER_AMOUNT, '35')
  assert.equal(env.PAYMENT_MODE, 'auto')
  assert.equal(env.DEFAULT_PLATFORM, 'taobao')
  assert.equal(env.HIDE_SPONSORED_SHOPS, 'true')
  assert.equal(childEnv({ ...config, hideSponsoredShops: false }).HIDE_SPONSORED_SHOPS, 'false')
  assert.equal(env.HEADLESS, undefined)
  assert.deepEqual(JSON.parse(env.MERCHANT_WHITELIST), ['Global'])

  const taskEnv = childEnv(config, {
    platformId: 'meituan',
    maxOrderAmount: 20,
    dailyBudget: 40,
    paymentMode: 'manual',
    merchantWhitelist: ['Task'],
  })
  assert.equal(taskEnv.MAX_ORDER_AMOUNT, '20')
  assert.equal(taskEnv.DEFAULT_PLATFORM, 'meituan')
  assert.equal(taskEnv.DAILY_BUDGET, '40')
  assert.equal(taskEnv.PAYMENT_MODE, 'manual')
  assert.deepEqual(JSON.parse(taskEnv.MERCHANT_WHITELIST), ['Task'])
})

test('skill frontmatter parses the packaged files', async () => {
  const raw = [
    '---',
    'name: demo-skill',
    'description: "带引号的描述: 含冒号"',
    'whenToUse: 用户测试时',
    '---',
    '',
    '# 正文',
    '内容。',
  ].join('\n')
  const parsed = parseSkillFile(raw)
  assert.equal(parsed.fields.name, 'demo-skill')
  assert.equal(parsed.fields.description, '带引号的描述: 含冒号')
  assert.equal(parsed.fields.whenToUse, '用户测试时')
  assert.equal(parsed.body, '# 正文\n内容。')
})

test('skill frontmatter rejects files without the required fields', () => {
  assert.equal(parseSkillFile('# 没有 frontmatter'), undefined)
  assert.equal(parseSkillFile('---\nname: only-name\n---\nbody'), undefined)
  assert.equal(parseSkillFile(undefined), undefined)
})

test('skill frontmatter parses CRLF files', () => {
  // Git checks these files out with CRLF on Windows; the terminator and every
  // field line must survive that conversion.
  const raw = [
    '---',
    'name: crlf-skill',
    'description: CRLF 文件',
    'whenToUse: 测试行尾',
    '---',
    '',
    '# 正文',
  ].join('\r\n')
  const parsed = parseSkillFile(raw)
  assert.equal(parsed.fields.name, 'crlf-skill')
  assert.equal(parsed.fields.description, 'CRLF 文件')
  assert.equal(parsed.fields.whenToUse, '测试行尾')
  assert.equal(parsed.body, '# 正文')
})

test('the provider discovers both packaged skills', async () => {
  const provider = createSkillProvider(join(PACKAGE_ROOT, 'skills'))
  const candidates = await provider.list()
  const names = candidates.map(candidate => candidate.name).sort()
  assert.deepEqual(names, ['auto-order', 'waimai-order'])

  const loaded = await provider.get(candidates[0])
  assert.ok(loaded.content.length > 0)
  assert.equal(loaded.source, 'bundled')
  assert.equal(loaded.provider, 'dsh-waimai')
  assert.equal(loaded.invocation.modelInvocable, true)
})

test('the provider returns nothing for a missing directory', async () => {
  const provider = createSkillProvider(join(PACKAGE_ROOT, 'does-not-exist'))
  assert.deepEqual(await provider.list(), [])
})
