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
      delete: '删除',
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
      delete: 'Delete',
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

    /**
     * 发一条宿主路由请求。
     *
     * `state` / `select` 都走 POST：POST + 自定义头会触发跨站预检，而宿主不返回
     * CORS 头，因此其他网页无法调用。这里只处理 JSON，响应非 2xx 或 `ok !== true`
     * 都抛出带错误码的 Error。请求带超时，避免宿主卡死时设置页永远停在 loading。
     *
     * @param {'state' | 'select'} action 动作名。
     * @param {object} [body] 请求体。
     * @returns {Promise<object>} 宿主返回的状态视图。
     */
    async function postRoute(action, body) {
      if (typeof fetch !== 'function') throw new Error('host-missing')
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller === null ? null : setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
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
    function CurrentBar({ t, localeId, mode, pending, onEdit }) {
      const isOff = mode.id === 'off'
      const prompt = typeof mode.prompt === 'string' ? mode.prompt : ''
      const chars = typeof mode.chars === 'number' ? mode.chars : 0
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
            !isOff && typeof onEdit === 'function'
              ? h(
                  'button',
                  { type: 'button', className: 'pm-edit', onClick: () => onEdit(mode) },
                  t('edit'),
                )
              : null,
          ),
        ),
        chars > 0 && prompt !== ''
          ? h(
              'details',
              { className: 'pm-current-details' },
              h('summary', { className: 'pm-current-summary' }, t('preview')),
              h('pre', { className: 'pm-prompt' }, prompt),
            )
          : null,
      )
    }

    /**
     * 单张模式卡片。
     *
     * @param {object} props 组件属性。
     * @returns {object} React 元素。
     */
    function ModeCard({ t, localeId, mode, active, pendingId, onSelect }) {
      const selected = mode.id === active
      const busy = pendingId !== null
      const chars = typeof mode.chars === 'number' ? mode.chars : 0
      return h(
        'button',
        {
          type: 'button',
          className: 'pm-card',
          'aria-pressed': selected ? 'true' : 'false',
          disabled: busy,
          onClick: () => onSelect(mode.id),
          style: { '--pm-accent': mode.accent },
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
      onDelete,
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
          isCustom && !isNew
            ? h('button', { type: 'button', className: 'pm-danger', disabled: busy, onClick: onDelete }, t('delete'))
            : null,
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
        editor,
        editorBusy,
        editorError,
        onSelect,
        onRetry,
        onRetrySave,
        onEdit,
        onCreate,
        onEditorChange,
        onSave,
        onReset,
        onDelete,
        onCancelEdit,
      } = props
      const active = data.modes.find((mode) => mode.id === data.active) ?? data.modes[0]
      return h(
        'div',
        { className: 'pm-root' },
        h(Hero, { t }),
        h(CurrentBar, {
          t,
          localeId,
          mode: active,
          pending: pendingId !== null,
          onEdit,
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
              onDelete,
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
              onSelect,
            }),
          ),
        ),
        h(
          'div',
          { className: 'pm-foot' },
          h('p', { className: 'pm-note' }, t('note')),
          h(
            'button',
            { type: 'button', className: 'pm-create', onClick: onCreate },
            t('createCustom'),
          ),
        ),
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

      /** 重新读取宿主状态；错误时进入统一错误态，用户可点「重试」。 */
      const load = async () => {
        setView({ phase: 'loading', data: null, error: null, warning: null })
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

      const select = async (id) => {
        if (pendingId !== null) return
        setPendingId(id)
        setView((current) => ({ ...current, error: null, warning: null }))
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

      const deleteEditor = async () => {
        if (editor === null || editor.modeId === null || editorBusy) return
        const confirmed =
          typeof window === 'undefined' ||
          typeof window.confirm !== 'function' ||
          window.confirm(t('deleteConfirm', { name: editor.nameZh }))
        if (!confirmed) return
        setEditorBusy(true)
        setEditorError(null)
        try {
          const data = normalizePayload(await postRoute('delete', { id: editor.modeId }))
          setView({
            phase: 'ready',
            data,
            error: null,
            warning: data.persisted === false ? 'not-persisted' : null,
          })
          setEditor(null)
        } catch {
          setEditorError(t('deleteFailed'))
        } finally {
          setEditorBusy(false)
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
        editor,
        editorBusy,
        editorError,
        onSelect: select,
        onRetry: load,
        onRetrySave: () => {
          if (view.data !== null) void select(view.data.active)
        },
        onEdit: openEditor,
        onCreate: openCreate,
        onEditorChange: changeEditor,
        onSave: saveEditor,
        onReset: resetEditor,
        onDelete: deleteEditor,
        onCancelEdit: cancelEditor,
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
      .pm-current-side { margin-left:auto; display:flex; align-items:center; gap:8px; }
      .pm-current-hint { color:var(--dsw-alias-label-tertiary); font-size:12px; white-space:nowrap; }
      .pm-edit { padding:3px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; cursor:pointer; }
      .pm-edit:hover { background:var(--dsw-alias-interactive-bg-hover); }
      .pm-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
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
      .pm-foot { display:flex; flex-direction:column; gap:8px; }
      .pm-note { margin:0; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
      .pm-create { align-self:flex-start; padding:7px 14px; border:1px dashed var(--dsw-alias-border-l2); border-radius:8px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; cursor:pointer; }
      .pm-create:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
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
      .pm-editor-actions { display:flex; flex-wrap:wrap; gap:8px; }
      .pm-primary, .pm-secondary, .pm-danger { padding:6px 14px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; font:inherit; font-size:12px; cursor:pointer; }
      .pm-primary { background:var(--dsw-alias-label-primary); color:var(--dsw-alias-bg-layer-1); border-color:var(--dsw-alias-label-primary); }
      .pm-primary:disabled, .pm-secondary:disabled, .pm-danger:disabled { opacity:.6; cursor:default; }
      .pm-secondary { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); }
      .pm-secondary:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
      .pm-danger { margin-left:auto; color:var(--dsw-alias-state-error-primary); border-color:var(--dsw-alias-state-error-primary); background:transparent; }
      .pm-danger:hover:not(:disabled) { background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent); }
      .pm-current-details { border-top:1px solid var(--dsw-alias-border-l1); padding-top:8px; }
      .pm-current-summary { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; cursor:pointer; }
      .pm-current-summary:hover { color:var(--dsw-alias-label-primary); }
      .pm-prompt { margin:8px 0 0; padding:10px 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); font-family:var(--ds-font-family-code); font-size:12px; line-height:18px; white-space:pre-wrap; overflow-wrap:anywhere; }
      .pm-loading { padding:24px 0; color:var(--dsw-alias-label-tertiary); font-size:13px; text-align:center; }
      .pm-error { display:flex; align-items:center; flex-wrap:wrap; gap:8px 10px; padding:10px 12px; border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent); border-radius:10px; background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent); }
      .pm-error-title { color:var(--dsw-alias-state-error-primary); font-size:12px; font-weight:600; }
      .pm-error-text { color:var(--dsw-alias-label-secondary); font-size:12px; }
      .pm-warning { display:flex; align-items:center; flex-wrap:wrap; gap:8px 10px; padding:8px 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; background:var(--dsw-alias-bg-layer-2); }
      .pm-warning-text { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .pm-retry { margin-left:auto; padding:4px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; cursor:pointer; }
      .pm-retry:hover { background:var(--dsw-alias-interactive-bg-hover); }
      @media (max-width:640px) { .pm-grid { grid-template-columns:1fr; } .pm-editor-grid { grid-template-columns:1fr; } .pm-field-narrow { max-width:none; } }
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
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    exports.__test = {
      NS,
      SECTION_ORDER,
      PersonaView,
      normalizePayload,
      errorText,
      readLocaleId,
    }

    return module.exports
  },
})
