/** One account owner shared by authenticated local MCP clients and the DSH UI. */
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

/** Start a loopback service. Both credentials and an isolated state directory are mandatory.
 * @param options - port, token files, absolute state directory and backend environment.
 * @returns listener address and an asynchronous shutdown operation.
 */
export async function startService({ port, tokenFile, hostTokenFile, directory, env = {} }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !isAbsolute(directory)) throw new Error('Invalid MCP service port or state directory')
  const token = await readServiceToken(tokenFile), hostToken = await readServiceToken(hostTokenFile)
  if (token === hostToken) throw new Error('Public and Host MCP tokens must differ')
  const backend = new Client({ name: 'waimai-service', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('./mcp-server.js', import.meta.url))],
    env: { ...process.env, ...env, WAIMAI_STATE_DIR: directory }, stderr: 'pipe' })
  // Provider diagnostics stay in the backend; never relay credentials or raw errors over HTTP.
  transport.stderr?.resume()
  try { await backend.connect(transport) }
  catch (error) { await transport.close(); throw error }
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
  let catalog
  try { catalog = (await backend.listTools()).tools } catch (error) { await backend.close(); throw error }
  const clients = new Set()
  let available = true
  backend.onclose = () => { available = false }
  const http = createServer((req, res) => { void handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500)
    res.end()
  }) })
  async function handle(req, res) {
    const authority = `127.0.0.1:${http.address().port}`
    if (req.headers.host !== authority || req.headers.origin !== undefined) { res.writeHead(403); res.end(); return }
    if (!['/mcp', '/host'].includes(req.url)) { res.writeHead(404); res.end(); return }
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
      if (size > 65536) { res.writeHead(413); res.end(); return }
      chunks.push(chunk)
    }
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { res.writeHead(400); res.end(); return }
    const tools = privateClient ? catalog : catalog.filter(tool => !LOGIN_TOOLS.includes(tool.name))
    const names = new Set(tools.map(tool => tool.name))
    const server = new Server({ name: 'waimai', version }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }))
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!names.has(request.params.name)) return { isError: true, content: [{ type: 'text', text: 'Tool unavailable' }] }
      try {
        return await backend.callTool({ name: request.params.name, arguments: request.params.arguments,
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
