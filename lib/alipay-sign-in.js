/** Order-independent Alipay QR sign-in. Cookies never leave the owning backend. */
import { chromium, request } from 'playwright-core'
import { randomUUID } from 'node:crypto'
import { TradeError } from './trade-data.js'
import { readAlipayBankCards } from './alipay-bank-cards.js'

const loginUrl = 'https://auth.alipay.com/login/index.htm?goto=https%3A%2F%2Fsweb.alipay.com%2F'
const landingUrl = 'https://sweb.alipay.com/'

/** Restrict sign-in navigation to the login provider and its protected return page. */
export function alipayLoginNavigation(value) {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && !url.port
    && (url.hostname === 'alipay.com' || url.hostname.endsWith('.alipay.com'))
    && !url.pathname.startsWith('/wapcashier/') && !url.pathname.startsWith('/h5pay/')
}

/** One in-memory login window per shopping account, independent of all order and payment ledgers. */
export class AlipaySignIn {
  constructor({ channel, timeoutMs, store, createRequest = options => request.newContext(options), launch = options => chromium.launch(options) }) {
    this.channel = channel; this.timeoutMs = timeoutMs; this.launch = launch
    this.store = store; this.createRequest = createRequest; this.restored = false; this.http = null; this.saved = null
    this.browser = null; this.context = null; this.page = null; this.environment = null; this.ref = null; this.authentication = null
  }

