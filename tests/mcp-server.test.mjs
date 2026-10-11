/**
 * Integration test for the takeaway MCP server.
 *
 * Starts the real server over stdio and inspects its advertised tools. This
 * proves the process boots, the SDK wiring is correct, and — most importantly —
 * that `request_payment` exposes no parameters, which is the property that
 * stops a model from choosing the merchant or the amount.
 *
 * The test never launches a browser: `tools/list` is answered before any tool
 * call, so no window opens and no page is loaded.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const SERVER_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'mcp-server.js')

/** Tools the server must advertise, in the order the model sees them. */
const EXPECTED_TOOLS = [
  'login_status',
  'login_send_code',
  'login_complete',
  'account_profile',
  'account_orders',
  'get_status',
  'open_browser',
  'search_food',
  'enter_shop',
  'get_menu',
  'claim_coupons',
  'apply_coupons',
  'add_to_cart',
  'view_cart',
  'submit_order',
  'request_payment',
  'get_order_status',
]

/**
 * Connect to a freshly spawned server.
 *
 * @param env - environment overrides for the child process.
 * @returns the connected client and a disposer that shuts it down.
 */
async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: { ...process.env, ...env },
    stderr: 'ignore',
  })
  const client = new Client({ name: 'dsh-waimai-test', version: '0.0.0' })
  await client.connect(transport)
  return { client, close: async () => { await client.close() } }
}

test('the server advertises every takeaway tool', async () => {
  const { client, close } = await connect()
  try {
    const { tools } = await client.listTools()
    const names = tools.map(tool => tool.name)
    for (const expected of EXPECTED_TOOLS) {
      assert.ok(names.includes(expected), `missing tool ${expected}`)
    }
    assert.equal(names.length, EXPECTED_TOOLS.length)
  } finally {
    await close()
  }
})

test('request_payment exposes no parameters', async () => {
  const { client, close } = await connect({ PAYMENT_MODE: 'auto', MAX_ORDER_AMOUNT: '35' })
  try {
    const { tools } = await client.listTools()
    const payment = tools.find(tool => tool.name === 'request_payment')
    assert.ok(payment !== undefined)
    const properties = payment.inputSchema?.properties ?? {}
    assert.deepEqual(Object.keys(properties), [],
      'request_payment must not accept an amount or merchant from the caller')
  } finally {
    await close()
  }
})

test('search_food requires a keyword and submit_order takes only an optional cap', async () => {
  const { client, close } = await connect()
  try {
    const { tools } = await client.listTools()
    const search = tools.find(tool => tool.name === 'search_food')
    assert.deepEqual(search.inputSchema.required, ['keyword'])

    const submit = tools.find(tool => tool.name === 'submit_order')
    assert.deepEqual(Object.keys(submit.inputSchema.properties ?? {}), ['maxAmount'])
    assert.equal(submit.inputSchema.required, undefined)
  } finally {
    await close()
  }
})

test('preview mode blocks checkout and payment before launching a browser', async () => {
  const { client, close } = await connect({ DRY_RUN: 'true', PAYMENT_MODE: 'auto' })
  try {
    for (const name of ['submit_order', 'request_payment']) {
      const result = await client.callTool({ name, arguments: {} })
      const value = JSON.parse(result.content[0].text)
      assert.equal(value.success, false)
      assert.match(value.error, /预览模式/)
    }
    const result = await client.callTool({ name: 'get_status', arguments: {} })
    const value = JSON.parse(result.content[0].text)
    assert.equal(value.data.browserOpen, false)
    assert.equal(value.data.dryRun, true)
    for (const name of ['claim_coupons', 'apply_coupons']) {
      const coupon = JSON.parse((await client.callTool({ name, arguments: {} })).content[0].text)
      assert.equal(coupon.success, true)
      assert.equal(coupon.data.skipped, 'preview')
    }
    assert.equal(value.data.autoClaimCoupons, true)
    assert.equal(value.data.autoUseCoupons, true)
  } finally { await close() }
})
