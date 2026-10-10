import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { couponDiscount, claimCoupons, useCoupon } from '../lib/coupons.js'
import { Config } from '../lib/index.js'
import { childEnv } from '../lib/env.js'

test('coupon checkboxes default on and explicit opt-outs reach the server', () => {
  const config = Config({}).get()
  assert.equal(config.autoClaimCoupons, true)
  assert.equal(config.autoUseCoupons, true)
  assert.equal(childEnv(config).COUPON_CLAIM_LIMIT, '10')
  const disabled = childEnv({ ...config, autoClaimCoupons: false, autoUseCoupons: false })
  assert.equal(disabled.AUTO_CLAIM_COUPONS, 'false')
  assert.equal(disabled.AUTO_USE_COUPONS, 'false')
  assert.equal(couponDiscount('满50减10'), 10)
  assert.equal(couponDiscount('无优惠'), undefined)
})

test('preview and unchecked options never touch the browser', async () => {
  assert.equal((await claimCoupons(null, { enabled: true, dryRun: true, limit: 10 })).skipped, 'preview')
  assert.equal((await useCoupon(null, { enabled: false, dryRun: false })).skipped, 'disabled')
})

const executablePath = process.env.PLAYWRIGHT_BROWSER_EXECUTABLE
  ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '')

test('visible free claims respect the limit and skip paid or expired offers', {
  skip: !executablePath || !existsSync(executablePath),
}, async () => {
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<div data-coupon-id="free">满20减3<button onclick="this.outerHTML='<span>已领取</span>'">立即领取</button></div>
      <div data-coupon-id="paid">购买会员券 减20<button onclick="document.body.dataset.wrong='yes'">领取</button></div>
      <div data-coupon-id="expired">已过期 减10<button onclick="document.body.dataset.wrong='yes'">领取</button></div>
      <div data-coupon-id="second">满30减5<button onclick="this.outerHTML='<span>已领取</span>'">领取</button></div>`)
    assert.deepEqual(await claimCoupons(page, { enabled: true, dryRun: false, limit: 1 }),
      { attempted: 1, claimed: 1, unconfirmed: 0 })
    assert.equal(await page.locator('body').getAttribute('data-wrong'), null)
    assert.equal(await page.locator('[data-coupon-id="second"] button').count(), 1)
    assert.deepEqual(await claimCoupons(page, { enabled: true, dryRun: false, limit: 10 }),
      { attempted: 1, claimed: 1, unconfirmed: 0 })
    await page.setContent('<div data-coupon-id="uncertain">满20减3<button onclick="document.body.dataset.clicks=Number(document.body.dataset.clicks||0)+1">领取</button></div>')
    assert.equal((await claimCoupons(page, { enabled: true, dryRun: false, limit: 10 })).unconfirmed, 1)
    assert.equal((await claimCoupons(page, { enabled: true, dryRun: false, limit: 10 })).attempted, 0)
    assert.equal(await page.locator('body').getAttribute('data-clicks'), '1')
  } finally { await browser.close() }
})

test('checkout selects the largest enabled discount and confirms the coupon dialog', {
  skip: !executablePath || !existsSync(executablePath),
}, async () => {
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<span class="pay-amount">¥40</span><button onclick="document.querySelector('[role=dialog]').hidden=false">优惠券</button>
      <div role="dialog" hidden>
      <div data-coupon-id="small">满20减3<input type="radio" name="coupon" value="3"></div>
      <div data-coupon-id="best">满30减8<input type="radio" name="coupon" value="8"></div>
      <div data-coupon-id="disabled">满50减20<input type="radio" name="coupon" disabled></div>
      <div data-coupon-id="expired">已过期 满30减30<input type="radio" name="coupon"></div>
      <button onclick="document.querySelector('.pay-amount').textContent='¥32'; this.parentElement.hidden=true">确定</button></div>`)
    const result = await useCoupon(page, { enabled: true, dryRun: false })
    assert.equal(result.discount, 8)
    assert.equal(result.finalAmountNeedsReadback, true)
    assert.equal(await page.locator('[data-coupon-id="best"] input').isChecked(), true)
    assert.equal(await page.locator('.pay-amount').innerText(), '¥32')
    await page.setContent('<p>暂无优惠券</p>')
    assert.equal((await useCoupon(page, { enabled: true, dryRun: false })).selected, false)
  } finally { await browser.close() }
})
