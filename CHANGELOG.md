# Changelog

## 0.1.1

- 默认预览、手动支付，新任务默认禁用；新增状态检查和任务预览工具。
- 修复 MCP SDK 调用参数，任务执行前原子保存防重复标记；损坏状态不再静默清零。
- 支付点击前持久保存预算占用，按全局和任务累计每日金额；未确认扣款仍保留占用。同一订单编号不重复支付，白名单改为完全匹配。
- 默认使用本机 Chrome，可配置 Edge 或 Playwright Chromium。
- 升级后先预览并核对设置，再显式关闭预览；真实平台登录和下单仍需验收。
- 新增 MCP 调用、预览阻断、无效任务、持久化和支付预算回归测试。

## 0.1.0

首个版本。

### 通用点单

- 外卖 MCP 服务（stdio），工具命名空间 `mcp__waimai__*`：`open_browser`、`search_food`、`enter_shop`、`get_menu`、`add_to_cart`、`view_cart`、`submit_order`、`request_payment`、`get_order_status`。
- 使用本机有头 Chromium 与持久化用户目录，登录状态保留在 `$DSH_HOME/waimai/browser-profile`。
- `request_payment` 无参数：金额与商家由服务端从页面读取后校验，调用方无法指定。
- `submit_order` 的上限参数只允许收紧，不允许放宽配置上限。

### 自动化任务

- `autoTasks` 支持任意多个任务，各自配置触发时间、日期规则、菜单池、金额上限与支付模式。
- 每分钟轮询判定触发，用「任务 ID + 日期」去重，保证一天一次。
- 菜单池支持轮换、随机、最少最近点过三种策略。
- 任一校验不通过或步骤失败即停止并记录通知，不重试。

### 技能

- `waimai-order`：交互式点单流程与安全护栏。
- `auto-order`：自动化任务的配置指引与排查清单。

### 实现取舍

- MCP 子进程由 Host 半持有，而非 `@deepseek-ai/dsh-mcp-client` 插件行：Loader 的 `!!js` 求值环境没有 `require` 或 `import.meta`，相对 `args` 又按 DSH 进程工作目录解析，插件行无法定位本包的服务端文件。
- 定时使用 `ctx.timer.interval` 轮询：本 Harness 的 `TimerService` 不提供 `cron()`。
- 无构建步骤：`lib/` 即发布产物。
