import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PaymentPreference } from '../lib/payment-preference.js'

test('payment preference survives a new owner, stays encrypted and isolated, and fails closed on corruption', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-preference-test-'))
  const path = join(directory, 'account-a', 'preference.dpapi')
  const value = { selectedChannel: 'synthetic-private-card', childChannel: '', label: '测试卡（尾号 1234）' }
  try {
    const store = new PaymentPreference(path)
    assert.equal(await store.load(), null)
    await store.save(value)
    assert(!(await readFile(path)).includes(Buffer.from(value.selectedChannel)))
    assert.deepEqual(await new PaymentPreference(path).load(), value)
    assert.equal(await new PaymentPreference(join(directory, 'account-b', 'preference.dpapi')).load(), null)
    await writeFile(path, 'invalid synthetic ciphertext')
    await assert.rejects(store.load(), { code: 'payment-preference-invalid' })
    await store.clear()
    assert.equal(await store.load(), null)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('preselected balance preference survives an encrypted store reload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-preset-'))
  const path = join(directory, 'preference.dpapi')
  try {
    const value = { fundingType: 'yuebao', label: '余额宝' }
    await new PaymentPreference(path).save(value)
    assert.deepEqual(await new PaymentPreference(path).load(), value)
    assert(!(await readFile(path)).includes(Buffer.from('yuebao')))
    await assert.rejects(new PaymentPreference(path).save({ fundingType: 'balance', label: '余额宝' }))
  } finally { await rm(directory, { recursive: true, force: true }) }
})


test('a specific bank binding survives encrypted reload without exposing its identifier', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'waimai-bank-preference-'))
  const path = join(directory, 'preference.dpapi')
  const value = { kind: 'bank-binding', bankCode: 'TEST', bankName: '测试银行', lastFour: '1234', cardType: 'DC', bindingId: 'synthetic-private-binding', label: '测试银行（尾号 1234） · 储蓄卡' }
  try {
    await new PaymentPreference(path).save(value)
    assert.deepEqual(await new PaymentPreference(path).load(), value)
    assert(!(await readFile(path)).includes(Buffer.from(value.bindingId)))
    await assert.rejects(new PaymentPreference(path).save({ ...value, lastFour: '12345678' }))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
