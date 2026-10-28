/** User-owned H5 verification window. Payment requests are reserved for the backend transport. */
import { chromium } from 'playwright-core'
import { h5Entry } from './alipay-h5.js'
import { TradeError } from './trade-data.js'

const origin = 'https://maliprod.alipay.com'
const verificationActions = new Set(['cashierMain', 'refresh', 'refreshNoAuth', 'unifiedLogin',
  'accountLogin', 'toAccountLogin', 'toUnifiedLogin', 'smsValidateLogin', 'smsResendLogin', 'cashierPayResultQuery'])

/** @param url - requested URL. @returns whether an H5 API request belongs to login or read-only reconciliation. */
export function h5VerificationRequest(url) {
  const target = new URL(url)
  if (target.origin !== origin || !target.pathname.startsWith('/wapcashier/api/')) return true
  const match = /^\/wapcashier\/api\/([A-Za-z]+)\.json$/.exec(target.pathname)
  return Boolean(match && verificationActions.has(match[1]))
}

/** Keeps the browser jar in memory; never opens the user's normal profile or exports credentials to the UI. */
export class H5VerificationWindow {
  /** @param options - configured browser channel, request timeout and optional browser provider for isolated tests. */
  constructor({ channel, timeoutMs, launch = options => chromium.launch(options) }) {
    this.channel = channel; this.timeoutMs = timeoutMs; this.launch = launch
    this.browser = null; this.context = null; this.page = null
  }

  /** @param entryUrl - original order's current H5 page. @param storageState - private authenticated jar. @returns completion after displaying verification. */
  async open(entryUrl, storageState) {
    h5Entry(entryUrl)
    try {
      this.browser = await this.launch({ channel: this.channel === 'chromium' ? undefined : this.channel,
        headless: false, timeout: this.timeoutMs })
      this.context = await this.browser.newContext({ storageState })
      await this.context.route('**/wapcashier/api/**', route => h5VerificationRequest(route.request().url())
        ? route.continue() : route.abort('blockedbyclient'))
      this.page = await this.context.newPage()
      await this.page.goto(entryUrl, { timeout: this.timeoutMs, waitUntil: 'domcontentloaded' })
    } catch {
      await this.close()
      throw new TradeError('h5-browser-unavailable', '无法打开支付宝验证窗口，请检查支付配置中的浏览器')
    }
  }

  /** @returns an in-memory snapshot for the owning backend; page location and credentials never leave that owner. */
  async snapshot() {
    try {
      if (!this.page || this.page.isClosed()) throw new Error('closed')
      const entryUrl = h5Entry(this.page.url()).href
      const environment = await this.page.evaluate(() => ({
        device: { userAgent: navigator.userAgent, screenWidth: screen.width, screenHeight: screen.height,
          hardwareConcurrency: navigator.hardwareConcurrency },
        ...(typeof window.json_ua === 'string' ? { ua: window.json_ua } : {}), referer: document.referrer,
      }))
      // This is the public SDK used by the inspected H5 payment page, in the same live browser session.
      const envData = await this.page.evaluate(async ({ timeoutMs, appId }) => {
        if (!window.APDID?.getApdidToken || !window.DeviceColor?.getDeviceColor) return null
        const call = invoke => new Promise(resolve => {
          const timer = setTimeout(() => resolve(null), timeoutMs)
          try { invoke(value => { clearTimeout(timer); resolve(value) }) }
          catch (error) { clearTimeout(timer); resolve(null) }
        })
        const [token, color] = await Promise.all([
          call(done => window.APDID.getApdidToken(appId, done)),
          call(done => window.DeviceColor.getDeviceColor(appId, done)),
        ])
        if (!token || typeof color !== 'string' || !color) return null
        return JSON.stringify({ authConfig: { jShieldToken: JSON.stringify(token), jShieldColor: color } })
      }, { timeoutMs: this.timeoutMs, appId: 'b19c5618c6f25ea6069c891b194f530a' })
      const storageState = await this.context.storageState()
      storageState.cookies = storageState.cookies.filter(cookie =>
        ['maliprod.alipay.com', '.maliprod.alipay.com', 'alipay.com', '.alipay.com'].includes(cookie.domain))
      storageState.origins = []
      return { entryUrl, environment, storageState, envData }
    } catch { throw new TradeError('h5-verification-unavailable', '验证窗口已关闭或尚未返回支付宝收银台，请重新打开验证') }
  }

  /** Release only this verification browser, including partially initialized windows. */
  async close() {
    const browser = this.browser
    this.browser = null; this.context = null; this.page = null
    if (browser) {
      try { await browser.close() } catch (error) { /* The user may already have closed this owned browser. */ }
    }
  }
}
