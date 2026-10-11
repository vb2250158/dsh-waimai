/**
 * Takeaway ordering MCP server (stdio transport).
 *
 * Drives the local headed Chromium through the takeaway H5 site. Tool results
 * are JSON strings of `{ success, data }` so the model reads structure rather
 * than scraped prose.
 *
 * Two safety properties are enforced here rather than in the model:
 *
 * 1. `submit_order` refuses to place an order above the configured cap.
 * 2. `request_payment` takes NO arguments. It re-reads the merchant and the
 *    amount from the live checkout page and validates them against the
 *    environment the Host half configured. A model that wants to pay the wrong
 *    amount, or pay the wrong merchant, has no parameter to express it.
 *
 * stdout carries the MCP protocol. Every diagnostic goes to stderr or to the
 * server log file; a stray `console.log` would corrupt the session.
 *
 * @module dsh-waimai/mcp-server
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { chromium } from 'playwright-core'
import { z } from 'zod'
import {
  browserProfileDir,
  orderLogPath,
  screenshotDir,
  serverLogPath,
  stateDir,
} from './paths.js'
import { reservePayment } from './payments.js'
import { writeJsonState } from './automation.js'
import { claimCoupons, useCoupon } from './coupons.js'
import { WaimaiLogin, LoginError } from './login.js'

const HOME_URL = 'https://h5.ele.me'

/** Action timeout in ms; long enough for a slow mobile page, short enough to fail loudly. */
const ACTION_TIMEOUT_MS = 10_000

/** Page-load timeout in ms. */
const NAVIGATION_TIMEOUT_MS = 30_000

/**
 * Read a numeric environment value.
 *
 * @param name - environment variable name.
 * @param fallback - value used when the variable is absent or unparsable.
 * @returns the parsed number.
 */
function envNumber(name, fallback) {
  const raw = process.env[name]
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Read a JSON-array environment value.
 *
 * @param name - environment variable name.
 * @returns the parsed array, or an empty array when absent or malformed.
 */
function envArray(name) {
  const raw = process.env[name]
  if (typeof raw !== 'string' || raw.trim().length === 0) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) throw new Error('Expected string array')
    return parsed
  } catch {
    throw new Error(`Invalid JSON whitelist: ${name}`)
  }
}

const HEADLESS = process.env.HEADLESS === 'true'
const PERSIST_LOGIN = process.env.PERSIST_LOGIN !== 'false'
const login = new WaimaiLogin({ statePath: join(stateDir(), 'login-state.json'), persistLogin: PERSIST_LOGIN,
  timeoutMs: envNumber('LOGIN_TIMEOUT_MS', 20000), resendSeconds: envNumber('SMS_RESEND_SECONDS', 60) })
const MAX_ORDER_AMOUNT = envNumber('MAX_ORDER_AMOUNT', 100)
const DAILY_BUDGET = envNumber('DAILY_BUDGET', 0)
const MERCHANT_WHITELIST = envArray('MERCHANT_WHITELIST')
const PAYMENT_MODE = process.env.PAYMENT_MODE === 'auto' ? 'auto' : 'manual'
const DRY_RUN = process.env.DRY_RUN !== 'false'
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL || 'chrome'
const PAYMENT_LEDGER = join(stateDir(), 'payment-state.json')
const GLOBAL_DAILY_BUDGET = envNumber('GLOBAL_DAILY_BUDGET', DAILY_BUDGET)
const TASK_DAILY_BUDGET = envNumber('TASK_DAILY_BUDGET', 0)
const TASK_ID = process.env.TASK_ID || ''
const AUTO_CLAIM_COUPONS = process.env.AUTO_CLAIM_COUPONS !== 'false'
const AUTO_USE_COUPONS = process.env.AUTO_USE_COUPONS !== 'false'
const COUPON_CLAIM_LIMIT = envNumber('COUPON_CLAIM_LIMIT', 10)

