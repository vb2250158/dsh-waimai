import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RetailCartActions, retailAdditionVerified } from '../lib/retail-cart-actions.js'

const addressRef = 'a'.repeat(64)
const line = (cartId, itemId, quantity) => ({ cartId, itemId, skuId: '0', quantity, checked: true, isValid: true })
const cart = lines => ({ revision: 'b'.repeat(64), display: {}, lines: lines.map(row => ({ ...row, amount: { now: row.quantity } })) })

test('reconciliation requires the exact target delta and unchanged unrelated items', () => {
  const before = [line('1', '101', 1), line('2', '102', 2)]
  const operation = { itemId: '101', quantity: 1, before }
  assert(retailAdditionVerified(operation, [line('1', '101', 2), line('2', '102', 2)]))
  assert(!retailAdditionVerified(operation, [line('1', '101', 2), line('2', '102', 3)]))
  assert(!retailAdditionVerified(operation, [line('3', '101', 2), line('2', '102', 2)]))
})

test('unknown addition blocks fresh operations after restart until exact cart readback', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const context = { accountId: '123', shopId: 'shop', nativeShopId: '9', address: { ref: addressRef } }
  const productRef = randomUUID(), before = [line('1', '101', 1), line('2', '102', 2)]
  let lines = before, writes = 0
  const retail = { products: new Map([[productRef, { context, itemId: '101', name: '水', keyword: '水' }]]),
    context: async () => context, query: async () => [{ itemId: '101', title: '水', itemStatus: 0, stockModel: { quantity: 10 },
      startWith: 1, itemCustomPropertyModelList: [] }], requestCart: async () => cart(lines), extra: () => ({}),
    service: { checkReply: () => {} }, login: { accountId: '123', requireAccount: async () => {}, protocol: { retail: { add: {} } }, mtop: async () => { writes++; throw new Error('timeout') } },
    trade: { verify: async () => {}, invalidateQuotes: () => {}, displayCart: (_context, value) => ({ revision: value.revision }) } }
  const args = { productRef, addressRef, revision: 'b'.repeat(64), operationRef: randomUUID(), quantity: 1 }
  await assert.rejects(() => new RetailCartActions(retail, directory).add(args), { code: 'cart-result-unconfirmed' })
  const restarted = new RetailCartActions(retail, directory)
  await assert.rejects(() => restarted.add({ ...args, operationRef: randomUUID() }), { code: 'cart-result-unconfirmed' })
  assert.equal(writes, 1)
  const relogged = new RetailCartActions({ ...retail, login: { ...retail.login } }, directory)
  assert.equal(relogged.paths('123').path, restarted.paths('123').path)
  assert.notEqual(relogged.paths('456').path, restarted.paths('123').path)
  await assert.rejects(() => relogged.add({ ...args, operationRef: randomUUID() }), { code: 'cart-result-unconfirmed' })
  await mkdir(restarted.paths('123').lockPath)
  await assert.rejects(() => relogged.add({ ...args, operationRef: randomUUID() }), { code: 'cart-locked' })
  assert.equal((await relogged.read(context, cart(lines))).mutation.state, 'unconfirmed')
  await rmdir(restarted.paths('123').lockPath)
  assert.equal(writes, 1)
  assert.equal((await restarted.read(context, cart(lines))).mutation.state, 'unconfirmed')
  lines = [line('1', '101', 2), line('2', '102', 3)]
  assert.equal((await restarted.read(context, cart(lines))).mutation.state, 'unconfirmed')
  lines = [line('1', '101', 2), line('2', '102', 2)]
  assert.equal((await restarted.read(context, cart(lines))).mutation.state, 'verified')
  assert.equal(JSON.parse(await readFile(restarted.paths('123').path, 'utf8')).attempts[0].state, 'verified')
  await assert.rejects(() => restarted.add(args), { code: 'cart-duplicate' })
})


