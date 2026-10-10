/**
 * Browser half of the dsh-waimai plugin: the settings card on the Plugins page.
 *
 * The card is read-mostly on purpose. The plugin's editable configuration is the
 * plugin `Config`, which the settings shell already renders as a generated form
 * for this namespace; duplicating every field here would give the same value two
 * write paths. What the generated form cannot show is the *effective* safety
 * posture — the mode actually in force, the cap, and whether a whitelist is
 * limiting automatic payment — so that is what this card prints.
 *
 * Loaded through the client module loader rather than imported: the browser half
 * receives React and the shared services from the module table.
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
      intro: '通过浏览器自动化在饿了么 H5 上点外卖。配置项由下方的「插件配置」表单编辑。',
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
    }
    const en = {
      title: 'Takeaway assistant',
      intro: 'Orders takeaway on the Ele.me H5 site through browser automation. Edit the fields with the generated configuration form below.',
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
          'plugins.item',
          () => ctx.slots.register({
            name: 'plugins.item',
            id: 'waimai',
            order: 30,
            label: () => t('title'),
            locale: LOCALE_NS,
            inject: () => ({
              // Bind once here so the render layer never loses the controller's `this`.
              subscribe: form.subscribe.bind(form),
              getSnapshot: form.getSnapshot.bind(form),
              t,
            }),
          }, WaimaiSettingsCard),
        )), 'dsh-waimai: settings card')
      },
    }
  },
})