/**
 * Append one diagnostic line to the server log.
 *
 * @param message - free-form text.
 * @returns a promise settling after the write attempt.
 */
async function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`
  process.stderr.write(line)
  try {
    await appendFile(serverLogPath(), line, 'utf8')
  } catch {
    // Logging is diagnostic only; losing it must never fail a tool call.
  }
}

/**
 * Append one payment-audit record.
 *
 * @param record - JSON-serializable audit fields.
 * @returns a promise settling after the write attempt.
 */
async function audit(record) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`
  try {
    await appendFile(orderLogPath(), line, 'utf8')
  } catch (error) {
    await log(`audit write failed: ${String(error)}`)
  }
}

/** Success envelope carrying structured data. */
function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify({ success: true, data }) }] }
}

/** Failure envelope carrying a human-readable reason. */
function fail(error, extra = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: false, error, ...extra }) }],
    isError: false,
  }
}

// ---- Browser lifecycle ----

/** Live persistent context, or undefined when the browser is closed. */
let context
/** Browser owned only by the nonpersistent mode. */
let ephemeralBrowser
/** Serializes launches so two concurrent tools cannot start two browsers. */
let launching

/**
 * Return the shared persistent browser context, launching it on first use.
 *
 * @returns the live Chromium persistent context.
 */
async function getBrowserContext() {
  if (context !== undefined) {
    try {
      // A crashed browser keeps the handle alive; probe with a cheap call.
      context.pages()
      return context
    } catch {
      context = undefined
    }
  }
  launching ??= (async () => {
    const cookies = await login.cookies()
    await mkdir(browserProfileDir(), { recursive: true })
    const options = {
      headless: HEADLESS,
      ...(BROWSER_CHANNEL === 'chromium' ? {} : { channel: BROWSER_CHANNEL }),
      viewport: { width: 420, height: 900 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      args: ['--disable-blink-features=AutomationControlled'],
    }
    let launched
    if (PERSIST_LOGIN) launched = await chromium.launchPersistentContext(browserProfileDir(), options)
    else {
      ephemeralBrowser = await chromium.launch({ headless: HEADLESS, ...(BROWSER_CHANNEL === 'chromium' ? {} : { channel: BROWSER_CHANNEL }) })
      try { launched = await ephemeralBrowser.newContext({ viewport: options.viewport, locale: options.locale, timezoneId: options.timezoneId }) }
      catch (error) { await ephemeralBrowser.close(); throw error }
    }
    try { if (cookies.length > 0) await launched.addCookies(cookies) }
    catch (error) { await launched.close(); await ephemeralBrowser?.close(); throw error }
    context = launched
    const owner = ephemeralBrowser
    launched.on('close', () => {
      context = undefined
      if (owner) void owner.close().catch(() => log('temporary browser close failed'))
    })
    await log(`browser launched: headless=${HEADLESS} profile=${browserProfileDir()}`)
    return launched
  })()
  try {
    return await launching
  } finally {
    launching = undefined
  }
}

/**
 * Return the working page, reusing an existing tab or opening one.
 *
 * @returns the active Playwright page.
 */
async function getPage() {
  const ctx = await getBrowserContext()
  const pages = ctx.pages()
  if (pages.length > 0) return pages[pages.length - 1]
  return await ctx.newPage()
}

/**
 * Capture a failure screenshot into the state directory.
 *
 * @param page - page to capture.
 * @param label - short label used in the file name.
 * @returns the absolute screenshot path, or undefined when capture failed.
 */
async function capture(page, label) {
  try {
    await mkdir(screenshotDir(), { recursive: true })
    const safe = label.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)
    const file = join(screenshotDir(), `${Date.now()}-${safe}.png`)
    await page.screenshot({ path: file, fullPage: false })
    return file
  } catch {
    // A missing screenshot must not replace the original failure.
    return undefined
  }
}

