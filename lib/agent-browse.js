/** Model-safe browse positions and product queries reuse the verified account owner. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { PlatformError } from './platform-service.js'
import { agentDisplay } from './agent-ordering.js'

/** Register paged merchant reads and keyword queries within explicitly selected stores.
 * @param register - MCP registration helper.
 * @param accounts - account and delivery selection owner.
 * @param options - validated cursor lifetime and retained count.
 */
export function registerAgentBrowse(register, accounts, { cursorSeconds, cursorLimit, now = Date.now }) {
  const positions = new Map(), platformId = z.literal('taobao').default('taobao'), accountRef = z.uuid()
  const shopId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/)
  const sweep = () => { for (const [ref, position] of positions) if (position.expiresAt <= now()) positions.delete(ref) }
  register('search_shops', '分页查询当前地址的附近推荐店铺，或最近一页订单店铺。关键词只筛选本页；无匹配且 nextCursor 非空时继续翻页。不是全平台搜索；游标不含账号或地址。',
    { platformId: z.string().regex(/^[a-z]+$/).default('taobao'), accountRef: accountRef.optional(),
      scope: z.enum(['nearby', 'recent']).default('nearby'), keyword: z.string().max(100).default(''), cursor: z.uuid().optional() }, async args => {
      sweep()
      let position
      if (args.cursor) {
        position = positions.get(args.cursor)
        if (!position) throw new PlatformError('cursor-expired', '店铺分页已过期，请从第一页重新查询')
        if (position.platformId !== args.platformId || position.accountRef !== args.accountRef || position.scope !== args.scope || position.keyword !== args.keyword) {
          throw new PlatformError('cursor-invalid', '分页不属于本次账号、关键词或查询范围')
        }
      }
      const result = await accounts.dispatch(args.scope === 'recent' ? 'recentShops' : 'nearbyShops',
        { ...args, cursor: position?.native })
      let nextCursor = null
      if (result.nextCursor) {
        if (positions.size >= cursorLimit) positions.delete(positions.keys().next().value)
        nextCursor = randomUUID()
        positions.set(nextCursor, { ...args, native: result.nextCursor, expiresAt: now() + cursorSeconds * 1000 })
      }
      return { platformId: result.platformId, scope: result.scope,
        shops: result.shops.filter(shop => shop.name.toLocaleLowerCase().includes(args.keyword.toLocaleLowerCase())),
        hasMore: Boolean(nextCursor), nextCursor, pageSize: result.shops.length }
    })
  register('search_products', '按商品名称查询已选店铺的当前菜单，最多十家。先 search_shops 分页发现商超，再传真实 shopIds；返回标价、规格描述和可售状态，不能据此声称最低实付价或全平台缺货。空店和读取失败分开返回。不加购或下单。',
    { platformId, accountRef, shopIds: z.array(shopId).min(1).max(10), keyword: z.string().trim().min(1).max(100) }, async args => {
      const query = args.keyword.normalize('NFKC').toLocaleLowerCase(), stores = []
      let expectedAddress
      for (const id of new Set(args.shopIds)) {
        let menu
        try { menu = await accounts.dispatch('probeMenu', { platformId: args.platformId, accountRef: args.accountRef, shopId: id, addressRef: expectedAddress }) }
        catch (error) {
          if (!(error instanceof PlatformError) || ['account-changed', 'address-changed', 'address-required', 'selection-invalid'].includes(error.code)) throw error
          stores.push({ shopId: id, state: 'unreadable', code: error.code }); continue
        }
        expectedAddress ??= menu.addressRef
        const all = [...new Map(menu.categories.flatMap(group => group.items).map(item => [item.id, item])).values()]
        const items = all.filter(item => [item.name, item.description].join(' ').normalize('NFKC').toLocaleLowerCase().includes(query))
        stores.push({ shopId: id, state: menu.menuState || (items.length ? 'matches' : 'no-match'),
          scannedItems: all.length, items, ...(menu.notice ? { notice: menu.notice } : {}) })
      }
      return { view: 'product-search', platformId: args.platformId, accountRef: args.accountRef, keyword: args.keyword,
        scope: 'selected-stores-only', priceKind: 'listed', complete: stores.every(store => store.state !== 'unreadable'),
        stores: stores.map(agentDisplay) }
    })
}
