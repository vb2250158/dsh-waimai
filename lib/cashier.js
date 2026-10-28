/** Official cashier consultation and one durable payment attempt per owned order. */
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { writeJsonState } from './automation.js'
import { TradeError, cents, paymentDestination } from './trade-data.js'
import { loginResponseDiagnostic } from './login-diagnostics.js'
import { AlipayAgentPayments, alipayAgentReferences } from './alipay-agent.js'
import { AlipayH5Session, h5Amount, resolveH5Entry } from './alipay-h5.js'
import { H5VerificationWindow } from './alipay-h5-browser.js'

const money = z.number().int().positive().safe()
const paymentStates = z.enum(['unknown', 'requires-verification', 'paid', 'failed'])
const ledgerSchema = z.object({ version: z.literal(1), attempts: z.array(z.object({
  ref: z.uuid(), orderRef: z.uuid(), orderId: z.string().regex(/^\d+$/), accountId: z.string(),
  amountCents: money, state: paymentStates, action: z.string().max(80).optional(), at: z.number().int().nonnegative(),
  provider: z.literal('alipay-agent').optional(), agentQueryRef: z.string().regex(/^\d{10}8282\d{18}$/).optional(),
  h5Submitted: z.boolean().optional(),
}).strict()) }).strict()
const optionSchema = z.object({ payOptionCode: z.string().min(1).max(100), payOptionName: z.string().min(1).max(100),
  available: z.boolean(), selected: z.boolean(), locked: z.boolean().optional() }).passthrough()
const quoteSchema = z.object({ cashierOrderNo: z.string().min(1).max(160), payAmount: money, payCurrency: z.literal('CNY'),
  timeoutSeconds: z.number().nonnegative(), payOptionInfos: z.array(optionSchema).min(1).max(50),
  payToolPayVOList: z.string().min(1).max(100000) }).passthrough()
const supportedOptions = new Set(['ALIPAY_BATCH_ESCROW_WAP', 'ALIPAY_BATCH_ESCROW_APP'])
const knownPayActions = new Set(['ALIPAY_SDK', 'ALIPAY_AI_PAY_SDK', 'WECHAT_SDK', 'DOUYIN_SDK', 'ELE_OPENAPI_SDK',
  'THIRD_PAY', 'H5_URL', 'GUANGDAYH_SDK', 'ELE_BALANCE', 'NEED_QUERY', 'FAST_PAY', 'ANTOM_PAY', 'UNIONPAY_SDK',
  'WECHAT_MINI_APP', 'JIANHANGSH_SDK', 'ICBC_SDK'])

/** @param value - official payment provider response. @returns a private destination and fixed validation category. */
export function providerPaymentDestination(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return { reason: 'invalid-url', url: null }
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return { reason: 'unsupported-scheme', url: null }
    if (url.username || url.password) return { reason: 'embedded-credentials', url: null }
    if (url.port && url.port !== '443') return { reason: 'unsupported-port', url: null }
    if (['maliprod.alipay.com', 'mclient.alipay.com', 'wappaygw.alipay.com', 'render.alipay.com', 'cashier.alipay.com'].includes(url.hostname)) {
      return { reason: 'alipay-cashier', url: value }
    }
    // Official WAP gateway versions: developer.alibaba.com/docs/doc.htm?articleId=107095&docType=1&treeId=203
    if (['mapi.alipay.com', 'openapi.alipay.com'].includes(url.hostname)) {
      return url.pathname === '/gateway.do' ? { reason: 'alipay-gateway', url: value }
        : { reason: 'unsupported-gateway-path', url: null }
    }
    return { reason: 'unrecognized-host', url: null }
  } catch { return { reason: 'invalid-url', url: null } } // Native SDK payloads cannot be treated as browser links.
}

/** @param value - official payment provider response. @returns a private browser destination or null. */
export function providerPaymentUrl(value) {
  return providerPaymentDestination(value).url
}

/** @param result - official submit result. @returns a verified browser URL; SDK payloads remain private. */
export function paymentHandoffUrl(result) {
  const action = result.payAction || result.extraMap?.payAction
  if (action === 'H5_URL') return providerPaymentUrl(result.targetUrl)
  if (action !== 'THIRD_PAY' || typeof result.targetUrl !== 'string') return null
  try { return providerPaymentUrl(JSON.parse(result.targetUrl)?.targetUrl) }
  catch (error) { return null } // Malformed third-party envelopes are not browser destinations.
}

