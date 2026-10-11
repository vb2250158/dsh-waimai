# 0.2.0 升级说明

本版移除未验收的 H5 模拟点餐，改为按平台标记能力的 HTTP 服务。淘宝闪购的登录、账号资料、配送地址和历史订单可用；菜单请求可能要求人工验证，结算、创建订单、支付和优惠券接口尚未验证，保持禁用。美团与京东只是平台入口，尚未接入。

## 工具迁移

移除 `open_browser`、`search_food`、`enter_shop`、`add_to_cart`、`view_cart`、`claim_coupons`、`apply_coupons` 和 `get_order_status`。新入口为 `list_platforms`、`prepare_ordering`、`search_shops` 和 `preview_checkout`。`search_shops` 只搜索最近一页历史订单中的店铺，不代表平台全量搜索。`get_menu` 必须传平台稳定 `shopId`，只检查捕获的菜单协议，未验证商品规格时返回不可用。旧工具调用不会自动映射或启动浏览器。

`submit_order` 保留名称，但购买能力未验证时拒绝；预览模式同样拒绝。`request_payment` 继续无参数且禁止扣款。账号、订单、手机号和配送地址仅通过登录鉴权的插件页 RPC 读取，不作为模型工具返回。

## 配置与数据

新增 `defaultPlatform` 和任务 `platformId`，可选 `taobao`、`meituan`、`jd`，旧配置默认 `taobao`。原 `browserChannel`、`headless`、`deliveryAddress` 继续接受但不再影响行为，并从 UI 隐藏；计划在 0.3.0 移除。旧优惠券、支付模式和操作日志字段保留，当前没有购买请求，不能据此开启支付。

`menuPool` 继续接受名称和参考价格，仅用于预览；参考价格不能充当接口实付金额。旧启用状态不会被改写。`dryRun: true` 的定时任务只预览，关闭预览的任务在触发时记录接口未验证并停止，不下单、不扣款、不推进轮换。

HTTP Cookie 沿用本机 `login-state.json`，不需要仅因本次升级重新登录。必须在账号与地址页重新从平台地址列表选择配送地址；旧文本备注不会自动选中地址。`delivery-selection.json` 仅保存平台、账号和不透明地址引用，切换账号后重新选择。既有浏览器目录、截图、支付记录和通知保留原处；插件不读取旧浏览器配置来点餐，也不会清理预算占用。

## 后续接入条件

平台验证由用户在官方窗口完成。只有同一账号的真实菜单规格、结算金额、提交结果与支付结果完成独立验证后，才开放对应能力。不能因 HTTP 200 或只收到菜单响应而声明下单成功。跨平台比价须等至少两个平台有真实菜单与结算能力。
