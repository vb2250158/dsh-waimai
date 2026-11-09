/** Account-owned payment preference. Provider identifiers stay encrypted on this Windows user. */
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { protectSession } from './alipay-session-store.js'
import { TradeError } from './trade-data.js'

export const fundingLabels = Object.freeze({ balance: '支付宝余额', yuebao: '余额宝' })

const verifiedChoice = z.object({ selectedChannel: z.string().min(1).max(256), childChannel: z.string().max(256),
  label: z.string().min(1).max(160) }).strict()

const bankChoice = z.object({ kind: z.literal('bank-binding'), bankCode: z.string().regex(/^[A-Z0-9_]{2,20}$/),
  bankName: z.string().min(1).max(100), lastFour: z.string().regex(/^\d{4}$/), cardType: z.enum(['DC', 'CC']),
  bindingId: z.string().min(1).max(256), label: z.string().min(1).max(160) }).strict()

const choice = z.union([verifiedChoice, bankChoice, z.object({ fundingType: z.enum(['balance', 'yuebao']),
  label: z.string() }).strict().refine(value => value.label === fundingLabels[value.fundingType])])

/** One file per platform account; neither save nor clear authorizes a payment. */
export class PaymentPreference {
  constructor(path) { this.path = path }
  async load() {
    if (!this.path) return null
    let raw
    try { raw = await readFile(this.path) } catch (error) {
      if (error.code === 'ENOENT') return null
      throw new TradeError('payment-preference-unavailable', '无法读取默认付款方式，未付款')
    }
    try { return choice.parse(JSON.parse((await protectSession(raw, true)).toString('utf8'))) }
    catch { throw new TradeError('payment-preference-invalid', '默认付款方式无法解密，请在支付设置中重新配置') }
  }
  async save(value) {
    if (!this.path) throw new TradeError('payment-preference-unavailable', '未配置账号私有存储目录')
    const encrypted = await protectSession(Buffer.from(JSON.stringify(choice.parse(value))))
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = this.path + '.' + randomUUID() + '.tmp'
    try { await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 }); await rename(temporary, this.path) }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  async clear() {
    if (this.path) await unlink(this.path).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}
