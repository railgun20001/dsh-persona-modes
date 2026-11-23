/**
 * 客户端半测试：用桩跑通模块工厂、设置分区注册、字典键集与卡片渲染。
 *
 * 不引入 jsdom，也没有真实 React：`createElement` 返回普通对象，函数组件由
 * `flatten()` 手动展开。这样测试只验证「注册对了、渲染出哪些文案」，
 * 不依赖上游客户端包的实现细节。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildModesView } from '../src/modes.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')
const SLOT = 'settings.section'

/**
 * 极简 React 桩：本测试只需要 createElement / useState / useEffect。
 *
 * @returns {object} React 形状的对象。
 */
function createReact() {
  return {
    createElement(type, props, ...children) {
      return { type, props: { ...props, children } }
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect(effect) {
      const dispose = effect()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
}

/**
 * 跑一遍 client.js。
 *
 * @returns {{ calls: Array, registered: Array, styleText: string, dictionaries: object }} 采集结果。
 */
function run() {
  const calls = []
  const styleTags = []
  const dictionaries = {}
  const fakeCtx = {
    effect(callback, label) {
      calls.push(['effect', label])
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: {
      register(ns, dicts) {
        calls.push(['locale.register', ns])
        dictionaries[ns] = dicts
        return () => {}
      },
      bind(ns) {
        return (key, params) => {
          const template = dictionaries[ns]?.zh?.[key] ?? key
          if (!params) return template
          return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
        }
      },
      getSnapshot() {
        return { active: 'zh', locales: [{ id: 'zh' }, { id: 'en' }], revision: 1 }
      },
      subscribe() {
        return () => {}
      },
    },
    slots: {
      inject(slot, callback) {
        calls.push(['slots.inject', slot])
        return callback()
      },
      register(options, Component) {
        calls.push(['slots.register', options, Component])
        return () => {}
      },
    },
  }

  globalThis.window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        const mod = factory((request) => {
          if (request === 'react') return createReact()
          throw new Error(`unexpected require: ${request}`)
        })
        calls.push(['factory', id])
        if (!Array.isArray(mod.inject) || !mod.inject.includes('slots')) throw new Error('inject 缺失 slots')
        if (!Array.isArray(mod.inject) || !mod.inject.includes('locale')) throw new Error('inject 缺失 locale')
        if (typeof mod.apply !== 'function') throw new Error('apply 缺失')
        mod.apply(fakeCtx)
        globalThis.__personaExports = mod
      },
    },
  }
  globalThis.document = {
    head: { appendChild: (tag) => styleTags.push(tag) },
    createElement: (tag) => ({ tag, dataset: {}, textContent: '', remove() {} }),
    querySelector: () => null,
  }

  new Function(source)()

  const registered = calls
    .filter(([kind]) => kind === 'slots.register')
    .map(([, options, Component]) => ({ options, Component }))
  return {
    calls,
    registered,
    styleText: styleTags.map((tag) => tag.textContent).join('\n'),
    dictionaries,
  }
}

/**
 * 展开函数组件，得到可断言的元素数组。
 *
 * @param {unknown} node React 元素或数组。
 * @returns {Array} 展开后的元素。
 */
function flatten(node) {
  if (node === null || node === undefined) return []
  if (Array.isArray(node)) return node.flatMap(flatten)
  if (typeof node !== 'object') return []
  if (typeof node.type === 'function') return flatten(node.type(node.props))
  return [node, ...flatten(node.props?.children)]
}

/**
 * 取出元素树的全部文本。
 *
 * @param {unknown} node React 元素或数组。
 * @returns {string} 文本拼接。
 */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node.type === 'function') return textOf(node.type(node.props))
  return textOf(node.props?.children)
}

// ── 模块与注册 ───────────────────────────────────────────────────────────────
const runResult = run()
assert.equal(runResult.calls[0][1], 'dsh-persona-modes')

const section = runResult.registered.find((entry) => entry.options.name === SLOT)
assert.ok(section, '没有注册 settings.section')
assert.equal(section.options.id, 'persona-modes')
assert.equal(section.options.order, 30)
assert.equal(section.options.locale, 'persona-modes')
assert.equal(typeof section.options.label, 'function')
assert.equal(section.options.label(), '人格模式')