/**
 * Try a list of candidate selectors until one resolves.
 *
 * The takeaway H5 site changes its markup without notice, so each interaction
 * names several candidates and reports every miss when all fail.
 *
 * @param page - active page.
 * @param selectors - candidate CSS selectors in priority order.
 * @returns the first selector that matched, or undefined.
 */
async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first()
      if (await locator.count() > 0 && await locator.isVisible({ timeout: 500 })) return selector
    } catch {
      // A candidate that cannot even be queried is simply skipped.
    }
  }
  return undefined
}

/**
 * Parse a price from page text such as `¥25.50` or `25.5元`.
 *
 * @param text - raw text containing at most one price.
 * @returns the numeric amount, or undefined when no number is present.
 */
function parsePrice(text) {
  if (typeof text !== 'string') return undefined
  const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/** Page location without query parameters or fragments. */
function pageLocation(page) {
  const url = new URL(page.url());
  return url.origin + url.pathname;
}

// ---- Page readers ----

/** Read only readiness flags, never account details or the delivery address.
 * @param page - active takeaway page.
 * @returns whether address selection or sign-in blocks ordering.
 */
async function readReadiness(page) {
  return await page.evaluate(() => {
    const text = document.body?.innerText ?? ''
    return { addressRequired: /未能获取地址|输入地址后才能订餐|手动选择地址/.test(text),
      loginRequired: /请先登录|登录后才能|登录或注册/.test(text) }
  })
}

/**
 * Read merchant and amount from the live checkout page.
 *
 * This is the trust anchor for automatic payment: the values come from the
 * rendered page, never from model arguments.
 *
 * @param page - active page positioned on the order confirmation screen.
 * @returns the observed merchant, amount, and the raw texts they came from.
 */
async function readCheckoutInfo(page) {
  const observed = await page.evaluate(() => {
    const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const pick = (selectors) => {
      for (const selector of selectors) {
        const node = document.querySelector(selector)
        const value = text(node)
        if (value.length > 0) return value
      }
      return ''
    }
    return {
      merchant: pick([
        '[data-spm*="shop-name"]',
        '.shop-name',
        '.restaurant-name',
        '.merchant-name',
        'header .name',
      ]),
      orderId: document.querySelector('[data-order-id]')?.getAttribute('data-order-id')
        || pick(['.order-number', '.order-id', '[class*="orderNumber"]']),
      amount: pick([
        '[data-spm*="total"]',
        '.total-price',
        '.pay-amount',
        '.order-total',
        '.actual-price',
      ]),
      bodyText: text(document.body).slice(0, 4000),
    }
  })
  return {
    merchant: observed.merchant,
    orderId: observed.orderId,
    amountText: observed.amount,
    amount: parsePrice(observed.amount),
    bodyText: observed.bodyText,
  }
}

/**
 * Read the current order status from visible markers.
 *
 * @param page - active page.
 * @returns a status token plus the matched evidence text.
 */
async function readOrderStatus(page) {
  const observed = await page.evaluate(() => {
    const body = (document.body?.innerText ?? '').replace(/\s+/g, ' ')
    const rules = [
      { status: 'pending_payment', patterns: ['待支付', '等待支付', '去支付'] },
      { status: 'paid', patterns: ['已支付', '支付成功'] },
      { status: 'cancelled', patterns: ['已取消', '订单关闭'] },
      { status: 'delivering', patterns: ['配送中', '骑手已接单'] },
    ]
    for (const rule of rules) {
      for (const pattern of rule.patterns) {
        if (body.includes(pattern)) return { status: rule.status, evidence: pattern }
      }
    }
    return { status: 'unknown', evidence: '' }
  })
  return observed
}

// ---- Tool result helpers ----

/**
 * Wrap one tool body with browser-level failure containment.
 *
 * @param label - short tool label used for screenshots and logs.
 * @param body - tool implementation receiving the active page.
 * @returns a JSON-encoded MCP tool result.
 */
let pageQueue = Promise.resolve()

function withPage(label, body) {
  const operation = pageQueue.then(() => runWithPage(label, body))
  pageQueue = operation.catch(() => {})
  return operation
}

async function runWithPage(label, body) {
  let page
  try {
    page = await getPage()
    return await body(page)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await log(`${label} failed: ${message}`)
    let screenshot
    if (page !== undefined) screenshot = await capture(page, label)
    return fail(message, screenshot === undefined ? {} : { screenshot })
  }
}

// ---- Server ----

const server = new McpServer({ name: 'waimai', version: '0.1.6' })

// The Host bridge excludes these endpoints from the model tool registry.
for (const [name, schema, invoke] of [
  ['login_status', {}, () => login.status()],
  ['login_send_code', { phone: z.string().regex(/^1[3-9]\d{9}$/) }, args => login.sendCode(args.phone)],
  ['login_complete', { code: z.string().regex(/^\d{4,8}$/) }, args => login.complete(args.code)],
]) {
  server.registerTool(name, { description: 'Private settings login endpoint.', inputSchema: schema }, async args => {
    try {
      const result = await invoke(args)
      if (result.authenticated && context) await context.addCookies(await login.cookies())
      return ok(result)
    } catch (error) { return fail(error instanceof LoginError ? error.message : '登录操作失败或结果未确认，请检查登录状态后再继续') }
  })
}

server.registerTool('get_status', {
  title: '检查外卖助手状态',
  description: '读取浏览器安装、预览模式和支付配置，不打开浏览器、不下单。',
  inputSchema: {},
}, async () => {
  const bundled = chromium.executablePath()
  const candidates = BROWSER_CHANNEL === 'chrome'
    ? [join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
      join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')]
    : BROWSER_CHANNEL === 'msedge'
      ? [join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe')]
      : [bundled]
  const page = context?.pages().at(-1)
  return ok({ browserChannel: BROWSER_CHANNEL, browserInstalled: candidates.some(existsSync),
    browserOpen: context !== undefined, dryRun: DRY_RUN, paymentMode: PAYMENT_MODE,
    maxOrderAmount: MAX_ORDER_AMOUNT, dailyBudget: DAILY_BUDGET,
    autoClaimCoupons: AUTO_CLAIM_COUPONS, autoUseCoupons: AUTO_USE_COUPONS,
    readiness: page === undefined ? null : await readReadiness(page) })
})

server.registerTool('open_browser', {
  title: '打开外卖页面',
  description: '启动浏览器并打开外卖首页。返回当前页面地址和标题。',
  inputSchema: {},
}, async () => withPage('open_browser', async (page) => {
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
  await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {})
  return ok({ url: pageLocation(page), title: await page.title(), ...await readReadiness(page) })
}))

server.registerTool('search_food', {
  title: '搜索外卖',
  description: '在搜索框输入关键词并回车，返回店铺列表（店铺名、评分、配送时间、起送价）。',
  inputSchema: { keyword: z.string().describe('搜索关键词，例如「奶茶」「盖饭」') },
}, async ({ keyword }) => withPage('search_food', async (page) => {
  const readiness = await readReadiness(page)
  if (readiness.addressRequired) return fail('请先在浏览器中手动选择收货地址', readiness)
  if (readiness.loginRequired) return fail('请先在插件设置页完成登录', readiness)
  const inputSelector = await firstVisible(page, [
    'input[type="search"]',
    'input[placeholder*="搜索"]',
    '.search-input input',
    '.search-bar input',
    'input[name="keyword"]',
  ])
  if (inputSelector === undefined) {
    return fail('未找到搜索框，页面结构可能已变化', { url: pageLocation(page) })
  }
  await page.fill(inputSelector, keyword, { timeout: ACTION_TIMEOUT_MS })
  await page.keyboard.press('Enter')
  await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {})
  await page.waitForTimeout(1500)

  const shops = await page.evaluate(() => {
    const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const cards = document.querySelectorAll(
      '[data-spm*="shop"], .shop-card, .restaurant-card, .shop-item, li[class*="shop"]',
    )
    const results = []
    for (const card of cards) {
      const name = text(card.querySelector('.shop-name, .name, [class*="shopName"], h3, h4'))
      if (name.length === 0) continue
      const ratingText = text(card.querySelector('[class*="rating"], [class*="score"], .star'))
      const deliveryText = text(card.querySelector('[class*="delivery"], [class*="time"]'))
      const minimumText = text(card.querySelector('[class*="min"], [class*="start"]'))
      results.push({ name, ratingText, deliveryText, minimumText })
      if (results.length >= 20) break
    }
    return results
  })

  return ok({
    keyword,
    count: shops.length,
    shops: shops.map(shop => ({
      name: shop.name,
      rating: parsePrice(shop.ratingText),
      deliveryTime: shop.deliveryText || undefined,
      minOrder: parsePrice(shop.minimumText),
    })),
    ...shops.length === 0 ? { note: '未解析到店铺卡片，可调用 open_browser 后查看页面' } : {},
  })
}))

server.registerTool('enter_shop', {
  title: '进入店铺',
  description: '按店铺名进入对应店铺的菜单页。',
  inputSchema: { shopName: z.string().describe('搜索结果中的店铺名') },
}, async ({ shopName }) => withPage('enter_shop', async (page) => {
  const target = page.getByText(shopName, { exact: false }).first()
  if (await target.count() === 0) {
    return fail(`未在结果中找到店铺「${shopName}」`)
  }
  await target.click({ timeout: ACTION_TIMEOUT_MS })
  await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {})
  await page.waitForTimeout(1500)
  return ok({ shopName, menuUrl: pageLocation(page) })
}))

