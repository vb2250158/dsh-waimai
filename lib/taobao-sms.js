/** Alibaba web SMS authorization in an isolated jar; Hema verifies the resulting business identity separately. */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { assignedJson, loginUrl, LoginError } from './login.js'
import { followLoginRedirects } from './login-http.js'

const origin = 'https://login.taobao.com'
const paths = { sendSmsApi: '/havanaone/loginLegacy/sms/sendSms.do', smsLoginApi: '/havanaone/loginLegacy/sms/login.do' }
const phoneSchema = z.string().regex(/^1[3-9]\d{9}$/)
const dataSchema = z.object({ content: z.object({ data: z.record(z.string(), z.unknown()), hasError: z.boolean().optional() }), hasError: z.boolean().optional() })

/** The owning login serializes calls. No phone, code, token or URL is persisted by this session. */
export class TaobaoSmsSession {
  /** @param options - private HTTP factory, timeout and safe stage callback. */
  constructor({ createContext, timeoutMs, diagnostic }) {
    this.createContext = createContext; this.timeoutMs = timeoutMs; this.diagnostic = diagnostic; this.state = 'not-checked'
  }

  /** @param protocol - destination policy. Prepare a fresh guest jar and verified web SMS endpoints. */
  async bootstrap(protocol) {
    await this.close()
    this.attemptId = randomUUID()
    this.http = await this.createContext({ timeout: this.timeoutMs, maxRedirects: 0 })
    const page = await followLoginRedirects(this.http, origin + '/member/login.jhtml', protocol), html = await page.text()
    if (html.length > 2_000_000) throw new LoginError('短信登录初始化响应过大')
    const view = assignedJson(html, 'viewData'), config = assignedJson(html, 'viewConfig')
    this.form = z.object({ _csrf: z.string().min(1).max(16384), bizName: z.literal('taobao'), bizEntrance: z.string().min(1).max(128),
      lang: z.string().max(32).optional(), hitRSA2048Gray: z.union([z.boolean(), z.enum(['true', 'false'])]).optional() }).parse(view.loginFormData)
    if (view.appName !== 'taobao' || config.rsaModulusSec || config.rsaExponentSec) throw new LoginError('短信登录入口已变更，请更新插件')
    this.api = {}
    for (const [key, path] of Object.entries(paths)) {
      if (typeof config.api?.[key] !== 'string') throw new LoginError('短信登录接口缺失，请更新插件')
      const endpoint = new URL(loginUrl(config.api[key], protocol))
      if (endpoint.origin !== origin || endpoint.pathname !== path || endpoint.hash) throw new LoginError('短信登录接口已变更，请更新插件')
      this.api[key] = endpoint.href
    }
    this.codeLength = z.number().int().min(4).max(8).parse(config.smsCodeLength)
    this.defaultView = z.string().max(32).parse(config.defaultView); this.referer = page.url()
  }

  /** @param endpoint - verified web endpoint key. @param fields - private request fields. @returns parsed response without propagating remote error text. */
  async post(endpoint, fields) {
    let raw
    try {
      const response = await this.http.post(this.api[endpoint], { maxRedirects: 0,
        form: { ...this.form, ...fields, defaultView: this.defaultView, ua: '', umidToken: '', umidTag: 'SERVER' },
        headers: { Origin: origin, Referer: this.referer } })
      if (!response.ok()) throw new Error('HTTP failure')
      raw = dataSchema.parse(await response.json())
    } catch { throw new LoginError('短信登录请求结果未确认，请稍后重试') }
    return { data: raw.content.data, rejected: raw.hasError === true || raw.content.hasError === true }
  }

  /** @param data - parsed web response. @returns true when an interactive step prevents authorization. */
  blocked(data) {
    if (data.isCheckCodeShowed || data.iframeRedirect || data.conToken || data.scene) this.state = 'verification-required'
    else if (data.smsRegToken) this.state = 'registration-required'
    else return false
    return true
  }

  /** @param phone - explicit UI input. @param protocol - destination policy. @returns safe pending-code state. */
  async send(phone, protocol) {
    phoneSchema.parse(phone); await this.bootstrap(protocol)
    this.state = 'send-unknown'; this.diagnostic('sms-send-requested', this.attemptId)
    const { data, rejected } = await this.post('sendSmsApi', { phoneCode: '86', countryCode: 'CN', loginId: phone, codeLength: this.codeLength })
    if (!this.blocked(data)) {
      if (!rejected && typeof data.smsToken === 'string' && data.smsToken.length > 0 && data.smsToken.length <= 16384) {
        this.pending = { phone, token: data.smsToken }; this.state = 'code-sent'; this.diagnostic('sms-code-sent', this.attemptId)
      } else this.state = 'send-rejected'
    }
    return this.summary()
  }

  /** @param code - explicit UI input. @param protocol - destination policy. @param attemptId - reference from the matching send result. @returns state requiring separate Hema verification before saving. */
  async complete(code, protocol, attemptId) {
    if (!attemptId || attemptId !== this.attemptId) throw new LoginError('本次短信登录已更新或取消，请重新获取验证码')
    if (!this.pending || this.state !== 'code-sent') throw new LoginError('请先获取验证码')
    z.string().regex(/^\d{4,8}$/).parse(code); this.state = 'login-unknown'
    const { data, rejected } = await this.post('smsLoginApi', { phoneCode: '86', countryCode: 'CN', loginId: this.pending.phone,
      smsCode: code, smsToken: this.pending.token, keepLogin: 'false' })
    if (this.blocked(data)) return this.summary()
    if (rejected) { this.state = 'code-sent'; throw new LoginError('验证码未通过，请检查验证码或重新获取') }
    for (const key of ['asyncUrls', 'miniVsts']) {
      if (data[key] === undefined) continue
      const urls = z.array(z.string().max(4096)).max(32).parse(data[key])
      for (const value of urls) {
        const url = new URL(value)
        if (protocol.allowedHosts.includes(url.hostname)) await followLoginRedirects(this.http, value, protocol)
      }
    }
    for (const key of ['redirectUrl', 'parentRedirectUrl']) if (data[key]) await followLoginRedirects(this.http, z.string().max(4096).parse(data[key]), protocol)
    this.state = 'login-unconfirmed'; this.diagnostic('sms-session-received', this.attemptId); return this.summary()
  }

  /** @returns private-view status without raw credentials or request data. */
  summary() { return { state: this.state, loginMethod: 'taobao-sms', attemptId: this.attemptId, codePending: Boolean(this.pending),
    ...(this.pending ? { maskedPhone: this.pending.phone.slice(0, 3) + '****' + this.pending.phone.slice(-4) } : {}) } }

  /** Dispose the temporary jar and discard all transient request values. */
  async close() {
    await this.http?.dispose(); this.http = undefined; this.form = undefined; this.api = undefined; this.pending = undefined; this.referer = undefined; this.attemptId = undefined; this.state = 'logged-out'
  }
}
