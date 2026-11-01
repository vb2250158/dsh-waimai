/** Durable account-owned supermarket cart additions and reconciliation. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeJsonState } from './automation.js'
import { TradeError } from './trade-data.js'

const nativeId = z.string().regex(/^\d+$/).max(160)
const line = z.object({ cartId: nativeId, itemId: nativeId, skuId: nativeId,
  quantity: z.number().int().positive().safe(), checked: z.boolean(), isValid: z.boolean() }).strict()
const attempt = z.object({ seq: z.number().int().positive().safe(), operationRef: z.uuid(), accountId: nativeId, addressRef: z.string().regex(/^[a-f0-9]{64}$/),
  shopId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/), itemId: nativeId, quantity: z.number().int().min(1).max(100),
  before: z.array(line).max(2000), state: z.enum(['sent', 'verified']), createdAt: z.number().int().positive().safe() }).strict()
const journal = z.object({ version: z.literal(1), attempts: z.array(attempt).max(1000) }).strict()

/** @param cart - validated native supermarket cart. @returns deterministic private lines for reconciliation. */
export function retailCartLines(cart) {
  return cart.lines.map(item => line.parse({ cartId: item.cartId, itemId: item.itemId, skuId: item.skuId,
    quantity: item.amount.now, checked: item.checked, isValid: item.isValid })).sort((a, b) => a.cartId.localeCompare(b.cartId))
}

/** @param operation - retained addition and original snapshot. @param after - refreshed cart lines. @returns exact, isolated SKU addition. */
export function retailAdditionVerified(operation, after) {
  const target = value => value.itemId === operation.itemId && value.skuId === '0'
  const oldTarget = operation.before.filter(target), newTarget = after.filter(target)
  if (oldTarget.length > 1 || newTarget.length !== 1) return false
  if (JSON.stringify(operation.before.filter(value => !target(value))) !== JSON.stringify(after.filter(value => !target(value)))) return false
  if (oldTarget.length && (oldTarget[0].cartId !== newTarget[0].cartId || oldTarget[0].checked !== newTarget[0].checked
    || oldTarget[0].isValid !== newTarget[0].isValid)) return false
  return newTarget[0].isValid && newTarget[0].quantity === (oldTarget[0]?.quantity ?? 0) + operation.quantity
}

/** Own one account's durable mutation journal and lock. */
export class RetailCartActions {
  /** @param retail - supermarket request and account owner. @param directory - private account directory. */
  constructor(retail, directory) { this.retail = retail; this.directory = join(directory, 'retail-cart-attempts') }

  /** @param accountId - independently verified business identity. @returns stable journal and lock paths across login sessions. */
  paths(accountId) {
    const identity = nativeId.parse(String(accountId)), key = createHash('sha256').update(identity).digest('hex')
    const path = join(this.directory, key + '.json')
    return { path, lockPath: path + '.lock', archive: path + '.archive', accountId: identity }
  }

  digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

  /** Read the complete journal generation; temporary files are never committed records. */
  async generation(paths) {
    const read = async path => {
      try { return this.digest(JSON.parse(await readFile(path, 'utf8'))) }
      catch (error) { if (error.code === 'ENOENT') return null; throw error }
    }
    let entries
    try { entries = await readdir(paths.archive) } catch (error) { if (error.code !== 'ENOENT') throw error; entries = [] }
    const files = []
    for (const name of entries.filter(name => /^\d+-\d+\.json$/.test(name)).sort()) files.push({ name, hash: await read(join(paths.archive, name)) })
    return { hot: await read(paths.path), index: await read(join(paths.archive, 'index.json')), files }
  }

