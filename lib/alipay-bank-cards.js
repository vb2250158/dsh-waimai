/** Read-only card discovery from the account-management page, independent of cashier orders. */
import { z } from 'zod'
import { TradeError } from './trade-data.js'

const bankCard = z.object({
  partnerId: z.string().regex(/^[A-Z0-9_]{2,20}$/),
  providerName: z.string().trim().min(1).max(100).regex(/^[^<>\u0000-\u001f\u007f]+$/),
  providerUserName: z.string().regex(/^\d{4}$/),
  cardType: z.enum(['DC', 'CC']),
  signId: z.string().min(1).max(256),
  logoMini: z.unknown().optional(),
})
const envelope = z.object({ stat: z.literal('ok'), results: z.array(bankCard).max(100) })

/** @param raw - official response. @returns private card identities and minimal display fields, never full card numbers. */
export function parseAlipayBankCards(raw) {
  const parsed = envelope.safeParse(raw)
  if (!parsed.success) throw new TradeError('alipay-cards-unconfirmed', '银行卡列表无法确认，请重新检查支付宝登录状态')
  const seen = new Set()
  return parsed.data.results.map(card => {
    const key = card.partnerId + ':' + card.signId
    if (seen.has(key)) throw new TradeError('alipay-cards-unconfirmed', '银行卡记录重复，未更新付款方式')
    seen.add(key)
    return { bankCode: card.partnerId, bankName: card.providerName, lastFour: card.providerUserName,
      cardType: card.cardType, bindingId: card.signId,
      ...(typeof card.logoMini === 'string' ? { logoUrl: card.logoMini } : {}) }
  })
}

/** @param http - account-owned authenticated HTTP context. @param options - bounded request settings. @returns verified binding records; discovery does not prove payment availability. */
export async function readAlipayBankCards(http, { timeoutMs = 10000, now = Date.now } = {}) {
  let response
  try {
    response = await http.get('https://zht.alipay.com/asset/bindQuery.json', {
      maxRedirects: 0, timeout: timeoutMs,
      headers: { Referer: 'https://zht.alipay.com/asset/bankList.htm' },
      params: { _input_charset: 'utf-8', providerType: 'BANK', t: String(now()) },
    })
    const status = response.status()
    if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
      throw new TradeError('alipay-cards-verification-required', '请在支付宝官方窗口完成登录验证后重新读取银行卡')
    }
    if (status !== 200 || !/application\/(?:json|[^;]+\+json)/i.test(response.headers()['content-type'] || '')) {
      throw new TradeError('alipay-cards-unconfirmed', '银行卡查询未返回有效结果，请稍后重试')
    }
    const charset = /charset\s*=\s*["']?([a-z0-9-]+)/i.exec(response.headers()['content-type'] || '')?.[1]?.toLowerCase() || 'utf-8'
    if (!['utf-8', 'utf8', 'gb18030', 'gbk', 'gb2312'].includes(charset)) {
      throw new TradeError('alipay-cards-unconfirmed', '银行卡响应编码无法确认，请稍后重试')
    }
    const text = new TextDecoder(charset === 'utf8' ? 'utf-8' : charset, { fatal: true }).decode(await response.body())
    return parseAlipayBankCards(JSON.parse(text))
  } catch (error) {
    if (error instanceof TradeError) throw error
    throw new TradeError('alipay-cards-unavailable', '银行卡查询暂时失败，请稍后重试')
  } finally { if (response) await response.dispose() }
}
