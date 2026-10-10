/** Coupon interactions restricted to free coupon cards and eligible checkout options. */
const COUPON_CARDS = '[data-coupon-id], .coupon-item, [class*="couponItem"], [class*="CouponItem"]'
const UNAVAILABLE = /已过期|不可用|不满足|未达到|不能使用/
const PAID_OFFER = /购买|开通|会员|充值|支付|兑换|积分|券包|月卡|年卡/
const claimAttempts = new WeakMap()

/** Extract the reduction rather than a minimum-spend threshold.
 * @param text - coupon card text.
 * @returns an observed discount, or undefined when it cannot be read.
 */
export function couponDiscount(text) {
  const match = text.match(/(?:减|抵|优惠|立减)\s*[¥￥]?\s*(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : undefined
}

/** Claim visible free coupons once each; membership and paid packages are excluded.
 * @param page - active shop page.
 * @param options - enablement, preview flag and maximum claims per call.
 * @returns attempted and page-confirmed counts; no retry for unknown results.
 */
export async function claimCoupons(page, { enabled, dryRun, limit }) {
  if (!enabled || dryRun) return { attempted: 0, claimed: 0, skipped: dryRun ? 'preview' : 'disabled' }
  const cards = page.locator(COUPON_CARDS)
  const seen = claimAttempts.get(page) ?? new Set()
  claimAttempts.set(page, seen)
  let attempted = 0
  let claimed = 0
  for (let index = 0; index < await cards.count() && attempted < limit; index++) {
    const card = cards.nth(index)
    if (!await card.isVisible()) continue
    const text = await card.innerText()
    if (UNAVAILABLE.test(text) || PAID_OFFER.test(text)) continue
    const key = `${page.url()}:${await card.getAttribute('data-coupon-id') ?? text}`
    if (seen.has(key)) continue
    const button = card.getByRole('button', { name: /^(立即领取|领取|领券)$/ }).first()
    if (!await button.count() || !await button.isEnabled()) continue
    seen.add(key)
    await button.click({ timeout: 5000 })
    attempted++
    const confirmed = card.getByText(/已领取|领取成功/).first()
    try { await confirmed.waitFor({ state: 'visible', timeout: 3000 }); claimed++ }
    catch (error) { if (error.name !== 'TimeoutError') throw error }
  }
  return { attempted, claimed, unconfirmed: attempted - claimed }
}

/** Choose the highest readable discount among enabled coupon options.
 * @param page - active checkout page.
 * @param options - enablement and preview flag.
 * @returns selection status; the caller must reread the actual payable amount.
 */
export async function useCoupon(page, { enabled, dryRun }) {
  if (!enabled || dryRun) return { selected: false, skipped: dryRun ? 'preview' : 'disabled' }
  const opener = page.getByRole('button', { name: /^(红包|优惠券|选择优惠券|红包\/优惠券)$/ }).first()
  if (await opener.count() && await opener.isVisible()) await opener.click({ timeout: 5000 })
  const cards = page.locator(COUPON_CARDS)
  const eligible = []
  for (let index = 0; index < await cards.count(); index++) {
    const card = cards.nth(index)
    if (!await card.isVisible()) continue
    const text = await card.innerText()
    if (UNAVAILABLE.test(text) || PAID_OFFER.test(text)) continue
    const discount = couponDiscount(text)
    if (!Number.isFinite(discount) || discount <= 0) continue
    const radio = card.getByRole('radio').first()
    const button = card.getByRole('button', { name: /^(使用|立即使用|选择)$/ }).first()
    const control = await radio.count() ? radio : button
    if (!await control.count() || !await control.isEnabled()) continue
    eligible.push({ card, radio, control, discount })
  }
  eligible.sort((left, right) => right.discount - left.discount)
  const choice = eligible[0]
  if (!choice) return { selected: false, reason: 'no_visible_eligible_coupon' }
  if (await choice.radio.count()) await choice.radio.check({ timeout: 5000 })
  else await choice.control.click({ timeout: 5000 })
  const confirm = choice.card.locator('xpath=ancestor::*[@role="dialog"]')
    .getByRole('button', { name: /^(确定|完成)$/ }).first()
  if (await confirm.count() && await confirm.isVisible()) await confirm.click({ timeout: 5000 })
  await page.waitForLoadState('networkidle', { timeout: 10000 })
  return { selected: true, discount: choice.discount, finalAmountNeedsReadback: true }
}
