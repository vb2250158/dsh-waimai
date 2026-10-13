/** Hema HTTP account owner. A Taobao identity alone cannot establish a Hema profile. */
import { readFile, copyFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { WaimaiLogin, LoginError } from './login.js'
import { writeJsonState } from './automation.js'
import { hemaJson, hemaProfile, hemaOrders, HemaOrderCursor } from './hema-data.js'
import { TaobaoSmsSession } from './taobao-sms.js'

const cookie = z.object({ name: z.string().min(1).max(256), value: z.string().max(16384), domain: z.enum(['.taobao.com', 'login.taobao.com', '.login.taobao.com']),
  path: z.string().startsWith('/').max(1024), expires: z.number().finite(), httpOnly: z.boolean(), secure: z.boolean(), sameSite: z.enum(['Strict', 'Lax', 'None']) }).strict()
const storage = z.object({ cookies: z.array(cookie).max(200), origins: z.array(z.never()).max(0) }).strict()
const state = z.union([z.object({ version: z.literal(1), platformId: z.literal('hema'), authenticated: z.literal(true),
  loginMethod: z.literal('taobao-qr'), storageState: storage }).strict(),
  z.object({ version: z.literal(2), platformId: z.literal('hema'), authenticated: z.literal(true),
    loginMethod: z.enum(['taobao-qr', 'taobao-sms']), storageState: storage }).strict()])

/** @param value - private Taobao jar. @returns a validated jar with no other product's credentials or page storage. */
export function hemaStorage(value) {
  return storage.parse({ cookies: value.cookies.filter(item => ['.taobao.com', 'login.taobao.com', '.login.taobao.com'].includes(item.domain)
    && !item.name.startsWith('last_u_') && item.name !== 'last_cc'), origins: [] })
}

/** Own independent Hema credentials; reuse only the common QR and Mtop transports. */
export class HemaLogin extends WaimaiLogin {
  /** @param options - account owner and login settings. */
  constructor(options) {
    super(options)
    this.sms = new TaobaoSmsSession({ createContext: this.createContext, timeoutMs: this.timeoutMs, diagnostic: (stage, attemptId) => {
      this.loginAttemptId = attemptId; this.traceLogin(stage)
    } })
  }
  /** Restore only the platform-tagged Hema state. Invalid files are retained and reported. */
  async init() {
    if (this.http) return
    this.protocol = JSON.parse(await readFile(new URL('./hema-protocol.json', import.meta.url), 'utf8'))
    let saved
    if (this.persistLogin) {
      try { saved = state.parse(JSON.parse(await readFile(this.statePath, 'utf8'))) }
      catch (error) { if (error.code !== 'ENOENT') throw new LoginError('本机盒马登录记录无法读取，原记录仍保留') }
    }
    this.http = await this.createContext({ timeout: this.timeoutMs, maxRedirects: 0, ...(saved ? { storageState: saved.storageState } : {}) })
    this.loginMethod = saved?.loginMethod || 'taobao-qr'; this.authenticated = false
  }

  /** @param response - successful Hema HTTP response. @returns JSON retaining large order identifiers. */
  async readMtopResponse(response) { return hemaJson(await response.text()) }

  /** @param raw - Mtop envelope. Reject business failures and interactive challenges before projecting data. */
  checkReply(raw) {
    if (raw.ret.some(value => /^(FAIL_SYS_USER_VALIDATE|RGV587_ERROR)::/.test(value))) throw new LoginError('盒马要求人工验证，请在官方客户端完成后重试')
    if (!raw.ret.some(value => value.startsWith('SUCCESS::')) || raw.data?.isSuccess === false || raw.data?.errorCode) {
      throw new LoginError('盒马暂未返回可用数据，请检查账号或稍后重试')
    }
  }

  /** @returns independently checked Taobao identity; a logged-out response does not fall back to another account. */
  async checkAccount() {
    const raw = await this.mtop(this.protocol.session, {})
    if (raw.ret.some(value => /^(FAIL_SYS_SESSION_EXPIRED|FAIL_SYS_ILLEGAL_ACCESS|FAIL_SYS_USER_NOT_LOGIN)::/.test(value))) {
      this.accountId = undefined; return false
    }
    this.checkReply(raw)
    const parsed = z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive().safe()]).safeParse(raw.data?.userNumId)
    if (!parsed.success) throw new LoginError('盒马登录身份无法确认，请重新登录')
    this.accountId = String(parsed.data); return true
  }

  /** @param expected - identity captured before a private read. Reject a changed jar before releasing its data. */
  async verifyIdentity(expected) {
    if (!await this.checkAccount() || this.accountId !== expected) throw new LoginError('盒马账号身份已变化，未返回其他账号的资料')
  }

  /** @returns self profile only, checked before and after the platform response. */
  profile() {
    return this.run(async () => {
      await this.requireAccount(); const expected = this.accountId
      const raw = await this.mtop(this.protocol.profile, {}); this.checkReply(raw)
      let profile
      try { profile = hemaProfile(raw.data, expected) } catch { throw new LoginError('盒马账号资料无法确认，请重新登录') }
      await this.verifyIdentity(expected); return profile
    })
  }

  /** @param cursor - account-bound next page. @returns a private read-only history page. */
  orders(cursor) { return this.run(async () => { await this.requireAccount(); return this.readOrders(cursor) }) }

  /** @param cursor - validated Hema cursor. @returns order page inside an already serialized account read. */
  async readOrders(cursor) {
    const expected = this.accountId, position = cursor === undefined ? 1 : HemaOrderCursor.parse(cursor).pageIndex
    if (cursor && cursor.accountId !== expected) throw new LoginError('盒马订单分页不属于当前账号，请返回最新订单')
    const raw = await this.mtop(this.protocol.orders, { pageIndex: position, pageSize: this.historyPageSize, searchContent: '' }); this.checkReply(raw)
    let result
    try { result = hemaOrders(raw.data?.data, this.historyPageSize, position, expected) }
    catch { throw new LoginError('盒马订单或分页信息无法确认，请刷新后重试') }
    await this.verifyIdentity(expected); return { accountId: expected, ...result }
  }

  /** @returns independently checked Hema login status. */
  status() {
    return this.run(async () => {
      await this.init()
      if (!(await this.http.storageState()).cookies.length) { this.authenticated = false; this.state = 'logged-out'; return this.summary() }
      this.authenticated = await this.checkAccount()
      if (this.authenticated) {
        const expected = this.accountId, raw = await this.mtop(this.protocol.profile, {}); this.checkReply(raw)
        try { hemaProfile(raw.data, expected) } catch { this.authenticated = false; throw new LoginError('盒马账号资料无法确认，请重新登录') }
        await this.verifyIdentity(expected)
      }
      this.state = this.authenticated ? 'logged-in' : 'logged-out'
      return this.summary()
    })
  }

  /** @param storageState - explicitly selected Taobao session. @param expectedId - verified source identity. @returns verified Hema status; source files remain unchanged. */
  acceptTaobaoSession(storageState, expectedId) {
    return this.run(async () => { await this.init(); await this.qr.close(); await this.cancelSms(); await this.activateState(hemaStorage(storageState), expectedId, 'taobao-qr'); return this.summary() })
  }

  /** @param storageState - independent candidate jar. @param expectedId - optional source identity. @param loginMethod - verified authorization method. Commit only after self profile and order checks. */
  async activateState(storageState, expectedId, loginMethod) {
    const http = await this.createContext({ timeout: this.timeoutMs, maxRedirects: 0, storageState })
    const candidate = new HemaLogin({ statePath: this.statePath, persistLogin: false, historyPageSize: this.historyPageSize,
      timeoutMs: this.timeoutMs, createContext: async () => http })
    let adopted = false
    try {
      await candidate.init(); const profile = await candidate.profile(), orders = await candidate.orders()
      if (profile.id !== orders.accountId || (expectedId && profile.id !== expectedId)) throw new LoginError('盒马与所选淘宝账号身份不一致，原账号仍保留')
      this.traceLogin('hema-profile-and-orders-verified')
      if (this.persistLogin) {
        const record = state.parse({ version: 2, platformId: 'hema', authenticated: true, loginMethod, storageState: hemaStorage(await http.storageState()) })
        let backup, previousRecord
        try { previousRecord = await readFile(this.statePath) } catch (error) { if (error.code !== 'ENOENT') throw error }
        if (previousRecord !== undefined) {
          backup = this.statePath + '.backup-' + randomUUID()
          await writeFile(backup, previousRecord, { flag: 'wx', mode: 0o600 })
          if (!previousRecord.equals(await readFile(this.statePath))) throw new LoginError('本机盒马登录记录已变化，未覆盖其他修改')
        }
        try {
          await writeJsonState(this.statePath, record)
          if (JSON.stringify(state.parse(JSON.parse(await readFile(this.statePath, 'utf8')))) !== JSON.stringify(record)) throw new Error('state differs')
        } catch {
          if (backup) await copyFile(backup, this.statePath)
          throw new LoginError('盒马登录记录保存或校验失败，原账号仍保留')
        }
      }
      const previous = this.http
      this.http = http; this.accountId = profile.id; this.authenticated = true; this.loginMethod = loginMethod; this.state = 'logged-in'; adopted = true
      await previous.dispose()
    } finally { if (!adopted) await http.dispose() }
  }

  /** Activate a fresh QR only after Hema self-profile and history verification; no binding or registration is called. */
  async activateQr() {
    await this.activateState(hemaStorage(await this.qr.http.storageState()), undefined, 'taobao-qr')
    await this.qr.http.dispose(); this.qr.http = undefined; this.qr.state = 'linked'; this.qr.image = undefined
  }

  /** @param phone - explicit private UI input. @returns SMS state; original account files remain untouched. */
  sendCode(phone) {
    return this.run(async () => {
      if (typeof phone !== 'string' || !/^1[3-9]\d{9}$/.test(phone)) throw new LoginError('请输入有效的中国大陆手机号')
      if (this.summary().retryAfterSeconds > 0) throw new LoginError('请等待验证码发送间隔结束后重试')
      await this.init(); await this.qr.close(); this.smsActive = true; this.lastAttempt = Date.now()
      try { await this.sms.send(phone, this.protocol) } catch { throw new LoginError('短信请求结果未确认，请稍后重试；原账号仍保留') }
      return this.summary()
    })
  }

  /** @param code - explicit private UI input. @param attemptId - pending SMS reference. @returns verified Hema login, or a state requiring manual verification. */
  complete(code, attemptId) {
    return this.run(async () => {
      if (!this.smsActive) throw new LoginError('请先获取验证码')
      if (!attemptId || attemptId !== this.sms.attemptId) throw new LoginError('本次短信登录已更新或取消，请重新获取验证码')
      if (typeof code !== 'string' || !/^\d{4,8}$/.test(code)) throw new LoginError('请输入短信验证码')
      if (this.sms.state !== 'login-unconfirmed') await this.sms.complete(code, this.protocol, attemptId)
      if (this.sms.state === 'login-unconfirmed') {
        await this.activateState(hemaStorage(await this.sms.http.storageState()), undefined, 'taobao-sms')
        await this.cancelSms()
      }
      return this.summary()
    })
  }

  /** @returns safe pending SMS state alongside the current account. */
  summary() { return { ...super.summary(), ...(this.smsActive ? this.sms.summary() : {}) } }
  /** Discard SMS credentials before QR or explicit account reuse. */
  async cancelSms() {
    const attemptId = this.sms.attemptId
    await this.sms.close(); this.smsActive = false
    if (this.loginAttemptId === attemptId) this.loginAttemptId = undefined
  }
  /** Dispose both temporary login methods and the account jar after queued operations. */
  close() { return this.run(async () => { await this.cancelSms(); await this.qr.close(); await this.http?.dispose(); this.http = undefined; this.pending = undefined }) }
}
