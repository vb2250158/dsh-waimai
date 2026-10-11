/** HTTP-only Taobao QR exchange. Each attempt owns a fresh, temporary cookie jar. */
import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { assignedJson, loginUrl, LoginError } from './login.js'

const origin = 'https://login.taobao.com'
const paths = { getQRCodeApi: '/havanaone/loginLegacy/qrCode/generate.do', checkQRCodeApi: '/havanaone/loginLegacy/qrCode/query.do' }
const activeStates = new Set(['waiting', 'scanned', 'business-unconfirmed'])

/** Own private QR tokens; expose only a locally rendered image and attempt reference. */
export class TaobaoQrSession {
  /** @param options - HTTP factory, request timeout and maximum attempt lifetime. */
  constructor({ createContext, timeoutMs, lifetimeSeconds }) {
    this.createContext = createContext; this.timeoutMs = timeoutMs; this.lifetimeSeconds = lifetimeSeconds
  }

  /** Validate every redirect before issuing it, with no caller-supplied URLs.
   * @param url - official initial or SSO URL.
   * @param protocol - owning login's host policy.
   * @returns final HTTP response.
   */
  async get(url, protocol) {
    for (let step = 0; step < 6; step++) {
      const response = await this.http.get(loginUrl(url, protocol), { maxRedirects: 0 })
      if (response.status() >= 300 && response.status() < 400) {
        const location = response.headers().location
        if (!location) throw new LoginError('淘宝登录跳转地址缺失')
        url = new URL(location, url).href; continue
      }
      if (!response.ok()) throw new LoginError('淘宝登录请求失败，请重新获取二维码')
      return response
    }
    throw new LoginError('淘宝登录跳转次数过多，已停止')
  }

  /** Start a fresh official exchange; the active ordering jar is never read or changed.
   * @param protocol - owning login's host policy.
   * @returns transient UI state.
   */
  async start(protocol) {
    await this.close()
    this.http = await this.createContext({ timeout: this.timeoutMs, maxRedirects: 0 })
    this.id = randomUUID(); this.expiresAt = Date.now() + this.lifetimeSeconds * 1000; this.state = 'starting'
    const page = await this.get(origin + '/member/login.jhtml', protocol)
    const html = await page.text()
    if (html.length > 2_000_000) throw new LoginError('淘宝登录初始化响应过大')
    const view = assignedJson(html, 'viewData'), config = assignedJson(html, 'viewConfig')
    if (!config.loginTypes?.some(value => value.type === 'qrcode') || typeof view.loginFormData?._csrf !== 'string') {
      throw new LoginError('淘宝扫码登录入口已变更，请更新插件')
    }
    this.api = {}
    for (const [key, path] of Object.entries(paths)) {
      const endpoint = new URL(config.api?.[key], origin)
      if (endpoint.origin !== origin || endpoint.pathname !== path || endpoint.username || endpoint.password) {
        throw new LoginError('淘宝扫码接口已变更，请更新插件')
      }
      this.api[key] = endpoint.href
    }
    this.form = { ...view.loginFormData, umidToken: view.umidToken || '', umidTag: 'SERVER' }
    this.referer = page.url()
    const response = await this.http.get(this.api.getQRCodeApi, { params: this.form, maxRedirects: 0, headers: { Referer: this.referer } })
    const raw = await response.json(), data = raw.content?.data
    if (!response.ok() || raw.hasError || raw.content?.hasError || !data || typeof data.ck !== 'string'
      || !['number', 'string'].includes(typeof data.t) || typeof data.codeContent !== 'string' || data.codeContent.length > 2048) {
      throw new LoginError('淘宝未返回有效二维码，请稍后重试')
    }
    const code = new URL(data.codeContent)
    if (code.protocol !== 'https:' || code.hostname !== 'login.m.taobao.com' || code.pathname !== '/qrcodeCheck.htm' || code.username || code.password || code.port) {
      throw new LoginError('淘宝返回了未支持的二维码，已停止')
    }
    this.token = { ck: data.ck, t: data.t }
    this.image = await QRCode.toDataURL(code.href, { width: 256, margin: 4, errorCorrectionLevel: 'M' })
    this.state = 'waiting'
    return this.summary()
  }

  /** Poll the exact attempt; stale, canceled and expired references cannot replace an account.
   * @param id - transient UI attempt reference.
   * @param protocol - owning login's host policy.
   * @returns transient state; confirmed credentials remain private.
   */
  async poll(id, protocol) {
    if (id !== this.id || !this.http) throw new LoginError('二维码已更新或取消，请重新获取')
    if (Date.now() >= this.expiresAt) { await this.close(); this.state = 'expired'; return this.summary() }
    if (!activeStates.has(this.state)) return this.summary()
    if (this.state === 'business-unconfirmed') return this.summary()
    const response = await this.http.post(this.api.checkQRCodeApi, { maxRedirects: 0, form: {
      ...this.form, ...this.token, ua: '', navlanguage: 'zh-CN', navUserAgent: '', navPlatform: 'Win32',
    }, headers: { Referer: this.referer, Origin: origin } })
    const raw = await response.json(), data = raw.content?.data
    if (!response.ok() || raw.hasError || raw.content?.hasError || !data) throw new LoginError('淘宝扫码状态暂时无法确认，请重新检查')
    const status = data.qrCodeStatus
    if (status === 'NEW') this.state = 'waiting'
    else if (status === 'SCANED') this.state = 'scanned'
    else if (['EXPIRED', 'CANCELED', 'ERROR'].includes(status)) { await this.close(); this.state = status === 'EXPIRED' ? 'expired' : 'canceled' }
    else if (status === 'CONFIRMED') {
      if (data.conToken || data.scene || data.isCheckCodeShowed || data.iframeRedirect) {
        await this.close(); this.state = 'verification-required'; return this.summary()
      }
      if (data.smsRegToken) { await this.close(); this.state = 'registration-required'; return this.summary() }
      for (const key of ['asyncUrls', 'miniVsts']) {
        if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].length > 32 || data[key].some(value => typeof value !== 'string'))) {
          throw new LoginError('淘宝会话同步响应无法识别')
        }
      }
      // Other Alibaba products can have optional SSO images. They are not needed for takeaway login.
      for (const url of [...(data.asyncUrls || []), ...(data.miniVsts || [])]) {
        const parsed = new URL(url)
        if (protocol.allowedHosts.includes(parsed.hostname)) await this.get(url, protocol)
      }
      for (const key of ['redirectUrl', 'parentRedirectUrl']) if (data[key]) await this.get(data[key], protocol)
      this.state = 'business-unconfirmed'; this.image = undefined; this.token = undefined
    } else throw new LoginError('淘宝返回了未知扫码状态，请更新插件')
    return this.summary()
  }

  /** @returns allowlisted transient UI fields; no QR token, URL or cookie values. */
  summary() { return { attemptId: this.id, state: this.state, expiresAt: this.expiresAt, ...(this.image ? { image: this.image } : {}) } }

  /** Discard an attempt without changing the ordering account. */
  async close() {
    await this.http?.dispose(); this.http = undefined; this.form = undefined; this.token = undefined; this.image = undefined; this.business = undefined; this.state = 'canceled'
  }
}