/** @param result - untrusted cashier result. @returns fixed classifications and the destination protocol/hostname, without URL credentials or parameters. */
export function paymentResponseDiagnostic(result) {
  const action = result?.payAction || result?.extraMap?.payAction
  const payResult = ['SUCCESS', 'FAIL', 'UNKNOWN'].includes(result?.payResult) ? result.payResult : result?.payResult === undefined ? 'absent' : 'unrecognized'
  const payAction = knownPayActions.has(action) ? action : action === undefined ? 'absent' : 'unrecognized'
  let handoffReason = 'not-required'
  if (payResult === 'UNKNOWN') {
    if (['NEED_QUERY', 'FAST_PAY'].includes(action)) handoffReason = 'query-only'
    else if (!['H5_URL', 'THIRD_PAY', 'ALIPAY_SDK'].includes(action)) handoffReason = 'unsupported-action'
    else if (typeof result.targetUrl !== 'string' || !result.targetUrl) handoffReason = 'missing-target'
    else if (action === 'ALIPAY_SDK') handoffReason = 'native-sdk-material'
    else if (paymentHandoffUrl(result)) handoffReason = 'browser-url'
    else {
      handoffReason = 'unapproved-destination'
      if (action === 'THIRD_PAY') {
        try {
          const target = JSON.parse(result.targetUrl)?.targetUrl
          if (typeof target !== 'string' || !target) handoffReason = 'invalid-third-party-payload'
        } catch (error) { handoffReason = 'invalid-third-party-payload' }
      }
    }
  } else if (payResult === 'absent' || payResult === 'unrecognized') handoffReason = 'unrecognized-result'
  let destinationReason = 'not-inspected'
  let destinationProtocol = null, destinationHostname = null
  if (payResult === 'UNKNOWN' && ['H5_URL', 'THIRD_PAY'].includes(action)) {
    let target = result.targetUrl
    if (action === 'THIRD_PAY') {
      try { target = JSON.parse(target)?.targetUrl } catch { target = undefined }
    }
    destinationReason = providerPaymentDestination(target).reason
    if (typeof target === 'string' && !/[\u0000-\u0020\u007f]/.test(target)) {
      try {
        const destination = new URL(target)
        if (['https:', 'http:'].includes(destination.protocol) && !destination.username && !destination.password
          && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(destination.hostname)
          && destination.hostname.length <= 253) {
          destinationProtocol = destination.protocol === 'https:' ? 'https' : 'http'
          destinationHostname = destination.hostname
        }
      } catch { /* Invalid targets have no hostname diagnostic. */ }
    }
  }
  return { payResult, payAction, handoffAccepted: handoffReason === 'browser-url',
    handoffRejected: !['not-required', 'query-only', 'browser-url'].includes(handoffReason), handoffReason, destinationReason,
    destinationProtocol, destinationHostname }
}

/** @param raw - official status-query data. @returns the cashier outcome, never inferred from delivery text. */
export function cashierPaymentStatus(raw) {
  const status = z.object({ value: z.object({ batchStatus: z.enum(['S', 'F', 'U']) }) }).safeParse(raw)
  if (!status.success) throw new TradeError('payment-status-invalid', '官方收银台未返回可确认的付款状态')
  return { S: 'paid', F: 'failed', U: 'unknown' }[status.data.value.batchStatus]
}

/** @param raw - official retail detail. @param order - owned local record. @returns verified payment and order state. */
export function retailPaymentStatus(raw, order) {
  const detail = z.object({ orderId: z.string(), eleUserId: z.union([z.string(), z.number().int().safe()]),
    payTime: z.number().int().nonnegative().optional(), paidAmountActual: z.union([z.number(), z.string()]),
    statusText: z.string().min(1).max(500), statusCode: z.string().max(80) }).parse(raw)
  if (detail.orderId !== order.orderIds[0] || String(detail.eleUserId) !== order.accountId
    || cents(detail.paidAmountActual) !== order.amountCents) throw new TradeError('payment-status-invalid', '官方付款详情与当前订单不一致')
  return { paymentStatus: detail.payTime > 0 ? 'paid' : 'unconfirmed', paidAt: detail.payTime || null,
    officialStatus: detail.statusText, officialStatusCode: detail.statusCode }
}

/** @param raw - official cashier envelope. @returns its single result; credentials remain private. */
export function cashierResult(raw) {
  if (raw?.succeeded !== true || typeof raw.result !== 'string' || raw.result.length > 300000) throw new TradeError('cashier-rejected', '官方收银台暂未接受请求，请查询订单状态')
  try { return z.array(z.record(z.string(), z.unknown())).length(1).parse(JSON.parse(raw.result))[0] }
  catch { throw new TradeError('cashier-invalid', '官方收银台响应无法确认，未自动重试') }
}

