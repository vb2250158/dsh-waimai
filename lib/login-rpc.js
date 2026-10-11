/** Settings-only login RPC: phone numbers and SMS codes never pass through a model tool. */
import { z } from 'zod'

const payloads = {
  status: z.object({}).strict(),
  sendCode: z.object({ phone: z.string().regex(/^1[3-9]\d{9}$/) }).strict(),
  complete: z.object({ code: z.string().regex(/^\d{4,8}$/) }).strict(),
}
const toolNames = { status: 'login_status', sendCode: 'login_send_code', complete: 'login_complete' }

/**
 * Register on Connection's authenticated channel, with strict payload validation.
 * @param ctx - owning Host context.
 * @param bridge - private MCP caller.
 */
export function registerLoginRpc(ctx, bridge) {
  ctx.inject(['connection'], scope => {
    scope.effect(() => scope.connection.rpc.handle('/waimai-login', async (endpoint, payload) => {
      const schema = Object.hasOwn(payloads, endpoint) ? payloads[endpoint] : undefined
      const parsed = schema?.safeParse(payload)
      if (!parsed?.success) return { ok: false, error: { code: 'bad-request', message: '登录请求参数无效', details: {} } }
      try {
        const result = await bridge.call(toolNames[endpoint], parsed.data)
        if (result.success !== true) return { ok: false, error: { code: 'login-failed', message: result.error, details: {} } }
        return { ok: true, value: result.data }
      } catch {
        return { ok: false, error: { code: 'login-unavailable', message: '登录服务不可用或请求结果未确认，请检查插件状态', details: {} } }
      }
    }), 'waimai: authenticated login RPC')
  })
}
