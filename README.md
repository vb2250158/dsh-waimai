# dsh-waimai

DeepSeek Harness 多平台外卖插件。淘宝闪购通过 HTTP 完成短信登录、账号资料、配送地址和历史订单读取，点餐工具不再模拟 H5。当前尚未开放创建订单和支付；美团、京东尚未接入。

## 插件页面

选择平台后使用五个页签：账号与地址、点餐、历史订单、任务、设置。淘宝闪购沿用 ele.me 的业务接口域名，页面使用淘宝闪购品牌。

- **账号与地址**：输入手机号与短信验证码登录；显示头像、昵称、账号 ID、脱敏手机号。读取平台真实地址并点击「使用此地址」。地址选择与当前账号绑定，刷新后确认保存；不存在或失效的地址不能选择。
- **点餐**：查看最近一页历史订单中的店铺并检查菜单接口。搜索范围不是平台全量商家。接口要求人工验证时停止；商品规格与购买协议未验证时，创建订单和支付按钮禁用。
- **历史订单**：显示店铺、菜品数量、金额、时间与状态，支持下一页和返回最新记录；每次翻页替换当前列表。
- **任务**：设置平台、时间、日期、参考菜单与预算。新任务暂停，预览不购买；关闭预览的任务报告接口未验证并停止。
- **设置**：默认平台、预览模式、金额上限、本机登录持久化和历史分页条数。页面通过 Host 表单的版本检查保存修改，保留未编辑字段。

未接入平台显示明确空状态，不读取淘宝账号或发送登录请求。切换平台后销毁当前账号视图并丢弃迟到的请求。每个平台当前支持一个本机连接；尚无多账号管理或跨平台比价。

## 当前能力

| 平台 | 登录/账号 | 地址/历史 | 最近店铺/菜单探测 | 结算/创建订单/支付 |
| --- | --- | --- | --- | --- |
| 淘宝闪购 | HTTP 可用 | HTTP 可用 | 最近订单店铺；菜单可能需人工验证 | 尚未验证，禁用 |
| 美团外卖 | 尚未接入 | 尚未接入 | 尚未接入 | 禁用 |
| 京东外卖 | 尚未接入 | 尚未接入 | 尚未接入 | 禁用 |

接口字段来自 2026-10-11 的真实账号只读抓包与客户端代码。登录初始化读取 `/mini_login.htm` 中的 JSON，再调用 `/newlogin/sms/send.do` 与 `/newlogin/sms/login.do`，每次发送前获取新 CSRF。登录返回经过 HTTPS 域名限制的 Cookie 同步地址，再通过 `mtop.alsc.user.session.ele.check` 独立确认账号。账号资料、地址和订单每次读取均复核会话与账号。

菜单使用捕获的 `mtop.alsc.waimai.store.miniapp.store.detail.body.query.v2` HTTP POST。平台验证不自动解决，商品规格、结算与提交参数未确认时不猜测请求。不会执行创建订单、取消订单、购买券包或扣款。

## 安装与开发

```bash
npm install
npm run check
npm test
dsh plugin --profile web add --save-exact github:vb2250158/dsh-waimai#<40位提交>
```

插件没有构建步骤，`lib/` 就是发布产物。普通登录与账号读取无需安装或打开 Chromium；人工平台验证由用户在官方窗口完成。MCP 子进程由 Host 使用包内绝对路径启动，配置变更后重启该子进程。

## 工具

模型工具：`list_platforms`、`get_status`、`prepare_ordering`、`search_shops`、`get_menu`、`preview_checkout`、`submit_order`、`request_payment` 和 Host 的 `preview_task`。前三个返回能力与脱敏运行状态。`search_shops` 只筛选最近一页订单店铺；`get_menu` 要求稳定店铺 ID 和插件页已选地址。购买工具在能力未验证时返回结构化错误，不发起购买请求。

短信、账号、地址和历史订单仅在鉴权的 `/waimai-login` RPC 可用，对应 MCP 内部端点不注册给模型。手机号、验证码、Cookie、地址及订单摘要不会写入插件配置或共享清单。异常消息不返回网络 URL 或令牌。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `defaultPlatform` | `taobao` | 默认平台，另可选 `meituan`、`jd` |
| `dryRun` | `true` | 预览模式；关闭后购买仍受能力限制 |
| `persistLogin` | `true` | 本机 Cookie 持久化；关闭则仅当前子进程有效 |
| `loginTimeoutMs` | `20000` | 请求超时毫秒，1000–120000 |
| `smsResendSeconds` | `60` | 验证码发送间隔秒，60–600；结果不明也占用间隔 |
| `historyPageSize` | `10` | 每页订单条数，整数 1–20 |
| `maxOrderAmount` | `35` | 单笔金额上限，元；任务只能收紧 |
| `dailyBudget` | `0` | 全局每日上限，元；0 表示无限制 |
| `autoTasks` | `[]` | 任务列表，当前只支持预览 |

任务包含唯一非空 `id`、`name`、`platformId`、`enabled`、`triggerTime`（本地 `HH:mm`）、`dateRule`（`workday/weekend/everyday/custom`）、`customDays`、`skipDates`、`menuPool`（每行 `店铺 | 菜品 | 参考价格`）、`menuStrategy`（`rotate/random/history`）、金额限制和通知选项。每分钟轮询，仅触发指定分钟，不补跑错过的任务。同一任务每天只触发一次，先保存触发记录再执行预览或失败通知。

旧浏览器、支付和优惠券字段保留加载兼容，当前不执行相应操作。升级已有调用与任务前阅读 [0.2.0 升级说明](MIGRATION-0.2.0.md)。

## 本机数据

文件均位于 `$DSH_HOME/waimai/`，未设置时使用 `~/.dsh/waimai/`。`login-state.json` 含登录凭据，只能本机保存。`delivery-selection.json` 仅保存平台、账号和地址引用；每次使用重读平台地址。账号资料、订单分页与地址文本只保留在当前进程和页面内。手机号、验证码和短信令牌不持久化，子进程重载后需重新获取未完成登录的验证码。

`automation-state.json` 保存触发和预览历史，`notifications.jsonl` 记录任务通知，`mcp-server.log` 为进程日志。既有 `browser-profile/`、截图、支付流水及 `payment-state.json` 保留原处，不会清理未确认的预算占用，也不被用于点餐。含账号数据的运行目录、截图和抓包文件不可随环境同步或发布。

## 验证范围

测试覆盖平台能力隔离、账号与地址一致性、地址保存和重载、异常停止、菜单签名与 POST、预算收紧、任务去重、RPC 鉴权、实际 React 页面和 MCP 进程。真实账号已验证头像、资料、地址及历史订单的 HTTP 读取；菜单风控与创建订单链路需要独立验收，测试通过不代表真实购买已可用。

MIT
