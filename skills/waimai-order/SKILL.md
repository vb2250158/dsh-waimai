---
name: waimai-order
description: 使用外卖工具查询店铺和菜单、展示会话点餐卡片、选规格加购、获取用户确认报价并核对订单与付款状态。
whenToUse: 用户希望点外卖、推荐餐品、下单或查看订单付款状态时
---

# 会话点餐

先调用 list_platforms、get_status，使用用户指定平台；未指定时使用配置默认平台。淘宝闪购和盒马支持 Agent 购物车、报价及用户确认下单卡片；自动任务购买、自动扣款、美团和京东尚未接入。createOrder 能力表示自动创建，不能据此声称会话确认下单不可用；查看 manualOrderingAvailable 和 orderingAvailable。

list_connections 返回已保存的账号引用。每次账号工具明确传 accountRef；多个账号不能猜测。同一账号须 prepare_ordering 复核登录及所选配送地址。缺登录或地址时引导「插件 → dsh-waimai → 账号与地址」；不索取手机号、验证码、地址文本或 Cookie 到聊天。

search_shops 用 scope: nearby 分页查询附近推荐，recent 查询最近一页订单店铺；keyword 仅筛选当前页。无匹配而 nextCursor 非空时，保持账号、范围和关键词不变，用该游标继续查询；游标过期从第一页重新开始。分页不是全平台搜索，不把首批空结果解释为附近没有店铺。

购买商超商品时，先分页发现店铺，再用 search_products 的 keyword 和真实 shopIds 查询最多十家已选店铺。结果明确限定 selected-stores-only，价格为标价；complete:false 表示部分店铺读取失败。menuState:empty/unavailable 和 notice 是平台状态，不是菜单解析失败或全平台缺货。整箱水必须核对商品名称和实际 SKU 的每瓶容量、瓶数和包装，不能把一瓶、组合购买或模糊规格当成一箱；无法证实规格时不加购。比较最低到手价须核对可售候选的实时报价和运费，未查询的店铺不得排除。

get_menu 使用返回的稳定 shopId，读取当前菜品、标价和库存。标价不是结算实付。推荐完成后调用 show_order，传真实 itemIds 和用户预算 maxAmount，让用户直接在会话卡片选规格、加购和结算，不要求跳到插件页完成点餐。

用户明确要求加购时，先 get_cart 获取 revision。多规格商品先 get_item_options，根据用户选择使用 selectionRef、variantRef、choiceRefs、quantity；缺选择时用卡片让用户操作，不猜测必选口味。change_cart 的 step: 1 加指定 itemId，step: -1 减指定 lineRef；不清空或替换已有购物车。操作结果不明时 get_cart 核对，不重试修改。复杂组合套餐或不支持的配料规则停止并显示原因。

用户要求下单时，submit_order 传 accountRef、shopId、maxAmount（元），读取真实结算实付并展示确认卡片；预算只会收紧配置单笔上限。工具调用本身不创建订单或扣款。用户在会话中核对餐品、地址、配送时间、优惠和实付，勾选确认后点击创建；全局自动任务预览无需关闭。preview_checkout 可只读获取当前购物车报价，金额字段单位为分；有效报价不能当作已下单。

创建成功后用 request_payment 展示本机订单对应的官方付款入口，用户在官方收银台完成付款。付款 URL 由私人鉴权界面读取，不进入模型。get_order_status 用 accountRef 和可选 orderRef 查询本机记录及对应官方状态；HTTP 200、支付入口或本机 paymentStatus: unconfirmed 不能声称已付款。订单结果未知时先核对官方订单，保留尝试与预算占用，不重复提交。平台要求额外验证时由用户在官方窗口完成。

盒马使用 get_menu 的 keyword 搜索商品，get_product_details 核对 productRef 对应的规格；用户可在会话弹窗选择 SKU 与整数数量加购。Agent 先 get_cart(platformId: hema) 读取 revision，再 add_product_to_cart 传 productRef、skuId、quantity、revision 和固定 operationRef。未知结果只 get_cart 回读；同一操作不重新分配 operationRef，不重试修改。保留其他商品和勾选状态，称重及跨平台商品的加购方式未确认时停止。

盒马结算调用 submit_order，明确传 platformId: hema、accountRef、lineIds 和 maxAmount（元）；lineIds 来自当前 get_cart 返回的指定商品 id，不默认购买全部购物车。每种商品暂限数量为 1，结算选中不改变官方购物车勾选。真实报价包含平台优惠、基础及超重运费，会员权益以本次报价为准，不保证所有权益已经接入。卡片重新核对地址、SKU、数量和金额，确认后单次创建订单；付款在盒马 App 完成。真实创建及付款仍待实单验收，按官方订单状态报告结果。
