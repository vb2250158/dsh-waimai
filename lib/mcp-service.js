import { PaymentReadinessError, requireH5OrderReadiness } from './payment-readiness.js'
/** One account owner shared by authenticated local MCP clients and the DSH UI. */
import { createInterface } from 'node:readline'
import { projectServiceDiagnostic } from './login-diagnostics.js'
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { isAbsolute } from 'node:path'
import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { LOGIN_TOOLS } from './login.js'
import { readServiceToken } from './service-connection.js'
import { createLoginDispatcher } from './login-rpc.js'
import { createWebHandler } from './web-auth.js'
import { StandaloneWallet } from './standalone-wallet.js'

/** Start a loopback service. Both credentials and an isolated state directory are mandatory.
 * @param options - port, token files, absolute state directory and backend environment.
 * @returns listener address and an asynchronous shutdown operation.
 */
export async function startService({ port, tokenFile, hostTokenFile, directory, env = {}, sessionSeconds = 28800, sessionLimit = 64 }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !isAbsolute(directory)) throw new Error('Invalid MCP service port or state directory')
  if (!Number.isInteger(sessionSeconds) || sessionSeconds < 60 || sessionSeconds > 86400 ||
      !Number.isInteger(sessionLimit) || sessionLimit < 1 || sessionLimit > 1024) throw new Error('Invalid browser session limits')
  const token = await readServiceToken(tokenFile), hostToken = await readServiceToken(hostTokenFile)
  if (token === hostToken) throw new Error('Public and Host MCP tokens must differ')
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
  const backend = new Client({ name: 'waimai-service', version })
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('./mcp-server.js', import.meta.url))],
    env: { ...process.env, ...env, WAIMAI_STATE_DIR: directory }, stderr: 'pipe' })
  // Only fixed diagnostic fields reach the private service log, never HTTP responses.
  if (transport.stderr) createInterface({ input: transport.stderr }).on('line', line => {
    const event = projectServiceDiagnostic(line)
    if (event) console.error('[waimai-diagnostic]', JSON.stringify(event))
  })
  try { await backend.connect(transport) }
  catch (error) { await transport.close(); throw error }
  let catalog
  try { catalog = (await backend.listTools()).tools } catch (error) { await backend.close(); throw error }
  const clients = new Set()
  let available = true
  backend.onclose = () => { available = false }
  const wallet = new StandaloneWallet({ directory, executable: env.ALIPAY_AGENT_EXECUTABLE || process.env.ALIPAY_AGENT_EXECUTABLE,
    capCents: Math.round(Number(env.MAX_ORDER_AMOUNT || process.env.MAX_ORDER_AMOUNT || 35) * 100) })
  const orderMethods = new Set(['account_submit', 'confirm_order', 'pay_order', 'account_payment_h5_pay', 'account_payment_h5_submit', 'prepare_h5_payment', 'continue_h5_payment', 'account_payment_h5_start'])
  const gate = async (name, args) => {
    if (!orderMethods.has(name)) return
    const setup = await wallet.requireReady(args?.confirmedCents)
    // Do not block verification or reconciliation of an existing order with new-order prerequisites.
    if (setup.provider === 'alipay-h5' && ['account_submit', 'confirm_order'].includes(name)) {
      await requireH5OrderReadiness(args, async (method, input) => {
        const result = await backend.callTool({ name: method, arguments: input }, undefined, { timeout: 30000 })
        return JSON.parse(result.content[0].text)
      })
    }
    return setup
  }
  const route = async (name, args, setup) => {
    if (name !== 'pay_order' || setup?.provider !== 'alipay-h5') return { name, arguments: args }
    const { paymentRef: _paymentRef, ...h5Args } = args
    const status = await backend.callTool({ name: 'get_h5_payment_status', arguments: { platformId: args.platformId, accountRef: args.accountRef, orderRef: args.orderRef } })
    const result = JSON.parse(status.content[0].text)
    if (result.success !== true) throw Error('H5 status unavailable')
    if (result.data.submitted || result.data.state === 'requires-reconciliation') return { name: 'get_payment_status', arguments: { platformId: args.platformId, accountRef: args.accountRef, orderRef: args.orderRef } }
    return { name: result.data.state === 'ready' && !result.data.verificationRequired ? 'continue_h5_payment' : 'prepare_h5_payment', arguments: h5Args }
  }
  const dispatch = createLoginDispatcher({ async call(name, args) {
    let setup
    try { setup = await gate(name, args) } catch (error) { if (error instanceof PaymentReadinessError) return { success: false, code: error.code, error: error.message }; return { success: false, code: 'payment-setup-required', error: '请先保存有效支付配置并核对额度；未执行下单或付款' } }
    const result = await backend.callTool(await route(name, args, setup), undefined, { timeout: 120000 })
    return JSON.parse(result.content[0].text)
  } }, { paymentSetup: args => wallet.configure(args) })
  const web = createWebHandler(dispatch)
  const http = createServer((req, res) => { void handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500)
    res.end()
  }) })
  async function handle(req, res) {
    const authority = `127.0.0.1:${http.address().port}`
    if (req.headers.host !== authority) { res.writeHead(403); res.end(); return }
    if (!['/mcp', '/host'].includes(req.url)) {
      if (!available) { res.writeHead(503); res.end(); return }
      await web(req, res, authority); return
    }
    if (req.headers.origin !== undefined) { res.writeHead(403); res.end(); return }
    const privateClient = req.url === '/host'
    const expected = Buffer.from(`Bearer ${privateClient ? hostToken : token}`)
    const actual = Buffer.from(req.headers.authorization || '')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.writeHead(401); res.end(); return }
    if (!available) { res.writeHead(503); res.end(); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 196608) { res.writeHead(413); res.end(); return }
      chunks.push(chunk)
    }
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { res.writeHead(400); res.end(); return }
    const tools = [...(privateClient ? catalog : catalog.filter(tool => !LOGIN_TOOLS.includes(tool.name))), { name: 'get_payment_setup', description: 'Read saved payment limit and current official wallet authorization before buying. Never creates orders or pays.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } }]
    const names = new Set(tools.map(tool => tool.name))
    const server = new Server({ name: 'waimai', version }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }))
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!names.has(request.params.name)) return { isError: true, content: [{ type: 'text', text: 'Tool unavailable' }] }
      if (request.params.name === 'get_payment_setup') {
        try { return { content: [{ type: 'text', text: JSON.stringify(await wallet.configure({ operation: 'status' })) }] } }
        catch { return { isError: true, content: [{ type: 'text', text: 'Payment authorization unavailable; do not buy.' }] } }
      }
      let setup
      try { setup = await gate(request.params.name, request.params.arguments) } catch (error) {
        if (error instanceof PaymentReadinessError) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: error.code, error: error.message }) }] }
        return { isError: true, content: [{ type: 'text', text: '请先保存有效支付配置并核对额度；未执行下单或付款' }] }
      }
      try {
        return await backend.callTool({ ...await route(request.params.name, request.params.arguments, setup),
          ...(privateClient && request.params._meta ? { _meta: request.params._meta } : {}) }, undefined, { timeout: 120000 })
      } catch {
        return { isError: true, content: [{ type: 'text', text: 'Service result unknown; query existing state, do not repeat purchases or payments.' }] }
      }
    })
    const connection = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    clients.add(server)
    res.once('close', () => { clients.delete(server); void server.close() })
    await server.connect(connection)
    await connection.handleRequest(req, res, body)
  }
  try { await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', resolve) }) }
  catch (error) { await backend.close(); throw error }
  return { url: `http://127.0.0.1:${http.address().port}/mcp`, async close() {
    available = false
    await new Promise(resolve => http.close(resolve))
    await Promise.all([...clients].map(client => client.close()))
    await backend.close()
  } }
}
