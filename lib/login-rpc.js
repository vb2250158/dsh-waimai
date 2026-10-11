/** Settings-only login RPC: phone numbers and SMS codes never pass through a model tool. */
import { z } from 'zod'

const payloads = {
  status: z.object({}).strict(),
  sendCode: z.object({ phone: z.string().regex(/^1[3-9]\d{9}$/) }).strict(),
  complete: z.object({ code: z.string().regex(/^\d{4,8}$/) }).strict(),
}
const toolNames = { status: 'login_status', sendCode: 'login_send_code', complete: 'login_complete' }
const envelope = z.object({ type: z.literal('client-request'), rpcId: z.string(), method: z.string(), payload: z.unknown() }).strict()
// Phone/code envelopes are small; reject unexpected bodies before retaining them.
const MAX_BODY_BYTES = 4096

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const badRequest = () => ({ ok: false, error: { code: 'bad-request', message: '登录请求参数无效', details: {} } })

/**
 * Register a Host HTTP channel using Connection's authentication and RPC envelope.
 * @param ctx - owning Host context.
 * @param bridge - private MCP caller.
 */
export function registerLoginRpc(ctx, bridge) {
  ctx.inject(['connection', 'webServer'], scope => {
    const dispatch = async (endpoint, payload) => {
      const schema = Object.hasOwn(payloads, endpoint) ? payloads[endpoint] : undefined
      const parsed = schema?.safeParse(payload)
      if (!parsed?.success) return badRequest()
      try {
        const result = await bridge.call(toolNames[endpoint], parsed.data)
        if (result.success !== true) return { ok: false, error: { code: 'login-failed', message: result.error, details: {} } }
        return { ok: true, value: result.data }
      } catch {
        return { ok: false, error: { code: 'login-unavailable', message: '登录服务不可用或请求结果未确认，请检查插件状态', details: {} } }
      }
    }
    scope.effect(() => scope.webServer.register({
      kind: 'prefix', path: '/waimai-login',
      async handler(request, response) {
        const rejection = scope.connection.requestRejection(request)
        if (rejection !== undefined) {
          response.writeHead(rejection)
          response.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        if (request.method !== 'POST') { response.writeHead(405); response.end(); return }
        const endpoint = new URL(request.url, 'http://localhost').pathname.slice('/waimai-login/'.length)
        if (!Object.hasOwn(payloads, endpoint)) { response.writeHead(404); response.end(); return }
        if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          response.writeHead(415); response.end(); return
        }
        let rpcId = '', result
        try {
          const parsed = envelope.safeParse(await readBody(request))
          if (parsed.success) rpcId = parsed.data.rpcId
          result = parsed.success && parsed.data.method === endpoint
            ? await dispatch(endpoint, parsed.data.payload) : badRequest()
        } catch {
          // Invalid, oversized or interrupted bodies must not reach the private login client.
          result = badRequest()
        }
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ type: 'server-response', rpcId, result }))
      },
    }), 'waimai: authenticated login RPC')
  })
}
