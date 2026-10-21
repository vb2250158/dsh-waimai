/** Account-owned Hema quotes and single-attempt native order creation. */
import { randomUUID, createHash } from 'node:crypto'
import { readFile, writeFile, copyFile, mkdir, rmdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { TaobaoTrade } from './taobao-trade.js'
import { TradeError } from './trade-data.js'
import { hemaCartLines } from './hema-cart.js'
import { hemaDeliveryContext, hemaBuildParameters, hemaCheckoutData, hemaSubmitParameters, hemaPaymentDestination } from './hema-trade-data.js'
import { writeJsonState, toDateKey } from './automation.js'

/** Hema reuses the shared purchase limits and ledger; native parameters remain ephemeral. */
export class HemaTrade extends TaobaoTrade {
  /** @param service - sole Hema account/address owner. @param options - shared purchase limits and journal directory. */
  constructor(service, options) { super(service, options); this.paymentHandoffs = new Map() }

  /** @param args - current cart revision, delivery group and explicit line IDs. @returns verified quote without changing cart selections. */
  checkout(args) {
    return this.login.run(async () => {
      this.quote = null
      await this.login.requireAccount()
      const accountId = this.login.accountId, selected = await this.service.selectedAddress(args.addressRef), cart = await this.service.readCart(selected)
      if (cart.display.revision !== args.revision) throw new TradeError('cart-changed', '购物车已变化，请刷新后重新结算')
      const ids = args.lineIds || cart.display.items.filter(row => row.selected).map(row => row.id)
      z.array(z.string().regex(/^[1-9]\d*$/)).min(1).max(50).parse(ids)
      if (new Set(ids).size !== ids.length) throw new TradeError('bad-request', '请选择不重复的购物车商品')
      const lines = hemaCartLines(cart.raw).filter(row => ids.includes(row.cartId))
      if (lines.length !== ids.length || ids.some(id => !cart.display.items.some(row => row.id === id && row.available))) throw new TradeError('item-unavailable', '所选商品已失效，请刷新购物车')
      // Quantity-one quotes are independently verified against the native line total.
      if (lines.some(row => row.quantity !== '1')) throw new TradeError('quantity-unverified', '盒马当前仅支持每种商品数量为 1 的结算')
      const groupId = args.shopId || selected.groups[0]?.groupId
      if (!selected.groups.some(row => row.groupId === groupId)) throw new TradeError('shop-unavailable', '配送门店已变化，请重新选择')
      const decision = await this.login.mtop(this.login.protocol.deliveryDecision, { addressId: selected.nativeId, source: 'HEMA_APP', terminal: 'HEMA_APP', channelCode: 'HM' })
      this.login.checkReply(decision)
      let delivery
      try { delivery = hemaDeliveryContext(decision.data, selected, groupId) }
      catch { throw new TradeError('address-changed', '盒马配送地址或门店无法复核，请刷新地址') }
      const confirmed = await this.login.mtop(this.login.protocol.cartConfirm, { cartIds: JSON.stringify(lines.map(row => row.cartId)), cartType: '0', confirmType: '0',
        exParams: '{}', locationIds: delivery.group.locationIds, shopIds: delivery.group.shopIds, scenarioGroup: '', userId: accountId }, false)
      this.login.checkReply(confirmed)
      let parameters
      try { parameters = hemaBuildParameters(confirmed.data, delivery) }
      catch { throw new TradeError('checkout-interaction-required', '盒马结算需要额外确认，请在官方客户端核对') }
      const built = await this.login.mtop(this.login.protocol.checkout, parameters, false)
      this.login.checkReply(built)
      let result
      try { result = hemaCheckoutData(built.data, { address: delivery.address, lines }) }
      catch { throw new TradeError('checkout-invalid', '盒马结算的地址、商品、费用或附加服务无法核对，未创建订单') }
      await this.login.verifyIdentity(accountId)
      if (JSON.stringify(await this.service.selectedAddress(selected.ref)) !== JSON.stringify(selected)) throw new TradeError('address-changed', '配送地址已变化，请重新结算')
      if ((await this.service.readCart(selected)).display.revision !== cart.display.revision) throw new TradeError('cart-changed', '报价期间购物车已变化，请重新结算')
      const quoteRef = randomUUID(), expiresAt = this.now() + this.quoteSeconds * 1000
      this.quote = { quoteRef, expiresAt, accountId, selected: structuredClone(selected), groupId, cartRevision: cart.display.revision, lines, ...result }
      this.login.diagnostic?.({ group: 'waimai-order', attemptId: quoteRef, stage: 'hema-quote-verified', amountCents: result.display.totalCents })
      return { platformId: 'hema', accountId, addressRef: selected.ref, shopId: groupId, revision: cart.display.revision, quoteRef, expiresAt,
        ...result.display, address: selected.display, previewOnly: this.dryRun, maxOrderCents: this.capCents, dailyBudgetCents: this.budgetCents }
    })
  }

  /** @param value - next shared ledger. Back up and verify every field before sending financial requests. */
  async saveJournal(value) {
    let before
    try { before = await readFile(this.journalPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (before) await copyFile(this.journalPath, this.journalPath + '.before-' + randomUUID())
    try {
      await writeJsonState(this.journalPath, value)
      if (JSON.stringify(await this.journal()) !== JSON.stringify(value)) throw new TradeError('trade-journal-invalid', '下单记录保存未确认，已停止提交')
    } catch (error) {
      if (before) {
        await writeFile(this.journalPath, before)
        if (!(await readFile(this.journalPath)).equals(before)) throw new TradeError('trade-journal-invalid', '下单记录恢复未确认，请核对本机备份')
      }
      throw error
    }
  }

  /** @param args - fresh quote and explicit confirmation of its amount. @returns created order IDs; unknown requests are never retried. */
  submit(args) {
    return this.login.run(async () => {
      const quote = this.quote
      if (!quote || quote.quoteRef !== args.quoteRef || this.now() >= quote.expiresAt) throw new TradeError('quote-expired', '报价已过期，请重新结算')
      if (this.dryRun && args.manualConfirmation !== true) throw new TradeError('preview-only', '请明确确认本笔盒马订单后再提交')
      if (args.confirmed !== true || args.confirmedCents !== quote.display.totalCents) throw new TradeError('amount-unconfirmed', '请重新确认实付金额')
      if (quote.display.totalCents > Math.min(this.capCents, args.maxAmountCents ?? this.capCents)) throw new TradeError('over-cap', '实付金额超过单笔上限，未创建订单')
      await this.login.requireAccount()
      if (this.login.accountId !== quote.accountId) throw new TradeError('account-changed', '账号已变化，未创建订单')
      if (JSON.stringify(await this.service.selectedAddress(quote.selected.ref)) !== JSON.stringify(quote.selected)) throw new TradeError('address-changed', '配送地址已变化，请重新结算')
      if ((await this.service.readCart(quote.selected)).display.revision !== quote.cartRevision) throw new TradeError('cart-changed', '购物车已变化，请重新结算')
      const request = hemaSubmitParameters(quote.raw), lockPath = this.journalPath + '.lock'
      await mkdir(dirname(this.journalPath), { recursive: true, mode: 0o700 })
      try { await mkdir(lockPath, { mode: 0o700 }) } catch { throw new TradeError('trade-locked', '已有下单操作，请先核对历史订单和本机记录') }
      try {
        const journal = await this.journal(), day = toDateKey(new Date(this.now()))
        const fingerprint = createHash('sha256').update(JSON.stringify(['hema', quote.accountId, quote.selected.ref,
          quote.lines.map(row => [row.cartId, row.itemId, row.skuId, row.quantity])])).digest('hex')
        if (journal.attempts.some(row => row.fingerprint === fingerprint)) throw new TradeError('order-duplicate', '相同商品已有下单记录，请先核对官方订单')
        if (this.now() >= quote.expiresAt) throw new TradeError('quote-expired', '报价已过期，请重新结算')
        const reserved = journal.attempts.filter(row => row.day === day).reduce((sum, row) => sum + row.amountCents, 0)
        if (this.budgetCents > 0 && reserved + quote.display.totalCents > this.budgetCents) throw new TradeError('over-budget', '已达到每日下单上限，未创建订单')
        const record = { ref: quote.quoteRef, accountId: quote.accountId, fingerprint, day, amountCents: quote.display.totalCents, merchant: quote.display.merchant, status: 'unknown' }
        journal.attempts.push(record)
        await this.saveJournal(journal)
        this.quote = null
        this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'hema-submit-sent', amountCents: record.amountCents })
        let orderIds, paymentUrl = null
        try {
          const reply = await this.login.mtop(this.login.protocol.submit, request, false)
          this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'hema-create-reply',
            ret: reply.ret.slice(0, 8).map(value => { const code = value.split('::')[0]; return /^[A-Z_0-9]{1,80}$/.test(code) ? code : 'unrecognized' }) })
          this.login.checkReply(reply)
          orderIds = [...new Set(z.string().regex(/^\d+(,\d+)*$/).max(1000).parse(reply.data.bizOrderId).split(','))]
          paymentUrl = hemaPaymentDestination(reply.data.nextUrl)
        } catch {
          this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'hema-submit-unconfirmed' })
          throw new TradeError('order-unknown', '下单结果未确认，请核对盒马官方历史订单，勿重复提交；金额已保留')
        }
        Object.assign(record, { status: 'created', orderIds })
        await this.saveJournal(journal)
        if (paymentUrl) { this.paymentHandoffs.set(record.ref, paymentUrl); while (this.paymentHandoffs.size > 20) this.paymentHandoffs.delete(this.paymentHandoffs.keys().next().value) }
        this.login.diagnostic?.({ group: 'waimai-order', attemptId: record.ref, stage: 'hema-order-created', amountCents: record.amountCents })
        return { platformId: 'hema', accountId: record.accountId, addressRef: quote.selected.ref, shopId: quote.groupId, orderRef: record.ref,
          amountCents: record.amountCents, orderIds, paymentUrl, paymentStatus: 'unconfirmed' }
      } finally { await rmdir(lockPath) }
    })
  }

  /** @returns account-specific attempts; cashier credentials are never stored in the journal. */
  tradeHistory() {
    return this.login.run(async () => {
      await this.login.requireAccount()
      const journal = await this.journal()
      return { platformId: 'hema', accountId: this.login.accountId, attempts: journal.attempts.filter(row => row.accountId === this.login.accountId).slice(-20).reverse()
        .map(row => ({ orderRef: row.ref, merchant: row.merchant, amountCents: row.amountCents, day: row.day, status: row.status,
          orderIds: row.orderIds || [], paymentUrl: this.paymentHandoffs.get(row.ref) || null, paymentStatus: 'unconfirmed' })) }
    })
  }
}
