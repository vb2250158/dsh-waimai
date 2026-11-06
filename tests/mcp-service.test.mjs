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
    assert.ok(names.includes('pay_order'))
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