assert.ok(runResult.styleText.includes('.pm-card'), '样式没有注入')
assert.ok(runResult.styleText.includes('--dsw-alias-'), '样式没有使用主题令牌')

// 插件详情页的调试区块也注册了，且 key 指向本包。
const detailSection = runResult.registered.find((entry) => entry.options.name === 'plugins.detail.section')
assert.ok(detailSection, '没有注册 plugins.detail.section')
assert.equal(detailSection.options.id, 'persona-modes-debug')
assert.equal(typeof detailSection.Component, 'function')

// ── 字典键集 ────────────────────────────────────────────────────────────────
const dictionaries = runResult.dictionaries['persona-modes']
assert.ok(dictionaries, '没有注册字典')
const zhKeys = Object.keys(dictionaries.zh).sort()
const enKeys = Object.keys(dictionaries.en).sort()
assert.deepEqual(zhKeys, enKeys, '中英文字典键集不一致')
assert.ok(zhKeys.includes('nav'))
assert.ok(zhKeys.includes('errorHostMissing'))

// ── 视图渲染 ────────────────────────────────────────────────────────────────
const { PersonaView } = globalThis.__personaExports.__test
const data = buildModesView('catgirl')
const t = (key, params) => {
  const template = dictionaries.zh[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

const selected = []
const tree = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: null,
  onSelect: (id) => selected.push(id),
  onRetry: () => {},
  onEdit: () => {},
  onCreate: () => {},
})
const elements = flatten(tree)
const allText = textOf(tree)

assert.ok(allText.includes('人格模式'))
assert.ok(allText.includes('猫娘'))
assert.ok(allText.includes('傲娇'))
assert.ok(allText.includes('牛马'))
assert.ok(allText.includes('鲸鱼娘'))
assert.ok(allText.includes('大小姐'))
assert.ok(allText.includes('奥特曼-迪迦'))
assert.ok(allText.includes('三千万年前的原初之光'))
assert.ok(allText.includes('病娇'))
assert.ok(allText.includes('温柔痴恋、占有欲极强'))
assert.ok(allText.includes('蠢萌'))
assert.ok(allText.includes('天然呆元气满满'))
assert.ok(allText.includes('舔狗'))
assert.ok(allText.includes('彩虹屁不断的迷妹'))
assert.ok(allText.includes('游戏宅女'))
assert.ok(allText.includes('满口游戏术语的夜猫子'))
assert.ok(allText.includes('妃子'))
assert.ok(allText.includes('爱吹枕边风'))
assert.ok(allText.includes('女仆（嫌弃脸）'))
assert.ok(allText.includes('嘴上嫌弃活照干'))
assert.ok(allText.includes('当前'))
// 低档已成为「有说明的最低浓度」，猫娘低档注入长度因此变成 114 字。
assert.ok(allText.includes('约 114 字'))
assert.ok(allText.includes('查看当前提示词'))
assert.ok(allText.includes('编辑'))
assert.ok(allText.includes('新建自定义人格'))
assert.ok(allText.includes('语气强度'))
assert.ok(allText.includes('低'))
assert.ok(allText.includes('中'))
assert.ok(allText.includes('高'))
assert.ok(allText.includes('系统提示段'))
assert.ok(allText.includes('运行时上下文'))
assert.ok(allText.includes('只改变语气'))
assert.ok(allText.includes('合计'))

// 「查看当前提示词」必须放在当前人格容器内部，而不是页面底部的说明区。
const current = elements.find((node) => node.props?.className === 'pm-current')
assert.ok(current, '没有渲染当前人格容器')
assert.ok(
  flatten(current).some((node) => node.props?.className === 'pm-current-details'),
  '查看当前提示词不在当前人格容器内',
)
const foot = elements.find((node) => node.props?.className === 'pm-foot')
assert.ok(foot, '没有渲染底部说明区')
assert.ok(
  !flatten(foot).some((node) => node.props?.className === 'pm-current-details'),
  '查看当前提示词仍留在底部说明区',
)

