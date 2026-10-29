/**
 * Account data uses authenticated RPC; configuration writes use the Host form's revision fence.
 */

window.__ModuleLoader__.load({
  id: 'dsh-waimai',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, Switch, Menu, Checkbox, Tag, StateDot, Modal, Toast, IconPlusOutlineRegular,
      IconChevronDownOutlineRegular, IconTrashOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** Locale namespace owned by this card. */
    const LOCALE_NS = 'settings.waimai'
    /** Host plugin entry id; also the settings namespace holding the configuration. */
    const HOST_NS = 'waimai'
    const VIEW_KEY = 'dsh-waimai.view.v1'

    /** Existing payment attempts can resume only their original, privately retained verification destination. */
    function canOpenPayment(record) {
      if (!record.paymentUrl || ['unknown', 'paid', 'failed'].includes(record.paymentStatus)) return false
      return record.paymentStatus !== 'requires-verification' || record.paymentHandoffAvailable === true
    }

    /** Keep payment outcome notices separate from instructions for orders with no payment attempt. */
    function paymentNoticeKey(record) {
      if (record.paymentStatus !== 'paid' && record.providerErrorCode === 'PAYMENT_LINK_UNSUPPORTED') {
        return canOpenPayment(record) ? 'paymentOriginalCashier' : 'paymentLinkUnsupported'
      }
      if (record.paymentStatus === 'requires-verification') return canOpenPayment(record) ? 'paymentVerification' : 'paymentVerificationUnavailable'
      return { paid: 'paymentPaid', unknown: 'paymentUnknown', failed: 'paymentFailed' }[record.paymentStatus]
    }

    function paymentHandoff(record, t, includeNotice = true) {
      if (canOpenPayment(record)) return h('a', { href: record.paymentUrl, target: '_blank', rel: 'noopener noreferrer', className: 'waimai-pay-link' }, t('payOfficial'))
      const notice = paymentNoticeKey(record)
      if (notice) return includeNotice ? h('p', { role: 'status', className: 'waimai-hint' }, t(notice)) : null
      return h('p', { className: 'waimai-hint' }, t('noPaymentLink'))
    }

    /** Read browser-local view references; the Host still owns account existence and authentication. */
    function readView() {
      try {
        const value = JSON.parse(window.localStorage.getItem(VIEW_KEY))
        if (value?.version !== 1 || !value.accounts || typeof value.accounts !== 'object' || Array.isArray(value.accounts)) return { version: 1, accounts: {} }
        return { version: 1, platformId: typeof value.platformId === 'string' && /^[a-z]{1,32}$/.test(value.platformId) ? value.platformId : undefined,
          accounts: Object.fromEntries(Object.entries(value.accounts).filter(([id, ref]) => /^[a-z]{1,32}$/.test(id)
            && typeof ref === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ref))) }
      } catch (_error) { return { version: 1, accounts: {} } } // Missing or unreadable browser preferences use the Host defaults.
    }

    /** Merge only the changed preference so other windows' choices remain intact. */
    function rememberView(update) {
      try { window.localStorage.setItem(VIEW_KEY, JSON.stringify(update(readView()))); return true }
      catch (_error) { return false } // The current view remains usable when browser persistence is denied.
    }

    const zh = {
      cartBusy: '处理中…', chatPlatformTaobao: '淘宝闪购', chatPlatformHema: '盒马',
      chatOrdering: '在聊天中点餐', chatCandidates: '推荐餐品', chatOpen: '选规格并点餐', chatMore: '查看更多', chatAllMenu: '查看完整菜单',
      chatProductSearch: '商品查询', chatSearchScope: '仅查询已选店铺；价格为标价，实付以结算为准。', chatSearchFailed: '商品读取失败', chatNoProductMatch: '本店没有匹配商品', chatNextShopPage: '还有下一页店铺，当前结果不代表全部店铺。',
      chatSelectedStore: '已选店铺',
      browseCursorSeconds: 'Agent 店铺分页有效期（秒）', browseCursorLimit: 'Agent 店铺分页保留数量',
      chatQuote: '确认订单', chatPayment: '订单与付款', chatLoading: '正在读取点餐信息…', chatUnavailable: '尚未返回可展示的点餐信息。',
      chatBudget: '本次预算上限', chatRefreshOrder: '核对官方订单状态', chatOrderStatus: '官方订单状态', chatAwaitingPayment: '订单已创建，付款待确认',
      paymentPaid: '付款已确认', paymentVerification: '已发起付款，请完成官方支付验证', paymentUnknown: '付款结果未知，请核对状态，勿重复付款', paymentFailed: '本次付款未成功',
      paymentLinkUnsupported: '支付宝支付工具不支持此收银台链接；请先核对订单状态，勿重复付款',
      paymentOriginalCashier: '支付宝支付工具未受理此链接，可打开本订单的官方收银台继续付款；尚未确认扣款。',
      paymentVerificationUnavailable: '原付款验证入口不可用，请先核对付款结果，勿再次付款。',
      chatUnknownOrder: '结果未确认，请核对官方历史订单，勿重复提交。', chatManualPreview: '自动化保持预览；本次手动确认可创建订单。',
      chatRefreshing: '正在核对…', chatChangePending: '正在修改购物车…', chatOrderFailed: '订单状态读取失败，请重试。',
      title: '外卖助手',
      intro: '配置免费券领取、用券、点单时间、菜单和预算。',
      unavailable: '配置尚未就绪。请确认插件已加载并完成一次配置读取。',
      viewSaveFailed: '无法记住此次选择，当前页面仍可使用。',
      mode: '支付模式',
      claimCoupons: '自动领取免费优惠券',
      useCoupons: '自动使用可用优惠券',
      checked: '已勾选',
      unchecked: '未勾选',
      preview: '预览模式',
      previewOn: '已开启：自动任务只预览',
      previewOff: '已关闭：可确认创建订单',
      previewHint: '自动任务只预览；手动点餐仍需核对报价并明确确认下单。',
      modeAuto: '自动支付',
      modeManual: '仅提交，人工支付',
      cap: '单笔上限',
      budget: '每日上限',
      unlimited: '未限制',
      anyMerchant: '不限制商家',
      tasks: '自动化任务',
      tools: '工具命名空间',
      browserHint: '购物车和结算通过接口读取，支付在官方收银台确认。',
      manualHint: '创建订单后，请在官方收银台确认支付。',
      autoHint: '自动模式仍受预算限制；配置支付宝 Agent Pay 后可交接付款，需要身份验证时在支付宝官方页面完成。',
      h5Pay: 'H5 后台付款', h5Start: '连接 H5 收银台', h5Open: '打开支付宝登录验证', h5Connect: '已验证，连接后台', h5Submit: '确认后台付款', h5Password: '本次支付宝支付密码', h5Cancel: '关闭验证窗口',
      h5Hint: '手机号和短信验证码可在这里输入，由后台提交支付宝验证。额外人工验证需在官方页面完成。付款请求由插件后台发送。', h5Ready: '后台收银台已就绪', h5Verifying: '请在支付宝窗口完成登录验证，然后连接后台。', h5Check: '付款结果待官方核对，请勿重复提交。', h5Failed: 'H5 操作失败，请核对原订单状态。', alipayH5BrowserChannel: 'H5 登录验证浏览器',
      paymentSettings: '支付配置', alipayAgent: '支付宝 Agent Pay', alipayAgentExecutable: '支付宝 CLI 绝对路径', alipayAgentTimeoutMs: '连接超时（毫秒）',
      alipayAgentHint: '留空使用原收银台。填写已安装的官方支付宝 CLI 绝对路径；授权和身份验证在支付宝官方页面完成。下方设置的支付密码只用于 H5 后台付款。',
      paymentCheck: '检查连接', paymentChecking: '正在检查…', paymentCheckHint: '仅检查已保存配置并读取 CLI 版本，不付款或开通钱包。',
      paymentSaveFirst: '设置有未保存的修改，请先保存再检查连接。', paymentNotConfigured: '未配置支付宝 CLI，当前使用原收银台。',
      paymentInvalidPath: '请填写支付宝 CLI 文件的绝对路径。', paymentUnavailable: '无法连接支付宝 CLI，请检查已保存的路径和文件。',
      paymentUnexpectedVersion: 'CLI 版本响应无法识别，请核对是否为官方支付宝 CLI。', paymentAvailable: '支付宝 CLI 连接正常',
      logHint: '支付与通知记录位于 $DSH_HOME/waimai/ 目录。',
      settings: '点单设置', save: '保存设置', saved: '已保存', saveFailed: '保存失败，请检查输入并重试。',
      addTask: '添加任务', removeTask: '删除任务', menuHint: '每行：店铺 | 菜品 | 价格',
      browserChannel: '使用的浏览器', headless: '隐藏浏览器窗口', deliveryAddress: '配送地址备注（页面中仍需手动选择）',
      couponClaimLimit: '单次最多领取券数', enabled: '启用任务', name: '任务名称', triggerTime: '点单时间',
      dateRule: '执行日期', skipDates: '跳过日期（每行 YYYY-MM-DD）', menuPool: '菜单池', menuStrategy: '菜单选择方式',
      workday: '工作日', weekend: '周末', everyday: '每天', custom: '自定义',
      rotate: '轮换', random: '随机', history: '优先较少点过的餐食',
      mon: '周一', tue: '周二', wed: '周三', thu: '周四', fri: '周五', sat: '周六', sun: '周日',
      chrome: 'Chrome', msedge: 'Edge', chromium: 'Playwright Chromium',
      coupons: '优惠券', claimHint: '只领取免费券，不购买券包或会员。', useHint: '结算时选择可用优惠券，按实付金额检查预算。',
      order: '点单与预算', advanced: '浏览器与配送', taskAdvanced: '更多任务设置',
      emptyTasks: '还没有自动化任务', emptyHint: '添加时间、菜单和预算；新任务默认暂停。',
      enabledState: '已启用', paused: '已暂停', untitled: '未命名任务', editTask: '编辑任务', collapseTask: '收起任务',
      pending: '有未保存的修改', unchanged: '设置已同步', saving: '保存中…', reset: '撤销修改',
      currencyHint: '金额单位：元；每日上限为 0 时不限制。',
      timeHint: '24 小时制，例如 11:00', noClaims: '开启自动领取后可调整领取数量。',
      loginTitle: '账号登录', phone: '中国大陆手机号', smsCode: '短信验证码',
      sendCode: '获取验证码', signIn: '登录', refreshLogin: '检查登录状态', loginBusy: '处理中…',
      loginFailed: '登录服务不可用，请检查插件状态。', persistLogin: '记住本机登录',
      login_not_checked: '尚未检查登录状态', login_logged_out: '未登录', login_logged_in: '已登录',
      login_code_sent: '短信已发送，请输入验证码', login_verification_required: '平台要求额外验证，暂时无法在这里完成登录。',
      login_registration_required: '平台要求注册确认，本次登录已停止。', login_send_unknown: '验证码发送结果未确认，请先检查短信。',
      login_send_rejected: '平台未确认发送验证码，请稍后重试。', login_login_unknown: '登录结果未确认，请检查登录状态。',
      login_login_rejected: '平台未接受本次登录，请核对验证码。', login_login_unconfirmed: '登录尚未确认，请检查登录状态。',
      loginProtocol: '仅支持已有账号；需要平台额外验证时会停止。',
      avatar: '用户头像', avatarUnavailable: '头像暂无法读取，可刷新重试', avatarLoadFailed: '头像加载失败，可刷新重试', accountId: '账号 ID', nickname: '昵称', accountPhone: '手机号',
      accountsTitle: '账号', addAccount: '添加账号', cancelAddAccount: '取消添加', unnamedAccount: '已保存账号',
      maxAccountsPerPlatform: '每个平台的账号数量上限', pendingAccount: '新账号尚未登录成功，当前账号仍保留。',
      taobaoQr: '淘宝扫码', smsLogin: '手机号短信', qrStart: '获取淘宝登录二维码', qrRestart: '重新获取二维码', qrCancel: '取消扫码', qrCheck: '检查闪购授权',
      hemaQr: '盒马 App 扫码', taobaoAuthorization: '淘宝授权扫码', taobaoAccountLogin: '使用淘宝账号', defaultLoginMethod: '默认方式', unknownLoginMethod: '登录方式待确认',
      taobaoSmsLogin: '手机号短信（淘宝授权）', taobaoSmsHint: '通过淘宝的阿里账号短信入口授权，再独立核验盒马资料和订单。仅用于已有账号；需要注册或额外验证时停止。', retryPlatforms: '重新加载平台',
      hemaQrUnavailable: '盒马 App 扫码尚未接通。可选择淘宝授权扫码，或使用已登录淘宝账号。',
      taobaoAuthorizationHint: '使用淘宝 App 扫码授权，再独立核验盒马账号。这张二维码不是盒马 App 的扫码入口。',
      reuseTaobaoHint: '明确选择已登录的淘宝账号，再核验其盒马资料；不会改变闪购账号。', noReusableTaobao: '暂无可复用的淘宝扫码账号，请先选择淘宝授权扫码。',
      qrHint: '使用淘宝 App 扫码，并在手机上确认。之后会自动完成登录。', qr_waiting: '等待扫码', qr_scanned: '已扫码，请在手机上确认',
      qr_linked: '淘宝扫码与闪购账号已确认', qr_expired: '二维码已过期', qr_canceled: '扫码已取消', qr_error: '扫码状态读取失败，请重新检查',
      qr_business_unconfirmed: '扫码已确认，正在完成闪购登录…',
      qrStarting: '正在获取二维码…', qrAutoChecking: '正在自动复核登录，请稍候。', qrStepScan: '扫码', qrStepConfirm: '手机确认', qrStepLogin: '完成登录',
      qrAutoRetry: '连接暂时中断，正在自动重试…', qr_authorization_timeout: '登录确认超时，请重新扫码。',
      qr_taobao_session_unconfirmed: '淘宝登录会话未能建立，请重新扫码。',
      hema_qr_linked: '盒马账号已确认', hema_qrCheck: '检查盒马授权',
      hema_qr_business_unconfirmed: '扫码已确认，正在完成盒马登录…',
      hema_ordering: '门店与商品', hema_nearbyShops: '当前地址可配送门店', hema_recentShops: '最近下单的配送门店',
      hema_selectAddressFirst: '先选择盒马配送地址，再查看配送门店。', hema_orderingBlocked: '选择商品核对实付报价，确认后创建订单；付款请在盒马 App 完成。',
      hemaCartHint: '购物车价格以当前回读为准，会员优惠、运费与实付金额需结算确认。', cartUnconfirmed: '加购结果待核对，请刷新购物车，勿重复加购。',
      hema_viewMenu: '查询商品', hema_recentScope: '仅显示最近一页订单中、当前地址可配送的门店。',
      hema_menuSearch: '输入商品名称', hema_menuPriceHint: '标价和规格以当前查询为准；优惠、运费及实付金额以结算为准。',
      nextProducts: '下一页商品', firstProducts: '返回首批', productDetails: '查看规格', backToProducts: '返回商品',
      detailPriceUnavailable: '价格暂无法确认',
      productSpecs: '商品规格', minimumQuantity: '最低数量', quantityStep: '数量步长', stockQuantity: '库存', chargeUnit: '计价单位', hemaProductPageSize: '盒马商品每页数量',
      recordedProductHint: '以下为本次工具返回的商品资料。库存和价格可能变化，下单前需重新核验。', refreshProduct: '刷新商品规格',
      viewCart: '查看购物车', refreshCart: '刷新购物车', cartTitle: '购物车', cartEmpty: '购物车暂无商品。', cartAvailable: '可售商品', cartUnavailable: '当前不可售',
      cartSelected: '手机已勾选', cartCount: '商品条目', cartReadOnly: '仅查看当前账号购物车；不修改商品或勾选状态。结算、下单与支付尚未开放。', cartQuantity: '数量', moreCart: '显示更多购物车商品',
      addToCart: '加入购物车', removeOne: '减一件', checkout: '去结算', checkoutTitle: '确认订单', checkoutSelect: '本次结算',
      checkoutQuoteSeconds: '报价有效期（秒）', quoteExpiry: '报价剩余', seconds: '秒', quoteExpired: '报价已过期，请重新结算。',
      tradeConfirm: '我已核对商品、配送地址、时间和实付金额', createOrder: '确认创建订单', payOfficial: '前往官方支付',
      chooseDelivery: '选择配送方式与时间', retryNoOrder: '我已在盒马 App 确认原请求未生成订单', retryOrderOnce: '确认重试一次',
      retryOrderHint: '保留原请求记录。请先在官方客户端核对，再重新结算并确认重试一次。', retryExhausted: '本次重试已使用，请核对官方订单及本机记录。',
      actualTotal: '实付', discountTotal: '优惠合计', deliveryTime: '配送时间', orderCreated: '订单已创建，支付结果待确认',
      orderUnknown: '下单结果未确认，请先核对官方历史订单，勿重复提交。', orderRecord: '本机下单记录',
      orderCapExceeded: '实付超过单笔上限，请调整购物车或设置。', tradePreview: '预览模式：可查看实付报价，关闭后才能创建订单。',
      tradeCartHint: '购物车与官方客户端同步。规格、口味和数量会在加购前确认。',
      chooseSpecifications: '选规格', closeSpecifications: '关闭规格选择', specificationVariant: '商品规格', specificationCount: '选择数量',
      specificationsLoading: '正在读取规格…', selectAllSpecifications: '请选择规格', specificationPriceHint: '此处为商品标价，优惠及配送费用以结算为准。',
      cartAdding: '正在加入…', reloadSpecifications: '重新读取规格', cartAdded: '已加入购物车', cartRemoved: '已减一件', cartItems: '件', cartUpdating: '正在更新购物车…',
      cartLoading: '正在读取…', closeCart: '关闭购物车', quantity: '数量',
      noPaymentLink: '平台未返回可用支付入口，请在官方客户端的订单中继续。',
      hema_refreshMenu: '重新搜索', hema_backToShops: '返回门店', searchProducts: '搜索商品',
      hema_menuCategory: '搜索结果', hema_allCategories: '全部商品', hema_moreItems: '显示更多商品',
      hema_refreshShops: '刷新门店', hema_shopFilter: '筛选本页门店', hema_noMenu: '这家门店暂无可展示的商品。',
      hema_noNearbyShops: '当前地址暂无可配送门店', hema_noShops: '最近订单中没有当前地址可配送的门店',
      useTaobaoAccount: '使用已登录淘宝账号', sourceTaobaoAccount: '淘宝账号',
      qr_verification_required: '需要在官方平台完成额外验证。原账号仍保留。', qr_registration_required: '需要注册确认，本次登录已停止。', loginMethod: '登录方式',
      historyTitle: '历史订单', refreshAccount: '刷新账号与订单', latestOrders: '返回最新订单', olderOrders: '下一页',
      noOrders: '暂无历史订单', accountBusy: '正在读取账号与订单…', accountFailed: '账号或订单读取失败，请稍后刷新。',
      accountChanged: '账号已变化，请重新检查登录状态。', page: '页', orderId: '订单号', historyPageSize: '历史订单每页条数',
    }
    const en = {
      cartBusy: 'Processing…', chatPlatformTaobao: 'Taobao Instant Commerce', chatPlatformHema: 'Hema',
      chatOrdering: 'Order in chat', chatCandidates: 'Suggested dishes', chatOpen: 'Choose options and order', chatMore: 'Show more', chatAllMenu: 'Full menu',
      chatProductSearch: 'Product search', chatSearchScope: 'Selected stores only. Prices are listed prices; the final total depends on checkout.', chatSearchFailed: 'Products could not be read', chatNoProductMatch: 'No matching products in this store', chatNextShopPage: 'More merchant pages are available; these results do not include every store.',
      chatSelectedStore: 'Selected store',
      browseCursorSeconds: 'Agent merchant cursor validity (seconds)', browseCursorLimit: 'Retained Agent merchant cursors',
      chatQuote: 'Confirm order', chatPayment: 'Order and payment', chatLoading: 'Loading ordering information…', chatUnavailable: 'No ordering information is available yet.',
      chatBudget: 'Budget for this order', chatRefreshOrder: 'Check official order status', chatOrderStatus: 'Official order status', chatAwaitingPayment: 'Order created; payment unconfirmed',
      paymentPaid: 'Payment confirmed', paymentVerification: 'Payment initiated; complete official verification', paymentUnknown: 'Payment outcome unknown; check status before any further action', paymentFailed: 'Payment was not completed',
      paymentLinkUnsupported: 'Alipay Agent Pay does not support this cashier link. Check the order status before any further payment.',
      paymentOriginalCashier: 'Alipay Agent Pay rejected this link. Open this order’s original cashier to continue. Payment is not confirmed.',
      paymentVerificationUnavailable: 'The original payment verification link is unavailable. Check the payment outcome first; do not pay again.',
      chatUnknownOrder: 'The outcome is unconfirmed. Check official order history before trying again.', chatManualPreview: 'Automation stays in preview. Your confirmation can create this order.',
      chatRefreshing: 'Checking…', chatChangePending: 'Updating cart…', chatOrderFailed: 'Could not read order status. Retry.',
      title: 'Takeaway assistant',
      intro: 'Configure free coupon claims, coupon selection, schedules, menus and budgets.',
      unavailable: 'Configuration is not ready yet.',
      viewSaveFailed: 'This selection could not be remembered. You can still use the current view.',
      mode: 'Payment mode',
      claimCoupons: 'Claim free coupons automatically',
      useCoupons: 'Use eligible coupons automatically',
      checked: 'Enabled',
      unchecked: 'Disabled',
      preview: 'Preview mode',
      previewOn: 'On: automated tasks preview only',
      previewOff: 'Off: execute configured tasks',
      previewHint: 'Automated tasks preview only. Manual ordering requires quote review and explicit confirmation.',
      modeAuto: 'Automatic',
      modeManual: 'Submit only, pay by hand',
      cap: 'Per-order cap',
      budget: 'Daily budget',
      unlimited: 'unlimited',
      anyMerchant: 'any merchant',
      tasks: 'Automation tasks',
      tools: 'Tool namespace',
      browserHint: 'Ordering and payment use the local browser.',
      manualHint: 'Manual mode: the plugin stops at the confirmation page and you complete the charge.',
      autoHint: 'Automatic mode follows budget limits. Configure Alipay Agent Pay to hand off payments, and complete any identity verification on the official Alipay page.',
      h5Pay: 'H5 backend payment', h5Start: 'Connect H5 cashier', h5Open: 'Open Alipay verification', h5Connect: 'Connect after verification', h5Submit: 'Confirm backend payment', h5Password: 'Alipay password for this payment', h5Cancel: 'Close verification window',
      h5Hint: 'Enter your phone number and SMS code here for backend Alipay verification. Additional manual verification requires the official page. The plugin sends payment from the backend.', h5Ready: 'Backend cashier is ready', h5Verifying: 'Complete sign-in in the Alipay window, then connect the backend.', h5Check: 'Reconcile the payment with the original order. Do not submit again.', h5Failed: 'H5 operation failed. Check the original order.', alipayH5BrowserChannel: 'Browser for H5 verification',
      paymentSettings: 'Payment settings', alipayAgent: 'Alipay Agent Pay', alipayAgentExecutable: 'Absolute path to Alipay CLI', alipayAgentTimeoutMs: 'Connection timeout (ms)',
      alipayAgentHint: 'Leave empty to use the existing cashier. Enter the absolute path to the installed official Alipay CLI. Authorization and identity verification happen on the official Alipay page. The password configured below is only used for H5 backend payment.',
      paymentCheck: 'Check connection', paymentChecking: 'Checking…', paymentCheckHint: 'Checks saved settings and reads the CLI version only. Does not pay or open a wallet.',
      paymentSaveFirst: 'Save your changes before checking the connection.', paymentNotConfigured: 'Alipay CLI is not configured. Using the existing cashier.',
      paymentInvalidPath: 'Enter an absolute path to the Alipay CLI file.', paymentUnavailable: 'Could not connect to Alipay CLI. Check the saved path and file.',
      paymentUnexpectedVersion: 'The CLI version response was not recognized. Check that this is the official Alipay CLI.', paymentAvailable: 'Alipay CLI is available',
      logHint: 'Payment and notification records live under $DSH_HOME/waimai/.',
      settings: 'Order settings', save: 'Save settings', saved: 'Saved', saveFailed: 'Could not save. Check the fields and retry.',
      addTask: 'Add task', removeTask: 'Delete task', menuHint: 'One line: shop | dish | price',
      browserChannel: 'Browser', headless: 'Hide browser window', deliveryAddress: 'Address note (select the address on the site)',
      couponClaimLimit: 'Maximum claims per call', enabled: 'Enable task', name: 'Task name', triggerTime: 'Order time',
      dateRule: 'Days', skipDates: 'Skip dates (one YYYY-MM-DD per line)', menuPool: 'Menu pool', menuStrategy: 'Menu strategy',
      workday: 'Weekdays', weekend: 'Weekends', everyday: 'Every day', custom: 'Custom',
      rotate: 'Rotate', random: 'Random', history: 'Less frequently ordered first',
      mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
      chrome: 'Chrome', msedge: 'Edge', chromium: 'Playwright Chromium',
      coupons: 'Coupons', claimHint: 'Claim free coupons only; never buy coupon packs or memberships.', useHint: 'Choose eligible coupons at checkout and check the amount due against the budget.',
      order: 'Orders and budgets', advanced: 'Browser and delivery', taskAdvanced: 'More task settings',
      emptyTasks: 'No scheduled tasks yet', emptyHint: 'Add a schedule, menu and budget. New tasks start paused.',
      enabledState: 'Enabled', paused: 'Paused', untitled: 'Untitled task', editTask: 'Edit task', collapseTask: 'Collapse task',
      pending: 'Unsaved changes', unchanged: 'Settings are up to date', saving: 'Saving…', reset: 'Discard changes',
      currencyHint: 'Amounts in CNY; a daily limit of 0 means no limit.',
      timeHint: '24-hour time, e.g. 11:00', noClaims: 'Enable automatic claims to adjust the claim limit.',
      loginTitle: 'Sign in', phone: 'Mainland China mobile number', smsCode: 'SMS code',
      sendCode: 'Send code', signIn: 'Sign in', refreshLogin: 'Check sign-in status', loginBusy: 'Working…',
      loginFailed: 'Sign-in service is unavailable. Check the plugin status.', persistLogin: 'Remember sign-in on this computer',
      login_not_checked: 'Sign-in status not checked', login_logged_out: 'Signed out', login_logged_in: 'Signed in',
      login_code_sent: 'SMS sent. Enter the code.', login_verification_required: 'The platform requires additional verification. Sign-in cannot finish here yet.',
      login_registration_required: 'The platform requires registration confirmation. Sign-in stopped.', login_send_unknown: 'SMS delivery is unconfirmed. Check your messages first.',
      login_send_rejected: 'The platform did not confirm SMS delivery. Try again later.', login_login_unknown: 'Sign-in is unconfirmed. Check the status.',
      login_login_rejected: 'The platform rejected sign-in. Check the code.', login_login_unconfirmed: 'Sign-in is not confirmed. Check the status.',
      loginProtocol: 'Existing accounts only. Additional platform verification stops sign-in.',
      avatar: 'User avatar', avatarUnavailable: 'Avatar unavailable. Refresh to retry.', avatarLoadFailed: 'Avatar failed to load. Refresh to retry.', accountId: 'Account ID', nickname: 'Nickname', accountPhone: 'Phone',
      accountsTitle: 'Account', addAccount: 'Add account', cancelAddAccount: 'Cancel adding', unnamedAccount: 'Saved account',
      maxAccountsPerPlatform: 'Account limit per platform', pendingAccount: 'The new account is not signed in. Your current account is retained.',
      taobaoQr: 'Taobao QR', smsLogin: 'SMS', qrStart: 'Get Taobao sign-in QR', qrRestart: 'Refresh QR', qrCancel: 'Cancel scan', qrCheck: 'Check takeaway authorization',
      hemaQr: 'Hema app QR', taobaoAuthorization: 'Taobao authorization QR', taobaoAccountLogin: 'Use a Taobao account', defaultLoginMethod: 'Default method', unknownLoginMethod: 'Sign-in method unconfirmed',
      taobaoSmsLogin: 'SMS through Taobao authorization', taobaoSmsHint: 'Authorize through Alibaba account SMS on Taobao, then verify the Hema profile and orders independently. Existing accounts only; registration or additional verification stops the flow.', retryPlatforms: 'Reload platforms',
      hemaQrUnavailable: 'Hema app QR sign-in is not connected. Choose Taobao authorization QR or a signed-in Taobao account.',
      taobaoAuthorizationHint: 'Scan with the Taobao app, then verify the Hema account independently. This QR code is not a Hema app sign-in entry.',
      reuseTaobaoHint: 'Choose a signed-in Taobao account, then verify its Hema profile. The takeaway account stays unchanged.', noReusableTaobao: 'No reusable Taobao QR account. Choose Taobao authorization QR first.',
      qrHint: 'Scan with the Taobao app and confirm on your phone. Sign-in then completes automatically.', qr_waiting: 'Waiting for scan', qr_scanned: 'Scanned; confirm on your phone',
      qr_linked: 'Taobao and takeaway account confirmed', qr_expired: 'QR expired', qr_canceled: 'Scan canceled', qr_error: 'Could not check scan status. Check again.',
      qr_business_unconfirmed: 'Scan confirmed. Completing takeaway sign-in…',
      qrStarting: 'Getting your QR code…', qrAutoChecking: 'Verifying sign-in automatically. Please wait.', qrStepScan: 'Scan', qrStepConfirm: 'Confirm on phone', qrStepLogin: 'Finish sign-in',
      qrAutoRetry: 'Connection interrupted. Retrying automatically…', qr_authorization_timeout: 'Sign-in confirmation timed out. Scan a new QR code.',
      qr_taobao_session_unconfirmed: 'Taobao could not establish a sign-in session. Scan a new QR code.',
      hema_qr_linked: 'Hema account confirmed', hema_qrCheck: 'Check Hema authorization',
      hema_qr_business_unconfirmed: 'Scan confirmed. Completing Hema sign-in…',
      hema_ordering: 'Stores and products', hema_nearbyShops: 'Stores serving this address', hema_recentShops: 'Recently ordered delivery stores',
      hema_selectAddressFirst: 'Choose a Hema delivery address to view serving stores.', hema_orderingBlocked: 'Select items, review the final quote and confirm order creation. Complete payment in the Hema app.',
      hemaCartHint: 'Cart prices are current reads. Membership discounts, delivery fees and the amount due require checkout.', cartUnconfirmed: 'Add result needs verification. Refresh the cart without adding again.',
      hema_viewMenu: 'Find products', hema_recentScope: 'Stores in the latest order page that currently serve this address.',
      hema_menuSearch: 'Enter a product name', hema_menuPriceHint: 'Prices and specifications are current search results. Discounts, delivery fees and final totals depend on checkout.',
      nextProducts: 'Next product page', firstProducts: 'Back to first results', productDetails: 'View specifications', backToProducts: 'Back to products',
      detailPriceUnavailable: 'Price not confirmed',
      productSpecs: 'Product specifications', minimumQuantity: 'Minimum quantity', quantityStep: 'Quantity step', stockQuantity: 'Stock', chargeUnit: 'Pricing unit', hemaProductPageSize: 'Hema products per page',
      recordedProductHint: 'These details were returned by this tool call. Stock and prices can change; verify them again before ordering.', refreshProduct: 'Refresh specifications',
      viewCart: 'View cart', refreshCart: 'Refresh cart', cartTitle: 'Cart', cartEmpty: 'Your cart is empty.', cartAvailable: 'Available products', cartUnavailable: 'Currently unavailable',
      cartSelected: 'Selected in app', cartCount: 'Product entries', cartReadOnly: 'View this account’s cart without changing items or selections. Checkout, ordering and payment are unavailable.', cartQuantity: 'Quantity', moreCart: 'Show more cart products',
      addToCart: 'Add to cart', removeOne: 'Remove one', checkout: 'Checkout', checkoutTitle: 'Confirm order', checkoutSelect: 'Include in this checkout',
      checkoutQuoteSeconds: 'Quote validity (seconds)', quoteExpiry: 'Quote expires in', seconds: 'seconds', quoteExpired: 'Quote expired. Request a new quote.',
      tradeConfirm: 'I checked the items, delivery address, time and final total', createOrder: 'Confirm and create order', payOfficial: 'Continue to official payment',
      chooseDelivery: 'Choose delivery method and time', retryNoOrder: 'I checked Hema and confirmed the original request created no order', retryOrderOnce: 'Confirm one retry',
      retryOrderHint: 'The original attempt is retained. Check the official app, request a fresh quote, then confirm one retry.', retryExhausted: 'This retry has been used. Check official orders and local records.',
      actualTotal: 'Final total', discountTotal: 'Total discount', deliveryTime: 'Delivery time', orderCreated: 'Order created; payment status unconfirmed',
      orderUnknown: 'Order outcome is unknown. Check official order history before submitting again.', orderRecord: 'Local order attempts',
      orderCapExceeded: 'Final total exceeds the order cap. Adjust the cart or settings.', tradePreview: 'Preview mode: review quotes, then turn preview off to create an order.',
      tradeCartHint: 'This cart is shared with the official app. Confirm specifications, preferences and quantity before adding.',
      chooseSpecifications: 'Choose options', closeSpecifications: 'Close options', specificationVariant: 'Variant', specificationCount: 'Required choices',
      specificationsLoading: 'Loading options…', selectAllSpecifications: 'Choose a variant', specificationPriceHint: 'Listed item prices. Discounts and delivery fees are confirmed at checkout.',
      cartAdding: 'Adding…', reloadSpecifications: 'Reload options', cartAdded: 'Added to cart', cartRemoved: 'Removed one', cartItems: 'items', cartUpdating: 'Updating cart…',
      cartLoading: 'Loading…', closeCart: 'Close cart', quantity: 'Quantity',
      noPaymentLink: 'No supported payment link was returned. Continue in the official app’s order history.',
      hema_refreshMenu: 'Search again', hema_backToShops: 'Back to stores', searchProducts: 'Search products',
      hema_menuCategory: 'Search results', hema_allCategories: 'All products', hema_moreItems: 'Show more products',
      hema_refreshShops: 'Refresh stores', hema_shopFilter: 'Filter these stores', hema_noMenu: 'No displayable products from this store.',
      hema_noNearbyShops: 'No stores serve this address', hema_noShops: 'No recently ordered stores serve this address',
      useTaobaoAccount: 'Use a signed-in Taobao account', sourceTaobaoAccount: 'Taobao account',
      qr_verification_required: 'Complete additional verification on the official platform. Your previous account is retained.', qr_registration_required: 'Registration confirmation required. Sign-in stopped.', loginMethod: 'Sign-in method',
      historyTitle: 'Order history', refreshAccount: 'Refresh account and orders', latestOrders: 'Latest orders', olderOrders: 'Next page',
      noOrders: 'No previous orders', accountBusy: 'Loading account and orders…', accountFailed: 'Could not read account or orders. Refresh later.',
      accountChanged: 'The account changed. Check sign-in status again.', page: 'Page', orderId: 'Order ID', historyPageSize: 'Orders per history page',
    }

    Object.assign(zh, {
      accountContext: '平台与账号', noSavedAccount: '尚未添加账号', smsAccountHint: '淘宝 App 的闪购订单请使用淘宝扫码；短信登录可能对应另一个账号', accountDetails: '账号资料', refreshHistory: '刷新订单',
      addressPicker: '选择其他地址', noSelectedAddress: '尚未选择配送地址', defaultPlatformLabel: '默认外卖平台', purchaseSettings: '结算与支付',
      accounts: '账号与地址', ordering: '点餐', platform: '外卖平台', platformLanguage: 'zh',
      notIntegrated: '尚未接入', platformUnavailable: '该平台尚未接入，登录和点餐暂不可用。',
      platformFailed: '平台列表读取失败，请检查插件状态。', addresses: '配送地址', selectAddress: '使用此地址', selectedAddress: '当前配送地址',
      refreshAddresses: '刷新地址', noAddresses: '暂无配送地址，请在平台添加后刷新。', addressUnavailable: '该地址暂不可用',
      addressFailed: '地址读取或保存失败，请刷新后重试。', recentShops: '最近点过的店铺', noShops: '最近一页订单中没有可用店铺。',
      refreshShops: '刷新店铺', probeMenu: '查看菜单', chooseShop: '选择店铺', orderingBlocked: '可浏览菜单，下单与支付暂未开放。',
      nearbyShops: '附近店铺', selectAddressFirst: '先选择配送地址，再查看店铺和菜单。', shopFilter: '筛选本页店铺',
      noNearbyShops: '该地址暂未返回附近店铺。', adsFiltered: '本页店铺均为推广，已过滤。', noMatches: '没有匹配的结果。', nextShops: '下一页店铺', firstShops: '返回第一页',
      recentScope: '仅显示最近一页订单中的店铺，是否配送以当前地址的菜单为准。', viewMenu: '查看菜单', refreshMenu: '刷新菜单',
      backToShops: '返回店铺', menuSearch: '搜索这家店的菜品', menuCategory: '菜品分类', allCategories: '全部菜品',
      noMenu: '这家店暂未返回可展示的菜品。', moreItems: '显示更多菜品', advertisedPrice: '标价', priceUnavailable: '价格未返回',
      soldOut: '已售罄', outsideSaleTime: '非售卖时段', itemOptions: '口味与选项', optionUnavailable: '不可选',
      minimumOrder: '起送', ad: '广告', browsePageSize: '附近店铺每页数量', hideSponsoredShops: '隐藏推广店铺', sponsoredHint: '关闭后显示推广店铺，并标明广告。', menuPriceHint: '价格为菜单标价，优惠及实付金额以结算为准。',
      payment: '支付', previewHint: '开启时自动任务只预览；手动点餐需核对餐品、地址和金额后确认下单。',
      intro: '账号、配送地址、历史订单和点餐任务。', advanced: '本机登录与历史记录',
      couponsPending: '自动领券尚未接入；结算显示平台返回的优惠。', taskHint: '任务目前仅预览菜单与时间，暂不执行下单',
      refreshAccount: '刷新账号', accountBusy: '正在读取账号…',
    })
    Object.assign(en, {
      accountContext: 'Platform and account', noSavedAccount: 'No saved accounts', smsAccountHint: 'Use Taobao QR for orders placed in the Taobao app. SMS may sign in to a different account.', accountDetails: 'Account details', refreshHistory: 'Refresh orders',
      addressPicker: 'Choose another address', noSelectedAddress: 'No delivery address selected', defaultPlatformLabel: 'Default platform', purchaseSettings: 'Checkout and payment',
      accounts: 'Account and addresses', ordering: 'Order food', platform: 'Platform', platformLanguage: 'en',
      notIntegrated: 'Not integrated', platformUnavailable: 'This platform is not integrated. Sign-in and ordering are unavailable.',
      platformFailed: 'Could not load platforms. Check the plugin status.', addresses: 'Delivery addresses', selectAddress: 'Use this address', selectedAddress: 'Selected delivery address',
      refreshAddresses: 'Refresh addresses', noAddresses: 'No addresses. Add an address on the platform and refresh.', addressUnavailable: 'Address unavailable',
      addressFailed: 'Could not read or save the address. Refresh and retry.', recentShops: 'Recently ordered shops', noShops: 'No available shops in the latest order page.',
      refreshShops: 'Refresh shops', probeMenu: 'View menu', chooseShop: 'Choose a shop', orderingBlocked: 'You can browse menus. Ordering and payment are unavailable.',
      nearbyShops: 'Nearby shops', selectAddressFirst: 'Choose a delivery address to view shops and menus.', shopFilter: 'Filter this page of shops',
      noNearbyShops: 'No nearby shops were returned for this address.', adsFiltered: 'This page contained only sponsored shops, which were filtered out.', noMatches: 'No matching results.', nextShops: 'Next shop page', firstShops: 'First page',
      recentScope: 'Shops from the latest order page. Menu availability depends on the current delivery address.', viewMenu: 'View menu', refreshMenu: 'Refresh menu',
      backToShops: 'Back to shops', menuSearch: 'Search this shop’s menu', menuCategory: 'Categories', allCategories: 'All items',
      noMenu: 'This shop returned no displayable items.', moreItems: 'Show more items', advertisedPrice: 'Listed price', priceUnavailable: 'Price unavailable',
      soldOut: 'Sold out', outsideSaleTime: 'Outside sale hours', itemOptions: 'Options', optionUnavailable: 'Unavailable',
      minimumOrder: 'Minimum order', ad: 'Ad', browsePageSize: 'Nearby shops per page', hideSponsoredShops: 'Hide sponsored shops', sponsoredHint: 'When off, sponsored shops are shown with an ad label.', menuPriceHint: 'Menu prices are listed prices. Discounts and the final total depend on checkout.',
      payment: 'Pay', previewHint: 'Automation previews while enabled. Manual orders require review of items, address and amount.',
      intro: 'Accounts, delivery addresses, order history and scheduled tasks.', advanced: 'Local sign-in and history',
      couponsPending: 'Automatic coupon claiming is unavailable. Quotes show platform discounts.', taskHint: 'Tasks preview menus and schedules. They do not place orders yet.',
      refreshAccount: 'Refresh account', accountBusy: 'Loading account…',
    })

    Object.assign(zh, {
      paymentPasswordTitle: '支付宝支付密码', paymentLoginAccount: '待付款订单所属的淘宝闪购账号', paymentLoginAccountsFailed: '无法读取订单账号，请重试。', paymentLoginAccountsRefresh: '刷新订单账号', paymentPasswordInput: '六位支付宝支付密码',
      paymentPasswordHint: '通用支付宝支付密码保存在本机 DSH 凭据文件，不绑定购物账号；切换渠道或重新登录购物账号无需重新设置，不进入普通配置或聊天记录，也不随普通配置同步。保存后只显示设置状态。手机号和短信验证码在下方验证；额外人工验证仍需支付宝页面。',
      paymentPasswordConfigured: '支付密码已设置', paymentPasswordAbsent: '尚未设置支付密码', paymentPasswordLoading: '正在读取支付密码状态…',
      paymentPasswordMigration: '旧支付密码无法自动合并，请在此设置通用支付宝支付密码。',
      paymentPasswordSave: '保存支付密码', paymentPasswordRemove: '删除已保存的密码', paymentPasswordSaved: '支付密码已保存', paymentPasswordRemoved: '已删除保存的支付密码',
      paymentPasswordFailed: '无法读取或保存支付密码，请重试。', paymentPasswordRefresh: '刷新支付密码状态', paymentPasswordReadOnly: '当前凭据存储不可写。',
      paymentLoginTitle: '支付宝登录与验证', paymentLoginCheck: '检查待付款订单', paymentLoginStart: '登录支付宝',
      paymentLoginHint: '保存支付密码不会建立支付宝登录会话。当前只能继续已建立收银台会话的有效待付款订单：在这里输入手机号、验证码，后台完成验证并连接。额外人工验证仍需官方页面处理，此处不会下单或付款。',
      paymentLoginUnchecked: '尚未检查支付宝验证入口。', paymentLoginEmpty: '没有可继续验证的待付款订单。当前尚不支持下单前独立登录支付宝。',
      paymentLoginReady: '此订单的支付宝登录验证已完成，可由后台继续付款。',
      h5LoginPhone: '支付宝手机号', h5LoginPhoneHint: '输入用于付款的支付宝账号手机号。', h5LoginNext: '下一步',
      h5LoginSms: '支付宝短信验证码', h5LoginSmsHint: '输入支付宝发送的验证码。', h5LoginVerify: '验证并连接', h5LoginResend: '重新发送验证码',
      h5LoginPending: '支付宝验证正在处理中。请刷新查看当前步骤，不要重复发送。', h5LoginRefresh: '刷新验证状态',
      h5LoginExternal: '支付宝要求额外人工验证，当前步骤无法在 DSH 内完成。请在官方窗口处理，再刷新验证状态；不要在窗口付款或开通新服务。',
      h5LoginExternalOpen: '打开官方窗口处理额外验证', h5LoginCancelled: '取消本次验证',
      h5LoginFailed: '支付宝验证未完成，请刷新查看当前步骤。手机号和验证码已清空，不会自动重发。',
      h5UseSavedPassword: '使用已保存的支付密码', h5TemporaryPasswordHint: '留空使用本机保存的支付密码；也可仅为本次付款输入。',
      h5NotSubmitted: '插件尚未提交后台付款。', h5SubmittedUnconfirmed: '后台付款请求已发送，实际结果请核对官方订单，请勿重复付款。',
      h5SubmissionUnknown: '后台付款是否提交尚未确认，请核对官方订单，请勿重复付款。',
      h5BusinessError: '支付宝返回业务错误。', h5PaymentFailureDisplay: '支付宝显示付款失败页面。', h5SignedOut: '支付宝登录状态已失效。',
      h5ExternalVerification: '支付宝要求额外验证。', h5UnsupportedStep: '支付宝进入尚未支持的步骤。', h5PaymentResult: '支付宝已返回付款结果页面，仍需通过官方订单确认实际结果。',
    })
    Object.assign(en, {
      paymentPasswordTitle: 'Alipay payment password', paymentLoginAccount: 'Taobao account owning the pending order', paymentLoginAccountsFailed: 'Could not read order accounts. Try again.', paymentLoginAccountsRefresh: 'Refresh order accounts', paymentPasswordInput: 'Six-digit Alipay payment password',
      paymentPasswordHint: 'A shared Alipay payment password is stored in this computer’s DSH credential file, independently of shopping accounts. Switching channels or signing in to a shopping account again does not require reconfiguration. It stays outside ordinary settings and chat history. It is not synced with ordinary settings. Only its configured status is displayed. Verify the phone number and SMS code below; additional manual verification still requires Alipay.',
      paymentPasswordConfigured: 'Payment password configured', paymentPasswordAbsent: 'No payment password configured', paymentPasswordLoading: 'Reading payment password status…',
      paymentPasswordMigration: 'Old payment passwords could not be merged automatically. Set the shared Alipay payment password here.',
      paymentPasswordSave: 'Save payment password', paymentPasswordRemove: 'Delete saved password', paymentPasswordSaved: 'Payment password saved', paymentPasswordRemoved: 'Saved payment password deleted',
      paymentPasswordFailed: 'Could not read or save the payment password. Try again.', paymentPasswordRefresh: 'Refresh payment password status', paymentPasswordReadOnly: 'The credential store is read-only.',
      paymentLoginTitle: 'Alipay sign-in and verification', paymentLoginCheck: 'Check pending orders', paymentLoginStart: 'Sign in to Alipay',
      paymentLoginHint: 'A saved password does not establish Alipay sign-in. Verification continues a valid pending order with an existing cashier session. Enter the phone number and SMS code here; the backend verifies and connects the session. Additional manual verification still requires the official page. This section does not create orders or pay.',
      paymentLoginUnchecked: 'The Alipay verification entry has not been checked.', paymentLoginEmpty: 'No pending order is available for verification. Signing in to Alipay before creating an order is not supported yet.',
      paymentLoginReady: 'Alipay verification for this order is complete. The backend can continue payment.',
      h5LoginPhone: 'Alipay phone number', h5LoginPhoneHint: 'Enter the phone number for the Alipay account you use to pay.', h5LoginNext: 'Next',
      h5LoginSms: 'Alipay SMS code', h5LoginSmsHint: 'Enter the code sent by Alipay.', h5LoginVerify: 'Verify and connect', h5LoginResend: 'Resend SMS code',
      h5LoginPending: 'Alipay verification is in progress. Refresh to check the current step. Do not resend.', h5LoginRefresh: 'Refresh verification status',
      h5LoginExternal: 'Alipay requires additional manual verification that cannot be completed in DSH. Complete it in the official window, then refresh. Do not pay or activate new services in that window.',
      h5LoginExternalOpen: 'Open official window for additional verification', h5LoginCancelled: 'Cancel verification',
      h5LoginFailed: 'Alipay verification is incomplete. Refresh to check the current step. The phone number and code were cleared and will not be resent automatically.',
      h5UseSavedPassword: 'Use saved payment password', h5TemporaryPasswordHint: 'Leave empty to use the password saved on this computer, or enter a password for this payment only.',
      h5NotSubmitted: 'The plugin has not submitted a backend payment.', h5SubmittedUnconfirmed: 'A backend payment request was sent. Check the official order for the actual result. Do not pay again.',
      h5SubmissionUnknown: 'It is not confirmed whether the backend payment was submitted. Check the official order. Do not pay again.',
      h5BusinessError: 'Alipay returned a business error.', h5PaymentFailureDisplay: 'Alipay displayed a payment failure page.', h5SignedOut: 'The Alipay sign-in session has expired.',
      h5ExternalVerification: 'Alipay requires additional verification.', h5UnsupportedStep: 'Alipay reached a step that is not supported yet.', h5PaymentResult: 'Alipay returned a payment result page. The actual result still needs confirmation from the official order.',
    })

    /** Selector delegates positioning, keyboard navigation and dismissal to Menu. */
    function Choice({ value, options, label, onChange, disabled, t }) {
      const [open, setOpen] = React.useState(false)
      return h(Menu, { open, portal: true, autoFocus: true, selectedId: value,
        items: options.map(([id, key]) => ({ id, label: t(key) })),
        onClose: () => setOpen(false), onSelect: id => { onChange(id); setOpen(false) },
        className: 'waimai-choice',
        anchor: h(Button, { variant: 'outline', disabled, className: 'waimai-select',
          'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': open,
          onClick: () => setOpen(current => !current) },
          h('span', null, t(options.find(([id]) => id === value)?.[1] ?? value)), h(IconChevronDownOutlineRegular)),
      })
    }

    /** Credential values use private RPC only; ordinary settings never receive the input. */
    function WaimaiPaymentPassword({ rpc, t, disabled }) {
      const [password, setPassword] = React.useState(''), [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(false), [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [retry, setRetry] = React.useState(0)
      const generation = React.useRef(0), pending = React.useRef(false), mounted = React.useRef(true)
      React.useEffect(() => () => { mounted.current = false }, [])
      React.useEffect(() => {
        const current = ++generation.current
        setPassword(''); setStatus(null); setMessage('')
        setLoading(true); setError('')
        void rpc.call('/waimai-login', 'paymentCredential', { operation: 'status' }).then(reply => {
          if (current !== generation.current) return
          if (!reply.ok || typeof reply.value?.configured !== 'boolean' || typeof reply.value?.writable !== 'boolean') {
            setError(reply.error?.message || t('paymentPasswordFailed')); return
          }
          setStatus({ configured: reply.value.configured, writable: reply.value.writable, migrationRequired: reply.value.migrationRequired === true })
        }).catch(() => { if (current === generation.current) setError(t('paymentPasswordFailed')) })
          .finally(() => { if (current === generation.current) setLoading(false) })
        return () => { generation.current++ }
      }, [retry])
      const change = async operation => {
        if (pending.current || disabled || loading || !status?.writable
          || operation === 'save' && !/^\d{6}$/.test(password) || operation === 'remove' && !status.configured && !status.migrationRequired) return
        pending.current = true; const current = generation.current
        const payload = { operation, ...(operation === 'save' ? { password } : {}) }
        setPassword(''); setBusy(true); setError(''); setMessage('')
        try {
          const reply = await rpc.call('/waimai-login', 'paymentCredential', payload)
          if (current !== generation.current) return
          if (!reply.ok || typeof reply.value?.configured !== 'boolean' || typeof reply.value?.writable !== 'boolean') {
            setStatus(null); setError(reply.error?.message || t('paymentPasswordFailed')); return
          }
          if (reply.value.configured !== (operation === 'save')) { setStatus(null); setError(t('paymentPasswordFailed')); return }
          setStatus({ configured: reply.value.configured, writable: reply.value.writable, migrationRequired: reply.value.migrationRequired === true })
          setMessage(operation === 'save' ? 'paymentPasswordSaved' : 'paymentPasswordRemoved')
        } catch { if (current === generation.current) { setStatus(null); setError(t('paymentPasswordFailed')) } }
        finally { delete payload.password; pending.current = false; if (mounted.current) setBusy(false) }
      }
      return h('section', { className: 'waimai-section', 'aria-label': t('paymentPasswordTitle'), 'aria-busy': busy || loading },
        h('h3', { className: 'waimai-section-title' }, t('paymentPasswordTitle')),
        h('div', { className: 'waimai-stack' }, h('p', { className: 'waimai-hint' }, t('paymentPasswordHint')),
          loading ? h('p', { role: 'status' }, t('paymentPasswordLoading')) : null,
          status ? h('p', { role: 'status' }, t(status.migrationRequired ? 'paymentPasswordMigration' : status.configured ? 'paymentPasswordConfigured' : 'paymentPasswordAbsent')) : null,
          status?.writable === false ? h('p', { className: 'waimai-hint' }, t('paymentPasswordReadOnly')) : null,
          h(Input, { type: 'password', autoComplete: 'new-password', inputMode: 'numeric', maxLength: 6,
            'aria-label': t('paymentPasswordInput'), value: password, disabled: disabled || busy || loading || !status?.writable,
            onChange: event => setPassword(event.target.value), onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void change('save') } } }),
          h('div', { className: 'waimai-actions' },
            h(Button, { type: 'button', disabled: disabled || busy || loading || !status?.writable || !/^\d{6}$/.test(password), onClick: () => void change('save') }, t('paymentPasswordSave')),
            h(Button, { type: 'button', variant: 'outline', disabled: disabled || busy || loading || !status?.writable || !status.configured && !status.migrationRequired, onClick: () => void change('remove') }, t('paymentPasswordRemove')),
            h(Button, { type: 'button', variant: 'ghost', disabled: busy || loading, onClick: () => { generation.current++; setPassword(''); setStatus(null); setRetry(value => value + 1) } }, t('paymentPasswordRefresh'))),
          message ? h('p', { role: 'status' }, t(message)) : null,
          error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null))
    }

    function WaimaiPaymentLoginAccounts({ rpc, t, disabled }) {
      const [accounts, setAccounts] = React.useState(null), [accountRef, setAccountRef] = React.useState('')
      const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(''), [retry, setRetry] = React.useState(0)
      React.useEffect(() => {
        let active = true
        setLoading(true); setError('')
        void rpc.call('/waimai-login', 'accountsList', { platformId: 'taobao' }).then(reply => {
          if (!active) return
          if (!reply.ok || !Array.isArray(reply.value?.accounts)) { setError(reply.error?.message || t('paymentLoginAccountsFailed')); setLoading(false); return }
          setAccounts(reply.value.accounts)
          setAccountRef(current => reply.value.accounts.some(row => row.ref === current) ? current
            : reply.value.accounts.find(row => row.ref === (reply.value.viewAccountRef || reply.value.activeRef))?.ref || reply.value.accounts[0]?.ref || '')
          setLoading(false)
        }).catch(() => { if (active) { setError(t('paymentLoginAccountsFailed')); setLoading(false) } })
        return () => { active = false }
      }, [retry])
      return h('section', { className: 'waimai-section', 'aria-label': t('paymentLoginAccount'), 'aria-busy': loading },
        accounts?.length ? h(Choice, { label: t('paymentLoginAccount'), value: accountRef,
          options: accounts.map(row => [row.ref, row.nickname || t('unnamedAccount')]), t: value => value,
          disabled, onChange: setAccountRef }) : accounts ? h('p', null, t('noSavedAccount')) : null,
        error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null,
        error ? h(Button, { type: 'button', disabled: loading, onClick: () => setRetry(value => value + 1) }, t('paymentLoginAccountsRefresh')) : null,
        accountRef ? h(WaimaiPaymentLogin, { key: accountRef, rpc, t, accountRef, disabled }) : null)
    }

    const pendingPaymentOrder = order => ['待支付', '等待支付'].includes(order.status)

    /** Settings verify only owned pending orders; credential presence is not a sign-in status. */
    function WaimaiPaymentLogin({ rpc, t, accountRef, disabled }) {
      const [records, setRecords] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
      const active = React.useRef(true), pending = React.useRef(false)
      React.useEffect(() => () => { active.current = false }, [])
      const scopedRpc = { call: (channel, method, payload) => rpc.call(channel, method, { ...payload, accountRef }) }
      const load = async () => {
        if (pending.current || disabled) return
        pending.current = true; setBusy(true); setError(''); setRecords(null)
        try {
          const [history, official] = await Promise.all(['tradeHistory', 'orders'].map(method => scopedRpc.call('/waimai-login', method, { platformId: 'taobao' })))
          if (!active.current) return
          if (!history.ok || !official.ok || !Array.isArray(history.value?.attempts) || !Array.isArray(official.value?.orders)
            || !history.value.accountId || history.value.accountId !== official.value.accountId) throw Error('Unverified payment owner')
          const selected = history.value.attempts.filter(record => record.status === 'created'
            && official.value.orders.some(order => record.orderIds?.includes(order.id) && pendingPaymentOrder(order)))
          const checked = await Promise.all(selected.map(async record => {
            try {
              const reply = await scopedRpc.call('/waimai-login', 'paymentStatus', { platformId: 'taobao', orderRef: record.orderRef })
              if (!reply.ok || reply.value.accountId !== history.value.accountId) return { failed: true }
              const value = { ...record, ...reply.value }
              return { record: !['paid', 'failed', 'unknown'].includes(value.paymentStatus)
                && value.officialOrders?.some(order => record.orderIds.includes(order.id) && pendingPaymentOrder(order)) ? value : null }
            } catch { return { failed: true } }
          }))
          if (active.current) { setRecords(checked.flatMap(value => value.record ? [value.record] : [])); if (checked.some(value => value.failed)) setError(t('chatOrderFailed')) }
        } catch { if (active.current) setError(t('chatOrderFailed')) }
        finally { pending.current = false; if (active.current) setBusy(false) }
      }
      return h('section', { className: 'waimai-stack', 'aria-label': t('paymentLoginTitle'), 'aria-busy': busy },
        h('h3', { className: 'waimai-section-title' }, t('paymentLoginTitle')),
        h('p', { className: 'waimai-hint' }, t('paymentLoginHint')),
        h(Button, { type: 'button', variant: 'outline', disabled: busy || disabled, onClick: () => void load() }, t('paymentLoginCheck')),
        !busy && !error && !records ? h('p', { role: 'status' }, t('paymentLoginUnchecked')) : null,
        records?.length === 0 && !error ? h('p', { role: 'status' }, t('paymentLoginEmpty')) : null,
        error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null,
        records?.map(record => h('article', { key: record.orderRef, className: 'waimai-order' },
          h('strong', null, record.merchant), h('p', null, '¥' + (record.amountCents / 100).toFixed(2)),
          h(WaimaiH5Payment, { rpc: scopedRpc, t, record, onReconcile: load, verificationOnly: true }))))
    }

    /** Drafts retain all unedited Host fields; a save patches only changed roots. */
    function WaimaiSettingsForm(props) {
      const snapshot = React.useSyncExternalStore(props.subscribe, props.getSnapshot, props.getSnapshot)
      const [draft, setDraft] = React.useState(() => structuredClone(snapshot.value))
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const [expanded, setExpanded] = React.useState(null)
      const [paymentConnection, setPaymentConnection] = React.useState(null)
      const [checkingPayment, setCheckingPayment] = React.useState(false)
      const paymentCheckRevision = React.useRef(0)
      React.useEffect(() => { setDraft(structuredClone(snapshot.value)) }, [snapshot.revision])
      React.useEffect(() => { paymentCheckRevision.current++; setPaymentConnection(null) }, [snapshot.revision])
      const t = props.t
      if (!draft) return null
      const locked = busy || !snapshot.writable
      const dirty = JSON.stringify(draft) !== JSON.stringify(snapshot.value)
      const change = (field, value) => { paymentCheckRevision.current++; setPaymentConnection(null); setMessage(''); setDraft(current => ({ ...current, [field]: value })) }
      const checkPaymentConnection = async () => {
        if (dirty || busy || checkingPayment) return
        const revision = ++paymentCheckRevision.current
        setCheckingPayment(true)
        setPaymentConnection(null)
        try {
          const reply = await props.rpc.call('/waimai-login', 'paymentConnection', {})
          if (revision !== paymentCheckRevision.current) return
          const value = reply?.ok ? reply.value : null
          const reasons = { 'not-configured': 'paymentNotConfigured', 'invalid-path': 'paymentInvalidPath',
            unavailable: 'paymentUnavailable', 'unexpected-version': 'paymentUnexpectedVersion' }
          setPaymentConnection(value?.available === true ? { key: 'paymentAvailable', version: value.version }
            : { key: reasons[value?.reason] || 'paymentUnavailable' })
        } catch (_error) {
          if (revision === paymentCheckRevision.current) setPaymentConnection({ key: 'paymentUnavailable' })
        } finally { setCheckingPayment(false) }
      }
      const taskChange = (index, field, value) => change('autoTasks', draft.autoTasks.map((task, i) => i === index ? { ...task, [field]: value } : task))
      const hint = key => h('p', { className: 'waimai-hint' }, t(key))
      const toggle = (values, field, label, update, description) => h('div', { key: field, className: 'waimai-toggle-row' },
        h('div', null, h('span', { className: 'waimai-label' }, t(label)), description ? hint(description) : null),
        h(Switch, { label: t(label), checked: values[field] === true, disabled: locked, onChange: value => update(field, value) }))
      const field = (values, name, label, type, update, options = {}) => h('div', { key: name, className: 'waimai-field' },
        h('span', { className: 'waimai-label' }, t(label)),
        type === 'choice' ? h(Choice, { label: t(label), value: values[name], options: options.values,
          onChange: value => update(name, value), disabled: locked, t: options.literal ? value => value : t })
        // InlineEditor saves on Enter and autofocuses. A multiline configuration
        // draft needs ordinary newline entry and the form's explicit Save action.
        : type === 'lines' ? h('textarea', { className: 'waimai-lines', rows: options.rows ?? 3,
          'aria-label': t(label), disabled: locked, required: options.required,
          placeholder: options.placeholder ? t(options.placeholder) : undefined,
          value: (values[name] ?? []).join('\n'), onChange: event => update(name, event.target.value.split('\n')) })
        : h(Input, { className: 'waimai-input', 'aria-label': t(label), disabled: locked,
          type: type === 'time' ? 'text' : type, inputMode: type === 'time' ? 'numeric' : undefined,
          pattern: type === 'time' ? '([01][0-9]|2[0-3]):[0-5][0-9]' : undefined,
          placeholder: type === 'time' ? '11:00' : undefined,
          min: options.min, max: options.max, step: options.step, required: options.required,
          value: values[name] ?? '', onChange: event => update(name, type === 'number' ? event.target.value === '' ? '' : Number(event.target.value) : event.target.value) }),
        options.hint ? hint(options.hint) : null)
      const paymentOptions = [['manual', 'modeManual'], ['auto', 'modeAuto']]
      const section = (key, title, children) => h('section', { key, className: 'waimai-section', 'aria-label': t(title) },
        h('h3', { className: 'waimai-section-title' }, t(title)), children)
      const save = async event => {
        event.preventDefault()
        setBusy(true)
        try {
          const cleaned = { ...draft,
            autoTasks: draft.autoTasks.map(task => ({ ...task,
              ...Object.fromEntries(['menuPool', 'skipDates'].map(field => [field, task[field].map(value => value.trim()).filter(Boolean)])),
            })) }
          const ops = Object.keys(cleaned).filter(key => JSON.stringify(cleaned[key]) !== JSON.stringify(snapshot.value[key]))
            .map(key => ({ op: 'set', path: [key], value: cleaned[key] }))
          const accepted = ops.length === 0 || await props.mutate(ops, snapshot.revision)
          setMessage(accepted ? 'saved' : 'saveFailed')
        } catch (_error) { setMessage('saveFailed') }
        finally { setBusy(false) }
      }
      const addTask = () => {
        const id = crypto.randomUUID()
        change('autoTasks', [...draft.autoTasks, { id, name: '', platformId: props.platformId, enabled: false, triggerTime: '11:00', dateRule: 'workday',
          customDays: ['mon', 'tue', 'wed', 'thu', 'fri'], skipDates: [], menuPool: [], menuStrategy: 'rotate',
          maxOrderAmount: draft.maxOrderAmount, dailyBudget: 50, paymentMode: 'manual', notifyOnSuccess: true, notifyOnFailure: true }])
        setExpanded(id)
      }
      return h('form', { onSubmit: save, className: 'waimai-form', hidden: !['tasks', 'settings', 'paymentSettings'].includes(props.tab) },
        props.tab === 'settings' ? section('order', 'order', h('div', { className: 'waimai-stack' },
          field(draft, 'defaultPlatform', 'defaultPlatformLabel', 'choice', change, { values: props.platforms.map(value => [value.id, value.names[t('platformLanguage')]]), literal: true }),
          toggle(draft, 'hideSponsoredShops', 'hideSponsoredShops', change, 'sponsoredHint'),
          toggle(draft, 'dryRun', 'preview', change, 'previewHint'))) : null,
        props.tab === 'paymentSettings' ? section('paymentSettings', 'purchaseSettings', h('div', { className: 'waimai-stack' },
          h('div', { className: 'waimai-grid' },
            field(draft, 'maxOrderAmount', 'cap', 'number', change, { min: 1, step: 1, required: true }),
            field(draft, 'dailyBudget', 'budget', 'number', change, { min: 0, step: 1, required: true })),
          hint('currencyHint'), field(draft, 'paymentMode', 'mode', 'choice', change, { values: paymentOptions }),
          field(draft, 'checkoutQuoteSeconds', 'checkoutQuoteSeconds', 'number', change, { min: 30, max: 300, step: 1, required: true }),
          hint(draft.paymentMode === 'auto' ? 'autoHint' : 'manualHint'),
          hint('couponsPending'))) : null,
        props.tab === 'paymentSettings' ? section('h5Pay', 'h5Pay', h('div', { className: 'waimai-stack' },
          hint('h5Hint'), field(draft, 'alipayH5BrowserChannel', 'alipayH5BrowserChannel', 'choice', change, { values: ['chrome', 'msedge', 'chromium'].map(value => [value, value]), literal: true }))) : null,
        props.tab === 'paymentSettings' ? h(WaimaiPaymentPassword, { rpc: props.rpc, t, disabled: locked }) : null,
        props.tab === 'paymentSettings' ? h(WaimaiPaymentLoginAccounts, { rpc: props.rpc, t, disabled: locked }) : null,
        props.tab === 'paymentSettings' ? section('alipayAgent', 'alipayAgent', h('div', { className: 'waimai-stack' },
          hint('alipayAgentHint'),
          field(draft, 'alipayAgentExecutable', 'alipayAgentExecutable', 'text', change),
          field(draft, 'alipayAgentTimeoutMs', 'alipayAgentTimeoutMs', 'number', change, { min: 1000, max: 120000, step: 1, required: true }),
          hint('paymentCheckHint'),
          h('div', { className: 'waimai-actions' }, h(Button, { type: 'button', disabled: locked || dirty || checkingPayment,
            onClick: checkPaymentConnection }, t(checkingPayment ? 'paymentChecking' : 'paymentCheck'))),
          dirty ? hint('paymentSaveFirst') : paymentConnection ? h('p', { role: 'status', className: 'waimai-hint' },
            t(paymentConnection.key), paymentConnection.version ? ` · ${paymentConnection.version}` : '') : null)) : null,
        props.tab === 'tasks' ? section('tasks', 'tasks', h('div', { className: 'waimai-stack' },
          hint('taskHint'),
          !draft.autoTasks.some(task => task.platformId === props.platformId) ? h('div', { className: 'waimai-empty' }, h('strong', null, t('emptyTasks')), hint('emptyHint')) : null,
          draft.autoTasks.map((task, index) => ({ task, index })).filter(({ task }) => task.platformId === props.platformId).map(({ task, index }) => {
            const update = (field, value) => taskChange(index, field, value)
            const isOpen = expanded === task.id
            return h('article', { key: task.id, className: 'waimai-task' },
              h('div', { className: 'waimai-task-header' },
                h(Button, { variant: 'ghost', className: 'waimai-task-heading',
                  'aria-expanded': isOpen, 'aria-label': `${t(isOpen ? 'collapseTask' : 'editTask')}: ${task.name || t('untitled')}`,
                  onClick: () => setExpanded(isOpen ? null : task.id) },
                  h('span', null, h('strong', null, task.name || t('untitled')),
                    h('span', { className: 'waimai-task-meta' }, `${task.triggerTime} · ${t(task.dateRule)} · ¥${task.maxOrderAmount}`)),
                  h(IconChevronDownOutlineRegular)),
                h(Tag, { tone: task.enabled ? 'success' : 'neutral' }, t(task.enabled ? 'enabledState' : 'paused')),
                h(Switch, { label: `${t('enabled')}: ${task.name || t('untitled')}`, checked: task.enabled, disabled: locked, onChange: value => update('enabled', value) })),
              isOpen ? h('div', { className: 'waimai-task-editor' },
                field(task, 'name', 'name', 'text', update),
                field(task, 'platformId', 'platform', 'choice', update, { values: props.platforms.map(value => [value.id, value.names[t('platformLanguage')]]), literal: true }),
                h('div', { className: 'waimai-grid' },
                  field(task, 'triggerTime', 'triggerTime', 'time', update, { required: true, hint: 'timeHint' }),
                  field(task, 'dateRule', 'dateRule', 'choice', update, { values: ['workday', 'weekend', 'everyday', 'custom'].map(value => [value, value]) })),
                task.dateRule === 'custom' ? h('div', { className: 'waimai-weekdays' }, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day =>
                  h(Checkbox, { key: day, label: t(day), checked: task.customDays.includes(day), disabled: locked,
                    onChange: selected => update('customDays', selected ? [...task.customDays, day] : task.customDays.filter(value => value !== day)) }))) : null,
                field(task, 'menuPool', 'menuPool', 'lines', update, { required: task.enabled, placeholder: 'menuHint', hint: 'menuHint' }),
                h('div', { className: 'waimai-grid' },
                  field(task, 'maxOrderAmount', 'cap', 'number', update, { min: 1, step: 1, required: true }),
                  field(task, 'dailyBudget', 'budget', 'number', update, { min: 1, step: 1, required: true })),
                field(task, 'paymentMode', 'mode', 'choice', update, { values: paymentOptions }),
                h('details', { className: 'waimai-details' }, h('summary', null, t('taskAdvanced')),
                  h('div', { className: 'waimai-stack' },
                    field(task, 'menuStrategy', 'menuStrategy', 'choice', update, { values: ['rotate', 'random', 'history'].map(value => [value, value]) }),
                    field(task, 'skipDates', 'skipDates', 'lines', update, { rows: 2 }))),
                h(Button, { variant: 'ghost', disabled: locked, icon: h(IconTrashOutlineRegular), className: 'waimai-delete',
                  onClick: () => change('autoTasks', draft.autoTasks.filter((_task, i) => i !== index)) }, t('removeTask'))) : null)
          }),
          h(Button, { variant: 'outline', disabled: locked, icon: h(IconPlusOutlineRegular), onClick: addTask }, t('addTask')))) : null,
        props.tab === 'settings' ? h('details', { className: 'waimai-details waimai-section' }, h('summary', null, t('advanced')),
          h('div', { className: 'waimai-stack' },
            toggle(draft, 'persistLogin', 'persistLogin', change),
            field(draft, 'maxAccountsPerPlatform', 'maxAccountsPerPlatform', 'number', change, { min: 1, max: 100, step: 1, required: true }),
            field(draft, 'historyPageSize', 'historyPageSize', 'number', change, { min: 1, max: 20, step: 1, required: true }),
            field(draft, 'browsePageSize', 'browsePageSize', 'number', change, { min: 1, max: 20, step: 1, required: true }),
            field(draft, 'browseCursorSeconds', 'browseCursorSeconds', 'number', change, { min: 30, max: 3600, step: 1, required: true }),
            field(draft, 'browseCursorLimit', 'browseCursorLimit', 'number', change, { min: 1, max: 1000, step: 1, required: true }),
            field(draft, 'hemaProductPageSize', 'hemaProductPageSize', 'number', change, { min: 1, max: 50, step: 1, required: true }))) : null,
        h('div', { className: 'waimai-footer' },
          h('span', { role: message === 'saveFailed' ? 'alert' : 'status', className: message === 'saveFailed' ? 'waimai-error' : 'waimai-hint' },
            t(busy ? 'saving' : message || (dirty ? 'pending' : 'unchanged'))),
          h('div', { className: 'waimai-actions' },
            dirty ? h(Button, { disabled: locked, onClick: () => { setDraft(structuredClone(snapshot.value)); setMessage('') } }, t('reset')) : null,
            h(Button, { type: 'submit', variant: 'primary', disabled: locked || !dirty }, t(busy ? 'saving' : 'save')))))
    }

    /** Account reads replace one bounded page and discard late replies after refresh or unmount. */
    function WaimaiAccount({ rpc, t, platformId, tab }) {
      const [profile, setProfile] = React.useState(null)
      const [history, setHistory] = React.useState(null)
      const [page, setPage] = React.useState(1)
      const [busy, setBusy] = React.useState(true)
      const [error, setError] = React.useState('')
      const [avatarFailed, setAvatarFailed] = React.useState(false)
      const generation = React.useRef(0)
      const load = async (cursor, pageNumber = 1) => {
        const current = ++generation.current
        setBusy(true); setError('')
        try {
          const [account, orders] = await Promise.all([
            rpc.call('/waimai-login', 'profile', { platformId }),
            tab === 'historyTitle' ? rpc.call('/waimai-login', 'orders', { platformId, ...(cursor ? { cursor } : {}) }) : Promise.resolve({ ok: false }),
          ])
          if (current !== generation.current) return
          if (!account.ok) { setProfile(null); setHistory(null); setError(account.error.message); return }
          if (orders.ok && orders.value.accountId !== account.value.id) {
            setProfile(null); setHistory(null); setError(t('accountChanged')); return
          }
          setProfile(account.value); setAvatarFailed(false)
          setHistory(orders.ok ? orders.value : null)
          setPage(pageNumber)
          if (!orders.ok && orders.error) setError(orders.error.message)
        } catch (_error) {
          if (current === generation.current) setError(t('accountFailed'))
        } finally { if (current === generation.current) setBusy(false) }
      }
      React.useEffect(() => { void load(); return () => { generation.current++ } }, [])
      return h('div', { className: 'waimai-stack', 'aria-busy': busy },
        h('div', { className: 'waimai-history-heading' }, h('h3', { className: 'waimai-section-title' }, t(tab === 'accounts' ? 'accountDetails' : tab)),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void load() }, t(tab === 'historyTitle' ? 'refreshHistory' : 'refreshAccount'))),
        profile ? h('div', { className: 'waimai-account', 'data-compact': tab !== 'accounts' },
          profile.avatarUrl && !avatarFailed
            ? h('img', { className: 'waimai-avatar', src: profile.avatarUrl, alt: t('avatar'), width: 56, height: 56,
              referrerPolicy: 'no-referrer', onError: () => setAvatarFailed(true) })
            : h('span', { className: 'waimai-avatar waimai-avatar-fallback', role: 'img', 'aria-label': t('avatar') }, (profile.nickname || t('unnamedAccount')).slice(0, 1)),
          h('div', { className: 'waimai-account-info' },
            h('strong', { className: 'waimai-account-name', 'aria-label': t('nickname') }, profile.nickname || t('unnamedAccount')),
            tab === 'accounts' ? h('span', { className: 'waimai-hint' }, `${t('accountId')}: ${profile.id}`) : null,
            tab === 'accounts' && profile.maskedPhone ? h('span', { className: 'waimai-hint' }, `${t('accountPhone')}: ${profile.maskedPhone}`) : null,
            avatarFailed || profile.avatarUnavailable ? h('span', { className: 'waimai-hint', role: 'status' }, t(avatarFailed ? 'avatarLoadFailed' : 'avatarUnavailable')) : null)) : null,
        busy && !profile ? h('div', { role: 'status', 'aria-label': t('accountBusy'), className: 'waimai-loader' }, h(StateDot, { state: 'ongoing', size: 20 })) : null,
        error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null,
        profile && tab === 'accounts' ? h(WaimaiAddresses, { key: profile.id, rpc, t, platformId, accountId: profile.id }) : null,
        profile && tab === 'ordering' ? h(WaimaiOrdering, { key: profile.id, rpc, t, platformId, accountId: profile.id }) : null,
        history ? h('div', { className: 'waimai-stack' },
          history.orders.length === 0 ? h('p', { className: 'waimai-empty' }, t('noOrders')) : null,
          history.orders.map(order => h('article', { key: order.id, className: 'waimai-order' },
            h('div', { className: 'waimai-order-heading' }, h('strong', null, order.merchantName), h(Tag, { tone: 'neutral' }, order.status)),
            h('time', { className: 'waimai-hint', dateTime: new Date(order.createdAt).toISOString() }, new Date(order.createdAt).toLocaleString(t('platformLanguage') === 'zh' ? 'zh-CN' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })),
            h('ul', { className: 'waimai-order-items' }, order.items.map((item, index) => h('li', { key: index }, `${item.name} × ${item.count}${item.unit || ''}`))),
            h('div', { className: 'waimai-order-heading' }, h('details', { className: 'waimai-details' }, h('summary', null, t('orderId')), h('span', { className: 'waimai-hint' }, order.id)), h('strong', { className: 'waimai-order-amount' }, `¥${order.amount}`)))),
          h('div', { className: 'waimai-history-heading' }, h('span', { className: 'waimai-hint' }, `${t('page')} ${page}`),
            h('div', { className: 'waimai-actions' },
              page > 1 ? h(Button, { variant: 'ghost', disabled: busy, onClick: () => void load() }, t('latestOrders')) : null,
              history.nextCursor ? h(Button, { variant: 'outline', disabled: busy, onClick: () => void load(history.nextCursor, page + 1) }, t('olderOrders')) : null))) : null)
    }

    /** QR images and attempt references stay in this mounted private view. */
    function WaimaiTaobaoQr({ rpc, t, platformId, loginMethod, onLinked, onProgress }) {
      const [qr, setQr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const generation = React.useRef(0)
      const attempt = React.useRef(null)
      const linked = React.useRef(onLinked); linked.current = onLinked
      const progress = React.useRef(onProgress); progress.current = onProgress
      const call = async (method, payload = {}) => {
        const current = ++generation.current
        setBusy(true); setError('')
        try {
          const result = await rpc.call('/waimai-login', method, { platformId, ...(method === 'qrStart' ? { loginMethod } : {}), ...payload })
          if (current !== generation.current) {
            if (method === 'qrStart' && result.ok && result.value.qr?.attemptId) {
              void rpc.call('/waimai-login', 'qrCancel', { platformId, attemptId: result.value.qr.attemptId }).catch(() => {})
            }
            return
          }
          if (!result.ok) { setError(result.error.message); setQr(value => value ? { ...value, state: 'error' } : null); return }
          const value = result.value.qr
          attempt.current = value?.state === 'linked' ? null : value?.attemptId
          setQr(value)
          progress.current?.(result.value)
          if (value?.state === 'linked') linked.current(result.value)
        } catch {
          if (current === generation.current) { setError(t('loginFailed')); setQr(value => value ? { ...value, state: 'error' } : null) }
        } finally { if (current === generation.current) setBusy(false) }
      }
      React.useEffect(() => {
        void call('qrStart')
        return () => {
          generation.current++
          if (attempt.current) void rpc.call('/waimai-login', 'qrCancel', { platformId, attemptId: attempt.current }).catch(() => {})
        }
      }, [])
      React.useEffect(() => {
        if (!qr || busy || !['waiting', 'scanned', 'business-unconfirmed', 'error'].includes(qr.state)) return
        const deadline = qr.authorizationExpiresAt || qr.expiresAt
        if (deadline && Date.now() >= deadline) {
          setQr(value => ({ ...value, image: undefined, state: value.authorizationExpiresAt ? 'authorization-timeout' : 'expired' }))
          void rpc.call('/waimai-login', 'qrCancel', { platformId, attemptId: qr.attemptId }).catch(() => {})
          attempt.current = null
          return
        }
        const timer = setTimeout(() => void call('qrPoll', { attemptId: qr.attemptId }), deadline ? Math.min(qr.pollAfterMs, deadline - Date.now()) : qr.pollAfterMs)
        return () => clearTimeout(timer)
      }, [qr, busy])
      const authorizing = qr?.state === 'business-unconfirmed' || Boolean(qr?.authorizationExpiresAt && qr?.state === 'error')
      const active = busy || ['waiting', 'scanned', 'business-unconfirmed', 'error'].includes(qr?.state)
      const step = authorizing || qr?.state === 'linked' ? 2 : qr?.state === 'scanned' ? 1 : 0
      return h('div', { className: 'waimai-stack', 'aria-label': t('taobaoQr'), 'aria-busy': busy },
        h('p', { className: 'waimai-hint' }, t(platformId === 'hema' ? 'taobaoAuthorizationHint' : 'qrHint')),
        h('div', { className: 'waimai-qr-content' },
          qr?.image ? h('img', { className: 'waimai-qr-image', src: qr.image, alt: t('taobaoQr'), width: 256, height: 256, referrerPolicy: 'no-referrer' })
            : h('div', { className: 'waimai-qr-placeholder', 'aria-hidden': true }, h(StateDot, { state: active ? 'ongoing' : qr?.state === 'linked' ? 'done' : 'warning', size: 32 })),
          h('div', { className: 'waimai-stack' },
            h('ol', { className: 'waimai-qr-steps' }, ['qrStepScan', 'qrStepConfirm', 'qrStepLogin'].map((key, index) =>
              h('li', { key, 'data-current': active && index === step, 'aria-current': active && index === step ? 'step' : undefined },
                h(StateDot, { state: index < step || qr?.state === 'linked' ? 'done' : active && index === step ? 'ongoing' : 'idle' }), t(key)))),
            h('p', { role: 'status', 'aria-live': 'polite', className: 'waimai-qr-status' },
              t(!qr ? busy ? 'qrStarting' : 'qr_error' : qr.state === 'error' ? 'qrAutoRetry' : `qr_${qr.state.replaceAll('-', '_')}`)),
            authorizing ? h('p', { className: 'waimai-hint' }, t('qrAutoChecking')) : null)),
        h('div', { className: 'waimai-actions' },
          qr && !authorizing ? h(Button, { variant: active ? 'ghost' : 'primary', disabled: busy, onClick: () => void call('qrStart') }, t('qrRestart')) : null,
          !qr && !busy && error ? h(Button, { variant: 'primary', onClick: () => void call('qrStart') }, t('qrStart')) : null,
          qr && active ? h(Button, { variant: 'ghost', disabled: busy,
            onClick: () => void call('qrCancel', { attemptId: qr.attemptId }) }, t('qrCancel')) : null),
        error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null)
    }

    /** Login inputs are transient; only the authenticated Host RPC receives credentials. */
    function WaimaiLoginForm({ rpc, t, platformId, loginMethods, defaultLoginMethod, tab, platformSelector, navigation, onAddAccount, preferredAccountRef, onAccountSelected }) {
      const [phone, setPhone] = React.useState('')
      const [code, setCode] = React.useState('')
      const [status, setStatus] = React.useState({ state: 'not-checked' })
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [retry, setRetry] = React.useState(0)
      const [accountRevision, setAccountRevision] = React.useState(0)
      const [method, setMethod] = React.useState(defaultLoginMethod)
      const [sourceAccountRef, setSourceAccountRef] = React.useState('')
      const [switching, setSwitching] = React.useState(false)
      const generation = React.useRef(0)
      const call = async (endpoint, payload) => {
        const current = ++generation.current
        setBusy(true); setError('')
        setSwitching(endpoint === 'accountView')
        try {
          let result = await rpc.call('/waimai-login', endpoint, { ...(status.viewAccountRef ? { accountRef: status.viewAccountRef } : {}), ...payload, platformId })
          if (current !== generation.current) return
          if (endpoint === 'status' && payload.accountRef && !result.ok && result.error.code === 'account-missing') {
            result = await rpc.call('/waimai-login', 'status', { platformId })
          }
          if (current !== generation.current) return
          if (!result.ok) { setError(result.error.message); return }
          setStatus(result.value); setRetry(result.value.retryAfterSeconds || 0)
          if (Array.isArray(result.value.accounts)) onAccountSelected(result.value.accounts.some(row => row.ref === result.value.viewAccountRef) ? result.value.viewAccountRef : null)
          if (endpoint === 'accountCancel') { setPhone(''); setCode('') }
          if (result.value.pendingLogin) setRetry(result.value.pendingLogin.retryAfterSeconds || 0)
          if (result.value.authenticated && !result.value.pendingLogin) { setPhone(''); setCode(''); setAccountRevision(value => value + 1) }
          else if (endpoint === 'sendCode') setCode('')
        } catch { if (current === generation.current) setError(t('loginFailed')) }
        finally { if (current === generation.current) { setBusy(false); setSwitching(false) } }
      }
      React.useEffect(() => { void call('status', preferredAccountRef ? { accountRef: preferredAccountRef } : {}); return () => { generation.current++ } }, [])
      React.useEffect(() => {
        if (retry <= 0) return
        const timer = setInterval(() => setRetry(value => Math.max(0, value - 1)), 1000)
        return () => clearInterval(timer)
      }, [retry > 0])
      const loginProgress = status.pendingLogin || status
      const challenge = ['verification-required', 'registration-required'].includes(loginProgress.state)
      const scopedRpc = React.useMemo(() => ({ call(channel, endpoint, payload) {
        return rpc.call(channel, endpoint, { ...payload, ...(status.viewAccountRef ? { accountRef: status.viewAccountRef } : {}) })
      } }), [rpc, status.viewAccountRef])
      const showLogin = tab === 'accounts' && status.state !== 'not-checked' && (!status.authenticated || status.addingAccount)
      const selectedMethod = loginMethods.find(value => value.id === method)
      const methodLabel = value => t(value === 'hema-qr' ? 'hemaQr' : value === 'taobao-account' ? 'taobaoAccountLogin' : value === 'taobao-sms' ? 'taobaoSmsLogin' : value === 'sms' ? 'smsLogin' : value === 'taobao-qr' ? platformId === 'hema' ? 'taobaoAuthorization' : 'taobaoQr' : 'unknownLoginMethod')
      const showSms = selectedMethod?.available && selectedMethod.kind === 'sms' && showLogin
      return h('div', { className: 'waimai-stack' },
        h('div', { className: 'waimai-context', 'aria-label': t('accountContext') }, platformSelector,
          h('div', { className: 'waimai-field' }, h('span', { className: 'waimai-label' }, t('accountsTitle')),
            status.accounts?.length ? h(Choice, { label: t('accountsTitle'), value: status.viewAccountRef,
              options: status.accounts.map(account => [account.ref, `${account.nickname || t('unnamedAccount')} · ${methodLabel(account.loginMethod)}`]),
              disabled: busy, t: value => value, onChange: accountRef => void call('accountView', { accountRef }) }) : h('span', { className: 'waimai-hint' }, t('noSavedAccount'))),
          h(Button, { variant: 'outline', disabled: busy || status.addingAccount, icon: h(IconPlusOutlineRegular),
            onClick: () => { onAddAccount(); void call('accountBegin', {}) } }, t('addAccount'))),
        navigation,
        (status.authenticated || !showLogin || showSms) ? h('div', { className: 'waimai-status-row' }, h('div', { className: 'waimai-status-info', role: 'status' },
          h(Tag, { tone: status.authenticated ? 'success' : 'neutral' }, t(`login_${status.state.replaceAll('-', '_')}`)),
          status.authenticated ? h('span', { className: 'waimai-hint' }, methodLabel(status.loginMethod)) : null),
          h(Button, { variant: 'ghost', disabled: busy, onClick: () => void call('status', {}) }, t('refreshLogin'))) : null,
        error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null,
        busy && status.state === 'not-checked' ? h('div', { role: 'status', 'aria-label': t('loginBusy'), className: 'waimai-loader' }, h(StateDot, { state: 'ongoing', size: 20 }), t('loginBusy')) : null,
        showLogin ? h('section', { className: 'waimai-login-panel waimai-stack', 'aria-label': t('loginTitle') },
          h('div', { className: 'waimai-history-heading' }, h('h3', { className: 'waimai-section-title' }, t(status.addingAccount ? 'addAccount' : 'loginTitle')),
            status.addingAccount ? h(Button, { variant: 'ghost', disabled: busy, onClick: () => void call('accountCancel', {}) }, t('cancelAddAccount')) : null),
          h('div', { className: 'waimai-methods', role: 'group', 'aria-label': t('loginMethod') },
            loginMethods.map(value => h(Button, { key: value.id, variant: method === value.id ? 'primary' : 'outline', 'aria-pressed': method === value.id,
              disabled: busy, onClick: () => { setMethod(value.id); setPhone(''); setCode(''); setError('') } }, methodLabel(value.id)))),
        h('p', { className: 'waimai-hint' }, `${t('defaultLoginMethod')}：${methodLabel(defaultLoginMethod)}`),
        selectedMethod && !selectedMethod.available ? h('p', { className: 'waimai-empty', role: 'status' }, t('hemaQrUnavailable')) : null,
        selectedMethod?.kind === 'reuse' ? h('p', { className: 'waimai-hint' }, t(status.taobaoAccounts?.length ? 'reuseTaobaoHint' : 'noReusableTaobao')) : null,
        selectedMethod?.available && selectedMethod.kind === 'reuse' && status.taobaoAccounts?.length ? h('div', { className: 'waimai-grid' },
          h(Choice, { label: t('sourceTaobaoAccount'), value: sourceAccountRef || status.taobaoAccounts[0].ref,
            options: status.taobaoAccounts.map(row => [row.ref, row.nickname || t('unnamedAccount')]), t: value => value,
            disabled: busy, onChange: setSourceAccountRef }),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void call('useTaobao', { sourceAccountRef: sourceAccountRef || status.taobaoAccounts[0].ref }) }, t('useTaobaoAccount'))) : null,
        selectedMethod?.available && selectedMethod.kind === 'qr' ? h(WaimaiTaobaoQr, { key: method, rpc: scopedRpc, t, platformId, loginMethod: method, onProgress: value => setStatus(value), onLinked: value => {
          generation.current++; setBusy(false); setError(''); setStatus(value); setPhone(''); setCode(''); setAccountRevision(revision => revision + 1)
          if (value.accounts?.some(row => row.ref === value.viewAccountRef)) onAccountSelected(value.viewAccountRef)
        } }) : null,
        showSms ? h('div', { className: 'waimai-grid' },
          h('label', { className: 'waimai-field' }, h('span', { className: 'waimai-label' }, t('phone')),
            h(Input, { type: 'tel', autoComplete: 'tel', inputMode: 'numeric', maxLength: 11,
              value: phone, disabled: busy, onChange: event => { setPhone(event.target.value); setCode(''); setStatus(current => ({ ...current, codePending: false, ...(current.pendingLogin ? { pendingLogin: { ...current.pendingLogin, codePending: false } } : {}) })) } })),
          h('label', { className: 'waimai-field' }, h('span', { className: 'waimai-label' }, t('smsCode')),
            h(Input, { type: 'text', autoComplete: 'one-time-code', inputMode: 'numeric', maxLength: 8,
              value: code, disabled: busy || !loginProgress.codePending || challenge, onChange: event => setCode(event.target.value) }))) : null,
        showSms && status.pendingLogin ? h('p', { role: 'status', className: 'waimai-hint' }, t(`login_${loginProgress.state.replaceAll('-', '_')}`), loginProgress.maskedPhone ? ` · ${loginProgress.maskedPhone}` : '') : null,
        showSms ? h('div', { className: 'waimai-actions' },
          h(Button, { variant: 'outline', disabled: busy || retry > 0 || !/^1[3-9]\d{9}$/.test(phone),
            onClick: () => void call('sendCode', { phone, loginMethod: method }) }, retry > 0 ? `${t('sendCode')} (${retry}s)` : t('sendCode')),
          h(Button, { variant: 'primary', disabled: busy || !loginProgress.codePending || challenge || !/^\d{4,8}$/.test(code) || (method === 'taobao-sms' && !loginProgress.attemptId),
            onClick: () => void call('complete', { code, loginMethod: method, ...(method === 'taobao-sms' ? { smsAttemptId: loginProgress.attemptId } : {}) }) }, t('signIn'))) : null,
        selectedMethod?.available && selectedMethod.kind !== 'reuse' ? h('p', { className: 'waimai-hint' }, t(method === 'taobao-sms' ? 'taobaoSmsHint' : method === 'sms' ? 'smsAccountHint' : 'loginProtocol')) : null) : null,
        status.authenticated && !switching && ['accounts', 'historyTitle', 'ordering'].includes(tab)
          ? h(WaimaiAccount, { key: `${status.viewAccountRef}:${accountRevision}:${tab}`, rpc: scopedRpc, t, platformId, tab })
          : null)
    }

    /** Private addresses are re-read on save and discarded on account or platform changes. */
    function WaimaiAddresses({ rpc, t, platformId, accountId, onSelected }) {
      const [data, setData] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const generation = React.useRef(0)
      const call = async (endpoint, payload = {}) => {
        const current = ++generation.current
        setBusy(true); setError('')
        if (endpoint === 'selectAddress') onSelected?.(null)
        try {
          const reply = await rpc.call('/waimai-login', endpoint, { platformId, ...payload })
          if (current !== generation.current) return
          if (!reply.ok) { onSelected?.(null); setError(reply.error.message); return }
          if (reply.value.accountId !== accountId) { onSelected?.(null); setData(null); setError(t('accountChanged')); return }
          const fresh = endpoint === 'selectAddress' ? await rpc.call('/waimai-login', 'addresses', { platformId }) : reply
          if (current !== generation.current) return
          if (!fresh.ok) { onSelected?.(null); setError(fresh.error.message); return }
          if (fresh.value.accountId !== accountId) { onSelected?.(null); setData(null); setError(t('accountChanged')); return }
          if (endpoint === 'selectAddress' && fresh.value.selectedRef !== payload.addressRef) { onSelected?.(null); setError(t('addressFailed')); return }
          setData(fresh.value)
          onSelected?.(fresh.value.selectedRef)
        } catch { if (current === generation.current) { onSelected?.(null); setError(t('addressFailed')) } }
        finally { if (current === generation.current) setBusy(false) }
      }
      React.useEffect(() => { void call('addresses'); return () => { generation.current++ } }, [])
      const renderAddress = address => h('article', { key: address.ref, className: 'waimai-order', 'data-selected': data.selectedRef === address.ref },
        h('div', { className: 'waimai-history-heading' }, h('strong', null, address.address),
          data.selectedRef === address.ref ? h(Tag, { tone: 'success' }, t('selectedAddress')) : null),
        h('p', { className: 'waimai-hint' }, `${address.contact} · ${address.maskedPhone}${address.label ? ' · ' + address.label : ''}`),
        data.selectedRef !== address.ref ? h(Button, { variant: 'outline', disabled: busy || !address.usable,
          onClick: () => void call('selectAddress', { accountId, addressRef: address.ref }) }, t(address.usable ? 'selectAddress' : 'addressUnavailable')) : null)
      const selected = data?.addresses.find(address => address.ref === data.selectedRef)
      return h('section', { className: 'waimai-stack', 'aria-busy': busy, 'aria-label': t('addresses') },
        h('div', { className: 'waimai-history-heading' }, h('h4', { className: 'waimai-section-title' }, t('addresses')),
          h(Button, { disabled: busy, variant: 'outline', onClick: () => void call('addresses') }, t('refreshAddresses'))),
        error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null,
        busy && !data ? h('div', { role: 'status', 'aria-label': t('refreshAddresses'), className: 'waimai-loader' }, h(StateDot, { state: 'ongoing', size: 20 })) : null,
        data?.addresses.length === 0 ? h('p', { className: 'waimai-empty' }, t('noAddresses')) : null,
        selected ? renderAddress(selected) : data?.addresses.length ? h('p', { className: 'waimai-hint' }, t('noSelectedAddress')) : null,
        data?.addresses.some(address => address.ref !== data.selectedRef) ? h('details', { className: 'waimai-details waimai-address-picker' },
          h('summary', null, `${t(selected ? 'addressPicker' : 'addresses')} · ${data.addresses.length - (selected ? 1 : 0)}`),
          h('div', { className: 'waimai-address-list' }, data.addresses.filter(address => address.ref !== data.selectedRef).map(renderAddress))) : null)
    }

    /** Delivery changes invalidate all shop and menu reads before another address can load. */
    function WaimaiCart({ rpc, t, platformId, accountId, addressRef, onRead, onCheckout }) {
      const [chosen, setChosen] = React.useState([])
      const [cart, setCart] = React.useState(null), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState(''), [visible, setVisible] = React.useState(20)
      const generation = React.useRef(0)
      const load = async () => {
        const current = ++generation.current
        setBusy(true); setMessage('')
        try {
          const reply = await rpc.call('/waimai-login', 'cart', { platformId, addressRef })
          if (current !== generation.current) return
          if (!reply.ok) {
            if (['address-changed', 'address-required', 'account-changed', 'session-expired'].includes(reply.error.code)) setCart(null)
            setMessage(reply.error.message); return
          }
          if (reply.value.accountId !== accountId || reply.value.addressRef !== addressRef) { setCart(null); setMessage(t('accountChanged')); return }
          setCart(reply.value); setVisible(20); setChosen(reply.value.items.filter(item => item.selected && item.available && item.quantity === '1').map(item => item.id)); onRead?.(reply.value)
        } catch { if (current === generation.current) setMessage(t('accountFailed')) }
        finally { if (current === generation.current) setBusy(false) }
      }
      React.useEffect(() => { void load(); return () => { generation.current++ } }, [])
      return h('section', { className: 'waimai-stack waimai-cart', 'aria-busy': busy },
        h('div', { className: 'waimai-history-heading' }, h('h4', { className: 'waimai-section-title' }, t('cartTitle')),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void load() }, t('refreshCart'))),
        cart ? h(React.Fragment, null,
          h('p', { className: 'waimai-hint' }, `${t('cartCount')}: ${cart.items.length} · ${t('cartAvailable')}: ${cart.availableCount} · ${t('cartSelected')}: ${cart.selectedCount}`),
          cart.items.length ? h('div', { className: 'waimai-food-grid' }, cart.items.slice(0, visible).map(item => h('article', { key: item.id, className: 'waimai-food-card' },
            onCheckout ? h(Checkbox, { className: 'waimai-methods', label: t('checkoutSelect') + ' · ' + item.name,
              checked: chosen.includes(item.id), disabled: busy || !item.available || item.quantity !== '1',
              onChange: selected => setChosen(current => selected ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id)) }) : null,
            h('div', { className: 'waimai-food-top' }, item.imageUrl ? h('img', { src: item.imageUrl, alt: item.name, className: 'waimai-food-image', loading: 'lazy', referrerPolicy: 'no-referrer' }) : null,
              h('div', { className: 'waimai-food-info' }, h('strong', null, item.name),
                h('p', { className: 'waimai-price' }, `${t('advertisedPrice')} ¥${item.price} ${item.priceUnit}`),
                h('p', { className: 'waimai-hint' }, `${t('cartQuantity')}: ${item.quantity} ${item.quantityUnit}${item.specification ? ' · ' + item.specification : ''}`))),
            !item.available ? h(Tag, { tone: 'neutral' }, item.reason || t('cartUnavailable')) : null,
            item.selected ? h(Tag, { tone: 'neutral' }, t('cartSelected')) : null))) : h('p', { className: 'waimai-empty' }, t('cartEmpty')),
          cart.items.length > visible ? h(Button, { variant: 'outline', onClick: () => setVisible(count => count + 20) }, t('moreCart')) : null,
          onCheckout ? h(Button, { variant: 'primary', disabled: busy || !chosen.length || cart.mutation?.state === 'unconfirmed',
            onClick: () => onCheckout({ revision: cart.revision, lineIds: chosen }) }, t('checkout') + ' · ' + chosen.length) : null) : null,
        message ? h('p', { role: 'alert', className: 'waimai-error' }, message) : null,
        cart?.mutation?.state === 'unconfirmed' ? h('p', { role: 'status' }, t('cartUnconfirmed')) : null,
        h('p', { className: 'waimai-hint' }, t(platformId === 'hema' ? 'hemaCartHint' : 'cartReadOnly')))
    }

    function WaimaiOrdering({ rpc, t, platformId, accountId, initialShop, recommendedItemIds, maxAmountCents, inline = false }) {
      const [hemaCheckout, setHemaCheckout] = React.useState(null)
      const [addressRef, setAddressRef] = React.useState(null)
      const [scope, setScope] = React.useState('nearbyShops')
      const [page, setPage] = React.useState(null)
      const [pageNumber, setPageNumber] = React.useState(1)
      const [shop, setShop] = React.useState(null)
      const [menu, setMenu] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [showCart, setShowCart] = React.useState(false)
      const [itemToAdd, setItemToAdd] = React.useState(null)
      const [tradeBusy, setTradeBusy] = React.useState(false)
      const [keyword, setKeyword] = React.useState('')
      const [menuKeyword, setMenuKeyword] = React.useState('')
      const [category, setCategory] = React.useState('')
      const [visibleCount, setVisibleCount] = React.useState(20)
      const [allMenu, setAllMenu] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const generation = React.useRef(0)
      const address = React.useRef(null)
      const onSelected = React.useCallback(ref => {
        if (address.current === ref) return
        address.current = ref; generation.current++
        setItemToAdd(null); setTradeBusy(false)
        setPage(null); setMenu(null); setDetail(null); setShowCart(false); setShop(null); setMessage(''); setBusy(false); setKeyword(''); setAddressRef(ref)
      }, [])
      const accept = value => {
        if (value.accountId !== accountId || value.addressRef !== address.current) {
          generation.current++; setPage(null); setMenu(null); setDetail(null); setShop(null); setBusy(false)
          setMessage(t(value.accountId !== accountId ? 'accountChanged' : 'addressFailed')); return false
        }
        return true
      }
      const load = async (cursor, number = 1) => {
        if (!address.current) return
        const current = ++generation.current
        setBusy(true); setMessage('')
        try {
          const reply = await rpc.call('/waimai-login', scope, { platformId, addressRef: address.current, ...(cursor ? { cursor } : {}) })
          if (current !== generation.current) return
          if (!reply.ok) {
            if (['address-changed', 'address-required', 'account-changed'].includes(reply.error.code)) { setPage(null); setMenu(null); setShop(null) }
            setMessage(reply.error.message); return
          }
          if (!accept(reply.value)) return
          setPage(reply.value); setPageNumber(number); setMenu(null); setDetail(null); setShop(null)
        } catch { if (current === generation.current) setMessage(t('accountFailed')) }
        finally { if (current === generation.current) setBusy(false) }
      }
      const loadMenu = async (selected, query = menuKeyword, cursor) => {
        if (!address.current) return
        const current = ++generation.current
        setBusy(true); setMessage('')
        setDetail(null)
        if (shop?.id !== selected.id) { setMenu(null); setMenuKeyword(''); setCategory(''); setVisibleCount(20); setItemToAdd(null); setTradeBusy(false) }
        setShop(selected)
        try {
          const reply = await rpc.call('/waimai-login', 'probeMenu', { platformId, shopId: selected.id, addressRef: address.current,
            ...(platformId === 'hema' ? { keyword: query, ...(cursor ? { cursor } : {}) } : {}) })
          if (current !== generation.current) return
          if (!reply.ok) {
            if (['address-changed', 'address-required', 'account-changed'].includes(reply.error.code)) { setPage(null); setMenu(null); setShop(null) }
            setMessage(reply.error.message); return
          }
          if (!accept(reply.value)) return
          if (reply.value.shopId !== selected.id) { setMenu(null); setMessage(t('accountFailed')); return }
          setMenu(reply.value); setVisibleCount(20); setCategory('')
        } catch { if (current === generation.current) setMessage(t('accountFailed')) }
        finally { if (current === generation.current) setBusy(false) }
      }
      const loadDetail = async item => {
        const current = ++generation.current
        setBusy(true); setMessage('')
        try {
          const reply = await rpc.call('/waimai-login', 'productDetail', { platformId, addressRef: address.current, productRef: item.productRef })
          if (current !== generation.current) return
          if (!reply.ok) { setMessage(reply.error.message); return }
          if (!accept(reply.value)) return
          if (reply.value.productRef !== item.productRef || reply.value.shopId !== shop.id || reply.value.product.id !== item.id) { setDetail(null); setMessage(t('accountFailed')); return }
          setDetail(reply.value)
        } catch { if (current === generation.current) setMessage(t('accountFailed')) }
        finally { if (current === generation.current) setBusy(false) }
      }
      React.useEffect(() => {
        setPage(null); setMenu(null); setDetail(null); setShowCart(false); setShop(null); setMessage(''); setKeyword('')
        if (initialShop && addressRef) void loadMenu(initialShop)
        else void load()
        return () => { generation.current++ }
      }, [addressRef, scope])
      const lower = value => value.toLocaleLowerCase().trim()
      const shops = (page?.shops || []).filter(value => lower(value.name).includes(lower(keyword)))
      const items = new Map()
      for (const group of menu?.categories || []) if (!category || group.id === category) {
        for (const item of group.items) if ((!recommendedItemIds?.length || allMenu || recommendedItemIds.includes(item.id)) && (platformId === 'hema' || lower(item.name + ' ' + item.description).includes(lower(menuKeyword)))) items.set(item.id, item)
      }
      const image = (url, label) => url ? h('img', { src: url, alt: label, className: 'waimai-food-image', loading: 'lazy', referrerPolicy: 'no-referrer',
        onError: event => { event.currentTarget.style.visibility = 'hidden' } }) : null
      return h('section', { className: 'waimai-stack', 'aria-busy': busy },
        h(WaimaiAddresses, { rpc, t, platformId, accountId, onSelected }),
        !addressRef ? h('p', { role: 'status', className: 'waimai-empty' }, t('selectAddressFirst')) : h(React.Fragment, null,
          h('div', { className: 'waimai-history-heading' },
            h('div', { className: 'waimai-methods' }, ['nearbyShops', 'recentShops'].map(value => h(Button, { key: value,
              variant: !showCart && scope === value ? 'primary' : 'outline', 'aria-pressed': !showCart && scope === value,
              onClick: () => { setShowCart(false); setScope(value) } }, t(value))),
              platformId === 'hema' ? h(Button, { variant: showCart ? 'primary' : 'outline', 'aria-pressed': showCart, onClick: () => {
                generation.current++; setBusy(false); setMessage(''); setShowCart(true)
              } }, t('viewCart')) : null),
            !showCart ? h(Button, { disabled: busy, variant: 'outline', onClick: () => void load() }, t('refreshShops')) : null),
          scope === 'recentShops' ? h('p', { className: 'waimai-hint' }, t('recentScope')) : null,
          showCart ? hemaCheckout ? h(React.Fragment, null,
            h(Button, { variant: 'ghost', onClick: () => setHemaCheckout(null) }, t('viewCart')),
            h(WaimaiHemaCheckout, { key: `checkout:${accountId}:${addressRef}`, rpc, t, accountId, addressRef, selection: hemaCheckout, maxAmountCents }))
            : h(WaimaiCart, { key: `cart:${accountId}:${addressRef}`, rpc, t, platformId, accountId, addressRef, onCheckout: platformId === 'hema' ? setHemaCheckout : undefined }) : shop ? h('div', { className: 'waimai-stack waimai-menu-panel' },
            h('div', { className: 'waimai-history-heading' }, h('h4', { className: 'waimai-section-title' }, shop.name),
              h('div', { className: 'waimai-methods' }, h(Button, { variant: 'ghost', onClick: () => {
                generation.current++; setBusy(false); setShop(null); setMenu(null); setDetail(null); setMessage('')
              } }, t('backToShops')), h(Button, { variant: 'outline', disabled: busy, onClick: () => void loadMenu(shop) }, t('refreshMenu')))),
            detail ? h('section', { className: 'waimai-stack' },
              h(Button, { variant: 'outline', onClick: () => setDetail(null) }, t('backToProducts')),
              h(WaimaiProductSummary, { product: detail.product, t }),
              h(WaimaiHemaPurchase, { key: detail.productRef, product: detail.product, productRef: detail.productRef, accountId, addressRef, rpc, t }),
              h('p', { className: 'waimai-hint' }, t('menuPriceHint'))) : menu ? h(React.Fragment, null,
              h('div', { className: 'waimai-grid' }, h(Choice, { value: category, label: t('menuCategory'), t: value => value,
                options: [['', t('allCategories')], ...menu.categories.map(group => [group.id, `${group.name} (${group.items.length})`])],
                onChange: value => { setCategory(value); setVisibleCount(20) } }),
                h(Input, { value: menuKeyword, 'aria-label': t('menuSearch'), placeholder: t('menuSearch'),
                  onChange: event => { setMenuKeyword(event.target.value); setVisibleCount(20) } })),
              platformId === 'hema' ? h(Button, { variant: 'primary', disabled: busy || !menuKeyword.trim(), onClick: () => void loadMenu(shop) }, t('searchProducts')) : null,
              h('p', { className: 'waimai-hint' }, t('menuPriceHint')),
              recommendedItemIds?.length && !allMenu ? h(Button, { variant: 'ghost', onClick: () => setAllMenu(true) }, t('chatAllMenu')) : null,
              !items.size ? h('p', { className: 'waimai-empty', role: 'status' }, menu.notice || t(menu.queryRequired ? 'menuSearch' : menu.categories.length ? 'noMatches' : 'noMenu')) : null,
              h('div', { className: 'waimai-food-grid' }, [...items.values()].slice(0, visibleCount).map(item => h('article', { key: item.id, className: 'waimai-food-card' },
                h('div', { className: 'waimai-food-top' }, image(item.imageUrl, item.name), h('div', { className: 'waimai-food-info' },
                  h('strong', null, item.name), item.description ? h('p', { className: 'waimai-hint' }, item.description) : null,
                  h('div', { className: 'waimai-methods' }, h('span', { className: 'waimai-price' }, item.price === null ? t('priceUnavailable') : `${t('advertisedPrice')} ¥${item.price}${item.priceUnit ? ' / ' + item.priceUnit : ''}`),
                    ['sold-out', 'outside-sale-time'].includes(item.availability) ? h(Tag, { tone: 'neutral' }, t(item.availability === 'sold-out' ? 'soldOut' : 'outsideSaleTime')) : null),
                  item.tips.length ? h('p', { className: 'waimai-hint' }, item.tips.join(' · ')) : null)),
                platformId === 'hema' && item.productRef ? h(Button, { variant: 'outline', disabled: busy, onClick: () => void loadDetail(item) }, t('productDetails')) : null,
                platformId === 'taobao' ? h(Button, { variant: 'outline', disabled: busy || tradeBusy || item.availability !== 'available',
                  onClick: () => { setTradeBusy(true); setItemToAdd({ ...item, operationRef: crypto.randomUUID() }) } },
                  itemToAdd?.id === item.id && tradeBusy ? t('cartBusy') : t(item.requiresSelection || item.options.length ? 'chooseSpecifications' : 'addToCart')) : null,
                item.options.length ? h('details', { className: 'waimai-details' }, h('summary', null, t('itemOptions')),
                  item.options.map((option, index) => h('div', { key: index, className: 'waimai-option' }, h('strong', null, option.name),
                    h('p', { className: 'waimai-hint' }, option.values.map(value => value.name + (value.available === false ? ` (${t('optionUnavailable')})` : '')).join(' · '))))) : null))),
              items.size > visibleCount ? h(Button, { variant: 'outline', onClick: () => setVisibleCount(count => count + 20) }, t('moreItems')) : null,
              platformId === 'hema' && menu.query ? h('div', { className: 'waimai-methods' },
                h(Button, { variant: 'outline', disabled: busy, onClick: () => void loadMenu(shop, menu.query) }, t('firstProducts')),
                h(Button, { variant: 'outline', disabled: busy || !menu.nextCursor, onClick: () => void loadMenu(shop, menu.query, menu.nextCursor) }, t('nextProducts'))) : null) : null)
          : h(React.Fragment, null,
            page ? h(Input, { value: keyword, 'aria-label': t('shopFilter'), placeholder: t('shopFilter'), onChange: event => setKeyword(event.target.value) }) : null,
            page && !shops.length ? h('p', { className: 'waimai-empty' }, t(keyword ? 'noMatches' : page.filteredAds ? 'adsFiltered' : scope === 'nearbyShops' ? 'noNearbyShops' : 'noShops')) : null,
            h('div', { className: 'waimai-food-grid' }, shops.map(value => h('article', { key: value.id, className: 'waimai-food-card' },
              h('div', { className: 'waimai-food-top' }, image(value.imageUrl, value.name), h('div', { className: 'waimai-food-info' },
                h('strong', null, value.name),
                h('p', { className: 'waimai-hint' }, [value.rating, value.sales, value.deliveryTime, value.distance].filter(Boolean).join(' · ')),
                h('p', { className: 'waimai-hint' }, [value.minimumOrder !== null && value.minimumOrder !== undefined ? `${t('minimumOrder')} ¥${value.minimumOrder}` : '', value.deliveryFee].filter(Boolean).join(' · ')))),
              value.tags?.length ? h('p', { className: 'waimai-hint' }, value.tags.join(' · ')) : null,
              h('div', { className: 'waimai-history-heading' }, value.isAd ? h(Tag, { tone: 'neutral' }, t('ad')) : h('span'),
                h(Button, { variant: 'outline', disabled: busy || value.menuAvailable === false, onClick: () => void loadMenu(value, '') }, t('viewMenu')))))),
            page ? h('div', { className: 'waimai-history-heading' }, h('span', { className: 'waimai-hint' }, `${t('page')} ${pageNumber}`),
              h('div', { className: 'waimai-methods' }, pageNumber > 1 ? h(Button, { disabled: busy, variant: 'ghost', onClick: () => void load() }, t('firstShops')) : null,
                page.nextCursor ? h(Button, { disabled: busy, variant: 'outline', onClick: () => void load(page.nextCursor, pageNumber + 1) }, t('nextShops')) : null)) : null),
          busy ? h('div', { role: 'status', 'aria-label': t('accountBusy'), className: 'waimai-loader' }, h(StateDot, { state: 'ongoing', size: 20 })) : null,
          message ? h('p', { role: 'alert', className: 'waimai-error' }, message) : null,
          platformId === 'taobao' && shop && menu ? h(WaimaiTrade, { key: `${accountId}:${addressRef}:${shop.id}`, rpc, t,
            accountId, addressRef, shopId: shop.id, itemToAdd, maxAmountCents, inline, onConsumed: () => setItemToAdd(null), onBusy: setTradeBusy }) : null,
          platformId === 'hema' && !detail && !showCart ? h(WaimaiHemaPurchase, { key: `purchase:${accountId}:${addressRef}`, accountId, addressRef, rpc, t }) : null,
          platformId !== 'taobao' ? h('p', { className: 'waimai-hint' }, t('orderingBlocked')) : null))
    }

    /** Financial actions consume an opaque Host quote; account/address/shop changes unmount all private state. */
    function WaimaiTrade({ rpc, t, accountId, addressRef, shopId, itemToAdd, onConsumed = () => {}, onBusy = () => {}, inline = false, initialQuote, maxAmountCents }) {
      const [cart, setCart] = React.useState(null), [quote, setQuote] = React.useState(null), [order, setOrder] = React.useState(null)
      const [officialOrders, setOfficialOrders] = React.useState([])
      const [records, setRecords] = React.useState([]), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false)
      const [confirmed, setConfirmed] = React.useState(false), [now, setNow] = React.useState(Date.now)
      const [uncertain, setUncertain] = React.useState(false)
      const [open, setOpen] = React.useState(false), [selection, setSelection] = React.useState(null)
      const [variantRef, setVariantRef] = React.useState(''), [choices, setChoices] = React.useState([]), [quantity, setQuantity] = React.useState(1)
      const [notice, setNotice] = React.useState(null), [operation, setOperation] = React.useState('')
      const alive = React.useRef(true), inFlight = React.useRef(false), consumed = React.useRef(null)
      const money = value => `¥${(value / 100).toFixed(2)}`
      const base = { platformId: 'taobao', addressRef, shopId }
      const read = async (endpoint, payload) => {
        const reply = await rpc.call('/waimai-login', endpoint, payload)
        if (!reply.ok) { const error = new Error(reply.error.message); error.code = reply.error.code; throw error }
        if (reply.value.accountId !== accountId || (reply.value.addressRef !== undefined && reply.value.addressRef !== addressRef)
          || (reply.value.shopId !== undefined && reply.value.shopId !== shopId)) throw new Error(t('accountChanged'))
        return reply.value
      }
      const run = async (endpoint, payload) => {
        if (inFlight.current) return
        inFlight.current = true; setBusy(true); setOperation(endpoint); onBusy(true); setMessage(''); setConfirmed(false)
        if (endpoint !== 'submit') { setQuote(null); setOrder(null) }
        try {
          let value
          if (endpoint === 'cartChange') {
            const current = cart || await read('cart', base)
            value = await read(endpoint, { ...base, revision: current.revision, ...payload })
          } else value = await read(endpoint, payload)
          if (!alive.current) return
          if (endpoint === 'checkout') { setQuote(value); setNow(Date.now()) }
          else if (endpoint === 'submit') { setQuote(null); setOrder(value); setRecords(current => current.filter(record => record.orderRef !== value.orderRef)) }
          else { setCart(value); setUncertain(false) }
          if (endpoint === 'cartChange') {
            setNotice({ id: crypto.randomUUID(), text: `${payload.step === 1 ? t('cartAdded') : t('cartRemoved')} · ${payload.quantity || 1} ${t('cartItems')}`, tone: 'success' })
            setSelection(null)
          }
        } catch (error) {
          if (alive.current) { setMessage(error.message || t('accountFailed')); setNotice({ id: crypto.randomUUID(), text: error.message || t('accountFailed') });
            if (endpoint === 'cartChange' && (!selection || ['cart-unavailable', 'cart-invalid', 'cart-result-unconfirmed', 'cart-duplicate'].includes(error.code))) { setSelection(null); setOpen(true) }
            if (endpoint === 'submit') { setQuote(null); setUncertain(true) } }
        } finally {
          inFlight.current = false
          if (alive.current) { setBusy(false); onBusy(false); if (endpoint === 'cartChange') onConsumed() }
        }
      }
      React.useEffect(() => {
        alive.current = true
        void (async () => { await run('cart', base); if (initialQuote && alive.current) await run('checkout', { ...base, revision: initialQuote.revision }) })()
        void read('tradeHistory', { platformId: 'taobao' }).then(value => { if (alive.current) setRecords(value.attempts) })
          .catch(error => { if (alive.current) setMessage(error.message || t('accountFailed')) })
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => { alive.current = false; clearInterval(timer); onBusy(false) }
      }, [])
      React.useEffect(() => {
        if (itemToAdd && !busy && consumed.current !== itemToAdd.operationRef) {
          consumed.current = itemToAdd.operationRef
          if (itemToAdd.requiresSelection || itemToAdd.options?.length) void loadSelection(itemToAdd)
          else void run('cartChange', { itemId: itemToAdd.id, step: 1, operationRef: itemToAdd.operationRef })
        }
      }, [itemToAdd, busy])
      const loadSelection = async item => {
        if (inFlight.current) return
        inFlight.current = true; setBusy(true); setOperation('itemOptions'); onBusy(true); setMessage(''); setOpen(false)
        setSelection({ loading: true, name: item.name, itemId: item.id, operationRef: item.operationRef })
        try {
          const value = await read('itemOptions', { ...base, itemId: item.id })
          if (!alive.current) return
          setSelection({ ...value, operationRef: item.operationRef }); setVariantRef(value.variants.length === 1 && value.variants[0].available ? value.variants[0].ref : '')
          setChoices((value.variants.length === 1 ? value.variants[0].groups || value.groups : []).flatMap(group => group.choices.filter(choice => choice.selected && choice.available).map(choice => choice.ref))); setQuantity(value.minimumQuantity)
        } catch (error) {
          if (alive.current) { setSelection(null); setMessage(error.message || t('accountFailed')); setNotice({ id: crypto.randomUUID(), text: error.message || t('accountFailed') }); setOpen(true) }
        } finally { inFlight.current = false; if (alive.current) { setBusy(false); onBusy(false); onConsumed() } }
      }
      const closeSelection = () => { if (!busy) { setSelection(null); onConsumed(); onBusy(false) } }
      const selectedVariant = selection?.variants?.find(value => value.ref === variantRef)
      const selectionGroups = selectedVariant?.groups || selection?.groups || []
      const selectionPrice = (selectedVariant?.priceCents || 0) + selectionGroups.flatMap(group => group.choices).filter(choice => choices.includes(choice.ref)).reduce((sum, choice) => sum + (choice.priceCents || 0), 0)
      const conflicts = choice => (choice.excludes || []).some(ref => choices.includes(ref)) || selectionGroups.flatMap(group => group.choices).some(value => choices.includes(value.ref) && (value.excludes || []).includes(choice.ref))
      const selectVariant = value => { setVariantRef(value.ref); setChoices((value.groups || selection.groups).flatMap(group => group.choices.filter(choice => choice.selected && choice.available).map(choice => choice.ref))) }
      const selectionReady = selection && !selection.loading && variantRef && Number.isInteger(quantity) && quantity >= selection.minimumQuantity && quantity <= Math.min(100, selectedVariant?.stock ?? 100) && selectionGroups.every(group => {
        const count = group.choices.filter(choice => choices.includes(choice.ref)).length
        return count >= group.minimum && count <= group.maximum && group.choices.filter(choice => choices.includes(choice.ref)).every(choice => choice.available && !conflicts(choice))
      })
      const choose = (group, ref) => setChoices(current => current.includes(ref) ? current.filter(value => value !== ref)
        : group.maximum === 1 ? [...current.filter(value => !group.choices.some(choice => choice.ref === value)), ref]
          : group.choices.filter(choice => current.includes(choice.ref)).length < group.maximum ? [...current, ref] : current)
      const seconds = quote ? Math.max(0, Math.ceil((quote.expiresAt - now) / 1000)) : 0
      const expired = quote && seconds === 0
      const reviewOrders = async () => {
        if (inFlight.current) return
        inFlight.current = true; setBusy(true); setMessage('')
        try { const reply = await read('orders', { platformId: 'taobao' }); if (alive.current) setOfficialOrders(reply.orders) }
        catch (error) { if (alive.current) setMessage(error.message || t('chatOrderFailed')) }
        finally { inFlight.current = false; if (alive.current) setBusy(false) }
      }
      const orderLimit = Math.min(quote?.maxOrderCents || Number.MAX_SAFE_INTEGER, maxAmountCents || Number.MAX_SAFE_INTEGER)
      const handoff = value => paymentHandoff(value, t)
      const cartContent = h('section', { className: 'waimai-stack', 'aria-busy': busy },
        h('div', { className: 'waimai-history-heading' }, h('h4', { className: 'waimai-section-title' }, t('cartTitle')),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void run('cart', base) }, t('refreshCart'))),
        h('p', { className: 'waimai-hint' }, t('tradeCartHint')),
        cart && !cart.quantity ? h('p', { className: 'waimai-empty' }, t('cartEmpty')) : null,
        cart?.items.map(item => h('div', { key: item.ref, className: 'waimai-history-heading' },
          h('span', null, `${item.name}${item.specification ? ' · ' + item.specification : ''} × ${item.quantity} · ${money(item.totalCents)}`),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void run('cartChange', { lineRef: item.ref, step: -1, operationRef: crypto.randomUUID() }) }, t('removeOne')))),
        cart?.quantity ? h('p', { className: 'waimai-hint' }, `${t('cartTitle')}: ${money(cart.totalCents)} · ${t('minimumOrder')}: ${money(cart.minimumCents || 0)}`) : null,
        cart?.quantity ? h(Button, { variant: 'primary', disabled: busy || cart.invalidCount > 0 || Boolean(order) || uncertain,
          onClick: () => void run('checkout', { ...base, revision: cart.revision }) }, t('checkout')) : null,
        quote ? h('section', { className: 'waimai-stack' }, h('h4', { className: 'waimai-section-title' }, t('checkoutTitle')),
          h('strong', null, quote.merchant), h('p', null, quote.address.address),
          h('p', { className: 'waimai-hint' }, [quote.address.contact, quote.address.maskedPhone].filter(Boolean).join(' · ')),
          h('p', null, `${t('deliveryTime')}: ${quote.deliveryTime}`),
          quote.items.map((item, index) => h('p', { key: index }, `${item.name}${item.specification ? ' · ' + item.specification : ''} × ${item.quantity} · ${money(item.priceCents)}`)),
          quote.fees.map((fee, index) => h('p', { key: index, className: 'waimai-hint' }, `${fee.name}: ${money(fee.amountCents)}`)),
          h('p', { className: 'waimai-hint' }, `${t('discountTotal')}: ${money(quote.discountCents)}`),
          h('strong', { className: 'waimai-price' }, `${t('actualTotal')}: ${money(quote.totalCents)}`),
          h('p', { role: 'status', className: expired ? 'waimai-error' : 'waimai-hint' }, expired ? t('quoteExpired') : `${t('quoteExpiry')}: ${seconds} ${t('seconds')}`),
          quote.previewOnly ? h('p', { className: 'waimai-hint' }, t('chatManualPreview')) : null,
          quote.totalCents > orderLimit ? h('p', { className: 'waimai-error' }, t('orderCapExceeded')) : null,
          h(Checkbox, { className: 'waimai-methods', label: t('tradeConfirm'), checked: confirmed, disabled: busy || expired,
            onChange: setConfirmed }),
          h(Button, { variant: 'primary', disabled: busy || !confirmed || expired || quote.totalCents > orderLimit,
            onClick: () => void run('submit', { platformId: 'taobao', quoteRef: quote.quoteRef, confirmed: true, confirmedCents: quote.totalCents, manualConfirmation: true, maxAmountCents: orderLimit }) }, t('createOrder'))) : null,
        order ? h('section', { className: 'waimai-stack' }, h('strong', null, t('orderCreated')),
          h('p', null, `${t('orderId')}: ${order.orderIds.join(', ')}`), !officialOrders.some(value => order.orderIds.includes(value.id)) ? h('p', { role: 'status' }, t('chatAwaitingPayment')) : null, handoff(order),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void reviewOrders() }, t('chatRefreshOrder')),
          officialOrders.filter(value => order.orderIds.includes(value.id)).map(value => h('p', { key: value.id }, `${t('chatOrderStatus')}: ${value.status}`))) : null,
        records.length ? h('details', null, h('summary', null, t('orderRecord')), records.map(record => h('div', { key: record.orderRef, className: 'waimai-stack' },
          h('p', null, `${record.day} · ${record.merchant} · ${money(record.amountCents)}`),
          record.status === 'unknown' ? h('p', { role: 'alert', className: 'waimai-error' }, t('orderUnknown')) : h(React.Fragment, null,
            h('p', null, `${t('orderId')}: ${record.orderIds.join(', ')}`), handoff(record))))) : null,
        message ? h('p', { role: 'alert', className: 'waimai-error' }, message) : null,
        busy ? h('div', { role: 'status', 'aria-label': t('loginBusy') }, h(StateDot, { state: 'ongoing', size: 20 })) : null)
      return h(React.Fragment, null,
        inline ? cartContent : h('aside', { className: 'waimai-floating-cart', 'aria-label': t('cartTitle') },
          h(Button, { variant: 'primary', className: 'waimai-cart-trigger', disabled: Boolean(selection), 'aria-expanded': open,
            onClick: () => setOpen(true) }, h('span', null, t('cartTitle')), h('strong', null, `${cart?.quantity ?? 0} ${t('cartItems')}`),
            h('span', null, cart ? money(cart.totalCents) : t('cartLoading'))),
          busy ? h('p', { role: 'status', className: 'waimai-cart-feedback' }, t(operation === 'itemOptions' ? 'specificationsLoading' : operation === 'cartChange' ? 'chatChangePending' : 'cartUpdating')) : null),
        h(Modal, { open: !inline && open, onClose: () => { if (!busy) setOpen(false) }, title: t('cartTitle'), closeLabel: t('closeCart'),
          className: 'waimai-cart-modal', contentClassName: 'waimai-cart-modal-content' }, cartContent),
        h(Modal, { open: Boolean(selection), onClose: closeSelection, title: selection?.name || t('chooseSpecifications'), closeLabel: t('closeSpecifications'),
          className: 'waimai-cart-modal', contentClassName: 'waimai-cart-modal-content',
          footer: selection && !selection.loading ? h('div', { className: 'waimai-spec-footer' },
            h('span', { role: 'status' }, variantRef ? Number.isInteger(quantity) && quantity > 0 ? money(selectionPrice * quantity) : t('selectAllSpecifications') : t('selectAllSpecifications')),
            h(Button, { variant: 'primary', disabled: busy || !selectionReady, onClick: () => void run('cartChange', { itemId: selection.itemId,
              selectionRef: selection.selectionRef, variantRef, choiceRefs: choices, quantity, step: 1, operationRef: selection.operationRef }) }, t(busy ? 'cartAdding' : 'addToCart'))) : null },
          selection?.loading ? h('p', { role: 'status' }, t('specificationsLoading')) : selection ? h('div', { className: 'waimai-stack' },
            h('h4', null, t('specificationVariant')), h('div', { className: 'waimai-spec-choices' }, selection.variants.map(value => h(Button, { key: value.ref,
              variant: variantRef === value.ref ? 'primary' : 'outline', disabled: busy || !value.available, 'aria-pressed': variantRef === value.ref,
              onClick: () => selectVariant(value) }, `${value.name} · ${money(value.priceCents)}`))),
            selectionGroups.map(group => h('section', { key: group.ref, className: 'waimai-stack' }, h('h4', null, group.name),
              h('p', { className: 'waimai-hint' }, `${t('specificationCount')}: ${group.minimum}–${group.maximum}`),
              h('div', { className: 'waimai-spec-choices' }, group.choices.map(value => h(Button, { key: value.ref,
                variant: choices.includes(value.ref) ? 'primary' : 'outline', disabled: busy || !value.available || (!choices.includes(value.ref) && conflicts(value)), 'aria-pressed': choices.includes(value.ref),
                onClick: () => choose(group, value.ref) }, `${value.name}${value.priceCents ? ' + ' + money(value.priceCents) : ''}`))))),
            h('div', { className: 'waimai-methods' }, h('span', null, t('quantity')), h(Input, { type: 'number', min: selection.minimumQuantity, max: 100,
              value: quantity, disabled: busy, 'aria-label': t('quantity'), onChange: event => setQuantity(Number(event.target.value)) })),
            h('p', { className: 'waimai-hint' }, t('specificationPriceHint')),
            message ? h(React.Fragment, null, h('p', { role: 'alert', className: 'waimai-error' }, message),
              h(Button, { variant: 'outline', disabled: busy, onClick: () => void loadSelection({ id: selection.itemId, name: selection.name, operationRef: crypto.randomUUID() }) }, t('reloadSpecifications'))) : null) : null),
        notice ? h(Toast, { key: notice.id, text: notice.text, tone: notice.tone, onDone: () => setNotice(null) }) : null)
    }

    /** Platform changes unmount private views before requesting another platform. */
    function WaimaiPlatformCard(props) {
      const [platforms, setPlatforms] = React.useState(null)
      const [view, setView] = React.useState(readView)
      const [platformId, setPlatformId] = React.useState(view.platformId || props.defaultPlatform)
      const [tab, setTab] = React.useState('accounts')
      const [error, setError] = React.useState('')
      const [preferenceError, setPreferenceError] = React.useState(false)
      const [platformAttempt, setPlatformAttempt] = React.useState(0)
      const remember = update => {
        setView(current => update(current))
        setPreferenceError(!rememberView(update))
      }
      React.useEffect(() => {
        let alive = true
        void props.rpc.call('/waimai-login', 'platforms', {}).then(reply => {
          if (!alive) return
          if (!reply.ok || !Array.isArray(reply.value) || !reply.value.some(value => value.id === props.defaultPlatform)
            || !reply.value.every(value => typeof value.id === 'string' && typeof value.names?.zh === 'string' && typeof value.names?.en === 'string'
              && typeof value.capabilities?.login === 'boolean' && Array.isArray(value.loginMethods)
              && value.loginMethods.every(method => typeof method.id === 'string' && ['qr', 'sms', 'reuse'].includes(method.kind) && typeof method.available === 'boolean')
              && (value.defaultLoginMethod === null ? !value.capabilities.login : value.loginMethods.some(method => method.id === value.defaultLoginMethod)))) {
            setError(props.t('platformFailed')); return
          }
          if (!reply.value.some(value => value.id === platformId)) {
            setPlatformId(props.defaultPlatform)
            remember(current => ({ ...current, platformId: props.defaultPlatform }))
          }
          setPlatforms(reply.value)
        }).catch(() => { if (alive) setError(props.t('platformFailed')) })
        return () => { alive = false }
      }, [platformAttempt])
      if (!platforms) return error ? h('div', { className: 'waimai-stack' }, h('p', { role: 'alert', className: 'waimai-error' }, error),
        h(Button, { variant: 'outline', onClick: () => { setError(''); setPlatformAttempt(value => value + 1) } }, props.t('retryPlatforms')))
        : h('div', { role: 'status', 'aria-label': props.t('loginBusy'), className: 'waimai-loader' }, h(StateDot, { state: 'ongoing', size: 20 }), props.t('loginBusy'))
      const platform = platforms.find(value => value.id === platformId)
      const overrides = new Set(['qr_linked', 'qrCheck', 'qr_business_unconfirmed', 'ordering', 'nearbyShops', 'recentShops', 'selectAddressFirst',
        'orderingBlocked', 'viewMenu', 'recentScope', 'noNearbyShops', 'noShops', 'menuSearch', 'menuPriceHint', 'refreshMenu', 'backToShops',
        'menuCategory', 'allCategories', 'moreItems', 'refreshShops', 'shopFilter', 'noMenu'])
      const viewT = key => props.t(platformId === 'hema' && overrides.has(key) ? 'hema_' + key : key)
      const platformSelector = h('div', { className: 'waimai-field' }, h('span', { className: 'waimai-label' }, props.t('platform')),
        h(Choice, { label: props.t('platform'), value: platformId, options: platforms.map(value => [value.id, value.names[props.t('platformLanguage')]]), t: value => value,
          onChange: value => { remember(current => ({ ...current, platformId: value })); setPlatformId(value); setTab('accounts') } }))
      const navigation = h('nav', { className: 'waimai-tabs', 'aria-label': props.t('title') }, ['accounts', 'ordering', 'historyTitle', 'tasks', 'paymentSettings', 'settings'].map(value =>
        h(Button, { key: value, variant: tab === value ? 'primary' : 'ghost', 'aria-pressed': tab === value, onClick: () => setTab(value) }, viewT(value))))
      return h('div', { className: 'waimai-stack' },
        platform.capabilities.login
          ? h(WaimaiLoginForm, { ...props, t: viewT, loginMethods: platform.loginMethods, defaultLoginMethod: platform.defaultLoginMethod, key: platformId, platformId, tab, platformSelector, navigation, onAddAccount: () => setTab('accounts'),
            preferredAccountRef: view.accounts[platformId], onAccountSelected: ref => remember(current => {
              const accounts = { ...current.accounts }
              if (ref) accounts[platformId] = ref
              else delete accounts[platformId]
              return { ...current, platformId, accounts }
            }) })
          : h('div', { className: 'waimai-stack' }, h('div', { className: 'waimai-context' }, platformSelector, h(Tag, { tone: 'neutral' }, props.t('notIntegrated'))), navigation,
            ['accounts', 'ordering', 'historyTitle'].includes(tab) ? h('p', { className: 'waimai-empty', role: 'status' }, props.t('platformUnavailable')) : null),
        preferenceError ? h('p', { role: 'alert', className: 'waimai-error' }, props.t('viewSaveFailed')) : null,
        h(WaimaiSettingsForm, { ...props, tab, platformId, platforms }))
    }

    /** Render the editable card only after the Host provides its configuration. */
    function WaimaiSettingsCard(props) {
      const snapshot = React.useSyncExternalStore(props.subscribe, props.getSnapshot, props.getSnapshot)
      if (snapshot?.status !== 'ready') return h('p', { className: 'waimai-hint' }, props.t('unavailable'))
      return h('div', { className: 'waimai-settings' }, h(WaimaiPlatformCard, { ...props, defaultPlatform: snapshot.value.defaultPlatform }))
    }


    /** Recorded tool results choose a card; private reads remain bound to that result's account. */
    function WaimaiAgentContext({ data, rpc, t, sessionId, callId }) {
      const [context, setContext] = React.useState(null), [error, setError] = React.useState('')
      const [version, setVersion] = React.useState(0)
      const scopedRpc = React.useMemo(() => ({ call: (channel, method, payload) => rpc.call(channel, method, { ...payload, accountRef: data.accountRef }) }), [rpc, data.accountRef])
      React.useEffect(() => {
        let alive = true
        setContext(null); setError('')
        void Promise.all([scopedRpc.call('/waimai-login', 'profile', { platformId: data.platformId }),
          data.view === 'payment' ? Promise.resolve(null) : scopedRpc.call('/waimai-login', 'addresses', { platformId: data.platformId })]).then(([profile, addresses]) => {
            if (!alive) return
            if (!profile.ok) { setError(profile.error.message); return }
            if (data.view === 'payment') { setContext({ accountId: profile.value.id }); return }
            if (!profile.ok || !addresses.ok) { setError((profile.error || addresses.error).message); return }
            if (addresses.value.accountId !== profile.value.id) { setError(t('accountChanged')); return }
            const selected = addresses.value.addresses.find(item => item.ref === addresses.value.selectedRef)
            if (!selected) { setError(t('selectAddressFirst')); return }
            setContext({ accountId: profile.value.id, addressRef: selected?.ref })
          }).catch(() => { if (alive) setError(t('accountFailed')) })
        return () => { alive = false }
      }, [data.accountRef, data.view, sessionId, callId, version])
      if (error) return h('div', { className: 'waimai-stack' }, h('p', { role: 'alert', className: 'waimai-error' }, error), h(Button, { variant: 'outline', onClick: () => setVersion(value => value + 1) }, t('refreshCart')))
      if (!context) return h('p', { role: 'status' }, t('chatLoading'))
      if (data.platformId === 'hema') return data.view === 'checkout'
        ? h(WaimaiHemaCheckout, { key: sessionId + ':' + callId, rpc: scopedRpc, t, ...context, selection: { revision: data.revision, lineIds: data.lineIds, shopId: data.shopId }, maxAmountCents: data.maxAmountCents })
        : h(WaimaiPaymentCard, { rpc: scopedRpc, t, platformId: 'hema', orderRefs: data.attempts?.map(value => value.orderRef) })
      return data.view === 'checkout'
        ? h(WaimaiTrade, { key: sessionId + ':' + callId + ':' + context.addressRef, rpc: scopedRpc, t, ...context, shopId: data.shopId, inline: true, initialQuote: data, maxAmountCents: data.maxAmountCents })
        : data.view === 'payment' ? h(WaimaiPaymentCard, { rpc: scopedRpc, t, orderRefs: data.attempts?.map(value => value.orderRef) })
          : h(WaimaiOrdering, { key: sessionId + ':' + callId, rpc: scopedRpc, t, platformId: 'taobao', accountId: context.accountId,
            initialShop: { id: data.shopId, name: data.merchant || t('chatCandidates') }, recommendedItemIds: data.itemIds, maxAmountCents: data.maxAmountCents, inline: true })
    }

    /** Display the same verified specifications in the plugin and recorded tool cards. */
    function WaimaiProductSummary({ product, t }) {
      return h('section', { className: 'waimai-stack', 'aria-label': t('productSpecs') },
        h('div', { className: 'waimai-food-top' },
          product.imageUrl ? h('img', { src: product.imageUrl, alt: product.name, className: 'waimai-food-image', loading: 'lazy', referrerPolicy: 'no-referrer' }) : null,
          h('div', { className: 'waimai-food-info' }, h('strong', null, product.name),
            h('p', { className: 'waimai-price' }, product.price === null ? t('detailPriceUnavailable') : `${t('advertisedPrice')} ¥${product.price} / ${product.priceUnit}`),
            product.description ? h('p', { className: 'waimai-hint' }, product.description) : null)),
        !product.available ? h(Tag, { tone: 'neutral' }, t(product.availability === 'outside-sale-time' ? 'outsideSaleTime' : product.availability === 'sold-out' ? 'soldOut' : 'cartUnavailable')) : null,
        h('h4', { className: 'waimai-section-title' }, t('productSpecs')),
        product.variants.map(value => h('article', { key: value.id, className: 'waimai-food-card' }, h('strong', null, value.name),
          h('p', { className: 'waimai-hint' }, `${t('minimumQuantity')}: ${value.minimumQuantity} ${value.saleUnit} · ${t('quantityStep')}: ${value.quantityStep} ${value.saleUnit}`),
          h('p', { className: 'waimai-hint' }, `${t('stockQuantity')}: ${value.stockQuantity} · ${t('chargeUnit')}: ${value.chargeUnit}`),
          value.stockQuantity === 0 ? h(Tag, { tone: 'neutral' }, t('soldOut')) : null)))
    }

    /** Refresh a catalog reference only within its recorded account and currently selected delivery address. */
    function WaimaiAgentProduct({ data, rpc, t, onClose }) {
      const [product, setProduct] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [owner, setOwner] = React.useState(null)
      const generation = React.useRef(0)
      const load = async () => {
        const current = ++generation.current
        setProduct(null); setOwner(null); setError(''); setBusy(true)
        try {
          const scoped = payload => ({ ...payload, platformId: 'hema', accountRef: data.accountRef })
          const [profile, addresses] = await Promise.all([rpc.call('/waimai-login', 'profile', scoped({})), rpc.call('/waimai-login', 'addresses', scoped({}))])
          if (current !== generation.current) return
          if (!profile.ok || !addresses.ok) { setError((profile.error || addresses.error).message); return }
          if (profile.value.id !== addresses.value.accountId) { setError(t('accountChanged')); return }
          if (!addresses.value.selectedRef) { setError(t('selectAddressFirst')); return }
          if (data.view === 'cart') { setOwner({ accountId: profile.value.id, addressRef: addresses.value.selectedRef }); return }
          const reply = await rpc.call('/waimai-login', 'productDetail', scoped({ productRef: data.productRef, addressRef: addresses.value.selectedRef }))
          if (current !== generation.current) return
          if (!reply.ok) { setError(reply.error.message); return }
          if (reply.value.accountId !== profile.value.id || reply.value.addressRef !== addresses.value.selectedRef || reply.value.productRef !== data.productRef) {
            setError(t('accountChanged')); return
          }
          setProduct(reply.value.product); setOwner({ accountId: profile.value.id, addressRef: addresses.value.selectedRef })
        } catch { if (current === generation.current) setError(t('chatUnavailable')) }
        finally { if (current === generation.current) setBusy(false) }
      }
      React.useEffect(() => { void load(); return () => { generation.current++ } }, [data.accountRef, data.productRef])
      return h(Modal, { open: true, title: t(data.view === 'cart' ? 'cartTitle' : 'productSpecs'), onClose, className: 'waimai-cart-modal' },
        h('div', { className: 'waimai-stack waimai-cart-modal-content', 'aria-busy': busy },
          busy ? h('p', { role: 'status' }, t('chatLoading')) : null,
          error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null,
          product ? h(WaimaiProductSummary, { product, t }) : null,
          owner && data.view === 'cart' ? h(WaimaiCart, { ...owner, platformId: 'hema', t,
            rpc: { call: (channel, method, payload) => rpc.call(channel, method, { ...payload, accountRef: data.accountRef }) } }) : null,
          product && owner ? h(WaimaiHemaPurchase, { ...owner, product, productRef: data.productRef, t,
            rpc: { call: (channel, method, payload) => rpc.call(channel, method, { ...payload, accountRef: data.accountRef }) } }) : null,
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void load() }, t('refreshProduct'))))
    }

    /** Plugin and chat add controls share the same private owner and a floating, freshly read cart. */
    function WaimaiHemaCheckout({ accountId, addressRef, selection, rpc, t, maxAmountCents }) {
      const [quote, setQuote] = React.useState(null), [order, setOrder] = React.useState(null), [orders, setOrders] = React.useState([])
      const [retryOf, setRetryOf] = React.useState(null), [retryConfirmed, setRetryConfirmed] = React.useState(false), [retryExhausted, setRetryExhausted] = React.useState(false)
      const [confirmed, setConfirmed] = React.useState(false), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState(''), [now, setNow] = React.useState(Date.now)
      const alive = React.useRef(true), pending = React.useRef(false)
      const money = value => '¥' + (value / 100).toFixed(2)
      const read = async (method, payload) => {
        const reply = await rpc.call('/waimai-login', method, { platformId: 'hema', ...payload })
        if (!reply.ok) throw Object.assign(Error(reply.error.message), { code: reply.error.code })
        if (reply.value.accountId !== accountId || (reply.value.addressRef && reply.value.addressRef !== addressRef)) throw Error(t('accountChanged'))
        return reply.value
      }
      const run = async (method, deliveryRef) => {
        if (pending.current) return
        pending.current = true; setBusy(true); setMessage(''); setConfirmed(false); setRetryConfirmed(false)
        try {
          if (method === 'checkout') {
            setQuote(null)
            const value = await read('checkout', { addressRef, ...selection })
            if (alive.current) { setQuote(value); setNow(Date.now()) }
          } else if (method === 'selectDelivery') {
            const value = await read('selectDelivery', { quoteRef: quote.quoteRef, deliveryRef })
            if (alive.current) { setQuote(value); setNow(Date.now()) }
          } else if (method === 'submit') {
            const value = await read('submit', { quoteRef: quote.quoteRef, confirmed: true, confirmedCents: quote.totalCents, manualConfirmation: true,
              maxAmountCents: Math.min(quote.maxOrderCents, maxAmountCents ?? quote.maxOrderCents),
              ...(retryOf && retryConfirmed ? { retryOf, previousOrderAbsent: true } : {}) })
            if (alive.current) { setOrder(value); setQuote(null) }
          } else {
            const value = await read('orders', {})
            if (alive.current) setOrders(value.orders)
          }
        } catch (error) { if (alive.current) {
          setMessage(error.message || t('accountFailed'))
          if (method === 'submit' && error.code === 'order-unknown') {
            if (retryOf) setRetryExhausted(true); else setRetryOf(quote.quoteRef)
          }
          if (method === 'submit' || method === 'selectDelivery') setQuote(null)
        } }
        finally { pending.current = false; if (alive.current) setBusy(false) }
      }
      React.useEffect(() => {
        alive.current = true; void run('checkout')
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => { alive.current = false; clearInterval(timer) }
      }, [])
      const expired = quote && now >= quote.expiresAt, limit = quote ? Math.min(quote.maxOrderCents, maxAmountCents ?? quote.maxOrderCents) : 0
      return h('section', { className: 'waimai-stack', 'aria-busy': busy }, h('h4', { className: 'waimai-section-title' }, t('checkoutTitle')),
        quote ? h(React.Fragment, null,
          quote.items.map(item => h('article', { key: item.id + ':' + item.skuId, className: 'waimai-food-card' }, h('strong', null, item.name),
            h('p', null, item.specification + ' · ×' + item.quantity + ' · ' + money(item.totalCents)))),
          h('p', null, quote.address.address + ' · ' + quote.address.contact + ' · ' + quote.address.maskedPhone),
          h('p', null, t('deliveryTime') + ': ' + quote.deliveryTime),
          quote.deliveryOptions?.length > 1 ? h(Choice, { label: t('chooseDelivery'), disabled: busy || expired,
            value: quote.deliveryOptions.find(option => option.selected)?.ref || '', t: value => value,
            options: [['', t('chooseDelivery')], ...quote.deliveryOptions.map(option => [option.ref, option.label + ' · ' + money(option.feeCents)])],
            onChange: value => { if (value) void run('selectDelivery', value) } }) : null,
          h('p', null, t('advertisedPrice') + ': ' + money(quote.itemPriceCents)),
          h('p', null, t('discountTotal') + ': −' + money(quote.discountCents)),
          quote.fees.map((fee, index) => h('p', { key: index }, fee.name + ': ' + money(fee.amountCents))),
          h('strong', { className: 'waimai-price' }, t('actualTotal') + ': ' + money(quote.totalCents)),
          h('p', { role: 'status' }, expired ? t('quoteExpired') : t('quoteExpiry') + ': ' + Math.max(0, Math.ceil((quote.expiresAt - now) / 1000)) + t('seconds')),
          quote.totalCents > limit ? h('p', { role: 'alert', className: 'waimai-error' }, t('orderCapExceeded')) : null,
          retryOf ? h(Checkbox, { className: 'waimai-methods', label: t('retryNoOrder'), checked: retryConfirmed, disabled: busy || expired || retryExhausted,
            onChange: setRetryConfirmed }) : null,
          h(Checkbox, { className: 'waimai-methods', label: t('tradeConfirm'), checked: confirmed, disabled: busy || expired || quote.requiresDeliveryChoice, onChange: setConfirmed }),
          h(Button, { variant: 'primary', disabled: busy || !confirmed || expired || quote.requiresDeliveryChoice || quote.totalCents > limit || retryExhausted || Boolean(retryOf && !retryConfirmed),
            onClick: () => void run('submit') }, t(retryOf ? 'retryOrderOnce' : 'createOrder')),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void run('checkout') }, t('checkout'))) : null,
        order ? h(React.Fragment, null, h('strong', null, t('orderCreated')), h('p', null, t('orderId') + ': ' + order.orderIds.join(', ')),
          paymentHandoff(order, t),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void run('orders') }, t('chatRefreshOrder')),
          orders.filter(row => order.orderIds.includes(row.id)).map(row => h('p', { key: row.id }, t('chatOrderStatus') + ': ' + row.status))) : null,
        message ? h('p', { role: 'alert', className: 'waimai-error' }, message) : null,
        retryOf ? h('p', { role: 'status' }, t(retryExhausted ? 'retryExhausted' : 'retryOrderHint')) : null,
        !quote && !order ? h(Button, { variant: 'outline', disabled: busy || retryExhausted, onClick: () => void run('checkout') }, t('checkout')) : null,
        busy ? h('div', { role: 'status' }, h(StateDot, { state: 'ongoing', size: 20 })) : null)
    }

    function WaimaiHemaPurchase({ product, productRef, accountId, addressRef, rpc, t }) {
      const [checkoutSelection, setCheckoutSelection] = React.useState(null)
      const [skuId, setSkuId] = React.useState(''), [quantity, setQuantity] = React.useState('1')
      const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState(''), [open, setOpen] = React.useState(false)
      const [pending, setPending] = React.useState(null), [cartKey, setCartKey] = React.useState(0)
      const alive = React.useRef(true), locked = React.useRef(false)
      React.useEffect(() => () => { alive.current = false }, [])
      const variant = product?.variants.find(row => row.id === skuId)
      const amount = Number(quantity), ready = product?.available && variant && amount >= variant.minimumQuantity && amount <= variant.stockQuantity
        && Number.isInteger(amount) && Number.isInteger(variant.quantityStep) && (amount - variant.minimumQuantity) % variant.quantityStep === 0
      const check = value => {
        if (value.accountId !== accountId || value.addressRef !== addressRef) throw Error('account-changed')
        return value
      }
      const add = async () => {
        if (locked.current || !ready || pending) return
        locked.current = true; setBusy(true); setNotice('')
        const operationRef = crypto.randomUUID()
        try {
          const before = await rpc.call('/waimai-login', 'cart', { platformId: 'hema', addressRef })
          if (!alive.current) return
          if (!before.ok) { setNotice(before.error.message); return }
          const cart = check(before.value)
          if (cart.mutation?.state === 'unconfirmed') { setPending(cart.mutation.operationRef); setNotice(t('cartUnconfirmed')); setOpen(true); return }
          setPending(operationRef)
          const reply = await rpc.call('/waimai-login', 'cartAdd', { platformId: 'hema', addressRef, productRef, skuId, quantity: amount,
            revision: cart.revision, operationRef })
          if (!alive.current) return
          setCartKey(value => value + 1)
          if (!reply.ok) {
            if (!['cart-result-unconfirmed', 'cart-duplicate', 'login-unavailable'].includes(reply.error.code)) setPending(null)
            setNotice(reply.error.message); setOpen(true); return
          }
          const result = check(reply.value)
          if (result.mutation?.operationRef === operationRef && result.mutation.state === 'verified') { setPending(null); setNotice(t('cartAdded')) }
          else { setNotice(t('cartUnconfirmed')); setOpen(true) }
        } catch { if (alive.current) { setPending(operationRef); setNotice(t('cartUnconfirmed')); setOpen(true) } }
        finally { locked.current = false; if (alive.current) setBusy(false) }
      }
      return h(React.Fragment, null,
        product ? h('div', { className: 'waimai-stack', 'aria-busy': busy },
          h(Choice, { label: t('chooseSpecifications'), value: skuId, t: value => value,
            options: [['', t('chooseSpecifications')], ...product.variants.map(row => [row.id, row.name + (row.stockQuantity <= 0 ? ' · ' + t('soldOut') : '')])],
            onChange: value => { if (busy || pending) return; setSkuId(value); setQuantity(String(product.variants.find(row => row.id === value)?.minimumQuantity || 1)) } }),
          h(Input, { type: 'number', 'aria-label': t('cartQuantity'), value: quantity, min: variant?.minimumQuantity || 1,
            max: Math.min(variant?.stockQuantity || 100, 100), step: variant?.quantityStep || 1, disabled: busy || Boolean(pending), onChange: event => setQuantity(event.target.value) }),
          h(Button, { variant: 'primary', disabled: busy || Boolean(pending) || !ready || amount > 100, onClick: () => void add() }, t(busy ? 'cartAdding' : 'addToCart')),
          notice ? h('p', { role: 'status', className: 'waimai-cart-feedback' }, notice) : null) : null,
        h('aside', { className: 'waimai-floating-cart' }, h(Button, { variant: 'primary', disabled: busy, onClick: () => setOpen(true) }, t('viewCart'))),
        h(Modal, { open, title: t('cartTitle'), onClose: () => { setOpen(false); setCheckoutSelection(null) }, className: 'waimai-cart-modal' }, open ? h('div', { className: 'waimai-cart-modal-content' }, checkoutSelection
          ? h(React.Fragment, null, h(Button, { variant: 'ghost', onClick: () => setCheckoutSelection(null) }, t('viewCart')),
            h(WaimaiHemaCheckout, { accountId, addressRef, selection: checkoutSelection, rpc, t })) : h(WaimaiCart, {
          key: cartKey, rpc, t, platformId: 'hema', accountId, addressRef, onRead: value => {
            if (pending && value.mutation?.operationRef === pending && value.mutation.state === 'verified') { setPending(null); setNotice(t('cartAdded')) }
          },
          onCheckout: setCheckoutSelection,
        })) : null))
    }

    /** Private verification inputs are cleared before dispatch and never enter tool arguments or saved configuration. */
    function WaimaiH5Payment({ rpc, t, record, onReconcile, verificationOnly = false }) {
      const [progress, setProgress] = React.useState(null), [busy, setBusy] = React.useState(false)
      const [password, setPassword] = React.useState(''), [phone, setPhone] = React.useState(''), [code, setCode] = React.useState('')
      const [error, setError] = React.useState('')
      const active = React.useRef(true), pending = React.useRef(false), session = React.useRef(null)
      const base = { platformId: 'taobao', orderRef: record.orderRef, confirmed: true,
        confirmedCents: record.amountCents, maxAmountCents: record.amountCents }
      React.useEffect(() => () => { active.current = false; if (session.current) {
        void rpc.call('/waimai-login', 'paymentH5Authenticate', { platformId: 'taobao', orderRef: record.orderRef,
          h5Ref: session.current, operation: 'cancel' }).catch(() => {})
      } }, [])
      const perform = async (method, payload) => {
        if (pending.current) return
        pending.current = true; setBusy(true); setError(''); setPassword(''); setPhone(''); setCode('')
        try {
          const reply = await rpc.call('/waimai-login', method, payload)
          if (!active.current) return
          if (!reply.ok) {
            if (method === 'paymentH5Submit') setProgress({ state: 'requires-reconciliation' })
            setError(method === 'paymentH5Authenticate' ? t('h5LoginFailed') : reply.error?.message || t('h5Failed')); return
          }
          if (reply.value.h5Ref) session.current = reply.value.h5Ref
          setProgress(method === 'paymentH5Authenticate' && payload.operation === 'cancel' ? null : reply.value)
          if (reply.value.submitted) await onReconcile()
          return reply.value
        } catch { if (active.current) {
          if (method === 'paymentH5Submit') setProgress({ state: 'requires-reconciliation' })
          setError(t(method === 'paymentH5Authenticate' ? 'h5LoginFailed' : 'h5Failed'))
        } }
        finally { delete payload.phone; delete payload.code; delete payload.password; pending.current = false; if (active.current) setBusy(false) }
      }
      const authenticate = (operation, input = {}) => perform('paymentH5Authenticate', { ...input, platformId: 'taobao',
        orderRef: record.orderRef, h5Ref: session.current, operation })
      const begin = async () => {
        const value = await perform('paymentH5Start', { ...base, ...(verificationOnly ? { verificationOnly: true } : {}),
          cookies: [], environment: { device: { userAgent: navigator.userAgent } } })
        if (active.current && value?.state !== 'requires-reconciliation' && (value?.verificationRequired || value?.state === 'requires-verification') && session.current) await authenticate('inline')
      }
      const reconciliation = progress?.state === 'requires-reconciliation'
      const verification = !reconciliation && (progress?.verificationRequired || ['requires-verification', 'verifying'].includes(progress?.state))
      const loginKind = ['phone', 'sms', 'external', 'pending'].includes(progress?.loginInput?.kind) ? progress.loginInput.kind : 'pending'
      const codeLength = [4, 6].includes(progress?.loginInput?.codeLength) ? progress.loginInput.codeLength : null
      const phoneValid = /^\d{11}$/.test(phone), codeValid = codeLength !== null && new RegExp('^\\d{' + codeLength + '}$').test(code)
      const enter = (event, action) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); action() } }
      const reasonKeys = { 'business-error': 'h5BusinessError', 'payment-failure-display': 'h5PaymentFailureDisplay',
        'signed-out': 'h5SignedOut', 'external-verification': 'h5ExternalVerification', 'unsupported-step': 'h5UnsupportedStep', 'payment-result': 'h5PaymentResult' }
      const reasonKey = Object.hasOwn(reasonKeys, progress?.reason) ? reasonKeys[progress.reason] : null
      const submissionKey = progress?.submitted === false ? 'h5NotSubmitted' : progress?.submitted === true ? 'h5SubmittedUnconfirmed' : 'h5SubmissionUnknown'
      return h('section', { className: 'waimai-stack', 'aria-label': t('h5Pay'), 'aria-busy': busy },
        h('p', { className: 'waimai-hint' }, t('h5Hint')),
        !progress ? h(Button, { type: 'button', disabled: busy, onClick: () => void begin() }, t(verificationOnly ? 'paymentLoginStart' : 'h5Start')) : null,
        verification ? h(React.Fragment, null,
          loginKind === 'phone' ? h(React.Fragment, null,
            h('p', { role: 'status' }, t('h5LoginPhoneHint')),
            h(Input, { type: 'tel', autoComplete: 'off', inputMode: 'numeric', maxLength: 11, value: phone,
              disabled: busy, 'aria-label': t('h5LoginPhone'), onChange: event => setPhone(event.target.value),
              onKeyDown: event => enter(event, () => { if (!busy && phoneValid) void authenticate('phone', { phone }) }) }),
            h(Button, { type: 'button', disabled: busy || !phoneValid, onClick: () => { if (phoneValid) void authenticate('phone', { phone }) } }, t('h5LoginNext'))) : null,
          loginKind === 'sms' && codeLength ? h(React.Fragment, null,
            h('p', { role: 'status' }, t('h5LoginSmsHint')),
            h(Input, { type: 'text', autoComplete: 'one-time-code', inputMode: 'numeric', maxLength: codeLength, value: code,
              disabled: busy, 'aria-label': t('h5LoginSms'), onChange: event => setCode(event.target.value),
              onKeyDown: event => enter(event, () => { if (!busy && codeValid) void authenticate('sms', { code }) }) }),
            h(Button, { type: 'button', disabled: busy || !codeValid, onClick: () => { if (codeValid) void authenticate('sms', { code }) } }, t('h5LoginVerify'))) : null,
          loginKind === 'external' ? h('p', { role: 'status' }, t('h5LoginExternal')) : null,
          loginKind === 'pending' || loginKind === 'sms' && !codeLength ? h('p', { role: 'status' }, t('h5LoginPending')) : null,
          h('div', { className: 'waimai-actions' },
            h(Button, { type: 'button', disabled: busy, variant: 'outline', onClick: () => void authenticate('refresh') }, t('h5LoginRefresh')),
            loginKind === 'sms' && progress.loginInput.canResend === true ? h(Button, { type: 'button', disabled: busy, variant: 'outline', onClick: () => void authenticate('resend') }, t('h5LoginResend')) : null,
            ['pending', 'external'].includes(loginKind) ? h(Button, { type: 'button', disabled: busy, variant: 'outline', onClick: () => void authenticate('open') }, t('h5LoginExternalOpen')) : null,
            h(Button, { type: 'button', disabled: busy, variant: 'ghost', onClick: () => void authenticate('cancel') }, t('h5LoginCancelled')))) : null,
        !verificationOnly && progress?.state === 'requires-password' ? h(React.Fragment, null,
          h('p', { className: 'waimai-hint' }, t('h5TemporaryPasswordHint')),
          h(Input, { type: 'password', autoComplete: 'off', value: password,
            disabled: busy, 'aria-label': t('h5Password'), onChange: event => setPassword(event.target.value) })) : null,
        ['ready', 'requires-password'].includes(progress?.state) && !progress?.submitted && !verification ? h(React.Fragment, null,
          h('p', { role: 'status' }, t(verificationOnly ? 'paymentLoginReady' : 'h5Ready')),
          !verificationOnly ? h(Button, { disabled: busy,
            onClick: () => perform('paymentH5Submit', { ...base, h5Ref: session.current, ...(password ? { password } : {}) }) },
          t(progress.state === 'requires-password' && !password ? 'h5UseSavedPassword' : 'h5Submit') + ' · ¥' + (record.amountCents / 100).toFixed(2)) : null) : null,
        progress && !verification && !['ready', 'requires-password'].includes(progress.state)
          ? h('p', { role: 'status' }, ...(reconciliation ? [reasonKey ? t(reasonKey) + ' ' : '', t(submissionKey)] : [t('h5Check')])) : null,
        error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null)
    }

    /** Private cashier URLs are never retained in the tool's recorded model output. */
    function WaimaiPaymentCard({ rpc, t, orderRefs, platformId = 'taobao' }) {
      const [records, setRecords] = React.useState(null), [orders, setOrders] = React.useState([]), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
      const alive = React.useRef(true), pending = React.useRef(false)
      const load = async () => {
        if (pending.current) return
        pending.current = true; setBusy(true); setError('')
        try {
          const [history, official] = await Promise.all([rpc.call('/waimai-login', 'tradeHistory', { platformId }), rpc.call('/waimai-login', 'orders', { platformId })])
          if (!alive.current) return
          if (!history.ok || !official.ok) { setError((history.error || official.error).message); return }
          if (history.value.accountId !== official.value.accountId) { setRecords(null); setError(t('accountChanged')); return }
          const selected = history.value.attempts.filter(value => !orderRefs || orderRefs.includes(value.orderRef))
          const details = platformId === 'taobao' && orderRefs ? await Promise.all(selected.filter(value => value.status === 'created')
            .map(value => rpc.call('/waimai-login', 'paymentStatus', { platformId, orderRef: value.orderRef }))) : []
          if (!alive.current) return
          if (details.some(value => !value.ok || value.value.accountId !== history.value.accountId)) { setError(t('chatOrderFailed')); return }
          const verified = new Map(details.map(value => [value.value.orderRef, value.value]))
          setRecords(selected.map(value => ({ ...value, ...(verified.get(value.orderRef) || {}) })))
          setOrders(details.length ? details.flatMap(value => value.value.officialOrders) : official.value.orders)
        } catch { if (alive.current) setError(t('chatOrderFailed')) }
        finally { pending.current = false; if (alive.current) setBusy(false) }
      }
      React.useEffect(() => { alive.current = true; void load(); return () => { alive.current = false } }, [])
      return h('section', { className: 'waimai-stack', 'aria-busy': busy }, h(Button, { variant: 'outline', disabled: busy, onClick: () => void load() }, t('chatRefreshOrder')),
        error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null,
        records?.length === 0 ? h('p', null, t('chatUnavailable')) : null,
        records?.map(record => h('article', { key: record.orderRef, className: 'waimai-order' }, h('strong', null, record.merchant),
          h('p', null, '¥' + (record.amountCents / 100).toFixed(2)),
          record.status === 'unknown' ? h('p', { role: 'alert' }, t('chatUnknownOrder')) : h(React.Fragment, null,
            paymentNoticeKey(record) ? h('p', { role: 'status' }, t(paymentNoticeKey(record))) : null,
            !orders.some(value => record.orderIds.includes(value.id)) ? h('p', null, t('chatAwaitingPayment')) : null,
            orders.filter(value => record.orderIds.includes(value.id)).map(value => h('p', { key: value.id }, t('chatOrderStatus') + ': ' + value.status)),
            platformId === 'taobao' && !['paid', 'failed', 'unknown'].includes(record.paymentStatus) && orders.some(value => record.orderIds.includes(value.id) && pendingPaymentOrder(value))
              ? h(WaimaiH5Payment, { rpc, t, record, onReconcile: load }) : null,
            paymentHandoff(record, t, false)))))
    }

    /** Render the public keyed tool slot through its recorded result, including errors and running calls. */
    function WaimaiAgentTool({ phase, block, toolName, sessionId, callId, rpc, t }) {
      const [active, setActive] = React.useState(null), [count, setCount] = React.useState(12)
      let data, args = {}, failure = ''
      try {
        const recorded = block?.call?.argsRaw
        args = typeof recorded === 'string' ? JSON.parse(recorded) : recorded || {}
        for (const part of block?.content || []) if (part.type === 'text') {
          const value = JSON.parse(part.text)
          if (value.success === true) data = value.data
          else if (value.success === false) failure = value.error || t('chatUnavailable')
        }
      } catch (_error) { failure = t('chatUnavailable') }
      const title = toolName.includes('get_product_details') ? t('productSpecs') : toolName.includes('search_products') ? t('chatProductSearch') : toolName.includes('payment') || toolName.includes('order_status') ? t('chatPayment') : toolName.includes('submit_order') ? t('chatQuote') : t('chatCandidates')
      if (phase !== 'result') return h('section', { className: 'waimai-chat-card', 'aria-busy': true }, h('strong', null, title), h('p', { role: 'status' }, t('chatLoading')))
      if (failure || !data) return h('section', { className: 'waimai-chat-card' }, h('strong', null, title), h('p', { role: 'alert', className: 'waimai-error' }, failure || t('chatUnavailable')))
      const sourceItems = data.items || data.stores?.flatMap((store, index) => (store.items || []).map(item => ({ ...item, shopId: store.shopId, storeIndex: index + 1 }))) || data.categories?.flatMap(group => group.items) || []
      const items = [...new Map(sourceItems.map(item => [(item.shopId || data.shopId || '') + ':' + (item.id || item.ref), item])).values()]
      const context = { ...data, platformId: data.platformId || args.platformId || 'taobao', accountRef: data.accountRef || args.accountRef, shopId: data.shopId || args.shopId }
      const supported = context.platformId === 'taobao'
      const actionable = supported ? (active || (['ordering', 'checkout', 'payment'].includes(data.view) ? context : null))
        : context.platformId === 'hema' && ['checkout', 'payment'].includes(data.view) ? context : null
      return h('section', { className: 'waimai-chat-card waimai-stack' }, h('div', { className: 'waimai-history-heading' }, h('strong', null, title), h(Tag, { tone: 'neutral' }, t(context.platformId === 'hema' ? 'chatPlatformHema' : 'chatPlatformTaobao'))),
        context.maxAmountCents ? h('p', null, t('chatBudget') + ': ¥' + (context.maxAmountCents / 100).toFixed(2)) : null,
        data.view === 'product-search' ? h('p', { className: 'waimai-hint' }, t('chatSearchScope')) : null,
        data.nextCursor ? h('p', { className: 'waimai-hint' }, t('chatNextShopPage')) : null,
        data.notice ? h('p', { className: 'waimai-empty', role: 'status' }, data.notice) : null,
        context.platformId === 'hema' && data.product ? h(React.Fragment, null, h(WaimaiProductSummary, { product: data.product, t }),
          h('p', { className: 'waimai-hint' }, t('recordedProductHint')),
          context.accountRef && data.productRef ? h(Button, { variant: 'outline', onClick: () => setActive({ ...context, productRef: data.productRef, view: 'product-detail' }) }, t('refreshProduct')) : null) : null,
        context.platformId === 'hema' && data.view === 'cart' && context.accountRef ? h(Button, { variant: 'outline', onClick: () => setActive({ ...context, view: 'cart' }) }, t('viewCart')) : null,
        context.platformId === 'hema' && ['product-detail', 'cart'].includes(active?.view) ? h(WaimaiAgentProduct, { key: active.accountRef + ':' + (active.productRef || 'cart'),
          data: active, rpc, t, onClose: () => setActive(null) }) : null,
        data.stores?.map((store, index) => !store.items?.length ? h('p', { key: store.shopId, role: store.state === 'unreadable' ? 'alert' : 'status', className: store.state === 'unreadable' ? 'waimai-error' : 'waimai-empty' },
          t('chatSelectedStore') + ' ' + (index + 1) + ' · ' + (store.notice || t(store.state === 'unreadable' ? 'chatSearchFailed' : 'chatNoProductMatch'))) : null) || null,
        actionable?.accountRef ? h(WaimaiAgentContext, { key: sessionId + ':' + callId + ':' + actionable.shopId, data: actionable, rpc, t, sessionId, callId }) : h(React.Fragment, null,
          data.shops?.slice(0, count).map(shop => h('article', { key: shop.id, className: 'waimai-food-card' }, h('strong', null, shop.name), h('p', { className: 'waimai-hint' }, [shop.deliveryTime, shop.deliveryFee].filter(Boolean).join(' · ')),
            h(Button, { variant: 'outline', disabled: !supported || !context.accountRef, onClick: () => setActive({ ...context, view: 'ordering', shopId: shop.id, merchant: shop.name }) }, t('chatOrdering')))),
          items.slice(0, count).map(item => h('article', { key: (item.shopId || context.shopId || '') + ':' + (item.id || item.ref), className: 'waimai-food-card' }, h('div', { className: 'waimai-food-top' },
            item.imageUrl ? h('img', { src: item.imageUrl, alt: item.name, className: 'waimai-food-image', loading: 'lazy', referrerPolicy: 'no-referrer' }) : null,
            h('div', { className: 'waimai-food-info' }, h('strong', null, item.name), item.storeIndex ? h('p', { className: 'waimai-hint' }, t('chatSelectedStore') + ' ' + item.storeIndex) : null, h('p', null, '¥' + (item.priceCents !== undefined ? (item.priceCents / 100).toFixed(2) : item.price ?? '—')))),
            context.platformId === 'hema' && item.productRef ? h(Button, { variant: 'outline', disabled: !context.accountRef,
              onClick: () => setActive({ ...context, productRef: item.productRef, view: 'product-detail' }) }, t('productDetails'))
              : h(Button, { variant: 'outline', disabled: !supported || !context.accountRef || !(item.shopId || context.shopId) || ['sold-out', 'outside-sale-time'].includes(item.availability), onClick: () => setActive({ ...context, shopId: item.shopId || context.shopId, view: 'ordering', itemIds: item.id ? [item.id] : undefined }) }, t('chatOpen')))),
          Math.max(items.length, data.shops?.length || 0) > count ? h(Button, { variant: 'ghost', onClick: () => setCount(value => value + 12) }, t('chatMore')) : null,
          data.quantity !== undefined ? h('p', null, t('cartTitle') + ': ' + data.quantity + ' · ¥' + ((data.totalCents || 0) / 100).toFixed(2)) : null))
    }

    const styles = `
      .waimai-settings { color:var(--dsw-alias-label-primary); font-size:14px; line-height:22px; min-width:0; }
      .waimai-intro,.waimai-hint { margin:0; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .waimai-intro { margin-bottom:20px; font-size:13px; line-height:20px; }
      .waimai-form,.waimai-stack { display:flex; flex-direction:column; gap:16px; }
      .waimai-form[hidden] { display:none; }
      .waimai-tabs { display:flex; gap:8px; flex-wrap:wrap; }
      .waimai-section { padding:0 0 20px; border-bottom:0.5px solid var(--dsw-alias-border-l2); }
      .waimai-section-title { margin:0 0 14px; font-size:14px; line-height:22px; font-weight:500; }
      .waimai-toggle-row { display:flex; align-items:center; justify-content:space-between; gap:20px; }
      .waimai-toggle-row>div { min-width:0; }
      .waimai-toggle-row .waimai-hint { margin-top:3px; }
      .waimai-label { font-size:13px; line-height:20px; font-weight:500; }
      .waimai-field { display:flex; flex-direction:column; gap:6px; min-width:0; }
      .waimai-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
      .waimai-input { box-sizing:border-box; width:100%; }
      .waimai-choice { display:block; min-width:0; }
      .waimai-select { width:100%; justify-content:space-between; text-align:left; }
      .waimai-select>span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
      .waimai-lines { box-sizing:border-box; width:100%; min-height:62px; resize:vertical; font:inherit; font-size:14px; line-height:22px; padding:8px 10px; border:0.5px solid var(--dsw-alias-border-l4); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); }
      .waimai-lines:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }
      .waimai-lines::placeholder { color:var(--dsw-alias-label-dimmed); }
      .waimai-empty { text-align:center; padding:20px 12px; border:0.5px dashed var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-md); }
      .waimai-empty .waimai-hint { margin-top:4px; }
      .waimai-task { border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); }
      .waimai-task-header { display:flex; align-items:center; gap:10px; padding:8px 12px; }
      .waimai-task-heading { flex:1; min-width:0; height:auto; justify-content:space-between; text-align:left; }
      .waimai-task-heading>span { min-width:0; }
      .waimai-task-heading strong { display:block; overflow-wrap:anywhere; }
      .waimai-task-meta { display:block; color:var(--dsw-alias-label-secondary); font-size:12px; font-weight:400; }
      .waimai-task-editor { display:flex; flex-direction:column; gap:16px; padding:16px; border-top:0.5px solid var(--dsw-alias-border-l2); }
      .waimai-weekdays { display:flex; flex-wrap:wrap; gap:12px; }
      .waimai-details>summary { cursor:pointer; font-weight:500; font-size:13px; }
      .waimai-chat-card { min-width:0; padding:16px; margin:8px 0; border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); overflow-wrap:anywhere; }
      .waimai-chat-card .waimai-food-grid { padding-bottom:0; }
      .waimai-details>summary:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:4px; }
      .waimai-details[open]>.waimai-stack { margin-top:16px; }
      .waimai-delete { align-self:flex-start; color:var(--dsw-alias-state-error-primary); }
      .waimai-footer { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:4px 0; }
      .waimai-actions { display:flex; flex-wrap:wrap; gap:8px; margin-left:auto; }
      .waimai-error { color:var(--dsw-alias-state-error-primary); font-size:13px; }
      .waimai-account { display:flex; align-items:center; gap:14px; min-width:0; }
      .waimai-avatar { flex:none; width:56px; height:56px; border-radius:50%; object-fit:cover; border:0.5px solid var(--dsw-alias-border-l2); }
      .waimai-avatar-fallback { display:flex; align-items:center; justify-content:center; background:var(--dsw-alias-bg-layer-1); font-size:24px; }
      .waimai-account-info { display:flex; flex-direction:column; min-width:0; overflow-wrap:anywhere; }
      .waimai-account-name { font-size:16px; line-height:24px; }
      .waimai-history-heading,.waimai-order-heading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; }
      .waimai-history-heading .waimai-section-title { margin:0; }
      .waimai-order { padding:12px 14px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); overflow-wrap:anywhere; }
      .waimai-order-heading { align-items:baseline; }
      .waimai-order-items { padding:0; margin:8px 0; list-style:none; font-size:13px; }
      .waimai-context { display:grid; grid-template-columns:minmax(160px,1fr) minmax(200px,2fr) auto; gap:16px; align-items:end; padding:16px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); }
      .waimai-tabs { padding-bottom:8px; border-bottom:0.5px solid var(--dsw-alias-border-l2); }
      .waimai-status-row,.waimai-status-info { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .waimai-status-row { justify-content:space-between; }
      .waimai-login-panel { padding:20px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); }
      .waimai-login-panel .waimai-actions { margin-left:0; }
      .waimai-methods { display:flex; flex-wrap:wrap; gap:8px; }
      .waimai-login-panel img { max-width:100%; height:auto; border-radius:var(--dsw-radius-md); }
      .waimai-qr-content { display:grid; grid-template-columns:256px minmax(0,1fr); align-items:center; gap:24px; }
      .waimai-qr-placeholder { width:256px; min-height:200px; display:flex; justify-content:center; align-items:center; border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-2); }
      .waimai-qr-steps { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:16px; }
      .waimai-qr-steps li { display:flex; align-items:center; gap:10px; color:var(--dsw-alias-text-tertiary); }
      .waimai-qr-steps li[data-current=true] { color:var(--dsw-alias-text-primary); font-weight:600; }
      .waimai-qr-status { margin:0; color:var(--dsw-alias-text-primary); font-weight:500; }
      @media(max-width:600px) { .waimai-qr-content { grid-template-columns:minmax(0,1fr); gap:16px; } .waimai-qr-image,.waimai-qr-placeholder { justify-self:center; } }
      .waimai-account { padding:16px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); }
      .waimai-account[data-compact=true] { border:0; padding:0; }
      .waimai-account[data-compact=true] .waimai-avatar { width:32px; height:32px; font-size:16px; }
      .waimai-account[data-compact=true] .waimai-account-name { font-size:13px; }
      .waimai-account strong,.waimai-order strong { font-weight:500; }
      .waimai-order-amount { font-size:16px; font-variant-numeric:tabular-nums; }
      .waimai-order[data-selected=true] { border-color:var(--dsw-alias-state-business-primary); }
      .waimai-address-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:12px; }
      .waimai-address-picker>summary { padding:12px 0; }
      .waimai-details summary { color:var(--dsw-alias-label-secondary); min-height:24px; }
      .waimai-order .waimai-hint { margin-top:6px; }
      .waimai-loader { display:flex; align-items:center; justify-content:center; min-height:80px; }
      .waimai-food-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .waimai-food-card { min-width:0; padding:14px; display:flex; flex-direction:column; gap:12px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); overflow-wrap:anywhere; }
      .waimai-food-card strong { font-weight:500; }
      .waimai-food-top { display:flex; align-items:flex-start; gap:12px; min-width:0; }
      .waimai-food-image { width:72px; height:72px; flex:none; object-fit:cover; border-radius:var(--dsw-radius-md); }
      .waimai-food-info { min-width:0; flex:1; }
      .waimai-food-info p { margin:6px 0 0; }
      .waimai-food-info .waimai-methods { margin-top:8px; }
      .waimai-price { color:var(--dsw-alias-label-primary); font-size:14px; font-weight:500; font-variant-numeric:tabular-nums; }
      .waimai-floating-cart { position:fixed; right:24px; bottom:24px; z-index:20; width:min(360px,calc(100vw - 32px)); padding:8px; border:0; border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); box-shadow:var(--dsw-elevation-prominent); }
      .waimai-cart-trigger { display:flex; align-items:center; justify-content:space-between; gap:16px; width:100%; min-height:48px; }
      .waimai-cart-feedback { margin:8px 4px 0; font-size:13px; color:var(--dsw-alias-label-secondary); }
      .waimai-cart-modal { width:min(640px,calc(100vw - 24px)); }
      .waimai-cart-modal-content { max-height:72vh; overflow-y:auto; }
      .waimai-spec-choices { display:flex; flex-wrap:wrap; gap:8px; }
      .waimai-spec-footer { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:16px 24px; }
      .waimai-food-grid { padding-bottom:88px; }
      @media(max-width:600px) { .waimai-floating-cart { right:16px; bottom:16px; } .waimai-spec-footer { padding:12px 16px; } }
      .waimai-option { margin:10px 0; font-size:13px; }
      .waimai-menu-panel { padding-top:12px; border-top:0.5px solid var(--dsw-alias-border-l2); }
      .waimai-pay-link { color:var(--dsw-alias-color-brand); text-decoration:underline; padding:12px 0; }
      @media(max-width:760px) { .waimai-food-grid { grid-template-columns:minmax(0,1fr); } }
      @media(max-width:760px) { .waimai-context { grid-template-columns:minmax(0,1fr) auto; } .waimai-context>.waimai-field:first-child { grid-column:1/-1; } .waimai-address-list { grid-template-columns:minmax(0,1fr); } }
      @media(max-width:420px) { .waimai-context { grid-template-columns:minmax(0,1fr); } .waimai-context>.waimai-field:first-child { grid-column:auto; } .waimai-context>button { justify-self:start; } .waimai-login-panel { padding:16px; } .waimai-tabs { gap:4px; } }
      @media(max-width:600px) { .waimai-grid { grid-template-columns:minmax(0,1fr); } .waimai-task-header { flex-wrap:wrap; } .waimai-task-heading { flex-basis:calc(100% - 54px); } }
    `


    return {
      inject: ['slots', 'locale', 'configForms', 'connection'],
      /**
       * Mount the card once the Host serves this plugin's settings namespace.
       *
       * @param ctx - browser plugin context.
       */
      apply(ctx) {
        ctx.effect(() => {
          const node = document.createElement('style')
          node.dataset.pluginCss = 'dsh-waimai/settings'
          node.textContent = styles
          document.head.appendChild(node)
          return () => node.remove()
        }, 'dsh-waimai: settings styles')
        const t = ctx.locale.bind(LOCALE_NS)
        ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-waimai: dictionaries')
        for (const name of ['search_shops', 'search_products', 'get_menu', 'get_product_details', 'show_order', 'get_cart', 'add_product_to_cart', 'change_cart', 'preview_checkout', 'submit_order', 'confirm_order', 'request_payment', 'get_order_status', 'pay_order', 'get_payment_status']) {
          ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'mcp__waimai__' + name, locale: LOCALE_NS,
            inject: () => ({ rpc: ctx.connection.rpc, t }) }, WaimaiAgentTool))
        }
        const form = ctx.configForms.get(HOST_NS)
        ctx.effect(() => ctx.configForms.whileServed([HOST_NS], () => ctx.slots.inject(
          'plugins.bundle.config',
          () => ctx.slots.register({
            name: 'plugins.bundle.config',
            key: 'dsh-waimai',
            label: () => t('title'),
            locale: LOCALE_NS,
            inject: () => ({
              // Bind once here so the render layer never loses the controller's `this`.
              subscribe: form.subscribe.bind(form),
              getSnapshot: form.getSnapshot.bind(form),
              mutate: form.mutate.bind(form),
              rpc: ctx.connection.rpc,
              t,
            }),
          }, WaimaiSettingsCard),
        )), 'dsh-waimai: settings card')
      },
    }
  },
})
