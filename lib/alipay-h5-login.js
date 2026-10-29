/** Private form projection for the official H5 page; user inputs never become saved settings. */
import { TradeError } from './trade-data.js'
import { randomUUID } from 'node:crypto'

const origin = 'https://maliprod.alipay.com'
const phoneButton = '[data-aspm-click="c106426.d220737"], [data-aspm-click="c465146.d684449"]'
const smsInput = '.sms-verify .passcode-input-wrap input[autocomplete="one-time-code"]'
const smsResend = '.sms-verify .countdown-wrap__resend'
const channelRows = '[data-channel-exposure-value]'
const channelLoginButton = '[data-aspm-click="c465136.d684422"]'
const loginActions = new Set(['cashierMain', 'refresh', 'refreshNoAuth', 'unifiedLogin', 'accountLogin',
  'toAccountLogin', 'toUnifiedLogin', 'smsValidateLogin', 'smsResendLogin', 'cashierPayResultQuery'])
const diagnosticReasons = new Set(['unexpected-write', 'unsupported-request', 'unsupported-step', 'provider-confirmation',
  'no-eligible-channel', 'response-unavailable', 'response-invalid', 'presentation-timeout', 'presentation-mismatch',
  'input-timeout', 'origin-changed'])

/** @param action - observed action name. @returns a fixed known action or other, never the unrecognized input. */
export function loginDiagnosticAction(action) { return loginActions.has(action) ? action : 'other' }

/** @param reason - local failure category. @param context - transient response context. @returns only fixed enums and booleans, with no retained provider data. */
export function loginDiagnostic(reason, { action, raw, data = raw?.data } = {}) {
  const biz = data?.bizData || {}
  const emptyObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
  const step = !data ? 'missing' : data.controlType === 'unified_login' ? biz.h5RegisterBindPay ? 'channel' : 'phone'
    : data.controlType === 'need_loginsms_verify' ? 'sms' : data.controlType === 'cashier_pre_confirm' ? 'preconfirm' : 'other'
  return { reason: diagnosticReasons.has(reason) ? reason : 'other', action: loginDiagnosticAction(action), step,
    agreementCheck: parseLoginAgreements(data).reason,
    flags: { responseSeen: raw !== undefined, success: raw?.success === true, businessError: Boolean(data?.bizError),
      redirect: Boolean(raw?.needRedirect || raw?.redirectUrl), topWindow: Boolean(raw?.wnd), topWindowEmpty: emptyObject(raw?.wnd),
      dataWindow: Boolean(data?.wnd), dataWindowEmpty: emptyObject(data?.wnd), halfScreen: Boolean(data?.h5HalfScreen),
      registration: Boolean(biz.registering || biz.h5AutoRegisterQuser), agreement: Boolean(biz.protocols?.length || biz.protocolName),
      namedProtocol: Boolean(biz.protocolName),
      charge: Boolean(biz.chargeMsg), newCard: biz.pwdValidateType === 'newCard', openService: biz.pwdValidateType === 'openService',
      registerBindPay: Boolean(biz.h5RegisterBindPay), hasChannelMap: Boolean(biz.channelInfoMap && typeof biz.channelInfoMap === 'object'),
      hasEligibleChannel: loginChannels(data).length > 0 } }
}

/** @param data - current provider page. @returns public login agreements, or null when their contents cannot be safely presented. */
export function loginAgreements(data) {
  return parseLoginAgreements(data).agreements
}

/** Classify rejected public agreement fields without retaining provider text or addresses. */
function parseLoginAgreements(data) {
  const biz = data?.bizData || {}, protocols = biz.protocols
  const reject = reason => ({ agreements: null, reason })
  if (protocols == null || (Array.isArray(protocols) && protocols.length === 0)) return { agreements: [], reason: 'none' }
  if (data.controlType !== 'unified_login' || !biz.h5RegisterBindPay) return reject('unsupported-page')
  if (!Array.isArray(protocols) || protocols.length > 12) return reject('invalid-list')
  const agreements = []
  for (const item of protocols) {
    // The provider's inline title uses name; its agreement list uses text.
    const name = item?.name ?? item?.text
    if (typeof name !== 'string' || !name.trim() || name.length > 160 || /[\u0000-\u001f\u007f]/.test(name)
      || (item.name != null && item.text != null && item.name !== item.text)) return reject('invalid-name')
    if (typeof item.url !== 'string' || item.url.length > 2000) return reject('invalid-url')
    let url
    try { url = new URL(item.url) } catch { return reject('invalid-url') }
    if (url.protocol !== 'https:') return reject('non-https')
    if (url.hostname !== 'render.alipay.com') return reject('unsupported-host')
    if (url.port || url.username || url.password) return reject('url-authority')
    if (!url.pathname.startsWith('/p/')) return reject('unsupported-path')
    if (url.hash) return reject('url-fragment')
    if ([...url.searchParams].some(([key]) => key !== 'agreementId')) return reject('unsupported-query')
    if ([...url.searchParams.values()].some(value => !/^AG\d{8}$/.test(value))) return reject('invalid-agreement-id')
    agreements.push({ name: name.trim(), url: url.href })
  }
  return { agreements, reason: 'accepted' }
}

