/** Allowlisted login, cart and order diagnostics for the existing Host logger; never retain remote text or credentials. */
const returnCodes = new Set(['SUCCESS', 'FAIL_SYS_SESSION_EXPIRED', 'FAIL_SYS_SESSION_INVALID', 'FAIL_SYS_TOKEN_EMPTY',
  'FAIL_SYS_TOKEN_EXOIRED', 'FAIL_SYS_TOKEN_EXPIRED', 'FAIL_SYS_USER_VALIDATE', 'FAIL_SYS_ILLEGAL_ACCESS',
  'FAIL_SYS_ACCESS_DENIED', 'FAIL_SYS_SERVICE_FAULT', 'FAIL_SYS_PARAM_MISSING', 'FAIL_SYS_PARAM_FORMAT_ERROR',
  'FAIL_SYS_API_STOP_SERVICE', 'FAIL_SYS_API_NOT_FOUNDED', 'FAIL_BIZ_UNKNOWN_ERROR'])
const actions = new Set(['SUCCESS', 'OTHER', 'H5', 'LOGIN', 'FAIL', 'CHECKCODE', 'BIND', 'REGISTER'])
const fields = ['value', 'returnValue', 'userToken', 'localId', 'havanaId', 'errorCode', 'url', 'redirectUrl',
  'cookies', 'userId', 'loginServiceExt', 'qrCodeStatus', 'asyncUrls', 'miniVsts', 'conToken', 'smsRegToken']

/** @param raw - untrusted platform response. @returns fixed diagnostic fields with no remote strings. */
export function loginResponseDiagnostic(raw) {
  const data = raw?.content?.data ?? raw?.data
  let returned = data?.returnValue
  const returnType = typeof returned
  if (typeof returned === 'string' && returned.length < 300000) {
    try { returned = JSON.parse(returned) } catch (error) { returned = undefined }
  }
  const sessionData = returned?.data
  return {
    ret: Array.isArray(raw?.ret) ? raw.ret.slice(0, 8).map(value => {
      const code = typeof value === 'string' ? value.split('::', 1)[0] : undefined
      return returnCodes.has(code) || typeof code === 'string' && /^FAIL_(?:SYS|BIZ)_[A-Z_]{1,90}$/.test(code) ? code : 'unrecognized'
    }) : [],
    action: actions.has(data?.actionType) ? data.actionType : data?.actionType === undefined ? 'absent' : 'unrecognized',
    code: Number.isSafeInteger(data?.code) && Math.abs(data.code) < 1000000 ? data.code : null,
    codeType: typeof data?.code,
    qrStatus: ['NEW', 'SCANED', 'CONFIRMED', 'EXPIRED', 'CANCELED', 'ERROR'].includes(data?.qrCodeStatus) ? data.qrCodeStatus : null,
    fields: fields.filter(key => data && Object.hasOwn(data, key)),
    returnType,
    returnFields: fields.filter(key => returned && typeof returned === 'object' && Object.hasOwn(returned, key)),
    sessionFields: fields.filter(key => sessionData && typeof sessionData === 'object' && Object.hasOwn(sessionData, key)),
    cookieCount: Array.isArray(sessionData?.cookies) ? sessionData.cookies.length : null,
    site: returned?.site === 25 ? 25 : null,
    hasChallenge: Boolean(data?.conToken || data?.scene || data?.isCheckCodeShowed || data?.iframeRedirect),
    hasRegistration: Boolean(data?.smsRegToken),
  }
}

/** Export only the login and cart groups' already projected records to the Host stderr capture.
 * @param ctx - Host context; exporter registration follows its existing lifecycle.
 * @param write - console sink, replaceable by tests.
 * @returns exporter disposer.
 */
export function registerLoginDiagnosticOutput(ctx, write = line => console.error(line)) {
  return ctx.logger.exporter({ export(message) {
    const text = message.args[0]
    if (typeof text === 'string' && ['waimai-mcp: [waimai-login] ', 'waimai-mcp: [waimai-cart] ', 'waimai-mcp: [waimai-order] '].some(prefix => text.startsWith(prefix))) write(`${new Date(message.ts).toISOString()} ${text}`)
  } })
}
