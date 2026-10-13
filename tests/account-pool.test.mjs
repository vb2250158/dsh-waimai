import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountPool } from '../lib/account-pool.js'
import { writeJsonState } from '../lib/automation.js'

const definitions = [{ id: 'taobao', adapter: 'taobao', loginMethods: [{ id: 'taobao-qr', kind: 'qr', available: true }, { id: 'sms', kind: 'sms', available: true }] },
  { id: 'meituan', adapter: null, loginMethods: [] }, { id: 'jd', adapter: null, loginMethods: [] }]
const avatarUrl = 'https://cube.elemecdn.com/a/aa/' + 'a'.repeat(29) + 'png.png'
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-accounts-')), jars = []
  const createLogin = options => {
    const login = { ...options, authenticated: false, accountId: undefined, identity: undefined, loginMethod: 'sms', chain: Promise.resolve(),
      summary() { return { authenticated: this.authenticated, state: this.authenticated ? 'logged-in' : 'not-checked', loginMethod: this.loginMethod } },
      async init() { if (this.identity) return; try { const state = JSON.parse(await readFile(this.statePath, 'utf8')); this.identity = state.testIdentity; this.accountId = this.identity; this.authenticated = true } catch (error) { if (error.code !== 'ENOENT') throw error } },
      async status() { await this.init(); return this.summary() },
      async profile() { await this.init(); if (!this.authenticated) throw Error('not authenticated'); return { id: this.identity, nickname: 'User ' + this.identity, avatarUrl } },
      async orders() { if (this.orderGate) await this.orderGate(); return { accountId: this.wrongOrderAccount || this.accountId, orders: [{ id: 'order-' + this.accountId }], nextCursor: null } },
      async sendCode(phone) { this.identity = phone; this.accountId = phone; return this.summary() },
      async complete() { this.authenticated = true; if (this.persistLogin !== false) await writeJsonState(this.statePath, { version: 1, storageState: { cookies: [] }, testIdentity: this.identity }); return this.summary() },
      async qrStart() { return { ...this.summary(), qr: { state: 'waiting' } } },
      async qrPoll() { return { ...this.summary(), qr: { state: 'business-unconfirmed' } } },
      async qrCancel() { return { ...this.summary(), qr: { state: 'canceled' } } },
      run(operation) { const task = this.chain.then(operation); this.chain = task.then(() => {}, () => {}); return task },
      async close() { this.closed = true },
    }
    jars.push(login); return login
  }
  let time = 1700000000000
  const advance = () => { time += 61000 }
  const pool = new AccountPool({ directory, definitions, createLogin, loginOptions: { persistLogin: true }, now: () => time })
  const add = async identity => { advance(); await pool.dispatch('sendCode', { platformId: 'taobao', phone: identity }); return pool.dispatch('complete', { platformId: 'taobao', code: 'synthetic' }) }
  return { directory, pool, jars, add, advance, async close() { await pool.close(); assert(directory.startsWith(join(tmpdir(), 'waimai-accounts-'))); await rm(directory, { recursive: true, force: true }) } }
}

test('saved accounts remain logged in together; view selection does not change the default or durable index', async () => {
  const f = await fixture()
  try {
    const first = await f.add('12345'), second = await f.add('67890')
    assert.notEqual(first.viewAccountRef, second.viewAccountRef)
    assert.equal(second.accounts.length, 2)
    const before = await readFile(f.pool.indexPath, 'utf8')
    const viewed = await f.pool.dispatch('accountView', { platformId: 'taobao', accountRef: second.viewAccountRef })
    assert.equal(viewed.authenticated, true)
    assert.equal(viewed.viewAccountRef, second.viewAccountRef)
    assert.equal(await readFile(f.pool.indexPath, 'utf8'), before)
    assert.equal((await f.pool.dispatch('status', { platformId: 'taobao' })).viewAccountRef, first.viewAccountRef)
    assert(f.jars.every(jar => jar.authenticated && !jar.closed))
    await assert.rejects(f.pool.dispatch('orders', { platformId: 'taobao' }), error => error.code === 'account-required')
    assert(!JSON.stringify(await f.pool.connections()).includes('User'))
    const reloaded = new AccountPool({ directory: f.directory, definitions, createLogin: f.pool.createLogin, loginOptions: { persistLogin: true } })
    try { assert.equal((await reloaded.dispatch('accountView', { platformId: 'taobao', accountRef: second.viewAccountRef })).authenticated, true) }
    finally { await reloaded.close() }
  } finally { await f.close() }
})

test('two account order reads run concurrently and return their own account data', async () => {
  const f = await fixture()
  try {
    const a = await f.add('12345'), b = await f.add('67890')
    let started = 0, release
    const gate = new Promise(resolve => { release = resolve })
    for (const jar of f.jars) jar.orderGate = async () => { if (++started === 2) release(); await gate }
    const [one, two] = await Promise.all([f.pool.dispatch('orders', { platformId: 'taobao', accountRef: a.viewAccountRef }), f.pool.dispatch('orders', { platformId: 'taobao', accountRef: b.viewAccountRef })])
    assert.equal(started, 2); assert.equal(one.orders[0].id, 'order-12345'); assert.equal(two.orders[0].id, 'order-67890')
    assert.notEqual(f.jars[0].statePath, f.jars[1].statePath)
    assert.notEqual(f.pool.active('taobao', a.viewAccountRef).service.selectionPath, f.pool.active('taobao', b.viewAccountRef).service.selectionPath)
  } finally { await f.close() }
})

