import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StandaloneWallet, walletView, walletReceipt } from '../lib/standalone-wallet.js'

test('only explicit official authorization is accepted, never login or pending success', () => {
  assert.equal(walletView({code:200,status:'applied_unbound'}).state,'pending')
  for (const value of [{code:200}, {success:true}, {loggedIn:true}, {code:200,message:'未开通'}]) assert.notEqual(walletView(value).state,'authorized')
  assert.equal(walletReceipt('diagnostic\n{"code":200}').code,200)
  assert.equal(walletReceipt('{"code":200}\nextra'),null)
})
test('saved payment policy survives a new service instance and blocks revoked authorization or excess amount', async () => {
  const directory=await mkdtemp(join(tmpdir(),'wallet-policy-'))
  let authorized=false
  const calls=[]
  const run=async args=>{ calls.push(args); return authorized ? {code:200,message:'已开启支付宝支付功能'} : {code:500,message:'未开通'} }
  const options={directory,executable:process.execPath,capCents:5000,run}
  try {
    const wallet=new StandaloneWallet(options)
    await assert.rejects(wallet.requireReady(4089))
    await assert.rejects(wallet.configure({operation:'save',maxAmountCents:5000}))
    authorized=true
    await assert.rejects(wallet.requireReady(4089))
    assert.equal((await wallet.configure({operation:'save',maxAmountCents:4500})).ready,true)
    const persisted=JSON.parse(await readFile(join(directory,'payment-settings.json'),'utf8'))
    assert.deepEqual(persisted,{version:1,provider:'alipay-wallet',maxAmountCents:4500})
    const restarted=new StandaloneWallet(options)
    await restarted.requireReady(4089)
    await assert.rejects(restarted.requireReady(4501))
    await assert.rejects(restarted.configure({operation:'save',maxAmountCents:5001}))
    authorized=false
    await assert.rejects(restarted.requireReady(4089))
    assert(calls.every(args=>args[0]==='check-wallet'))
  } finally {await rm(directory,{recursive:true,force:true})}
})
test('authorization destinations are restricted and bind code never becomes saved policy', async () => {
 const directory=await mkdtemp(join(tmpdir(),'wallet-auth-'))
 try {
   const wallet=new StandaloneWallet({directory,executable:process.execPath,capCents:5000,run:async args=>args[0]==='apply-wallet'?{accessUrl:'https://example.com/'}:{code:200,message:'已开启支付宝支付功能',token:'synthetic'}})
   await assert.rejects(wallet.configure({operation:'start'}))
   assert.deepEqual(await wallet.configure({operation:'bind',code:'synthetic-code'}),{state:'authorized'})
   assert.equal(await wallet.saved(),null)
 } finally {await rm(directory,{recursive:true,force:true})}
})

test('H5 configuration persists without requiring an unrelated official wallet authorization', async () => {
 const directory=await mkdtemp(join(tmpdir(),'h5-policy-'))
 const options={directory,executable:process.execPath,capCents:5000,run:async()=>assert.fail('H5 must not call wallet CLI')}
 try {
  const wallet=new StandaloneWallet(options)
  const saved=await wallet.configure({operation:'save',provider:'alipay-h5',maxAmountCents:4000})
  assert.equal(saved.provider,'alipay-h5');assert.equal(saved.state,'h5-configured')
  assert.equal(saved.ready,false);assert.equal(saved.policyReady,true)
  assert.equal((await new StandaloneWallet(options).requireReady(3900)).provider,'alipay-h5')
  await assert.rejects(wallet.requireReady(4001))
 } finally {await rm(directory,{recursive:true,force:true})}
})