const editorTree = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: null,
  editor: {
    modeId: 'catgirl',
    isNew: false,
    custom: false,
    nameZh: '猫娘',
    emoji: '🐱',
    address: '主人',
    selfName: '猫娘',
    body: '【人格载入】\n猫科少女',
    defaults: { address: '主人', selfName: '猫娘', prompt: '【人格载入】\n猫科少女' },
  },
  editorBusy: false,
  editorError: null,
  onSelect: () => {},
  onRetry: () => {},
  onRetrySave: () => {},
  onEdit: () => {},
  onCreate: () => {},
  onEditorChange: () => {},
  onSave: () => {},
  onReset: () => {},
  onDelete: () => {},
  onCancelEdit: () => {},
})
const editorText = textOf(editorTree)
assert.ok(editorText.includes('编辑人格'))
assert.ok(editorText.includes('称呼'))
assert.ok(editorText.includes('自称'))
assert.ok(editorText.includes('提示词'))
assert.ok(editorText.includes('恢复默认'))
assert.ok(editorText.includes('保存'))
assert.ok(
  !flatten(editorTree).some((node) => node.type === 'button' && textOf(node) === '删除'),
  '编辑器里仍然保留删除按钮',
)

let editedId = null
let createdCount = 0
let nextIntensity = null
const actionTree = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: null,
  intensity: 'low',
  onSelect: () => {},
  onRetry: () => {},
  onIntensity: (value) => {
    nextIntensity = value
  },
  onEdit: (mode) => {
    editedId = mode.id
  },
  onCreate: () => {
    createdCount += 1
  },
})
const actionElements = flatten(actionTree)
const editButton = actionElements.find((node) => node.props?.className === 'pm-edit')
assert.ok(editButton, '没有渲染编辑按钮')
editButton.props.onClick()
assert.equal(editedId, 'catgirl')
const createButton = actionElements.find((node) => node.props?.className === 'pm-create')
assert.ok(createButton, '没有渲染新建自定义按钮')
createButton.props.onClick()
assert.equal(createdCount, 1)

// 「新建自定义人格」必须落在当前人格条里，且排在「编辑」左侧，不再留在底部说明区。
const actionCurrent = actionElements.find((node) => node.props?.className === 'pm-current')
assert.ok(actionCurrent, '没有渲染当前人格容器')
const sideClasses = flatten(actionCurrent)
  .filter((node) => node.type === 'button')
  .map((node) => node.props?.className)
const createIndex = sideClasses.indexOf('pm-create')
const editIndex = sideClasses.indexOf('pm-edit')
assert.ok(createIndex >= 0, '新建自定义按钮不在当前人格容器里')
assert.ok(editIndex >= 0, '编辑按钮不在当前人格容器里')
assert.ok(createIndex < editIndex, '新建自定义按钮没有排在编辑按钮左侧')
assert.ok(
  !flatten(foot).some((node) => node.props?.className === 'pm-create'),
  '底部说明区仍然渲染了新建按钮',
)

const mediumButton = actionElements.find(
  (node) => node.type === 'button' && node.props?.className === 'pm-segment' && textOf(node) === '中',
)
assert.ok(mediumButton, '没有渲染「中」档强度按钮')
mediumButton.props.onClick()
assert.equal(nextIntensity, 'medium')

let savedCount = 0
const saveTree = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: null,
  editor: {
    modeId: 'catgirl',
    isNew: false,
    custom: false,
    nameZh: '猫娘',
    emoji: '🐱',
    address: '主人',
    selfName: '猫娘',
    body: '【人格载入】\n猫科少女',
    defaults: { address: '主人', selfName: '猫娘', prompt: '【人格载入】\n猫科少女' },
  },
  editorBusy: false,
  editorError: null,
  onSelect: () => {},
  onRetry: () => {},
  onSave: () => {
    savedCount += 1
  },
  onReset: () => {},
  onDelete: () => {},
  onCancelEdit: () => {},
  onEditorChange: () => {},
})
const saveButton = flatten(saveTree).find((node) => node.type === 'button' && textOf(node) === '保存')
assert.ok(saveButton, '没有渲染保存按钮')
saveButton.props.onClick()
assert.equal(savedCount, 1)