  /** Check the independently anchored generation without making repairs. */
  async checkedGeneration(paths) {
    const actual = await this.generation(paths)
    let marker
    try {
      const hash = z.string().regex(/^[a-f0-9]{64}$/).nullable()
      const generation = z.object({ hot: hash, index: hash, files: z.array(z.object({ name: z.string().regex(/^\d+-\d+\.json$/), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()) }).strict()
      marker = z.object({ version: z.literal(2), current: generation, next: generation.nullable() }).strict().parse(JSON.parse(await readFile(paths.path + '.integrity', 'utf8')))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (actual.hot !== null || actual.index !== null || actual.files.length) throw new Error('missing integrity marker')
      return actual
    }
    if (JSON.stringify(actual) !== JSON.stringify(marker.current) && JSON.stringify(actual) !== JSON.stringify(marker.next)) throw new Error('generation integrity mismatch')
    return actual
  }

  /** Replace one generation member with a recoverable pre/post transition. */
  async guardedWrite(paths, path, value) {
    const current = await this.checkedGeneration(paths), next = structuredClone(current), hash = this.digest(value)
    if (path === paths.path) next.hot = hash
    else if (path === join(paths.archive, 'index.json')) next.index = hash
    else {
      const name = path.slice(paths.archive.length + 1)
      if (!/^\d+-\d+\.json$/.test(name) || path !== join(paths.archive, name)) throw new Error('invalid generation member')
      const prior = next.files.find(row => row.name === name)
      if (prior) throw new Error('archive already exists')
      next.files.push({ name, hash }); next.files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    }
    const markerPath = paths.path + '.integrity'
    await writeJsonState(markerPath, { version: 2, current, next })
    await writeJsonState(path, value)
    if (JSON.stringify(await this.generation(paths)) !== JSON.stringify(next)) throw new Error('generation readback')
    await writeJsonState(markerPath, { version: 2, current: next, next: null })
  }

  /** @returns validated journal; missing or changed committed files fail closed. */
  async readJournal(paths) {
    try {
      const generation = await this.checkedGeneration(paths)
      if (generation.hot === null) return { version: 1, attempts: [] }
      const value = journal.parse(JSON.parse(await readFile(paths.path, 'utf8')))
      const pending = value.attempts.filter(row => row.state === 'sent')
      if (value.attempts.some(row => row.accountId !== paths.accountId) || pending.length > 1
        || (pending.length && value.attempts.at(-1) !== pending[0])
        || new Set(value.attempts.map(row => row.operationRef)).size !== value.attempts.length) throw new Error('invalid journal')
      return value
    } catch { throw new TradeError('cart-journal-invalid', '加购记录无法读取，请先核对购物车') }
  }

  /** Atomically replace and verify the hot journal within a generation transition. */
  async save(paths, value) {
    journal.parse(value)
    await this.readJournal(paths)
    await this.guardedWrite(paths, paths.path, value)
    if (JSON.stringify(await this.readJournal(paths)) !== JSON.stringify(value)) throw new TradeError('cart-journal-invalid', '加购记录写入未确认')
  }

  /** Reconcile archive index and hot records while holding the account lock. */
  async maintain(paths, now = Date.now()) {
    try {
      const indexPath = join(paths.archive, 'index.json')
      let index
      try { index = z.object({ version: z.literal(1), files: z.array(z.string().regex(/^\d+-\d+\.json$/)) }).strict().parse(JSON.parse(await readFile(indexPath, 'utf8'))) }
      catch (error) { if (error.code !== 'ENOENT') throw error; index = { version: 1, files: [] } }
      let entries
      try { entries = await readdir(paths.archive) } catch (error) { if (error.code !== 'ENOENT') throw error; entries = [] }
      const files = entries.filter(name => /^\d+-\d+\.json$/.test(name))
      let hot = await this.readJournal(paths), archived = []
      const load = async name => {
        const value = journal.parse(JSON.parse(await readFile(join(paths.archive, name), 'utf8')))
        if (!value.attempts.length || value.attempts.some(row => row.state !== 'verified' || row.accountId !== paths.accountId)) throw new Error('invalid archive')
        if (name !== `${value.attempts[0].seq}-${value.attempts.at(-1).seq}.json`) throw new Error('invalid archive range')
        return value.attempts
      }
      for (const name of index.files) {
        if (!files.includes(name)) throw new Error('missing archive')
        archived.push(...await load(name))
      }
      const extra = files.filter(name => !index.files.includes(name))
      if (extra.length > 1) throw new Error('ambiguous archive')
      if (extra.length) {
        const orphan = await load(extra[0])
        if (JSON.stringify(hot.attempts.slice(0, orphan.length)) !== JSON.stringify(orphan)) throw new Error('unmatched archive')
        if (orphan[0].seq !== archived.length + 1) throw new Error('archive gap')
        archived.push(...orphan)
      }
      if (archived.some((row, i) => row.seq !== i + 1)) throw new Error('archive sequence')
      let overlapCount = 0
      while (overlapCount < hot.attempts.length && hot.attempts[overlapCount].seq <= archived.length) overlapCount++
      const overlap = hot.attempts.slice(0, overlapCount)
      if (overlap.length && (overlap[0].seq < 1 || overlap.length !== archived.length - overlap[0].seq + 1 ||
          JSON.stringify(overlap) !== JSON.stringify(archived.slice(overlap[0].seq - 1)))) throw new Error('archive overlap')
      const remaining = hot.attempts.slice(overlapCount)
      if (remaining.some((row, i) => row.seq !== archived.length + i + 1)) throw new Error('hot sequence')
      const all = [...archived, ...remaining]
      if (new Set(all.map(row => row.operationRef)).size !== all.length) throw new Error('duplicate operation')
      if (extra.length) {
        index.files.push(extra[0]); await this.guardedWrite(paths, indexPath, index)
        if (JSON.stringify(JSON.parse(await readFile(indexPath, 'utf8'))) !== JSON.stringify(index)) throw new Error('index readback')
      }
      if (overlapCount) { hot = { version: 1, attempts: remaining }; await this.save(paths, hot) }
      if (hot.attempts.some(row => row.state === 'verified' && now - row.createdAt > 72 * 3600_000)) {
        let count = 0
        while (count < hot.attempts.length && hot.attempts[count].state === 'verified' && now - hot.attempts[count].createdAt > 24 * 3600_000) count++
        if (count) {
          const prefix = hot.attempts.slice(0, count), name = `${prefix[0].seq}-${prefix.at(-1).seq}.json`
          await this.guardedWrite(paths, join(paths.archive, name), { version: 1, attempts: prefix })
          if (JSON.stringify(await load(name)) !== JSON.stringify(prefix)) throw new Error('archive readback')
          index.files.push(name); await this.guardedWrite(paths, indexPath, index)
          const checked = JSON.parse(await readFile(indexPath, 'utf8'))
          if (JSON.stringify(checked) !== JSON.stringify(index)) throw new Error('index readback')
          archived.push(...prefix); hot = { version: 1, attempts: hot.attempts.slice(count) }
          await this.save(paths, hot)
        }
      }
      return { archived, hot }
    } catch { throw new TradeError('cart-journal-invalid', '加购记录整理未确认，请核对本机记录') }
  }

  /** @param context - verified owner. @param cart - freshly read cart. @param canWrite - caller holds the journal lock. @returns mutation status. */
  async reconcile(context, cart, canWrite, paths) {
    const value = (await this.maintain(paths)).hot, pending = value.attempts.at(-1)
    if (!pending) return null
    if (pending.accountId !== String(context.accountId) || pending.addressRef !== context.address.ref || pending.shopId !== context.shopId) {
      return pending.state === 'sent' ? { operationRef: pending.operationRef, state: 'unconfirmed' } : null
    }
    if (pending.state === 'verified') return { operationRef: pending.operationRef, state: 'verified' }
    const verified = retailAdditionVerified(pending, retailCartLines(cart))
    if (verified && canWrite) { pending.state = 'verified'; await this.save(paths, value) }
    return { operationRef: pending.operationRef, state: verified && canWrite ? 'verified' : 'unconfirmed' }
  }

  /** @param context - verified owner. @param cart - refreshed cart. @returns cart display with reconciled mutation state. */
  async read(context, cart, ownsLock = false) {
    const paths = this.paths(context.accountId)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    let acquired = false
    if (!ownsLock) {
      try { await mkdir(paths.lockPath, { mode: 0o700 }); acquired = true }
      catch (error) { if (error.code !== 'EEXIST') throw error }
    }
    try {
      const mutation = !ownsLock && !acquired ? { state: 'unconfirmed' } : await this.reconcile(context, cart, true, paths)
      return { ...this.retail.trade.displayCart(context, cart), ...(mutation ? { mutation } : {}) }
    } finally { if (acquired) await rmdir(paths.lockPath) }
  }

  /** @param args - product, current revision and unique operation. @returns verified cart or unconfirmed failure. */
  async add(args) {
    await this.retail.login.requireAccount()
    const identity = String(this.retail.login.accountId), paths = this.paths(identity)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try { await mkdir(paths.lockPath, { mode: 0o700 }) }
    catch { throw new TradeError('cart-locked', '已有加购操作或未释放的加购锁，请先核对购物车') }
    try { return await this.addLocked(args, paths, identity) }
    finally { await rmdir(paths.lockPath) }
  }

  /** @param args - requested addition. Caller holds the account lock. @returns verified cart. */
  async addLocked(args, paths, identity) {
    const history = await this.maintain(paths), value = history.hot
    if ([...history.archived, ...value.attempts].some(row => row.operationRef === args.operationRef)) throw new TradeError('cart-duplicate', '本次加购已有记录，请刷新购物车核对')
    if (value.attempts.some(row => row.state === 'sent')) throw new TradeError('cart-result-unconfirmed', '上次加购待核对，请先刷新购物车')
    if (value.attempts.length >= 1000) throw new TradeError('cart-action-limit', '加购记录已达到保留上限，请先处理历史记录')
    const retail = this.retail, product = retail.products.get(args.productRef)
    if (!product) throw new TradeError('retail-product-expired', '请重新查询商超商品')
    const context = await retail.context(product.context.shopId, args.addressRef)
    if (String(context.accountId) !== identity || context.accountId !== product.context.accountId || context.address.ref !== product.context.address.ref) throw new TradeError('account-changed', '账号或配送地址已变化')
    const cart = await retail.requestCart(context)
    if (cart.revision !== args.revision) throw new TradeError('cart-changed', '购物车已变化，请重新读取')
    const matches = (await retail.query(context, product.keyword)).filter(row => row.itemId === product.itemId)
    const item = matches[0]
    if (matches.length !== 1 || !item || item.title !== product.name || item.itemStatus !== 0 || item.stockModel.quantity < args.quantity
      || item.startWith > args.quantity || item.skuModel || item.itemCustomPropertyModelList.length) throw new TradeError('retail-spec-required', '商品规格、库存或起购数量已变化，请重新查询')
    const before = retailCartLines(cart), targets = before.filter(row => row.itemId === item.itemId && row.skuId === '0')
    if (targets.length > 1) throw new TradeError('retail-cart-invalid', '购物车商品无法唯一核对')
    const previous = targets[0]?.quantity ?? 0
    if (previous + args.quantity > item.stockModel.quantity) throw new TradeError('retail-stock', '商品库存不足')
    await retail.trade.verify(context)
    if ((await retail.requestCart(context)).revision !== cart.revision) throw new TradeError('cart-changed', '购物车已变化，请重新读取')
    const operation = attempt.parse({ seq: history.archived.length + value.attempts.length + 1, operationRef: args.operationRef, accountId: String(context.accountId), addressRef: context.address.ref,
      shopId: context.shopId, itemId: item.itemId, quantity: args.quantity, before, state: 'sent', createdAt: Date.now() })
    value.attempts.push(operation); await this.save(paths, value); retail.trade.invalidateQuotes(context)
    retail.login.diagnostic?.({ group: 'waimai-cart', attemptId: args.operationRef, stage: 'retail-add-sent', quantityDelta: args.quantity })
    try {
      const raw = await retail.login.mtop(retail.login.protocol.retail.add, { cartFrom: 'eleme_newretail', itemId: item.itemId, skuId: '0', quantity: args.quantity,
        exParams: JSON.stringify({ ...retail.extra(context), version_newretail: '1.0.2', itemNextCount: previous + args.quantity, cartItemAttrs: [] }) }, false)
      retail.service.checkReply(raw, 'cart-result-unconfirmed', '加购结果未确认，请读取购物车，勿重复提交')
      const after = await retail.requestCart(context)
      await retail.trade.verify(context)
      const display = await this.read(context, after, true)
      if (display.mutation?.state !== 'verified') throw new TradeError('cart-result-unconfirmed', '加购结果待核对')
      return display
    } catch {
      throw new TradeError('cart-result-unconfirmed', '加购结果待核对，请刷新购物车，勿重复加购')
    }
  }
}
