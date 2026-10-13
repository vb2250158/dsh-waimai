/** Platform-scoped account sessions. Unconfirmed logins never replace a saved account. */
import { readFile, copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { WaimaiLogin, LoginError } from './login.js'
import { HemaLogin } from './hema-login.js'
import { HemaService } from './hema-service.js'
import { browseImage } from './browse-data.js'
import { PlatformService, PlatformError } from './platform-service.js'
import { writeJsonState } from './automation.js'

const account = z.object({ ref: z.uuid(), externalId: z.string().regex(/^[1-9]\d*$/).optional(),
  nickname: z.string().max(512).optional(), avatarUrl: z.string().refine(value => browseImage(value) === value).nullable().optional(),
  loginMethod: z.enum(['sms', 'taobao-qr', 'taobao-sms']).optional() }).strict()
const platform = z.object({ activeRef: z.uuid().nullable(), accounts: z.array(account) }).strict()
const indexSchema = z.object({ version: z.literal(1), platforms: z.record(z.string().regex(/^[a-z]+$/), platform) }).strict()
const readMethods = new Set(['profile', 'orders', 'addresses', 'selectAddress', 'recentShops', 'nearbyShops', 'probeMenu', 'productDetail', 'itemOptions', 'cart', 'cartAdd', 'cartChange', 'checkout', 'submit', 'tradeHistory', 'prepare'])

/** Own the index, account jars and pending login; serialize selection with all account reads. */
export class AccountPool {
  /** @param options - local directory, verified adapters, login settings and per-platform capacity. */
  constructor({ directory, definitions, loginOptions = {}, maxAccounts = 10, createLogin, now = Date.now }) {
    this.directory = directory; this.definitions = new Map(definitions.map(value => [value.id, value]))
    this.loginOptions = loginOptions; this.maxAccounts = maxAccounts; this.createLogin = createLogin || (options =>
      options.platformId === 'hema' ? new HemaLogin(options) : new WaimaiLogin(options)); this.now = now
    this.indexPath = join(directory, 'accounts.json'); this.sessions = new Map(); this.drafts = new Map(); this.smsAttempts = new Map(); this.chain = Promise.resolve()
  }

  /** @param operation - account-scoped operation. @returns serialized result; failure retains the active account. */
  run(operation) {
    const task = this.chain.then(operation)
    this.chain = task.then(() => {}, () => {})
    return task
  }

  /** @param id - registry platform ID. @returns supported adapter; unavailable platforms cannot access another platform's jar. */
  requirePlatform(id) {
    const definition = this.definitions.get(id)
    if (!definition) throw new PlatformError('unknown-platform', '未找到该外卖平台')
    if (!definition.adapter) throw new PlatformError('not-integrated', '该平台尚未接入，未执行登录或点餐请求')
    return definition
  }

  /** @param platformId - validated platform ID. @param ref - owner-generated UUID. @returns private account directory. */
  accountDirectory(platformId, ref) { return join(this.directory, 'accounts', platformId, z.uuid().parse(ref)) }

  /** Validate durable references before opening any credential file; retain the legacy file during migration. */
  async init() {
    if (this.index) return
    let index = { version: 1, platforms: {} }
    if (this.loginOptions.persistLogin !== false) {
      try { index = indexSchema.parse(JSON.parse(await readFile(this.indexPath, 'utf8'))) }
      catch (error) { if (error.code !== 'ENOENT') throw new LoginError('本机账号列表无法读取，原登录记录仍保留') }
      for (const [id, value] of Object.entries(index.platforms)) {
        this.requirePlatform(id)
        const refs = new Set(value.accounts.map(row => row.ref))
        if (refs.size !== value.accounts.length || value.accounts.length > this.maxAccounts || (value.activeRef && !refs.has(value.activeRef))) {
          throw new LoginError('本机账号列表引用无效，原登录记录仍保留')
        }
      }
      if (!Object.keys(index.platforms).length) {
        let legacy
        try { legacy = JSON.parse(await readFile(join(this.directory, 'login-state.json'), 'utf8')) }
        catch (error) { if (error.code !== 'ENOENT') throw new LoginError('原登录记录无法读取，未迁移账号') }
        if (legacy) {
          if (legacy.version !== 1 || !legacy.storageState || !Array.isArray(legacy.storageState.cookies)) throw new LoginError('原登录记录无法识别，未迁移账号')
          this.requirePlatform('taobao')
          const ref = randomUUID(), directory = this.accountDirectory('taobao', ref)
          await mkdir(directory, { recursive: true, mode: 0o700 })
          await copyFile(join(this.directory, 'login-state.json'), join(directory, 'login-state.json'))
          try { await copyFile(join(this.directory, 'delivery-selection.json'), join(directory, 'delivery-selection.json')) }
          catch (error) { if (error.code !== 'ENOENT') throw new LoginError('原配送地址无法迁移，未切换账号') }
          index.platforms.taobao = { activeRef: ref, accounts: [{ ref, loginMethod: legacy.loginMethod === 'taobao-qr' ? 'taobao-qr' : 'sms' }] }
          await this.save(index)
        }
      }
    }
    this.index = index
  }

  /** @param index - validated account index. @returns durable completion before the active reference changes. */
  async save(index) {
    if (this.loginOptions.persistLogin !== false) await writeJsonState(this.indexPath, indexSchema.parse(index))
  }

  /** @param id - supported platform ID. @returns copied account references and cached display fields, never cookies. */
  list(id, viewRef) {
    const saved = this.index.platforms[id] || { activeRef: null, accounts: [] }
    return { viewAccountRef: viewRef || saved.activeRef, accounts: saved.accounts.map(row => ({ ...row })), addingAccount: this.drafts.has(id) }
  }

  /** @param id - supported platform ID. @param ref - account UUID. @returns lazy session and account-specific address owner. */
  session(id, ref) {
    const key = id + ':' + ref
    if (!this.sessions.has(key)) {
      const directory = this.accountDirectory(id, ref)
      const definition = this.requirePlatform(id)
      const login = this.createLogin({ ...this.loginOptions, platformId: definition.adapter, statePath: join(directory, 'login-state.json') })
      const Service = definition.adapter === 'hema' ? HemaService : PlatformService
      this.sessions.set(key, { ref, login, service: new Service({ login, directory, pageSize: this.loginOptions.browsePageSize, productPageSize: this.loginOptions.hemaProductPageSize,
        hideSponsoredShops: this.loginOptions.hideSponsoredShops,
        tradeOptions: { journalDirectory: this.directory, ...this.loginOptions.tradeOptions } }) })
    }
    return this.sessions.get(key)
  }

  /** @param id - supported platform. @param expectedRef - optional UI revision. @returns selected session or rejects a stale view. */
  active(id, requestedRef) {
    const saved = this.index.platforms[id]
    const ref = requestedRef || saved?.activeRef
    if (requestedRef !== undefined && !saved?.accounts.some(row => row.ref === requestedRef)) throw new PlatformError('account-missing', '该平台未保存此账号，请刷新页面')
    if (!ref) throw new PlatformError('login-required', '请先添加并登录账号')
    return this.session(id, ref)
  }

  /** @param id - supported platform. @returns independently checked active status plus private account list. */
  async status(id, ref) {
    const saved = this.index.platforms[id]
    const status = ref || saved?.activeRef ? await this.active(id, ref).login.status() : { authenticated: false, state: 'logged-out', codePending: false }
    if (status.authenticated) {
      const current = this.active(id, ref), profile = await current.login.profile(), row = saved.accounts.find(value => value.ref === current.ref)
      if (row.externalId && row.externalId !== String(profile.id)) throw new PlatformError('account-changed', '保存的账号身份已变化，请重新登录')
      Object.assign(row, { externalId: String(profile.id), nickname: profile.nickname, avatarUrl: profile.avatarUrl, loginMethod: status.loginMethod })
    }
    const pending = this.drafts.get(id)?.login.summary()
    return { ...status, ...this.list(id, ref), ...(id === 'hema' ? { taobaoAccounts: (this.index.platforms.taobao?.accounts || [])
      .filter(row => row.loginMethod === 'taobao-qr').map(row => ({ ref: row.ref, nickname: row.nickname })) } : {}), pendingLogin: pending ? { ...pending,
      retryAfterSeconds: Math.max(pending.retryAfterSeconds || 0, Math.ceil(((this.smsAttempts.get(id) || 0) - this.now()) / 1000), 0) } : undefined }
  }

  /** @param id - supported platform. @returns isolated pending login; it is absent from the saved account list. */
  begin(id) {
    if (this.drafts.has(id)) return this.drafts.get(id)
    const draft = this.session(id, randomUUID()); this.drafts.set(id, draft)
    return draft
  }

  /** Verify profile and order ownership before updating the index; duplicate identities refresh their existing slot. */
  async commit(id, draft) {
    const profile = await draft.login.profile(), orders = await draft.login.orders()
    if (String(profile.id) !== String(orders.accountId)) throw new LoginError('新账号与订单身份不一致，原账号仍保留')
    const next = structuredClone(this.index), saved = next.platforms[id] ||= { activeRef: null, accounts: [] }
    const existing = saved.accounts.find(row => row.externalId === String(profile.id))
    if (!existing && saved.accounts.length >= this.maxAccounts) throw new PlatformError('account-limit', '该平台账号数量已达到配置上限，原账号仍保留')
    const previousRef = existing?.ref
    const ref = draft.ref
    if (existing && this.loginOptions.persistLogin !== false) {
      await mkdir(this.accountDirectory(id, ref), { recursive: true, mode: 0o700 })
      try { await copyFile(join(this.accountDirectory(id, existing.ref), 'delivery-selection.json'), join(this.accountDirectory(id, ref), 'delivery-selection.json')) }
      catch (error) { if (error.code !== 'ENOENT') throw new LoginError('原账号地址无法保留，未切换账号') }
    }
    const row = { ref, externalId: String(profile.id), nickname: profile.nickname, avatarUrl: profile.avatarUrl, loginMethod: draft.login.summary().loginMethod }
    if (existing) Object.assign(existing, row); else saved.accounts.push(row)
    if (!saved.activeRef || saved.activeRef === previousRef) saved.activeRef = ref
    await this.save(next)
    this.index = next; this.drafts.delete(id)
  }

  /** @param method - private RPC or named account read. @param args - validated request fields. @returns serialized private result. */
  dispatch(method, args) {
    if (readMethods.has(method)) {
      return this.run(async () => {
        this.requirePlatform(args.platformId); await this.init()
        if (!args.accountRef && this.index.platforms[args.platformId]?.accounts.length > 1) {
          throw new PlatformError('account-required', '该平台已登录多个账号，请指定 accountRef')
        }
        return this.active(args.platformId, args.accountRef)
      }).then(current => this.read(method, args, current))
    }
    return this.run(async () => {
      const id = args.platformId; this.requirePlatform(id); await this.init()
      if (args.accountRef) this.active(id, args.accountRef)
      if (method === 'accountsList') return this.list(id, args.accountRef)
      if (method === 'status') return this.status(id, args.accountRef)
      if (method === 'accountBegin') { this.begin(id); return this.status(id, args.accountRef) }
      if (method === 'accountCancel') {
        const draft = this.drafts.get(id)
        if (draft) { await draft.login.close(); this.drafts.delete(id); this.sessions.delete(id + ':' + draft.ref) }
        return this.status(id, args.accountRef)
      }
      if (method === 'accountView') {
        if (!this.index.platforms[id]?.accounts.some(row => row.ref === args.accountRef)) throw new PlatformError('account-missing', '该平台未保存此账号')
        const candidate = this.session(id, args.accountRef), status = await candidate.login.status()
        if (!status.authenticated) return { ...status, ...this.list(id, args.accountRef), pendingLogin: this.drafts.get(id)?.login.summary() }
        const profile = await candidate.login.profile(), row = this.index.platforms[id].accounts.find(value => value.ref === args.accountRef)
        if (row.externalId && row.externalId !== String(profile.id)) throw new PlatformError('account-changed', '保存的账号身份已变化，未切换账号')
        Object.assign(row, { externalId: String(profile.id), nickname: profile.nickname, avatarUrl: profile.avatarUrl, loginMethod: status.loginMethod })
        return { ...status, ...this.list(id, args.accountRef), pendingLogin: this.drafts.get(id)?.login.summary() }
      }
      if (method === 'useTaobao') {
        if (id !== 'hema') throw new PlatformError('bad-request', '此登录入口仅用于盒马')
        const source = this.active('taobao', args.sourceAccountRef), profile = await source.login.profile()
        const row = this.index.platforms.taobao.accounts.find(value => value.ref === source.ref)
        if (row.externalId && row.externalId !== String(profile.id)) throw new PlatformError('account-changed', '所选淘宝账号身份已变化，请重新登录')
        const session = await source.login.exportTaobaoSession()
        if (session.businessAccountId !== String(profile.id)) throw new PlatformError('account-changed', '所选淘宝账号身份已变化，未登录盒马')
        const draft = this.begin(id)
        await draft.login.acceptTaobaoSession(session.storageState, session.accountId)
        await this.commit(id, draft)
        return this.status(id, draft.ref)
      }
      if (['sendCode', 'complete', 'qrStart', 'qrPoll', 'qrCancel'].includes(method)) {
        const qrMethod = method === 'qrStart' ? this.requirePlatform(id).loginMethods.find(value => value.id === (args.loginMethod || 'taobao-qr')) : null
        if (method === 'qrStart' && (!qrMethod?.available || qrMethod.kind !== 'qr')) {
          throw new PlatformError('login-method-unavailable', '盒马 App 扫码尚未接通；可明确选择淘宝授权方式，原账号仍保留')
        }
        if (method === 'sendCode' || method === 'complete') {
          const smsMethod = this.requirePlatform(id).loginMethods.find(value => value.id === (args.loginMethod || (id === 'hema' ? 'taobao-sms' : 'sms')))
          if (!smsMethod?.available || smsMethod.kind !== 'sms') throw new PlatformError('login-method-unavailable', '所选短信登录方式不属于当前平台')
        }
        if (method === 'sendCode') {
          if (this.now() < (this.smsAttempts.get(id) || 0)) throw new LoginError('请等待验证码发送间隔结束后重试')
          this.smsAttempts.set(id, this.now() + (this.loginOptions.resendSeconds ?? 60) * 1000)
        }
        const draft = ['sendCode', 'qrStart'].includes(method) ? this.begin(id) : this.drafts.get(id)
        if (!draft) throw new LoginError('本次登录已取消，请重新开始')
        const payload = method === 'sendCode' ? args.phone : method === 'complete' ? args.code : args.attemptId
        const progress = method === 'complete' && id === 'hema' ? await draft.login.complete(payload, args.smsAttemptId) : await draft.login[method](payload)
        const verified = (method === 'complete' && progress.authenticated) || progress.qr?.state === 'linked'
        if (verified) await this.commit(id, draft)
        return { ...await this.status(id, verified ? draft.ref : args.accountRef), ...(progress.qr ? { qr: progress.qr } : {}) }
      }
      throw new PlatformError('bad-request', '账号操作无效')
    })
  }

  /** @param method - account read. @param args - validated fields. @param current - captured session. @returns per-account serialized result; other accounts may read concurrently. */
  async read(method, args, current) {
    const id = args.platformId
    const profile = await current.login.profile(), row = this.index.platforms[id].accounts.find(value => value.ref === current.ref)
    if (!row || (row.externalId && row.externalId !== String(profile.id))) throw new PlatformError('account-changed', '保存的账号身份已变化，请重新登录')
    Object.assign(row, { externalId: String(profile.id), nickname: profile.nickname, avatarUrl: profile.avatarUrl })
    if (method === 'profile') return profile
    const parameters = { orders: [id, args.cursor], addresses: [id], selectAddress: [id, args.accountId, args.addressRef],
      recentShops: [id, args.keyword, args.addressRef], nearbyShops: [id, args.cursor, args.addressRef],
      probeMenu: [id, args.shopId, args.addressRef, args.keyword, args.cursor], productDetail: [id, args.productRef, args.addressRef], cart: [id, args.addressRef, args.shopId],
      itemOptions: [id, args], cartAdd: [id, args], cartChange: [id, args], checkout: [id, args], submit: [id, args], tradeHistory: [id], prepare: [id] }
    if (typeof current.service[method] !== 'function') throw new PlatformError('not-integrated', '该平台暂不支持此操作')
    const result = await current.service[method](...parameters[method])
    if (String(current.login.accountId) !== String(profile.id) || (result.accountId !== undefined && String(result.accountId) !== String(profile.id))) {
      throw new PlatformError('account-changed', '返回的资料不属于此账号，请重新登录')
    }
    return result
  }

  /** @returns model-safe saved connection handles; each use still checks the business session. */
  connections() {
    return this.run(async () => {
      await this.init()
      return [...this.definitions.values()].map(definition => ({ platformId: definition.id, available: Boolean(definition.adapter),
        connections: (this.index.platforms[definition.id]?.accounts || []).map(row => ({ accountRef: row.ref })) }))
    })
  }

  /** Dispose all loaded jars after queued reads, including unconfirmed login attempts. */
  close() { return this.run(async () => { for (const value of this.sessions.values()) await value.login.close(); this.sessions.clear(); this.drafts.clear() }) }
}