function loginChannels(data) {
  const biz = data?.bizData || {}, map = biz.channelInfoMap
  if (!map || typeof map !== 'object') return []
  const codes = ['transferChannel', 'balanceChannel', 'otherChannel']
  const groups = Array.isArray(biz.groups) && biz.groups.length ? biz.groups : codes.map(groupCode => ({ groupCode }))
  const seen = new Set(), items = []
  for (const group of groups) {
    if (!codes.includes(group?.groupCode) || seen.has(group.groupCode)) continue
    seen.add(group.groupCode)
    if (Array.isArray(map[group.groupCode])) items.push(...map[group.groupCode])
  }
  return items.filter(item => item && typeof item.value === 'string' && item.value.length > 0 && item.value.length <= 256
    && typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 120
    && !item.action && !item.disable && !loginNeedsExternal({ bizData: item })
    && !loginNeedsExternal({ bizData: item.params })
    && items.filter(other => other?.value === item.value).length === 1)
}

/** @param data - private provider response. @returns whether continuing would involve unsupported registration or agreements. */
export function loginNeedsExternal(data) {
  const biz = data?.bizData || {}
  return Boolean(biz.registering || biz.h5AutoRegisterQuser || loginAgreements(data) === null || biz.protocolName
    || biz.chargeMsg || biz.pwdValidateType === 'newCard' || biz.pwdValidateType === 'openService')
}

/** @param data - private provider response. @returns a bounded input description without provider text or credentials. */
export function loginInput(data) {
  if (!data) return { kind: 'pending' }
  if (loginNeedsExternal(data)) return { kind: 'external', diagnostic: loginDiagnostic('provider-confirmation', { data }) }
  if (data.controlType === 'unified_login') {
    if (data.bizData?.h5RegisterBindPay) return loginChannels(data).length ? { kind: 'channel' }
      : { kind: 'external', diagnostic: loginDiagnostic('no-eligible-channel', { data }) }
    return { kind: 'phone' }
  }
  if (data.controlType === 'need_loginsms_verify') return { kind: 'sms', codeLength: data.bizData?.use4sms === 'true' ? 4 : 6 }
  if (data.controlType === 'cashier_pre_confirm' && !data.bizError) return null
  return { kind: 'external', diagnostic: loginDiagnostic('unsupported-step', { data }) }
}

/** Owns one official page and serial input attempts; selectors are fixed to inspected Alipay controls. */
export class H5InlineLogin {
  constructor(page, timeoutMs) {
    this.page = page; this.timeoutMs = timeoutMs; this.data = null
    this.external = false; this.pending = false; this.closed = false; this.waiter = null
    this.channels = new Map()
    this.diagnostic = null
    this.agreementRef = null
  }

  /** @param data - parsed official API data, checked before the page may act on it. */
  observe(data, action) {
    if (this.closed) return
    if (this.pending && action !== this.expectedAction) return
    this.data = data; this.pending = false; this.external = loginNeedsExternal(data)
    this.agreementRef = loginAgreements(data)?.length ? randomUUID() : null
    const input = loginInput(data)
    if (input?.kind !== 'external') this.diagnostic = null
    else if (!this.diagnostic) this.diagnostic = loginDiagnostic(input.diagnostic.reason, { data, action })
    this.channels.clear()
    for (const channel of loginChannels(data)) this.channels.set(randomUUID(), channel)
    this.waiter?.(); this.waiter = null
  }

  /** @returns completion after the initial API response or the configured deadline. */
  async initialized() {
    if (this.data || this.closed || this.external) return
    let timer
    try { await new Promise(resolve => {
      this.waiter = resolve; timer = setTimeout(resolve, this.timeoutMs)
    }) } finally { clearTimeout(timer); this.waiter = null }
  }

  /** A resend has no next-page data; retain the current SMS form. */
  acknowledgeResend() {
    if (this.closed || this.expectedAction !== 'smsResendLogin') return
    this.pending = false; this.external = false; this.diagnostic = null; this.waiter?.(); this.waiter = null
  }

  /** Stop background input while leaving the provider's extra verification to the user. */
  requireExternal(reason, context) {
    if (this.closed) return
    this.recordDiagnostic(reason, context)
    this.external = true; this.waiter?.(); this.waiter = null
  }

