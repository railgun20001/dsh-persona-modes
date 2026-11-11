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
assert.ok(allText.includes('当前'))
assert.ok(allText.includes('约 112 字'))
assert.ok(allText.includes('查看当前提示词'))
assert.ok(allText.includes('编辑'))
assert.ok(allText.includes('新建自定义人格'))
assert.ok(allText.includes('语气强度'))
assert.ok(allText.includes('低'))
assert.ok(allText.includes('中'))
assert.ok(allText.includes('高'))

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
