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
  'login_qr_start',
  'login_qr_poll',
  'login_qr_cancel',
  'account_profile',
  'account_orders',
  'platform_list',
  'account_addresses',
  'account_select_address',
  'account_recent_shops',
  'account_probe_menu',
  'list_platforms',
  'get_status',
  'prepare_ordering',
  'search_shops',
  'get_menu',
  'preview_checkout',
  'submit_order',
  'request_payment',
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

test('HTTP tools require a stable merchant and expose platform selection', async () => {
  const { client, close } = await connect()
  try {
    const { tools } = await client.listTools()
    const menu = tools.find(tool => tool.name === 'get_menu')
    assert.deepEqual(menu.inputSchema.required, ['shopId'])

    const submit = tools.find(tool => tool.name === 'submit_order')
    assert.deepEqual(Object.keys(submit.inputSchema.properties ?? {}), ['platformId', 'quoteId', 'maxAmount'])
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
    assert.equal(value.data.transport, 'http')
    assert.equal(value.data.dryRun, true)
    assert.equal(value.data.capabilities.createOrder, false)
  } finally { await close() }
})

test('unverified purchasing and unavailable platforms stop even with preview disabled', async () => {
  const { client, close } = await connect({ DRY_RUN: 'false' })
  try {
    for (const name of ['preview_checkout', 'submit_order', 'request_payment']) {
      const value = JSON.parse((await client.callTool({ name, arguments: {} })).content[0].text)
      assert.equal(value.success, false)
      assert.equal(value.code, 'ordering-unverified')
    }
    for (const platformId of ['meituan', 'jd', 'unknown']) {
      const value = JSON.parse((await client.callTool({ name: 'account_profile', arguments: { platformId } })).content[0].text)
      assert.equal(value.code, platformId === 'unknown' ? 'unknown-platform' : 'not-integrated')
    }
  } finally { await close() }
})
