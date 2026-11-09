import {test} from 'node:test'
import assert from 'node:assert/strict'
import {paymentIconUrl,loadPaymentIcon} from '../lib/payment-icons.js'
const url='https://i.alipayobjects.com/e/201305/example.png'
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN3sAAAAASUVORK5CYII=','base64')
test('provider artwork is restricted to public official PNG paths',()=>{
  assert.equal(paymentIconUrl(url),url)
  for(const bad of ['http://i.alipayobjects.com/a.png','https://i.alipayobjects.com.evil.test/a.png','https://user:pass@i.alipayobjects.com/a.png','https://i.alipayobjects.com/a.png?token=private','https://127.0.0.1/a.png','https://i.alipayobjects.com/a.svg','https://i.alipayobjects.com/a.png#secret']) assert.equal(paymentIconUrl(bad),null)
})
test('artwork fetch omits credentials, refuses redirects, and returns bounded PNG data',async()=>{
  const icon=await loadPaymentIcon(url,{fetcher:async(target,options)=>{assert.equal(target,url);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.headers,undefined);return new Response(bytes,{headers:{'content-type':'image/png'}})}})
  assert.equal(icon,'data:image/png;base64,'+bytes.toString('base64'))
  for(const response of [new Response('html',{headers:{'content-type':'text/html'}}),new Response(Buffer.alloc(65537),{headers:{'content-type':'image/png'}}),new Response('bad',{headers:{'content-type':'image/png'}})]) assert.equal(await loadPaymentIcon(url,{fetcher:async()=>response}),null)
  assert.equal(await loadPaymentIcon('https://evil.test/a.png',{fetcher:()=>assert.fail('must not fetch')}),null)
  assert.equal(await loadPaymentIcon(url,{fetcher:()=>{throw Error('private transport detail')}}),null)
})
