# Changelog

## 0.8.10

- Include fixed failure-message hints in diagnostics without retaining remote text or changing retry rules.

## 0.8.9

- Keep unknown creation attempts queryable without requiring a cashier order ID.
- Reconcile payment only for created attempts and preserve unknown outcomes when no official order matches.
- Retain bounded numeric platform error codes without remote messages or credentials.

## 0.8.8

- Add account-scoped official cashier consultation, explicitly authorized one-shot payment initiation and payment status tools.
- Persist payment attempts before submission; reject changed totals, duplicate attempts and automatic retries after unknown outcomes.
- Keep verification links in authenticated UI only and show paid, verification-required, unknown and failed states in conversation cards.
- Reconcile supermarket payment timestamps independently of cancellation status; live payment acceptance remains pending.
- Report restaurant items that cannot be ordered alone with an actionable error.

## 0.8.7

- Require a selected delivery time for reservation-only supermarket checkout; explicit earliest delivery selection reprices through the platform.
- Send the native checkout components and delivery writeback used by the official client.
- Preserve bounded platform failure codes without response text or credentials.
- Permit one explicitly authorized retry after official reconciliation, retaining the original unknown attempt and budget reservation.

## 0.8.6

- Resolve the selected delivery address through the platform's Eleme-to-Taobao address link for merchant delivery.
- Accept fixed-price checkout responses whose unused coupon component has no fields; preserve the server's final payable amount.
- Reject missing or ambiguous address links and quotes returning a different linked address before creating an order.

## 0.8.5

- Add native supermarket search, single-SKU cart additions and checkout through Agent tools.
- Allow explicitly authorized quote confirmation through the shared order ledger.
- Resolve current pending supermarket payment links through the private payment card.


## 0.8.4 — 2026-10-26

- 淘宝闪购结算与提交补齐同一淘宝渠道请求头，修复已爆涨红包在通用网页渠道下少算优惠；只读实测 ¥11 红包、实付 ¥48.20，与官方 App 一致。
- 增加真实 HTTP 请求入口的渠道回归验证。定位了官方爆红包接口及其服务端触发参数；本版本尚不触发新的爆涨，不使用付费会员兑换替代。

## 0.8.3 — 2026-10-26

- 淘宝闪购结算与下单回包接入同一报价引用的脱敏诊断，区分网络失败、平台返回和报价核验失败；未知提交继续保留记录并阻止重发。
- 补充结算失败及提交回包含敏感字段时的回归验证。

## 0.8.2 — 2026-10-21

- 按官方 Checkbox 的布尔回调接入购物车选择、闪购确认、盒马确认和重试核对，修复点击后整个插件配置界面消失。
- 标签由 Checkbox 组件自身提供，移除嵌套标签；界面测试使用与真实组件一致的布尔交互。

## 0.8.1 — 2026-10-21

- 本次结算不再默认包含手机已勾选但数量不支持的商品，避免无法取消选中而阻塞其他商品结算；官方购物车保持原样。
- 结算选择明确标注「本次结算」，与「手机已勾选」状态分开显示。

## 0.8.0 — 2026-10-21

- 盒马结算接入原生配送时间选择与重新计价；唯一可用选项自动核验，多个选项在插件和会话确认卡片中选择，变更后重新确认实付。
- 未知下单结果保留原记录。用户在官方客户端确认没有原订单后，可明确授权同账号、地址、商品和不高于原金额的一次重试；禁止重复使用和连续重试。
- 增加配送、重试及结构化错误码回归；错误日志不保留远端说明和支付链接。真实配送及费用已验证，订单创建和支付尚未验收通过。

## 0.7.1 — 2026-10-21

- 盒马返回相同配送门店 ID 的顺序变化时，结算与提交不再误报地址变化；实际门店集合变化仍会停止提交。
- 下单诊断保留含负号、小数点及大小写字母的结构化业务错误码；远端消息、凭据和支付链接仍不进入日志。

## 0.7.0 — 2026-10-21

- 盒马通过真实地址判店接口获取配送位置，接入购物车预检查和正式实付报价，核对商品、优惠、基础运费、超重运费及完整地址。
- 购物车支持选择本次结算商品，插件与 Agent 会话共用报价确认卡片；结算选择不修改官方购物车勾选，每种商品暂限数量 1。
- 接入单次确认创建订单、共享预算占用、防重复和未知结果保留；真实报价已验证，真实下单及官方客户端付款待验收。

