/**
 * dsh-persona-modes —— 客户端半（浏览器 bundle 的 factory 体）。
 *
 * 本文件只做一件事：在「设置」里注册一个「人格模式」分区。页面列出所有内置
 * 模式，点卡片即切换；切换请求经同源路由发给宿主半，宿主半改写状态并让下一次
 * 运行时上下文使用新的语气段。
 *
 * 设计约束：
 * - 不 import 任何 Harness 客户端包，只依赖 `react` 与 `--dsw-alias-*` 主题令牌，
 *   降低上游 API 变动导致的整页崩溃风险；
 * - 所有注册都包在 try/catch 里：页面是装饰性设置页，注册失败应该只记日志，
 *   不能让整个设置面板起不来；
 * - 文案全部走 locale 字典，中英文键集保持一致；
 * - 模式列表、字数、实际提示词都由宿主返回，客户端不复制一份人格定义，避免两半漂移。
 *
 * @module dsh-persona-modes/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-persona-modes',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const h = react.createElement

    /** 包名：日志、样式标签、路由前缀共用。 */
    const PKG = 'dsh-persona-modes'

    /** 文案命名空间；同时作为插槽注册的 locale 名。 */
    const NS = 'persona-modes'

    /** 客户端请求的相对路径前缀（不带前导斜杠，桌面端与 Web 端都能正确解析）。 */
    const ROUTE = 'dsh-persona-modes'

    /** 客户端请求必须携带的签名头；与宿主半 `src/routes.js` 保持一致。 */
    const HEADER = 'x-dsh-persona-modes'

    /** 签名头的唯一合法值。 */
    const HEADER_VALUE = '1'

    /** 设置分区在导航里的排序：排在「通用」「账号」等功能页之后。 */
    const SECTION_ORDER = 30

    /** 单个人格在卡片上的展示上限；与服务端 `USAGE_MAX_COUNT` 一致。 */
    const USAGE_MAX_COUNT = 99_999

    /** 简体中文字典（键集基准）。 */
    const zh = {
      nav: '人格模式',
      title: '人格模式',
      subtitle: '给回复换一种语气。只改风格，不改事实与代码。',
      current: '当前人格',
      active: '当前',
      nextTurn: '下一轮生效',
      off: '已关闭',
      chars: '约 {count} 字',
      charsZero: '0 字（不注入）',
      note: '同一时刻只注入当前这一条，关闭时为 0 字；切换后从下一轮对话开始生效。',
      warningNotPersisted: '已在本次运行内生效，但状态文件写入失败；重启后会恢复原模式。',
      retrySave: '重试保存',
      preview: '查看当前提示词',
      previewPolicy: '系统提示段',
      previewRuntime: '运行时上下文',
      previewTotal: '合计 {count} 字',
      previewEmpty: '（不注入）',
      intensity: '语气强度',
      intensityLow: '低',
      intensityMedium: '中',
      intensityHigh: '高',
      intensityHint: '统一控制所有角色；默认低。',
      usageTitle: '匿名统计',
      usageReport: '参与统计',
      usageFetch: '显示统计',
      usageColon: '：',
      usageRefresh: '刷新',
      usageNote: '关闭「参与统计」后不再上报；关闭「显示统计」后不再获取或显示角标；已上报的聚合计数无法撤回。数字每日走缓存，点「刷新」立即更新。',
      usageBadge: '热度 {count}',
      usageBadgeTitle: '匿名统计：热度 {count}，仅供参考',
      usageCountMax: '99,999+',
      usageLoading: '正在读取统计…',
      usageUnavailable: '统计暂时不可用。',
      usageSaveFailed: '统计设置保存失败。',
      logsTitle: '运行错误',
      logsCount: '{count} 条',
      logsEmpty: '暂无错误记录。',
      logsHint: '只保留在内存里最近 {limit} 条，不写磁盘、不缓存；重启即清空。',
      logsDropped: '更早的 {count} 条已丢弃',
      logsRefresh: '刷新',
      logsClear: '清空',
      logsLoading: '正在读取…',
      logsFailed: '读取失败。',
      logsDebugOn: '调试记录中',
      logsDebugOff: '调试记录未开（插件详情页可打开）',
      debugTitle: '调试',
      debugHint: '打开后，设置页底部的「运行错误」会额外记录流程细节与错误堆栈，便于排查；默认关闭。',
      debugFailed: '调试开关保存失败。',
      edit: '编辑',
      createCustom: '新建自定义人格',
      editorEditTitle: '编辑人格',
      editorCreateTitle: '新建自定义人格',
      name: '名称',
      emoji: '图标',
      address: '称呼',
      selfName: '自称',
      promptBody: '提示词',
      save: '保存',
      saving: '保存中…',
      reset: '恢复默认',
      cancel: '取消',
      deleteAria: '删除「{name}」',
      customBadge: '自定义',
      builtinBadge: '内置',
      editorHint: '称呼和自称会写进标签块；提示词可用中文标签，也可以写自然语言。',
      editorDefault: '默认：称呼 {address} / 自称 {selfName}',
      deleteConfirm: '确定删除「{name}」吗？',
      saveFailed: '保存失败，请重试。',
      deleteFailed: '删除失败，请重试。',
      loading: '正在读取模式…',
      switching: '切换中…',
      retry: '重试',
      errorTitle: '读取失败',
      errorGeneric: '读取失败，请稍后重试。',
      errorHostMissing: '宿主半未响应。请确认插件已正确加载，然后刷新页面。',
      errorUnknownMode: '这个模式不存在，请刷新后重试。',
      errorForbidden: '请求被拒绝，请刷新页面后重试。',
      ariaModeList: '可用人格模式',
    }

    /** 英文字典，键集必须与 {@link zh} 完全一致。 */
    const en = {
      nav: 'Persona modes',
      title: 'Persona modes',
      subtitle: 'Change the tone of replies without changing facts or code.',
      current: 'Current persona',
      active: 'Active',
      nextTurn: 'Takes effect next turn',
      off: 'Off',
      chars: '~{count} chars',
      charsZero: '0 chars (nothing injected)',
      note: 'Only the active persona is injected; off costs 0 chars. Switching takes effect from the next turn.',
      warningNotPersisted: 'Applied for this run, but the state file could not be written; the previous mode will return after a restart.',
      retrySave: 'Retry save',
      preview: 'Show the active prompt',
      previewPolicy: 'System prompt section',
      previewRuntime: 'Runtime context',
      previewTotal: '{count} chars total',
      previewEmpty: '(nothing injected)',
      intensity: 'Persona intensity',
      intensityLow: 'Low',
      intensityMedium: 'Medium',
      intensityHigh: 'High',
      intensityHint: 'Applies to all personas; defaults to low.',
      usageTitle: 'Anonymous stats',
      usageReport: 'Contribute counts',
      usageFetch: 'Show counts',
      usageColon: ': ',
      usageRefresh: 'Refresh',
      usageNote: 'Turning off “Contribute counts” stops reporting; turning off “Show counts” stops fetching and hides badges; counts already sent cannot be withdrawn. Numbers come from a daily cache; press “Refresh” to update immediately.',
      usageBadge: 'Heat {count}',
      usageBadgeTitle: 'Anonymous stats: heat {count}, indicative only',
      usageCountMax: '99,999+',
      usageLoading: 'Loading stats…',
      usageUnavailable: 'Stats are temporarily unavailable.',
      usageSaveFailed: 'Could not save stats settings.',
      logsTitle: 'Runtime errors',
      logsCount: '{count}',
      logsEmpty: 'No errors recorded.',
      logsHint: 'Keeps the latest {limit} entries in memory only — nothing is written to disk or cached; cleared on restart.',
      logsDropped: '{count} earlier entries dropped',
      logsRefresh: 'Refresh',
      logsClear: 'Clear',
      logsLoading: 'Loading…',
      logsFailed: 'Could not load.',
      logsDebugOn: 'Debug logging on',
      logsDebugOff: 'Debug logging off (enable it on the plugin page)',
      debugTitle: 'Debug',
      debugHint: 'When on, the runtime error log at the bottom of the settings page also records flow details and error stacks. Off by default.',
      debugFailed: 'Could not save the debug switch.',
      edit: 'Edit',
      createCustom: 'New custom persona',
      editorEditTitle: 'Edit persona',
      editorCreateTitle: 'New custom persona',
      name: 'Name',
      emoji: 'Icon',
      address: 'Calls you',
      selfName: 'Calls itself',
      promptBody: 'Prompt',
      save: 'Save',
      saving: 'Saving…',
      reset: 'Reset to default',
      cancel: 'Cancel',
      deleteAria: 'Delete “{name}”',
      customBadge: 'Custom',
      builtinBadge: 'Built-in',
      editorHint: 'Address and self-name are written into the tag block; the prompt can be tags or plain language.',
      editorDefault: 'Default: address {address} / self-name {selfName}',
      deleteConfirm: 'Delete “{name}”?',
      saveFailed: 'Could not save. Please try again.',
      deleteFailed: 'Could not delete. Please try again.',
      loading: 'Loading modes…',
      switching: 'Switching…',
      retry: 'Retry',
      errorTitle: 'Could not load',
      errorGeneric: 'Could not load. Please try again.',
      errorHostMissing: 'The host half did not respond. Check that the plugin is loaded, then refresh the page.',
      errorUnknownMode: 'That mode does not exist. Refresh and try again.',
      errorForbidden: 'The request was rejected. Refresh the page and try again.',
      ariaModeList: 'Available persona modes',
    }

    /**
     * 读取当前界面语言。
     *
     * `ctx.locale.getSnapshot()` 的形状是 `{ active, locales, revision }`；拿不到时
     * 回落到中文。这里不直接依赖 locale 内部实现，只读稳定字段。
     *
     * @param {object | undefined} locale locale 服务。
     * @returns {'zh' | 'en'} 语言标识。
     */
    function readLocaleId(locale) {
      try {
        const active = locale?.getSnapshot?.().active
        return typeof active === 'string' && active.toLowerCase().startsWith('en') ? 'en' : 'zh'
      } catch {
        return 'zh'
      }
    }

    /**
     * 订阅界面语言变化。
     *
     * 插槽框架通常会因 locale revision 变化而重渲染，但组件内部的模式名称是自己
     * 从宿主数据里取的，不经过 `t()`，所以这里显式订阅一次，保证中英文切换后
     * 模式名与说明立即跟着变。
     *
     * @param {object | undefined} locale locale 服务。
     * @returns {'zh' | 'en'} 当前语言。
     */
    function useLocaleId(locale) {
      const [id, setId] = react.useState(() => readLocaleId(locale))
      react.useEffect(() => {
        if (locale === null || locale === undefined || typeof locale.subscribe !== 'function') return undefined
        const update = () => setId(readLocaleId(locale))
        update()
        return locale.subscribe(update)
      }, [locale])
      return id
    }

    /**
     * 取模式名的展示文案。
     *
     * @param {object} mode 宿主返回的模式。
     * @param {'zh' | 'en'} localeId 语言。
     * @returns {string} 展示名。
     */
    function modeName(mode, localeId) {
      return localeId === 'en' ? mode.nameEn : mode.nameZh
    }

    /**
     * 取模式说明的展示文案。
     *
     * @param {object} mode 宿主返回的模式。
     * @param {'zh' | 'en'} localeId 语言。
     * @returns {string} 一句话说明。
     */
    function modeSummary(mode, localeId) {
      return localeId === 'en' ? mode.summaryEn : mode.summaryZh
    }

    /**
     * 把计数格式化成卡片上的短文本。
     *
     * 只接受正整数；超过上限统一显示「99,999+」，避免第三方返回离谱数字撑破布局。
     *
     * @param {unknown} value 原始计数。
     * @param {(key: string, params?: object) => string} t 翻译函数。
     * @returns {string} 展示文本；非法值返回空串。
     */
    function formatCount(value, t) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
      const count = Math.floor(value)
      if (count > USAGE_MAX_COUNT) return t('usageCountMax')
      return String(count).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
    }

    /**
     * 从 `/usage` 响应里筛出可展示的计数。
     *
     * 只认内置人格 id，且值必须是正整数；第三方响应里的未知键一律丢弃，避免把
     * 远端数据直接塞进渲染树。
     *
     * @param {unknown} payload 宿主响应。
     * @param {Array<{ id: string }>} modes 已知模式。
     * @returns {Record<string, number>} 可展示的计数。
     */
    function normalizeCounts(payload, modes) {
      const source = payload?.counts
      if (source === null || typeof source !== 'object' || Array.isArray(source)) return {}
      const known = new Set(
        (Array.isArray(modes) ? modes : [])
          .map((mode) => (mode !== null && typeof mode === 'object' ? mode.id : null))
          .filter((id) => typeof id === 'string' && id !== 'off' && !id.startsWith('custom-')),
      )
      const counts = {}
      for (const [id, value] of Object.entries(source)) {
        if (!known.has(id)) continue
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) continue
        counts[id] = value
      }
      return counts
    }

    /**
     * 把宿主返回的运行错误日志筛成可渲染的形状。
     *
     * 只认字符串字段，且条数不超过宿主声明的上限：日志面板不信任远端数据，
     * 免得一条畸形记录把页面撑破。
     *
     * @param {unknown} payload 宿主响应。
     * @returns {{ entries: Array<object>, dropped: number, limit: number }} 可渲染的日志。
     */
    function normalizeLogs(payload) {
      const source = payload !== null && typeof payload === 'object' ? payload : {}
      const limit = Number.isSafeInteger(source.limit) && source.limit > 0 ? source.limit : 50
      const rawEntries = Array.isArray(source.entries) ? source.entries : []
      const entries = []
      for (const entry of rawEntries.slice(-limit)) {
        if (entry === null || typeof entry !== 'object') continue
        const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : null
        if (at === null) continue
        entries.push({
          at,
          level: entry.level === 'info' ? 'info' : 'error',
          scope: typeof entry.scope === 'string' ? entry.scope.slice(0, 40) : 'unknown',
          message: typeof entry.message === 'string' ? entry.message.slice(0, 240) : '',
          detail: typeof entry.detail === 'string' ? entry.detail.slice(0, 300) : '',
        })
      }
      const dropped = Number.isSafeInteger(source.dropped) && source.dropped > 0 ? source.dropped : 0
      return { entries, dropped, limit }
    }

    /**
     * 把时间戳压成 HH:MM:SS，日志里只看时刻就够了。
     *
     * @param {number} at 毫秒时间戳。
     * @returns {string} 时刻文本。
     */
    function formatTime(at) {
      try {
        const date = new Date(at)
        const pad = (value) => String(value).padStart(2, '0')
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
      } catch {
        return '--:--:--'
      }
    }

    /**
     * 把宿主错误码映射成用户能读懂的文案。
     *
     * @param {unknown} error 错误对象或字符串。
     * @param {(key: string) => string} t 翻译函数。
     * @returns {string} 展示文案。
     */
    function errorText(error, t) {
      const code = error instanceof Error ? error.message : String(error ?? '')
      if (code === 'forbidden') return t('errorForbidden')
      if (code === 'unknown-mode') return t('errorUnknownMode')
      if (code === 'host-missing' || code === 'HTTP 404') return t('errorHostMissing')
      return t('errorGeneric')
    }

    /** 单次宿主请求超时；超时后走统一错误态，页面仍可重试。 */
    const REQUEST_TIMEOUT_MS = 15_000

    /** 统计刷新的超时：人格多时宿主会分批限速读取，预留更长等待。 */
    const USAGE_REFRESH_TIMEOUT_MS = 45_000

    /** 读取失败后的自动重试间隔：第三方抖动通常在一两分钟内恢复。 */
    const USAGE_RETRY_DELAY_MS = 15_000

    /** 宿主熔断给出的退避上限：超过这个等待就没有自动重试的意义。 */
    const USAGE_RETRY_MAX_DELAY_MS = 90_000

    /** 连续失败后最多自动重试的次数；之后只响应手动「刷新」。 */
    const USAGE_RETRY_MAX = 5

    /**
     * 发一条宿主路由请求。
     *
     * `state` / `select` 都走 POST：POST + 自定义头会触发跨站预检，而宿主不返回
     * CORS 头，因此其他网页无法调用。这里只处理 JSON，响应非 2xx 或 `ok !== true`
     * 都抛出带错误码的 Error。请求带超时，避免宿主卡死时设置页永远停在 loading。
     *
     * @param {string} action 动作名（`state` / `select` / `usage` / `usage/prefs` 等）。
     * @param {object} [body] 请求体。
     * @param {{ timeoutMs?: number }} [settings] 可选的每次请求设置。
     * @returns {Promise<object>} 宿主返回的状态视图。
     */
    async function postRoute(action, body, settings = {}) {
      if (typeof fetch !== 'function') throw new Error('host-missing')
      const timeoutMs = typeof settings.timeoutMs === 'number' && settings.timeoutMs > 0
        ? settings.timeoutMs
        : REQUEST_TIMEOUT_MS
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs)
      let response
      try {
        response = await fetch(`${ROUTE}/${action}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [HEADER]: HEADER_VALUE,
          },
          body: JSON.stringify(body ?? {}),
          ...(controller === null ? {} : { signal: controller.signal }),
        })
      } finally {
        if (timer !== null) clearTimeout(timer)
      }
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (data === null || typeof data !== 'object') {
        throw new Error(response.status === 404 ? 'host-missing' : `HTTP ${response.status}`)
      }
      if (response.status === 404) throw new Error('host-missing')
      if (!response.ok || data.ok !== true) {
        throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`)
      }
      return data
    }

    /**
     * 校验宿主返回的状态视图。
     *
     * 只做最低限度检查：模式数组必须存在且元素形状正确，避免契约漂移时页面
     * 在渲染阶段抛错。失败会走统一错误态。
     *
     * @param {object} data 宿主响应。
     * @returns {object} 原样返回。
     */
    function normalizePayload(data) {
      if (data === null || typeof data !== 'object') throw new Error('bad-payload')
      if (typeof data.active !== 'string') throw new Error('bad-payload')
      if (!Array.isArray(data.modes) || data.modes.length === 0) throw new Error('bad-payload')
      for (const mode of data.modes) {
        if (mode === null || typeof mode !== 'object') throw new Error('bad-payload')
        if (typeof mode.id !== 'string' || typeof mode.nameZh !== 'string') throw new Error('bad-payload')
      }
      if (data.intensity !== 'low' && data.intensity !== 'medium' && data.intensity !== 'high') {
        data.intensity = 'low'
      }
      if (data.policy === null || typeof data.policy !== 'object') {
        data.policy = { name: 'persona-modes:policy', text: '', chars: 0 }
      }
      if (typeof data.policy.text !== 'string') data.policy.text = ''
      if (typeof data.policy.chars !== 'number') data.policy.chars = data.policy.text.length
      if (data.runtime === null || typeof data.runtime !== 'object') {
        data.runtime = { name: 'persona-modes:active' }
      }
      const usage = data.usage !== null && typeof data.usage === 'object' && !Array.isArray(data.usage)
        ? data.usage
        : {}
      data.usage = {
        report: usage.report !== false,
        fetch: usage.fetch !== false,
      }
      // debug 默认关：只有宿主明确给 true 才算打开（旧宿主没有这个字段）。
      data.debug = data.debug === true
      return data
    }

    /**
     * 页面标题区。
     *
     * @param {{ t: (key: string) => string }} props 翻译函数。
     * @returns {object} React 元素。
     */
    function Hero({ t }) {
      return h(
        'div',
        { className: 'pm-hero' },
        h('span', { className: 'pm-hero-icon', 'aria-hidden': 'true' }, '🎭'),
        h(
          'div',
          { className: 'pm-hero-copy' },
          h('h2', { className: 'pm-title' }, t('title')),
          h('p', { className: 'pm-subtitle' }, t('subtitle')),
        ),
      )
    }

    /**
     * 当前模式条。
     *
     * @param {object} props 组件属性。
     * @returns {object} React 元素。
     */
    function CurrentBar({ t, localeId, mode, policy, pending, onEdit, onCreate }) {
      const isOff = mode.id === 'off'
      const prompt = typeof mode.prompt === 'string' ? mode.prompt : ''
      const chars = typeof mode.chars === 'number' ? mode.chars : 0
      const policyText = typeof policy?.text === 'string' ? policy.text : ''
      const policyChars = typeof policy?.chars === 'number' ? policy.chars : policyText.length
      const total = chars + policyChars
      const label = (title, count) => `${title} · ${t('chars', { count })}`
      return h(
        'div',
        { className: 'pm-current' },
        h(
          'div',
          { className: 'pm-current-main', role: 'status', 'aria-live': 'polite' },
          h('span', { className: 'pm-current-emoji', 'aria-hidden': 'true' }, mode.emoji),
          h(
            'div',
            { className: 'pm-current-copy' },
            h('span', { className: 'pm-current-label' }, t('current')),
            h('strong', { className: 'pm-current-name' }, modeName(mode, localeId)),
          ),
          h(
            'div',
            { className: 'pm-current-side' },
            h(
              'span',
              { className: 'pm-current-hint' },
              pending ? t('switching') : isOff ? t('off') : t('nextTurn'),
            ),
            typeof onCreate === 'function'
              ? h(
                  'button',
                  { type: 'button', className: 'pm-create', onClick: () => onCreate() },
                  t('createCustom'),
                )
              : null,
            !isOff && typeof onEdit === 'function'
              ? h(
                  'button',
                  { type: 'button', className: 'pm-edit', onClick: () => onEdit(mode) },
                  t('edit'),
                )
              : null,
          ),
        ),
        !isOff && (prompt !== '' || policyText !== '')
          ? h(
              'details',
              { className: 'pm-current-details' },
              h('summary', { className: 'pm-current-summary' }, t('preview')),
              h(
                'div',
                { className: 'pm-preview' },
                h(
                  'div',
                  { className: 'pm-preview-layer' },
                  h(
                    'div',
                    { className: 'pm-preview-label' },
                    label(t('previewPolicy'), policyChars),
                  ),
                  h('pre', { className: 'pm-prompt' }, policyText === '' ? t('previewEmpty') : policyText),
                ),
                h(
                  'div',
                  { className: 'pm-preview-layer' },
                  h(
                    'div',
                    { className: 'pm-preview-label' },
                    label(t('previewRuntime'), chars),
                  ),
                  h('pre', { className: 'pm-prompt' }, prompt === '' ? t('previewEmpty') : prompt),
                ),
                h('div', { className: 'pm-preview-total' }, t('previewTotal', { count: total })),
              ),
            )
          : null,
      )
    }

    /**
     * 全局语气强度控制。
     *
     * @param {object} props 组件属性。
     * @returns {object} React 元素。
     */
    function IntensityBar({ t, value, pending, onChange }) {
      const current = value === 'medium' || value === 'high' ? value : 'low'
      const options = [
        { id: 'low', label: t('intensityLow') },
        { id: 'medium', label: t('intensityMedium') },
        { id: 'high', label: t('intensityHigh') },
      ]
      return h(
        'div',
        { className: 'pm-intensity' },
        h('span', { className: 'pm-intensity-label' }, t('intensity')),
        h(
          'div',
          { className: 'pm-segmented', role: 'group', 'aria-label': t('intensity') },
          options.map((option) =>
            h(
              'button',
              {
                key: option.id,
                type: 'button',
                className: `pm-segment${current === option.id ? ' pm-segment-active' : ''}`,
                'aria-pressed': current === option.id ? 'true' : 'false',
                disabled: pending === true,
                onClick: () => {
                  if (typeof onChange === 'function') onChange(option.id)
                },
              },
              option.label,
            ),
          ),
        ),
        h('span', { className: 'pm-intensity-hint' }, t('intensityHint')),
      )
    }

    /**
     * 一个裸滑轨开关：只有轨道与滑块，没有外框容器，也不在内部重复渲染文字。
     *
     * 行内已经有「label：」文字，开关本体只剩图形；文字交给 `aria-label`，
     * 键盘与读屏仍能识别（`role="switch"` + `aria-checked`）。
     *
     * @param {object} props 组件属性。
     * @returns {object} React 元素。
     */
    function Toggle({ label, checked, disabled, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          className: `pm-switch${checked ? ' pm-toggle-on' : ''}`,
          disabled: disabled === true,
          onClick: () => {
            if (typeof onChange === 'function') onChange()
          },
        },
        h(
          'span',
          { className: 'pm-toggle-track', 'aria-hidden': 'true' },
          h('span', { className: 'pm-toggle-thumb' }),
        ),
      )
    }

    /**
     * 匿名统计设置条：位于设置页最底部。
     *
     * 布局：标题行（标题 + 手动「刷新」按钮 + 状态），下面两行
     * 「label：开关」逐行排列。两个开关互相独立：关掉「参与统计」只停止
     * 上报；关掉「显示统计」只停止读取与展示。页内不写「数字可被伪造」
     * 之类的提示（README 与角标悬停仍保留"仅供参考"），只留一句说明开关
     * 后果与"无法撤回"的注记。打开设置页默认只读宿主缓存，点「刷新」才
     * 真正向第三方发请求；熔断退避期间自动重试接管，「刷新」按钮置灰，
     * 免得点了也只是空手而回。
     *
     * @param {object} props 组件属性。
     * @returns {object} React 元素。
     */
    function UsageBar({ t, usage, pending, error, countsState, onChange, onRefresh, cooldown }) {
      const report = usage?.report !== false
      const show = usage?.fetch !== false
      const loading = countsState === 'loading'
      return h(
        'div',
        { className: 'pm-usage' },
        h(
          'div',
          { className: 'pm-usage-head' },
          h('span', { className: 'pm-usage-title' }, t('usageTitle')),
          h(
            'span',
            { className: 'pm-usage-side' },
            show && typeof onRefresh === 'function'
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'pm-usage-refresh',
                    disabled: loading || pending === true || cooldown === true,
                    onClick: () => onRefresh(),
                  },
                  t('usageRefresh'),
                )
              : null,
            loading ? h('span', { className: 'pm-usage-status' }, t('usageLoading')) : null,
            countsState === 'error' ? h('span', { className: 'pm-usage-status pm-usage-status-error' }, t('usageUnavailable')) : null,
          ),
        ),
        h(
          'div',
          { className: 'pm-usage-rows' },
          h(
            'div',
            { className: 'pm-usage-row' },
            h('span', { className: 'pm-usage-label' }, t('usageReport'), t('usageColon')),
            h(Toggle, {
              label: t('usageReport'),
              checked: report,
              disabled: pending === true,
              onChange: () => {
                if (typeof onChange === 'function') onChange({ report: !report })
              },
            }),
          ),
          h(
            'div',
            { className: 'pm-usage-row' },
            h('span', { className: 'pm-usage-label' }, t('usageFetch'), t('usageColon')),
            h(Toggle, {
              label: t('usageFetch'),
              checked: show,
              disabled: pending === true,
              onChange: () => {
                if (typeof onChange === 'function') onChange({ fetch: !show })
              },
            }),
          ),
        ),
        error === null || error === undefined
          ? null
          : h('p', { className: 'pm-inline-error', role: 'alert' }, error),
        h('p', { className: 'pm-usage-note' }, t('usageNote')),
      )
    }

    /**
     * 运行错误面板：默认折叠，位于设置页最底部。
     *
     * 折叠时不渲染列表，只在标题上显示条数；展开时才向宿主读日志（日志本身在
     * 宿主内存里，不落盘、不缓存）。这里不吞错：读失败会把状态写在标题右侧。
     *
     * @param {object} props 组件属性；`defaultOpen` 只为测试与后续复用准备。
     * @returns {object} React 元素。
     */
    function RunErrors({ t, debug, logs, state, error, onRefresh, onClear, defaultOpen }) {
      const [open, setOpen] = react.useState(defaultOpen === true)
      const entries = logs?.entries ?? []
      const count = entries.length
      const toggle = () => {
        const next = !open
        setOpen(next)
        // 展开时读一次：折叠期间日志可能又攒了新错误。
        if (next && typeof onRefresh === 'function') onRefresh()
      }
      return h(
        'div',
        { className: 'pm-logs' },
        h(
          'button',
          {
            type: 'button',
            className: 'pm-logs-head',
            'aria-expanded': open ? 'true' : 'false',
            onClick: toggle,
          },
          h('span', { className: 'pm-logs-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
          h('span', { className: 'pm-logs-title' }, t('logsTitle')),
          count > 0 ? h('span', { className: 'pm-logs-count' }, t('logsCount', { count })) : null,
          state === 'loading' ? h('span', { className: 'pm-logs-status' }, t('logsLoading')) : null,
          state === 'error' ? h('span', { className: 'pm-logs-status pm-logs-status-error' }, t('logsFailed')) : null,
          debug === true ? h('span', { className: 'pm-logs-debug' }, t('logsDebugOn')) : null,
        ),
        open
          ? h(
              'div',
              { className: 'pm-logs-body' },
              h(
                'div',
                { className: 'pm-logs-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'pm-logs-button',
                    disabled: state === 'loading',
                    onClick: () => {
                      if (typeof onRefresh === 'function') onRefresh()
                    },
                  },
                  t('logsRefresh'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'pm-logs-button',
                    disabled: state === 'loading' || count === 0,
                    onClick: () => {
                      if (typeof onClear === 'function') onClear()
                    },
                  },
                  t('logsClear'),
                ),
              ),
              errorsText(error, t) === ''
                ? null
                : h('p', { className: 'pm-inline-error', role: 'alert' }, errorsText(error, t)),
              count === 0
                ? h('p', { className: 'pm-logs-empty' }, t('logsEmpty'))
                : h(
                    'ul',
                    { className: 'pm-logs-list' },
                    // 最新的在最上面：排查时先看最近发生了什么。
                    entries.slice().reverse().map((entry, index) => h(
                      'li',
                      {
                        key: `${entry.at}-${index}`,
                        className: entry.level === 'info' ? 'pm-logs-row pm-logs-row-info' : 'pm-logs-row',
                      },
                      h('span', { className: 'pm-logs-time' }, formatTime(entry.at)),
                      h('span', { className: 'pm-logs-scope' }, entry.scope),
                      h('span', { className: 'pm-logs-message' }, entry.message),
                      entry.detail === '' ? null : h('span', { className: 'pm-logs-detail' }, entry.detail),
                    )),
                  ),
              debug === true ? null : h('p', { className: 'pm-logs-note' }, t('logsDebugOff')),
              h(
                'p',
                { className: 'pm-logs-note' },
                t('logsHint', { limit: logs?.limit ?? 50 }),
                logs?.dropped > 0 ? ` · ${t('logsDropped', { count: logs.dropped })}` : '',
              ),
            )
          : null,
      )
    }

    /**
     * 插件详情页的「调试」区块：只有本站这个人格模式插件才渲染。
     *
     * 这是 `plugins.detail.section` 贡献：其他组合包、行、官方插件的页面同样会
     * 调用这个组件，因此必须按 `subject` 自行判断，非本包一律返回 null。
     *
     * @param {object} props 组件属性。
     * @returns {object | null} React 元素。
     */
    function DebugSection({ t, subject }) {
      const [debug, setDebug] = react.useState(null)
      const [pending, setPending] = react.useState(false)
      const [error, setError] = react.useState(null)
      const mine = subject?.kind === 'bundle' && subject?.pkg?.name === PKG

      react.useEffect(() => {
        if (!mine) return undefined
        let cancelled = false
        const run = async () => {
          try {
            const data = await postRoute('logs')
            if (!cancelled) setDebug(data?.debug === true)
          } catch (failure) {
            if (!cancelled) setError(failure)
          }
        }
        void run()
        return () => {
          cancelled = true
        }
      }, [mine])

      if (!mine) return null

      const change = async (next) => {
        if (pending) return
        setPending(true)
        setError(null)
        try {
          const data = await postRoute('logs/debug', { value: next })
          setDebug(data?.debug === true)
        } catch (failure) {
          setError(failure)
        } finally {
          setPending(false)
        }
      }

      return h(
        'section',
        { className: 'pm-detail' },
        h('h3', { className: 'pm-detail-title' }, t('debugTitle')),
        h(
          'div',
          { className: 'pm-usage-row' },
          h('span', { className: 'pm-usage-label' }, t('debugTitle'), t('usageColon')),
          h(Toggle, {
            label: t('debugTitle'),
            checked: debug === true,
            disabled: pending || debug === null,
            onChange: () => {
              void change(debug !== true)
            },
          }),
        ),
        h('p', { className: 'pm-usage-note' }, t('debugHint')),
        error === null || error === undefined
          ? null
          : h('p', { className: 'pm-inline-error', role: 'alert' }, t('debugFailed')),
      )
    }

    /**
     * 取错误面板要显示的错误文案。
     *
     * @param {unknown} error 错误值。
     * @param {(key: string, params?: object) => string} t 翻译函数。
     * @returns {string} 文案；无错误时为空串。
     */
    function errorsText(error, t) {
      if (error === null || error === undefined) return ''
      return errorText(error, t)
    }

    /**
     * 悬浮删除按钮的垃圾桶图标。
     * 只用内联 SVG：不引入图标库，颜色由 `currentColor` 跟随主题令牌。
     *
     * @returns {object} React 元素。
     */
    function TrashIcon() {
      return h(
        'svg',
        {
          className: 'pm-icon',
          viewBox: '0 0 16 16',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', { d: 'M2.5 4.5h11' }),
        h('path', { d: 'M6.5 4.5V3.2a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.3' }),
        h('path', { d: 'M4.1 4.5 4.8 12.6a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.7-8.1' }),
        h('path', { d: 'M6.9 7v3.4M9.1 7v3.4' }),
      )
    }

    /**
     * 单张模式卡片。
     *
     * 卡片本身是 `<button>`，所以删除入口不能嵌在里面：外面包一层
     * `.pm-card-wrap` 定位容器，删除按钮绝对定位于右上角，悬停或聚焦时才浮出。
     * 只有自定义人格可以删除。
     *
     * @param {object} props 组件属性。
     * @returns {object} React 元素。
     */
    function ModeCard({ t, localeId, mode, active, pendingId, deleting, onSelect, onDelete, count }) {
      const selected = mode.id === active
      const busy = pendingId !== null
      const chars = typeof mode.chars === 'number' ? mode.chars : 0
      const countText = formatCount(count, t)
      const deletable = mode.custom === true && typeof onDelete === 'function'
      const removing = deletable && deleting === true
      return h(
        'div',
        { className: 'pm-card-wrap', style: { '--pm-accent': mode.accent } },
        h(
          'button',
          {
            type: 'button',
            className: 'pm-card',
            'aria-pressed': selected ? 'true' : 'false',
            'data-deletable': deletable ? 'true' : 'false',
            disabled: busy || removing,
            onClick: () => onSelect(mode.id),
          },
          h('span', { className: 'pm-emoji', 'aria-hidden': 'true' }, mode.emoji),
          h(
            'span',
            { className: 'pm-body' },
            h(
              'span',
              { className: 'pm-name-row' },
              h('span', { className: 'pm-name' }, modeName(mode, localeId)),
              mode.custom === true
                ? h('span', { className: 'pm-badge pm-badge-custom' }, t('customBadge'))
                : null,
              selected ? h('span', { className: 'pm-badge' }, t('active')) : null,
            ),
            h('span', { className: 'pm-desc' }, modeSummary(mode, localeId)),
            h(
              'span',
              { className: 'pm-meta' },
              chars === 0 ? t('charsZero') : t('chars', { count: chars }),
            ),
          ),
          h('span', { className: 'pm-check', 'aria-hidden': 'true' }, '✓'),
        ),
        deletable
          ? h(
              'button',
              {
                type: 'button',
                className: 'pm-card-delete',
                title: t('deleteAria', { name: modeName(mode, localeId) }),
                'aria-label': t('deleteAria', { name: modeName(mode, localeId) }),
                'data-busy': removing ? 'true' : 'false',
                disabled: busy || removing,
                onClick: () => onDelete(mode),
              },
              h(TrashIcon),
            )
          : null,
        countText === ''
          ? null
          : h(
              'span',
              { className: 'pm-heat', title: t('usageBadgeTitle', { count: countText }) },
              t('usageBadge', { count: countText }),
            ),
      )
    }

    /**
     * 人格编辑器：称呼、自称、提示词与默认值。
     *
     * 内置人格可以改称呼/自称/提示词，但不能改名和图标；自定义人格两者都能改。
     *
     * @param {object} props 组件属性。
     * @returns {object} React 元素。
     */
    function PersonaEditor({
      t,
      editor,
      busy,
      error,
      onChange,
      onSave,
      onReset,
      onCancel,
    }) {
      const defaults = editor.defaults ?? { address: '', selfName: '', prompt: '' }
      const isCustom = editor.custom === true
      const isNew = editor.isNew === true
      const update = (patch) => onChange({ ...editor, ...patch })
      return h(
        'div',
        { className: 'pm-editor' },
        h(
          'div',
          { className: 'pm-editor-head' },
          h('h3', { className: 'pm-editor-title' }, isNew ? t('editorCreateTitle') : t('editorEditTitle')),
          h(
            'span',
            { className: 'pm-badge pm-badge-custom' },
            isCustom ? t('customBadge') : t('builtinBadge'),
          ),
        ),
        h(
          'div',
          { className: 'pm-editor-grid' },
          h(
            'label',
            { className: 'pm-field' },
            h('span', { className: 'pm-field-label' }, t('name')),
            h('input', {
              className: 'pm-input',
              value: editor.nameZh,
              disabled: !isCustom,
              maxLength: 40,
              onChange: (event) => update({ nameZh: event.target.value }),
            }),
          ),
          h(
            'label',
            { className: 'pm-field pm-field-narrow' },
            h('span', { className: 'pm-field-label' }, t('emoji')),
            h('input', {
              className: 'pm-input',
              value: editor.emoji,
              disabled: !isCustom,
              maxLength: 8,
              onChange: (event) => update({ emoji: event.target.value }),
            }),
          ),
          h(
            'label',
            { className: 'pm-field' },
            h('span', { className: 'pm-field-label' }, t('address')),
            h('input', {
              className: 'pm-input',
              value: editor.address,
              maxLength: 40,
              onChange: (event) => update({ address: event.target.value }),
            }),
          ),
          h(
            'label',
            { className: 'pm-field' },
            h('span', { className: 'pm-field-label' }, t('selfName')),
            h('input', {
              className: 'pm-input',
              value: editor.selfName,
              maxLength: 40,
              onChange: (event) => update({ selfName: event.target.value }),
            }),
          ),
        ),
        h(
          'label',
          { className: 'pm-field' },
          h('span', { className: 'pm-field-label' }, t('promptBody')),
          h('textarea', {
            className: 'pm-textarea',
            value: editor.body,
            rows: 8,
            maxLength: 4000,
            onChange: (event) => update({ body: event.target.value }),
          }),
        ),
        h('p', { className: 'pm-editor-hint' }, t('editorHint')),
        h(
          'p',
          { className: 'pm-editor-default' },
          t('editorDefault', {
            address: defaults.address === '' ? '—' : defaults.address,
            selfName: defaults.selfName === '' ? '—' : defaults.selfName,
          }),
        ),
        error === null || error === undefined ? null : h('p', { className: 'pm-editor-error' }, error),
        h(
          'div',
          { className: 'pm-editor-actions' },
          h('button', { type: 'button', className: 'pm-primary', disabled: busy, onClick: onSave }, busy ? t('saving') : t('save')),
          h('button', { type: 'button', className: 'pm-secondary', disabled: busy, onClick: onReset }, t('reset')),
          h('button', { type: 'button', className: 'pm-secondary', disabled: busy, onClick: onCancel }, t('cancel')),
        ),
      )
    }

    /**
     * 纯展示视图：不发起请求，方便测试与后续复用。
     *
     * @param {object} props 组件属性。
     * @returns {object} React 元素。
     */
    function PersonaView(props) {
      const {
        t,
        localeId,
        data,
        pendingId,
        error,
        warning,
        intensity,
        intensityPending,
        usage,
        counts,
        countsState,
        usagePending,
        usageError,
        usageRetryPending,
        logs,
        logsState,
        logsError,
        debug,
        onRefreshLogs,
        onClearLogs,
        policy,
        editor,
        editorBusy,
        editorError,
        onSelect,
        onRetry,
        onRetrySave,
        onIntensity,
        onUsageChange,
        onRefreshCounts,
        onEdit,
        onCreate,
        onEditorChange,
        onSave,
        onReset,
        onDelete,
        onCancelEdit,
        deletingId,
        deleteError,
      } = props
      const active = data.modes.find((mode) => mode.id === data.active) ?? data.modes[0]
      const policyData = policy ?? data.policy
      return h(
        'div',
        { className: 'pm-root' },
        h(Hero, { t }),
        h(CurrentBar, {
          t,
          localeId,
          mode: active,
          policy: policyData,
          pending: pendingId !== null,
          onEdit,
          onCreate,
        }),
        h(IntensityBar, {
          t,
          value: intensity,
          pending: intensityPending === true,
          onChange: onIntensity,
        }),
        editor
          ? h(PersonaEditor, {
              t,
              editor,
              busy: editorBusy === true,
              error: editorError,
              onChange: onEditorChange,
              onSave,
              onReset,
              onCancel: onCancelEdit,
            })
          : null,
        warning === null || warning === undefined
          ? null
          : h(
              'div',
              { className: 'pm-warning', role: 'status' },
              h('span', { className: 'pm-warning-text' }, t('warningNotPersisted')),
              h('button', { type: 'button', className: 'pm-retry', onClick: onRetrySave }, t('retrySave')),
            ),
        error === null || error === undefined
          ? null
          : h(
              'div',
              { className: 'pm-error', role: 'alert' },
              h('span', { className: 'pm-error-title' }, t('errorTitle')),
              h('span', { className: 'pm-error-text' }, errorText(error, t)),
              h('button', { type: 'button', className: 'pm-retry', onClick: onRetry }, t('retry')),
            ),
        deleteError === null || deleteError === undefined
          ? null
          : h('p', { className: 'pm-inline-error', role: 'alert' }, deleteError),
        h(
          'div',
          { className: 'pm-grid', role: 'group', 'aria-label': t('ariaModeList') },
          data.modes.map((mode) =>
            h(ModeCard, {
              key: mode.id,
              t,
              localeId,
              mode,
              active: data.active,
              pendingId,
              deleting: deletingId === mode.id,
              count: counts?.[mode.id],
              onSelect,
              onDelete,
            }),
          ),
        ),
        h(
          'div',
          { className: 'pm-foot' },
          h('p', { className: 'pm-note' }, t('note')),
        ),
        // 匿名统计是低频的偏好设置，放在页面最底部，不与人格卡片抢注意力。
        h(UsageBar, {
          t,
          usage,
          pending: usagePending === true,
          error: usageError,
          countsState,
          onChange: onUsageChange,
          onRefresh: onRefreshCounts,
          cooldown: usageRetryPending === true,
        }),
        // 运行错误放在最后：默认折叠，出问题时才展开看。
        h(RunErrors, {
          t,
          debug: debug === true,
          logs,
          state: logsState ?? 'idle',
          error: logsError,
          onRefresh: onRefreshLogs,
          onClear: onClearLogs,
        }),
      )
    }

    /**
     * 设置页分区组件：负责加载状态、切换请求与错误展示。
     *
     * @param {object} props 插槽注入的属性。
     * @returns {object} React 元素。
     */
    function PersonaSection(props) {
      const t = props.t
      const locale = props.locale
      const localeId = useLocaleId(locale)
      const [view, setView] = react.useState({ phase: 'loading', data: null, error: null, warning: null })
      const [pendingId, setPendingId] = react.useState(null)
      const [editor, setEditor] = react.useState(null)
      const [editorBusy, setEditorBusy] = react.useState(false)
      const [editorError, setEditorError] = react.useState(null)
      const [intensityPending, setIntensityPending] = react.useState(false)
      const [deletingId, setDeletingId] = react.useState(null)
      const [deleteError, setDeleteError] = react.useState(null)
      const [counts, setCounts] = react.useState(null)
      const [countsState, setCountsState] = react.useState('off')
      const [usagePending, setUsagePending] = react.useState(false)
      const [usageError, setUsageError] = react.useState(null)
      const [logs, setLogs] = react.useState(null)
      const [logsState, setLogsState] = react.useState('idle')
      const [logsError, setLogsError] = react.useState(null)

      /**
       * 读一次运行错误日志。
       *
       * 日志在宿主内存里，读它只是本地往返，不会打第三方；因此挂载时读一次，
       * 让折叠状态的标题也能显示条数，展开时再读一次拿最新内容。
       *
       * @param {boolean} [silent] 是否静默（挂载时的预读不改状态文案）。
       */
      const refreshLogs = async (silent = false) => {
        if (!silent) {
          setLogsState('loading')
          setLogsError(null)
        }
        try {
          const data = await postRoute('logs')
          setLogs(normalizeLogs(data))
          setLogsState('ready')
        } catch (error) {
          setLogsState('error')
          setLogsError(error)
        }
      }

      /** 清空宿主内存里的日志。 */
      const clearLogs = async () => {
        setLogsState('loading')
        setLogsError(null)
        try {
          const data = await postRoute('logs/clear')
          setLogs(normalizeLogs(data))
          setLogsState('ready')
        } catch (error) {
          setLogsState('error')
          setLogsError(error)
        }
      }

      /** 重新读取宿主状态；错误时进入统一错误态，用户可点「重试」。 */
      const load = async () => {
        setView({ phase: 'loading', data: null, error: null, warning: null })
        setDeleteError(null)
        try {
          const data = normalizePayload(await postRoute('state'))
          setView({ phase: 'ready', data, error: null, warning: null })
        } catch (error) {
          setView({ phase: 'error', data: null, error, warning: null })
        }
      }

      react.useEffect(() => {
        let cancelled = false
        const run = async () => {
          try {
            const data = normalizePayload(await postRoute('state'))
            if (!cancelled) setView({ phase: 'ready', data, error: null, warning: null })
          } catch (error) {
            if (!cancelled) setView({ phase: 'error', data: null, error, warning: null })
          }
        }
        void run()
        return () => {
          cancelled = true
        }
      }, [])

      // 挂载时预读一次错误日志：折叠标题也能显示「有几条」。失败不改文案，
      // 展开时的刷新会把状态写出来。
      react.useEffect(() => {
        let cancelled = false
        const run = async () => {
          try {
            const data = await postRoute('logs')
            if (!cancelled) {
              setLogs(normalizeLogs(data))
              setLogsState('ready')
            }
          } catch (error) {
            if (!cancelled) {
              setLogsState('error')
              setLogsError(error)
            }
          }
        }
        void run()
        return () => {
          cancelled = true
        }
      }, [])

      // 「显示统计」打开时拉一次计数；宿主默认只读缓存，不会每次打开设置页
      // 都打第三方。切换开关会改变依赖，从而自动重拉或清空。
      react.useEffect(() => {
        if (view.phase !== 'ready') return undefined
        if (view.data?.usage?.fetch !== true) {
          setCounts(null)
          setCountsState('off')
          return undefined
        }
        let cancelled = false
        setCountsState('loading')
        const run = async () => {
          try {
            const data = await postRoute('usage')
            if (!cancelled) applyUsageResponse(data)
          } catch {
            if (!cancelled) {
              setCountsState('error')
              scheduleUsageRetry(null)
            }
          }
        }
        void run()
        return () => {
          cancelled = true
        }
      }, [view.phase, view.data?.usage?.fetch])

      /** 重试定时器与已自动重试次数；超过上限后只响应手动「刷新」。 */
      const usageRetryTimer = react.useRef(null)
      const usageRetries = react.useRef(0)
      /** 自动重试待执行期间置灰「刷新」按钮，避免点也是空手而回。 */
      const [retryPending, setRetryPending] = react.useState(false)

      /** 清掉待执行的重试；状态翻好后由成功分支调用。 */
      const clearUsageRetry = () => {
        if (usageRetryTimer.current !== null) {
          clearTimeout(usageRetryTimer.current)
          usageRetryTimer.current = null
        }
        setRetryPending(false)
      }

      react.useEffect(() => clearUsageRetry, [])

      /**
       * 安排一次自动重试：熔断开着按 `retryAfterMs`（宿主给的退避余量），
       * 否则按默认间隔；连续失败超过上限就停，交给手动「刷新」。
       *
       * @param {object} [data] 最近一次 usage 响应，可能带 `retryAfterMs`。
       */
      const scheduleUsageRetry = (data) => {
        clearUsageRetry()
        if (usageRetries.current >= USAGE_RETRY_MAX) return
        usageRetries.current += 1
        const hinted = typeof data?.retryAfterMs === 'number' && data.retryAfterMs > 0
        const delay = hinted ? Math.min(data.retryAfterMs + 1_000, USAGE_RETRY_MAX_DELAY_MS) : USAGE_RETRY_DELAY_MS
        setRetryPending(true)
        usageRetryTimer.current = setTimeout(() => {
          usageRetryTimer.current = null
          setRetryPending(false)
          void refreshCounts()
        }, delay)
      }

      /** 把一次 usage 响应落到本地状态；供自动加载与手动刷新共用。 */
      const applyUsageResponse = (data) => {
        if (data?.enabled === false) {
          // 开关在别处（比如另一个窗口）被关掉：跟随它，不再显示。
          setCounts(null)
          setCountsState('off')
          return
        }
        if (typeof data?.fetchedAt !== 'number') {
          // 第三方整体读取失败：角标隐藏，但在设置条上给出可见提示，
          // 避免「什么都没有」被误读成「没人用过」。随后自动重试自愈。
          setCounts(null)
          setCountsState('error')
          scheduleUsageRetry(data)
          return
        }
        clearUsageRetry()
        usageRetries.current = 0
        setCounts(normalizeCounts(data, view.data.modes))
        setCountsState('ready')
      }

      /** 手动刷新：跳过宿主缓存重新读取；人格多时宿主会分批限速，需要等更久。 */
      const refreshCounts = async () => {
        if (view.phase !== 'ready' || view.data?.usage?.fetch !== true) return
        if (countsState === 'loading' || usagePending) return
        setCountsState('loading')
        try {
          applyUsageResponse(await postRoute('usage', { refresh: true }, { timeoutMs: USAGE_REFRESH_TIMEOUT_MS }))
        } catch {
          setCountsState('error')
          scheduleUsageRetry(null)
        }
      }

      const select = async (id) => {
        if (pendingId !== null) return
        setPendingId(id)
        setView((current) => ({ ...current, error: null, warning: null }))
        setDeleteError(null)
        try {
          const data = normalizePayload(await postRoute('select', { id }))
          setView({
            phase: 'ready',
            data,
            error: null,
            warning: data.persisted === false ? 'not-persisted' : null,
          })
          setEditor(null)
          setEditorError(null)
        } catch (error) {
          setView((current) => ({ ...current, error, warning: null }))
        } finally {
          setPendingId(null)
        }
      }

      const changeIntensity = async (value) => {
        if (intensityPending) return
        setIntensityPending(true)
        setView((current) => ({ ...current, error: null, warning: null }))
        try {
          const data = normalizePayload(await postRoute('intensity', { value }))
          setView({
            phase: 'ready',
            data,
            error: null,
            warning: data.persisted === false ? 'not-persisted' : null,
          })
        } catch (error) {
          setView((current) => ({ ...current, error, warning: null }))
        } finally {
          setIntensityPending(false)
        }
      }

      /**
       * 更新匿名统计开关。
       *
       * 关掉「显示统计」时立刻清空角标，不等下一次渲染；打开时由上面的 effect
       * 自动拉取。失败只提示，不影响人格切换。
       *
       * @param {{ report?: boolean, fetch?: boolean }} patch 开关补丁。
       * @returns {Promise<void>} 完成后无返回值。
       */
      const changeUsage = async (patch) => {
        if (usagePending) return
        setUsagePending(true)
        setUsageError(null)
        try {
          const data = normalizePayload(await postRoute('usage/prefs', patch ?? {}))
          setView({
            phase: 'ready',
            data,
            error: null,
            warning: data.persisted === false ? 'not-persisted' : null,
          })
          if (patch?.fetch === false) {
            setCounts(null)
            setCountsState('off')
          }
        } catch {
          setUsageError(t('usageSaveFailed'))
        } finally {
          setUsagePending(false)
        }
      }

      const openEditor = (mode) => {
        setEditor({
          modeId: mode.id,
          isNew: false,
          custom: mode.custom === true,
          nameZh: mode.nameZh,
          emoji: mode.emoji,
          address: mode.address ?? '',
          selfName: mode.selfName ?? '',
          body: mode.body ?? '',
          defaults: mode.defaults ?? { address: '', selfName: '', prompt: '' },
        })
        setEditorError(null)
        setDeleteError(null)
      }

      const openCreate = () => {
        const defaults = view.data?.customDefaults ?? {
          nameZh: '自定义人格',
          emoji: '🧩',
          address: '你',
          selfName: '我',
          prompt: '【人格载入】\n自定义人格\n性格温和',
        }
        setEditor({
          modeId: null,
          isNew: true,
          custom: true,
          nameZh: defaults.nameZh,
          emoji: defaults.emoji,
          address: defaults.address,
          selfName: defaults.selfName,
          body: defaults.prompt,
          defaults: {
            address: defaults.address,
            selfName: defaults.selfName,
            prompt: defaults.prompt,
          },
        })
        setEditorError(null)
        setDeleteError(null)
      }

      const changeEditor = (next) => {
        setEditor(next)
        setEditorError(null)
      }

      const resetEditor = () => {
        setEditor((current) =>
          current === null
            ? current
            : {
                ...current,
                address: current.defaults.address,
                selfName: current.defaults.selfName,
                body: current.defaults.prompt,
              },
        )
        setEditorError(null)
      }

      const saveEditor = async () => {
        if (editor === null || editorBusy) return
        setEditorBusy(true)
        setEditorError(null)
        try {
          let data = normalizePayload(await postRoute('save', {
            ...(editor.modeId === null ? {} : { id: editor.modeId }),
            nameZh: editor.nameZh,
            emoji: editor.emoji,
            address: editor.address,
            selfName: editor.selfName,
            prompt: editor.body,
          }))
          if (editor.isNew && data.saved !== null && typeof data.saved?.id === 'string') {
            data = normalizePayload(await postRoute('select', { id: data.saved.id }))
          }
          setView({
            phase: 'ready',
            data,
            error: null,
            warning: data.persisted === false ? 'not-persisted' : null,
          })
          setEditor(null)
        } catch {
          setEditorError(t('saveFailed'))
        } finally {
          setEditorBusy(false)
        }
      }

      /**
       * 删除一个自定义人格。
       *
       * 入口是卡片右上角的悬浮 icon（不再在编辑器里），所以这里拿模式对象而不是
       * 编辑器状态；删掉的正是编辑器里打开的那个时，顺手把编辑器关掉，避免对着
       * 已经不存在的模式继续编辑。
       *
       * @param {object} mode 要删除的模式。
       * @returns {Promise<void>} 完成后无返回值。
       */
      const deleteMode = async (mode) => {
        if (mode === null || typeof mode !== 'object' || deletingId !== null || pendingId !== null) return
        const confirmed =
          typeof window === 'undefined' ||
          typeof window.confirm !== 'function' ||
          window.confirm(t('deleteConfirm', { name: modeName(mode, localeId) }))
        if (!confirmed) return
        setDeletingId(mode.id)
        setDeleteError(null)
        try {
          const data = normalizePayload(await postRoute('delete', { id: mode.id }))
          setView({
            phase: 'ready',
            data,
            error: null,
            warning: data.persisted === false ? 'not-persisted' : null,
          })
          setEditor((current) => (current !== null && current.modeId === mode.id ? null : current))
        } catch {
          setDeleteError(t('deleteFailed'))
        } finally {
          setDeletingId(null)
        }
      }

      const cancelEditor = () => {
        setEditor(null)
        setEditorError(null)
      }

      if (view.phase === 'loading') {
        return h(
          'div',
          { className: 'pm-root' },
          h(Hero, { t }),
          h('div', { className: 'pm-loading', role: 'status' }, t('loading')),
        )
      }

      if (view.phase === 'error') {
        return h(
          'div',
          { className: 'pm-root' },
          h(Hero, { t }),
          h(
            'div',
            { className: 'pm-error', role: 'alert' },
            h('span', { className: 'pm-error-title' }, t('errorTitle')),
            h('span', { className: 'pm-error-text' }, errorText(view.error, t)),
            h('button', { type: 'button', className: 'pm-retry', onClick: load }, t('retry')),
          ),
        )
      }

      return h(PersonaView, {
        t,
        localeId,
        data: view.data,
        pendingId,
        error: view.error,
        warning: view.warning,
        intensity: view.data?.intensity,
        intensityPending,
        usage: view.data?.usage,
        counts,
        countsState,
        usagePending,
        usageError,
        onUsageChange: changeUsage,
        onRefreshCounts: refreshCounts,
        usageRetryPending: retryPending,
        logs,
        logsState,
        logsError,
        debug: view.data?.debug === true,
        onRefreshLogs: () => {
          void refreshLogs()
        },
        onClearLogs: () => {
          void clearLogs()
        },
        policy: view.data?.policy,
        editor,
        editorBusy,
        editorError,
        onSelect: select,
        onIntensity: changeIntensity,
        onRetry: load,
        onRetrySave: () => {
          if (view.data !== null) void select(view.data.active)
        },
        onEdit: openEditor,
        onCreate: openCreate,
        onEditorChange: changeEditor,
        onSave: saveEditor,
        onReset: resetEditor,
        onDelete: deleteMode,
        onCancelEdit: cancelEditor,
        deletingId,
        deleteError,
      })
    }

    /** 注入到页面的样式；只使用 `--dsw-alias-*` 主题令牌，跟随深浅色。 */
    const CSS = `
      .pm-root { display:flex; flex-direction:column; gap:16px; width:100%; padding:4px 4px 24px; color:var(--dsw-alias-label-primary); font-size:14px; line-height:22px; }
      .pm-hero { display:flex; align-items:flex-start; gap:12px; }
      .pm-hero-icon { display:grid; place-items:center; flex:0 0 auto; width:44px; height:44px; border-radius:12px; background:var(--dsw-alias-bg-layer-2); font-size:24px; line-height:1; }
      .pm-hero-copy { min-width:0; }
      .pm-title { margin:0; font-size:18px; line-height:26px; font-weight:600; }
      .pm-subtitle { margin:4px 0 0; color:var(--dsw-alias-label-secondary); font-size:13px; line-height:20px; }
      .pm-current { display:flex; flex-direction:column; gap:10px; padding:12px 14px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-2); }
      .pm-current-main { display:flex; align-items:center; gap:10px; }
      .pm-current-emoji { font-size:22px; line-height:1; }
      .pm-current-copy { display:flex; flex-direction:column; min-width:0; }
      .pm-current-label { color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:16px; }
      .pm-current-name { font-size:15px; line-height:22px; font-weight:600; }
      .pm-current-side { margin-left:auto; display:flex; align-items:center; flex-wrap:wrap; justify-content:flex-end; gap:8px; }
      .pm-current-hint { color:var(--dsw-alias-label-tertiary); font-size:12px; white-space:nowrap; }
      .pm-edit { padding:3px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; cursor:pointer; }
      .pm-edit:hover { background:var(--dsw-alias-interactive-bg-hover); }
      .pm-intensity { display:flex; align-items:center; flex-wrap:wrap; gap:8px 10px; }
      .pm-intensity-label { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .pm-segmented { display:inline-flex; padding:2px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); }
      .pm-segment { padding:4px 12px; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; cursor:pointer; }
      .pm-segment:hover:not(:disabled) { color:var(--dsw-alias-label-primary); }
      .pm-segment-active { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font-weight:600; }
      .pm-segment:disabled { opacity:.6; cursor:default; }
      .pm-intensity-hint { color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:16px; }
      .pm-usage { display:flex; flex-direction:column; gap:8px; padding:10px 14px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-1); }
      .pm-usage-head { display:flex; align-items:center; gap:8px; }
      .pm-usage-title { font-size:12px; line-height:18px; font-weight:600; }
      .pm-usage-side { margin-left:auto; display:flex; align-items:center; gap:8px; }
      .pm-usage-refresh { padding:2px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); font:inherit; font-size:11px; line-height:16px; cursor:pointer; }
      .pm-usage-refresh:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
      .pm-usage-refresh:disabled { opacity:.6; cursor:default; }
      .pm-usage-rows { display:flex; flex-direction:column; align-items:flex-start; gap:6px; }
      .pm-usage-row { display:flex; align-items:center; gap:8px; }
      .pm-usage-label { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .pm-switch { display:inline-flex; align-items:center; padding:0; border:none; background:transparent; font:inherit; cursor:pointer; }
      .pm-switch:disabled { opacity:.6; cursor:default; }
      .pm-toggle-track { position:relative; flex:0 0 auto; width:32px; height:18px; border-radius:999px; background:var(--dsw-alias-border-l2); transition:background .2s ease; }
      .pm-toggle-on .pm-toggle-track { background:var(--dsw-alias-label-primary); }
      .pm-toggle-thumb { position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:999px; background:var(--dsw-alias-bg-layer-1); box-shadow:0 1px 3px rgba(0,0,0,.28); transition:transform .2s cubic-bezier(.34,1.36,.64,1); }
      .pm-toggle-on .pm-toggle-thumb { transform:translateX(14px); }
      .pm-switch:hover:not(:disabled) .pm-toggle-thumb { box-shadow:0 1px 4px rgba(0,0,0,.34); }
      .pm-switch:active:not(:disabled) .pm-toggle-track { filter:brightness(.96); }
      .pm-usage-status { color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:16px; }
      .pm-usage-status-error { color:var(--dsw-alias-state-error-primary); }
      .pm-usage-note { margin:0; color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:16px; }
      .pm-logs { display:flex; flex-direction:column; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-1); overflow:hidden; }
      .pm-logs-head { display:flex; align-items:center; gap:8px; padding:8px 14px; border:none; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; line-height:18px; text-align:left; cursor:pointer; }
      .pm-logs-head:hover { background:var(--dsw-alias-interactive-bg-hover); }
      .pm-logs-caret { flex:0 0 auto; width:10px; color:var(--dsw-alias-label-tertiary); }
      .pm-logs-title { font-weight:600; }
      .pm-logs-count { padding:0 6px; border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); font-size:11px; line-height:16px; }
      .pm-logs-status { color:var(--dsw-alias-label-tertiary); font-size:11px; }
      .pm-logs-status-error { color:var(--dsw-alias-state-error-primary); }
      .pm-logs-debug { margin-left:auto; color:var(--dsw-alias-label-tertiary); font-size:11px; }
      .pm-logs-body { display:flex; flex-direction:column; gap:8px; padding:0 14px 10px; border-top:1px solid var(--dsw-alias-border-l2); }
      .pm-logs-actions { display:flex; gap:8px; padding-top:8px; }
      .pm-logs-button { padding:2px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); font:inherit; font-size:11px; line-height:16px; cursor:pointer; }
      .pm-logs-button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
      .pm-logs-button:disabled { opacity:.6; cursor:default; }
      .pm-logs-empty { margin:0; color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:16px; }
      .pm-logs-list { display:flex; flex-direction:column; gap:4px; margin:0; padding:0; list-style:none; max-height:240px; overflow:auto; }
      .pm-logs-row { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 8px; padding:4px 8px; border-radius:8px; background:var(--dsw-alias-bg-layer-2); font-size:11px; line-height:16px; }
      .pm-logs-row-info { opacity:.75; }
      .pm-logs-time { flex:0 0 auto; color:var(--dsw-alias-label-tertiary); font-variant-numeric:tabular-nums; }
      .pm-logs-scope { flex:0 0 auto; color:var(--dsw-alias-label-secondary); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
      .pm-logs-message { flex:1 1 160px; color:var(--dsw-alias-label-primary); word-break:break-word; }
      .pm-logs-detail { flex:1 1 100%; color:var(--dsw-alias-label-tertiary); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-all; }
      .pm-logs-note { margin:0; color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:16px; }
      .pm-detail { display:flex; flex-direction:column; gap:8px; padding:10px 14px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-1); }
      .pm-detail-title { margin:0; font-size:13px; line-height:20px; font-weight:600; }
      .pm-heat { position:absolute; top:8px; right:8px; padding:1px 7px; border-radius:999px; background:#dc2626; color:#fff; font-size:10px; line-height:16px; font-weight:600; pointer-events:none; }
      .pm-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .pm-card-wrap { position:relative; display:flex; min-width:0; }
      .pm-card { display:flex; align-items:flex-start; gap:10px; width:100%; padding:12px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-1); color:inherit; font:inherit; text-align:left; cursor:pointer; transition:background .15s ease,border-color .15s ease,box-shadow .15s ease; }
      .pm-card:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
      .pm-card:disabled { cursor:default; opacity:.7; }
      .pm-card[aria-pressed="true"] { border-color:var(--pm-accent,#d97706); box-shadow:inset 0 0 0 1px var(--pm-accent,#d97706); }
      .pm-emoji { display:grid; place-items:center; flex:0 0 auto; width:34px; height:34px; border-radius:10px; background:color-mix(in srgb,var(--pm-accent,#d97706) 14%,transparent); font-size:19px; line-height:1; }
      .pm-body { display:flex; flex-direction:column; min-width:0; gap:2px; }
      .pm-name-row { display:flex; align-items:center; gap:6px; }
      .pm-name { font-weight:600; font-size:14px; line-height:20px; }
      .pm-badge { padding:0 6px; border-radius:999px; background:color-mix(in srgb,var(--pm-accent,#d97706) 16%,transparent); color:var(--pm-accent,#d97706); font-size:10px; line-height:16px; font-weight:500; }
      .pm-badge-custom { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); }
      .pm-desc { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .pm-meta { color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:16px; }
      .pm-check { margin-left:auto; color:var(--pm-accent,#d97706); font-size:14px; line-height:20px; opacity:0; }
      .pm-card[aria-pressed="true"] .pm-check { opacity:1; }
      .pm-card[data-deletable="true"] { padding-right:40px; }
      .pm-card-delete { position:absolute; top:8px; right:8px; display:grid; place-items:center; width:22px; height:22px; padding:0; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-tertiary); cursor:pointer; opacity:0; transition:opacity .15s ease,color .15s ease,border-color .15s ease,background .15s ease; }
      .pm-card-wrap:hover .pm-card-delete, .pm-card-delete:focus-visible, .pm-card-delete[data-busy="true"] { opacity:1; }
      .pm-card-delete:hover:not(:disabled) { border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent); background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent); color:var(--dsw-alias-state-error-primary); }
      .pm-card-delete:disabled { cursor:default; }
      .pm-icon { display:block; width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:1.3; stroke-linecap:round; stroke-linejoin:round; }
      .pm-foot { display:flex; flex-direction:column; gap:8px; }
      .pm-note { margin:0; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
      .pm-create { padding:3px 10px; border:1px dashed var(--dsw-alias-border-l2); border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; white-space:nowrap; cursor:pointer; }
      .pm-create:hover { border-color:var(--dsw-alias-label-tertiary); background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
      .pm-editor { display:flex; flex-direction:column; gap:10px; padding:14px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-1); }
      .pm-editor-head { display:flex; align-items:center; gap:8px; }
      .pm-editor-title { margin:0; font-size:14px; line-height:20px; font-weight:600; }
      .pm-editor-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .pm-field { display:flex; flex-direction:column; gap:4px; }
      .pm-field-narrow { max-width:140px; }
      .pm-field-label { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .pm-input, .pm-textarea { width:100%; box-sizing:border-box; padding:7px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; line-height:20px; }
      .pm-input:disabled { opacity:.6; cursor:default; }
      .pm-textarea { resize:vertical; min-height:120px; font-family:var(--ds-font-family-code); font-size:12px; line-height:18px; white-space:pre-wrap; }
      .pm-editor-hint, .pm-editor-default { margin:0; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
      .pm-editor-error { margin:0; color:var(--dsw-alias-state-error-primary); font-size:12px; line-height:18px; }
      .pm-inline-error { margin:0; color:var(--dsw-alias-state-error-primary); font-size:12px; line-height:18px; }
      .pm-editor-actions { display:flex; flex-wrap:wrap; gap:8px; }
      .pm-primary, .pm-secondary { padding:6px 14px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; font:inherit; font-size:12px; cursor:pointer; }
      .pm-primary { background:var(--dsw-alias-label-primary); color:var(--dsw-alias-bg-layer-1); border-color:var(--dsw-alias-label-primary); }
      .pm-primary:disabled, .pm-secondary:disabled { opacity:.6; cursor:default; }
      .pm-secondary { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); }
      .pm-secondary:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
      .pm-current-details { border-top:1px solid var(--dsw-alias-border-l1); padding-top:8px; }
      .pm-current-summary { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; cursor:pointer; }
      .pm-current-summary:hover { color:var(--dsw-alias-label-primary); }
      .pm-preview { display:flex; flex-direction:column; gap:10px; margin-top:8px; }
      .pm-preview-layer { display:flex; flex-direction:column; gap:4px; }
      .pm-preview-label { color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:16px; }
      .pm-preview-total { color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:16px; text-align:right; }
      .pm-prompt { margin:0; padding:10px 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); font-family:var(--ds-font-family-code); font-size:12px; line-height:18px; white-space:pre-wrap; overflow-wrap:anywhere; }
      .pm-loading { padding:24px 0; color:var(--dsw-alias-label-tertiary); font-size:13px; text-align:center; }
      .pm-error { display:flex; align-items:center; flex-wrap:wrap; gap:8px 10px; padding:10px 12px; border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent); border-radius:10px; background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent); }
      .pm-error-title { color:var(--dsw-alias-state-error-primary); font-size:12px; font-weight:600; }
      .pm-error-text { color:var(--dsw-alias-label-secondary); font-size:12px; }
      .pm-warning { display:flex; align-items:center; flex-wrap:wrap; gap:8px 10px; padding:8px 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; background:var(--dsw-alias-bg-layer-2); }
      .pm-warning-text { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .pm-retry { margin-left:auto; padding:4px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; cursor:pointer; }
      .pm-retry:hover { background:var(--dsw-alias-interactive-bg-hover); }
      @media (max-width:640px) { .pm-grid { grid-template-columns:1fr; } .pm-editor-grid { grid-template-columns:1fr; } .pm-field-narrow { max-width:none; } }
      @media (hover:none) { .pm-card-delete { opacity:1; } }
    `

    /** 样式标签 id：重复加载时去重。 */
    const STYLE_ID = `${PKG}/client.css`

    /**
     * 注入样式。
     *
     * 只做一次；客户端模块热替换时会复用已有标签，避免样式重复堆积。
     */
    function installStyles() {
      try {
        if (typeof document === 'undefined' || document === null) return
        const selector = `style[data-plugin-css="${STYLE_ID}"]`
        if (typeof document.querySelector === 'function' && document.querySelector(selector) !== null) return
        const tag = document.createElement('style')
        tag.dataset.plugin = PKG
        tag.dataset.pluginCss = STYLE_ID
        tag.textContent = CSS
        document.head.appendChild(tag)
      } catch (error) {
        console.warn(`[${PKG}] 样式注入失败`, error)
      }
    }

    /**
     * 注册设置分区。
     *
     * @param {object} ctx 客户端插件上下文。
     */
    function apply(ctx) {
      installStyles()

      try {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'persona-modes: dictionaries')
      } catch (error) {
        console.warn(`[${PKG}] 字典注册失败`, error)
      }

      try {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'persona-modes',
          order: SECTION_ORDER,
          label: () => ctx.locale.bind(NS)('nav'),
          locale: NS,
          inject: () => ({ locale: ctx.locale }),
        }, PersonaSection))
      } catch (error) {
        console.warn(`[${PKG}] 设置分区注册失败`, error)
      }

      // 插件详情页的「调试」区块：`plugins.detail.section` 是全局 list slot，
      // 每个组合包/行/官方插件的页面都会调用它，组件内部按 subject 自行过滤。
      // 插槽由插件管理页声明，未打开过插件页时注入会一直等待——这是插槽框架的
      // 正常行为，不影响设置页。
      try {
        ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
          name: 'plugins.detail.section',
          id: 'persona-modes-debug',
          order: 40,
          locale: NS,
          inject: () => ({ locale: ctx.locale }),
        }, DebugSection))
      } catch (error) {
        console.warn(`[${PKG}] 插件详情区块注册失败`, error)
      }
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    exports.__test = {
      NS,
      SECTION_ORDER,
      PersonaView,
      RunErrors,
      DebugSection,
      normalizePayload,
      normalizeCounts,
      normalizeLogs,
      formatCount,
      formatTime,
      errorText,
      readLocaleId,
    }

    return module.exports
  },
})