server.registerTool('get_menu', {
  title: '读取菜单',
  description: '读取当前店铺菜单，返回菜品名称、价格、描述、月销量。',
  inputSchema: {},
}, async () => withPage('get_menu', async (page) => {
  const items = await page.evaluate(() => {
    const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const cards = document.querySelectorAll(
      '[data-spm*="food"], .food-item, .menu-item, .dish-item, li[class*="food"]',
    )
    const results = []
    for (const card of cards) {
      const name = text(card.querySelector('.food-name, .name, [class*="foodName"], h3, h4'))
      if (name.length === 0) continue
      results.push({
        name,
        priceText: text(card.querySelector('[class*="price"], .price')),
        description: text(card.querySelector('[class*="desc"], .desc, p')),
        salesText: text(card.querySelector('[class*="sale"], [class*="sold"]')),
      })
      if (results.length >= 80) break
    }
    return results
  })
  return ok({
    url: pageLocation(page),
    count: items.length,
    items: items.map(item => ({
      name: item.name,
      priceText: item.priceText || undefined,
      description: item.description || undefined,
      monthlySales: item.salesText || undefined,
    })),
  })
}))

server.registerTool('claim_coupons', {
  title: '领取免费优惠券',
  description: '按自动领取勾选项领取当前页面中的免费优惠券，跳过付费券包和会员活动；预览模式不会领取。',
  inputSchema: {},
}, async () => DRY_RUN || !AUTO_CLAIM_COUPONS
  ? ok({ attempted: 0, claimed: 0, skipped: DRY_RUN ? 'preview' : 'disabled' })
  : withPage('claim_coupons', async page => ok(await claimCoupons(page,
    { enabled: AUTO_CLAIM_COUPONS, dryRun: DRY_RUN, limit: COUPON_CLAIM_LIMIT }))))