const card = elements.find(
  (node) => node.type === 'button' && node.props?.className === 'pm-card' && node.props?.['aria-pressed'] === 'true',
)
assert.ok(card, '没有渲染出选中卡片')
card.props.onClick()
assert.deepEqual(selected, ['catgirl'])

// 自定义人格卡片：右上角悬浮 icon 删除按钮；内置卡片没有删除入口。
const customMode = {
  id: 'custom-demo',
  nameZh: '自定义甲',
  nameEn: 'Custom A',
  summaryZh: '自定义人格',
  summaryEn: 'Custom persona',
  emoji: '🧩',
  accent: '#0ea5e9',
  chars: 42,
  address: '你',
  selfName: '我',
  body: '【人格载入】',
  defaults: { address: '你', selfName: '我', prompt: '【人格载入】' },
  custom: true,
}
const dataWithCustom = { ...data, modes: [...data.modes, customMode] }
let deletedMode = null
const cardTree = PersonaView({
  t,
  localeId: 'zh',
  data: dataWithCustom,
  pendingId: null,
  error: null,
  onSelect: () => {},
  onRetry: () => {},
  onDelete: (mode) => {
    deletedMode = mode
  },
})
const cardElements = flatten(cardTree)
const wraps = cardElements.filter((node) => node.props?.className === 'pm-card-wrap')
assert.equal(wraps.length, dataWithCustom.modes.length, '卡片容器数量与模式数量不一致')

const customWrap = wraps.find((node) => textOf(node).includes('自定义甲'))
assert.ok(customWrap, '没有渲染自定义人格卡片')
const customDelete = flatten(customWrap).find((node) => node.props?.className === 'pm-card-delete')
assert.ok(customDelete, '自定义人格卡片没有悬浮删除按钮')
assert.equal(textOf(customDelete), '', '悬浮删除按钮应当是纯 icon，没有文字')
assert.equal(customDelete.props['aria-label'], '删除「自定义甲」')
assert.equal(customDelete.props.disabled, false)
customDelete.props.onClick()
assert.equal(deletedMode?.id, 'custom-demo')

const builtinWrap = wraps.find((node) => textOf(node).includes('猫娘'))
assert.ok(builtinWrap, '没有渲染内置人格卡片')
assert.ok(
  !flatten(builtinWrap).some((node) => node.props?.className === 'pm-card-delete'),
  '内置人格卡片也渲染了删除按钮',
)

// 删除失败时给出内联提示，而不是把整页打成错误态。
const deleteFailTree = PersonaView({
  t,
  localeId: 'zh',
  data: dataWithCustom,
  pendingId: null,
  error: null,
  deleteError: '删除失败，请重试。',
  onSelect: () => {},
  onRetry: () => {},
  onDelete: () => {},
})
const deleteFailError = flatten(deleteFailTree).find((node) => node.props?.className === 'pm-inline-error')
assert.ok(deleteFailError, '删除失败时没有渲染内联错误')
assert.equal(deleteFailError.props.role, 'alert')
assert.equal(textOf(deleteFailError), '删除失败，请重试。')

// 删除进行中：该卡片的删除按钮与卡片一起禁用，方便重复点击防护。
const deletingTree = PersonaView({
  t,
  localeId: 'zh',
  data: dataWithCustom,
  pendingId: null,
  error: null,
  deletingId: 'custom-demo',
  onSelect: () => {},
  onRetry: () => {},
  onDelete: () => {},
})
const deletingWrap = flatten(deletingTree)
  .filter((node) => node.props?.className === 'pm-card-wrap')
  .find((node) => textOf(node).includes('自定义甲'))
const deletingButton = flatten(deletingWrap).find((node) => node.props?.className === 'pm-card-delete')
assert.equal(deletingButton.props.disabled, true, '删除中的按钮没有禁用')
assert.equal(deletingButton.props['data-busy'], 'true', '删除中的按钮没有标记 busy')

// 错误态：宿主半缺失时给出明确提示
const errorTree = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: new Error('host-missing'),
  onSelect: () => {},
  onRetry: () => {},
})
const errorText = textOf(errorTree)
assert.ok(errorText.includes('宿主半未响应'))
assert.ok(errorText.includes('重试'))

