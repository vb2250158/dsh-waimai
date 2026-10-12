/** HTTP SMS login. Cookies and challenge tokens stay in the MCP process and local state. */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { request } from 'playwright-core'
import { writeJsonState } from './automation.js'
import { OrderCursor, profileData, orderPage } from './account-data.js'
import { TaobaoQrSession } from './taobao-qr.js'
import { exchangeTaobaoSession } from './taobao-ucc.js'
import { loginResponseDiagnostic } from './login-diagnostics.js'

/** Private MCP endpoints are called by the authenticated settings RPC only. */
export const LOGIN_TOOLS = ['login_status', 'login_send_code', 'login_complete', 'login_qr_start', 'login_qr_poll', 'login_qr_cancel', 'account_profile', 'account_orders', 'platform_list', 'account_addresses', 'account_select_address', 'account_recent_shops', 'account_nearby_shops', 'account_probe_menu', 'account_product_detail', 'account_cart', 'account_cart_change', 'account_checkout', 'account_submit', 'account_trade_history', 'account_list', 'account_begin', 'account_cancel', 'account_view', 'account_use_taobao']

/** Only these local messages may cross the settings RPC; network errors can contain tokens. */
export class LoginError extends Error {}

/** Read an assigned JSON object without evaluating the remote page's JavaScript.
 * @param html - bootstrap response.
 * @param name - required assignment name.
 * @returns parsed object.
 */
export function assignedJson(html, name) {
  const match = new RegExp(`(?:window\\.)?${name}\\s*=\\s*\\{`).exec(html)
  if (!match) throw new LoginError('平台登录初始化字段缺失，请更新插件')
  const start = match.index + match[0].length - 1
  let depth = 0, quoted = false, escaped = false
  for (let i = start; i < html.length; i++) {
    const char = html[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) {
      return JSON.parse(html.slice(start, i + 1))
    }
  }
  throw new LoginError('平台登录初始化数据不完整')
}

/** Limit both initial and redirected requests to the captured login hosts.
 * @param value - platform-provided URL.
 * @param protocol - packaged protocol description.
 * @returns validated URL string.
 */
export function loginUrl(value, protocol) {
  const url = new URL(value, protocol.origin)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !protocol.allowedHosts.includes(url.hostname)) {
    throw new LoginError('平台返回了未支持的登录地址，已停止')
  }
  return url.href
}

/** Read the platform's login response; transport success does not imply authentication.
 * @param raw - parsed platform JSON.
 * @returns response data.
 */
function responseData(raw) {
  const data = raw?.content?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new LoginError('平台登录响应无法识别')
  return data
}

/** Recognize a verified platform account identifier, without returning it to the UI. */
function hasAccount(data) {
  return (typeof data.user_id === 'string' && /^[1-9]\d*$/.test(data.user_id))
    || (typeof data.user_id === 'number' && Number.isSafeInteger(data.user_id) && data.user_id > 0)
}

/** Stop interactive verification and registration instead of guessing their outcome. */
function blocked(data) {
  if (data.isCheckCodeShowed || data.iframeRedirect || data.conToken || data.scene) return 'verification-required'
  if (data.smsRegToken) return 'registration-required'
  return undefined
}

/** Remove the login page's remembered username/country hints from durable and browser state. */
function authenticationState(state) {
  return { ...state, cookies: state.cookies.filter(cookie => !cookie.name.startsWith('last_u_') && cookie.name !== 'last_cc') }
}

/** Own one cookie jar and one pending SMS exchange. All operations are serialized. */
export class WaimaiLogin {
  /**
   * @param options - state path, persistence, timeout, resend delay, and optional request factory for tests.
   */
  constructor({ statePath, persistLogin = true, timeoutMs = 20000, resendSeconds = 60, historyPageSize = 10, qrLifetimeSeconds = 180, qrAuthorizationSeconds = 60, qrPollSeconds = 2, platformId = 'taobao', diagnostic = () => {}, createContext = options => request.newContext(options) }) {
    this.statePath = statePath
    this.persistLogin = persistLogin
    this.timeoutMs = timeoutMs
    this.resendSeconds = resendSeconds
    this.historyPageSize = historyPageSize
    this.createContext = createContext
    this.platformId = platformId
    this.diagnostic = diagnostic
    this.qrPollSeconds = qrPollSeconds
    this.qr = new TaobaoQrSession({ createContext, timeoutMs, lifetimeSeconds: qrLifetimeSeconds, authorizationSeconds: qrAuthorizationSeconds,
      diagnostic: (stage, raw) => this.traceLogin(stage, raw) })
    this.chain = Promise.resolve()
    this.state = 'not-checked'
    this.lastAttempt = 0
  }

