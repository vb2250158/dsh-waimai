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
      coupons: '优惠券', claimHint: '只领取免费券，不购买券包或会员。', useHint: '结算时选择可用优惠券，按实付金额检查预算。',
      order: '点单与预算', advanced: '浏览器与配送', taskAdvanced: '更多任务设置',
      emptyTasks: '还没有自动化任务', emptyHint: '添加时间、菜单和预算；新任务默认暂停。',
      enabledState: '已启用', paused: '已暂停', untitled: '未命名任务', editTask: '编辑任务', collapseTask: '收起任务',
      pending: '有未保存的修改', unchanged: '设置已同步', saving: '保存中…', reset: '撤销修改',
      currencyHint: '金额单位：元；每日上限为 0 时不限制。', whitelistHint: '每行一个商家名称；自动支付只允许白名单内的商家。',
      timeHint: '24 小时制，例如 11:00', noClaims: '开启自动领取后可调整领取数量。',
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
      coupons: 'Coupons', claimHint: 'Claim free coupons only; never buy coupon packs or memberships.', useHint: 'Choose eligible coupons at checkout and check the amount due against the budget.',
      order: 'Orders and budgets', advanced: 'Browser and delivery', taskAdvanced: 'More task settings',
      emptyTasks: 'No scheduled tasks yet', emptyHint: 'Add a schedule, menu and budget. New tasks start paused.',
      enabledState: 'Enabled', paused: 'Paused', untitled: 'Untitled task', editTask: 'Edit task', collapseTask: 'Collapse task',
      pending: 'Unsaved changes', unchanged: 'Settings are up to date', saving: 'Saving…', reset: 'Discard changes',
      currencyHint: 'Amounts in CNY; a daily limit of 0 means no limit.', whitelistHint: 'One merchant per line. Automatic payments require a matching merchant.',
      timeHint: '24-hour time, e.g. 11:00', noClaims: 'Enable automatic claims to adjust the claim limit.',
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
            toggle(draft, 'headless', 'headless', change), field(draft, 'deliveryAddress', 'deliveryAddress', 'text', change), hint('browserHint'))),
        h('div', { className: 'waimai-footer' },
          h('span', { role: message === 'saveFailed' ? 'alert' : 'status', className: message === 'saveFailed' ? 'waimai-error' : 'waimai-hint' },
            t(busy ? 'saving' : message || (dirty ? 'pending' : 'unchanged'))),
          h('div', { className: 'waimai-actions' },
            dirty ? h(Button, { disabled: locked, onClick: () => { setDraft(structuredClone(snapshot.value)); setMessage('') } }, t('reset')) : null,
            h(Button, { type: 'submit', variant: 'primary', disabled: locked || !dirty }, t(busy ? 'saving' : 'save')))))
    }

    /** Render the editable card only after the Host provides its configuration. */
    function WaimaiSettingsCard(props) {
      const snapshot = React.useSyncExternalStore(props.subscribe, props.getSnapshot, props.getSnapshot)
      if (snapshot?.status !== 'ready') return h('p', { className: 'waimai-hint' }, props.t('unavailable'))
      return h('div', { className: 'waimai-settings' }, h('p', { className: 'waimai-intro' }, props.t('intro')),
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
      @media(max-width:600px) { .waimai-grid { grid-template-columns:minmax(0,1fr); } .waimai-task-header { flex-wrap:wrap; } .waimai-task-heading { flex-basis:calc(100% - 54px); } }
    `


    return {
      inject: ['slots', 'locale', 'configForms'],
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
              t,
            }),
          }, WaimaiSettingsCard),
        )), 'dsh-waimai: settings card')
      },
    }
  },
})
