/** Shared static management page and validated RPC transport. Authentication belongs to its host. */
import { readFile } from 'node:fs/promises'

const assets = new Map([
  ['', ['index.html', 'text/html; charset=utf-8']],
  ['app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['app.css', ['app.css', 'text/css; charset=utf-8']],
])

/** Serve only fixed public assets or the shared, schema-validated account RPC. */
export async function serveWeb(request, response, { basePath, dispatch }) {
  const path = new URL(request.url, 'http://localhost').pathname.slice(basePath.length)
  response.setHeader('cache-control', 'no-store')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
  if (request.method === 'GET' && assets.has(path)) {
    const [file, mime] = assets.get(path)
    const data = await readFile(new URL(`./web/${file}`, import.meta.url))
    response.writeHead(200, { 'content-type': mime }); response.end(data); return
  }
  if (request.method !== 'POST' || path !== 'rpc') { response.writeHead(404); response.end(); return }
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') { response.writeHead(415); response.end(); return }
  let body
  try { body = await readWebBody(request) }
  catch { response.writeHead(400); response.end(); return }
  if (!body || Array.isArray(body) || typeof body.method !== 'string' || typeof body.rpcId !== 'string' ||
      body.rpcId.length > 128 || Object.keys(body).some(key => !['method', 'rpcId', 'payload'].includes(key))) {
    response.writeHead(400); response.end(); return
  }
  const result = await dispatch(body.method, body.payload)
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ rpcId: body.rpcId, result }))
}

/** Bound private request bodies before parsing; never log their contents. */
export async function readWebBody(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 196608) throw new Error('Request too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
