# 0.8.20 支付配置 / Payment settings

升级前备份插件配置。全局和任务级 `merchantWhitelist` 已移除，不再限制商家；旧字段即使仍保留在配置文件中也不会执行。可删除这两个位置的旧字段，保留金额限额、账号、订单记录及其余设置。付款记录格式未改变，未知付款结果仍阻止重复扣款。

支付配置迁移到「插件 → 外卖助手 → 支付配置」。填入已安装官方支付宝 CLI 的绝对路径，保存后点击「检查连接」。连接检查仅执行 `--version`，不代表钱包授权完成，也不会发起交易。程序路径留空时使用原收银台。

Back up plugin configuration before upgrading. Global and per-task `merchantWhitelist` fields are no longer used or enforced. Remove those obsolete fields while retaining budgets, accounts, order records and other settings. The payment ledger format is unchanged; unknown outcomes still block duplicate payments.

Payment options now live under Plugins → Takeaway assistant → Payment settings. Enter the absolute path of the installed official Alipay CLI, save, then select Check connection. This executes only `--version`; it neither authorizes a wallet nor initiates a transaction. An empty executable path uses the existing cashier.