/** @param value - validated official handoff. @returns read-only consultation parameters for the browser cashier. */
export function cashierParameters(value) {
  const destination = paymentDestination(value)
  if (!destination) throw new TradeError('cashier-link-invalid', '此订单尚未返回可用的官方收银台入口')
  const query = new URL(destination).searchParams
  if (query.has('mtopType') && query.get('mtopType') !== 'WAIMAI') throw new TradeError('cashier-unsupported', '此收银台类型尚未接入')
  const result = { payEntrance: 'WAP', redirectUrl: query.get('returnUrl') || '', deviceExtParams: query.get('deviceExtParams') || '{}' }
  for (const key of ['checkoutOrderNos', 'termNos', 'payEntrance']) {
    const values = query.getAll(key)
    if (values.length > 1) throw new TradeError('cashier-link-invalid', '收银台订单参数重复')
    if (values.length) result[key] = z.string().min(1).max(4000).parse(values[0])
  }
  if (!result.checkoutOrderNos && !result.termNos) throw new TradeError('cashier-link-invalid', '收银台缺少订单引用')
  return result
}

/** @param raw - consulted cashier. @param amountCents - owned order total. @returns validated private quote and safe display. */
export function cashierQuote(raw, amountCents) {
  const quote = quoteSchema.parse(cashierResult(raw))
  if (quote.payAmount !== amountCents) throw new TradeError('payment-amount-changed', '收银台金额与已创建订单不同，未付款')
  if (quote.timeoutSeconds <= 0) throw new TradeError('payment-expired', '该订单付款时间已过期')
  const tools = z.array(z.object({ payOptionCode: z.string(), payActualAmount: money,
    payActualAmountCurrency: z.literal('CNY') }).passthrough()).length(1).parse(JSON.parse(quote.payToolPayVOList))
  const selected = quote.payOptionInfos.filter(option => option.selected)
  if (selected.length !== 1 || !selected[0].available || !supportedOptions.has(selected[0].payOptionCode)
    || tools[0].payOptionCode !== selected[0].payOptionCode || tools[0].payActualAmount !== amountCents) {
    throw new TradeError('payment-option-unsupported', '当前付款方式需要在官方收银台选择；不会开通免密或信贷服务')
  }
  return { quote, display: { amountCents, selectedOption: selected[0].payOptionCode, selectedOptionName: selected[0].payOptionName,
    options: quote.payOptionInfos.map(option => ({ code: option.payOptionCode, name: option.payOptionName,
      available: option.available && supportedOptions.has(option.payOptionCode), selected: option.selected })) } }
}

/** Own payment state separately from order creation; no payment URLs or tokens are written to this ledger. */
export class TaobaoCashier {
  /** @param trade - existing account, order ledger and spending limits owner. @param options - optional official CLI configuration. */
  constructor(trade, { alipayAgent, h5BrowserChannel = 'chrome' } = {}) {
    this.trade = trade; this.login = trade.login; this.prepared = new Map(); this.handoffs = new Map(); this.statusQueries = new Map()
    this.path = join(dirname(trade.journalPath), 'cashier-attempts.json')
    this.agentPayments = alipayAgent?.executable ? new AlipayAgentPayments(alipayAgent) : null
    this.agentReceipts = new Map()
    this.h5Sessions = new Map()
    this.h5BrowserChannel = h5BrowserChannel
    this.h5Authentication = null
  }

