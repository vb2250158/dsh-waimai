# 0.8.32 支付配置迁移 / Payment settings migration

支付宝支付密码改为本机外卖插件通用配置，不再以购物账号记录为键。未登录购物账号也可保存；购物账号和订单的付款授权、归属及预算检查保持不变，尚未支持的渠道不会因此获得支付能力。

私有 `paymentCredential` RPC 只接受 `{ operation: 'status' | 'remove' }` 或 `{ operation: 'save', password }`。移除 `platformId` 和 `accountRef`，旧参数会被拒绝；更新后请刷新已打开的插件页面。其他订单与 H5 验证接口仍要求所属账号和订单引用。

首次读取时，仅在本插件旧支付记录具有同一个有效密码值时自动迁移。旧记录冲突或损坏时返回 `migrationRequired: true`，由用户明确设置通用密码。原有私有记录保留作为升级留底；明确删除会先写入无密码的禁用记录，再清理旧记录。禁用记录防止旧密码被迁移恢复，不能按“空配置”删除。旧版本不理解通用配置，不支持降级后继续付款。

Alipay uses one local plugin payment credential independent of shopping accounts. Shopping sign-in is not required to configure it. Payment authorization, order ownership and spending checks remain unchanged; unsupported channels do not gain payment support.

The private `paymentCredential` RPC accepts only `{ operation: 'status' | 'remove' }` or `{ operation: 'save', password }`. Remove `platformId` and `accountRef`; old payloads are rejected. Refresh open plugin pages after upgrading. Order and H5 verification RPCs still require their account and order references.

The first read migrates legacy records only when they contain one distinct valid password. Conflicting or damaged records return `migrationRequired: true` for an explicit shared setting. Legacy private records remain for upgrade recovery. Removal first persists a password-free disabled record, then clears legacy records. Keep that disabled record to prevent migration from restoring a removed password. Older versions do not understand the shared configuration and must not be used for payment after downgrade.