test('verified history archives by strict windows and preserves sequence and idempotency', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-archive-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const owner = new RetailCartActions({}, directory), paths = owner.paths('123'), now = 1_000_000_000
  const entry = (seq, hours, state = 'verified') => ({ seq, operationRef: randomUUID(), accountId: '123', addressRef,
    shopId: 'shop', itemId: '101', quantity: 1, before: [], state, createdAt: now - hours * 3600_000 })
  const first = entry(1, 73), second = entry(2, 25), recent = entry(3, 24), pending = entry(4, 100, 'sent')
  await owner.save(paths, { version: 1, attempts: [first, second, recent, pending] })
  const history = await owner.maintain(paths, now)
  assert.deepEqual(history.archived, [first, second])
  assert.deepEqual(history.hot.attempts, [recent, pending])
  assert.deepEqual((await owner.maintain(paths, now)).archived, [first, second])
  const exactly = entry(5, 72)
  await owner.save(paths, { version: 1, attempts: [exactly] })
  await assert.rejects(owner.maintain(paths, now), { code: 'cart-journal-invalid' })
})

test('72-hour threshold is strict and sent blocks archive prefix', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-window-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const owner = new RetailCartActions({}, directory), paths = owner.paths('123'), now = 1_000_000_000
  const make = (seq, age, state = 'verified') => ({ seq, operationRef: randomUUID(), accountId: '123', addressRef,
    shopId: 'shop', itemId: '101', quantity: 1, before: [], state, createdAt: now - age * 3600_000 })
  await owner.save(paths, { version: 1, attempts: [make(1,72), make(2,25)] })
  assert.equal((await owner.maintain(paths, now)).archived.length, 0)
  await owner.save(paths, { version: 1, attempts: [make(1,73, 'sent')] })
  assert.equal((await owner.maintain(paths, now)).archived.length, 0)
})


test('archive and index interruptions recover without changing records or order', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-recover-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const owner = new RetailCartActions({}, directory), paths = owner.paths('123'), now = 1_000_000_000
  const record = { seq: 1, operationRef: randomUUID(), accountId: '123', addressRef, shopId: 'shop', itemId: '101', quantity: 1, before: [], state: 'verified', createdAt: now - 73 * 3600_000 }
  await owner.save(paths, { version: 1, attempts: [record] })
  await mkdir(paths.archive)
  await owner.guardedWrite(paths, join(paths.archive, '1-1.json'), { version: 1, attempts: [record] })
  // A completed segment without an index is adopted only if its rows match the hot prefix.
  const save = owner.save.bind(owner)
  owner.save = async () => { throw new Error('interrupted hot replace') }
  await assert.rejects(owner.maintain(paths, now), { code: 'cart-journal-invalid' })
  owner.save = save
  const recovered = await owner.maintain(paths, now)
  assert.deepEqual(recovered.archived, [record]); assert.deepEqual(recovered.hot.attempts, [])
  assert.deepEqual((await owner.maintain(paths, now)).archived, [record])
  assert.deepEqual(JSON.parse(await readFile(join(paths.archive, 'index.json'), 'utf8')).files, ['1-1.json'])
})

test('unmatched incomplete archive fails closed without shortening the hot journal', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const owner = new RetailCartActions({}, directory), paths = owner.paths('123'), now = 1_000_000_000
  const record = { seq: 1, operationRef: randomUUID(), accountId: '123', addressRef, shopId: 'shop', itemId: '101', quantity: 1, before: [], state: 'verified', createdAt: now - 73 * 3600_000 }
  await owner.save(paths, { version: 1, attempts: [record] }); await mkdir(paths.archive)
  await writeFile(join(paths.archive, '1-1.json'), '{')
  await assert.rejects(owner.maintain(paths, now), { code: 'cart-journal-invalid' })
  assert.deepEqual(JSON.parse(await readFile(paths.path, 'utf8')).attempts, [record])
})


