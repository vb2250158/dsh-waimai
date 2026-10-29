/** Private H5 inputs shared by authenticated Host RPC and hidden MCP methods. */
import { z } from 'zod'

const orderFields = { platformId: z.literal('taobao'), accountRef: z.uuid(), orderRef: z.uuid(),
  confirmed: z.literal(true), confirmedCents: z.number().int().positive().safe(), maxAmountCents: z.number().int().positive().safe() }
const cookie = z.object({ name: z.string().min(1).max(256).regex(/^[^\s;=\r\n]+$/),
  value: z.string().max(16000).regex(/^[^\r\n;]*$/), domain: z.enum(['maliprod.alipay.com', '.maliprod.alipay.com', '.alipay.com', 'alipay.com']),
  path: z.string().startsWith('/').max(2000), expires: z.number().finite().min(-1),
  httpOnly: z.boolean(), secure: z.boolean(), sameSite: z.enum(['Strict', 'Lax', 'None']) }).strict()

/** Private browser-session import; no URL, action, order identity or success flag is accepted from the client. */
export const h5StartFields = { ...orderFields, verificationOnly: z.literal(true).optional(), cookies: z.array(cookie).max(80),
  environment: z.object({ device: z.object({ userAgent: z.string().min(1).max(1000),
    screenWidth: z.number().int().positive().max(100000).optional(), screenHeight: z.number().int().positive().max(100000).optional(),
    hardwareConcurrency: z.number().int().positive().max(4096).optional() }).strict(),
    ua: z.string().max(32000).optional(), clientId: z.string().max(2000).optional(), referer: z.string().max(16000).optional() }).strict() }

/** One-time user verification fields never belong to model tools or ordinary settings. */
export const h5AuthenticationFields = { platformId: z.literal('taobao'), accountRef: z.uuid(), orderRef: z.uuid(),
  h5Ref: z.uuid(), operation: z.enum(['open', 'connect', 'cancel', 'inline', 'channel', 'phone', 'sms', 'resend', 'refresh']),
  channelRef: z.uuid().optional(),
  phone: z.string().regex(/^\d{11}$/).optional(), code: z.string().regex(/^(?:\d{4}|\d{6})$/).optional() }

/** Current cashier funding choices are private and expire with the H5 session. */
export const h5MethodsFields = { platformId: z.literal('taobao'), accountRef: z.uuid(), orderRef: z.uuid(),
  h5Ref: z.uuid(), operation: z.enum(['list', 'select']), methodRef: z.uuid().optional() }

/** Private payment fields; credentials are never persisted. */
export const h5SubmitFields = { ...orderFields, h5Ref: z.uuid(), password: z.string().min(1).max(100).optional(),
  envData: z.string().max(32000).optional() }
