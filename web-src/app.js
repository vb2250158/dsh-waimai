/** Standalone shell for the same account, cart and payment views used inside DSH. */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Input, Switch, Menu, Checkbox, Tag, StateDot, Modal, Toast, IconPlusOutlineRegular,
  IconChevronDownOutlineRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import './theme.css'

const h = React.createElement
let shared
window.__ModuleLoader__ = { load(definition) {
  shared = definition.factory(name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button, Input, Switch, Menu, Checkbox, Tag, StateDot, Modal, Toast,
      IconPlusOutlineRegular, IconChevronDownOutlineRegular, IconTrashOutlineRegular }
    throw new Error('Unsupported UI dependency')
  }).ui
} }
await import('../lib/client/index.js')
delete window.__ModuleLoader__
const style = document.createElement('style')
style.textContent = shared.styles
document.head.append(style)
const text = {
  zh: { title: '外卖助手', subtitle: '账号、点餐与订单', signIn: '连接本机服务', token: '管理令牌', connect: '连接',
    authHint: '填写本机 Host 令牌文件中的值；令牌只用于本次登录', failure: '读取失败，请检查服务后重试',
    denied: '连接未完成，请核对管理令牌', retry: '重试', cap: '单笔上限', budget: '每日上限', unlimited: '未设上限',
    preview: '自动任务预览', live: '允许确认购买', verification: '付款验证仍以平台结果为准', logout: '退出管理页面' },
  en: { title: 'Takeaway', subtitle: 'Accounts, food and orders', signIn: 'Connect to local service', token: 'Management token', connect: 'Connect',
    authHint: 'Enter the value from the local Host token file. It is used only for sign-in.', failure: 'Unable to read the service. Check it and retry.',
    denied: 'Unable to connect. Check the management token.', retry: 'Retry', cap: 'Order cap', budget: 'Daily cap', unlimited: 'Unlimited',
    preview: 'Scheduled task preview', live: 'Confirmed purchases enabled', verification: 'Payment requires confirmation from the platform', logout: 'Sign out of management' },
}
const language = navigator.language.startsWith('zh') ? 'zh' : 'en'
const copy = text[language], t = key => shared.dictionaries[language][key] || key
const rpc = { async call(_channel, method, payload) {
  const response = await fetch(new URL('rpc', location.href), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rpcId: crypto.randomUUID(), method, payload }), signal: AbortSignal.timeout(120000) })
  if (response.status === 401) throw Object.assign(new Error('Authentication required'), { authenticationRequired: true })
  if (!response.ok) throw new Error('Service response unavailable')
  return (await response.json()).result
} }

function App() {
  const [status, setStatus] = React.useState(null), [authentication, setAuthentication] = React.useState(false)
  const [error, setError] = React.useState(''), [revision, setRevision] = React.useState(0)
  React.useEffect(() => {
    let active = true
    setError('')
    rpc.call('', 'serviceStatus', {}).then(reply => {
      if (!active) return
      if (!reply.ok) { setError(copy.failure); return }
      setStatus(reply.value); setAuthentication(false)
    }).catch(error => { if (active) { setAuthentication(error.authenticationRequired === true); setError(error.authenticationRequired ? '' : copy.failure) } })
    return () => { active = false }
  }, [revision])
  return h('main', { className: 'waimai-app' },
    h('header', { className: 'waimai-app-heading' }, h('div', null, h('p', { className: 'eyebrow' }, copy.subtitle), h('h1', null, copy.title)),
      status ? h('span', { className: 'mode' }, status.dryRun ? copy.preview : copy.live) : null),
    error ? h('div', { className: 'notice', role: 'alert' }, error, !authentication ? h(Button, { onClick: () => setRevision(value => value + 1) }, copy.retry) : null) : null,
    status ? h(React.Fragment, null,
        h('section', { className: 'limits', 'aria-label': copy.cap }, h('span', null, `${copy.cap} ¥${status.maxOrderAmount}`),
          h('span', null, `${copy.budget} ${status.dailyBudget ? '¥' + status.dailyBudget : copy.unlimited}`), h('span', null, copy.verification)),
        h(shared.PlatformCard, { rpc, t, serviceOwned: true, defaultPlatform: status.platformId, maxOrderAmount: status.maxOrderAmount }))
      : !error ? h(StateDot, { state: 'ongoing', size: 20 }) : null)
}
createRoot(document.getElementById('app')).render(h(App))