## 0.6.2 — 2026-10-13

- 盒马购物车弹窗在内部滚动商品，较多商品时仍保留标题和关闭入口。

## 0.6.1 — 2026-10-13

- 盒马规格读取与加购重新核验当前搜索页和门店售卖状态；有 SKU 库存但已进入非售卖时段时禁止加购。

## 0.6.0 — 2026-10-13

- 盒马规格加购接入插件页、Agent 工具与聊天卡片，提供规格和数量选择、等待反馈及悬浮购物车弹窗。
- 加购前保存账号、地址和完整购物车快照；原生请求仅发送一次，按目标 SKU 数量及其他商品回读核对。未知结果和重载只回读，阻止重复加购。
- 购物车价格与结算实付分开显示；盒马结算、会员优惠和支付接入仍待完成。

## 0.5.1 — 2026-10-13

- Agent 会话增加盒马商品规格卡片，展示包装、最低数量、数量步长、库存和计价单位；未确认价格不显示为零价。
- 会话中的盒马商品可打开规格弹窗；刷新绑定工具记录中的账号，并核验当前地址。账号不符或刷新失败时清除旧规格，不执行加购或购买。

## 0.5.0 — 2026-10-13

- 盒马增加并默认选择手机号短信的淘宝授权入口；本人资料和订单复核通过后才保存账号，注册和额外验证时停止。手机号、验证码与短信令牌不持久化。
- 盒马凭据写入第二版，账号索引增加 `taobao-sms`；读取原扫码记录，已有凭据更新前备份、写后校验，失败恢复。回滚需恢复升级前本机数据。
- 平台登录方式元数据缺失时显示错误和重试入口，避免安装期间界面因新旧版本混用而变成空白。

## 0.4.3 — 2026-10-13

- 平台分别声明登录方式与默认入口；盒马 App 扫码与淘宝授权明确区分，尚未接通的方式不会偷偷启动淘宝扫码。复用账号按需选择，加载状态增加文字。
- 淘宝扫码账号读取同一登录会话的本人头像，核对原始昵称、头像来源和前后身份；头像不可用时显示首字与刷新提示。
- 通过 ADB 核对盒马 8.9.0 安装包的登录协议；当前桌面 H5 扫码请求返回 `FAIL_SYS_UNAUTHORIZED_ENTRANCE`，原生扫码和短信未开放。

## 0.4.2 — 2026-10-13

- 淘宝扫码账号显示淘宝昵称，账号选择器移除编号，昵称为空时显示未命名账号；读取前后核验淘宝和闪购身份。
- QR accounts display the Taobao nickname, selectors omit account IDs, and absent nicknames use the unnamed-account label. Profile reads verify both identities.

## 0.4.1 — 2026-10-13

- 店铺分页查询沿用插件配置的默认平台；商品查询仍明确限定淘宝闪购，不把盒马默认设置改为淘宝。
- Merchant pagination preserves the configured default platform; the product query tool remains explicitly Taobao-only.

## 0.4.0 — 2026-10-13

- Agent 店铺查询增加账号和地址绑定的匿名分页游标；新增指定店铺商品名称查询与会话卡片，保留整箱规格原文、标价、可售状态和读取失败信息。
- 正确展示平台明确返回的空店/不可用提示，不再把商超「暂无可售商品」报成菜单解析失败。空结果限定当前店铺和查询页，不能解释为全平台缺货或最低价。
- Agent browsing adds opaque merchant pagination and product-name queries within selected stores, with actionable conversation cards and explicit listed-price scope. Empty-store notices and failed reads remain distinct.

## 0.3.3 — 2026-10-13

- 修复平台可选配料额度为 0 时整个餐品无法读取规格的问题；保留基础规格和口味，零额度配料禁选，矛盾默认项或必选规则继续阻止加购。
- Optional ingredient groups with a zero allowance no longer reject the whole item. Base variants remain available, zero-allowance extras remain disabled, and contradictory defaults still block cart changes.

## 0.3.2 — 2026-10-13

- 会话菜单卡片按商品身份去重，避免平台多个分类重复列出同一餐品。
- Conversation menu cards deduplicate dishes by their stable item identity.

