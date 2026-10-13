/** Follow login redirects without forwarding POST bodies or returning remote error text. */
import { loginUrl, LoginError } from './login.js'

/** @param http - owning private HTTP jar. @param url - official page or SSO URL. @param protocol - host policy. @returns successful final response. */
export async function followLoginRedirects(http, url, protocol) {
  for (let step = 0; step < 6; step++) {
    const response = await http.get(loginUrl(url, protocol), { maxRedirects: 0 })
    if (response.status() >= 300 && response.status() < 400) {
      const location = response.headers().location
      if (!location) throw new LoginError('平台登录跳转地址缺失')
      url = new URL(location, url).href; continue
    }
    if (!response.ok()) throw new LoginError('平台登录请求失败，请稍后重试')
    return response
  }
  throw new LoginError('平台登录跳转次数过多，已停止')
}