server.registerTool('apply_coupons', {
  title: '使用可用优惠券',
  description: '按自动使用勾选项选择当前结算页中可用的最高面额优惠券；选择后必须重读实际应付金额。',
  inputSchema: {},
}, async () => DRY_RUN || !AUTO_USE_COUPONS
  ? ok({ selected: false, skipped: DRY_RUN ? 'preview' : 'disabled' })
  : withPage('apply_coupons', async page => ok(await useCoupon(page,
    { enabled: AUTO_USE_COUPONS, dryRun: DRY_RUN }))))

server.registerTool('add_to_cart', {
  title: '加入购物车',
  description: '按菜品名点击加购按钮，可指定份数。返回购物车商品数与总价。',
  inputSchema: {
    itemName: z.string().describe('菜单中的菜品名称'),
    quantity: z.number().int().min(1).max(20).optional().describe('份数，默认 1'),
  },
}, async ({ itemName, quantity }) => withPage('add_to_cart', async (page) => {
  const count = quantity ?? 1
  const row = page.locator(
    '[data-spm*="food"], .food-item, .menu-item, .dish-item, li[class*="food"]',
  ).filter({ hasText: itemName }).first()
  if (await row.count() === 0) {
    return fail(`菜单中未找到菜品「${itemName}」`)
  }
  const addButton = row.locator(
    '[class*="add"], button[class*="plus"], .plus, [aria-label*="加"]',
  ).first()
  if (await addButton.count() === 0) {
    return fail(`菜品「${itemName}」没有可点击的加购按钮`)
  }
  for (let index = 0; index < count; index += 1) {
    await addButton.click({ timeout: ACTION_TIMEOUT_MS })
    await page.waitForTimeout(400)
  }
  const cart = await page.evaluate(() => {
    const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const badge = document.querySelector('[class*="cart"] [class*="count"], .cart-count, .badge')
    const total = document.querySelector('[class*="cart"] [class*="price"], .cart-total')
    return { badge: text(badge), total: text(total) }
  })
  return ok({
    itemName,
    added: count,
    cartCount: parsePrice(cart.badge),
    totalText: cart.total || undefined,
    total: parsePrice(cart.total),
  })
}))