## 0.3.1 — 2026-10-13

- 菜单和点餐准备结果统一报告用户确认下单可用、自动购买不可用，避免旧能力标记误导 Agent。
- Menu and ordering preparation report interactive ordering separately from automated purchasing.

## 0.3.0 — 2026-10-13

- Agent 会话新增店铺、菜单、推荐餐品、购物车、报价确认和付款工具卡片；用户在会话中选规格、加购、结算并确认下单。
- 新增购物车、规格、推荐展示和订单状态工具；submit_order 改为真实报价确认卡片，request_payment 改为官方支付入口卡片。
- 手动确认下单无需关闭自动任务预览；服务端继续限制单笔、每日及本次预算，检查报价有效期、身份和购物车版本，防止重复提交。付款仍由用户在官方收银台完成。
- 增加下单脱敏阶段日志及会话卡片回放、私有确认与预算测试；未执行真实订单创建或扣款。
- Agent chat now provides actionable recommendation, cart, quote and payment cards. Manual confirmation can place an order during automation preview; payment stays in the official cashier. Public tool schemas changed; see MIGRATION-0.3.0.md.

## 0.2.20 — 2026-10-12

- 加购立即显示等待状态并防重复点击；回读确认目标 SKU、口味、配料和数量后才显示成功反馈。失败显示原因与刷新入口，新增脱敏加购日志。
- 多规格商品在弹框中选择份量、口味、必选配料和数量，显示配料加价、默认选项、售罄和互斥选项；加购前复核价格、库存与选择。
- 购物车改为右下角悬浮入口，显示数量与金额；点击弹框查看商品及规格、减一件、刷新和结算。复用官方 Modal、Toast 和主题令牌。
- 实测两款多规格商品成功加购并恢复原购物车；组合套餐及未确认的配料数量规则仍停止加购。

## 0.2.19 — 2026-10-12

- 插件列表名称与描述支持中文、英文，随 DSH 语言设置切换。
- Plugin list names and descriptions follow the DSH Chinese or English language setting.

## 0.2.18

- 打开扫码入口自动生成二维码，手机确认后自动复核闪购或盒马授权；取消手动检查按钮，显示扫码、手机确认、完成登录三步进度，隐藏扫码期间误导性的「尚未检查登录状态」。
- 临时请求失败自动重试；手机确认后使用独立的复核时限，`qrAuthorizationSeconds` 默认 60 秒。超时、淘宝会话未建立或额外验证分别显示原因，停止尝试并保留原账号。
- 脱敏扫码日志输出到启动器捕获的 `web-host.stderr.log`；新增自动复核页面快照、取消、授权超时和日志输出验证。

## 0.2.17

- 插件页面扫码新增脱敏阶段日志：记录二维码状态、业务初始化、Mtop 返回码、UCC 授权类型、账号资料与订单核验，以及失败或取消。日志按临时扫码引用关联，写入现有 Host 日志。
- `loginDiagnostics` 默认开启，可通过插件配置关闭。日志仅保留固定协议字段和类型，不记录远端说明、URL、二维码内容、Token、Cookie、账号 ID、手机号、资料或订单。
- 新增脱敏与成功、未授权流程的测试；实际扫码失败原因仍需运行日志确认。

## 0.2.16

- 闪购新增 HTTP 购物车：单规格商品加购、指定商品减一件和刷新，与官方客户端同步；不清空其他商品。复杂规格可在官方客户端加购后读取结算。
- 新结算协议使用当前淘宝小程序渠道、独立闪购买家身份和固定结算主机，真实取得 ¥31.50 报价；测试商品已逐件移除，购物车恢复。
- 插件页展示实付、优惠、费用、配送地址和时间、报价有效期；关闭预览并明确确认后才创建订单，成功显示订单号和官方支付入口，不执行扣款。
- 提交前持久化金额并获取共享锁，检查账号、地址、购物车、单笔和每日上限；不重试财务请求，未知结果和重复购物车停止提交。本机记录可在重新加载后查看。
- 125 项测试覆盖报价展示、身份与规格验证、防重复、未知结果、预算和支付链接；真实创建订单及支付仍待用户确认验收。模型提交和自动购买继续禁用，盒马购买未开放。调用迁移见 `MIGRATION-0.2.16.md`。

