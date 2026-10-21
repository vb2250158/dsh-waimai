/**
 * Integration test for the takeaway MCP server.
 *
 * Starts the real server over stdio and inspects its advertised tools. This
 * checks process startup, tool registration and account-scoped payment inputs.
 * Payment requests identify existing local orders and never accept a charge amount.
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
  'account_nearby_shops',
  'account_probe_menu',
  'account_product_detail',
  'account_cart_add',
  'account_item_options',
  'account_cart',
  'account_cart_change',
  'account_checkout',
  'account_select_delivery',
  'account_submit',
  'account_trade_history',
  'account_list',
  'account_begin',
  'account_cancel',
  'account_view',
  'account_use_taobao',
  'list_platforms',
  'list_connections',
  'get_status',
  'prepare_ordering',
  'search_shops',
  'search_products',
  'get_menu',
  'get_product_details',
  'preview_checkout',
  'get_cart',
  'add_product_to_cart',
  'get_item_options',
  'change_cart',
  'show_order',
  'submit_order',
  'get_order_status',
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
    const add = tools.find(tool => tool.name === 'add_product_to_cart')
    assert.deepEqual(add.inputSchema.required, ['platformId', 'accountRef', 'productRef', 'skuId', 'quantity', 'revision', 'operationRef'])
    const cart = tools.find(tool => tool.name === 'get_cart')
    assert.deepEqual(cart.inputSchema.properties.platformId.enum, ['taobao', 'hema'])
    const delivery = tools.find(tool => tool.name === 'account_select_delivery')
    assert.equal(delivery.inputSchema.properties.platformId.const, 'hema')
    assert.deepEqual(delivery.inputSchema.required, ['platformId', 'accountRef', 'quoteRef', 'deliveryRef'])
  } finally {
    await close()
  }
})

test('merchant browsing keeps the configured default platform while product queries remain explicitly Taobao scoped', async () => {
  const { client, close } = await connect({ DEFAULT_PLATFORM: 'hema' })
  try {
    const { tools } = await client.listTools()
    assert.equal(tools.find(tool => tool.name === 'search_shops').inputSchema.properties.platformId.default, 'hema')
    assert.equal(tools.find(tool => tool.name === 'search_products').inputSchema.properties.platformId.const, 'taobao')
  } finally { await close() }
})

test('request_payment accepts only account and order references, without caller-selected payment amount', async () => {
  const { client, close } = await connect({ PAYMENT_MODE: 'auto', MAX_ORDER_AMOUNT: '35' })
  try {
    const { tools } = await client.listTools()
    const payment = tools.find(tool => tool.name === 'request_payment')
    assert.ok(payment !== undefined)
    const properties = payment.inputSchema?.properties ?? {}
    assert.deepEqual(Object.keys(properties), ['platformId', 'accountRef', 'orderRef'],
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
    assert.deepEqual(Object.keys(submit.inputSchema.properties ?? {}), ['platformId', 'accountRef', 'shopId', 'lineIds', 'maxAmount'])
    assert.deepEqual(submit.inputSchema.required, ['accountRef', 'maxAmount'])
  } finally {
    await close()
  }
})

test('preview status exposes interactive ordering without automatic payment', async () => {
  const { client, close } = await connect({ DRY_RUN: 'true', PAYMENT_MODE: 'auto' })
  try {
    const value = JSON.parse((await client.callTool({ name: 'get_status', arguments: {} })).content[0].text)
    assert.equal(value.data.dryRun, true); assert.equal(value.data.orderingAvailable, true)
    assert.equal(value.data.automaticPaymentAvailable, false); assert.equal(value.data.paymentMode, 'official-cashier')
    const { tools } = await client.listTools()
    const submit = tools.find(tool => tool.name === 'submit_order')
    assert.match(submit.description, /不创建订单或扣款/)
    assert(!('confirmed' in submit.inputSchema.properties))
  } finally { await close() }
})

test('unavailable platforms cannot use private account actions', async () => {
  const { client, close } = await connect({ DRY_RUN: 'false' })
  try {
    for (const platformId of ['meituan', 'jd', 'unknown']) {
      const value = JSON.parse((await client.callTool({ name: 'account_profile', arguments: { platformId } })).content[0].text)
      assert.equal(value.code, platformId === 'unknown' ? 'unknown-platform' : 'not-integrated')
    }
  } finally { await close() }
})
