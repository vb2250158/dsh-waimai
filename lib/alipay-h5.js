/** Stateful Alipay H5 transport. Session material stays private; order reconciliation owns payment success. */
import { createPublicKey, publicEncrypt, constants } from 'node:crypto'
import { TradeError, cents } from './trade-data.js'

const origin = 'https://maliprod.alipay.com'
const authentication = new Set(['unified_login', 'need_login_new', 'need_loginsms_verify', 'verify_check',
  'cashier_verify_identity', 'cashier_safeprotect_pwd', 'open_pwd_check'])
const paths = { cashier_pre_confirm: '/h5pay/cashierPreConfirm/index.html', pwd_validate: '/h5pay/pwdValidate/index.html',
  unified_login: '/h5pay/unifiedLogin/index.html' }

/** @param value - original private H5 page URL. @returns its validated destination without normalizing signed query values. */
export function h5Entry(value) {
  let url
  try { url = new URL(value) } catch { throw new TradeError('h5-entry-invalid', 'H5 支付入口无效') }
  if (url.origin !== origin || url.username || url.password || !url.pathname.startsWith('/h5pay/')) {
    throw new TradeError('h5-entry-invalid', 'H5 支付入口无效')
  }
  return url
}

/** @param search - observed location.search. @returns official primary-parser values, retaining plus signs and repeated keys. */
export function h5Query(search) {
  const result = Object.create(null)
  if (!search) return result
  try {
    for (const part of search.replace(/^.*\?/, '').split('&')) {
      const [rawKey, rawValue] = part.split('=')
      const key = decodeURIComponent(rawKey), value = decodeURIComponent(rawValue)
      if (!Object.hasOwn(result, key)) result[key] = value
      else if (Array.isArray(result[key])) result[key].push(value)
      else result[key] = [result[key], value]
    }
  } catch { throw new TradeError('h5-entry-invalid', 'H5 支付参数无法解析') }
  return result
}

/** @param password - ephemeral private input. @param modulus - current server RSA modulus. @returns official per-character encrypted input. */
export function h5Password(password, modulus) {
  if (typeof password !== 'string' || !password || password.length > 100
    || typeof modulus !== 'string' || !/^[a-f\d]{256,1024}$/i.test(modulus)) {
    throw new TradeError('h5-verification-invalid', '支付验证输入或当前公钥无效')
  }
  const hex = modulus.length % 2 ? '0' + modulus : modulus
  const key = createPublicKey({ format: 'jwk', key: { kty: 'RSA', n: Buffer.from(hex, 'hex').toString('base64url'), e: 'AQAB' } })
  return password.split('').map(character => {
    const c = character.charCodeAt(0)
    const bytes = c < 128 ? [c] : c < 2048 ? [c >> 6 | 192, c & 63 | 128]
      : [c >> 12 | 224, c >> 6 & 63 | 128, c & 63 | 128]
    return publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(bytes))
      .toString('base64').match(/.{1,64}/g).join('\n')
  }).join(',')
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) }

function actionPath(value) {
  if (typeof value !== 'string' || !/^\/[A-Za-z][A-Za-z0-9]{0,79}$/.test(value)) {
    throw new TradeError('h5-action-unsupported', 'H5 返回了无法识别的付款步骤')
  }
  return origin + '/wapcashier/api' + value + '.json'
}

