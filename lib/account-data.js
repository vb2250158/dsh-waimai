/** Allowlisted account and order fields for the authenticated settings page. */
import { z } from 'zod'

const id = z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive()]).transform(String)
const text = z.string().max(512)

/** Server-provided position for the next order page; never accepts account IDs or arbitrary query parameters. */
export const OrderCursor = z.object({
  pageNum: z.number().int().min(0).max(1_000_000),
  fromTime: z.number().int().min(0).max(8_640_000_000_000_000),
  lastBillMonth: z.string().regex(/^[0-9-]{2,7}$/).optional(),
}).strict()

/** Convert the platform image hash using the path format from its Vue image client.
 * @param hash - avatar hash from the account API.
 * @returns HTTPS CDN URL, or null when no supported avatar exists.
 */
export function avatarUrl(hash) {
  if (typeof hash !== 'string' || !/^[a-f0-9]{32}(jpeg|jpg|png|gif|webp)$/.test(hash)) return null
  return 'https://cube.elemecdn.com' + hash.replace(/^(\w)(\w\w)(\w{29}(\w*))$/, '/$1/$2/$3.$4')
}

/** Return only displayable profile fields after matching the independently verified account.
 * @param raw - profile response.
 * @param accountId - ID from the business session API.
 * @returns nickname, account ID, masked phone and validated avatar URL.
 */
export function profileData(raw, accountId) {
  const user = z.object({ user_id: id, username: text, mobile: z.string().max(32).optional(), avatar: z.string().max(128).optional() }).parse(raw)
  if (user.user_id !== accountId) throw new Error('account mismatch')
  return { id: user.user_id, nickname: user.username,
    maskedPhone: /^1[3-9]\d{9}$/.test(user.mobile || '') ? user.mobile.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : null,
    avatarUrl: avatarUrl(user.avatar) }
}

/** Project one bounded page; address, tracking, payment and action fields never reach the page.
 * @param raw - queryOrderList result.
 * @param pageSize - configured page limit.
 * @param position - cursor used for this request.
 * @returns order summaries and the validated next position.
 */
export function orderPage(raw, pageSize, position) {
  const entry = z.object({
    orderId: z.string().min(1).max(128), storeName: text,
    orderCreateTime: z.number().int().min(0).max(8_640_000_000_000_000),
    orderAmount: z.string().max(16).regex(/^\d+(?:\.\d{1,2})?$/),
    orderStatusBar: z.object({ title: text }),
    orderItemList: z.array(z.object({ name: text, count: z.number().int().min(0).max(1_000_000) })).max(100),
  })
  const result = z.object({ accountBindWrong: z.literal(false).optional(), orderList: z.array(entry).max(pageSize), moreInfo: z.object({ hasMore: z.boolean(), moreInfoParams: z.object({
    pageNum: OrderCursor.shape.pageNum, fromTime: OrderCursor.shape.fromTime,
    lastBillMonth: OrderCursor.shape.lastBillMonth,
  }).optional() }) }).parse(raw)
  let nextCursor = null
  if (result.moreInfo.hasMore) {
    nextCursor = OrderCursor.parse(result.moreInfo.moreInfoParams)
    if (nextCursor.pageNum === position.pageNum && nextCursor.fromTime === position.fromTime
      && (nextCursor.lastBillMonth || '00') === (position.lastBillMonth || '00')) throw new Error('cursor did not advance')
  }
  const ids = new Set()
  const orders = result.orderList.map(order => {
    if (ids.has(order.orderId)) throw new Error('duplicate order ID')
    ids.add(order.orderId)
    return { id: order.orderId, merchantName: order.storeName, createdAt: order.orderCreateTime,
      amount: order.orderAmount, status: order.orderStatusBar.title,
      items: order.orderItemList.map(item => ({ name: item.name, count: item.count })) }
  })
  return { orders, nextCursor }
}
