/** Public provider artwork only; no account cookies or caller headers are forwarded. */
const cache = new Map()
const hosts = new Set(['i.alipayobjects.com', 'gw.alipayobjects.com', 'os.alipayobjects.com', 't.alipayobjects.com'])

/** Accept public PNG assets on the observed official CDN; queries and redirects are not trusted. */
export function paymentIconUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && hosts.has(url.hostname) && !url.username && !url.password && !url.port
      && !url.search && !url.hash && /^\/[a-zA-Z0-9_./-]+\.png$/.test(url.pathname) ? url.href : null
  } catch { return null }
}

/** Download bounded inert PNG bytes without credentials; any failure preserves the generic icon. */
export async function loadPaymentIcon(value, { fetcher = fetch } = {}) {
  const url = paymentIconUrl(value)
  if (!url) return null
  if (fetcher === fetch && cache.has(url)) return cache.get(url)
  const pending = (async () => {
    try {
      const response = await fetcher(url, { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(4000) })
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) { await response.body?.cancel(); return null }
      const parts = []; let size = 0
      for await (const part of response.body) {
        size += part.length
        if (size > 65536) return null
        parts.push(Buffer.from(part))
      }
      const bytes = Buffer.concat(parts)
      if (bytes.length < 33 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a'
        || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 512
        || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 512) return null
      return 'data:image/png;base64,' + bytes.toString('base64')
    } catch { return null }
  })()
  if (fetcher === fetch) {
    if (cache.size >= 128) cache.delete(cache.keys().next().value)
    cache.set(url, pending)
    void pending.then(result => { if (!result && cache.get(url) === pending) cache.delete(url) })
  }
  return pending
}