  /** Start only by explicit user action; status polling never replaces a live QR code. */
  async start() {
    if (this.page && !this.page.isClosed()) return this.status()
    const restored = await this.restore()
    if (restored) return restored
    await this.close()
    try {
      this.browser = await this.launch({ channel: this.channel === 'chromium' ? undefined : this.channel, headless: false, timeout: this.timeoutMs })
      this.context = await this.browser.newContext()
      this.page = await this.context.newPage()
      this.ref = randomUUID()
      // Let official authentication redirects complete in the same browser and cookie jar.
      await this.context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url())
        if (request.isNavigationRequest()) {
          if (!alipayLoginNavigation(url.href)) return route.abort('blockedbyclient')
        }
        if (url.pathname.startsWith('/wapcashier/') || url.pathname.startsWith('/h5pay/')) return route.abort('blockedbyclient')
        return route.continue()
      })
      await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs })
      this.environment = { device: await this.page.evaluate(() => ({ userAgent: navigator.userAgent,
        screenWidth: screen.width, screenHeight: screen.height, hardwareConcurrency: navigator.hardwareConcurrency })) }
      await this.page.locator('#J-barcode-container canvas.barcode').waitFor({ state: 'visible', timeout: this.timeoutMs })
      return await this.status()
    } catch (error) {
      await this.close()
      if (error instanceof TradeError) throw error
      throw new TradeError('alipay-login-unavailable', '支付宝登录二维码暂时不可用，请重试')
    }
  }

  /** Probe a protected official page with this jar; a scanned QR or local flag is never sufficient. */
  async verify(http = this.context.request) {
    let target = landingUrl
    for (let step = 0; step < 6; step++) {
      const response = await http.get(target, { maxRedirects: 0, timeout: this.timeoutMs })
      try {
        if (response.status() >= 300 && response.status() < 400) {
          const location = response.headers().location
          if (!location) return false
          const next = new URL(location, target)
          // The protected landing redirects signed-out users to auth; do not follow a login page and count its HTTP 200.
          if (!alipayLoginNavigation(next.href) || /^(?:auth|authsa[0-9]+|securitycore)\.alipay\.com$/.test(next.hostname)
            || next.pathname.startsWith('/login/')) return false
          target = next.href
          continue
        }
        if (response.status() !== 200 || !response.headers()['content-type']?.includes('text/html')) return false
        // A generic HTML success is not authentication evidence. Require the same jar to read
        // the structured account endpoint; an authenticated wallet may legitimately have no cards.
        try { await readAlipayBankCards(http, { timeoutMs: this.timeoutMs }); return true }
        catch (error) {
          if (error instanceof TradeError && error.code === 'alipay-cards-verification-required') return false
          throw error
        }
      } finally { await response.dispose() }
    }
    return false
  }

  /** Return a QR image or verified login status, never cookies or account dashboard contents. */
  async status() {
    try {
      if (!this.page || this.page.isClosed()) {
        let verified = false
        if (this.context && this.environment) {
          try { verified = await this.verify() }
          catch (error) { /* A closed browser may already have disposed the context; try the saved session below. */ }
        }
        if (verified) return await this.remember(this.environment)
        return await this.restore() || { state: 'signed-out' }
      }
      const location = new URL(this.page.url())
      if (!alipayLoginNavigation(location.href)) {
        this.authentication = null
        return { state: 'verification-required', loginRef: this.ref }
      }
      if (await this.verify()) {
        const environment = { device: await this.page.evaluate(() => ({ userAgent: navigator.userAgent,
          screenWidth: screen.width, screenHeight: screen.height, hardwareConcurrency: navigator.hardwareConcurrency })) }
        return await this.remember(environment)
      }
      // A stale QR window must not mask a still-valid saved login. Probe its own jar independently.
      const restored = await this.restore()
      if (restored) {
        const browser = this.browser
        this.browser = null; this.context = null; this.page = null
        if (browser) await browser.close()
        return restored
      }
      this.authentication = null
      if (location.hostname !== 'auth.alipay.com' && !/^authsa[0-9]+\.alipay\.com$/.test(location.hostname)) return { state: 'verification-required', loginRef: this.ref }
      const container = this.page.locator('#J-barcode-container')
      if (await container.count() !== 1) return { state: 'verification-required', loginRef: this.ref }
      const classes = (await container.getAttribute('class') || '').split(/\s+/)
      if (classes.includes('timeout') || classes.includes('error')) return { state: 'expired', loginRef: this.ref }
      if (classes.includes('scanned') || classes.includes('confirmed')) return { state: 'confirm-on-phone', loginRef: this.ref }
      const qr = this.page.locator('#J-barcode-container canvas.barcode')
      if (!await qr.isVisible()) return { state: 'verification-required', loginRef: this.ref }
      return { state: 'waiting-scan', loginRef: this.ref, qrImage: 'data:image/png;base64,' + (await qr.screenshot()).toString('base64') }
    } catch {
      throw new TradeError('alipay-login-status-unavailable', '支付宝登录状态暂时无法核实，请刷新；未自动重新登录')
    }
  }

  /** @param environment - device details captured while the owned browser page was live. @returns verified login status after durable save. */
  async remember(environment) {
    const state = await this.context.storageState()
    this.authentication = { storageState: { cookies: state.cookies.filter(cookie => cookie.domain === 'alipay.com'
      || cookie.domain === '.alipay.com' || cookie.domain.endsWith('.alipay.com')), origins: [] }, environment }
    await this.persist()
    // A browser refresh must not be overwritten by a previously restored HTTP cookie jar.
    if (this.http) { await this.http.dispose(); this.http = null }
    this.restored = false
    return { state: 'signed-in', loginRef: this.ref }
  }

  /** Save only verified session material; unchanged polling does not rewrite the file. */
  async persist() {
    const serialized = JSON.stringify(this.authentication)
    if (this.store && serialized !== this.saved) { await this.store.save(this.authentication); this.saved = serialized }
  }

  /** Restore privately and revalidate against the provider before exposing signed-in status. */
  async restore() {
    if (!this.store) return null
    if (!this.restored || !this.authentication) {
      const authentication = await this.store.load()
      if (authentication) {
        if (this.http) { await this.http.dispose(); this.http = null }
        this.http = await this.createRequest({ storageState: authentication.storageState, userAgent: authentication.environment.device.userAgent })
        this.authentication = authentication
        this.ref ||= randomUUID()
      }
      this.restored = true
    }
    if (!this.http || !this.authentication) return null
    if (!await this.verify(this.http)) { this.authentication = null; return null }
    this.authentication.storageState = await this.http.storageState()
    await this.persist()
    return { state: 'signed-in', loginRef: this.ref }
  }

  /** Read the current wallet's bound cards without an order; identifiers stay in the backend. */
  async cards() {
    const progress = await this.status()
    if (progress.state !== 'signed-in') return { state: 'verification-required', cards: [], loginRef: this.ref }
    const http = this.context?.request || this.http
    if (!http) throw new TradeError('alipay-cards-unavailable', '支付宝登录连接不可用，请刷新登录状态')
    return { state: 'available', loginRef: this.ref,
      cards: await readAlipayBankCards(http, { timeoutMs: this.timeoutMs }) }
  }

  /** Explicit sign-out removes the saved session; service shutdown only closes handles. */
  async forget() {
    await this.store?.clear()
    await this.close()
    this.restored = true; this.saved = null
  }

  /** Discard only this isolated authentication window and its private in-memory jar. */
  async close() {
    const browser = this.browser
    if (this.http) { await this.http.dispose(); this.http = null }
    this.restored = false
    this.browser = null; this.context = null; this.page = null; this.environment = null; this.ref = null; this.authentication = null
    if (browser) await browser.close()
  }
}