  async ledger() {
    try { return ledgerSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))) }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, attempts: [] }; throw new TradeError('payment-ledger-invalid', '付款记录无法读取，已停止付款') }
  }

  /** @param owned - already authorized order records. @returns private UI handoffs with persisted attempt states. */
  async history(owned) {
    const ledger = await this.ledger()
    return new Map(owned.map(order => {
      const record = ledger.attempts.find(item => item.orderRef === order.ref && item.accountId === order.accountId)
      const handoff = this.handoffs.get(order.ref)
      return [order.ref, { paymentStatus: record?.state || 'unconfirmed',
        ...(record ? { paymentUrl: record.state === 'requires-verification' && handoff ? handoff : null,
          paymentHandoffAvailable: record.state === 'requires-verification' && Boolean(handoff) } : {}) }]
    }))
  }

  async owned(orderRef) {
    await this.login.requireAccount()
    const order = (await this.trade.journal()).attempts.find(item => item.ref === orderRef && item.accountId === this.login.accountId)
    if (!order || order.status !== 'created' || order.orderIds?.length !== 1) throw new TradeError('payment-order-invalid', '付款必须对应当前账号已创建的单笔订单')
    return order
  }

  async official(order) {
    const spec = this.login.protocol.orders, lastBillMonth = '00'
    const raw = await this.login.mtop(spec, { tabCode: 'ALL', pageSize: 20, pageNum: 0, fromTime: 0, lastBillMonth,
      latitude: '', longitude: '', cityId: '', extInfo: JSON.stringify({ ...spec.client, lastBillMonth }), sourceFrom: 'TAOBAO' })
    this.trade.service.checkReply(raw, 'payment-status-unavailable', '官方订单状态暂时无法读取')
    const rows = raw.data?.result?.orderList
    if (raw.data?.result?.accountBindWrong || !Array.isArray(rows)) throw new TradeError('payment-status-invalid', '官方订单身份无法确认')
    const matches = rows.filter(item => item.orderId === order.orderIds[0])
    if (matches.length !== 1 || cents(matches[0].orderAmount) !== order.amountCents) throw new TradeError('payment-order-mismatch', '官方订单或金额无法核对，未付款')
    return matches[0]
  }

  async pending(order) {
    const official = await this.official(order)
    if (official.orderStatusBar?.title !== '待支付') throw new TradeError('payment-not-pending', '官方订单当前不是待支付状态，未再次付款')
    return official
  }

  async request(name, data, retry = true) {
    const raw = await this.login.mtop(this.login.protocol.cashier[name], data, retry)
    this.login.diagnostic?.({ group: 'waimai-order', stage: 'cashier-' + name, ...loginResponseDiagnostic(raw) })
    this.trade.service.checkReply(raw, 'cashier-unavailable', '官方收银台请求未确认，请先核对订单状态')
    return raw.data
  }

  async consultation(order) {
    let url = paymentDestination(order.paymentUrl)
    if (!url) {
      const response = await this.request('retailConsult', { orderId: order.orderIds[0], payCode: '', tinyAppId: '',
        miniAppVersion: '', wechatOpenId: '', containerType: 'web', channel: 'PC', subChannel: 'WAP', bizChannel: 'mobile.default',
        riskInfo: JSON.stringify({ source: 'WAP' }) })
      let value = response.data
      if (typeof value === 'string' && value.startsWith('{')) value = JSON.parse(value)
      url = paymentDestination(typeof value === 'string' ? value : value?.cashierUrl)
      if (!url) throw new TradeError('cashier-link-invalid', '官方尚未返回可用的收银台入口')
    }
    const parameters = cashierParameters(url)
    const result = cashierQuote(await this.request('consult', parameters), order.amountCents)
    return { ...result, parameters, url }
  }

  /** @param args - owned order reference. @returns available payment and a short-lived reference, without a charge. */
  prepare(args) {
    return this.login.run(async () => {
      const order = await this.owned(args.orderRef)
      await this.pending(order)
      const existing = (await this.ledger()).attempts.find(item => item.orderId === order.orderIds[0] && item.accountId === order.accountId)
      const h5 = this.h5Sessions.get(order.ref)
      if (existing?.state === 'requires-verification' && !existing.h5Submitted && !existing.provider
        && h5?.accountId === order.accountId && h5.envData && !h5.client.submitted) {
        if (h5Amount(h5.client.data) !== order.amountCents) throw new TradeError('payment-amount-changed', 'H5 金额与订单不符')
        return { platformId: 'taobao', accountId: order.accountId, orderRef: order.ref, paymentRef: existing.ref,
          merchant: order.merchant, amountCents: order.amountCents, state: 'h5-ready', paymentStatus: 'unpaid' }
      }
      if (existing) {
        throw new TradeError('payment-already-attempted', '此订单已有付款尝试，请查询付款状态，勿再次付款')
      }
      const value = await this.consultation(order), paymentRef = randomUUID(), now = this.trade.now()
      for (const [ref, old] of this.prepared) if (old.expiresAt <= now) this.prepared.delete(ref)
      const expiresAt = now + Math.min(this.trade.quoteSeconds, value.quote.timeoutSeconds) * 1000
      this.prepared.set(paymentRef, { ...value, order, expiresAt })
      return { platformId: 'taobao', accountId: order.accountId, orderRef: order.ref, paymentRef, expiresAt,
        merchant: order.merchant, ...value.display, state: 'ready', paymentStatus: 'unpaid' }
    })
  }

  /** @param args - prepared payment and explicitly confirmed amount. @returns result or verification handoff; never retries a charge. */
  submit(args) {
    if (!args.h5Only && this.h5Sessions.has(args.orderRef)) return this.h5Pay(args)
    return this.login.run(async () => {
      const agentPayments = args.h5Only === true ? null : this.agentPayments
      const prepared = this.prepared.get(args.paymentRef)
      if (!prepared || prepared.expiresAt <= this.trade.now() || prepared.order.ref !== args.orderRef) throw new TradeError('payment-expired', '付款报价已过期，请重新获取付款方式')
      const order = await this.owned(args.orderRef)
      if (order.accountId !== prepared.order.accountId || args.confirmed !== true || args.confirmedCents !== order.amountCents
        || order.amountCents > Math.min(this.trade.capCents, args.maxAmountCents)) throw new TradeError('payment-amount-unconfirmed', '付款金额未确认或超过本次预算')
      await this.pending(order)
      const current = await this.consultation(order)
      if (current.display.selectedOption !== prepared.display.selectedOption) throw new TradeError('payment-option-changed', '付款方式已变化，请重新确认')
      if (agentPayments && !order.itemSummary) throw new TradeError('payment-summary-missing', '旧订单缺少已确认商品摘要，未发起支付宝付款')
      const paymentSessionId = agentPayments ? await agentPayments.prepare(args.paymentSessionId) : null
      const lock = this.path + '.lock'
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      try { await mkdir(lock, { mode: 0o700 }) } catch { throw new TradeError('payment-locked', '已有付款请求处理中，请先查询结果') }
      try {
        const ledger = await this.ledger()
        if (ledger.attempts.some(item => item.orderId === order.orderIds[0] && item.accountId === order.accountId)) throw new TradeError('payment-already-attempted', '已有付款尝试，未重复扣款')
        const record = { ref: args.paymentRef, orderRef: order.ref, orderId: order.orderIds[0], accountId: order.accountId,
          amountCents: order.amountCents, state: 'unknown', at: this.trade.now() }
        ledger.attempts.push(record); await writeJsonState(this.path, ledger); this.prepared.delete(args.paymentRef)
        this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'payment-sent', amountCents: order.amountCents })
        let result
        try {
          result = cashierResult(await this.request('submit', { cashierOrderNo: current.quote.cashierOrderNo,
            payToolPayVOList: current.quote.payToolPayVOList, actualPayAmount: current.quote.payAmount,
            actualPayCurrency: current.quote.payCurrency, payEntrance: current.parameters.payEntrance, deviceExtParams: current.parameters.deviceExtParams, payExtParams: '{}' }, false))
        } catch (error) {
          this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'payment-response-unreadable' })
          throw new TradeError('payment-unknown', '付款请求结果未确认，已保留记录；请查询订单状态，勿再次付款')
        }
        this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'payment-response', ...paymentResponseDiagnostic(result) })
        const action = result.payAction || result.extraMap?.payAction
        if (result.payResult === 'UNKNOWN' && result.extraMap && typeof result.extraMap === 'object' && !Array.isArray(result.extraMap)
          && (!result.extraMap.cashierOrderNo || result.extraMap.cashierOrderNo === current.quote.cashierOrderNo)) {
          // Official query parameters can contain credentials and must not enter the durable ledger or tool output.
          this.statusQueries.set(order.ref, { accountId: order.accountId, parameters: result.extraMap })
        }
        if (result.payResult === 'SUCCESS') record.state = 'paid'
        else if (result.payResult === 'FAIL') record.state = 'failed'
        else if (result.payResult === 'UNKNOWN' && ['H5_URL', 'THIRD_PAY', 'ALIPAY_SDK'].includes(action) && agentPayments) {
          let target = result.targetUrl
          if (action === 'THIRD_PAY') {
            try { target = JSON.parse(target)?.targetUrl } catch { target = null }
          }
          record.provider = 'alipay-agent'
          await writeJsonState(this.path, ledger)
          try {
            const response = await agentPayments.submit({ paymentLink: target,
              materialKind: action === 'ALIPAY_SDK' ? 'sdk-order' : 'cashier-url', sessionId: paymentSessionId,
              amountCents: order.amountCents, merchant: order.merchant, serviceContent: order.itemSummary })
            this.agentReceipts.set(order.ref, { submit: response })
            const references = alipayAgentReferences(response.receipt)
            if (references.queryRef) record.agentQueryRef = references.queryRef
            if (response.completed && references.paymentUrl) {
              record.state = 'requires-verification'; record.action = 'H5_URL'
              this.handoffs.set(order.ref, references.paymentUrl)
            } else if (this.providerFailure(order.ref).providerErrorCode === 'PAYMENT_LINK_UNSUPPORTED') {
              const handoff = paymentHandoffUrl(result)
              if (handoff) {
                // Resume the original cashier; its signed URL is not an Agent Pay query credential.
                delete record.provider
                record.state = 'requires-verification'; record.action = action
                this.handoffs.set(order.ref, handoff)
              }
            }
            this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'agent-payment-response',
              completed: response.completed, structured: Boolean(response.receipt),
              ...this.providerFailure(order.ref),
              ...(response.execution ? { executionReason: response.execution.reason, exitCode: response.execution.exitCode,
                stdoutBytes: response.execution.stdoutBytes, stderrBytes: response.execution.stderrBytes } : {}),
              queryAvailable: Boolean(references.queryRef), handoffAvailable: this.handoffs.has(order.ref) })
          } catch (error) {
            const reason = ['payment-destination-unsupported', 'payment-session-missing', 'payment-cli-unavailable', 'payment-summary-missing'].includes(error?.code)
              ? error.code : 'provider-call-failed'
            this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'agent-payment-unconfirmed', reason })
          }
        }
        else if (result.payResult === 'UNKNOWN' && ['H5_URL', 'THIRD_PAY'].includes(action)) {
          const handoff = paymentHandoffUrl(result)
          if (handoff) {
            record.state = 'requires-verification'; record.action = action
            // Payment credentials are retained only in process memory and exposed only through authenticated UI RPC.
            this.handoffs.set(order.ref, handoff)
          }
        }
        await writeJsonState(this.path, ledger)
        this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'payment-' + record.state })
        return { platformId: 'taobao', accountId: order.accountId, orderRef: order.ref, orderIds: order.orderIds,
          amountCents: order.amountCents, merchant: order.merchant, paymentStatus: record.state, ...this.providerFailure(order.ref), ...(record.action ? { action: record.action } : {}) }
      } finally { await rmdir(lock) }
    })
  }

  /** @param args - original payment reference and confirmed amount from pay_order. @returns a model-safe H5 continuation result. */
  async h5Pay(args) {
    const current = this.h5Sessions.get(args.orderRef)
    const record = (await this.ledger()).attempts.find(item => item.orderRef === args.orderRef && item.ref === args.paymentRef)
    if (!current || !record || record.accountId !== current.accountId) throw new TradeError('payment-expired', '付款引用与当前 H5 会话不符')
    if (!current.envData) throw new TradeError('h5-verification-required', '请先在付款卡片完成支付宝验证并连接后台')
    const progress = await this.h5Submit({ ...args, h5Ref: current.ref })
    return { platformId: 'taobao', accountId: record.accountId, orderRef: args.orderRef, amountCents: record.amountCents,
      state: progress.state, paymentStatus: progress.submitted ? 'unknown' : 'requires-verification', action: 'H5' }
  }

  /** @param args - private session input and confirmed order limit. @returns opaque H5 session identity and safe progress. */
  async h5Start(args) {
    if (this.trade.dryRun) throw new TradeError('preview-only', '预览模式下不发起付款')
    const exists = await this.login.run(async () => {
      const order = await this.owned(args.orderRef)
      return (await this.ledger()).attempts.some(item => item.orderId === order.orderIds[0] && item.accountId === order.accountId)
    })
    if (!exists) {
      const prepared = await this.prepare(args)
      await this.submit({ ...args, paymentRef: prepared.paymentRef, h5Only: true })
    }
    return this.login.run(async () => {
      const order = await this.owned(args.orderRef)
      await this.pending(order)
      if (args.confirmed !== true || args.confirmedCents !== order.amountCents
        || order.amountCents > Math.min(this.trade.capCents, args.maxAmountCents)) {
        throw new TradeError('payment-amount-unconfirmed', 'H5 付款金额未确认或超过预算')
      }
      const record = (await this.ledger()).attempts.find(item => item.orderId === order.orderIds[0] && item.accountId === order.accountId)
      const handoff = this.handoffs.get(order.ref)
      if (!record || record.state !== 'requires-verification' || record.h5Submitted || record.provider || !handoff) {
        throw new TradeError('h5-session-unavailable', '原订单没有可继续的 H5 付款会话，请查询付款状态')
      }
      const old = this.h5Sessions.get(order.ref)
      if (old && !args.cookies.length) return { orderRef: order.ref, h5Ref: old.ref, amountCents: order.amountCents,
        verificationRequired: !old.envData, ...old.client.summary() }
      if (old) { await old.verification?.close(); await old.client.close(); this.h5Sessions.delete(order.ref) }
      const authentication = args.cookies.length ? { storageState: { cookies: args.cookies, origins: [] }, environment: args.environment }
        : this.h5Authentication || { storageState: { cookies: [], origins: [] }, environment: args.environment }
      const http = await this.login.createContext({ timeout: this.login.timeoutMs,
        userAgent: authentication.environment.device.userAgent, storageState: authentication.storageState })
      let client
      try {
        const entryUrl = await resolveH5Entry(http, handoff, this.login.timeoutMs)
        client = new AlipayH5Session({ http, entryUrl, environment: authentication.environment, timeoutMs: this.login.timeoutMs })
        const progress = await client.initialize(), h5Ref = randomUUID()
        this.h5Sessions.set(order.ref, { ref: h5Ref, client, accountId: order.accountId, amountCents: order.amountCents })
        this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'h5-initialized', state: progress.state })
        return { orderRef: order.ref, h5Ref, amountCents: order.amountCents, verificationRequired: true, ...progress }
      } catch (error) {
        if (client) await client.close(); else await http.dispose()
        if (error instanceof TradeError) throw error
        throw new TradeError('h5-session-unavailable', 'H5 登录会话无法初始化，未发起付款')
      }
    })
  }

  /** @param args - current private session and explicit open/connect/cancel action. @returns safe verification progress. */
  h5Authenticate(args) {
    return this.login.run(async () => {
      const order = await this.owned(args.orderRef), current = this.h5Sessions.get(order.ref)
      if (!current || current.ref !== args.h5Ref || current.accountId !== order.accountId || current.client.submitted) {
        throw new TradeError('h5-session-expired', 'H5 支付会话已失效，请查询原订单状态')
      }
      if (args.operation === 'cancel') {
        await current.verification?.close(); current.verification = null
        return { orderRef: order.ref, ...current.client.summary() }
      }
      await this.pending(order)
      if (args.operation === 'open') {
        await current.verification?.close()
        current.verification = new H5VerificationWindow({ channel: this.h5BrowserChannel, timeoutMs: this.login.timeoutMs })
        await current.verification.open(current.client.entry.href, await current.client.http.storageState())
        return { orderRef: order.ref, state: 'verifying', submitted: false }
      }
      if (!current.verification) throw new TradeError('h5-verification-unavailable', '请先打开支付宝验证窗口')
      const snapshot = await current.verification.snapshot()
      const http = await this.login.createContext({ timeout: this.login.timeoutMs, userAgent: snapshot.environment.device.userAgent,
        storageState: snapshot.storageState })
      const client = new AlipayH5Session({ http, entryUrl: snapshot.entryUrl, environment: snapshot.environment, timeoutMs: this.login.timeoutMs })
      try {
        const progress = await client.initialize()
        if (progress.state !== 'ready') { await client.close(); return { orderRef: order.ref, ...progress } }
        if (h5Amount(client.data) !== order.amountCents) throw new TradeError('payment-amount-changed', '验证后的收银台金额与订单不符，未付款')
        const previous = current.client
        if (!snapshot.envData) throw new TradeError('h5-environment-unavailable', '支付宝验证环境尚未就绪，请保留窗口并稍后连接')
        current.client = client; current.envData = snapshot.envData
        this.h5Authentication = { storageState: await http.storageState(), environment: snapshot.environment }
        await previous.close(); await current.verification.close(); current.verification = null
        return { orderRef: order.ref, h5Ref: current.ref, amountCents: order.amountCents, ...progress }
      } catch (error) {
        if (current.client !== client) await client.close()
        if (error instanceof TradeError) throw error
        throw new TradeError('h5-verification-unavailable', '验证会话未连接成功，未付款')
      }
    })
  }

  /** @param args - current opaque session and ephemeral verification input. @returns safe progress, never inferred payment success. */
  h5Submit(args) {
    if (this.trade.dryRun) throw new TradeError('preview-only', '预览模式下不发起付款')
    return this.login.run(async () => {
      const order = await this.owned(args.orderRef), current = this.h5Sessions.get(order.ref)
      if (!current || current.ref !== args.h5Ref || current.accountId !== order.accountId) {
        throw new TradeError('h5-session-expired', 'H5 支付会话已失效，请查询原订单状态')
      }
      if (args.confirmed !== true || args.confirmedCents !== order.amountCents
        || order.amountCents > Math.min(this.trade.capCents, args.maxAmountCents)) {
        throw new TradeError('payment-amount-unconfirmed', 'H5 付款金额未确认或超过预算')
      }
      await this.pending(order)
      const lock = this.path + '.lock'
      try { await mkdir(lock, { mode: 0o700 }) } catch { throw new TradeError('payment-locked', '已有付款请求处理中，请先查询结果') }
      try {
        const ledger = await this.ledger()
        const record = ledger.attempts.find(item => item.orderId === order.orderIds[0] && item.accountId === order.accountId)
        if (!record || record.state !== 'requires-verification' || record.h5Submitted || record.provider) {
          throw new TradeError('payment-already-attempted', '此订单不能重复发起 H5 付款，请查询付款状态')
        }
        const progress = await current.client.submit({ amountCents: order.amountCents, password: args.password, envData: args.envData ?? current.envData,
          reserve: async () => {
            record.h5Submitted = true; record.state = 'unknown'
            await writeJsonState(this.path, ledger)
            this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'h5-payment-sent', amountCents: order.amountCents })
          } })
        return { orderRef: order.ref, amountCents: order.amountCents, ...progress }
      } finally { await rmdir(lock) }
    })
  }

  /** Dispose in-memory Alipay sessions when the account owner unloads. */
  async close() {
    for (const session of this.h5Sessions.values()) { await session.verification?.close(); await session.client.close() }
    this.h5Sessions.clear()
    this.h5Authentication = null
  }

  /** @param args - owned order reference from authenticated private RPC. @returns transient CLI receipts, never model output. */
  async providerReceipt(args) {
    const order = await this.owned(args.orderRef)
    return this.agentReceipts.get(order.ref) || null
  }

  /** @param orderRef - owned attempt reference. @returns a recognized provider rejection without exposing provider output or inferring payment status. */
  providerFailure(orderRef) {
    const receipt = this.agentReceipts.get(orderRef)?.submit?.receipt
    return receipt?.success === false && receipt.errorCode === 'PAYMENT_LINK_UNSUPPORTED'
      ? { providerErrorCode: 'PAYMENT_LINK_UNSUPPORTED' } : {}
  }

  /** @param order - owned order. @param state - official terminal payment result. @returns persisted outcome. */
  async reconcile(order, state) {
    const lock = this.path + '.lock'
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    try { await mkdir(lock, { mode: 0o700 }) } catch (error) { throw new TradeError('payment-locked', '付款状态正在更新，请稍后查询') }
    try {
      const ledger = await this.ledger()
      const record = ledger.attempts.find(item => item.orderId === order.orderIds[0] && item.accountId === order.accountId)
      if (record && record.state !== 'paid' && record.state !== state) {
        record.state = state
        delete record.action
        await writeJsonState(this.path, ledger)
        this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'payment-reconciled-' + state })
      }
      this.handoffs.delete(order.ref); this.statusQueries.delete(order.ref)
      return record?.state || state
    } finally { await rmdir(lock) }
  }

  /** @param args - owned order reference. @returns fresh official status and the local attempt outcome, without private handoff data. */
  status(args) {
    return this.login.run(async () => {
      const order = await this.owned(args.orderRef), official = await this.official(order)
      const record = (await this.ledger()).attempts.find(item => item.orderId === order.orderIds[0] && item.accountId === order.accountId)
      let paymentStatus = record?.state || 'unconfirmed'
      const agentQueryLink = record?.provider === 'alipay-agent' ? this.handoffs.get(order.ref) : null
      if (record?.provider === 'alipay-agent' && (record.agentQueryRef || agentQueryLink) && this.agentPayments && !['paid', 'failed'].includes(paymentStatus)) {
        try {
          const response = record.agentQueryRef ? await this.agentPayments.query(record.agentQueryRef)
            : await this.agentPayments.queryLink(agentQueryLink)
          this.agentReceipts.set(order.ref, { ...this.agentReceipts.get(order.ref), query: response })
          // Provider transport codes do not establish payment; the original cashier/order remains authoritative.
        } catch (error) {
          this.login.diagnostic?.({ group: 'waimai-order', attemptId: order.ref, stage: 'agent-payment-query-unavailable' })
        }
      }
      const query = this.statusQueries.get(order.ref)
      if (query?.accountId === order.accountId && paymentStatus !== 'paid' && paymentStatus !== 'failed') {
        try {
          const outcome = cashierPaymentStatus(await this.request('status', query.parameters))
          if (outcome !== 'unknown') paymentStatus = await this.reconcile(order, outcome)
        } catch (error) {
          this.login.diagnostic?.({ group: 'waimai-order', attemptId: order.ref, stage: 'payment-query-unavailable' })
        }
      }
      let detail = null
      if (!order.paymentUrl) {
        try {
          const response = await this.request('retailDetail', { orderId: order.orderIds[0], channel: 'PC', subChannel: 'ELE_APP', bizChannel: 'mobile.default' })
          detail = retailPaymentStatus(response.data, order)
          if (detail.paymentStatus === 'paid') paymentStatus = await this.reconcile(order, 'paid')
        } catch (error) {
          this.login.diagnostic?.({ group: 'waimai-order', attemptId: order.ref, stage: 'payment-detail-unavailable' })
        }
      }
      return { platformId: 'taobao', accountId: order.accountId, orderRef: order.ref, orderIds: order.orderIds,
        merchant: order.merchant, amountCents: order.amountCents, paymentStatus, ...this.providerFailure(order.ref),
        paymentQueryAvailable: Boolean(this.statusQueries.get(order.ref)?.accountId === order.accountId
          || (record?.agentQueryRef || agentQueryLink) && this.agentPayments) && !['paid', 'failed'].includes(paymentStatus),
        ...(detail ? { paidAt: detail.paidAt } : {}),
        officialOrders: [{ id: official.orderId, status: detail?.officialStatus || official.orderStatusBar.title, amount: official.orderAmount, merchantName: official.storeName }] }
    })
  }
}