  /** @param reason - local fixed category. @param context - transient response evidence. Record the first cause without changing request handling. */
  recordDiagnostic(reason, context) {
    if (!this.closed && !this.diagnostic) this.diagnostic = loginDiagnostic(reason, context)
  }

  /** @param action - observed official write action. @returns whether this explicit input owns its sole outgoing request. */
  consumeRequest(action) {
    if (this.closed || this.external || !this.pending || this.expectedAction !== action || this.requestConsumed) return false
    this.requestConsumed = true
    return true
  }

  /** @param data - next official step. @returns after its input or confirmation page is rendered. */
  async presented(data) {
    const input = loginInput(data)
    if (input?.kind === 'channel') {
      await this.page.locator(channelRows).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: this.timeoutMs })
    } else if (input?.kind === 'phone') {
      await this.page.getByPlaceholder(/请输入支付宝账号\(手机号\/邮箱\)|请输入手机号/).filter({ visible: true }).waitFor({ state: 'visible', timeout: this.timeoutMs })
    } else if (input?.kind === 'sms') {
      await this.page.locator(smsInput).filter({ visible: true }).waitFor({ state: 'visible', timeout: this.timeoutMs })
    } else if (!input) {
      await this.page.waitForURL(url => url.origin === origin && url.pathname === '/h5pay/cashierPreConfirm/index.html', { timeout: this.timeoutMs })
    }
  }

  /** @returns after the official resend button is replaced by its countdown. */
  async resendCoolingDown() {
    await this.page.locator(smsResend).filter({ visible: true }).waitFor({ state: 'hidden', timeout: this.timeoutMs })
  }

  /** @param selector - fixed inspected control. @returns a unique visible locator or a local error. */
  async control(selector) {
    const locator = this.page.locator(selector).filter({ visible: true })
    if (await locator.count() !== 1) throw new TradeError('h5-login-control-unavailable', '支付宝登录控件尚未就绪，请刷新验证状态')
    return locator
  }

  /** @returns only the current editable field and supported actions. */
  async describe() {
    if (this.closed || this.page.isClosed()) throw new TradeError('h5-verification-unavailable', '支付宝登录会话已关闭，请重新连接')
    if (new URL(this.page.url()).origin !== origin) {
      if (!this.diagnostic) this.diagnostic = loginDiagnostic('origin-changed', { data: this.data })
      return { kind: 'external', diagnostic: this.diagnostic }
    }
    if (this.external) return { kind: 'external', diagnostic: this.diagnostic || loginDiagnostic('other') }
    if (this.pending) return { kind: 'pending' }
    const input = loginInput(this.data)
    if (input?.kind === 'external') {
      if (!this.diagnostic) this.diagnostic = input.diagnostic
      return { kind: 'external', diagnostic: this.diagnostic }
    }
    if (input?.kind === 'channel') {
      const phone = this.page.getByPlaceholder(/请输入手机号/).filter({ visible: true })
      if (await phone.count() === 1) {
        const agreements = loginAgreements(this.data)
        return { kind: 'phone', ...(agreements?.length ? { agreements, agreementRef: this.agreementRef } : {}) }
      }
      return { kind: 'channel', channels: [...this.channels].map(([channelRef, item]) => ({ channelRef, label: item.name })) }
    }
    if (input?.kind === 'sms') {
      const resend = this.page.locator(smsResend).filter({ visible: true })
      input.canResend = await resend.count() === 1 && await resend.isEnabled()
    }
    return input
  }

  /** @param args - one explicitly submitted phone, code or resend action. @returns the next provider-requested input. */
  async submit(args) {
    const input = await this.describe()
    if (this.pending || this.waiter) throw new TradeError('h5-login-pending', '上一条登录请求尚未确认，请刷新状态，不要重复提交')
    if (args.agreementRef !== undefined && args.operation !== 'phone') throw new TradeError('h5-login-input-invalid', '当前登录步骤或输入无效')
    if (args.operation === 'channel') return this.selectChannel(args, input)
    let act
    if (args.operation === 'phone' && input?.kind === 'phone' && /^\d{11}$/.test(args.phone || '') && args.code === undefined) {
      const agreementRef = input.agreementRef || null
      if ((args.agreementRef || null) !== agreementRef) throw new TradeError('h5-login-agreement-required', '请阅读并勾选当前登录协议')
      const field = this.page.getByPlaceholder(/请输入支付宝账号\(手机号\/邮箱\)|请输入手机号/).filter({ visible: true })
      if (await field.count() !== 1) throw new TradeError('h5-login-control-unavailable', '支付宝手机号输入框尚未就绪，请刷新验证状态')
      const button = await this.control(phoneButton)
      act = async () => {
        if (this.agreementRef !== agreementRef) throw new TradeError('h5-login-agreement-required', '登录协议已变化，请重新阅读并确认')
        await field.fill(args.phone, { timeout: this.timeoutMs })
        if (this.agreementRef !== agreementRef) throw new TradeError('h5-login-agreement-required', '登录协议已变化，请重新阅读并确认')
        await button.click({ timeout: this.timeoutMs })
      }
    } else if (args.operation === 'sms' && input?.kind === 'sms' && new RegExp('^\\d{' + input.codeLength + '}$').test(args.code || '') && args.phone === undefined) {
      const field = await this.control(smsInput)
      // The official component submits on fill. Never also click or press Enter.
      act = () => field.fill(args.code, { timeout: this.timeoutMs })
    } else if (args.operation === 'resend' && input?.kind === 'sms' && input.canResend && args.phone === undefined && args.code === undefined) {
      const button = await this.control(smsResend)
      act = () => button.click({ timeout: this.timeoutMs })
    } else throw new TradeError('h5-login-input-invalid', '当前登录步骤或输入无效，请刷新状态后核对')
    this.pending = true
    this.requestConsumed = false
    this.expectedAction = { phone: 'unifiedLogin', sms: 'smsValidateLogin', resend: 'smsResendLogin' }[args.operation]
    let timer
    const completed = new Promise(resolve => {
      this.waiter = resolve
      timer = setTimeout(() => { this.requireExternal('input-timeout', { action: this.expectedAction, data: this.data }); resolve() }, this.timeoutMs)
    })
    try {
      await act(); await completed
      if (args.operation !== 'resend' && this.data?.bizError) throw new TradeError('h5-login-rejected', '支付宝未接受本次登录输入，请核对后重试')
      return await this.describe()
    } catch (error) {
      if (error instanceof TradeError) throw error
      this.requireExternal(error?.name === 'TimeoutError' ? 'presentation-timeout' : 'presentation-mismatch', { data: this.data })
      throw new TradeError('h5-login-unconfirmed', '登录请求结果未确认，请刷新状态；未自动重发')
    } finally { clearTimeout(timer); this.waiter = null }
  }

  /** @param args - current opaque channel reference. @param input - current projected step. @returns the phone form after opening the official login panel, without a network write. */
  async selectChannel(args, input) {
    const item = this.channels.get(args.channelRef), data = this.data
    if (input?.kind !== 'channel' || args.phone !== undefined || args.code !== undefined || !item
      || !loginChannels(this.data).includes(item)) {
      throw new TradeError('h5-login-input-invalid', '当前登录渠道已变化，请刷新后选择')
    }
    this.pending = true; this.expectedAction = null; this.requestConsumed = true
    try {
      const rows = this.page.locator(channelRows).filter({ visible: true })
      const values = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-channel-exposure-value')))
      if (values.filter(value => value === item.value).length !== 1) throw new TradeError('h5-login-control-unavailable', '支付宝登录渠道尚未就绪，请刷新状态')
      const row = rows.nth(values.indexOf(item.value))
      // The provider ignores clicks on the selected row. Its fixed footer opens login only for an action-free channel.
      const selected = await row.locator('.ChannelWrap--selected').count() === 1
      const button = selected ? await this.control(channelLoginButton) : row.locator('[data-aspm-click]').filter({ visible: true })
      if (await button.count() !== 1) throw new TradeError('h5-login-control-unavailable', '支付宝登录渠道控件无法确认')
      if (this.closed || this.external || this.data !== data || loginNeedsExternal(data) || !loginChannels(data).includes(item)) {
        throw new TradeError('h5-login-input-invalid', '当前登录渠道已变化，请刷新后选择')
      }
      await button.click({ timeout: this.timeoutMs })
      await this.page.getByPlaceholder(/请输入手机号/).filter({ visible: true }).waitFor({ state: 'visible', timeout: this.timeoutMs })
      if (this.closed || this.external) throw new TradeError('h5-login-unconfirmed', '支付宝要求额外验证，请刷新状态')
      this.pending = false
      return await this.describe()
    } catch (error) {
      this.pending = false
      this.requireExternal(error?.name === 'TimeoutError' ? 'presentation-timeout' : 'presentation-mismatch', { data: this.data })
      if (error instanceof TradeError) throw error
      throw new TradeError('h5-login-unconfirmed', '登录渠道尚未打开，请刷新状态；未自动重试')
    }
  }

  /** Resolve local waiters and discard all private response data on account disposal. */
  close() { this.closed = true; this.data = null; this.channels.clear(); this.diagnostic = null; this.agreementRef = null; this.waiter?.(); this.waiter = null }
}
