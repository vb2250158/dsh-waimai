/** Hema add operations retain an account/address snapshot and never resend an uncertain mutation. */
import { createHash } from 'node:crypto'
import { readFile, copyFile, writeFile, mkdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeJsonState } from './automation.js'
import { PlatformError } from './platform-service.js'

const nativeId = z.string().regex(/^[1-9]\d*$/).max(128)
const line = z.object({ cartId: nativeId, itemId: nativeId, skuId: nativeId,
  quantity: z.string().regex(/^\d{1,9}(?:\.\d{1,6})?$/), selected: z.boolean() }).strict()
const attempt = z.object({ operationRef: z.uuid(), accountId: nativeId, addressRef: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.string().regex(/^[a-f0-9]{64}$/), productRef: z.uuid(), itemId: nativeId, skuId: nativeId,
  quantity: z.number().int().min(1).max(100), before: z.array(line).max(2000),
  state: z.enum(['sent', 'verified']), createdAt: z.number().int().positive().safe() }).strict()
const journal = z.object({ version: z.literal(1), attempts: z.array(attempt).max(1000) }).strict()

/** @param raw - already validated complete cart. @returns private mutation snapshot; missing native identities stop writes. */
export function hemaCartLines(raw) {
  return Object.values(raw.data).filter(node => ['mainItem', 'invalidMainItem'].includes(node.tag)).map(node => line.parse({
    cartId: String(node.fields.cartId), itemId: String(node.fields.itemId), skuId: String(node.fields.sku?.skuId),
    quantity: node.fields.quantity, selected: node.fields.isChecked === 'true',
  })).sort((a, b) => a.cartId.localeCompare(b.cartId))
}

/** @param accountId - verified identity. @param addressRef - selected revision. @param raw - validated cart. @returns revision bound to native lines and current prices. */
export function hemaCartRevision(accountId, addressRef, raw) {
  const items = Object.values(raw.data).filter(node => ['mainItem', 'invalidMainItem'].includes(node.tag)).map(node => [node.tag,
    String(node.fields.cartId), String(node.fields.itemId), String(node.fields.sku?.skuId), node.fields.quantity,
    node.fields.isChecked, node.fields.canCheck, node.fields.sku?.skuInvalid, node.fields.pay?.nowTitle]).sort((a, b) => a[1].localeCompare(b[1]))
  return createHash('sha256').update(JSON.stringify([accountId, addressRef, items])).digest('hex')
}

/** @param operation - retained snapshot. @param after - fresh same-address lines. @returns whether exactly the requested SKU delta and no unrelated changes occurred. */
export function hemaAdditionVerified(operation, after) {
  const target = value => value.itemId === operation.itemId && value.skuId === operation.skuId
  const oldOthers = operation.before.filter(value => !target(value)), newOthers = after.filter(value => !target(value))
  if (JSON.stringify(oldOthers) !== JSON.stringify(newOthers)) return false
  const oldTarget = operation.before.filter(target), newTarget = after.filter(target)
  if (newTarget.length !== 1 || oldTarget.length > 1 || !newTarget[0].selected) return false
  if (oldTarget.length && newTarget[0].cartId !== oldTarget[0].cartId) return false
  return Number(newTarget[0].quantity) === Number(oldTarget[0]?.quantity || 0) + operation.quantity
}

/** Own durable add attempts for one Hema account; service serialization covers reads and writes. */
export class HemaCartActions {
  /** @param service - account/address owner. @param directory - private account directory. */
  constructor(service, directory) { this.service = service; this.login = service.login; this.path = join(directory, 'hema-cart-attempts.json'); this.lockPath = this.path + '.lock' }

