/** Local authenticated MCP connection shared by the DSH adapter and operator clients. */
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/** Read a deployment-owned token without exposing its contents in errors. */
export async function readServiceToken(path) {
  if (!isAbsolute(path)) throw new Error('MCP token file must be an absolute path')
  const token = (await readFile(path, 'utf8')).trim()
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error('Invalid MCP token file')
  return token
}

/** Connect only to a literal loopback endpoint; never redirect credentials. */
export async function serviceTransport(url, tokenFile) {
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !['/mcp', '/host'].includes(endpoint.pathname)) throw new Error('MCP service requires a loopback /mcp or /host URL')
  const token = await readServiceToken(tokenFile)
  return new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' },
  })
}
