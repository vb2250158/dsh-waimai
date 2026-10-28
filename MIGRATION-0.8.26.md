# 0.8.26 payment migration

English | 中文

The payment ledger gains optional `h5Submitted`. Version 0.8.25 rejects this field instead of silently losing a payment attempt. Keep the current ledger when rolling back executable code. After any new financial request, never restore an older ledger, remove this field, or delete an attempt: those actions can permit a duplicate charge. Reconcile the original order first and retain a reader that understands the current ledger.

付款账本新增可选字段 `h5Submitted`。0.8.25 会拒绝含此字段的记录。回退程序时必须保留当前账本；产生新付款请求后，不得恢复旧快照、删字段或删尝试记录，否则可能重复扣款。先核对原订单，并使用能读取当前账本的版本。

H5 authentication remains in memory and is not restored after a process restart. Reconnect through the payment card when the original order still permits payment; submitted or unknown attempts remain blocked. Passwords are accepted only for one private request, never as saved settings.

H5 登录会话仅保留在内存，进程重建后需要在付款卡片重新连接。已提交或结果未知的付款记录继续阻止重复请求。支付密码只用于一次私有请求，不作为配置保存。
