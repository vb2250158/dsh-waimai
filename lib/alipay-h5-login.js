/** Private form projection for the official H5 page; user inputs never become saved settings. */
import { TradeError } from './trade-data.js'

const origin = 'https://maliprod.alipay.com'
const phoneButton = '[data-aspm-click="c106426.d220737"], [data-aspm-click="c465146.d684449"]'
const smsInput = '.sms-verify .passcode-input-wrap input[autocomplete="one-time-code"]'
const smsResend = '.sms-verify .countdown-wrap__resend'

/** @param data - private provider response. @returns whether continuing would involve unsupported registration or agreements. */
export function loginNeedsExternal(data) {
  const biz = data?.bizData || {}
  return Boolean(biz.registering || biz.h5AutoRegisterQuser || biz.protocols?.length || biz.protocolName
    || biz.chargeMsg || biz.pwdValidateType === 'newCard' || biz.pwdValidateType === 'openService')
}

/** @param data - private provider response. @returns a bounded input description without provider text or credentials. */
export function loginInput(data) {
  if (!data) return { kind: 'pending' }
  if (loginNeedsExternal(data)) return { kind: 'external' }
  if (data.controlType === 'unified_login') return { kind: 'phone' }
  if (data.controlType === 'need_loginsms_verify') return { kind: 'sms', codeLength: data.bizData?.use4sms === 'true' ? 4 : 6 }
  if (data.controlType === 'cashier_pre_confirm' && !data.bizError) return null
  return { kind: 'external' }
}

/** Owns one official page and serial input attempts; selectors are fixed to inspected Alipay controls. */
export class H5InlineLogin {
  constructor(page, timeoutMs) {
    this.page = page; this.timeoutMs = timeoutMs; this.data = null
    this.external = false; this.pending = false; this.closed = false; this.waiter = null
  }

  /** @param data - parsed official API data, checked before the page may act on it. */
  observe(data, action) {
    if (this.closed) return
    if (this.pending && action !== this.expectedAction) return
    this.data = data; this.pending = false; this.external = loginNeedsExternal(data)
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
    this.pending = false; this.external = false; this.waiter?.(); this.waiter = null
  }

  /** Stop background input while leaving the provider's extra verification to the user. */
  requireExternal() { this.external = true; this.waiter?.(); this.waiter = null }

  /** @param action - observed official write action. @returns whether this explicit input owns its sole outgoing request. */
  consumeRequest(action) {
    if (this.closed || this.external || !this.pending || this.expectedAction !== action || this.requestConsumed) return false
    this.requestConsumed = true
    return true
  }

  /** @param data - next official step. @returns after its input or confirmation page is rendered. */
  async presented(data) {
    const input = loginInput(data)
    if (input?.kind === 'phone') {
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
    if (new URL(this.page.url()).origin !== origin) return { kind: 'external' }
    if (this.external) return { kind: 'external' }
    if (this.pending) return { kind: 'pending' }
    const input = loginInput(this.data)
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
    let act
    if (args.operation === 'phone' && input?.kind === 'phone' && /^\d{11}$/.test(args.phone || '') && args.code === undefined) {
      const field = this.page.getByPlaceholder(/请输入支付宝账号\(手机号\/邮箱\)|请输入手机号/).filter({ visible: true })
      if (await field.count() !== 1) throw new TradeError('h5-login-control-unavailable', '支付宝手机号输入框尚未就绪，请刷新验证状态')
      const button = await this.control(phoneButton)
      act = async () => { await field.fill(args.phone, { timeout: this.timeoutMs }); await button.click({ timeout: this.timeoutMs }) }
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
      timer = setTimeout(() => { this.external = true; resolve() }, this.timeoutMs)
    })
    try {
      await act(); await completed
      if (args.operation !== 'resend' && this.data?.bizError) throw new TradeError('h5-login-rejected', '支付宝未接受本次登录输入，请核对后重试')
      return await this.describe()
    } catch (error) {
      if (error instanceof TradeError) throw error
      this.external = true
      throw new TradeError('h5-login-unconfirmed', '登录请求结果未确认，请刷新状态；未自动重发')
    } finally { clearTimeout(timer); this.waiter = null }
  }

  /** Resolve local waiters and discard all private response data on account disposal. */
  close() { this.closed = true; this.data = null; this.waiter?.(); this.waiter = null }
}
