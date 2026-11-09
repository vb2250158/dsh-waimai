/** Read-only account checks before creating a new order; they never promise transaction approval. */
import { z } from 'zod'

const account = z.object({ platformId: z.literal('taobao').default('taobao'), accountRef: z.uuid() })
const messages = Object.freeze({
  'payment-account-required': '请选择支持 H5 支付的账号；未创建订单',
  'payment-login-required': '请在支付设置完成支付宝登录验证；未创建订单',
  'payment-readiness-unavailable': '付款条件暂时无法核实，请稍后重查；未创建订单',
  'payment-method-required': '请在支付设置保存默认付款方式；未创建订单',
})

/** Only fixed codes and messages may cross the public MCP boundary. */
export class PaymentReadinessError extends Error {
  constructor(code) { super(messages[code]); this.code = code }
}

/** @param args - chosen shopping account. @param read - private backend read call.
 * @returns completion when known account-level prerequisites pass; the cashier still owns transaction verification.
 */
export async function requireH5OrderReadiness(args, read) {
  const parsed = account.safeParse(args)
  if (!parsed.success) throw new PaymentReadinessError('payment-account-required')
  const input = { ...parsed.data, operation: 'status' }
  try {
    const login = await read('account_payment_login', input)
    if (login?.success !== true) throw new PaymentReadinessError('payment-readiness-unavailable')
    if (login.data?.state !== 'signed-in') throw new PaymentReadinessError('payment-login-required')
    const result = await read('account_payment_preferences', input)
    if (result?.success !== true) throw new PaymentReadinessError('payment-readiness-unavailable')
    const value = result.data
    if (value?.bankState === 'verification-required') throw new PaymentReadinessError('payment-login-required')
    if (value?.bankState !== 'available') throw new PaymentReadinessError('payment-readiness-unavailable')
    if (typeof value.preferredLabel !== 'string' || !value.preferredLabel.trim()) throw new PaymentReadinessError('payment-method-required')
    if (typeof value.requiresCashierVerification !== 'boolean') throw new PaymentReadinessError('payment-readiness-unavailable')
    if (value.requiresCashierVerification && value.preferredBindingAvailable !== true) throw new PaymentReadinessError('payment-method-required')
    // Transaction-specific channel identity is checked in applyPreference before any payment reservation.
  } catch (error) {
    if (error instanceof PaymentReadinessError) throw error
    throw new PaymentReadinessError('payment-readiness-unavailable')
  }
}