## 0.2.15

- 修复部分闪购菜单整体报错：售罄或折叠菜品使用数字店铺 ID 时，通过店铺详情确认其与当前加密店铺 ID 的对应关系，再显示菜单；不放宽其他店铺商品校验。
- 菜单解析核对嵌套分类，历史购买记录不参与店铺别名确认；读取结束再次复核账号和配送地址。店铺资料异常或人工验证时停止，不用旧资料补结果。
- 已实测闪购购物车加购、读回和移除并恢复测试前状态；结算仍返回平台业务错误，未取得有效结算单，下单及支付保持禁用。

## 0.2.14

- 修正规格价格：接口标记价格转换或未明确标记原始价格时，不把数字字段显示为标价，返回空价格并提示暂无法确认；规格与库存仍可查询。
- 购物车使用平台显示单价和计价单位，不把整行促销金额当作单价。无法识别的价格明确报错。

## 0.2.13

- 商品、规格和购物车图片兼容盒马返回的 `//` 和 HTTP 图片 CDN 地址，统一转成 HTTPS；仍拒绝带凭据、非默认端口、跟踪查询和外部主机的地址。
- 购物车价格独立成行，避免与商品标题挤在一起。

## 0.2.12

- 盒马商品搜索支持下一页和返回首批，配置每页数量；分页失败保留已读结果，账号、地址、门店或搜索词变化后拒绝旧引用。平台分页令牌仅保留在后端。
- 新增商品规格、当前标价、库存、最低数量和数量步长，通过原生门店及商品 ID 复核；提供只读 `get_product_details` 工具。
- 页面新增只读购物车，通过新版接口按配送地址显示商品数量、价格单位、勾选状态和不可售原因；拒绝不完整层级，不把旧接口空返回当成空购物车。不修改商品或勾选状态。
- 已用真实账号验证两批 57 件商品无重复、规格及 40 条购物车记录；购物车修改、结算、下单与支付仍未开放。

## 0.2.11

- 修正盒马复用扫码会话时的身份比较：独立复核淘宝账号 ID，不把闪购 Eleme 站点的 Havana ID 当作淘宝账号 ID；复核前后身份变化仍停止登录。
- 盒马页面统一显示商品、搜索结果和配送门店文案，避免沿用闪购菜品分类。

## 0.2.10

- 新增盒马独立平台账号、头像、本人资料、配送地址、可配送门店与历史订单分页，通过 HTTP 调用官方业务接口。
- 盒马支持淘宝扫码，以及明确选择已登录淘宝扫码账号进行盒马会话复核；凭据按平台隔离，不改变闪购账号和地址。盒马短信登录、注册与绑定不开放。
- 门店商品按名称搜索，显示首批商品、图片、分转元后的标价及单位、库存状态；账号或门店归属不一致时停止展示。购物车、创建订单和支付仍不可用。
- 盒马完整订单号使用无损 JSON 解析，订单时间按中国时区解析，数量保留单位；不同平台的历史分页参数不互用。

## 0.2.9

- 浏览器记住上次选择的平台及各平台账号，刷新、关闭重开插件或切换平台后恢复对应账号；只保存平台与账号引用。
- 恢复前复核账号，已移除的账号回到可用默认账号；验证失败不会擅自改查其他账号。页面选择不改变模型工具、任务默认账号或其他已打开窗口。
- 浏览器阻止保存时保留当前选择并显示提示，损坏或旧版本偏好回到默认视图。

## 0.2.8

- 保存设置后，页面查询等待已排队的接口重连完成，避免返回点餐时读取旧配置或提示登录服务不可用；账号会话保持保留。

## 0.2.7

- 点单设置增加「隐藏推广店铺」开关，默认开启；关闭并保存后，推广店铺正常显示且保留广告标签，普通店铺不会误标。
- HTTP 页面读取、模型工具和任务使用同一设置，广告过滤不改变分页位置。

## 0.2.6

- 修正附近店铺广告误判：仅依据明确的 `isAd` 标记，字符串 `"false"`、空对象和普通附加信息不再触发广告标签。
- 过滤真实推广店铺，翻页位置保留原始页偏移；整页推广被过滤时显示对应空状态，并保留下一页入口。

