/** Host-owned payment credentials. Ordinary settings and model calls contain no password. */
import { z } from 'zod'

const account = z.object({ platformId: z.literal('taobao'), accountRef: z.uuid() })
const password = z.string().regex(/^\d{6}$/)
const payload = z.object({ version: z.literal(1), externalId: z.string().min(1), password }).strict()
const messages = {
  'payment-credential-account': '请先选择已登录的淘宝闪购账号',
  'payment-credential-changed': '付款账号已变化，请重新设置支付密码',
  'payment-credential-unavailable': '支付凭据暂时不可用，请检查 DSH 凭据存储',
}

/** Only fixed messages may leave the credential owner. */
export class PaymentCredentialError extends Error {
  constructor(code) { super(messages[code]); this.code = code }
}

/** Use the public credentials service; no independent credential file or process environment. */
export class PaymentCredentials {
  /** @param options - Host credentials provider and private account-list reader. */
  constructor({ credentials, accounts }) { this.credentials = credentials; this.accounts = accounts }

  /** @param args - validated account selection. @returns public key and its saved account identity. */
  async owner(args) {
    const parsed = account.safeParse(args)
    if (!parsed.success) throw new PaymentCredentialError('payment-credential-account')
    const result = await this.accounts({ platformId: 'taobao' })
    const row = result?.success === true && result.data.accounts.find(item => item.ref === parsed.data.accountRef)
    if (!row?.externalId) throw new PaymentCredentialError('payment-credential-account')
    // The documented credential key grammar is <plugin>/<lowercase-hyphenated-id>.
    return { key: 'dsh-waimai/alipay-' + parsed.data.accountRef, externalId: String(row.externalId) }
  }

  /** @param owner - current account identity. @returns the current private value, or undefined when removed. */
  async read(owner) {
    const record = await this.credentials.readRecord(owner.key)
    if (!record) return undefined
    const parsed = record.kind === 'grant' && payload.safeParse(record.payload)
    if (!parsed?.success || parsed.data.externalId !== owner.externalId) throw new PaymentCredentialError('payment-credential-changed')
    return parsed.data.password
  }

  /** @param args - private settings operation. @returns presence and writability only. */
  async configure(args) {
    try {
      const owner = await this.owner(args)
      if (args.operation === 'save') {
        const value = password.parse(args.password)
        await this.credentials.modifyRecord(owner.key, () => ({ kind: 'grant',
          payload: { version: 1, externalId: owner.externalId, password: value } }))
      } else if (args.operation === 'remove') await this.credentials.deleteRecord(owner.key)
      const info = await this.credentials.describeRecord(owner.key)
      return { configured: (await this.read(owner)) !== undefined, writable: info.writable }
    } catch (error) {
      throw error instanceof PaymentCredentialError ? error : new PaymentCredentialError('payment-credential-unavailable')
    }
  }

  /** @param name - internal MCP method. @param args - original caller arguments. @returns private transport arguments without mutating logged input. */
  async prepareCall(name, args) {
    if (!['pay_order', 'account_payment_h5_submit'].includes(name) || args?.password !== undefined) return { name, arguments: args }
    try {
      const owner = await this.owner({ ...args, platformId: args.platformId ?? 'taobao' })
      const value = await this.read(owner)
      if (value === undefined) return { name, arguments: args }
      return { name: name === 'pay_order' ? 'account_payment_h5_pay' : name, arguments: { ...args, password: value } }
    } catch (error) {
      throw error instanceof PaymentCredentialError ? error : new PaymentCredentialError('payment-credential-unavailable')
    }
  }
}
