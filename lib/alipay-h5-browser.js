/** User-owned H5 verification window. Payment requests are reserved for the backend transport. */
import { chromium } from 'playwright-core'
import { h5Entry } from './alipay-h5.js'
import { TradeError } from './trade-data.js'
import { H5InlineLogin, loginNeedsExternal, loginDiagnosticAction } from './alipay-h5-login.js'

const origin = 'https://maliprod.alipay.com'

/** @param url - requested URL. @returns whether an H5 API request belongs to login or read-only reconciliation. */
export function h5VerificationRequest(url) {
  const target = new URL(url)
  if (target.origin !== origin || !target.pathname.startsWith('/wapcashier/api/')) return true
  const match = /^\/wapcashier\/api\/([A-Za-z]+)\.json$/.exec(target.pathname)
  return Boolean(match && loginDiagnosticAction(match[1]) !== 'other')
}

/** Keeps the browser jar in memory; never opens the user's normal profile or exports credentials to the UI. */
export class H5VerificationWindow {
  /** @param options - configured browser channel, request timeout and optional browser provider for isolated tests. */
  constructor({ channel, timeoutMs, launch = options => chromium.launch(options) }) {
    this.channel = channel; this.timeoutMs = timeoutMs; this.launch = launch
    this.browser = null; this.context = null; this.page = null
  }

  /** @param entryUrl - original order's current H5 page. @param storageState - private authenticated jar. @returns completion after displaying verification. */
  async open(entryUrl, storageState, { inline = false } = {}) {
    h5Entry(entryUrl)
    try {
      this.browser = await this.launch({ channel: this.channel === 'chromium' ? undefined : this.channel,
        headless: inline, timeout: this.timeoutMs })
      this.context = await this.browser.newContext({ storageState })
      this.page = await this.context.newPage()
      if (inline) this.form = new H5InlineLogin(this.page, this.timeoutMs)
      const form = this.form
      await this.context.route('**/wapcashier/api/**', async route => {
        const url = route.request().url()
        if (inline && new URL(url).origin !== origin) {
          form.recordDiagnostic('origin-changed'); return route.abort('blockedbyclient')
        }
        if (!h5VerificationRequest(url)) {
          if (inline) form.recordDiagnostic('unsupported-request')
          return route.abort('blockedbyclient')
        }
        if (!inline) return route.continue()
        if (form.closed) return
        const action = new URL(url).pathname.split('/').pop().replace('.json', '')
        const writing = !['cashierMain', 'refresh', 'refreshNoAuth', 'cashierPayResultQuery'].includes(action)
        if (writing && !form.consumeRequest(action)) {
          form.requireExternal('unexpected-write', { action }); return route.abort('blockedbyclient')
        }
        // Read the response before allowing scripts to enter registration or an agreement flow.
        let response, raw, fulfilled = false, phase = 'fetch'
        try {
          response = await route.fetch({ timeout: this.timeoutMs, maxRedirects: 0 })
          if (action === 'cashierPayResultQuery') { await route.fulfill({ response }); return }
          phase = 'json'
          raw = await response.json()
          if (form.closed) return
          const pageData = raw?.success === true && ['unified_login', 'need_loginsms_verify', 'cashier_pre_confirm'].includes(raw.data?.controlType)
          const resend = action === 'smsResendLogin' && raw?.success === true && !raw.data?.controlType && !raw.data?.bizError
          if ((!pageData && !resend) || raw.needRedirect || raw.redirectUrl || raw.wnd || raw.data?.wnd || raw.data?.h5HalfScreen || loginNeedsExternal(raw.data)) {
            const reason = raw?.success !== true ? 'response-invalid' : !pageData && !resend ? 'unsupported-step' : 'provider-confirmation'
            form.requireExternal(reason, { raw, action })
            return await route.abort('blockedbyclient')
          }
          phase = 'fulfill'
          await route.fulfill({ response })
          fulfilled = true
          if (pageData) {
            phase = 'presentation'
            await form.presented(raw.data)
            form.observe(raw.data, action)
          } else if (resend) {
            phase = 'presentation'
            await form.resendCoolingDown()
            form.acknowledgeResend()
          }
        } catch (error) {
          const reason = phase === 'fetch' ? 'response-unavailable' : phase === 'json' ? 'response-invalid'
            : error?.name === 'TimeoutError' ? 'presentation-timeout' : 'presentation-mismatch'
          if (!form.closed) form.requireExternal(reason, { action, raw })
          if (!fulfilled && !form.closed) {
            try { await route.abort('failed') } catch (error) { /* The owned page may have closed while aborting. */ }
          }
        } finally { if (response) {
          try { await response.dispose() } catch (error) { /* The browser may already have disposed this response during close. */ }
        } }
      })
      await this.page.goto(entryUrl, { timeout: this.timeoutMs, waitUntil: 'domcontentloaded' })
      if (inline) await this.form.initialized()
    } catch {
      await this.close()
      throw new TradeError('h5-browser-unavailable', '无法打开支付宝验证窗口，请检查支付配置中的浏览器')
    }
  }

  /** @param args - bounded private form action. @returns provider-requested inputs, without page text or credentials. */
  async input(args) {
    if (!this.form) throw new TradeError('h5-inline-unavailable', '请先连接设置页登录表单')
    return args.operation === 'refresh' ? this.form.describe() : this.form.submit(args)
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
    this.form?.close(); this.form = null
    this.browser = null; this.context = null; this.page = null
    if (browser) {
      try { await browser.close() } catch (error) { /* The user may already have closed this owned browser. */ }
    }
  }
}