## 0.2.5

- 点餐页直接选择或更改账号配送地址，未设置有效地址时不查询任何店铺；更换后清空旧店铺和菜单。
- 接入附近店铺 HTTP 推荐与分页，展示图片、评分、月售、距离、配送时间和起送价，支持本页筛选及最近订单店铺入口。
- 菜单响应解析为分类、菜品图片、标价、售罄状态及只读口味选项，支持菜品搜索；菜单成功不再显示未验证错误。购买接口仍禁用。
- 私人分页位置与账号、地址绑定；屏蔽菜单中的购物车动作、重购记录与跟踪字段，丢弃地址更换后的迟到结果。
- `search_shops` 默认范围改为附近推荐；原调用可传 `scope: "recent"`。新增 `browsePageSize` 设置，迁移说明见 `MIGRATION-0.2.5.md`。

## 0.2.4

- 重新编排页面：平台与账号集中在顶部，账号选项标明登录方式；页签共用账号选择，进入任务与设置再返回不会丢失当前账号。
- 已登录时收起登录表单，添加账号默认淘宝扫码；短信登录提示订单可能对应另一账号。账号资料与当前配送地址优先显示，其余地址按需展开。
- 历史订单突出商家、状态、时间、餐品与金额，折叠订单号；普通刷新失败保留最后校验数据，账号不一致仍清除资料。
- 任务按平台显示，未开放的购买设置折叠，简化技术文案；优化窄屏布局、标准加载反馈与主题配色，保留原账号会话和配置保存流程。

## 0.2.3

- 打通淘宝扫码后的闪购 HTTP 登录交换，使用官方 UCC 获取业务会话；独立复核本地 ID、Havana ID、资料和订单后才加入账号列表。
- Mtop 签名按请求域名选择 Cookie，防止淘宝授权请求使用闪购令牌。授权 Cookie 仅接受已验证站点和域名，失败保留原账号及原凭据。
- 支持淘宝账号资料中手机号为空，昵称和头像正常显示。真实账号已读取当日订单，与原短信账号同时保存；创建订单和支付继续禁用。

## 0.2.2

- 平台与账号下拉分别选择当前页面的资料、地址、订单和店铺列表；其他账号保持登录，其他窗口不受影响。
- 增加本机多账号索引、独立凭据与配送地址目录，迁移旧记录时保留原文件。新登录必须独立复核，失败、取消或扫码授权未确认时不加入列表。
- 不同账号可并行读取；账号工具使用 `accountRef`，多个账号时省略引用会明确拒绝。新增仅返回账号引用的 `list_connections`。
- 同一平台的短信等待不因取消添加而重置；账号数上限可配置。说明实际扫码停在闪购授权未确认，未宣布近期订单已恢复。

## 0.2.1

- 插件账号页新增淘宝 HTTP 扫码入口，显示二维码、等待扫码、手机确认、过期、取消及闪购授权未确认状态；切换页签停止轮询。
- 每次扫码使用独立 Cookie jar，闪购账号、资料及订单复核通过后才替换当前会话，并备份原登录记录。淘宝扫码成功不等于闪购授权成功；未确认时保留原账号。
- 扫码接口仅走鉴权的私有 RPC，不注册为模型工具。二维码生成与初始状态已在真实 HTTP 验证，手机确认后的业务会话和近期订单需实际扫码验收。

## 0.2.0

- 新增平台注册表与能力标记，UI 分为账号与地址、点餐、历史订单、任务、设置；淘宝闪购可登录，美团和京东明确显示尚未接入。
- 通过只读 HTTP 获取配送地址和最近点过的店铺，地址选择与账号绑定，本机只保存引用。切换账号或平台后移除旧显示，旧地址不能继续使用。
- 淘宝闪购菜单接口改用捕获的 Mtop HTTP POST，遇到人工验证立即停止。商品规格、结算、创建订单及支付尚未验证，购买能力保持禁用。
- 移除 Chromium DOM 点餐、加购、领券及支付工具，不再回退到 H5。自动任务只支持预览，非预览执行报告接口未验证并停止。
- 工具与配置迁移见 [0.2.0 升级说明](MIGRATION-0.2.0.md)。保留旧配置和本机运行记录，不转换或清除既有 Cookie、订单或预算占用。