// 写盘失败：保留已切换的视觉状态，但明确提示重启会恢复，并提供重试保存
let retrySaved = 0
const warningTree = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: null,
  warning: 'not-persisted',
  onSelect: () => {},
  onRetry: () => {},
  onRetrySave: () => {
    retrySaved += 1
  },
})
const warningText = textOf(warningTree)
assert.ok(warningText.includes('状态文件写入失败'))
assert.ok(warningText.includes('重试保存'))
const warningButton = flatten(warningTree).find((node) => node.type === 'button' && textOf(node).includes('重试保存'))
assert.ok(warningButton)
warningButton.props.onClick()
assert.equal(retrySaved, 1)

// ── 匿名统计 ────────────────────────────────────────────────────────────────
const { formatCount, normalizeCounts, normalizePayload } = globalThis.__personaExports.__test

assert.equal(formatCount(1234, t), '1,234')
assert.equal(formatCount(1234567, t), '99,999+')
assert.equal(formatCount(0, t), '')
assert.equal(formatCount(-1, t), '')
assert.equal(formatCount('12', t), '')

assert.deepEqual(
  normalizeCounts(
    { counts: { catgirl: 1234, off: 3, 'custom-x': 9, mom: -1, whale: '12' } },
    data.modes,
  ),
  { catgirl: 1234 },
)

let usagePatch = null
let refreshCalls = 0
const usageTree = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: null,
  usage: { report: true, fetch: true },
  counts: { catgirl: 1234 },
  countsState: 'ready',
  usagePending: false,
  usageError: null,
  onUsageChange: (patch) => {
    usagePatch = patch
  },
  onRefreshCounts: () => {
    refreshCalls += 1
  },
  onSelect: () => {},
  onRetry: () => {},
  onEdit: () => {},
  onCreate: () => {},
})
const usageText = textOf(usageTree)
assert.ok(usageText.includes('匿名统计'))
assert.ok(usageText.includes('参与统计'))
assert.ok(usageText.includes('显示统计'))
assert.ok(usageText.includes('热度 1,234'))
assert.ok(
  flatten(usageTree).some((node) => node.props?.className === 'pm-heat'),
  '没有渲染右上角热度角标',
)
assert.ok(usageText.includes('已上报的聚合计数无法撤回'))

const toggles = flatten(usageTree).filter((node) => node.props?.role === 'switch')
assert.equal(toggles.length, 2)
// 裸开关：不重复渲染 label 文字，无外框容器，文字只在 aria-label 里。
assert.equal(toggles[0].props['aria-label'], '参与统计')
assert.equal(toggles[1].props['aria-label'], '显示统计')
assert.ok(toggles.every((node) => node.props.className === 'pm-switch pm-toggle-on'))
assert.ok(
  !flatten(usageTree).some((node) => node.props?.className === 'pm-toggle-label'),
  '开关内部不应再渲染 label 文字',
)
toggles[0].props.onClick()
assert.deepEqual(usagePatch, { report: false })
toggles[1].props.onClick()
assert.deepEqual(usagePatch, { fetch: false })

// 两个开关按「label：开关」逐行排列，右侧提供手动刷新按钮。
const usageFlat = flatten(usageTree)
const usageRows = usageFlat.filter((node) => node.props?.className === 'pm-usage-row')
assert.equal(usageRows.length, 2, '应为两个开关各渲染一行')
assert.ok(usageText.includes('参与统计：'), '第一行应有「参与统计：」标签')
assert.ok(usageText.includes('显示统计：'), '第二行应有「显示统计：」标签')
const refreshButton = usageFlat.find(
  (node) => node.props?.className === 'pm-usage-refresh',
)
assert.ok(refreshButton, '没有渲染「刷新」按钮')
assert.equal(refreshButton.props.disabled, false)
refreshButton.props.onClick()
assert.equal(refreshCalls, 1, '点「刷新」应触发手动刷新')

