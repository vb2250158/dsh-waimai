/** Explicit browser smoke with synthetic DOM and all network requests intercepted. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { H5InlineLogin } from '../lib/alipay-h5-login.js'

test('settings input drives one official-style phone action and one SMS on-fill action in a real browser', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  let form
  try {
    const context = await browser.newContext()
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh"><body></body></html>' }))
    const page = await context.newPage()
    await page.goto('https://maliprod.alipay.com/h5pay/unifiedLogin/index.html')
    form = new H5InlineLogin(page, 5000)
    let phoneActions = 0, smsActions = 0
    await page.exposeFunction('advanceLogin', async action => {
      assert(form.consumeRequest(action))
      if (action === 'unifiedLogin') {
        phoneActions++
        await page.evaluate(() => {
          document.body.innerHTML = '<div class="sms-verify"><input class="sms-verify__fakeInput" aria-hidden="true"><div class="passcode-input-wrap"><input autocomplete="one-time-code" inputmode="numeric"></div></div>'
          document.querySelector('[autocomplete="one-time-code"]').addEventListener('input', event => {
            if (event.target.value.length === 6) void window.advanceLogin('smsValidateLogin')
          })
        })
        const data = { controlType: 'need_loginsms_verify', bizData: {} }
        await form.presented(data); form.observe(data, action)
      } else {
        smsActions++
        await page.evaluate(() => history.pushState({}, '', '/h5pay/cashierPreConfirm/index.html'))
        const data = { controlType: 'cashier_pre_confirm', bizData: {} }
        await form.presented(data); form.observe(data, action)
      }
    })
    await page.evaluate(() => {
      document.body.innerHTML = '<input placeholder="请输入支付宝账号(手机号/邮箱)"><button data-aspm-click="c106426.d220737">下一步</button>'
      document.querySelector('button').addEventListener('click', () => { void window.advanceLogin('unifiedLogin') })
    })
    form.observe({ controlType: 'unified_login', bizData: {} }, 'cashierMain')
    assert.deepEqual(await form.submit({ operation: 'phone', phone: '13000000000' }), { kind: 'sms', codeLength: 6, canResend: false })
    assert.equal(await form.submit({ operation: 'sms', code: '000000' }), null)
    assert.equal(await page.locator('.sms-verify__fakeInput').inputValue(), '')
    assert.equal(phoneActions, 1); assert.equal(smsActions, 1)
  } finally { form?.close(); await browser.close() }
})

test('register-bind channels open the hidden phone panel without sending login or payment, including the default selection', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const context = await browser.newContext()
    let requests = 0
    await context.route('**/*', route => {
      requests++
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
    })
    const page = await context.newPage()
    await page.goto('https://maliprod.alipay.com/h5pay/unifiedLogin/index.html')
    for (const selected of [false, true]) {
      const form = new H5InlineLogin(page, 1000)
      const item = { value: 'test-balance', name: '测试余额' }
      const data = { controlType: 'unified_login', bizData: { h5RegisterBindPay: true,
        groups: [{ groupCode: 'balanceChannel' }, { groupCode: 'otherChannel' }],
        channelInfoMap: { balanceChannel: [item], otherChannel: [{ value: 'test-action', name: '禁止动作', action: '/cashierPay' }] } } }
      await page.evaluate(selected => {
        window.channelClicks = 0; window.footerClicks = 0
        document.body.innerHTML = `<div data-channel-exposure-value="test-balance"><div class="ChannelWrap ${selected ? 'ChannelWrap--selected' : ''}"><div data-aspm-click="c465028.d684156">测试余额</div></div></div><input placeholder="请输入手机号" hidden><button data-aspm-click="c465136.d684422">付款</button>`
        const open = () => { document.querySelector('input').hidden = false }
        document.querySelector('[data-aspm-click="c465028.d684156"]').onclick = () => { window.channelClicks++; if (!selected) open() }
        document.querySelector('button').onclick = () => { window.footerClicks++; open() }
      }, selected)
      await form.presented(data)
      form.observe(data, 'refresh')
      const input = await form.describe()
      assert.equal(input.kind, 'channel'); assert.equal(input.channels.length, 1)
      assert.equal(input.channels[0].label, '测试余额')
      assert(!JSON.stringify(input).includes('test-balance'))
      assert.equal(await page.getByPlaceholder('请输入手机号').isVisible(), false)
      assert.deepEqual(await form.submit({ operation: 'channel', channelRef: input.channels[0].channelRef }), { kind: 'phone' })
      assert.deepEqual(await page.evaluate(() => [window.channelClicks, window.footerClicks]), selected ? [0, 1] : [1, 0])
      for (const action of ['cashierPay', 'unifiedLogin', 'smsValidateLogin']) assert.equal(form.consumeRequest(action), false)
      assert.equal(requests, 1)
      form.close()
    }
    await page.evaluate(() => { document.querySelector('input').hidden = true })
    const form = new H5InlineLogin(page, 1000)
    const item = { value: 'test-balance', name: '测试余额' }
    const data = { controlType: 'unified_login', bizData: { h5RegisterBindPay: true, channelInfoMap: { balanceChannel: [item] } } }
    form.observe(data)
    const input = await form.describe()
    item.action = '/cashierPay'
    await assert.rejects(form.submit({ operation: 'channel', channelRef: input.channels[0].channelRef }), { code: 'h5-login-input-invalid' })
    delete item.action
    form.observe(data)
    await assert.rejects(form.submit({ operation: 'channel', channelRef: input.channels[0].channelRef }), { code: 'h5-login-input-invalid' })
    assert.deepEqual(await page.evaluate(() => [window.channelClicks, window.footerClicks]), [0, 1])
    assert.equal(requests, 1)
    form.close()
  } finally { await browser.close() }
})
