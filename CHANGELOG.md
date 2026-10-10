# Changelog

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