  /** @param stage - local operation name. @param raw - optional remote response, projected before logging. */
  traceLogin(stage, raw) {
    this.diagnostic({ group: 'waimai-login', platform: this.platformId, attemptId: this.loginAttemptId || this.qr.id,
      stage, ...(raw === undefined ? {} : loginResponseDiagnostic(raw)) })
  }

  /** Serialize operations; a rejected call does not block later status checks. */
  run(operation) {
    const task = this.chain.then(operation).catch(error => {
      if (error instanceof LoginError) throw error
      throw new LoginError('平台登录请求失败或结果未确认，请检查网络和登录状态；不要重复提交')
    })
    this.chain = task.then(() => {}, () => {})
    return task
  }

  /** Initialize the HTTP cookie jar; corrupt durable state stops login rather than clearing it. */
  async init() {
    if (this.http) return
    this.protocol = JSON.parse(await readFile(new URL('./login-protocol.json', import.meta.url), 'utf8'))
    let saved
    if (this.persistLogin) {
      try { saved = JSON.parse(await readFile(this.statePath, 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw new LoginError('本机登录记录无法读取，请先检查备份') }
      if (saved && (saved.version !== 1 || !Array.isArray(saved.storageState?.cookies) || !Array.isArray(saved.storageState?.origins))) throw new LoginError('本机登录记录格式无法识别')
    }
    this.http = await this.createContext({ timeout: this.timeoutMs, maxRedirects: 0,
      ...(saved ? { storageState: saved.storageState } : {}) })
    this.authenticated = saved?.authenticated === true
    this.loginMethod = saved?.loginMethod === 'taobao-qr' ? 'taobao-qr' : 'sms'
  }

  /** Follow only validated HTTPS redirects; never forward login bodies through redirects. */
  async get(url) {
    for (let i = 0; i < 6; i++) {
      const response = await this.http.get(loginUrl(url, this.protocol), { maxRedirects: 0 })
      if (response.status() >= 300 && response.status() < 400) {
        const next = response.headers().location
        if (!next) throw new LoginError('平台登录跳转地址缺失')
        url = new URL(next, url).href
        continue
      }
      if (!response.ok()) throw new LoginError(`平台登录请求失败（HTTP ${response.status()}）`)
      return response
    }
    throw new LoginError('平台登录跳转次数过多，已停止')
  }

  /** Fetch fresh CSRF and session parameters via HTTP, without opening a browser. */
  async bootstrap() {
    await this.init()
    const url = new URL(this.protocol.bootstrapPath, this.protocol.origin)
    url.search = new URLSearchParams({ ...this.protocol.bootstrapQuery, notKeepLogin: String(!this.persistLogin), rnd: String(Date.now()) }).toString()
    const response = await this.get(url.href)
    const html = await response.text()
    if (html.length > 2_000_000) throw new LoginError('平台登录初始化响应过大')
    const view = assignedJson(html, 'viewData')
    const config = assignedJson(html, 'viewConfig')
    if (!view.loginFormData || typeof view.loginFormData._csrf_token !== 'string' || !config.api) throw new LoginError('平台登录初始化缺少会话参数')
    const api = {}
    for (const [key, path] of Object.entries(this.protocol.apiPaths)) {
      if (typeof config.api[key] !== 'string') throw new LoginError('平台登录接口缺失，请更新插件')
      const endpoint = new URL(loginUrl(config.api[key], this.protocol))
      if (endpoint.origin !== this.protocol.origin || endpoint.pathname !== path) throw new LoginError('平台登录接口已变更，请更新插件')
      api[key] = endpoint.href
    }
    this.bootstrapData = { form: view.loginFormData, api, referer: url.href,
      umidToken: view.umidToken || view.loginFormData.umidToken || '', codeLength: config.smsCodeLength || 6 }
  }

  /** POST form parameters captured from the platform client; credentials never appear in errors. */
  async post(api, fields = {}) {
    const seed = this.bootstrapData
    const form = { ...seed.form, ...fields, ua: '', umidToken: seed.umidToken, umidTag: 'SERVER' }
    const response = await this.http.post(seed.api[api], { form, maxRedirects: 0,
      headers: { Origin: this.protocol.origin, Referer: seed.referer } })
    if (!response.ok()) throw new LoginError(`平台登录请求失败（HTTP ${response.status()}）`)
    try { return responseData(await response.json()) }
    catch { throw new LoginError('平台登录响应无法识别，可能需要在平台完成验证') }
  }

  /** @param spec - fixed endpoint. @param payload - private request data. @param retryToken - false for mutations and orders. @returns Mtop reply; reads retry expired tokens once. */
  async mtop(spec, payload, retryToken = true) {
    for (let attempt = 0; attempt < (retryToken ? 2 : 1); attempt++) {
      const cookies = (await this.http.storageState()).cookies
      const endpoint = new URL(spec.url)
      const token = (cookies.find(cookie => cookie.name === '_m_h5_tk'
        && (cookie.domain === endpoint.hostname || (cookie.domain.startsWith('.') && endpoint.hostname.endsWith(cookie.domain))))?.value || '').split('_')[0]
      const t = String(Date.now()), data = JSON.stringify(payload)
      const sign = createHash('md5').update(`${token}&${t}&${spec.appKey}&${data}`).digest('hex')
      endpoint.search = new URLSearchParams({ jsv: spec.jsv, appKey: spec.appKey, t, sign,
        api: spec.api, v: spec.version, dataType: 'json', type: 'originaljson', data, ...spec.query }).toString()
      let raw
      if (this.loginAttemptId) this.traceLogin(spec.api + '-request')
      try {
        loginUrl(endpoint.href, this.protocol)
        if (spec.method === 'POST') endpoint.searchParams.delete('data')
        const options = { maxRedirects: 0, headers: spec.headers }
        const response = spec.method === 'POST'
          ? await this.http.post(endpoint.href, { ...options, form: { data } })
          : await this.http.get(endpoint.href, options)
        if (!response.ok()) throw new Error('request rejected')
        raw = await this.readMtopResponse(response)
      }
      catch {
        if (this.loginAttemptId) this.traceLogin(spec.api + '-transport-failed')
        throw new LoginError('业务登录状态暂时无法复核，请稍后检查登录状态')
      }
      if (this.loginAttemptId) this.traceLogin(spec.api, raw)
      if (!Array.isArray(raw.ret) || raw.ret.length === 0 || raw.ret.some(value => typeof value !== 'string')) {
        throw new LoginError('业务登录状态响应无法识别，请更新插件')
      }
      if (raw.ret.some(value => /^FAIL_SYS_TOKEN_(EMPTY|EXOIRED|EXPIRED)::/.test(value))) {
        if (attempt === 0 && retryToken) continue
        throw new LoginError('业务登录令牌未能刷新，请稍后检查登录状态')
      }
      return raw
    }
  }

  /** @param response - successful HTTP response. @returns decoded Mtop JSON. */
  readMtopResponse(response) { return response.json() }

  /** Copy a verified QR account's Taobao cookies for an explicit Hema sign-in; never return this through RPC. */
  exportTaobaoSession() {
    return this.run(async () => {
      await this.requireAccount()
      if (this.loginMethod !== 'taobao-qr') throw new LoginError('请选择已通过淘宝扫码登录的账号')
      const businessAccountId = this.accountId
      const identity = await this.mtop(this.protocol.taobaoIdentity, {})
      if (!identity.ret.some(value => value.startsWith('SUCCESS::')) || !hasAccount({ user_id: identity.data?.userNumId })) {
        throw new LoginError('所选会话的淘宝身份无法确认，请重新扫码登录')
      }
      const accountId = String(identity.data.userNumId)
      const storageState = await this.http.storageState()
      await this.requireAccount()
      const checked = await this.mtop(this.protocol.taobaoIdentity, {})
      if (this.accountId !== businessAccountId || !checked.ret.some(value => value.startsWith('SUCCESS::')) || String(checked.data?.userNumId) !== accountId) {
        throw new LoginError('所选淘宝会话身份已变化，未登录盒马')
      }
      return { accountId, businessAccountId, storageState: { cookies: storageState.cookies.filter(cookie =>
        ['.taobao.com', 'login.taobao.com', '.login.taobao.com'].includes(cookie.domain) && !cookie.name.startsWith('last_u_') && cookie.name !== 'last_cc'), origins: [] } }
    })
  }

  /** Confirm the ordering account and retain its ID only in this process. */
  async checkAccount() {
    const raw = await this.mtop(this.protocol.session, {})
    const account = raw.data?.value
    const authenticated = raw.ret.some(value => value.startsWith('SUCCESS::')) && !raw.data?.errorCode
      && hasAccount({ user_id: account?.localId }) && hasAccount({ user_id: account?.havanaId })
    this.accountId = authenticated ? String(account.localId) : undefined
    this.havanaId = authenticated ? String(account.havanaId) : undefined
    return authenticated
  }

  /** Independently authorize each private account read before requesting user data. */
  async requireAccount() {
    await this.init()
    this.authenticated = await this.checkAccount()
    if (!this.authenticated) { this.state = 'login-unconfirmed'; throw new LoginError('登录状态已失效或无法确认，请检查登录状态') }
  }

  /** Fetch display fields for the current account; never saves profile data.
   * @returns account ID, nickname, masked phone and avatar URL.
   */
  profile() {
    return this.run(async () => {
      await this.requireAccount()
      try { return profileData(await (await this.get(this.protocol.profileUrl + encodeURIComponent(this.accountId))).json(), this.accountId) }
      catch { throw new LoginError('账号资料暂时无法读取，请稍后刷新') }
    })
  }

  /** Read one page using only the server's validated cursor; never saves order history.
   * @param cursor - next position, omitted for the latest orders.
   * @returns bounded order summaries and the next cursor.
   */
  orders(cursor) {
    return this.run(async () => {
      const position = cursor === undefined ? { pageNum: 0, fromTime: 0, lastBillMonth: '00' } : OrderCursor.parse(cursor)
      await this.requireAccount()
      const spec = this.protocol.orders
      const lastBillMonth = position.lastBillMonth || '00'
      const raw = await this.mtop(spec, { tabCode: 'ALL', pageSize: this.historyPageSize, ...position, lastBillMonth,
        latitude: '', longitude: '', cityId: '', extInfo: JSON.stringify({ ...spec.client, lastBillMonth }), sourceFrom: this.loginMethod === 'taobao-qr' ? 'TAOBAO' : 'H5' })
      if (!raw.ret.some(value => value.startsWith('SUCCESS::')) || raw.data?.errorCode) throw new LoginError('历史订单暂时无法读取，请稍后刷新')
      try { return { accountId: this.accountId, ...orderPage(raw.data?.result, this.historyPageSize, position) } }
      catch { throw new LoginError('历史订单或分页信息无法识别，请更新插件') }
    })
  }

  /** Public summary contains neither identifiers nor token values. */
  summary() {
    return { state: this.state, authenticated: this.authenticated === true, loginMethod: this.loginMethod,
      codePending: this.pending !== undefined,
      ...(this.pending ? { maskedPhone: this.pending.maskedPhone } : {}),
      retryAfterSeconds: Math.max(0, Math.ceil((this.lastAttempt + this.resendSeconds * 1000 - Date.now()) / 1000)) }
  }

  /** Create a separate Taobao QR attempt without replacing the current account. */
  qrStart() {
    return this.run(async () => {
      await this.init()
      try { await this.qr.start(this.protocol) }
      catch (error) { await this.qr.close(); throw error }
      this.nextQrPollAt = 0
      this.traceLogin('qr-started')
      return this.qrSummary()
    })
  }

  /** @returns account status and separate QR state, restricted to the private settings RPC. */
  qrSummary() { return { ...this.summary(), qr: { ...this.qr.summary(), pollAfterMs: this.qrPollSeconds * 1000 } } }

  /** Check a QR attempt and activate only a separately verified business account.
   * @param attemptId - reference from qrStart.
   * @returns current account and QR status.
   */
  qrPoll(attemptId) {
    return this.run(async () => {
      if (attemptId !== this.qr.id) throw new LoginError('二维码已更新或取消，请重新获取')
      if (Date.now() < this.nextQrPollAt) return this.qrSummary()
      this.nextQrPollAt = Date.now() + this.qrPollSeconds * 1000
      try {
        await this.qr.poll(attemptId, this.protocol)
        if (this.qr.state === 'business-unconfirmed') await this.activateQr()
        if (!['waiting', 'scanned'].includes(this.qr.state)) this.traceLogin('qr-' + this.qr.state)
      } catch (error) {
        this.traceLogin('qr-failed')
        throw error
      }
      return this.qrSummary()
    })
  }

  /** Verify the fresh QR jar, profile and order parser before committing an account replacement. */
  async activateQr() {
    const candidate = new WaimaiLogin({ statePath: this.statePath, persistLogin: false, timeoutMs: this.timeoutMs,
      historyPageSize: this.historyPageSize, platformId: this.platformId, diagnostic: this.diagnostic, createContext: async () => this.qr.http })
    candidate.loginAttemptId = this.qr.id
    await candidate.init()
    candidate.loginMethod = 'taobao-qr'
    this.traceLogin('business-bootstrap-request')
    await candidate.bootstrap()
    this.traceLogin('business-bootstrap-ready')
    if (!await candidate.checkAccount()) {
      const business = await exchangeTaobaoSession(candidate)
      if (!business) {
        if (candidate.authorizationIssue) { await this.qr.close(); this.qr.state = candidate.authorizationIssue }
        this.traceLogin('ucc-unconfirmed'); return
      }
      const state = await this.qr.http.storageState()
      const incoming = new Map(business.cookies.map(cookie => [cookie.domain + ':' + cookie.path + ':' + cookie.name, cookie]))
      state.cookies = state.cookies.filter(cookie => !incoming.has(cookie.domain + ':' + cookie.path + ':' + cookie.name)).concat(business.cookies)
      const http = await this.createContext({ timeout: this.timeoutMs, maxRedirects: 0, storageState: state })
      const previous = this.qr.http
      this.qr.http = http; candidate.http = http; this.qr.business = business
      await previous.dispose()
      if (!await candidate.checkAccount()) { this.traceLogin('business-session-unconfirmed'); return }
    }
    if (this.qr.business && (candidate.accountId !== this.qr.business.accountId || candidate.havanaId !== this.qr.business.havanaId)) {
      this.traceLogin('business-identity-mismatch')
      throw new LoginError('闪购授权与业务账号身份不一致，原账号仍保留')
    }
    await candidate.profile()
    this.traceLogin('business-profile-verified')
    await candidate.orders()
    this.traceLogin('business-orders-verified')
    if (this.persistLogin) {
      let previous
      try { previous = JSON.parse(await readFile(this.statePath, 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw new LoginError('原登录记录无法备份，未切换账号') }
      if (previous) await writeJsonState(this.statePath + '.previous.json', previous)
      await writeJsonState(this.statePath, { version: 1, authenticated: true, loginMethod: 'taobao-qr', storageState: authenticationState(await this.qr.http.storageState()) })
    }
    const previousHttp = this.http
    this.http = this.qr.http; this.qr.http = undefined; this.qr.business = undefined; this.qr.state = 'linked'
    this.accountId = candidate.accountId; this.havanaId = candidate.havanaId; this.authenticated = true; this.loginMethod = 'taobao-qr'; this.state = 'logged-in'; this.pending = undefined
    await previousHttp.dispose()
  }

  /** Cancel only the named QR attempt; retain the current account and its saved cookies.
   * @param attemptId - reference from qrStart.
   * @returns current account and canceled QR status.
   */
  qrCancel(attemptId) {
    return this.run(async () => {
      if (attemptId !== this.qr.id) throw new LoginError('二维码已更新或取消')
      await this.qr.close()
      return this.qrSummary()
    })
  }

  /** Check the account via HTTP. A pending SMS token survives a status refresh. */
  status() {
    return this.run(async () => {
      if (!this.pending) await this.bootstrap()
      const cookies = (await this.http.storageState()).cookies
      const hasSessionCookie = cookies.some(cookie => cookie.name === 'SID' && cookie.domain === '.ele.me' && cookie.value)
      this.authenticated = hasSessionCookie ? await this.checkAccount() : false
      if (this.authenticated) this.state = 'logged-in'
      else if (!this.pending) this.state = hasSessionCookie ? 'login-unconfirmed' : 'logged-out'
      return this.summary()
    })
  }

  /**
   * Send one SMS after a user click; uncertain attempts consume the resend cooldown.
   * @param phone - mainland mobile number, held in memory only.
   * @returns redacted login progress.
   */
  sendCode(phone) {
    return this.run(async () => {
      await this.qr.close()
      if (typeof phone !== 'string' || !/^1[3-9]\d{9}$/.test(phone)) throw new LoginError('请输入有效的中国大陆手机号')
      if (this.summary().retryAfterSeconds > 0) throw new LoginError('请等待验证码发送间隔结束后重试')
      await this.bootstrap()
      this.pending = undefined
      this.lastAttempt = Date.now()
      this.state = 'send-unknown'
      const data = await this.post('sendSmsApi', { phoneCode: this.protocol.phoneCode,
        countryCode: this.protocol.countryCode, loginId: phone, codeLength: this.bootstrapData.codeLength })
      const challenge = blocked(data)
      if (challenge) this.state = challenge
      else if (typeof data.smsToken === 'string' && data.smsToken.length > 0) {
        this.pending = { phone, smsToken: data.smsToken, maskedPhone: `${phone.slice(0, 3)}****${phone.slice(-4)}` }
        this.state = 'code-sent'
      } else this.state = 'send-rejected'
      return this.summary()
    })
  }

  /**
   * Complete the pending exchange and confirm the account independently before saving cookies.
   * @param code - user-entered SMS code, never persisted.
   * @returns redacted login progress.
   */
  complete(code) {
    return this.run(async () => {
      if (!this.pending) throw new LoginError('请先获取验证码；插件重载后需要重新获取')
      if (typeof code !== 'string' || !/^\d{4,8}$/.test(code)) throw new LoginError('请输入短信验证码')
      this.state = 'login-unknown'
      const data = await this.post('smsLoginApi', { phoneCode: this.protocol.phoneCode, countryCode: this.protocol.countryCode,
        loginId: this.pending.phone, smsCode: code, smsToken: this.pending.smsToken, keepLogin: String(this.persistLogin) })
      const challenge = blocked(data)
      if (challenge) { this.state = challenge; return this.summary() }
      if (!hasAccount(data)) { this.state = 'login-rejected'; return this.summary() }
      if ((data.asyncUrls && !Array.isArray(data.asyncUrls)) || (data.miniVsts && !Array.isArray(data.miniVsts))) throw new LoginError('平台登录同步响应无法识别')
      const urls = [...(data.asyncUrls || []), ...(data.miniVsts || [])]
      if (urls.length > 12 || urls.some(url => typeof url !== 'string')) throw new LoginError('平台登录同步响应无法识别')
      for (const url of urls) await this.get(url)
      for (const key of ['redirectUrl', 'parentRedirectUrl']) if (data[key]) await this.get(data[key])
      this.authenticated = await this.checkAccount()
      if (!this.authenticated) { this.state = 'login-unconfirmed'; return this.summary() }
      this.state = 'logged-in'
      this.loginMethod = 'sms'
      if (this.persistLogin) {
        try { await writeJsonState(this.statePath, { version: 1, authenticated: true, storageState: authenticationState(await this.http.storageState()) }) }
        catch { throw new LoginError('已登录，但本机登录记录保存失败；重启后可能需要重新登录') }
      }
      this.pending = undefined
      return this.summary()
    })
  }

  /** Return cookies only to the owning browser runtime, never through RPC or model tools. */
  cookies() {
    return this.run(async () => { await this.init(); return this.authenticated ? authenticationState(await this.http.storageState()).cookies : [] })
  }

  /** Dispose the HTTP jar after its pending operations finish. */
  close() { return this.run(async () => { await this.qr.close(); await this.http?.dispose(); this.http = undefined; this.pending = undefined }) }
}
