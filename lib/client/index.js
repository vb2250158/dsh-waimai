/**
 * The bundle settings page edits coupons and scheduled orders through the
 * Host-owned configuration form. Writes use its revision fence and readback.
 */

window.__ModuleLoader__.load({
  id: 'dsh-waimai',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

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
      browserHint: '登录、验证码和支付需要在本机浏览器窗口中手动完成；插件不会替你输入密码。',
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
      browserHint: 'Sign-in, captchas, and payment happen in the local browser window; the plugin never types your password.',
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
    }

    /** Editable fields persist together through the Host revision fence. */
    function WaimaiSettingsForm(props) {
      const snapshot = React.useSyncExternalStore(props.subscribe, props.getSnapshot, props.getSnapshot)
      const [draft, setDraft] = React.useState(() => structuredClone(snapshot.value))
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState('')
      React.useEffect(() => { setDraft(structuredClone(snapshot.value)) }, [snapshot.revision])
      const t = props.t
      if (!draft) return null
      const controlStyle = { font: 'inherit', color: 'inherit', background: 'var(--dsw-alias-bg-primary)', border: '1px solid var(--dsw-alias-border-subtle)', borderRadius: 6, padding: 6 }
      const change = (field, value) => { setMessage(''); setDraft(current => ({ ...current, [field]: value })) }
      const taskChange = (index, field, value) => change('autoTasks', draft.autoTasks.map((task, i) => i === index ? { ...task, [field]: value } : task))
      const input = (values, field, label, type, update, options = {}) => h('label', { key: field,
        style: { display: 'flex', flexDirection: type === 'checkbox' ? 'row' : 'column', gap: 6, alignItems: type === 'checkbox' ? 'center' : 'stretch' } }, [
        h('span', { key: 'label' }, t(label)),
        type === 'select' ? h('select', { key: 'control', value: values[field], style: controlStyle,
          onChange: event => update(field, event.target.value) }, options.values.map(([value, label]) => h('option', { key: value, value }, t(label))))
        : type === 'lines' ? h('textarea', { key: 'control', style: controlStyle, rows: options.rows ?? 3,
          placeholder: options.placeholder ? t(options.placeholder) : undefined,
          value: (values[field] ?? []).join('\n'), required: options.required,
          onChange: event => update(field, event.target.value.split('\n')) })
        : h('input', { key: 'control', style: type === 'checkbox' ? undefined : controlStyle,
          type, min: options.min, max: options.max, step: options.step,
          required: options.required, checked: type === 'checkbox' ? values[field] === true : undefined,
          value: type === 'checkbox' ? undefined : values[field] ?? '',
          onChange: event => update(field, type === 'checkbox' ? event.target.checked : type === 'number' ? Number(event.target.value) : event.target.value) }),
      ])
      const paymentOptions = [['manual', 'modeManual'], ['auto', 'modeAuto']]
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
      return h('form', { onSubmit: save, style: { display: 'flex', flexDirection: 'column', gap: 12 } }, [
        h('h3', { key: 'title', style: { margin: 0 } }, t('settings')),
        h('fieldset', { key: 'fields', disabled: busy || !snapshot.writable, style: { border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 } }, [
          input(draft, 'autoClaimCoupons', 'claimCoupons', 'checkbox', change),
          input(draft, 'autoUseCoupons', 'useCoupons', 'checkbox', change),
          input(draft, 'couponClaimLimit', 'couponClaimLimit', 'number', change, { min: 1, max: 50, step: 1, required: true }),
          input(draft, 'dryRun', 'preview', 'checkbox', change),
          input(draft, 'paymentMode', 'mode', 'select', change, { values: paymentOptions }),
          input(draft, 'maxOrderAmount', 'cap', 'number', change, { min: 1, step: 1, required: true }),
          input(draft, 'dailyBudget', 'budget', 'number', change, { min: 0, step: 1, required: true }),
          input(draft, 'merchantWhitelist', 'whitelist', 'lines', change),
          input(draft, 'browserChannel', 'browserChannel', 'select', change, { values: [['chrome', 'chrome'], ['msedge', 'msedge'], ['chromium', 'chromium']] }),
          input(draft, 'headless', 'headless', 'checkbox', change),
          input(draft, 'deliveryAddress', 'deliveryAddress', 'text', change),
          ...(draft.autoTasks ?? []).map((task, index) => h('details', { key: task.id, open: true }, [
            h('summary', { key: 'name' }, task.name || t('tasks')),
            h('div', { key: 'editor', style: { display: 'grid', gap: 10, padding: '12px 0' } }, [
              input(task, 'name', 'name', 'text', (field, value) => taskChange(index, field, value)),
              input(task, 'enabled', 'enabled', 'checkbox', (field, value) => taskChange(index, field, value)),
              input(task, 'triggerTime', 'triggerTime', 'time', (field, value) => taskChange(index, field, value), { required: true }),
              input(task, 'dateRule', 'dateRule', 'select', (field, value) => taskChange(index, field, value), { values: ['workday', 'weekend', 'everyday', 'custom'].map(value => [value, value]) }),
              task.dateRule === 'custom' ? h('div', { key: 'days' }, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => input({ [day]: task.customDays.includes(day) }, day, day, 'checkbox', (_field, selected) => taskChange(index, 'customDays', selected ? [...task.customDays, day] : task.customDays.filter(value => value !== day))))) : null,
              input(task, 'skipDates', 'skipDates', 'lines', (field, value) => taskChange(index, field, value)),
              input(task, 'menuPool', 'menuPool', 'lines', (field, value) => taskChange(index, field, value), { required: task.enabled, placeholder: 'menuHint' }),
              input(task, 'menuStrategy', 'menuStrategy', 'select', (field, value) => taskChange(index, field, value), { values: ['rotate', 'random', 'history'].map(value => [value, value]) }),
              input(task, 'maxOrderAmount', 'cap', 'number', (field, value) => taskChange(index, field, value), { min: 1, step: 1, required: true }),
              input(task, 'dailyBudget', 'budget', 'number', (field, value) => taskChange(index, field, value), { min: 1, step: 1, required: true }),
              input(task, 'paymentMode', 'mode', 'select', (field, value) => taskChange(index, field, value), { values: paymentOptions }),
              input(task, 'merchantWhitelist', 'whitelist', 'lines', (field, value) => taskChange(index, field, value)),
              h('button', { key: 'delete', type: 'button', onClick: () => change('autoTasks', draft.autoTasks.filter((_task, i) => i !== index)) }, t('removeTask')),
            ]),
          ])),
          h('button', { key: 'add', type: 'button', onClick: () => change('autoTasks', [...draft.autoTasks, {
            id: crypto.randomUUID(), name: '', enabled: false, triggerTime: '11:00', dateRule: 'workday', customDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
            skipDates: [], menuPool: [], menuStrategy: 'rotate', maxOrderAmount: draft.maxOrderAmount, dailyBudget: 50, paymentMode: 'manual', merchantWhitelist: [], notifyOnSuccess: true, notifyOnFailure: true,
          }]) }, t('addTask')),
          h('button', { key: 'save', type: 'submit' }, t('save')),
        ]),
        message ? h('p', { key: 'message', role: 'status' }, t(message)) : null,
      ])
    }

    /**
     * Render one label/value row.
     *
     * @param label - localized row label.
     * @param value - already-localized value text.
     * @param key - React key.
     * @returns the row element.
     */
    const row = (label, value, key) => h('div', {
      key,
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '4px 0',
        fontSize: '13px',
      },
    }, [
      h('span', { key: 'l', style: { color: 'var(--dsw-alias-text-secondary)' } }, label),
      h('span', { key: 'v', style: { color: 'var(--dsw-alias-text-primary)', fontWeight: 500 } }, value),
    ])

    /**
     * The settings card.
     *
     * @param props - injected form accessors plus the localizer.
     * @returns the card element.
     */
    function WaimaiSettingsCard(props) {
      const snapshot = React.useSyncExternalStore(
        props.subscribe,
        props.getSnapshot,
        props.getSnapshot,
      )
      const t = props.t
      const value = snapshot?.status === 'ready' ? snapshot.value : undefined

      if (value === undefined) {
        return h('div', { style: { padding: '8px 0', fontSize: '13px' } }, t('unavailable'))
      }

      const tasks = Array.isArray(value.autoTasks) ? value.autoTasks : []
      const enabledTasks = tasks.filter(task => task.enabled === true)
      const whitelist = Array.isArray(value.merchantWhitelist) ? value.merchantWhitelist : []
      const automatic = value.paymentMode === 'auto'
      const budget = Number(value.dailyBudget) > 0 ? `¥${value.dailyBudget}` : t('unlimited')

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
        h('p', {
          key: 'intro',
          style: { margin: 0, fontSize: '13px', color: 'var(--dsw-alias-text-secondary)' },
        }, t('intro')),
        h('div', {
          key: 'rows',
          style: {
            border: '1px solid var(--dsw-alias-border-subtle)',
            borderRadius: '8px',
            padding: '8px 12px',
          },
        }, [
          row(t('preview'), value.dryRun !== false ? t('previewOn') : t('previewOff'), 'preview'),
          row(t('mode'), automatic ? t('modeAuto') : t('modeManual'), 'mode'),
          row(t('claimCoupons'), value.autoClaimCoupons !== false ? t('checked') : t('unchecked'), 'claimCoupons'),
          row(t('useCoupons'), value.autoUseCoupons !== false ? t('checked') : t('unchecked'), 'useCoupons'),
          row(t('cap'), `¥${value.maxOrderAmount}`, 'cap'),
          row(t('budget'), budget, 'budget'),
          row(t('whitelist'), whitelist.length > 0 ? whitelist.join('、') : t('anyMerchant'), 'whitelist'),
          row(t('tasks'), `${tasks.length} / ${enabledTasks.length}`, 'tasks'),
          row(t('tools'), 'mcp__waimai__*', 'tools'),
        ]),
        h('p', {
          key: 'hint',
          style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-text-secondary)' },
        }, value.dryRun !== false ? t('previewHint') : automatic ? t('autoHint') : t('manualHint')),
        h('p', {
          key: 'browser',
          style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-text-secondary)' },
        }, t('browserHint')),
        h('p', {
          key: 'log',
          style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-text-secondary)' },
        }, t('logHint')),
        h(WaimaiSettingsForm, { key: 'form', ...props }),
      ])
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      /**
       * Mount the card once the Host serves this plugin's settings namespace.
       *
       * @param ctx - browser plugin context.
       */
      apply(ctx) {
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
              t,
            }),
          }, WaimaiSettingsCard),
        )), 'dsh-waimai: settings card')
      },
    }
  },
})