test('unconfirmed QR and failed new-account validation preserve saved sessions and do not add an account', async () => {
  const f = await fixture()
  try {
    const original = await f.add('12345'), before = await readFile(f.pool.indexPath, 'utf8')
    await f.pool.dispatch('qrStart', { platformId: 'taobao' })
    const unconfirmed = await f.pool.dispatch('qrPoll', { platformId: 'taobao', attemptId: 'synthetic' })
    assert.equal(unconfirmed.qr.state, 'business-unconfirmed'); assert.equal(unconfirmed.accounts.length, 1)
    await f.pool.dispatch('accountCancel', { platformId: 'taobao' })
    assert.equal(await readFile(f.pool.indexPath, 'utf8'), before)
    f.advance(); await f.pool.dispatch('sendCode', { platformId: 'taobao', phone: '67890' })
    f.jars.at(-1).wrongOrderAccount = '99999'
    await assert.rejects(f.pool.dispatch('complete', { platformId: 'taobao', code: 'synthetic' }), /身份不一致/)
    assert.equal((await f.pool.dispatch('status', { platformId: 'taobao' })).viewAccountRef, original.viewAccountRef)
    assert.equal(await readFile(f.pool.indexPath, 'utf8'), before)
  } finally { await f.close() }
})

test('legacy credentials and address reference migrate once without overwriting their originals', async () => {
  const f = await fixture()
  try {
    const legacy = JSON.stringify({ version: 1, storageState: { cookies: [] }, testIdentity: '12345' })
    await writeFile(join(f.directory, 'login-state.json'), legacy)
    await writeFile(join(f.directory, 'delivery-selection.json'), '{"legacy":true}')
    const status = await f.pool.dispatch('status', { platformId: 'taobao' })
    assert.equal(status.accounts.length, 1)
    assert.equal(await readFile(join(f.directory, 'login-state.json'), 'utf8'), legacy)
    assert.equal(await readFile(join(f.pool.accountDirectory('taobao', status.viewAccountRef), 'delivery-selection.json'), 'utf8'), '{"legacy":true}')
    assert.equal((await f.pool.dispatch('status', { platformId: 'taobao' })).viewAccountRef, status.viewAccountRef)
  } finally { await f.close() }
})

test('unknown platform, foreign account reference, malformed index and changed account identity are rejected', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.pool.dispatch('status', { platformId: 'meituan' }), error => error.code === 'not-integrated')
    assert.equal(f.jars.length, 0)
    const current = await f.add('12345')
    await assert.rejects(f.pool.dispatch('accountView', { platformId: 'taobao', accountRef: '11111111-1111-4111-8111-111111111111' }), error => error.code === 'account-missing')
    f.jars[0].identity = '99999'
    await assert.rejects(f.pool.dispatch('orders', { platformId: 'taobao', accountRef: current.viewAccountRef }), error => error.code === 'account-changed')
    await writeFile(f.pool.indexPath, JSON.stringify({ version: 1, platforms: { taobao: { activeRef: '../escape', accounts: [] } } }))
    const broken = new AccountPool({ directory: f.directory, definitions })
    await assert.rejects(broken.dispatch('status', { platformId: 'taobao' }), /账号列表无法读取/)
  } finally { await f.close() }
})

test('logging in to an existing identity refreshes one slot and retains its previous credential file', async () => {
  const f = await fixture()
  try {
    const first = await f.add('12345'), old = f.pool.active('taobao', first.viewAccountRef)
    const before = await readFile(old.login.statePath, 'utf8'), fresh = await f.add('12345')
    assert.equal(fresh.accounts.length, 1)
    assert.notEqual(fresh.viewAccountRef, first.viewAccountRef)
    assert.equal(await readFile(old.login.statePath, 'utf8'), before)
    assert.equal((await f.pool.dispatch('status', { platformId: 'taobao' })).viewAccountRef, fresh.viewAccountRef)
  } finally { await f.close() }
})

test('canceling a pending account cannot bypass SMS cooldown, and capacity does not discard saved accounts', async () => {
  const f = await fixture()
  try {
    await f.pool.dispatch('sendCode', { platformId: 'taobao', phone: '12345' })
    await f.pool.dispatch('accountCancel', { platformId: 'taobao' })
    await assert.rejects(f.pool.dispatch('sendCode', { platformId: 'taobao', phone: '67890' }), /等待验证码/)
    const first = await f.add('12345')
    f.pool.maxAccounts = 1
    await assert.rejects(f.add('67890'), error => error.code === 'account-limit')
    assert.equal((await f.pool.dispatch('accountsList', { platformId: 'taobao' })).accounts.length, 1)
    assert.equal((await f.pool.dispatch('status', { platformId: 'taobao' })).viewAccountRef, first.viewAccountRef)
  } finally { await f.close() }
})

test('nonpersistent accounts coexist in memory and do not import or rewrite durable credentials', async () => {
  const f = await fixture()
  try {
    f.pool.loginOptions.persistLogin = false
    const legacy = '{"private":"retained"}'
    await writeFile(join(f.directory, 'login-state.json'), legacy)
    const a = await f.add('12345'), b = await f.add('67890')
    assert.equal(b.accounts.length, 2)
    assert.equal((await f.pool.dispatch('accountView', { platformId: 'taobao', accountRef: a.viewAccountRef })).authenticated, true)
    assert.equal(await readFile(join(f.directory, 'login-state.json'), 'utf8'), legacy)
    await assert.rejects(readFile(f.pool.indexPath), error => error.code === 'ENOENT')
  } finally { await f.close() }
})
