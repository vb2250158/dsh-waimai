# 0.3.0 迁移

submit_order 现在要求 platformId: taobao、accountRef、shopId 和 maxAmount（元）。返回等待用户确认的实时报价卡片，不直接创建订单。旧的商家、餐品及任意金额请求须改用真实菜单与购物车工具。

request_payment 现在要求 accountRef，可选本机 orderRef；它展示官方付款入口和对应订单状态，不接收任意付款金额，也不扣款。新增 show_order、get_cart、get_item_options、change_cart、get_order_status；会话 UI 使用公开 keyed 工具结果 slot。地址和付款 URL 仅由鉴权界面读取。

dryRun 限制自动任务和未确认提交；用户在插件页面或会话卡片核对报价并明确确认后可手动创建本笔订单，无需关闭全局预览。服务端仍检查金额、报价有效期、身份、购物车版本、日预算和重复提交。未知结果不重试。

本机订单记录格式保持 version: 1。订单创建与付款完成尚未实单验收；官方付款由用户完成。

## English

submit_order requires platformId: taobao, accountRef, shopId and maxAmount in yuan. It returns a live confirmation card without placing an order. request_payment requires accountRef and an optional local orderRef; it displays the official cashier handoff and does not charge. New tools provide recommendations, cart changes, options and order status. Private addresses and payment URLs stay in authenticated UI RPC.

dryRun restricts automation and unconfirmed submissions. An explicit user confirmation may place one manual order without disabling automation preview. All budget, identity, quote expiry, cart revision and duplicate checks remain enforced. Unknown submissions are never retried. The local ledger stays at version 1. Real order creation and completed payment have not been exercised.
