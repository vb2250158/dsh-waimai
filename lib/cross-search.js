/** Private cross-platform search orchestration; platform adapters own identity and catalog reads. */
import { z } from 'zod'
import { HemaProductCursor } from './hema-data.js'
import { LoginError } from './login.js'
import { PlatformError } from './platform-service.js'

const platformId = z.string().regex(/^[a-z]+$/)
const accountRef = z.uuid().nullable()
const shopId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/)
const addressRef = z.string().regex(/^[a-f0-9]{64}$/)
const keyword = z.string().trim().min(1).max(100)
const account = z.object({ platformId, accountRef }).strict()
const taobaoCursor = z.object({ platformId: z.literal('taobao'), ref: z.uuid() }).strict()

/** Validated private search request; duplicate account entries do not start duplicate reads. */
export const CrossSearchRequest = z.object({ keyword, accounts: z.array(account).min(1).max(16) }).strict()
  .refine(value => new Set(value.accounts.map(row => `${row.platformId}:${row.accountRef}`)).size === value.accounts.length)
/** Group pagination remains bound to the address returned by the original search. */
export const CrossSearchPageRequest = z.object({ platformId, accountRef: z.uuid(), keyword, shopId, addressRef,
  cursor: z.union([HemaProductCursor, taobaoCursor]).optional() }).strict()
  .refine(value => !value.cursor || value.cursor.platformId === value.platformId)

const invalidating = new Set(['account-changed', 'address-changed', 'address-required', 'selection-invalid',
  'account-missing', 'account-required', 'session-expired', 'shop-unavailable', 'search-changed'])
const invalidates = error => error instanceof LoginError && (!(error instanceof PlatformError) || invalidating.has(error.code))
const safeError = error => error instanceof LoginError
  ? { code: error.code || 'login-failed', message: error.message }
  : { code: 'search-unavailable', message: '商品搜索暂时不可用，请稍后重试' }
const groupBase = (shop, address) => ({ shopId: shop.id, shopName: shop.name, addressRef: address,
  items: [], hasMore: false, nextCursor: null })
const catalogGroup = result => ({ shopId: 'platform', shopName: '', addressRef: result.addressRef, state: 'ready',
  items: result.items, hasMore: result.hasMore, nextCursor: result.nextCursor, unknownCards: result.unknownCards })

/** Reuse the account-owned catalog and its opaque, account/address-bound continuation. */
async function readGroup(accounts, owner, shop, address, query, cursor) {
  const result = await accounts.dispatch('probeMenu', { ...owner, shopId: shop.id, addressRef: address, keyword: query,
    ...(cursor ? { cursor } : {}) })
  if (result.shopId !== shop.id || result.addressRef !== address) throw new PlatformError('address-changed', '配送信息已变化，请重新搜索')
  return { ...groupBase(shop, address), state: 'ready', items: result.categories.flatMap(category => category.items),
    hasMore: result.hasMore, nextCursor: result.nextCursor }
}

/** Search supported delivery groups; an account/address failure invalidates the entire platform result.
 * @param accounts - account pool providing authenticated serialized reads.
 * @param request - keyword and explicit platform accounts.
 * @returns platform results with scope and partial errors.
 */
export async function crossSearch(accounts, request) {
  const { keyword: query, accounts: selected } = CrossSearchRequest.parse(request)
  const platforms = await Promise.all(selected.map(async owner => {
    const base = { ...owner, scope: 'unavailable', groups: [] }
    if (!['hema', 'taobao'].includes(owner.platformId) || !owner.accountRef) return { ...base, state: 'unavailable' }
    try {
      if (owner.platformId === 'taobao') {
        const result = await accounts.dispatch('searchCatalog', { ...owner, keyword: query })
        return { ...base, scope: 'platform', groups: [catalogGroup(result)], state: result.hasMore || result.unknownCards > 0 ? 'partial' : 'ready' }
      }
      const page = await accounts.dispatch('nearbyShops', owner)
      const groups = []
      for (const [index, shop] of page.shops.entries()) {
        if (index > 0) { groups.push({ ...groupBase(shop, page.addressRef), state: 'deferred' }); continue }
        try { groups.push(await readGroup(accounts, owner, shop, page.addressRef, query)) }
        catch (error) {
          if (invalidates(error)) throw error
          groups.push({ ...groupBase(shop, page.addressRef), state: 'error', error: safeError(error) })
        }
      }
      await accounts.dispatch('nearbyShops', { ...owner, addressRef: page.addressRef })
      return { ...base, scope: 'delivery-stores', groups,
        state: groups.some(group => group.state !== 'ready' || group.hasMore) ? 'partial' : 'ready' }
    } catch (error) { return { ...base, state: 'error', error: safeError(error) } }
  }))
  return { keyword: query, platforms }
}

/** Read one deferred group or continuation after revalidating account, address and group membership.
 * @param accounts - account pool providing authenticated serialized reads.
 * @param request - owner, original address, group, query and optional cursor.
 * @returns one result page owned by the requested group.
 */
export async function crossSearchPage(accounts, request) {
  const { platformId: id, accountRef: ref, keyword: query, shopId: selected, addressRef: address, cursor } = CrossSearchPageRequest.parse(request)
  if (id === 'taobao') {
    if (selected !== 'platform') throw new PlatformError('bad-request', '该分页不属于平台搜索')
    const result = await accounts.dispatch('searchCatalog', { platformId: id, accountRef: ref, keyword: query, addressRef: address,
      ...(cursor ? { cursor } : {}) })
    if (result.addressRef !== address) throw new PlatformError('address-changed', '配送信息已变化，请重新搜索')
    return { platformId: id, accountRef: ref, keyword: query, ...catalogGroup(result) }
  }
  if (id !== 'hema') throw new PlatformError('not-integrated', '该平台暂不支持商品搜索')
  const owner = { platformId: id, accountRef: ref }
  const page = await accounts.dispatch('nearbyShops', { ...owner, addressRef: address })
  const shop = page.shops.find(value => value.id === selected)
  if (!shop || page.addressRef !== address) throw new PlatformError('address-changed', '配送信息已变化，请重新搜索')
  const result = await readGroup(accounts, owner, shop, address, query, cursor)
  await accounts.dispatch('nearbyShops', { ...owner, addressRef: address })
  return { ...owner, keyword: query, ...result }
}
