/** Host-owned payment credentials. Ordinary settings and model calls contain no password. */
import { z } from 'zod'

const account = z.object({ platformId: z.literal('taobao'), accountRef: z.uuid() })
const password = z.string().regex(/^\d{6}$/)
const legacyPayload = z.object({ version: z.literal(1), externalId: z.string().min(1), password }).strict()
const sharedPayload = z.union([z.object({ version: z.literal(2), password }).strict(),
  z.object({ version: z.literal(2), disabled: z.literal(true) }).strict()])
const sharedKey = 'dsh-waimai/alipay-payment'
const legacyKey = /^dsh-waimai\/alipay-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const messages = {
  'payment-credential-account': '请先选择已登录的淘宝闪购账号',
  'payment-credential-conflict': '旧支付密码设置存在冲突，请在支付配置中设置通用支付宝支付密码',
  'payment-credential-unavailable': '支付凭据暂时不可用，请检查 DSH 凭据存储',
}

/** Only fixed messages may leave the credential owner. */
export class PaymentCredentialError extends Error {
  constructor(code) { super(messages[code]); this.code = code }
}

/** Use the public credentials service; no independent credential file or process environment. */
export class PaymentCredentials {
  /** @param options - Host credentials provider and private account-list reader. */
  constructor({ credentials, accounts }) { this.credentials = credentials; this.accounts = accounts; this.queue = Promise.resolve() }

  /** @param args - current shopping account selection. @returns completion after verifying the payment caller's account. */
  async validateAccount(args) {
    const parsed = account.safeParse(args)
    if (!parsed.success) throw new PaymentCredentialError('payment-credential-account')
    const result = await this.accounts({ platformId: 'taobao' })
    const row = result?.success === true && result.data.accounts.find(item => item.ref === parsed.data.accountRef)
    if (!row?.externalId) throw new PaymentCredentialError('payment-credential-account')
  }

  /** @param work - one local credential operation. @returns its result without overlapping migration, rotation or removal. */
  run(work) {
    const result = this.queue.then(work)
    this.queue = result.then(() => {}, () => {})
    return result
  }

  /** @param record - provider-owned shared record. @returns validated private data or absence. */
  parseShared(record) {
    if (record === undefined) return undefined
    const parsed = record.kind === 'grant' && sharedPayload.safeParse(record.payload)
    if (!parsed?.success) throw new PaymentCredentialError('payment-credential-unavailable')
    return parsed.data
  }

  /** @returns only this plugin's former account-scoped payment record addresses. */
  async legacyKeys() {
    return (await this.credentials.listRecords()).filter(entry => legacyKey.test(entry.key)).map(entry => entry.key)
  }

  /** @returns private shared data; distinct legacy values require an explicit user choice. */
  async readShared() {
    const current = this.parseShared(await this.credentials.readRecord(sharedKey))
    if (current) return { value: current.password }
    const values = new Set()
    for (const key of await this.legacyKeys()) {
      const record = await this.credentials.readRecord(key)
      if (record === undefined) continue
      const parsed = record.kind === 'grant' && legacyPayload.safeParse(record.payload)
      if (!parsed?.success) return { migrationRequired: true }
      values.add(parsed.data.password)
    }
    if (!values.size) return {}
    if (values.size !== 1) return { migrationRequired: true }
    const value = values.values().next().value
    // A concurrent explicit save or removal owns the shared key; migration never replaces it.
    await this.credentials.modifyRecord(sharedKey, record => record ?? { kind: 'grant', payload: { version: 2, password: value } })
    const saved = this.parseShared(await this.credentials.readRecord(sharedKey))
    if (!saved) throw new PaymentCredentialError('payment-credential-unavailable')
    return { value: saved.password }
  }

  /** @param args - private settings operation. @returns presence and writability only. */
  async configure(args) {
    return this.run(async () => { try {
      if (args.operation === 'save') {
        const value = password.parse(args.password)
        await this.credentials.modifyRecord(sharedKey, () => ({ kind: 'grant', payload: { version: 2, password: value } }))
        if (this.parseShared(await this.credentials.readRecord(sharedKey))?.password !== value) throw new PaymentCredentialError('payment-credential-unavailable')
      } else if (args.operation === 'remove') {
        // Persist the removal before deleting legacy records so failures cannot resurrect a password.
        await this.credentials.modifyRecord(sharedKey, () => ({ kind: 'grant', payload: { version: 2, disabled: true } }))
        const removed = this.parseShared(await this.credentials.readRecord(sharedKey))
        if (!removed?.disabled) throw new PaymentCredentialError('payment-credential-unavailable')
        for (const key of await this.legacyKeys()) await this.credentials.deleteRecord(key)
      }
      const shared = await this.readShared(), info = await this.credentials.describeRecord(sharedKey)
      return { configured: shared.value !== undefined, writable: info.writable,
        ...(shared.migrationRequired ? { migrationRequired: true } : {}) }
    } catch (error) {
      throw error instanceof PaymentCredentialError ? error : new PaymentCredentialError('payment-credential-unavailable')
    } })
  }

  /** @param name - internal MCP method. @param args - original caller arguments. @returns private transport arguments without mutating logged input. */
  async prepareCall(name, args) {
    if (!['pay_order', 'account_payment_h5_submit'].includes(name) || args?.password !== undefined) return { name, arguments: args }
    return this.run(async () => { try {
      await this.validateAccount({ ...args, platformId: args.platformId ?? 'taobao' })
      const shared = await this.readShared()
      if (shared.migrationRequired) throw new PaymentCredentialError('payment-credential-conflict')
      const value = shared.value
      if (value === undefined) return { name, arguments: args }
      return { name: name === 'pay_order' ? 'account_payment_h5_pay' : name, arguments: { ...args, password: value } }
    } catch (error) {
      throw error instanceof PaymentCredentialError ? error : new PaymentCredentialError('payment-credential-unavailable')
    } })
  }
}
