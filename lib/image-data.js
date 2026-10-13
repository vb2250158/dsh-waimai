/** @param value - platform image URL. @returns a passive HTTPS CDN URL, excluding signed and credential-bearing URLs. */
export function passiveImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null
    if (!['cube.elemecdn.com', 'es.elemecdn.com', 'img.alicdn.com', 'gw.alicdn.com'].includes(url.hostname)) return null
    return url.href
  } catch { return null }
}
