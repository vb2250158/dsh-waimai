import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {AlipaySessionStore} from '../lib/alipay-session-store.js'
import {AlipaySignIn} from '../lib/alipay-sign-in.js'

test('Windows encrypted login survives a new owner and shutdown, but explicit logout removes it', async()=>{
 const directory=await mkdtemp(join(tmpdir(),'waimai-encrypted-test-'))
 const path=join(directory,'alipay-session.dpapi')
 const authentication={storageState:{cookies:[{name:'synthetic-session',value:'synthetic-secret-not-a-real-cookie',domain:'.alipay.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]},environment:{device:{userAgent:'synthetic-test-agent'}}}
 let probes=0, disposed=0
 const createRequest=async options=>({get:async url=>{probes++;return {status:()=>200,headers:()=>({'content-type':url.includes('/asset/bindQuery.json')?'application/json':'text/html'}),body:async()=>Buffer.from(JSON.stringify({stat:'ok',results:[]})),dispose:async()=>{}}},storageState:async()=>options.storageState,dispose:async()=>{disposed++}})
 try {
  await new AlipaySessionStore(path).save(authentication)
  assert(!(await readFile(path)).includes(Buffer.from('synthetic-secret')))
  const first=new AlipaySignIn({channel:'msedge',timeoutMs:1000,store:new AlipaySessionStore(path),createRequest})
  assert.equal((await first.status()).state,'signed-in');assert.equal(probes,2)
  await first.close();assert.equal(disposed,1)
  const second=new AlipaySignIn({channel:'msedge',timeoutMs:1000,store:new AlipaySessionStore(path),createRequest})
  assert.equal((await second.status()).state,'signed-in');assert.equal(probes,4)
  await second.forget();assert.equal(await new AlipaySessionStore(path).load(),null)
  assert.equal((await second.status()).state,'signed-out')
 } finally {await rm(directory,{recursive:true,force:true})}
})

test('a persisted session rejected by the provider never reports signed-in', async()=>{
 const authentication={storageState:{cookies:[],origins:[]},environment:{device:{userAgent:'synthetic'}}}
 const client=new AlipaySignIn({channel:'msedge',timeoutMs:1000,store:{load:async()=>authentication,save:async()=>assert.fail('unverified save')},createRequest:async()=>({get:async()=>({status:()=>302,headers:()=>({location:'https://auth.alipay.com/login/index.htm'}),dispose:async()=>{}}),dispose:async()=>{}})})
 assert.equal((await client.status()).state,'signed-out');assert.equal(client.authentication,null);await client.close()
})
