/** Payment method projections from the inspected H5 cashier; provider identifiers remain session-private. */
import { TradeError } from './trade-data.js'

const object = value => value && typeof value === 'object' && !Array.isArray(value)
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256

/** @param data - provider page or channel data. @returns whether it requires an unsupported confirmation or transition. */
export function h5MethodConfirmation(data) {
  const biz = data?.bizData || {}
  return Boolean(data?.bizError || data?.wnd || data?.h5HalfScreen || data?.needRedirect || data?.redirectUrl
    || biz.registering || biz.h5AutoRegisterQuser || biz.chargeMsg || biz.protocolName || biz.protocols?.length
    || biz.pwdValidateType === 'newCard' || biz.pwdValidateType === 'openService'
    || biz.h5FullDeductionOptimization || (object(biz.defaultAction) && Object.keys(biz.defaultAction).length))
}

/** @param raw - pureRequest response. @returns checked data without adopting navigation parameters or executing provider actions. */
export function h5MethodResponse(raw) {
  if (raw?.success !== true || !object(raw.data)) throw new TradeError('h5-method-unconfirmed', '付款方式请求结果未确认，请刷新收银台')
  if (raw.needRedirect || raw.redirectUrl || raw.wnd || h5MethodConfirmation(raw.data)) {
    throw new TradeError('h5-method-confirmation-required', '此付款方式需要额外确认，未发起付款')
  }
  return raw.data
}

function label(item) {
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120) return null
  const name = item.name.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\d{6,}/g, digits => '••••' + digits.slice(-4)).trim()
  if (!name) return null
  const tail = typeof item.tail === 'string' ? item.tail.match(/\d{4}$/)?.[0] : undefined
  return tail ? `${name}（尾号 ${tail}）` : name
}

/** @param data - current verified cashier page. @returns private selectable entries and their redacted labels; no action-bearing entries are selectable. */
export function h5MethodChoices(data) {
  const payments = data?.bizData?.channelInfo?.payments
  if (!Array.isArray(payments)) return []
  const candidates = []
  const add = (item, selectedChannel, childChannel) => {
    const text = label(item), combinationIndex = item.params?.combinationIndex
    if (!text || item.action || item.disable || !identifier(selectedChannel) || !identifier(combinationIndex)
      || h5MethodConfirmation({ bizData: item }) || h5MethodConfirmation({ bizData: item.params })) return
    candidates.push({ selectedChannel, childChannel, combinationIndex, label: text,
      selected: combinationIndex === data.bizData.combinationIndex })
  }
  for (const parent of payments) {
    if (!object(parent) || parent.action || parent.disable || h5MethodConfirmation({ bizData: parent })
      || h5MethodConfirmation({ bizData: parent.params })) continue
    if (Array.isArray(parent.children) && parent.children.length) {
      for (const child of parent.children) if (object(child) && identifier(child.childValue) && child.parentValue === parent.value) {
        add(child, parent.value, child.childValue)
      }
    } else add(parent, parent.value, '')
  }
  // Ambiguous provider identifiers must not select a different card with the same display name.
  return candidates.filter(item => candidates.filter(other => other.combinationIndex === item.combinationIndex
    || (other.selectedChannel === item.selectedChannel && other.childChannel === item.childChannel)).length === 1)
}
