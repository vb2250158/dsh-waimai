/** Settings-only login RPC: phone numbers and SMS codes never pass through a model tool. */
import { z } from 'zod'
import { OrderCursor } from './account-data.js'
import { HemaOrderCursor, HemaProductCursor } from './hema-data.js'
import { ShopCursor } from './browse-data.js'

const platformId = z.string().regex(/^[a-z]+$/).default('taobao')
const accountRef = z.uuid().optional()
const addressRef = z.string().regex(/^[a-f0-9]{64}$/).optional()
const payloads = {
  platforms: z.object({}).strict(),
  status: z.object({ platformId, accountRef }).strict(),
  sendCode: z.object({ platformId, accountRef, loginMethod: z.enum(['sms', 'taobao-sms']).optional(), phone: z.string().regex(/^1[3-9]\d{9}$/) }).strict(),
  complete: z.object({ platformId, accountRef, loginMethod: z.enum(['sms', 'taobao-sms']).optional(), smsAttemptId: z.uuid().optional(), code: z.string().regex(/^\d{4,8}$/) }).strict()
    .refine(value => value.platformId !== 'hema' || Boolean(value.smsAttemptId)),
  qrStart: z.object({ platformId, accountRef, loginMethod: z.enum(['taobao-qr', 'hema-qr']).optional() }).strict(),
  qrPoll: z.object({ platformId, accountRef, attemptId: z.uuid() }).strict(),
  qrCancel: z.object({ platformId, accountRef, attemptId: z.uuid() }).strict(),
  profile: z.object({ platformId, accountRef }).strict(),
  orders: z.object({ platformId, accountRef, cursor: z.union([OrderCursor, HemaOrderCursor]).optional() }).strict(),
  addresses: z.object({ platformId, accountRef }).strict(),
  selectAddress: z.object({ platformId, accountRef, accountId: z.string().regex(/^[1-9]\d*$/), addressRef: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  recentShops: z.object({ platformId, accountRef, addressRef }).strict(),
  nearbyShops: z.object({ platformId, accountRef, addressRef, cursor: ShopCursor.optional() }).strict(),
  probeMenu: z.object({ platformId, accountRef, addressRef, shopId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/), keyword: z.string().max(100).optional(), cursor: HemaProductCursor.optional() }).strict(),
  productDetail: z.object({ platformId: z.literal('hema'), accountRef, addressRef, productRef: z.uuid() }).strict(),
  cartAdd: z.object({ platformId: z.literal('hema'), accountRef: z.uuid(), addressRef: z.string().regex(/^[a-f0-9]{64}$/),
    productRef: z.uuid(), skuId: z.string().regex(/^[1-9]\d*$/), quantity: z.number().int().min(1).max(100),
    revision: z.string().regex(/^[a-f0-9]{64}$/), operationRef: z.uuid() }).strict(),
  itemOptions: z.object({ platformId: z.literal('taobao'), accountRef: z.uuid(), addressRef: z.string().regex(/^[a-f0-9]{64}$/),
    shopId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/), itemId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/) }).strict(),
  cart: z.union([z.object({ platformId: z.literal('hema'), accountRef, addressRef }).strict(),
    z.object({ platformId: z.literal('taobao'), accountRef: z.uuid(), addressRef: z.string().regex(/^[a-f0-9]{64}$/), shopId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/) }).strict()]),
  cartChange: z.object({ platformId: z.literal('taobao'), accountRef: z.uuid(), addressRef: z.string().regex(/^[a-f0-9]{64}$/),
    shopId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/), revision: z.string().regex(/^[a-f0-9]{64}$/), operationRef: z.uuid(),
    step: z.union([z.literal(1), z.literal(-1)]), itemId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/).optional(), lineRef: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    selectionRef: z.uuid().optional(), variantRef: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    choiceRefs: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(30).optional(), quantity: z.number().int().min(1).max(100).optional() }).strict()
      .refine(value => value.step === 1 ? Boolean(value.itemId) && !value.lineRef : Boolean(value.lineRef) && !value.itemId)
        .refine(value => value.selectionRef ? value.step === 1 && Boolean(value.variantRef) && Array.isArray(value.choiceRefs) && Boolean(value.quantity)
        : !value.variantRef && !value.choiceRefs && !value.quantity),
  checkout: z.union([z.object({ platformId: z.literal('taobao'), accountRef: z.uuid(), addressRef: z.string().regex(/^[a-f0-9]{64}$/),
    shopId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    z.object({ platformId: z.literal('hema'), accountRef: z.uuid(), addressRef: z.string().regex(/^[a-f0-9]{64}$/),
      shopId: z.string().regex(/^[1-9]\d*$/).optional(), revision: z.string().regex(/^[a-f0-9]{64}$/), lineIds: z.array(z.string().regex(/^[1-9]\d*$/)).min(1).max(50) }).strict()]),
  selectDelivery: z.object({ platformId: z.literal('hema'), accountRef: z.uuid(), quoteRef: z.uuid(), deliveryRef: z.uuid() }).strict(),
  submit: z.object({ platformId: z.enum(['taobao', 'hema']), accountRef: z.uuid(), quoteRef: z.uuid(), confirmed: z.literal(true), confirmedCents: z.number().int().positive().safe(),
    manualConfirmation: z.literal(true).optional(), maxAmountCents: z.number().int().positive().safe().optional(), retryOf: z.uuid().optional(), previousOrderAbsent: z.literal(true).optional() }).strict()
    .refine(value => !value.retryOf && !value.previousOrderAbsent || value.manualConfirmation === true && Boolean(value.retryOf) && value.previousOrderAbsent === true),
  tradeHistory: z.object({ platformId: z.enum(['taobao', 'hema']), accountRef: z.uuid() }).strict(),
  paymentStatus: z.object({ platformId: z.literal('taobao'), accountRef: z.uuid(), orderRef: z.uuid() }).strict(),
  paymentProviderReceipt: z.object({ platformId: z.literal('taobao'), accountRef: z.uuid(), orderRef: z.uuid() }).strict(),
  accountsList: z.object({ platformId, accountRef }).strict(),
  accountBegin: z.object({ platformId, accountRef }).strict(),
  accountCancel: z.object({ platformId, accountRef }).strict(),
  accountView: z.object({ platformId, accountRef: z.uuid() }).strict(),
  useTaobao: z.object({ platformId: z.literal('hema'), accountRef, sourceAccountRef: z.uuid() }).strict(),
}
const toolNames = { platforms: 'platform_list', status: 'login_status', sendCode: 'login_send_code', complete: 'login_complete', qrStart: 'login_qr_start', qrPoll: 'login_qr_poll', qrCancel: 'login_qr_cancel', profile: 'account_profile', orders: 'account_orders', addresses: 'account_addresses', selectAddress: 'account_select_address', recentShops: 'account_recent_shops', probeMenu: 'account_probe_menu' }
payloads.paymentConnection = z.object({}).strict()
Object.assign(toolNames, { accountsList: 'account_list', accountBegin: 'account_begin', accountCancel: 'account_cancel', accountView: 'account_view' })
toolNames.useTaobao = 'account_use_taobao'
toolNames.nearbyShops = 'account_nearby_shops'
toolNames.productDetail = 'account_product_detail'
toolNames.cart = 'account_cart'
toolNames.cartAdd = 'account_cart_add'
toolNames.cartChange = 'account_cart_change'
toolNames.itemOptions = 'account_item_options'
toolNames.checkout = 'account_checkout'

toolNames.selectDelivery = 'account_select_delivery'
toolNames.submit = 'account_submit'
toolNames.tradeHistory = 'account_trade_history'
toolNames.paymentStatus = 'account_payment_status'
toolNames.paymentProviderReceipt = 'account_payment_provider_receipt'
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
 * @param local - Host-owned payment configuration check, independent of MCP restarts.
 */
export function registerLoginRpc(ctx, bridge, local = {}) {
  ctx.inject(['connection', 'webServer'], scope => {
    const dispatch = async (endpoint, payload) => {
      const schema = Object.hasOwn(payloads, endpoint) ? payloads[endpoint] : undefined
      const parsed = schema?.safeParse(payload)
      if (!parsed?.success) return badRequest()
      try {
        if (endpoint === 'paymentConnection') return { ok: true, value: await local.paymentConnection() }
        const result = await bridge.call(toolNames[endpoint], parsed.data)
        if (result.success !== true) return { ok: false, error: { code: result.code || 'login-failed', message: result.error, details: {} } }
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