// 熔断退避期间（自动重试待执行）「刷新」按钮置灰。
const cooldownTree = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: null,
  usage: { report: true, fetch: true },
  counts: null,
  countsState: 'error',
  usagePending: false,
  usageError: null,
  usageRetryPending: true,
  onRefreshCounts: () => {},
  onSelect: () => {},
  onRetry: () => {},
  onEdit: () => {},
  onCreate: () => {},
})
const cooldownButton = flatten(cooldownTree).find(
  (node) => node.props?.className === 'pm-usage-refresh',
)
assert.ok(cooldownButton, '退避期间也应渲染「刷新」按钮')
assert.equal(cooldownButton.props.disabled, true, '退避期间「刷新」应置灰')

// 「显示统计」关闭时不渲染刷新按钮。
const usageOffTree = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: null,
  usage: { report: true, fetch: false },
  counts: null,
  countsState: 'off',
  usagePending: false,
  usageError: null,
  onSelect: () => {},
  onRetry: () => {},
  onEdit: () => {},
  onCreate: () => {},
})
assert.ok(
  !flatten(usageOffTree).some((node) => node.props?.className === 'pm-usage-refresh'),
  '「显示统计」关闭时不应有刷新按钮',
)

// 统计设置条位于页面最底部：在人格网格与底部说明之后。
const flatUsage = flatten(usageTree)
const gridIndex = flatUsage.findIndex((node) => node.props?.className === 'pm-grid')
const footIndex = flatUsage.findIndex((node) => node.props?.className === 'pm-foot')
const usageIndex = flatUsage.findIndex((node) => node.props?.className === 'pm-usage')
assert.ok(gridIndex >= 0, '没有渲染人格网格')
assert.ok(footIndex >= 0, '没有渲染底部说明区')
assert.ok(usageIndex > gridIndex && usageIndex > footIndex, '统计设置条没有排在页面底部')

// 角标不做「少量隐藏」：1 轮也照常显示。
const smallTree = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: null,
  usage: { report: true, fetch: true },
  counts: { catgirl: 1 },
  countsState: 'ready',
  onSelect: () => {},
  onRetry: () => {},
  onEdit: () => {},
  onCreate: () => {},
})
assert.ok(textOf(smallTree).includes('热度 1'), '少量计数被隐藏了')

// 页面不再渲染「可能被伪造」的提示文案；悬停 title 仍保留「仅供参考」。
assert.ok(!usageText.includes('伪造'))
assert.ok(!usageText.includes('Abacus'))

assert.deepEqual(
  normalizePayload({ ...data, usage: { report: false } }).usage,
  { report: false, fetch: true },
)
assert.deepEqual(
  normalizePayload({ ...data }).usage,
  { report: true, fetch: true },
)

// ── 运行错误面板 ────────────────────────────────────────────────────────────
const { RunErrors, DebugSection, normalizeLogs, formatTime } = globalThis.__personaExports.__test

const logPayload = {
  ok: true,
  debug: false,
  limit: 50,
  dropped: 2,
  entries: [
    { at: new Date(2026, 10, 23, 15, 4, 5).getTime(), level: 'error', scope: 'usage.read', message: 'fetch failed', detail: 'id=catgirl', repeat: 4 },
    { at: new Date(2026, 10, 23, 15, 4, 9).getTime(), level: 'error', scope: 'route.usage', message: 'all-requests-failed' },
    { at: 1, level: 'weird', scope: 42, message: null },
    null,
  ],
}
const normalizedLogs = normalizeLogs(logPayload)
assert.equal(normalizedLogs.limit, 50)
assert.equal(normalizedLogs.dropped, 2)
assert.equal(normalizedLogs.entries.length, 3, '坏条目被丢弃')
assert.equal(normalizedLogs.entries[0].scope, 'usage.read')
assert.equal(normalizedLogs.entries[0].repeat, 4, '合并计数应保留')
assert.equal(normalizedLogs.entries[1].repeat, 1)
assert.equal(normalizedLogs.entries[1].level, 'error')
assert.equal(formatTime(new Date(2026, 10, 23, 15, 4, 5).getTime()), '15:04:05')