server.registerTool('view_cart', {
  title: '查看购物车',
  description: '返回购物车中的商品、数量、单价、小计、总价与配送费。',
  inputSchema: {},
}, async () => withPage('view_cart', async (page) => {
  const opened = await firstVisible(page, [
    '[class*="cart"] [class*="icon"]',
    '.cart-bar',
    '[class*="cartButton"]',
    'footer [class*="cart"]',
  ])
  if (opened !== undefined) {
    await page.locator(opened).first().click({ timeout: ACTION_TIMEOUT_MS }).catch(() => {})
    await page.waitForTimeout(1200)
  }
  const cart = await page.evaluate(() => {
    const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const rows = document.querySelectorAll(
      '[class*="cart"] [class*="item"], [class*="cartList"] li, [class*="cart-item"]',
    )
    const items = []
    for (const row of rows) {
      const name = text(row.querySelector('[class*="name"], .name'))
      if (name.length === 0) continue
      items.push({
        name,
        quantityText: text(row.querySelector('[class*="count"], [class*="quantity"]')),
        priceText: text(row.querySelector('[class*="price"], .price')),
      })
    }
    const total = text(document.querySelector('[class*="cart"] [class*="total"], .cart-total, .total-price'))
    const delivery = text(document.querySelector('[class*="delivery"] [class*="fee"], .delivery-fee'))
    return { items, total, delivery }
  })
  return ok({
    url: pageLocation(page),
    items: cart.items.map(item => ({
      name: item.name,
      quantity: parsePrice(item.quantityText),
      priceText: item.priceText || undefined,
    })),
    total: parsePrice(cart.total),
    totalText: cart.total || undefined,
    deliveryFee: parsePrice(cart.delivery),
  })
}))

