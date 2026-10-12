/** Exchange confirmed Taobao credentials for a separately verified takeaway session. */
import { z } from 'zod'
import { parse } from 'set-cookie-parser'
import { LoginError } from './login.js'

const identifier = z.union([z.string().regex(/^[1-9]\d{0,31}$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String)
const session = z.object({ site: z.literal(25), data: z.object({ userId: identifier,
  loginServiceExt: z.object({ localId: identifier }), cookies: z.array(z.string().min(1).max(8192)).min(1).max(32) }) })

/** Validate the successful UCC response without exposing its credentials.
 * @param raw - official OAuth response.
 * @returns business identifiers and HTTPS cookies, or null for unconfirmed authorization.
 */
export function uccSession(raw) {
  if (!Array.isArray(raw?.ret) || !raw.ret.some(value => typeof value === 'string' && value.startsWith('SUCCESS::'))
    || raw.data?.actionType !== 'OTHER' || raw.data?.code !== 3000) return null
  try {
    const result = session.parse(typeof raw.data.returnValue === 'string' ? JSON.parse(raw.data.returnValue) : raw.data.returnValue)
    const cookies = [], seen = new Set(), now = Date.now() / 1000
    const parsed = parse(result.data.cookies, { decodeValues: false, silent: true })
    if (parsed.length !== result.data.cookies.length) throw new Error('missing cookie')
    for (const cookie of parsed) {
      if (!['.ele.me', '.eleme.cn'].includes(cookie.domain) || cookie.path !== '/'
        || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookie.name) || typeof cookie.value !== 'string'
        || /[\r\n\0]/.test(cookie.value)) throw new Error('invalid cookie')
      if (cookie.domain === '.eleme.cn') continue
      const key = cookie.name + ':' + cookie.domain + ':' + cookie.path
      if (seen.has(key)) throw new Error('duplicate cookie')
      seen.add(key)
      const expires = cookie.maxAge !== undefined ? now + cookie.maxAge : cookie.expires ? cookie.expires.getTime() / 1000 : -1
      if (!Number.isFinite(expires) || (expires !== -1 && expires <= now)) throw new Error('expired cookie')
      const sameSite = { strict: 'Strict', lax: 'Lax', none: 'None' }[String(cookie.sameSite || 'lax').toLowerCase()]
      if (!sameSite) throw new Error('invalid sameSite')
      cookies.push({ name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
        expires, secure: true, httpOnly: cookie.httpOnly === true, sameSite })
    }
    const accountId = result.data.loginServiceExt.localId
    if (!cookies.some(cookie => cookie.name === 'SID' && cookie.value)
      || cookies.find(cookie => cookie.name === 'USERID')?.value !== accountId) throw new Error('identity missing')
    return { accountId, havanaId: result.data.userId, cookies }
  } catch { throw new LoginError('闪购授权响应无法确认，原账号仍保留，请更新插件或重新扫码') }
}

/** Use the official existing-account OAuth exchange; interactive responses are not followed.
 * @param login - isolated confirmed Taobao HTTP jar.
 * @returns validated business session or null when authorization requires further action.
 */
export async function exchangeTaobaoSession(login) {
  const protocol = login.protocol.ucc
  const raw = await login.mtop(protocol.token, {})
  if (!raw.ret.some(value => value.startsWith('SUCCESS::')) || raw.data?.actionType !== 'SUCCESS' || raw.data?.code !== 1) {
    if (raw.ret.some(value => /^FAIL_SYS_SESSION_(EXPIRED|INVALID)::/.test(value))) login.authorizationIssue = 'taobao-session-unconfirmed'
    else if (raw.data?.actionType === 'H5' || raw.ret.some(value => value.startsWith('FAIL_SYS_USER_VALIDATE::'))) login.authorizationIssue = 'verification-required'
    return null
  }
  const userToken = raw.data.returnValue?.userToken
  if (typeof userToken !== 'string' || !userToken.length || userToken.length > 8192) throw new LoginError('淘宝授权令牌无法确认，请重新扫码')
  const exchanged = await login.mtop(protocol.login, { authorizationRequest: JSON.stringify({ appName: protocol.login.appKey,
    localSite: 'taobao', targetSite: 'eleme', userToken, scene: protocol.scene, ext: {} }), riskControlInfo: '{}' })
  if (exchanged.data?.actionType === 'H5' || exchanged.ret.some(value => value.startsWith('FAIL_SYS_USER_VALIDATE::'))) login.authorizationIssue = 'verification-required'
  return uccSession(exchanged)
}
