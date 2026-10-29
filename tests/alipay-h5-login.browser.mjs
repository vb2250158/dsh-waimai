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
