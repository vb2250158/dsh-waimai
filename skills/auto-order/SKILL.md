---
name: auto-order
description: 配置或解释外卖自动化任务（按时间自动点单）。当用户说「设置自动点外卖」「每天中午自动订饭」「创建自动化任务」「定时点餐」，或需要排查某个自动化任务为什么没执行时触发。
whenToUse: 用户配置、修改、排查外卖自动化任务时
---

# 外卖自动化任务

插件支持任意多个自动化任务，每个任务独立配置触发时间、日期规则、菜单池和金额。定时由插件 Host 半自己驱动，不经过对话。

## 任务配置字段

在插件的设置页里维护 `autoTasks` 数组，每项：

| 字段 | 含义 |
| --- | --- |
| `id` | 任务 ID，必须唯一且非空，否则该任务不会被调度 |
| `name` | 任务名称，通知里会带上 |
| `enabled` | 是否启用 |
| `triggerTime` | 触发时间，`HH:mm` 本地时间 |
| `dateRule` | `workday` 工作日 / `weekend` 周末 / `everyday` 每天 / `custom` 自定义 |
| `customDays` | `mon`…`sun`，仅 `dateRule=custom` 时生效 |
| `skipDates` | 额外跳过的日期，`YYYY-MM-DD` |
| `menuPool` | 菜单池，每行 `店铺 \| 菜品 \| 价格` |
| `menuStrategy` | `rotate` 轮换 / `random` 随机 / `history` 按最少最近点过 |
| `maxOrderAmount` | 该任务单笔上限（元） |
| `dailyBudget` | 该任务每日累计上限（元） |
| `paymentMode` | `auto` 自动支付 / `manual` 只提交不支付 |
| `merchantWhitelist` | 商家白名单，留空不限制 |
| `notifyOnSuccess` / `notifyOnFailure` | 成功 / 失败时是否记录通知 |

## 配置任务时的流程

1. 问清场景：任务名、时间、哪些天、预算、想吃的范围。
2. 把用户口述的菜单整理成 `店铺 | 菜品 | 价格` 每行一条，价格必须是数字。
3. 让用户确认白名单和支付模式。**用户没说「自动支付」时，建议用 `manual`**。
4. 把最终配置写进设置页的 `autoTasks`；同一个任务要改，就改原有条目的字段，不要新建重复条目。
   新任务先保持 `enabled: false`，保持全局 `dryRun: true`；调用 `mcp__waimai__preview_task`，传入 `taskId`，核对计划结果。`mcp__waimai__get_status` 可检查浏览器是否已安装，不打开浏览器。
5. 复述一遍生效规则（如「周一至周五 11:00，单笔不超过 35 元，午餐池 4 项轮换」），让用户确认。
   用户确认真实执行后再启用任务并关闭 `dryRun`。未明确授权自动支付时使用 `manual`。

## 执行时的行为

任务到点时由插件 Host 半直接按顺序调用 MCP 工具完成：搜索店铺 → 进店 → 按开关领免费券 → 读菜单 → 加购 → 看购物车 → 结算选券并重读金额 → 按配置支付。这条链路不经过模型，因此不会消耗对话额度，也不受上下文影响。

全局 `autoClaimCoupons`、`autoUseCoupons` 默认勾上，可分别关闭。预览不操作券；会员券、付费券包、积分兑换不领取。结算只选页面可选且折扣可读的券，按实际金额检查预算，无券正常继续。

任一环节失败都会停止，**不重试**，并按 `notifyOnFailure` 记录一条通知。

## 排查「任务没执行」

按顺序核对：

1. `enabled` 是否为 true。
2. `id` 是否非空——空 ID 的任务会被跳过。
3. `triggerTime` 是否正好是当前分钟（轮询每分钟一次，只在该分钟内触发）。
4. 今天是否被 `dateRule` 或 `skipDates` 排除。
5. `menuPool` 是否能解析出条目——格式必须是 `店铺 | 菜品 | 价格`，价格可转数字。
6. 今日已消费加上本单是否超过 `dailyBudget`。
7. DSH 进程在这些时间是否一直运行——插件不补跑错过的任务。
8. 查通知记录 `$DSH_HOME/waimai/notifications.jsonl` 与日志 `$DSH_HOME/waimai/mcp-server.log`。

## 安全护栏

- 只有 `paymentMode: auto` 且服务端校验（金额上限、白名单、每日预算）全部通过时才会自动扣款；校验值由服务端从页面读取，不接受调用方传入。
- `paymentMode: manual` 下任务只提交订单，支付留给用户。
- 支付失败或状态未确认时立即记录通知，**不自动重试**。
- 白名单非空时，不在名单内的商家一律拒绝支付。
- 单笔上限取「任务上限」与「插件全局上限」中较小者，任务配置无法放宽全局限制。