/** @param http - owned cookie jar. @param handoff - original order's payment URL. @param timeoutMs - configured request deadline. @returns final private H5 page without executing remote scripts. */
export async function resolveH5Entry(http, handoff, timeoutMs) {
  let url
  try { url = new URL(handoff) } catch { throw new TradeError('h5-entry-invalid', 'H5 支付入口无效') }
  for (let step = 0; step < 6; step++) {
    if (url.origin !== origin || url.username || url.password
      || !(url.pathname.startsWith('/h5pay/') || url.pathname === '/w/trade_pay.do')) {
      throw new TradeError('h5-entry-invalid', 'H5 支付跳转地址无法核对')
    }
    let response, location, html
    try {
      response = await http.get(url.href, { maxRedirects: 0, timeout: timeoutMs })
      if (response.status() >= 300 && response.status() < 400) location = response.headers().location
      else {
        if (!response.ok()) throw new Error('HTTP failure')
        html = await response.text()
      }
    } catch { throw new TradeError('h5-entry-unavailable', 'H5 收银台初始化失败，未发起付款') }
    finally { if (response) await response.dispose() }
    if (location) { url = new URL(location, url); continue }
    if (html === undefined) throw new TradeError('h5-entry-invalid', 'H5 支付跳转缺少目标地址')
    if (url.pathname === '/h5pay/landing/index.html') {
      const matches = [...html.matchAll(/https:\/\/maliprod\.alipay\.com\/h5pay\/index\.html\?[^\s"'<>]+/g)]
      if (matches.length !== 1) throw new TradeError('h5-entry-invalid', 'H5 支付初始化入口无法确认')
      url = new URL(matches[0][0].replaceAll('&amp;', '&')); continue
    }
    return h5Entry(url.href).href
  }
  throw new TradeError('h5-entry-invalid', 'H5 支付跳转次数过多')
}

/** @param data - current official pre-confirm response. @returns displayed CNY amount in cents, never a paid result. */
export function h5Amount(data) {
  const biz = data?.bizData
  if (data?.controlType !== 'cashier_pre_confirm' || !object(biz)) throw new TradeError('h5-not-ready', 'H5 收银台尚未进入付款确认')
  const currency = biz.orderCurrency || '¥'
  if (!['¥', '￥', 'CNY'].includes(currency)) throw new TradeError('payment-amount-changed', 'H5 收银台币种无法核对')
  const value = biz.cost || biz.orderAmount || biz.originalCost
  if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new TradeError('payment-amount-changed', 'H5 收银台金额无法核对')
  }
  const amount = cents(value)
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new TradeError('payment-amount-changed', 'H5 收银台金额无法核对')
  return amount
}

/** A private HTTP cookie jar owns authentication; callbacks reserve/reconcile through the existing order ledger. */
export class AlipayH5Session {
  /** @param options - owned HTTP context, original entry, truthful environment, timeout and clock. */
  constructor({ http, entryUrl, environment, timeoutMs, now = Date.now }) {
    this.http = http; this.entry = h5Entry(entryUrl); this.params = h5Query(this.entry.search)
    this.environment = environment; this.timeoutMs = timeoutMs; this.now = now
    this.data = null; this.chain = Promise.resolve(); this.submitted = false; this.closed = false
    this.pageType = Object.keys(paths).find(type => paths[type] === this.entry.pathname)
  }

  /** @param operation - one session operation. @returns serialized completion; failed payments are never retried. */
  run(operation) {
    const task = this.chain.then(() => {
      if (this.closed) throw new TradeError('h5-session-expired', 'H5 支付会话已关闭')
      return operation()
    })
    this.chain = task.catch(() => {}) // Retain serialization after a reported failure.
    return task
  }

  /** @returns model-safe progress only; raw keys, URLs, account data and instructions remain private. */
  summary() {
    const type = this.data?.controlType
    return { state: !type ? 'not-initialized' : this.data.bizError ? 'requires-reconciliation' : type === 'cashier_pre_confirm' ? 'ready'
      : type === 'pwd_validate' ? 'requires-password' : authentication.has(type) ? 'requires-verification'
      : 'requires-reconciliation', submitted: this.submitted }
  }

  async request(action, data) {
    const url = actionPath(action)
    let raw
    try {
      const response = await this.http.post(url, { timeout: this.timeoutMs, maxRedirects: 0,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json;charset=UTF-8',
          Origin: origin, Referer: this.entry.href, server_param: this.params.server_param || this.params.serverParams || '' },
        data: { ...this.params, ...data, ua: this.environment.ua, t: this.now(),
          h5payClientId: this.environment.clientId, lastReferer: this.environment.referer || '' } })
      try {
        if (!response.ok()) throw new Error('HTTP failure')
        raw = await response.json()
      } finally { await response.dispose() }
    } catch { throw new TradeError('h5-response-unconfirmed', 'H5 请求结果未确认，未自动重试；请查询原订单状态') }
    if (raw?.success !== true || !object(raw.data) || typeof raw.data.controlType !== 'string') {
      throw new TradeError('h5-response-unconfirmed', 'H5 返回结果无法确认，请查询原订单状态')
    }
    if (raw.needRedirect || raw.data.h5HalfScreen) {
      this.data = { controlType: 'requires_external_verification' }
      return this.summary()
    }
    const type = raw.data.controlType, oldType = this.pageType
    if (object(raw.params) && Object.keys(raw.params).length) {
      this.params = { ...raw.params, ...(this.params.from ? { from: this.params.from } : {}),
        pageToken: type !== oldType ? raw.pageToken || '' : this.params.pageToken || '',
        refreshNoAuth: type !== oldType ? raw.refreshNoAuth || '' : this.params.refreshNoAuth || '' }
      if (paths[type]) {
        const query = Object.entries(this.params).flatMap(([key, value]) =>
          (Array.isArray(value) ? value : [value]).map(item => encodeURIComponent(key) + '=' + encodeURIComponent(item))).join('&')
        this.entry = new URL(paths[type] + '?' + query, origin)
        this.pageType = type
      }
    }
    this.data = raw.data
    return this.summary()
  }

  /** @returns current cashier progress without sending a payment request. */
  initialize() {
    return this.run(() => this.request('/cashierMain', { device: this.environment.device, supportWriteCookie: true }))
  }

  /** @param options - verified order amount, private password when requested, environment SDK result and durable reservation callback. @returns progress requiring official order reconciliation. */
  submit({ amountCents, password, envData, reserve }) {
    return this.run(async () => {
      if (this.submitted) throw new TradeError('payment-already-attempted', 'H5 已提交过付款，未重复扣款')
      if (this.data?.bizError || this.summary().state !== 'ready') throw new TradeError('h5-not-ready', 'H5 收银台当前不能付款')
      if (h5Amount(this.data) !== amountCents) throw new TradeError('payment-amount-changed', 'H5 金额与订单不同，未付款')
      const biz = this.data.bizData
      if (biz.chargeMsg || biz.pwdValidateType === 'newCard' || biz.pwdValidateType === 'openService'
        || biz.protocolName || biz.protocols?.length) {
        throw new TradeError('h5-additional-confirmation', 'H5 收银台要求额外确认，请先在支付页面核对')
      }
      let action = biz.btnAction || biz.payAct || '/cashierPay', payload = { envData }
      if (!biz.npwdPay && !biz.btnAction) {
        if (!password) return { state: 'requires-password', submitted: false }
        action = biz.nextAction || '/cashierPay'
        payload = { [biz.spasswordPay ? 'spwd' : 'pwd']: h5Password(password, this.data.rsaPubKey),
          combinationIndex: biz.combinationIndex || '', envData }
      }
      actionPath(action)
      if (!['/cashierPay', '/h5ContinuePay'].includes(action)) {
        throw new TradeError('h5-action-unsupported', '当前 H5 付款步骤尚未核验，未提交')
      }
      await reserve()
      this.submitted = true
      return this.request(action, payload)
    })
  }

  /** @returns server payment-query progress; success must still be reconciled against the owned order. */
  query() { return this.run(() => this.request('/cashierPayResultQuery', {})) }

  /** @returns completion after queued work and release of the in-memory authentication jar. */
  async close() {
    if (this.closed) return
    this.closed = true
    await this.chain
    this.data = null; this.params = {}; this.environment = {}
    await this.http.dispose()
  }
}