test('archived operation identity prevents a replay in a new login session', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-dedup-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const retail = { login: { accountId: '123', requireAccount: async () => {} } }
  const owner = new RetailCartActions(retail, directory), paths = owner.paths('123'), now = Date.now()
  const record = { seq: 1, operationRef: randomUUID(), accountId: '123', addressRef, shopId: 'shop', itemId: '101', quantity: 1, before: [], state: 'verified', createdAt: now - 73 * 3600_000 }
  await owner.save(paths, { version: 1, attempts: [record] })
  await owner.maintain(paths, now)
  const nextSession = new RetailCartActions(retail, directory)
  await assert.rejects(nextSession.add({ operationRef: record.operationRef }), { code: 'cart-duplicate' })
})

test('failed archive destination never removes hot records', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-writefail-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const owner = new RetailCartActions({}, directory), paths = owner.paths('123'), now = 1_000_000_000
  const record = { seq: 1, operationRef: randomUUID(), accountId: '123', addressRef, shopId: 'shop', itemId: '101', quantity: 1, before: [], state: 'verified', createdAt: now - 73 * 3600_000 }
  await owner.save(paths, { version: 1, attempts: [record] }); await mkdir(paths.archive); await mkdir(join(paths.archive, '1-1.json'))
  await assert.rejects(owner.maintain(paths, now), { code: 'cart-journal-invalid' })
  assert.deepEqual(JSON.parse(await readFile(paths.path, 'utf8')).attempts, [record])
})


test('missing or truncated hot journal after archive fails closed and preserves evidence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-integrity-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const owner = new RetailCartActions({}, directory), paths = owner.paths('123'), now = 1_000_000_000
  const record = (seq, state, age) => ({ seq, operationRef: randomUUID(), accountId: '123', addressRef, shopId: 'shop', itemId: '101', quantity: 1, before: [], state, createdAt: now - age * 3600_000 })
  await owner.save(paths, { version: 1, attempts: [record(1, 'verified', 73), record(2, 'sent', 1)] })
  await owner.maintain(paths, now)
  await writeFile(paths.path, JSON.stringify({ version: 1, attempts: [] }))
  const bytes = await readFile(paths.path)
  await assert.rejects(owner.maintain(paths, now), { code: 'cart-journal-invalid' })
  assert((await readFile(paths.path)).equals(bytes))
  await rm(paths.path)
  await assert.rejects(owner.maintain(paths, now), { code: 'cart-journal-invalid' })
})

test('malformed overlap and duplicate IDs never change hot or index bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-badorder-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const owner = new RetailCartActions({}, directory), paths = owner.paths('123'), now = 1_000_000_000
  const entry = seq => ({ seq, operationRef: randomUUID(), accountId: '123', addressRef, shopId: 'shop', itemId: '101', quantity: 1, before: [], state: 'verified', createdAt: now - 73 * 3600_000 })
  const one = entry(1), two = entry(2), three = entry(3), four = entry(4)
  await owner.save(paths, { version: 1, attempts: [one, two] }); await owner.maintain(paths, now)
  await owner.save(paths, { version: 1, attempts: [three, one, two, four] })
  const hot = await readFile(paths.path), index = await readFile(join(paths.archive, 'index.json'))
  await assert.rejects(owner.maintain(paths, now), { code: 'cart-journal-invalid' })
  assert((await readFile(paths.path)).equals(hot)); assert((await readFile(join(paths.archive, 'index.json'))).equals(index))
})


test('interrupted hot-file transition accepts either fully committed version', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-transition-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const owner = new RetailCartActions({}, directory), paths = owner.paths('123'), now = Date.now()
  const record = { seq: 1, operationRef: randomUUID(), accountId: '123', addressRef, shopId: 'shop', itemId: '101', quantity: 1, before: [], state: 'sent', createdAt: now }
  const old = { version: 1, attempts: [] }, next = { version: 1, attempts: [record] }
  await owner.save(paths, old)
  const current = await owner.generation(paths), nextGeneration = { ...current, hot: owner.digest(next) }
  await writeFile(paths.path + '.integrity', JSON.stringify({ version: 2, current, next: nextGeneration }))
  assert.deepEqual(await owner.readJournal(paths), old)
  await writeFile(paths.path, JSON.stringify(next))
  assert.deepEqual(await owner.readJournal(paths), next)
  await owner.save(paths, next)
  assert.deepEqual(await owner.readJournal(paths), next)
})