## 0.1.8

- 登录区显示用户头像、昵称、账号 ID 和脱敏手机号；头像加载失败显示昵称首字。
- 通过只读 HTTP 接口获取历史订单，显示商家、商品数量、金额、时间和状态，支持刷新、下一页和返回最新订单；新增 `historyPageSize` 设置。
- 每次读取复核业务会话并校验账号，分页与响应字段严格校验。账号资料与订单不持久化、不记录到日志、不注册为模型工具。
- 增加字段投影、账号一致性、分页、HTTP/RPC 校验及实际 React 设置页渲染测试。

## 0.1.7

- 补充平台真实登录返回的 `pass.eleme.hk` 和 `tb.eleme.hk` Cookie 同步域名，继续拒绝其他域名及非 HTTPS 跳转。
- 登录复核改用点餐 H5 的业务会话接口，同时确认本地账号与 Havana 账号；Mtop 令牌缺失或过期只刷新一次。
- 保存与浏览器复用时移除登录页的记住用户名 Cookie。真实短信登录、业务会话复核及 Cookie 重载已验收。

## 0.1.6

- 修复登录 HTTP 路由挂载，沿用 Host 的浏览器鉴权；请求体限额、请求类型与方法匹配在转发前校验。
- 增加真实 HTTP 传输测试，覆盖未授权、错误内容类型、无效参数及响应禁止缓存。

## 0.1.5

- 设置页增加手机号、短信验证码和登录状态，通过饿了么当前登录接口执行；初始化参数通过 HTTP 获取，不打开 H5 浏览器窗口。
- 获取验证码需要页面点击，不自动重发；额外验证、注册确认和结果未确认分别显示，HTTP 200 不视为登录成功。
- 登录 Cookie 保存在本机，手机号、验证码和短信令牌只在进程内持有。登录接口不注册到模型工具列表；登录状态经过独立接口复核后才保存。
- 点餐浏览器复用接口登录的 Cookie；`persistLogin: false` 改用临时浏览器和内存登录态，不再忽略该设置。插件重载会终止未完成的短信登录。
- 增加 HTTP 登录、域名与重定向限制、错误脱敏、短信重发间隔、非持久化及设置 RPC 校验测试。真实短信登录另需账号验收。

## 0.1.4

- 设置页复用 DSH 主题控件，优惠券、预算、任务和高级设置分组；任务卡片支持折叠。
- 增加未保存、保存中、保存失败和撤销反馈；时间使用 24 小时文本输入，避免系统弹层。
- 插件图标统一为 24 像素线条图标，与其他插件使用相同画布、留白和线宽。

## 0.1.3

- 外卖设置归入 `dsh-waimai` 详情页，优惠券勾选项可直接编辑并保存。
- 新增任务编辑表单，支持时间、日期、菜单池、金额上限和支付方式；新增任务默认禁用并使用手动支付。
- 设置保存经过 Host 版本校验和回读，保存失败会在页面提示。

## 0.1.2

- 新增「自动领取免费优惠券」「自动使用可用优惠券」勾选项，默认开启，可分别关闭。
- 修复插件配置表单缺失，设置可保存并实时作用于 MCP 服务，运行中的定时任务完成后再切换配置。
- 进店尝试领取免费券，结算选择页面可选券中折扣最大的券；不购买券包或会员，不兑换积分。预览模式不操作优惠券。
- 用券后重读页面实付金额，再检查单笔及每日预算；无券时正常继续，领取未确认不重试。
- 新增优惠券开关、MCP 预览和真实浏览器测试页面回归；真实账号券页仍需验收。

## 0.1.1

- 默认预览、手动支付，新任务默认禁用；新增状态检查和任务预览工具。
- 修复 MCP SDK 调用参数，任务执行前原子保存防重复标记；损坏状态不再静默清零。
- 支付点击前持久保存预算占用，按全局和任务累计每日金额；未确认扣款仍保留占用。同一订单编号不重复支付，白名单改为完全匹配。
- 默认使用本机 Chrome，可配置 Edge 或 Playwright Chromium。
- 升级后先预览并核对设置，再显式关闭预览；真实平台登录和下单仍需验收。
- 新增 MCP 调用、预览阻断、无效任务、持久化和支付预算回归测试。

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
