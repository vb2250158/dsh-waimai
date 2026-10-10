# dsh-waimai

DeepSeek Harness 外卖助手插件：用本机有头 Chromium 操作饿了么 H5 完成点单，提供通用点单能力和可配置的自动化任务。

## 功能

- **通用点单**：Agent 通过 `mcp__waimai__*` 工具搜索店铺、浏览菜单、加购、提交订单。
- **自动化任务**：配置任意多个任务，每个任务有独立的触发时间、日期规则、菜单池和金额上限，到点由插件直接完成下单。
- **两级支付模式**：`manual` 只提交订单，`auto` 在上限与白名单内自动完成支付。
- **两个技能**：`waimai-order`（用户说「点外卖」触发）、`auto-order`（配置或排查自动化任务时触发）。

## 安装

```bash
# 1. 安装依赖
npm install

# 2. 确认浏览器已就绪（本机已有则跳过）
npx playwright-core install chromium

# 3. 跑测试
npm test

# 4. 安装插件（本仓库用 Git 固定提交安装，不用本地路径）
dsh plugin --profile web add --save-exact github:vb2250158/dsh-waimai#<40位提交>
```

本插件**没有构建步骤**：`lib/` 下的文件就是发布产物，`npm run check` 做语法校验。

## 配置

配置项在 DSH 的「设置 → 插件」里编辑，插件的设置卡片会显示当前生效的安全态势。

### 基础

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `deliveryAddress` | `''` | 默认配送地址（仅记录，地址仍需在页面里选择） |
| `headless` | `false` | 无头模式。**登录和支付需要可见窗口**，除非已登录且免密支付可用 |
| `persistLogin` | `true` | 登录状态持久化在 `$DSH_HOME/waimai/browser-profile` |

### 金额与支付

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `maxOrderAmount` | `35` | 单笔订单上限（元）。服务端在支付前用页面实际金额复核 |
| `dailyBudget` | `0` | 每日累计上限（元），`0` 表示不限制 |
| `paymentMode` | `auto` | `auto` 自动支付 / `manual` 仅提交 |
| `merchantWhitelist` | `[]` | 自动支付的白名单商家，留空则不限制 |
| `operationLog` | `true` | 记录支付操作日志 |

> **注意默认值**：`paymentMode` 默认为 `auto`，且白名单默认为空。也就是说，装好插件后，**上限以内的任意商家订单会被自动支付**，不需要额外确认。若希望每一笔都由你确认，请把 `paymentMode` 改为 `manual`。

### 自动化任务（`autoTasks`）

每项任务独立配置：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `id` | `''` | 任务 ID，**必须非空且唯一**，否则不会被调度 |
| `name` | `''` | 任务名，出现在通知里 |
| `enabled` | `true` | 是否启用 |
| `triggerTime` | `11:00` | 触发时间，`HH:mm` 本地时间 |
| `dateRule` | `workday` | `workday` / `weekend` / `everyday` / `custom` |
| `customDays` | 周一至周五 | `mon`…`sun`，仅 `custom` 时生效 |
| `skipDates` | `[]` | 额外跳过的日期，`YYYY-MM-DD` |
| `menuPool` | `[]` | 菜单池，每行 `店铺 \| 菜品 \| 价格` |
| `menuStrategy` | `rotate` | `rotate` 轮换 / `random` 随机 / `history` 最少最近点过 |
| `maxOrderAmount` | `35` | 该任务单笔上限，**只能收紧**全局上限 |
| `dailyBudget` | `50` | 该任务每日累计上限 |
| `paymentMode` | `auto` | 该任务的支付模式 |
| `merchantWhitelist` | `[]` | 该任务的白名单，非空时取代全局白名单 |
| `notifyOnSuccess` / `notifyOnFailure` | `true` | 是否记录通知 |

菜单池示例：

```
真功夫 | 香菇滑鸡饭 | 28
老乡鸡 | 农家小炒肉 | 32
沙县小吃 | 拌面 | 12
```

## 安全设计

### 支付参数不经模型

