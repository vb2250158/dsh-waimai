/** Private process transport for the official Alipay Agent Pay CLI. */
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { TradeError } from './trade-data.js'

/** Environment required by the CLI, excluding credentials and Node injection options. */
function cliEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(SystemRoot|WINDIR|APPDATA|LOCALAPPDATA|USERPROFILE|HOMEDRIVE|HOMEPATH|HOME|TEMP|TMP|PATH|PATHEXT)$/i.test(key)))
}

/** @param options - saved CLI configuration. @returns executable readiness, without querying a wallet or submitting payment. */
export async function inspectAlipayAgent({ executable, timeoutMs }) {
  const result = { configured: Boolean(executable), available: false, version: null, reason: null }
  if (!executable) return { ...result, reason: 'not-configured' }
  if (!isAbsolute(executable)) return { ...result, reason: 'invalid-path' }
  try { if (!(await stat(executable)).isFile()) return { ...result, reason: 'invalid-path' } }
  catch (_error) { return { ...result, reason: 'invalid-path' } }
  return new Promise(resolve => {
    execFile(executable, ['--version'], { encoding: 'utf8', timeout: timeoutMs, shell: false,
      windowsHide: true, maxBuffer: 4096, env: cliEnvironment() }, (error, stdout) => {
      if (error) return resolve({ ...result, reason: 'unavailable' })
      const match = /^alipay-bot-cli (\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)\s*$/.exec(stdout)
      resolve(match ? { ...result, available: true, version: match[1] } : { ...result, reason: 'unexpected-version' })
    })
  })
}

/** @param id - Host-owned DSH agent identity. @returns its original UUID for Alipay. */
export function paymentSessionUuid(id) {
  const value = typeof id === 'string' && id.startsWith('session-') ? id.slice(8) : id
  const parsed = z.uuid().safeParse(value)
  if (!parsed.success) throw new TradeError('payment-session-missing', '支付宝付款需要当前 DSH 会话身份')
  return parsed.data
}

/** @param value - original provider material. @returns an HTTPS Alipay destination, with signed bytes preserved. */
export function alipayAgentDestination(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') return null
    if (['mapi.alipay.com', 'openapi.alipay.com'].includes(url.hostname) && url.pathname !== '/gateway.do') return null
    // Official cashier Skill accepts cashier, excashier and tbapi Alipay hosts.
    return /^(?:[a-z0-9-]*cashier[a-z0-9-]*|tbapi[a-z0-9-]*|mclient|wappaygw|render|mapi|openapi|u)\.alipay\.com$/.test(url.hostname)
      || url.hostname === 'u.alipay.cn' ? value : null
  } catch { return null }
}

/** @param receipt - final CLI JSON, not diagnostic output. @returns only supported query and verification references. */
export function alipayAgentReferences(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return { paymentUrl: null, queryRef: null }
  if (receipt.code !== undefined && receipt.code !== 200) return { paymentUrl: null, queryRef: null }
  // Both direct CLI fields and a single API data envelope remain private. No recursive URL search.
  const values = [receipt, receipt.data].filter(value => value && typeof value === 'object' && !Array.isArray(value))
  const queryRef = values.map(value => value.outShakeNo).find(value => typeof value === 'string' && /^\d{10}8282\d{18}$/.test(value)) || null
  const paymentUrl = values.map(value => alipayAgentDestination(value.shortUrl)).find(Boolean) || null
  return { paymentUrl, queryRef }
}

/** Runs the provider without a shell; stdout, stderr, URLs and argv never enter error messages. */
export class AlipayAgentPayments {
  /** @param options - configured executable and process timeout. */
  constructor({ executable, timeoutMs }) {
    this.executable = executable
    this.timeoutMs = timeoutMs
  }

  /** @param sessionId - trusted Host identity. @returns the validated UUID before any payment attempt. */
  async prepare(sessionId) {
    const uuid = paymentSessionUuid(sessionId)
    if (!isAbsolute(this.executable)) throw new TradeError('payment-cli-unavailable', '支付宝 CLI 需要配置绝对路径')
    try { if (!(await stat(this.executable)).isFile()) throw new Error('not a file') }
    catch { throw new TradeError('payment-cli-unavailable', '支付宝 CLI 文件不可用，请检查插件配置') }
    return uuid
  }

  /** @param args - private argv. @returns the final private JSON and execution classification, never payment success. */
  run(args) {
    return new Promise(resolve => {
      execFile(this.executable, [...args, '--json'], { encoding: 'utf8', timeout: this.timeoutMs, shell: false,
        maxBuffer: 1024 * 1024, windowsHide: true, env: cliEnvironment() }, (error, stdout) => {
        let receipt = null
        try {
          const value = JSON.parse(stdout)
          if (value && typeof value === 'object' && !Array.isArray(value)) receipt = value
        } catch { /* Non-JSON output cannot establish a payment or supply query credentials. */ }
        resolve({ completed: !error, receipt })
      })
    })
  }

  /** @param request - original material and verified order summary. @returns a private provider receipt. */
  submit({ paymentLink, sessionId, amountCents, merchant }) {
    const link = alipayAgentDestination(paymentLink)
    if (!link) throw new TradeError('payment-destination-unsupported', '支付宝收银台地址尚未核验，未交给支付工具')
    return this.run(['submit-payment', '--session-id', paymentSessionUuid(sessionId), '--payment-link', link,
      '--intent-summary', `服务内容：未明确，支付金额：¥${(amountCents / 100).toFixed(2)}，支付对象：${merchant}`])
  }

  /** @param queryRef - original provider query reference. @returns a read-only receipt; no payment submission. */
  query(queryRef) {
    if (typeof queryRef !== 'string' || !/^\d{10}8282\d{18}$/.test(queryRef)) {
      throw new TradeError('payment-query-invalid', '支付宝查询引用无效，未重新付款')
    }
    return this.run(['query-payment-status', '--out-shake-no', queryRef])
  }

  /** @param shortUrl - original submit receipt's transient short link. @returns a read-only receipt. */
  queryLink(shortUrl) {
    if (!alipayAgentDestination(shortUrl)) throw new TradeError('payment-query-invalid', '支付宝查询入口无效，未重新付款')
    return this.run(['query-payment-status', '-p', shortUrl])
  }
}
