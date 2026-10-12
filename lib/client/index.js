/**
 * Account data uses authenticated RPC; configuration writes use the Host form's revision fence.
 */

window.__ModuleLoader__.load({
  id: 'dsh-waimai',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, Switch, Menu, Checkbox, Tag, StateDot, IconPlusOutlineRegular,
      IconChevronDownOutlineRegular, IconTrashOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** Locale namespace owned by this card. */
    const LOCALE_NS = 'settings.waimai'
    /** Host plugin entry id; also the settings namespace holding the configuration. */
    const HOST_NS = 'waimai'
    const VIEW_KEY = 'dsh-waimai.view.v1'

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
      previewOn: '已开启：不提交、不支付',
      previewOff: '已关闭：可确认创建订单',
      previewHint: '先配置任务并预览；确认时间、菜单和预算后，再关闭预览模式。',
      modeAuto: '自动支付',
      modeManual: '仅提交，人工支付',
      cap: '单笔上限',
      budget: '每日上限',
      unlimited: '未限制',
      whitelist: '自动支付白名单',
      anyMerchant: '不限制商家',
      tasks: '自动化任务',
      tools: '工具命名空间',
      browserHint: '购物车和结算通过接口读取，支付在官方收银台确认。',
      manualHint: '创建订单后，请在官方收银台确认支付。',
      autoHint: '自动支付尚未接入，当前仍需在官方收银台确认支付。',
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
      currencyHint: '金额单位：元；每日上限为 0 时不限制。', whitelistHint: '每行一个商家名称；自动支付只允许白名单内的商家。',
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
      avatar: '用户头像', accountId: '账号 ID', nickname: '昵称', accountPhone: '手机号',
      accountsTitle: '账号', addAccount: '添加账号', cancelAddAccount: '取消添加', unnamedAccount: '已保存账号',
      maxAccountsPerPlatform: '每个平台的账号数量上限', pendingAccount: '新账号尚未登录成功，当前账号仍保留。',
      taobaoQr: '淘宝扫码', smsLogin: '手机号短信', qrStart: '获取淘宝登录二维码', qrRestart: '重新获取二维码', qrCancel: '取消扫码', qrCheck: '检查闪购授权',
      qrHint: '使用淘宝 App 扫码，并在手机上确认。之后会自动完成登录。', qr_waiting: '等待扫码', qr_scanned: '已扫码，请在手机上确认',
      qr_linked: '淘宝扫码与闪购账号已确认', qr_expired: '二维码已过期', qr_canceled: '扫码已取消', qr_error: '扫码状态读取失败，请重新检查',
      qr_business_unconfirmed: '扫码已确认，正在完成闪购登录…',
      qrStarting: '正在获取二维码…', qrAutoChecking: '正在自动复核登录，请稍候。', qrStepScan: '扫码', qrStepConfirm: '手机确认', qrStepLogin: '完成登录',
      qrAutoRetry: '连接暂时中断，正在自动重试…', qr_authorization_timeout: '登录确认超时，请重新扫码。',
      qr_taobao_session_unconfirmed: '淘宝登录会话未能建立，请重新扫码。',
      hema_qr_linked: '盒马账号已确认', hema_qrCheck: '检查盒马授权',
      hema_qr_business_unconfirmed: '扫码已确认，正在完成盒马登录…',
      hema_ordering: '门店与商品', hema_nearbyShops: '当前地址可配送门店', hema_recentShops: '最近下单的配送门店',
      hema_selectAddressFirst: '先选择盒马配送地址，再查看配送门店。', hema_orderingBlocked: '可查询商品，下单与支付暂未开放。',
      hema_viewMenu: '查询商品', hema_recentScope: '仅显示最近一页订单中、当前地址可配送的门店。',
      hema_menuSearch: '输入商品名称', hema_menuPriceHint: '标价和规格以当前查询为准；优惠、运费及实付金额以结算为准。',
      nextProducts: '下一页商品', firstProducts: '返回首批', productDetails: '查看规格', backToProducts: '返回商品',
      detailPriceUnavailable: '价格暂无法确认',
      productSpecs: '商品规格', minimumQuantity: '最低数量', quantityStep: '数量步长', stockQuantity: '库存', chargeUnit: '计价单位', hemaProductPageSize: '盒马商品每页数量',
      viewCart: '查看购物车', refreshCart: '刷新购物车', cartTitle: '购物车', cartEmpty: '购物车暂无商品。', cartAvailable: '可售商品', cartUnavailable: '当前不可售',
      cartSelected: '手机已勾选', cartCount: '商品条目', cartReadOnly: '仅查看当前账号购物车；不修改商品或勾选状态。结算、下单与支付尚未开放。', cartQuantity: '数量', moreCart: '显示更多购物车商品',
      addToCart: '加入购物车', removeOne: '减一件', checkout: '去结算', checkoutTitle: '确认订单',
      checkoutQuoteSeconds: '报价有效期（秒）', quoteExpiry: '报价剩余', seconds: '秒', quoteExpired: '报价已过期，请重新结算。',
      tradeConfirm: '我已核对商品、配送地址、时间和实付金额', createOrder: '确认创建订单', payOfficial: '前往官方支付',
      actualTotal: '实付', discountTotal: '优惠合计', deliveryTime: '配送时间', orderCreated: '订单已创建，支付结果待确认',
      orderUnknown: '下单结果未确认，请先核对官方历史订单，勿重复提交。', orderRecord: '本机下单记录',
      orderCapExceeded: '实付超过单笔上限，请调整购物车或设置。', tradePreview: '预览模式：可查看实付报价，关闭后才能创建订单。',
      tradeCartHint: '购物车与此账号的官方客户端同步；需要规格的商品可先在官方客户端加购。',
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
      previewOn: 'On: no checkout or payment',
      previewOff: 'Off: execute configured tasks',
      previewHint: 'Preview the schedule, menu and budget before disabling preview mode.',
      modeAuto: 'Automatic',
      modeManual: 'Submit only, pay by hand',
      cap: 'Per-order cap',
      budget: 'Daily budget',
      unlimited: 'unlimited',
      whitelist: 'Auto-payment whitelist',
      anyMerchant: 'any merchant',
      tasks: 'Automation tasks',
      tools: 'Tool namespace',
      browserHint: 'Ordering and payment use the local browser.',
      manualHint: 'Manual mode: the plugin stops at the confirmation page and you complete the charge.',
      autoHint: 'Automatic mode: the server reads the amount and merchant from the page and only then pays, within the cap and whitelist.',
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
      currencyHint: 'Amounts in CNY; a daily limit of 0 means no limit.', whitelistHint: 'One merchant per line. Automatic payments require a matching merchant.',
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
      avatar: 'User avatar', accountId: 'Account ID', nickname: 'Nickname', accountPhone: 'Phone',
      accountsTitle: 'Account', addAccount: 'Add account', cancelAddAccount: 'Cancel adding', unnamedAccount: 'Saved account',
      maxAccountsPerPlatform: 'Account limit per platform', pendingAccount: 'The new account is not signed in. Your current account is retained.',
      taobaoQr: 'Taobao QR', smsLogin: 'SMS', qrStart: 'Get Taobao sign-in QR', qrRestart: 'Refresh QR', qrCancel: 'Cancel scan', qrCheck: 'Check takeaway authorization',
      qrHint: 'Scan with the Taobao app and confirm on your phone. Sign-in then completes automatically.', qr_waiting: 'Waiting for scan', qr_scanned: 'Scanned; confirm on your phone',
      qr_linked: 'Taobao and takeaway account confirmed', qr_expired: 'QR expired', qr_canceled: 'Scan canceled', qr_error: 'Could not check scan status. Check again.',
      qr_business_unconfirmed: 'Scan confirmed. Completing takeaway sign-in…',
      qrStarting: 'Getting your QR code…', qrAutoChecking: 'Verifying sign-in automatically. Please wait.', qrStepScan: 'Scan', qrStepConfirm: 'Confirm on phone', qrStepLogin: 'Finish sign-in',
      qrAutoRetry: 'Connection interrupted. Retrying automatically…', qr_authorization_timeout: 'Sign-in confirmation timed out. Scan a new QR code.',
      qr_taobao_session_unconfirmed: 'Taobao could not establish a sign-in session. Scan a new QR code.',
      hema_qr_linked: 'Hema account confirmed', hema_qrCheck: 'Check Hema authorization',
      hema_qr_business_unconfirmed: 'Scan confirmed. Completing Hema sign-in…',
      hema_ordering: 'Stores and products', hema_nearbyShops: 'Stores serving this address', hema_recentShops: 'Recently ordered delivery stores',
      hema_selectAddressFirst: 'Choose a Hema delivery address to view serving stores.', hema_orderingBlocked: 'Products are searchable. Ordering and payment are unavailable.',
      hema_viewMenu: 'Find products', hema_recentScope: 'Stores in the latest order page that currently serve this address.',
      hema_menuSearch: 'Enter a product name', hema_menuPriceHint: 'Prices and specifications are current search results. Discounts, delivery fees and final totals depend on checkout.',
      nextProducts: 'Next product page', firstProducts: 'Back to first results', productDetails: 'View specifications', backToProducts: 'Back to products',
      detailPriceUnavailable: 'Price not confirmed',
      productSpecs: 'Product specifications', minimumQuantity: 'Minimum quantity', quantityStep: 'Quantity step', stockQuantity: 'Stock', chargeUnit: 'Pricing unit', hemaProductPageSize: 'Hema products per page',
      viewCart: 'View cart', refreshCart: 'Refresh cart', cartTitle: 'Cart', cartEmpty: 'Your cart is empty.', cartAvailable: 'Available products', cartUnavailable: 'Currently unavailable',
      cartSelected: 'Selected in app', cartCount: 'Product entries', cartReadOnly: 'View this account’s cart without changing items or selections. Checkout, ordering and payment are unavailable.', cartQuantity: 'Quantity', moreCart: 'Show more cart products',
      addToCart: 'Add to cart', removeOne: 'Remove one', checkout: 'Checkout', checkoutTitle: 'Confirm order',
      checkoutQuoteSeconds: 'Quote validity (seconds)', quoteExpiry: 'Quote expires in', seconds: 'seconds', quoteExpired: 'Quote expired. Request a new quote.',
      tradeConfirm: 'I checked the items, delivery address, time and final total', createOrder: 'Confirm and create order', payOfficial: 'Continue to official payment',
      actualTotal: 'Final total', discountTotal: 'Total discount', deliveryTime: 'Delivery time', orderCreated: 'Order created; payment status unconfirmed',
      orderUnknown: 'Order outcome is unknown. Check official order history before submitting again.', orderRecord: 'Local order attempts',
      orderCapExceeded: 'Final total exceeds the order cap. Adjust the cart or settings.', tradePreview: 'Preview mode: review quotes, then turn preview off to create an order.',
      tradeCartHint: 'This cart is shared with the official app. Add items requiring specifications there, then refresh here.',
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
      payment: '支付', previewHint: '开启时仅查看结算报价，关闭后可在确认金额后创建订单。',
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
      payment: 'Pay', previewHint: 'Preview quotes while enabled. Turn it off to confirm and create orders.',
      intro: 'Accounts, delivery addresses, order history and scheduled tasks.', advanced: 'Local sign-in and history',
      couponsPending: 'Automatic coupon claiming is unavailable. Quotes show platform discounts.', taskHint: 'Tasks preview menus and schedules. They do not place orders yet.',
      refreshAccount: 'Refresh account', accountBusy: 'Loading account…',
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

    /** Drafts retain all unedited Host fields; a save patches only changed roots. */
    function WaimaiSettingsForm(props) {
      const snapshot = React.useSyncExternalStore(props.subscribe, props.getSnapshot, props.getSnapshot)
      const [draft, setDraft] = React.useState(() => structuredClone(snapshot.value))
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const [expanded, setExpanded] = React.useState(null)
      React.useEffect(() => { setDraft(structuredClone(snapshot.value)) }, [snapshot.revision])
      const t = props.t
      if (!draft) return null
      const locked = busy || !snapshot.writable
      const dirty = JSON.stringify(draft) !== JSON.stringify(snapshot.value)
      const change = (field, value) => { setMessage(''); setDraft(current => ({ ...current, [field]: value })) }
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
          const cleaned = { ...draft, merchantWhitelist: draft.merchantWhitelist.map(value => value.trim()).filter(Boolean),
            autoTasks: draft.autoTasks.map(task => ({ ...task,
              ...Object.fromEntries(['menuPool', 'merchantWhitelist', 'skipDates'].map(field => [field, task[field].map(value => value.trim()).filter(Boolean)])),
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
          maxOrderAmount: draft.maxOrderAmount, dailyBudget: 50, paymentMode: 'manual', merchantWhitelist: [], notifyOnSuccess: true, notifyOnFailure: true }])
        setExpanded(id)
      }
      return h('form', { onSubmit: save, className: 'waimai-form', hidden: !['tasks', 'settings'].includes(props.tab) },
        props.tab === 'settings' ? section('order', 'order', h('div', { className: 'waimai-stack' },
          field(draft, 'defaultPlatform', 'defaultPlatformLabel', 'choice', change, { values: props.platforms.map(value => [value.id, value.names[t('platformLanguage')]]), literal: true }),
          toggle(draft, 'hideSponsoredShops', 'hideSponsoredShops', change, 'sponsoredHint'),
          toggle(draft, 'dryRun', 'preview', change, 'previewHint'),
          h('div', { className: 'waimai-grid' },
            field(draft, 'maxOrderAmount', 'cap', 'number', change, { min: 1, step: 1, required: true }),
            field(draft, 'dailyBudget', 'budget', 'number', change, { min: 0, step: 1, required: true })),
          hint('currencyHint'), h('details', { className: 'waimai-details' }, h('summary', null, t('purchaseSettings')),
          h('div', { className: 'waimai-stack' }, field(draft, 'paymentMode', 'mode', 'choice', change, { values: paymentOptions }),
          field(draft, 'checkoutQuoteSeconds', 'checkoutQuoteSeconds', 'number', change, { min: 30, max: 300, step: 1, required: true }),
          hint(draft.paymentMode === 'auto' ? 'autoHint' : 'manualHint'),
          field(draft, 'merchantWhitelist', 'whitelist', 'lines', change, { hint: 'whitelistHint', rows: 2 }), hint('couponsPending'))))) : null,
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
                    field(task, 'skipDates', 'skipDates', 'lines', update, { rows: 2 }),
                    field(task, 'merchantWhitelist', 'whitelist', 'lines', update, { rows: 2, hint: 'whitelistHint' }))),
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
            : h('span', { className: 'waimai-avatar waimai-avatar-fallback', role: 'img', 'aria-label': t('avatar') }, (profile.nickname || profile.id).slice(0, 1)),
          h('div', { className: 'waimai-account-info' },
            h('strong', { className: 'waimai-account-name', 'aria-label': t('nickname') }, profile.nickname || profile.id),
            tab === 'accounts' ? h('span', { className: 'waimai-hint' }, `${t('accountId')}: ${profile.id}`) : null,
            tab === 'accounts' && profile.maskedPhone ? h('span', { className: 'waimai-hint' }, `${t('accountPhone')}: ${profile.maskedPhone}`) : null)) : null,
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
    function WaimaiTaobaoQr({ rpc, t, platformId, onLinked, onProgress }) {
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
          const result = await rpc.call('/waimai-login', method, { platformId, ...payload })
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
        h('p', { className: 'waimai-hint' }, t('qrHint')),
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
    function WaimaiLoginForm({ rpc, t, platformId, smsAllowed, tab, platformSelector, navigation, onAddAccount, preferredAccountRef, onAccountSelected }) {
      const [phone, setPhone] = React.useState('')
      const [code, setCode] = React.useState('')
      const [status, setStatus] = React.useState({ state: 'not-checked' })
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [retry, setRetry] = React.useState(0)
      const [accountRevision, setAccountRevision] = React.useState(0)
      const [method, setMethod] = React.useState('taobao-qr')
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
      const showSms = method === 'sms' && showLogin
      return h('div', { className: 'waimai-stack' },
        h('div', { className: 'waimai-context', 'aria-label': t('accountContext') }, platformSelector,
          h('div', { className: 'waimai-field' }, h('span', { className: 'waimai-label' }, t('accountsTitle')),
            status.accounts?.length ? h(Choice, { label: t('accountsTitle'), value: status.viewAccountRef,
              options: status.accounts.map(account => [account.ref, `${account.nickname || t('unnamedAccount')} · ${t(account.loginMethod === 'taobao-qr' ? 'taobaoQr' : 'smsLogin')}${account.externalId ? ' · ' + account.externalId : ''}`]),
              disabled: busy, t: value => value, onChange: accountRef => void call('accountView', { accountRef }) }) : h('span', { className: 'waimai-hint' }, t('noSavedAccount'))),
          h(Button, { variant: 'outline', disabled: busy || status.addingAccount, icon: h(IconPlusOutlineRegular),
            onClick: () => { onAddAccount(); void call('accountBegin', {}) } }, t('addAccount'))),
        navigation,
        (status.authenticated || !showLogin || showSms) ? h('div', { className: 'waimai-status-row' }, h('div', { className: 'waimai-status-info', role: 'status' },
          h(Tag, { tone: status.authenticated ? 'success' : 'neutral' }, t(`login_${status.state.replaceAll('-', '_')}`)),
          status.authenticated ? h('span', { className: 'waimai-hint' }, t(status.loginMethod === 'taobao-qr' ? 'taobaoQr' : 'smsLogin')) : null),
          h(Button, { variant: 'ghost', disabled: busy, onClick: () => void call('status', {}) }, t('refreshLogin'))) : null,
        error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null,
        busy && status.state === 'not-checked' ? h('div', { role: 'status', 'aria-label': t('loginBusy'), className: 'waimai-loader' }, h(StateDot, { state: 'ongoing', size: 20 })) : null,
        showLogin ? h('section', { className: 'waimai-login-panel waimai-stack', 'aria-label': t('loginTitle') },
          h('div', { className: 'waimai-history-heading' }, h('h3', { className: 'waimai-section-title' }, t(status.addingAccount ? 'addAccount' : 'loginTitle')),
            status.addingAccount ? h(Button, { variant: 'ghost', disabled: busy, onClick: () => void call('accountCancel', {}) }, t('cancelAddAccount')) : null),
          h('div', { className: 'waimai-methods', role: 'group', 'aria-label': t('loginMethod') },
          h(Button, { variant: method === 'taobao-qr' ? 'primary' : 'outline', disabled: busy, onClick: () => setMethod('taobao-qr') }, t('taobaoQr')),
          smsAllowed ? h(Button, { variant: method === 'sms' ? 'primary' : 'outline', disabled: busy, onClick: () => setMethod('sms') }, t('smsLogin')) : null),
        status.taobaoAccounts?.length ? h('div', { className: 'waimai-grid' },
          h(Choice, { label: t('sourceTaobaoAccount'), value: sourceAccountRef || status.taobaoAccounts[0].ref,
            options: status.taobaoAccounts.map(row => [row.ref, row.nickname || t('unnamedAccount')]), t: value => value,
            disabled: busy, onChange: setSourceAccountRef }),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void call('useTaobao', { sourceAccountRef: sourceAccountRef || status.taobaoAccounts[0].ref }) }, t('useTaobaoAccount'))) : null,
        method === 'taobao-qr' ? h(WaimaiTaobaoQr, { rpc: scopedRpc, t, platformId, onProgress: value => setStatus(value), onLinked: value => {
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
            onClick: () => void call('sendCode', { phone }) }, retry > 0 ? `${t('sendCode')} (${retry}s)` : t('sendCode')),
          h(Button, { variant: 'primary', disabled: busy || !loginProgress.codePending || challenge || !/^\d{4,8}$/.test(code),
            onClick: () => void call('complete', { code }) }, t('signIn'))) : null,
        h('p', { className: 'waimai-hint' }, t(method === 'sms' ? 'smsAccountHint' : 'loginProtocol'))) : null,
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
    function WaimaiCart({ rpc, t, platformId, accountId, addressRef }) {
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
          setCart(reply.value); setVisible(20)
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
            h('div', { className: 'waimai-food-top' }, item.imageUrl ? h('img', { src: item.imageUrl, alt: item.name, className: 'waimai-food-image', loading: 'lazy', referrerPolicy: 'no-referrer' }) : null,
              h('div', { className: 'waimai-food-info' }, h('strong', null, item.name),
                h('p', { className: 'waimai-price' }, `${t('advertisedPrice')} ¥${item.price} ${item.priceUnit}`),
                h('p', { className: 'waimai-hint' }, `${t('cartQuantity')}: ${item.quantity} ${item.quantityUnit}${item.specification ? ' · ' + item.specification : ''}`))),
            !item.available ? h(Tag, { tone: 'neutral' }, item.reason || t('cartUnavailable')) : null,
            item.selected ? h(Tag, { tone: 'neutral' }, t('cartSelected')) : null))) : h('p', { className: 'waimai-empty' }, t('cartEmpty')),
          cart.items.length > visible ? h(Button, { variant: 'outline', onClick: () => setVisible(count => count + 20) }, t('moreCart')) : null) : null,
        message ? h('p', { role: 'alert', className: 'waimai-error' }, message) : null,
        h('p', { className: 'waimai-hint' }, t('cartReadOnly')))
    }

    function WaimaiOrdering({ rpc, t, platformId, accountId }) {
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
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const generation = React.useRef(0)
      const address = React.useRef(null)
      const onSelected = React.useCallback(ref => {
        if (address.current === ref) return
        address.current = ref; generation.current++
        setItemToAdd(null); setTradeBusy(false)
        setAddressRef(ref); setPage(null); setMenu(null); setDetail(null); setShowCart(false); setShop(null); setMessage(''); setBusy(false); setKeyword('')
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
          setDetail(reply.value.product)
        } catch { if (current === generation.current) setMessage(t('accountFailed')) }
        finally { if (current === generation.current) setBusy(false) }
      }
      React.useEffect(() => {
        setPage(null); setMenu(null); setDetail(null); setShowCart(false); setShop(null); setMessage(''); setKeyword('')
        void load()
        return () => { generation.current++ }
      }, [addressRef, scope])
      const lower = value => value.toLocaleLowerCase().trim()
      const shops = (page?.shops || []).filter(value => lower(value.name).includes(lower(keyword)))
      const items = new Map()
      for (const group of menu?.categories || []) if (!category || group.id === category) {
        for (const item of group.items) if (platformId === 'hema' || lower(item.name + ' ' + item.description).includes(lower(menuKeyword))) items.set(item.id, item)
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
          showCart ? h(WaimaiCart, { key: `${accountId}:${addressRef}`, rpc, t, platformId, accountId, addressRef }) : shop ? h('div', { className: 'waimai-stack waimai-menu-panel' },
            h('div', { className: 'waimai-history-heading' }, h('h4', { className: 'waimai-section-title' }, shop.name),
              h('div', { className: 'waimai-methods' }, h(Button, { variant: 'ghost', onClick: () => {
                generation.current++; setBusy(false); setShop(null); setMenu(null); setDetail(null); setMessage('')
              } }, t('backToShops')), h(Button, { variant: 'outline', disabled: busy, onClick: () => void loadMenu(shop) }, t('refreshMenu')))),
            detail ? h('section', { className: 'waimai-stack' },
              h(Button, { variant: 'outline', onClick: () => setDetail(null) }, t('backToProducts')),
              h('div', { className: 'waimai-food-top' }, image(detail.imageUrl, detail.name), h('div', { className: 'waimai-food-info' },
                h('h4', { className: 'waimai-section-title' }, detail.name), h('p', { className: 'waimai-price' }, detail.price === null ? t('detailPriceUnavailable') : `${t('advertisedPrice')} ¥${detail.price} / ${detail.priceUnit}`),
                detail.description ? h('p', { className: 'waimai-hint' }, detail.description) : null)),
              h('h4', { className: 'waimai-section-title' }, t('productSpecs')),
              detail.variants.map(value => h('article', { key: value.id, className: 'waimai-food-card' }, h('strong', null, value.name),
                h('p', { className: 'waimai-hint' }, `${t('minimumQuantity')}: ${value.minimumQuantity} ${value.saleUnit} · ${t('quantityStep')}: ${value.quantityStep} ${value.saleUnit}`),
                h('p', { className: 'waimai-hint' }, `${t('stockQuantity')}: ${value.stockQuantity} · ${t('chargeUnit')}: ${value.chargeUnit}`))),
              h('p', { className: 'waimai-hint' }, t('menuPriceHint'))) : menu ? h(React.Fragment, null,
              h('div', { className: 'waimai-grid' }, h(Choice, { value: category, label: t('menuCategory'), t: value => value,
                options: [['', t('allCategories')], ...menu.categories.map(group => [group.id, `${group.name} (${group.items.length})`])],
                onChange: value => { setCategory(value); setVisibleCount(20) } }),
                h(Input, { value: menuKeyword, 'aria-label': t('menuSearch'), placeholder: t('menuSearch'),
                  onChange: event => { setMenuKeyword(event.target.value); setVisibleCount(20) } })),
              platformId === 'hema' ? h(Button, { variant: 'primary', disabled: busy || !menuKeyword.trim(), onClick: () => void loadMenu(shop) }, t('searchProducts')) : null,
              h('p', { className: 'waimai-hint' }, t('menuPriceHint')),
              !items.size ? h('p', { className: 'waimai-empty' }, t(menu.queryRequired ? 'menuSearch' : menu.categories.length ? 'noMatches' : 'noMenu')) : null,
              h('div', { className: 'waimai-food-grid' }, [...items.values()].slice(0, visibleCount).map(item => h('article', { key: item.id, className: 'waimai-food-card' },
                h('div', { className: 'waimai-food-top' }, image(item.imageUrl, item.name), h('div', { className: 'waimai-food-info' },
                  h('strong', null, item.name), item.description ? h('p', { className: 'waimai-hint' }, item.description) : null,
                  h('div', { className: 'waimai-methods' }, h('span', { className: 'waimai-price' }, item.price === null ? t('priceUnavailable') : `${t('advertisedPrice')} ¥${item.price}${item.priceUnit ? ' / ' + item.priceUnit : ''}`),
                    ['sold-out', 'outside-sale-time'].includes(item.availability) ? h(Tag, { tone: 'neutral' }, t(item.availability === 'sold-out' ? 'soldOut' : 'outsideSaleTime')) : null),
                  item.tips.length ? h('p', { className: 'waimai-hint' }, item.tips.join(' · ')) : null)),
                platformId === 'hema' && item.productRef ? h(Button, { variant: 'outline', disabled: busy, onClick: () => void loadDetail(item) }, t('productDetails')) : null,
                platformId === 'taobao' ? h(Button, { variant: 'outline', disabled: busy || tradeBusy || item.availability !== 'available',
                  onClick: () => { setTradeBusy(true); setItemToAdd({ id: item.id, operationRef: crypto.randomUUID() }) } }, t('addToCart')) : null,
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
            accountId, addressRef, shopId: shop.id, itemToAdd, onConsumed: () => setItemToAdd(null), onBusy: setTradeBusy }) : null,
          platformId !== 'taobao' ? h('p', { className: 'waimai-hint' }, t('orderingBlocked')) : null))
    }

    /** Financial actions consume an opaque Host quote; account/address/shop changes unmount all private state. */
    function WaimaiTrade({ rpc, t, accountId, addressRef, shopId, itemToAdd, onConsumed, onBusy }) {
      const [cart, setCart] = React.useState(null), [quote, setQuote] = React.useState(null), [order, setOrder] = React.useState(null)
      const [records, setRecords] = React.useState([]), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false)
      const [confirmed, setConfirmed] = React.useState(false), [now, setNow] = React.useState(Date.now)
      const [uncertain, setUncertain] = React.useState(false)
      const alive = React.useRef(true), inFlight = React.useRef(false), consumed = React.useRef(null)
      const money = value => `¥${(value / 100).toFixed(2)}`
      const base = { platformId: 'taobao', addressRef, shopId }
      const read = async (endpoint, payload) => {
        const reply = await rpc.call('/waimai-login', endpoint, payload)
        if (!reply.ok) throw new Error(reply.error.message)
        if (reply.value.accountId !== accountId || (reply.value.addressRef !== undefined && reply.value.addressRef !== addressRef)
          || (reply.value.shopId !== undefined && reply.value.shopId !== shopId)) throw new Error(t('accountChanged'))
        return reply.value
      }
      const run = async (endpoint, payload) => {
        if (inFlight.current) return
        inFlight.current = true; setBusy(true); onBusy(true); setMessage(''); setConfirmed(false)
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
        } catch (error) {
          if (alive.current) { setMessage(error.message || t('accountFailed')); if (endpoint === 'submit') { setQuote(null); setUncertain(true) } }
        } finally {
          inFlight.current = false
          if (alive.current) { setBusy(false); onBusy(false); if (endpoint === 'cartChange') onConsumed() }
        }
      }
      React.useEffect(() => {
        alive.current = true
        void run('cart', base)
        void read('tradeHistory', { platformId: 'taobao' }).then(value => { if (alive.current) setRecords(value.attempts) })
          .catch(error => { if (alive.current) setMessage(error.message || t('accountFailed')) })
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => { alive.current = false; clearInterval(timer); onBusy(false) }
      }, [])
      React.useEffect(() => {
        if (itemToAdd && !busy && consumed.current !== itemToAdd.operationRef) {
          consumed.current = itemToAdd.operationRef
          void run('cartChange', { itemId: itemToAdd.id, step: 1, operationRef: itemToAdd.operationRef })
        }
      }, [itemToAdd, busy])
      const seconds = quote ? Math.max(0, Math.ceil((quote.expiresAt - now) / 1000)) : 0
      const expired = quote && seconds === 0
      const handoff = value => value.paymentUrl ? h('a', { href: value.paymentUrl, target: '_blank', rel: 'noopener noreferrer', className: 'waimai-pay-link' }, t('payOfficial'))
        : h('p', { className: 'waimai-hint' }, t('noPaymentLink'))
      return h('section', { className: 'waimai-stack waimai-menu-panel', 'aria-busy': busy },
        h('div', { className: 'waimai-history-heading' }, h('h4', { className: 'waimai-section-title' }, t('cartTitle')),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void run('cart', base) }, t('refreshCart'))),
        h('p', { className: 'waimai-hint' }, t('tradeCartHint')),
        cart && !cart.quantity ? h('p', { className: 'waimai-empty' }, t('cartEmpty')) : null,
        cart?.items.map(item => h('div', { key: item.ref, className: 'waimai-history-heading' },
          h('span', null, `${item.name} × ${item.quantity} · ${money(item.totalCents)}`),
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
          quote.previewOnly ? h('p', { className: 'waimai-hint' }, t('tradePreview')) : null,
          quote.totalCents > quote.maxOrderCents ? h('p', { className: 'waimai-error' }, t('orderCapExceeded')) : null,
          h('label', { className: 'waimai-methods' }, h(Checkbox, { checked: confirmed, disabled: busy || expired || quote.previewOnly,
            onChange: event => setConfirmed(event.target.checked) }), t('tradeConfirm')),
          h(Button, { variant: 'primary', disabled: busy || !confirmed || expired || quote.previewOnly || quote.totalCents > quote.maxOrderCents,
            onClick: () => void run('submit', { platformId: 'taobao', quoteRef: quote.quoteRef, confirmed: true, confirmedCents: quote.totalCents }) }, t('createOrder'))) : null,
        order ? h('section', { className: 'waimai-stack' }, h('strong', null, t('orderCreated')),
          h('p', null, `${t('orderId')}: ${order.orderIds.join(', ')}`), handoff(order)) : null,
        records.length ? h('details', null, h('summary', null, t('orderRecord')), records.map(record => h('div', { key: record.orderRef, className: 'waimai-stack' },
          h('p', null, `${record.day} · ${record.merchant} · ${money(record.amountCents)}`),
          record.status === 'unknown' ? h('p', { role: 'alert', className: 'waimai-error' }, t('orderUnknown')) : h(React.Fragment, null,
            h('p', null, `${t('orderId')}: ${record.orderIds.join(', ')}`), handoff(record))))) : null,
        message ? h('p', { role: 'alert', className: 'waimai-error' }, message) : null,
        busy ? h('div', { role: 'status', 'aria-label': t('loginBusy') }, h(StateDot, { state: 'ongoing', size: 20 })) : null)
    }

    /** Platform changes unmount private views before requesting another platform. */
    function WaimaiPlatformCard(props) {
      const [platforms, setPlatforms] = React.useState(null)
      const [view, setView] = React.useState(readView)
      const [platformId, setPlatformId] = React.useState(view.platformId || props.defaultPlatform)
      const [tab, setTab] = React.useState('accounts')
      const [error, setError] = React.useState('')
      const [preferenceError, setPreferenceError] = React.useState(false)
      const remember = update => {
        setView(current => update(current))
        setPreferenceError(!rememberView(update))
      }
      React.useEffect(() => {
        let alive = true
        void props.rpc.call('/waimai-login', 'platforms', {}).then(reply => {
          if (!alive) return
          if (!reply.ok || !Array.isArray(reply.value) || !reply.value.some(value => value.id === props.defaultPlatform)) { setError(props.t('platformFailed')); return }
          if (!reply.value.some(value => value.id === platformId)) {
            setPlatformId(props.defaultPlatform)
            remember(current => ({ ...current, platformId: props.defaultPlatform }))
          }
          setPlatforms(reply.value)
        }).catch(() => { if (alive) setError(props.t('platformFailed')) })
        return () => { alive = false }
      }, [])
      if (!platforms) return error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : h('div', { role: 'status', 'aria-label': props.t('loginBusy'), className: 'waimai-loader' }, h(StateDot, { state: 'ongoing', size: 20 }))
      const platform = platforms.find(value => value.id === platformId)
      const overrides = new Set(['qr_linked', 'qrCheck', 'qr_business_unconfirmed', 'ordering', 'nearbyShops', 'recentShops', 'selectAddressFirst',
        'orderingBlocked', 'viewMenu', 'recentScope', 'noNearbyShops', 'noShops', 'menuSearch', 'menuPriceHint', 'refreshMenu', 'backToShops',
        'menuCategory', 'allCategories', 'moreItems', 'refreshShops', 'shopFilter', 'noMenu'])
      const viewT = key => props.t(platformId === 'hema' && overrides.has(key) ? 'hema_' + key : key)
      const platformSelector = h('div', { className: 'waimai-field' }, h('span', { className: 'waimai-label' }, props.t('platform')),
        h(Choice, { label: props.t('platform'), value: platformId, options: platforms.map(value => [value.id, value.names[props.t('platformLanguage')]]), t: value => value,
          onChange: value => { remember(current => ({ ...current, platformId: value })); setPlatformId(value); setTab('accounts') } }))
      const navigation = h('nav', { className: 'waimai-tabs', 'aria-label': props.t('title') }, ['accounts', 'ordering', 'historyTitle', 'tasks', 'settings'].map(value =>
        h(Button, { key: value, variant: tab === value ? 'primary' : 'ghost', 'aria-pressed': tab === value, onClick: () => setTab(value) }, viewT(value))))
      return h('div', { className: 'waimai-stack' },
        platform.capabilities.login
          ? h(WaimaiLoginForm, { ...props, t: viewT, smsAllowed: platformId !== 'hema', key: platformId, platformId, tab, platformSelector, navigation, onAddAccount: () => setTab('accounts'),
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