`request_payment` **不接受任何参数**。它自己从当前页面读取商家名和订单金额，再对照插件配置校验；模型无法指定金额、无法指定商家。这是这套护栏里唯一不依赖模型自律的部分。

### 上限只能收紧

- `submit_order` 的 `maxAmount` 参数与配置上限取**较小值**：模型传一个更大的数不会放宽限制。
- 任务级的 `maxOrderAmount` 与全局上限取较小值：任务配置也无法放宽全局限制。

### 自动支付的前置条件

`paymentMode: auto` 时，服务端在点击支付前逐条检查：

1. 能从页面读到金额（读不到就拒绝）；
2. 金额 ≤ 单笔上限；
3. 金额 ≤ 每日上限（配置为 0 时跳过）；
4. 商家在非空白名单内（白名单为空时跳过）。

任一条不通过都会拒绝并记录审计日志，**不重试**。

### 这些护栏挡不住的

说清楚边界，比宣称「绝对安全」有用：

- **护栏与被操作页面在同一层。** 金额和商家都从页面 DOM 读取，而页面内容可能被注入（店名、菜品描述、促销文案）。护栏保证「不会支付超出上限的金额给名单外的商家」，但**不能保证「这笔订单是你想要的」**。
- **免密支付本身是最大的授权。** 插件能自动扣款的前提是你在支付宝/微信里开通了小额免密。免密额度由你在那边设置，插件读不到、也管不了。
- **账号风控风险。** 自动化操作支付环节是平台风控的典型特征，可能触发验证甚至限制账号。这是使用自动化支付的固有代价。
- **H5 页面选择器会过时。** 当页面报「未找到…」时，工具失败并留下截图，需要按当前页面调整 `lib/mcp-server.js` 里的候选选择器。

## 运行期文件

都在 `$DSH_HOME/waimai/` 下：

| 路径 | 内容 |
| --- | --- |
| `browser-profile/` | Chromium 用户数据（登录状态） |
| `screenshots/` | 失败时的页面截图 |
| `order-log.jsonl` | 支付审计流水 |
| `notifications.jsonl` | 自动化任务的通知记录 |
| `automation-state.json` | 轮换索引、历史与每日消费 |
| `mcp-server.log` | MCP 服务进程日志 |

## 实现说明

### 为什么不用 `@deepseek-ai/dsh-mcp-client` 插件行

MCP 子进程由 Host 半自己启动，而不是在 `cordis.patch.yml` 里声明一个 mcp-client 行。原因是那一行**无法定位本包的服务端文件**：

- Loader 用 `new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')` 求值 `!!js`，作用域里既没有 `require` 也没有 `import.meta`，所以表达式算不出本包路径（见 `vendor/loader/src/config/utils.ts`）。
- stdio transport 把相对 `args` 交给 `spawn`，解析基准是 DSH 进程的工作目录，不是插件目录。

自己持有 spawn 之后，路径由 `import.meta.url` 得出，配置变化也能直接传给新的子进程，不必重启 DSH。

### 为什么不用 `timer.cron()`

本 Harness 的 `TimerService` 只提供 `timeout` / `interval` / `throttle` / `debounce`，没有 `cron()`。自动化任务改用每分钟一次的轮询判定触发时间，并用「任务 ID + 日期」的键保证一天只跑一次。

## 已知限制

- 未能验证真实下单链路：`lib/mcp-server.js` 的页面选择器基于常见 H5 结构编写，未在登录态的饿了么页面上实测过。首次使用可能需要按实际 DOM 调整选择器。
- 通知目前只写入 `notifications.jsonl` 与 DSH 日志，尚未接入消息端（QQ / 飞书 / 语音）。
- 配置读取 `$DSH_HOME` 定位状态目录；未设置该变量时回退到 `~/.dsh`。
- 自动化任务不补跑错过的触发（DSH 未运行时不会在启动后补单）。

## 开发

```bash
npm run check   # 语法校验（无构建步骤）
npm test        # 规则测试 + MCP 服务集成测试
```

测试覆盖：cron 渲染与日期规则、菜单池解析、轮换与历史策略、金额上限收紧、技能 frontmatter 解析、MCP 服务真实启动与工具白盒。

## 许可证

MIT
