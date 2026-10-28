# 0.8.27 payment credentials

Payment passwords can now be saved through the authenticated payment settings page. The Host requires the public `credentials` service. Each grant belongs to `dsh-waimai/alipay-<accountRef>` and records the verified Taobao identity; a changed identity cannot reuse its password. Password updates take effect on the next H5 payment without a process restart. Removing a password does not cancel an order, revoke Alipay login or erase payment attempts.

支付设置现在可以保存支付宝支付密码，Host 需要公开的 `credentials` 服务。凭据按淘宝账号引用和已核实身份绑定；身份变化不能使用旧密码。密码更新在下一次 H5 付款生效，无需重启。删除密码不会取消订单、退出支付宝或删除付款记录。

The default DSH local provider uses a private credential file, not OS-backed encryption. Processes running as the same OS user can access that file. Ordinary plugin configuration and model-visible tools never contain the password. Never publish or copy credential files into the plugin repository. Alipay sign-in and provider-required verification are still necessary; this release does not establish successful live payment acceptance.

DSH 默认本机凭据提供方使用私有文件，不提供操作系统加密；同一系统用户的进程仍可访问。普通插件配置和模型工具不包含密码，不得将凭据文件发布或复制进插件仓库。首次登录与支付宝要求的验证仍需完成，本版本不表示真实支付已验收。

Older plugin versions ignore these credential records. Remove unwanted passwords through the 0.8.27 payment settings before downgrading. Keep the latest payment ledger and the restrictions in [0.8.26](MIGRATION-0.8.26.md); do not restore older financial records.

旧版插件不会使用这些凭据。降级前可在 0.8.27 支付设置删除不再需要的密码；保留最新付款账本并遵循 0.8.26 的限制，不得恢复旧的财务记录。
