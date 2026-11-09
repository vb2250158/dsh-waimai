import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { startService } from '../lib/mcp-service.js'
import { serviceTransport } from '../lib/service-connection.js'
import { WaimaiMcpBridge } from '../lib/mcp-bridge.js'
import { acquireStateOwner } from '../lib/state-owner.js'

test('one standalone owner serves public clients and the private DSH adapter without leaking private tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'waimai-service-'))
  const tokenFile = join(root, 'public-token'), hostTokenFile = join(root, 'host-token')
  const token = randomBytes(32).toString('base64url'), hostToken = randomBytes(32).toString('base64url')
  await writeFile(tokenFile, token); await writeFile(hostTokenFile, hostToken)
  const service = await startService({ port: 0, tokenFile, hostTokenFile, directory: join(root, 'data'), env: { DRY_RUN: 'true' } })
  const client = new Client({ name: 'external-agent', version: '1' })
  const registered = new Map()
  const bridge = new WaimaiMcpBridge({ ctx: { tools: { register(tool) {
    registered.set(tool.name, tool); return () => registered.delete(tool.name)
  } } }, logger: { info() {}, warn(message) { throw new Error(message) } } })
  try {
    await client.connect(await serviceTransport(service.url, tokenFile))
    const names = (await client.listTools()).tools.map(tool => tool.name)
    assert.ok(names.includes('get_status'))
    assert.ok(names.includes('get_payment_setup'))
    const setup = JSON.parse((await client.callTool({ name: 'get_payment_setup', arguments: {} })).content[0].text)
    assert.equal(setup.ready, false)
    const blocked = await client.callTool({ name: 'confirm_order', arguments: { confirmedCents: 4089 } })
    assert.equal(blocked.isError, true)
    assert.match(blocked.content[0].text, /未执行下单或付款/)
    assert.equal((await client.callTool({ name: 'pay_order', arguments: { confirmedCents: 4089 } })).isError, true)
    assert.ok(names.includes('pay_order'))
    for (const name of ['prepare_h5_payment', 'get_h5_payment_status', 'continue_h5_payment']) assert.ok(names.includes(name))
    assert.ok(!names.some(name => name.startsWith('account_') || name.startsWith('login_')))
    assert.equal((await client.callTool({ name: 'account_list', arguments: {} })).isError, true)
    const result = await client.callTool({ name: 'get_status', arguments: {} })
    assert.equal(JSON.parse(result.content[0].text).data.dryRun, true)
    await bridge.start({ WAIMAI_SERVICE_URL: service.url.replace('/mcp', '/host'), WAIMAI_SERVICE_TOKEN_FILE: hostTokenFile })
    assert.equal(bridge.connected, true)
    assert.ok(registered.has('mcp__waimai__get_status'))
    assert.ok(!registered.has('mcp__waimai__account_list'))
    assert.equal((await bridge.call('platform_list', {})).success, true)
    await bridge.stop()
    assert.ok((await client.listTools()).tools.length > 0)
    for (const [url, headers, expected] of [
      [service.url, {}, 401],
      [service.url.replace('/mcp', '/host'), { Authorization: `Bearer ${token}` }, 401],
      [service.url, { Authorization: `Bearer ${hostToken}` }, 401],
      [service.url, { Authorization: `Bearer ${token}`, Origin: 'https://untrusted.example' }, 403],
    ]) assert.equal((await fetch(url, { method: 'POST', headers })).status, expected)
    const hostileHost = await new Promise((resolve, reject) => {
      const req = request(service.url, { method: 'POST', headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject); req.end()
    })
    assert.equal(hostileHost, 403)
    const page = service.url.replace('/mcp', '/')
    const html = await fetch(page)
    assert.equal(html.status, 200)
    assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.match(await html.text(), /app\.js/)
    const rpcUrl = new URL('rpc', page)
    const body = JSON.stringify({ rpcId: 'test', method: 'serviceStatus', payload: {} })
    const headers = { Origin: new URL(page).origin, 'content-type': 'application/json' }
    assert.equal((await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 403)
    const uiStatus = await (await fetch(rpcUrl, { method: 'POST', headers, body })).json()
    assert.equal(uiStatus.result.value.maxOrderAmount, JSON.parse(result.content[0].text).data.maxOrderAmount)
    const h5Setup = await (await fetch(rpcUrl, { method: 'POST', headers, body: JSON.stringify({ rpcId: 'h5-setup', method: 'paymentSetup', payload: { operation: 'save', provider: 'alipay-h5', maxAmountCents: 3000 } }) })).json()
    assert.equal(h5Setup.result.value.provider, 'alipay-h5')
    const h5Status = JSON.parse((await client.callTool({ name: 'get_payment_setup', arguments: {} })).content[0].text)
    assert.equal(h5Status.state, 'h5-configured')
    assert.equal(h5Status.maxAmountCents, 3000)
    assert.equal(h5Status.ready, false); assert.equal(h5Status.policyReady, true)
    const unprepared = await client.callTool({ name: 'confirm_order', arguments: { confirmedCents: 2000 } })
    assert.equal(unprepared.isError, true)
    assert.equal(JSON.parse(unprepared.content[0].text).code, 'payment-account-required')
    const overCap = await client.callTool({ name: 'continue_h5_payment', arguments: { confirmedCents: 3001 } })
    assert.equal(overCap.isError, true)
    assert.equal((await fetch(rpcUrl, { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' }, body })).status, 403)
    const invalid = await (await fetch(rpcUrl, { method: 'POST', headers,
      body: JSON.stringify({ rpcId: 'invalid', method: 'paymentPay', payload: { unexpected: true } }) })).json()
    assert.equal(invalid.result.ok, false)
    assert.equal(invalid.result.error.code, 'bad-request')
    assert.equal((await fetch(rpcUrl, { method: 'POST', headers,
      body: JSON.stringify({ rpcId: 'extra', method: 'serviceStatus', payload: {}, extra: true }) })).status, 400)
    assert.ok((await client.listTools()).tools.length > 0)
    await assert.rejects(acquireStateOwner(join(root, 'data')), { code: 'EEXIST' })
    await assert.rejects(serviceTransport('https://example.com/host', hostTokenFile))
  } finally {
    await bridge.stop(); await client.close(); await service.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('state ownership cannot be stolen and can be acquired after explicit release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'waimai-owner-'))
  try {
    const release = await acquireStateOwner(root)
    await assert.rejects(acquireStateOwner(root), { code: 'EEXIST' })
    await release(); await release()
    await (await acquireStateOwner(root))()
  } finally { await rm(root, { recursive: true, force: true }) }
})
