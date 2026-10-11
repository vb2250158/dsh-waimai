/**
 * The bundle settings page edits coupons and scheduled orders through the
 * Host-owned configuration form. Writes use its revision fence and readback.
 */

window.__ModuleLoader__.load({
  id: 'dsh-waimai',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { Button, Input, Switch, Menu, Checkbox, Tag, IconPlusOutlineRegular,
      IconChevronDownOutlineRegular, IconTrashOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** Locale namespace owned by this card. */
    const LOCALE_NS = 'settings.waimai'
    /** Host plugin entry id; also the settings namespace holding the configuration. */
    const HOST_NS = 'waimai'

    const zh = {
      title: '外卖助手',
      intro: '配置免费券领取、用券、点单时间、菜单和预算。',
      unavailable: '配置尚未就绪。请确认插件已加载并完成一次配置读取。',
      mode: '支付模式',
      claimCoupons: '自动领取免费优惠券',
      useCoupons: '自动使用可用优惠券',
      checked: '已勾选',
      unchecked: '未勾选',
      preview: '预览模式',
      previewOn: '已开启：不提交、不支付',
      previewOff: '已关闭：按任务配置执行',
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
      browserHint: '点餐与支付通过本机浏览器页面完成。',
      manualHint: '当前为手动支付：插件最多把订单提交到确认页，扣款必须由你完成。',
      autoHint: '当前为自动支付：服务端会从页面读取金额与商家，并在上限与白名单内完成后扣款。',
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
      loginTitle: '登录饿了么', phone: '中国大陆手机号', smsCode: '短信验证码',
      sendCode: '获取验证码', signIn: '登录', refreshLogin: '检查登录状态', loginBusy: '处理中…',
      loginFailed: '登录服务不可用，请检查插件状态。', persistLogin: '记住本机登录',
      login_not_checked: '尚未检查登录状态', login_logged_out: '未登录', login_logged_in: '已登录',
      login_code_sent: '短信已发送，请输入验证码', login_verification_required: '平台要求额外验证，暂时无法在这里完成登录。',
      login_registration_required: '平台要求注册确认，本次登录已停止。', login_send_unknown: '验证码发送结果未确认，请先检查短信。',
      login_send_rejected: '平台未确认发送验证码，请稍后重试。', login_login_unknown: '登录结果未确认，请检查登录状态。',
      login_login_rejected: '平台未接受本次登录，请核对验证码。', login_login_unconfirmed: '登录尚未确认，请检查登录状态。',
      loginProtocol: '仅支持已有账号；需要平台额外验证时会停止。',
      avatar: '用户头像', accountId: '账号 ID', nickname: '昵称', accountPhone: '手机号',
      historyTitle: '历史订单', refreshAccount: '刷新账号与订单', latestOrders: '返回最新订单', olderOrders: '下一页',
      noOrders: '暂无历史订单', accountBusy: '正在读取账号与订单…', accountFailed: '账号或订单读取失败，请稍后刷新。',
      accountChanged: '账号已变化，请重新检查登录状态。', page: '页', orderId: '订单号', historyPageSize: '历史订单每页条数',
    }
    const en = {
      title: 'Takeaway assistant',
      intro: 'Configure free coupon claims, coupon selection, schedules, menus and budgets.',
      unavailable: 'Configuration is not ready yet.',
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
      loginTitle: 'Sign in to Ele.me', phone: 'Mainland China mobile number', smsCode: 'SMS code',
      sendCode: 'Send code', signIn: 'Sign in', refreshLogin: 'Check sign-in status', loginBusy: 'Working…',
      loginFailed: 'Sign-in service is unavailable. Check the plugin status.', persistLogin: 'Remember sign-in on this computer',
      login_not_checked: 'Sign-in status not checked', login_logged_out: 'Signed out', login_logged_in: 'Signed in',
      login_code_sent: 'SMS sent. Enter the code.', login_verification_required: 'The platform requires additional verification. Sign-in cannot finish here yet.',
      login_registration_required: 'The platform requires registration confirmation. Sign-in stopped.', login_send_unknown: 'SMS delivery is unconfirmed. Check your messages first.',
      login_send_rejected: 'The platform did not confirm SMS delivery. Try again later.', login_login_unknown: 'Sign-in is unconfirmed. Check the status.',
      login_login_rejected: 'The platform rejected sign-in. Check the code.', login_login_unconfirmed: 'Sign-in is not confirmed. Check the status.',
      loginProtocol: 'Existing accounts only. Additional platform verification stops sign-in.',
      avatar: 'User avatar', accountId: 'Account ID', nickname: 'Nickname', accountPhone: 'Phone',
      historyTitle: 'Order history', refreshAccount: 'Refresh account and orders', latestOrders: 'Latest orders', olderOrders: 'Next page',
      noOrders: 'No previous orders', accountBusy: 'Loading account and orders…', accountFailed: 'Could not read account or orders. Refresh later.',
      accountChanged: 'The account changed. Check sign-in status again.', page: 'Page', orderId: 'Order ID', historyPageSize: 'Orders per history page',
    }

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
          onChange: value => update(name, value), disabled: locked, t })
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
        change('autoTasks', [...draft.autoTasks, { id, name: '', enabled: false, triggerTime: '11:00', dateRule: 'workday',
          customDays: ['mon', 'tue', 'wed', 'thu', 'fri'], skipDates: [], menuPool: [], menuStrategy: 'rotate',
          maxOrderAmount: draft.maxOrderAmount, dailyBudget: 50, paymentMode: 'manual', merchantWhitelist: [], notifyOnSuccess: true, notifyOnFailure: true }])
        setExpanded(id)
      }
      return h('form', { onSubmit: save, className: 'waimai-form' },
        section('coupons', 'coupons', h('div', { className: 'waimai-stack' },
          toggle(draft, 'autoClaimCoupons', 'claimCoupons', change, 'claimHint'),
          toggle(draft, 'autoUseCoupons', 'useCoupons', change, 'useHint'),
          draft.autoClaimCoupons ? field(draft, 'couponClaimLimit', 'couponClaimLimit', 'number', change, { min: 1, max: 50, step: 1, required: true }) : null)),
        section('order', 'order', h('div', { className: 'waimai-stack' },
          toggle(draft, 'dryRun', 'preview', change, 'previewHint'),
          h('div', { className: 'waimai-grid' },
            field(draft, 'maxOrderAmount', 'cap', 'number', change, { min: 1, step: 1, required: true }),
            field(draft, 'dailyBudget', 'budget', 'number', change, { min: 0, step: 1, required: true })),
          hint('currencyHint'), field(draft, 'paymentMode', 'mode', 'choice', change, { values: paymentOptions }),
          hint(draft.paymentMode === 'auto' ? 'autoHint' : 'manualHint'),
          field(draft, 'merchantWhitelist', 'whitelist', 'lines', change, { hint: 'whitelistHint', rows: 2 }))),
        section('tasks', 'tasks', h('div', { className: 'waimai-stack' },
          draft.autoTasks.length === 0 ? h('div', { className: 'waimai-empty' }, h('strong', null, t('emptyTasks')), hint('emptyHint')) : null,
          draft.autoTasks.map((task, index) => {
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
          h(Button, { variant: 'outline', disabled: locked, icon: h(IconPlusOutlineRegular), onClick: addTask }, t('addTask')))),
        h('details', { className: 'waimai-details waimai-section' }, h('summary', null, t('advanced')),
          h('div', { className: 'waimai-stack' },
            field(draft, 'browserChannel', 'browserChannel', 'choice', change, { values: [['chrome', 'chrome'], ['msedge', 'msedge'], ['chromium', 'chromium']] }),
            toggle(draft, 'headless', 'headless', change), toggle(draft, 'persistLogin', 'persistLogin', change),
            field(draft, 'historyPageSize', 'historyPageSize', 'number', change, { min: 1, max: 20, step: 1, required: true }),
            field(draft, 'deliveryAddress', 'deliveryAddress', 'text', change), hint('browserHint'))),
        h('div', { className: 'waimai-footer' },
          h('span', { role: message === 'saveFailed' ? 'alert' : 'status', className: message === 'saveFailed' ? 'waimai-error' : 'waimai-hint' },
            t(busy ? 'saving' : message || (dirty ? 'pending' : 'unchanged'))),
          h('div', { className: 'waimai-actions' },
            dirty ? h(Button, { disabled: locked, onClick: () => { setDraft(structuredClone(snapshot.value)); setMessage('') } }, t('reset')) : null,
            h(Button, { type: 'submit', variant: 'primary', disabled: locked || !dirty }, t(busy ? 'saving' : 'save')))))
    }

    /** Account reads replace one bounded page and discard late replies after refresh or unmount. */
    function WaimaiAccount({ rpc, t }) {
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
            rpc.call('/waimai-login', 'profile', {}),
            rpc.call('/waimai-login', 'orders', cursor ? { cursor } : {}),
          ])
          if (current !== generation.current) return
          if (!account.ok) { setProfile(null); setHistory(null); setError(account.error.message); return }
          if (orders.ok && orders.value.accountId !== account.value.id) {
            setProfile(null); setHistory(null); setError(t('accountChanged')); return
          }
          setProfile(account.value); setAvatarFailed(false)
          setHistory(orders.ok ? orders.value : null)
          setPage(pageNumber)
          if (!orders.ok) setError(orders.error.message)
        } catch (_error) {
          if (current === generation.current) { setProfile(null); setHistory(null); setError(t('accountFailed')) }
        } finally { if (current === generation.current) setBusy(false) }
      }
      React.useEffect(() => { void load(); return () => { generation.current++ } }, [])
      return h('div', { className: 'waimai-stack', 'aria-busy': busy },
        profile ? h('div', { className: 'waimai-account' },
          profile.avatarUrl && !avatarFailed
            ? h('img', { className: 'waimai-avatar', src: profile.avatarUrl, alt: t('avatar'), width: 56, height: 56,
              referrerPolicy: 'no-referrer', onError: () => setAvatarFailed(true) })
            : h('span', { className: 'waimai-avatar waimai-avatar-fallback', role: 'img', 'aria-label': t('avatar') }, (profile.nickname || profile.id).slice(0, 1)),
          h('div', { className: 'waimai-account-info' },
            h('strong', { className: 'waimai-account-name', 'aria-label': t('nickname') }, profile.nickname || profile.id),
            h('span', { className: 'waimai-hint' }, `${t('accountId')}: ${profile.id}`),
            profile.maskedPhone ? h('span', { className: 'waimai-hint' }, `${t('accountPhone')}: ${profile.maskedPhone}`) : null)) : null,
        h('div', { className: 'waimai-history-heading' }, h('h4', { className: 'waimai-section-title' }, t('historyTitle')),
          h(Button, { variant: 'outline', disabled: busy, onClick: () => void load() }, t('refreshAccount'))),
        busy ? h('p', { role: 'status', className: 'waimai-hint' }, t('accountBusy')) : null,
        error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null,
        history ? h('div', { className: 'waimai-stack' },
          history.orders.length === 0 ? h('p', { className: 'waimai-empty' }, t('noOrders')) : null,
          history.orders.map(order => h('article', { key: order.id, className: 'waimai-order' },
            h('div', { className: 'waimai-order-heading' }, h('strong', null, order.merchantName), h('span', null, `¥${order.amount}`)),
            h('div', { className: 'waimai-order-heading waimai-hint' }, h('time', { dateTime: new Date(order.createdAt).toISOString() }, new Date(order.createdAt).toLocaleString()), h('span', null, order.status)),
            h('ul', { className: 'waimai-order-items' }, order.items.map((item, index) => h('li', { key: index }, `${item.name} × ${item.count}`))),
            h('div', { className: 'waimai-hint' }, `${t('orderId')}: ${order.id}`))),
          h('div', { className: 'waimai-history-heading' }, h('span', { className: 'waimai-hint' }, `${t('page')} ${page}`),
            h('div', { className: 'waimai-actions' },
              page > 1 ? h(Button, { variant: 'ghost', disabled: busy, onClick: () => void load() }, t('latestOrders')) : null,
              history.nextCursor ? h(Button, { variant: 'outline', disabled: busy, onClick: () => void load(history.nextCursor, page + 1) }, t('olderOrders')) : null))) : null)
    }

    /** Login inputs are transient; only the authenticated Host RPC receives credentials. */
    function WaimaiLoginForm({ rpc, t }) {
      const [phone, setPhone] = React.useState('')
      const [code, setCode] = React.useState('')
      const [status, setStatus] = React.useState({ state: 'not-checked' })
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [retry, setRetry] = React.useState(0)
      const [accountRevision, setAccountRevision] = React.useState(0)
      const call = async (endpoint, payload) => {
        setBusy(true); setError('')
        try {
          const result = await rpc.call('/waimai-login', endpoint, payload)
          if (!result.ok) { setError(result.error.message); return }
          setStatus(result.value); setRetry(result.value.retryAfterSeconds || 0)
          if (result.value.authenticated) { setPhone(''); setCode(''); setAccountRevision(value => value + 1) }
          else if (endpoint === 'sendCode') setCode('')
        } catch { setError(t('loginFailed')) }
        finally { setBusy(false) }
      }
      React.useEffect(() => { void call('status', {}) }, [])
      React.useEffect(() => {
        if (retry <= 0) return
        const timer = setInterval(() => setRetry(value => Math.max(0, value - 1)), 1000)
        return () => clearInterval(timer)
      }, [retry > 0])
      const challenge = ['verification-required', 'registration-required'].includes(status.state)
      return h('section', { className: 'waimai-section waimai-stack', 'aria-label': t('loginTitle') },
        h('h3', { className: 'waimai-section-title' }, t('loginTitle')),
        h('p', { role: 'status', className: 'waimai-hint' }, t(`login_${status.state.replaceAll('-', '_')}`),
          status.maskedPhone ? ` · ${status.maskedPhone}` : ''),
        !status.authenticated ? h('div', { className: 'waimai-grid' },
          h('label', { className: 'waimai-field' }, h('span', { className: 'waimai-label' }, t('phone')),
            h(Input, { type: 'tel', autoComplete: 'tel', inputMode: 'numeric', maxLength: 11,
              value: phone, disabled: busy, onChange: event => { setPhone(event.target.value); setCode(''); setStatus(current => ({ ...current, codePending: false })) } })),
          h('label', { className: 'waimai-field' }, h('span', { className: 'waimai-label' }, t('smsCode')),
            h(Input, { type: 'text', autoComplete: 'one-time-code', inputMode: 'numeric', maxLength: 8,
              value: code, disabled: busy || !status.codePending || challenge, onChange: event => setCode(event.target.value) }))) : null,
        h('div', { className: 'waimai-actions' },
          !status.authenticated ? h(Button, { variant: 'outline', disabled: busy || retry > 0 || !/^1[3-9]\d{9}$/.test(phone),
            onClick: () => void call('sendCode', { phone }) }, retry > 0 ? `${t('sendCode')} (${retry}s)` : t('sendCode')) : null,
          !status.authenticated ? h(Button, { variant: 'primary', disabled: busy || !status.codePending || challenge || !/^\d{4,8}$/.test(code),
            onClick: () => void call('complete', { code }) }, t('signIn')) : null,
          h(Button, { variant: 'ghost', disabled: busy, onClick: () => void call('status', {}) }, t('refreshLogin'))),
        busy ? h('p', { role: 'status', className: 'waimai-hint' }, t('loginBusy')) : null,
        error ? h('p', { role: 'alert', className: 'waimai-error' }, error) : null,
        status.authenticated ? h(WaimaiAccount, { key: accountRevision, rpc, t }) : h('p', { className: 'waimai-hint' }, t('loginProtocol')))
    }

    /** Render the editable card only after the Host provides its configuration. */
    function WaimaiSettingsCard(props) {
      const snapshot = React.useSyncExternalStore(props.subscribe, props.getSnapshot, props.getSnapshot)
      if (snapshot?.status !== 'ready') return h('p', { className: 'waimai-hint' }, props.t('unavailable'))
      return h('div', { className: 'waimai-settings' }, h('p', { className: 'waimai-intro' }, props.t('intro')),
        h(WaimaiLoginForm, props),
        h(WaimaiSettingsForm, props))
    }

    const styles = `
      .waimai-settings { color:var(--dsw-alias-label-primary); font-size:14px; line-height:22px; min-width:0; }
      .waimai-intro,.waimai-hint { margin:0; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .waimai-intro { margin-bottom:20px; font-size:13px; line-height:20px; }
      .waimai-form,.waimai-stack { display:flex; flex-direction:column; gap:16px; }
      .waimai-section { padding:0 0 20px; border-bottom:0.5px solid var(--dsw-alias-border-l2); }
      .waimai-section-title { margin:0 0 14px; font-size:14px; line-height:22px; font-weight:600; }
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
      .waimai-actions { display:flex; gap:8px; margin-left:auto; }
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