// 折叠态：只有标题与条数，不渲染列表；点标题会去刷新。
let logRefresh = 0
const collapsed = RunErrors({
  t,
  logs: normalizedLogs,
  state: 'ready',
  error: null,
  onRefresh: () => {
    logRefresh += 1
  },
  onClear: () => {},
})
const collapsedFlat = flatten(collapsed)
assert.ok(textOf(collapsed).includes('运行错误'))
assert.ok(textOf(collapsed).includes('3 条'))
assert.equal(
  collapsedFlat.filter((node) => node.props?.className === 'pm-logs-list').length,
  0,
  '默认应折叠，不渲染列表',
)
const head = collapsedFlat.find((node) => node.props?.className === 'pm-logs-head')
assert.ok(head, '没有渲染折叠标题')
assert.equal(head.props['aria-expanded'], 'false')
head.props.onClick()
assert.equal(logRefresh, 1, '展开时应触发一次刷新')

// 展开态：渲染每一条，并显示条数上限说明。
const expanded = RunErrors({
  t,
  logs: normalizedLogs,
  state: 'ready',
  error: null,
  onRefresh: () => {},
  onClear: () => {},
  defaultOpen: true,
})
const expandedText = textOf(expanded)
assert.ok(expandedText.includes('usage.read'))
assert.ok(expandedText.includes('fetch failed'))
assert.ok(expandedText.includes('id=catgirl'))
assert.ok(expandedText.includes('15:04:05'))
assert.ok(expandedText.includes('最近 50 条'))
assert.ok(expandedText.includes('更早的 2 条已丢弃'))
assert.ok(expandedText.includes('×4'), '合并计数应显示为 ×N')

// 空日志：显示「暂无错误记录」。
const empty = RunErrors({
  t,
  logs: { entries: [], dropped: 0, limit: 50 },
  state: 'ready',
  error: null,
  onRefresh: () => {},
  onClear: () => {},
  defaultOpen: true,
})
assert.ok(textOf(empty).includes('暂无错误记录'))

// ── 面板只在调试打开时出现 ──────────────────────────────────────────────────
const quietView = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: null,
  usage: { report: true, fetch: true },
  counts: {},
  countsState: 'ready',
  debug: false,
  logs: normalizedLogs,
  logsState: 'ready',
  onSelect: () => {},
  onRetry: () => {},
  onEdit: () => {},
  onCreate: () => {},
})
assert.equal(
  flatten(quietView).filter((node) => node.props?.className === 'pm-logs').length,
  0,
  '调试关闭时不应渲染运行错误面板',
)
assert.ok(!textOf(quietView).includes('运行错误'))

const debugView = PersonaView({
  t,
  localeId: 'zh',
  data,
  pendingId: null,
  error: null,
  usage: { report: true, fetch: true },
  counts: {},
  countsState: 'ready',
  debug: true,
  logs: normalizedLogs,
  logsState: 'ready',
  onRefreshLogs: () => {},
  onClearLogs: () => {},
  onSelect: () => {},
  onRetry: () => {},
  onEdit: () => {},
  onCreate: () => {},
})
const debugFlat = flatten(debugView)
const logsIndex = debugFlat.findIndex((node) => node.props?.className === 'pm-logs')
const usageIndexDebug = debugFlat.findIndex((node) => node.props?.className === 'pm-usage')
assert.ok(logsIndex > 0, '调试打开时应渲染运行错误面板')
assert.ok(logsIndex > usageIndexDebug, '运行错误面板应排在统计设置条之后')
assert.ok(textOf(debugView).includes('运行错误'))
assert.ok(textOf(debugView).includes('3 条'))

// ── 插件详情页的调试区块 ────────────────────────────────────────────────────
// 别人的组合包页面：什么都不渲染。
const foreign = DebugSection({
  t,
  subject: { kind: 'bundle', pkg: { name: '@acme/other' } },
})
assert.equal(foreign, null)
assert.equal(DebugSection({ t, subject: { kind: 'item', id: 'x' } }), null)

// 本包页面：渲染标题、开关与说明。
const mine = DebugSection({ t, subject: { kind: 'bundle', pkg: { name: 'dsh-persona-modes' } } })
const mineFlat = flatten(mine)
const mineText = textOf(mine)
assert.ok(mineText.includes('调试'))
assert.ok(mineText.includes('默认关闭'))
const debugToggle = mineFlat.find((node) => node.props?.role === 'switch')
assert.ok(debugToggle, '没有渲染调试开关')
assert.equal(debugToggle.props['aria-label'], '调试')