server.registerTool('submit_order', {
  title: '提交订单',
  description: '校验金额上限后点击去结算，停在确认订单页。不会点击任何支付按钮。',
  inputSchema: {
    maxAmount: z.number().optional().describe('本次允许的单笔上限（元），省略则用插件配置'),
  },
}, async ({ maxAmount }) => DRY_RUN ? fail('预览模式已阻止提交订单') : withPage('submit_order', async (page) => {
  const cart = await page.evaluate(() => {
    const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return text(document.querySelector('[class*="cart"] [class*="price"], .cart-total, .total-price'))
  })
  const total = parsePrice(cart)
  // A caller may lower the cap for one order but must never raise it: taking
  // the argument verbatim would let the model widen its own spending limit.
  const requested = typeof maxAmount === 'number' && Number.isFinite(maxAmount) ? maxAmount : MAX_ORDER_AMOUNT
  const cap = Math.min(requested, MAX_ORDER_AMOUNT)
  if (total === undefined || total <= 0) return fail('无法读取有效购物车金额，已停止结算')
  if (!AUTO_USE_COUPONS && total !== undefined && total > cap) {
    await audit({ event: 'submit_rejected', total, cap })
    return fail(`订单金额 ${total} 元超过上限 ${cap} 元，请用户确认后手动下单`, { total, cap })
  }
  const checkout = await firstVisible(page, [
    'button:has-text("去结算")',
    'button:has-text("结算")',
  ])
  if (checkout === undefined) {
    return fail('未找到「去结算」按钮，购物车可能为空', { total: total ?? null })
  }
  await page.locator(checkout).first().click({ timeout: ACTION_TIMEOUT_MS })
  await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {})
  await page.waitForTimeout(1500)
  const coupon = await useCoupon(page, { enabled: AUTO_USE_COUPONS, dryRun: DRY_RUN })
  const info = await readCheckoutInfo(page)
  if (info.amount === undefined || info.amount <= 0 || info.amount > cap) {
    return fail('结算页金额无法确认或超过上限，已停止', { cap })
  }
  await audit({ event: 'submit', total: info.amount ?? total ?? null, url: pageLocation(page) })
  return ok({
    orderStatus: 'pending_payment',
    totalAmount: info.amount ?? total ?? null,
    coupon,
    merchant: info.merchant || undefined,
    paymentUrl: pageLocation(page),
    note: '已停在确认订单页，未执行任何支付操作',
  })
}))

server.registerTool('request_payment', {
  title: '请求支付',
  description:
    '在确认订单页发起支付。金额与商家由服务端从当前页面读取并校验，不接受调用方传参。'
    + '仅在插件配置的 paymentMode 为 auto 且校验通过时才点击确认支付。',
  inputSchema: {},
}, async () => DRY_RUN ? fail('预览模式已阻止支付')
  : PAYMENT_MODE !== 'auto' ? fail('当前为手动支付模式，未执行支付')
    : withPage('request_payment', async (page) => {
  const info = await readCheckoutInfo(page)
  await audit({
    event: 'payment_attempt',
    mode: PAYMENT_MODE,
    merchant: info.merchant,
    amount: info.amount,
  })

  if (PAYMENT_MODE !== 'auto') {
    return fail('当前为手动支付模式，未执行支付', { merchant: info.merchant, amount: info.amount })
  }
  if (info.amount === undefined) {
    return fail('无法从页面读取订单金额，出于安全考虑不执行支付', { merchant: info.merchant })
  }
  if (info.amount > MAX_ORDER_AMOUNT) {
    await audit({ event: 'payment_rejected', reason: 'over_cap', amount: info.amount, cap: MAX_ORDER_AMOUNT })
    return fail(`页面金额 ${info.amount} 元超过上限 ${MAX_ORDER_AMOUNT} 元，已拒绝支付`, {
      amount: info.amount,
      cap: MAX_ORDER_AMOUNT,
    })
  }
  if (DAILY_BUDGET > 0 && info.amount > DAILY_BUDGET) {
    await audit({ event: 'payment_rejected', reason: 'over_daily_budget', amount: info.amount })
    return fail(`页面金额 ${info.amount} 元超过每日上限 ${DAILY_BUDGET} 元，已拒绝支付`, {
      amount: info.amount,
      dailyBudget: DAILY_BUDGET,
    })
  }
  if (MERCHANT_WHITELIST.length > 0 && !MERCHANT_WHITELIST.includes(info.merchant.trim())) {
    await audit({ event: 'payment_rejected', reason: 'not_whitelisted', merchant: info.merchant })
    return fail(`商家「${info.merchant}」不在白名单内，已拒绝支付`, {
      merchant: info.merchant,
      whitelist: MERCHANT_WHITELIST,
    })
  }

  const payButton = await firstVisible(page, [
    'button:has-text("确认支付")',
    'button:has-text("立即支付")',
    'button:has-text("提交订单")',
    '[class*="pay"] button',
  ])
  if (payButton === undefined) {
    return fail('未找到支付按钮，请确认已进入确认订单页', {
      merchant: info.merchant,
      amount: info.amount,
    })
  }
  const ledger = await reservePayment(PAYMENT_LEDGER,
    { id: info.orderId, amount: info.amount, merchant: info.merchant },
    { cap: MAX_ORDER_AMOUNT, whitelist: MERCHANT_WHITELIST, globalBudget: GLOBAL_DAILY_BUDGET,
      taskBudget: TASK_DAILY_BUDGET, taskId: TASK_ID })
  await page.locator(payButton).first().click({ timeout: ACTION_TIMEOUT_MS })
  await page.waitForTimeout(3000)
  const status = await readOrderStatus(page)
  ledger.orders[info.orderId].status = status.status === 'paid' ? 'paid' : 'pending'
  await writeJsonState(PAYMENT_LEDGER, ledger)
  await audit({ event: 'payment_clicked', amount: info.amount, status: status.status })
  return ok({
    status: status.status,
    amount: info.amount,
    merchant: info.merchant,
    evidence: status.evidence || undefined,
    note: status.status === 'paid'
      ? '支付已完成'
      : '已点击支付按钮，但未确认扣款成功；免密支付不可用时需要用户手动完成',
  })
}))