  /** @returns validated attempts; a corrupt journal never permits another write. */
  async readJournal() {
    try { return journal.parse(JSON.parse(await readFile(this.path, 'utf8'))) }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, attempts: [] }; throw new PlatformError('cart-journal-invalid', '加购记录无法读取，请先核对购物车') }
  }

  /** @param value - complete next journal. Back up the prior bytes before atomic replacement and read back all fields. */
  async save(value) {
    journal.parse(value)
    let before
    try { before = await readFile(this.path) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (before) await copyFile(this.path, this.path + '.before-' + value.attempts.at(-1).operationRef + '-' + Date.now())
    try {
      await writeJsonState(this.path, value)
      if (JSON.stringify(await this.readJournal()) !== JSON.stringify(value)) throw new PlatformError('cart-journal-invalid', '加购记录写入未确认，请核对购物车')
    } catch (error) {
      if (before) { await writeFile(this.path, before); if (!(await readFile(this.path)).equals(before)) throw new PlatformError('cart-journal-invalid', '加购记录恢复未确认') }
      throw error
    }
  }

  /** @param selected - fresh selected address. @returns current cart plus reconciliation of the original request, without resending it. */
  async read(selected, ownsLock = false) {
    let acquired = false
    if (!ownsLock) {
      try { await mkdir(this.lockPath, { mode: 0o700 }); acquired = true }
      catch (error) { if (error.code !== 'EEXIST') throw error }
    }
    try { return await this.reconcile(selected, acquired || ownsLock) }
    finally { if (acquired) await rmdir(this.lockPath) }
  }

  /** @param selected - read scope. @param canWrite - this call holds the account journal lock. @returns current cart with the retained request status. */
  async reconcile(selected, canWrite) {
    const current = await this.service.readCart(selected), value = await this.readJournal(), pending = value.attempts.at(-1)
    if (!pending) return current.display
    if (pending.accountId !== this.login.accountId || pending.addressRef !== selected.ref) {
      return pending.state === 'sent' ? { ...current.display, mutation: { operationRef: pending.operationRef, state: 'unconfirmed' } } : current.display
    }
    if (pending.state === 'verified') return { ...current.display, mutation: { operationRef: pending.operationRef, state: 'verified' } }
    let verified = false
    try { verified = hemaAdditionVerified(pending, hemaCartLines(current.raw)) }
    catch (error) { if (!(error instanceof z.ZodError)) throw error }
    if (verified && canWrite) { pending.state = 'verified'; await this.save(value) }
    return { ...current.display, mutation: { operationRef: pending.operationRef, state: verified && canWrite ? 'verified' : 'unconfirmed' } }
  }

  /** @param args - current product/SKU, cart revision and action identity. @returns independently verified cart; uncertain outcomes allow only reads. */
  async add(args) {
    try { await mkdir(this.lockPath, { mode: 0o700 }) }
    catch { throw new PlatformError('cart-locked', '已有加购操作或未释放的加购锁，请先核对购物车和本机记录') }
    try { return await this.addLocked(args) }
    finally { await rmdir(this.lockPath) }
  }

  /** @param args - validated native SKU change. Only the holder of this account's journal lock may send a request. @returns reconciled cart. */
  async addLocked(args) {
    const value = await this.readJournal()
    if (value.attempts.some(row => row.operationRef === args.operationRef)) throw new PlatformError('cart-duplicate', '此操作已有记录，请刷新购物车核对，勿重复加购')
    if (value.attempts.some(row => row.state === 'sent')) throw new PlatformError('cart-result-unconfirmed', '上次加购仍待核对，请先刷新购物车')
    if (value.attempts.length >= 1000) throw new PlatformError('cart-action-limit', '加购记录已达到保留上限，请先处理历史记录')
    await this.login.requireAccount()
    const accountId = this.login.accountId, selected = await this.service.selectedAddress(args.addressRef)
    const product = await this.service.readProduct(args.productRef, selected)
    const variant = product.display.product.variants.find(row => row.id === args.skuId)
    if (!product.display.product.available || !variant || variant.stockQuantity < args.quantity) throw new PlatformError('item-unavailable', '规格库存不足，请刷新商品')
    if (product.raw.ifWeight !== false || product.raw.ifTmallItem !== false || !Number.isInteger(variant.minimumQuantity) || !Number.isInteger(variant.quantityStep)
      || args.quantity < variant.minimumQuantity || (args.quantity - variant.minimumQuantity) % variant.quantityStep !== 0) {
      throw new PlatformError('spec-required', '该规格的计量或加购方式尚未确认，请使用官方客户端')
    }
    const before = await this.service.readCart(selected)
    if (before.display.revision !== args.revision) throw new PlatformError('cart-changed', '购物车已变化，请刷新后再加购')
    const snapshot = hemaCartLines(before.raw)
    await this.login.verifyIdentity(accountId); await this.service.selectedAddress(selected.ref)
    const fresh = await this.service.readCart(selected)
    if (fresh.display.revision !== before.display.revision) throw new PlatformError('cart-changed', '购物车已变化，请刷新后再加购')
    const operation = attempt.parse({ operationRef: args.operationRef, accountId, addressRef: selected.ref, revision: args.revision,
      productRef: args.productRef, itemId: product.item.id, skuId: args.skuId, quantity: args.quantity, before: snapshot, state: 'sent', createdAt: Date.now() })
    value.attempts.push(operation); await this.save(value)
    this.login.diagnostic?.({ group: 'waimai-cart', attemptId: args.operationRef, stage: 'hema-add-sent', quantityDelta: args.quantity })
    try {
      const reply = await this.login.mtop(this.login.protocol.cartAdd, { shopIds: product.item.nativeShopId, userId: accountId, itemId: product.item.id,
        skuId: args.skuId, quantity: args.quantity, cartRole: 1, cartType: 0, activityId: 0, addFrom: '', serviceItemId: 0,
        serviceItemTitle: '', serviceItemMultiple: '', voucherCode: '', scenarioGroup: '', extParams: '' }, false)
      this.login.checkReply(reply)
      const result = await this.read(selected, true)
      this.login.diagnostic?.({ group: 'waimai-cart', attemptId: args.operationRef, stage: result.mutation.state === 'verified' ? 'hema-add-verified' : 'hema-add-unconfirmed' })
      return result
    } catch {
      this.login.diagnostic?.({ group: 'waimai-cart', attemptId: args.operationRef, stage: 'hema-add-unconfirmed' })
      throw new PlatformError('cart-result-unconfirmed', '加购结果待核对，请刷新购物车，勿重复加购')
    }
  }
}