test('duplicate archived identity is rejected before writing evidence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-dupid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const owner = new RetailCartActions({}, directory), paths = owner.paths('123'), now = 1_000_000_000
  const record = { seq: 1, operationRef: randomUUID(), accountId: '123', addressRef, shopId: 'shop', itemId: '101', quantity: 1, before: [], state: 'verified', createdAt: now - 73 * 3600_000 }
  await owner.save(paths, { version: 1, attempts: [record] }); await owner.maintain(paths, now)
  await owner.save(paths, { version: 1, attempts: [{ ...record, seq: 2 }] })
  const hot = await readFile(paths.path), index = await readFile(join(paths.archive, 'index.json'))
  await assert.rejects(owner.maintain(paths, now), { code: 'cart-journal-invalid' })
  assert((await readFile(paths.path)).equals(hot)); assert((await readFile(join(paths.archive, 'index.json'))).equals(index))
})


test('changed archived identity and missing archive generation fail closed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-anchor-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const owner = new RetailCartActions({}, directory), paths = owner.paths('123'), now = 1_000_000_000
  const record = { seq: 1, operationRef: randomUUID(), accountId: '123', addressRef, shopId: 'shop', itemId: '101', quantity: 1, before: [], state: 'verified', createdAt: now - 73 * 3600_000 }
  await owner.save(paths, { version: 1, attempts: [record] }); await owner.maintain(paths, now)
  const file = join(paths.archive, '1-1.json'), original = await readFile(file)
  await writeFile(file, JSON.stringify({ version: 1, attempts: [{ ...record, operationRef: randomUUID() }] }))
  const changed = await readFile(file)
  await assert.rejects(owner.maintain(paths, now), { code: 'cart-journal-invalid' })
  assert((await readFile(file)).equals(changed))
  await writeFile(file, original)
  await rm(file); await rm(join(paths.archive, 'index.json'))
  await assert.rejects(owner.maintain(paths, now), { code: 'cart-journal-invalid' })
})


test('archive and index generation transitions recover on either side of each write', async t => {
  for (const stage of ['segment-before', 'segment-after', 'index-before', 'index-after']) {
    const directory = await mkdtemp(join(tmpdir(), 'waimai-retail-gen-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const owner = new RetailCartActions({}, directory), paths = owner.paths('123'), now = 1_000_000_000
    const record = { seq: 1, operationRef: randomUUID(), accountId: '123', addressRef, shopId: 'shop', itemId: '101', quantity: 1, before: [], state: 'verified', createdAt: now - 73 * 3600_000 }
    const segment = { version: 1, attempts: [record] }, index = { version: 1, files: ['1-1.json'] }
    await owner.save(paths, segment); await mkdir(paths.archive)
    if (stage.startsWith('index')) await owner.guardedWrite(paths, join(paths.archive, '1-1.json'), segment)
    const current = await owner.generation(paths), next = structuredClone(current)
    if (stage.startsWith('segment')) next.files.push({ name: '1-1.json', hash: owner.digest(segment) })
    else next.index = owner.digest(index)
    await writeFile(paths.path + '.integrity', JSON.stringify({ version: 2, current, next }))
    if (stage === 'segment-after') await writeFile(join(paths.archive, '1-1.json'), JSON.stringify(segment))
    if (stage === 'index-after') await writeFile(join(paths.archive, 'index.json'), JSON.stringify(index))
    const recovered = await owner.maintain(paths, now)
    assert.deepEqual(recovered.archived, [record], stage); assert.deepEqual(recovered.hot.attempts, [], stage)
  }
})