server.registerTool('get_order_status', {
  title: '查询订单状态',
  description: '读取当前页面的订单状态，例如待支付或已支付。',
  inputSchema: {},
}, async () => withPage('get_order_status', async (page) => {
  const status = await readOrderStatus(page)
  const info = await readCheckoutInfo(page)
  return ok({
    status: status.status,
    evidence: status.evidence || undefined,
    amount: info.amount ?? null,
    merchant: info.merchant || undefined,
    url: pageLocation(page),
  })
}))

// ---- Startup ----

/**
 * Connect the stdio transport and keep the process alive.
 *
 * @returns a promise settling after the transport connects.
 */
async function main() {
  await mkdir(screenshotDir(), { recursive: true }).catch(() => {})
  await log(
    `waimai MCP server starting; headless=${HEADLESS} paymentMode=${PAYMENT_MODE} `
    + `maxOrderAmount=${MAX_ORDER_AMOUNT} whitelist=${MERCHANT_WHITELIST.length} `
    + `dryRun=${DRY_RUN} autoClaimCoupons=${AUTO_CLAIM_COUPONS} autoUseCoupons=${AUTO_USE_COUPONS}`,
  )
  const transport = new StdioServerTransport()
  await server.connect(transport)
  await log('waimai MCP server ready')
}

/**
 * Close the browser and exit.
 *
 * @param signal - received signal name.
 * @returns a promise settling after shutdown.
 */
async function shutdown(signal) {
  await log(`waimai MCP server shutting down on ${signal}`)
  try {
    await context?.close()
    await ephemeralBrowser?.close()
    await login.close()
  } catch {
    // A browser already gone needs no repair during shutdown.
  }
  process.exit(0)
}

process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT', () => { void shutdown('SIGINT') })

main().catch(async (error) => {
  await log(`waimai MCP server failed to start: ${String(error)}`)
  try {
    await writeFile(serverLogPath(), `${String(error?.stack ?? error)}\n`, 'utf8')
  } catch {
    // The startup failure is already on stderr; a failed detail write changes nothing.
  }
  process.exit(1)
})
