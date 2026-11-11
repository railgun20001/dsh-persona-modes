/**
 * 人格模式的宿主侧持久化。
 *
 * 状态文件保存三类信息：
 * - `active`：当前模式 id；
 * - `overrides`：内置模式的「称呼 / 自称 / 提示词」覆盖值；
 * - `customModes`：用户新增的自定义人格，每个都带 `defaults` 与 `values`。
 *
 * 状态很小，所以不需要数据库：一个 JSON 文件就够了。文件位置跟随 DSH 自己的
 * home，默认是 `~/.dsh/persona-modes/state.json`，测试可以通过 `file` 参数注入
 * 临时路径。
 *
 * 读取策略是「坏数据不阻塞启动」：文件不存在、JSON 损坏、字段类型不对、模式已被
 * 删除，都回落到默认模式或丢弃坏条目，而不是让宿主在装配插件时抛错。写入采用
 * 临时文件 + 改名，读者要么看到旧完整文件、要么看到新完整文件。
 *
 * @module dsh-persona-modes/store
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  CUSTOM_PERSONA_DEFAULTS,
  DEFAULT_INTENSITY,
  DEFAULT_MODE_ID,
  getMode,
  isModeId,
  normalizeIntensity,
  normalizeModeId,
} from './modes.js'

/** DSH home；与 DSH 自身的数据目录保持一致。 */
export const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** 本插件的数据目录。 */
export const STATE_DIR = join(DSH_HOME, 'persona-modes')

/** 默认状态文件。 */
export const STATE_FILE = join(STATE_DIR, 'state.json')

/** 状态文件格式版本；未来形状变化时用于迁移。 */
export const STATE_VERSION = 2

/** 名称、称呼、自称等短文本上限。 */
const MAX_SHORT_TEXT = 40

/** emoji 上限。 */
const MAX_EMOJI = 8

/** 自定义提示词上限。 */
const MAX_PROMPT = 4000

/**
 * 把未知值读成字符串。
 *
 * @param {unknown} value 原始值。
 * @param {string} [fallback] 回落值。
 * @returns {string} 字符串。
 */
function asText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

/**
 * 清理用户输入：统一换行、去首尾空白、截断。
 *
 * @param {unknown} value 原始值。
 * @param {number} max 最大长度。
 * @returns {string} 清理后的文本。
 */
function cleanText(value, max) {
  return asText(value).replace(/\r\n?/gu, '\n').trim().slice(0, max)
}

/**
 * 规整一组 `{ address, selfName, prompt }`。
 *
 * @param {unknown} value 原始值。
 * @param {{ address: string, selfName: string, prompt: string }} fallback 回落值。
 * @returns {{ address: string, selfName: string, prompt: string }} 规整后的值。
 */
function normalizeValues(value, fallback) {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    address: cleanText(source.address ?? fallback.address, MAX_SHORT_TEXT),
    selfName: cleanText(source.selfName ?? fallback.selfName, MAX_SHORT_TEXT),
    prompt: cleanText(source.prompt ?? fallback.prompt, MAX_PROMPT),
  }
}

/**
 * 判断两组编辑值是否完全一致。
 *
 * @param {{ address: string, selfName: string, prompt: string }} left 左值。
 * @param {{ address: string, selfName: string, prompt: string }} right 右值。
 * @returns {boolean} 是否一致。
 */
function sameValues(left, right) {
  return left.address === right.address && left.selfName === right.selfName && left.prompt === right.prompt
}

/**
 * 规整一个自定义人格。
 *
 * @param {unknown} entry 原始条目。
 * @returns {object | null} 合法条目；非法返回 null。
 */
function normalizeCustomMode(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
  const id = asText(entry.id).trim()
  if (!id.startsWith('custom-')) return null
  const defaults = normalizeValues(entry.defaults, CUSTOM_PERSONA_DEFAULTS)
  const values = normalizeValues(entry.values, defaults)
  const nameZh = cleanText(entry.nameZh ?? defaults.nameZh, MAX_SHORT_TEXT) || CUSTOM_PERSONA_DEFAULTS.nameZh
  const nameEn = cleanText(entry.nameEn ?? CUSTOM_PERSONA_DEFAULTS.nameEn, MAX_SHORT_TEXT) || CUSTOM_PERSONA_DEFAULTS.nameEn
  const accent = typeof entry.accent === 'string' && /^#[0-9a-f]{6}$/iu.test(entry.accent)
    ? entry.accent
    : CUSTOM_PERSONA_DEFAULTS.accent
  return {
    id,
    emoji: cleanText(entry.emoji ?? CUSTOM_PERSONA_DEFAULTS.emoji, MAX_EMOJI) || CUSTOM_PERSONA_DEFAULTS.emoji,
    nameZh,
    nameEn,
    summaryZh: cleanText(entry.summaryZh ?? nameZh, MAX_SHORT_TEXT * 2) || nameZh,
    summaryEn: cleanText(entry.summaryEn ?? CUSTOM_PERSONA_DEFAULTS.summaryEn, MAX_SHORT_TEXT * 2) || CUSTOM_PERSONA_DEFAULTS.summaryEn,
    accent,
    defaults,
    values,
    ...(typeof entry.createdAt === 'string' ? { createdAt: entry.createdAt } : {}),
  }
}

/**
 * 规整自定义人格数组：丢弃坏条目与重复 id。
 *
 * @param {unknown} value 原始值。
 * @returns {Array<object>} 合法条目。
 */
function normalizeCustomModes(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const entry of value) {
    const mode = normalizeCustomMode(entry)
    if (mode === null || seen.has(mode.id) || getMode(mode.id) !== undefined) continue
    seen.add(mode.id)
    out.push(mode)
  }
  return out
}

/**
 * 规整内置模式覆盖值。
 *
 * 未知 id、`off`、与默认值完全相同的条目都会被丢弃。
 *
 * @param {unknown} value 原始值。
 * @returns {Record<string, { address: string, selfName: string, prompt: string }>} 覆盖值。
 */
function normalizeOverrides(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [id, entry] of Object.entries(value)) {
    const mode = getMode(id)
    if (mode === undefined || mode.custom || id === DEFAULT_MODE_ID) continue
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const values = normalizeValues(entry, mode.defaults)
    if (sameValues(values, mode.defaults)) continue
    out[id] = values
  }
  return out
}

/**
 * 从磁盘读取状态。
 *
 * 任何异常都返回 `null`，由调用方决定回落值；解析成功但形状不合法也返回 `null`。
 * v1 的 `{ version, active }` 会被迁移成 v2 的空覆盖/空自定义列表。
 *
 * @param {string} file 状态文件路径。
 * @returns {{
 *   version: number,
 *   active: string,
 *   overrides: Record<string, object>,
 *   customModes: Array<object>,
 *   updatedAt?: string,
 * } | null} 读取结果。
 */
export function readStateFile(file = STATE_FILE) {
  try {
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const customModes = normalizeCustomModes(parsed.customModes)
    const overrides = normalizeOverrides(parsed.overrides)
    if (typeof parsed.active !== 'string' || !isModeId(parsed.active, { customModes })) return null
    return {
      version: STATE_VERSION,
      active: parsed.active,
      intensity: normalizeIntensity(parsed.intensity),
      overrides,
      customModes,
      ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
    }
  } catch {
    return null
  }
}

/**
 * 原子写状态文件。
 *
 * @param {object} state 完整状态。
 * @param {string} file 目标路径。
 * @returns {boolean} 是否写入成功。
 */
export function writeStateFile(state, file = STATE_FILE) {
  const temporary = `${file}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
    return true
  } catch {
    try {
      unlinkSync(temporary)
    } catch {
      /* 临时文件可能根本没建出来 */
    }
    return false
  }
}

/**
 * 生成一个不会和现有条目不冲突的自定义 id。
 *
 * @param {Array<object>} customModes 现有自定义模式。
 * @returns {string} 新 id。
 */
function newCustomId(customModes) {
  const existing = new Set(customModes.map((mode) => mode.id))
  for (;;) {
    const id = `custom-${randomUUID()}`
    if (!existing.has(id)) return id
  }
}

/**
 * 创建一个带内存快照的模式状态存储。
 *
 * 选择模式、保存覆盖、增删自定义人格都是同步的：校验 → 写盘 → 更新内存。即使
 * 写盘失败，内存也会更新，让本次会话至少立刻生效；下一次宿主重启会回到旧值，但
 * 不会因为磁盘只读就让设置页完全不可用。写入结果通过 `persisted` 暴露，路由会把
 * 降级状态告诉客户端。
 *
 * @param {{ file?: string, defaultMode?: string }} [options] 存储选项。
 * @returns {object} 存储对象。
 */
export function createStore(options = {}) {
  const file = typeof options.file === 'string' && options.file !== '' ? options.file : STATE_FILE
  const fallback = normalizeModeId(options.defaultMode, DEFAULT_MODE_ID)
  const loaded = readStateFile(file)
  let persisted = loaded !== null
  let state = loaded ?? {
    version: STATE_VERSION,
    active: fallback,
    intensity: DEFAULT_INTENSITY,
    overrides: {},
    customModes: [],
  }

  /**
   * 写盘并更新内存快照。
   *
   * @param {object} next 新状态。
   * @returns {boolean} 是否成功写盘。
   */
  function commit(next) {
    const wrote = writeStateFile(next, file)
    if (wrote) persisted = true
    state = next
    return wrote
  }

  return {
    file,

    /** 当前模式 id。 */
    getActive() {
      return state.active
    },

    /** 当前语气强度。 */
    getIntensity() {
      return state.intensity
    },

    /**
     * 设置全局语气强度。
     *
     * @param {unknown} value 目标档位。
     * @returns {{ intensity: string, persisted: boolean }} 设置结果。
     */
    setIntensity(value) {
      const intensity = normalizeIntensity(value)
      if (intensity === state.intensity && persisted) return { intensity, persisted: true }
      const next = {
        ...state,
        intensity,
        updatedAt: new Date().toISOString(),
      }
      const wrote = commit(next)
      return { intensity, persisted: wrote }
    },

    /**
     * 切换模式。
     *
     * @param {unknown} id 目标模式 id。
     * @returns {{ active: string, persisted: boolean } | null} 成功结果；未知 id 返回 null。
     */
    setActive(id) {
      if (!isModeId(id, state)) return null
      // 内存里已经是这个值，且它确实已经落过盘，才可以直接返回成功。
      // 如果上一次写盘失败（persisted=false），再次选择同一模式必须重试写入，
      // 否则用户会看到「已保存」但重启后回到旧值。
      if (id === state.active && persisted) return { active: id, persisted: true }
      const next = {
        ...state,
        active: id,
        updatedAt: new Date().toISOString(),
      }
      const wrote = commit(next)
      return { active: id, persisted: wrote }
    },

    /**
     * 保存内置覆盖或自定义人格。
     *
     * - 带内置 id：只更新 `address / selfName / prompt` 覆盖；
     * - 带自定义 id：更新该自定义人格的 `values`（名称/emoji 也可改）；
     * - 不带 id：新建一个自定义人格，`defaults` 取首次保存的值。
     *
     * @param {object} input 编辑值。
     * @returns {{ id: string, custom: boolean, persisted: boolean } | null} 保存结果。
     */
    savePersona(input) {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
      const id = asText(input.id).trim()

      if (id !== '') {
        const builtin = getMode(id)
        if (builtin !== undefined && !builtin.custom) {
          if (id === DEFAULT_MODE_ID) return null
          const values = normalizeValues(input, builtin.defaults)
          const overrides = { ...state.overrides }
          if (sameValues(values, builtin.defaults)) delete overrides[id]
          else overrides[id] = values
          const wrote = commit({ ...state, overrides, updatedAt: new Date().toISOString() })
          return { id, custom: false, persisted: wrote }
        }

        const index = state.customModes.findIndex((mode) => mode.id === id)
        if (index === -1) return null
        const current = state.customModes[index]
        const values = normalizeValues(input, current.defaults)
        const nameZh = cleanText(input.nameZh ?? current.nameZh, MAX_SHORT_TEXT) || current.nameZh
        const emoji = cleanText(input.emoji ?? current.emoji, MAX_EMOJI) || current.emoji
        const customModes = state.customModes.slice()
        customModes[index] = {
          ...current,
          nameZh,
          emoji,
          summaryZh: nameZh,
          values,
        }
        const wrote = commit({ ...state, customModes, updatedAt: new Date().toISOString() })
        return { id, custom: true, persisted: wrote }
      }

      const values = normalizeValues(input, CUSTOM_PERSONA_DEFAULTS)
      const nameZh = cleanText(input.nameZh ?? '', MAX_SHORT_TEXT) || CUSTOM_PERSONA_DEFAULTS.nameZh
      const emoji = cleanText(input.emoji ?? '', MAX_EMOJI) || CUSTOM_PERSONA_DEFAULTS.emoji
      const custom = {
        id: newCustomId(state.customModes),
        emoji,
        nameZh,
        nameEn: CUSTOM_PERSONA_DEFAULTS.nameEn,
        summaryZh: nameZh,
        summaryEn: CUSTOM_PERSONA_DEFAULTS.summaryEn,
        accent: CUSTOM_PERSONA_DEFAULTS.accent,
        defaults: { ...values },
        values,
        createdAt: new Date().toISOString(),
      }
      const wrote = commit({
        ...state,
        customModes: [...state.customModes, custom],
        updatedAt: new Date().toISOString(),
      })
      return { id: custom.id, custom: true, persisted: wrote }
    },

    /**
     * 恢复默认值：内置模式删除覆盖，自定义模式把 `values` 重置为 `defaults`。
     *
     * @param {unknown} id 模式 id。
     * @returns {{ id: string, custom: boolean, persisted: boolean } | null} 重置结果。
     */
    resetPersona(id) {
      if (typeof id !== 'string' || id === '') return null
      const builtin = getMode(id)
      if (builtin !== undefined && !builtin.custom) {
        if (id === DEFAULT_MODE_ID) return null
        const overrides = { ...state.overrides }
        delete overrides[id]
        const wrote = commit({ ...state, overrides, updatedAt: new Date().toISOString() })
        return { id, custom: false, persisted: wrote }
      }

      const index = state.customModes.findIndex((mode) => mode.id === id)
      if (index === -1) return null
      const current = state.customModes[index]
      const customModes = state.customModes.slice()
      customModes[index] = { ...current, values: { ...current.defaults } }
      const wrote = commit({ ...state, customModes, updatedAt: new Date().toISOString() })
      return { id, custom: true, persisted: wrote }
    },

    /**
     * 删除自定义人格；如果删的是当前模式，自动切回 `off`。
     *
     * @param {unknown} id 自定义模式 id。
     * @returns {{ id: string, persisted: boolean, active: string } | null} 删除结果。
     */
    deletePersona(id) {
      if (typeof id !== 'string' || id === '') return null
      const index = state.customModes.findIndex((mode) => mode.id === id)
      if (index === -1) return null
      const customModes = state.customModes.filter((mode) => mode.id !== id)
      const active = state.active === id ? DEFAULT_MODE_ID : state.active
      const wrote = commit({ ...state, active, customModes, updatedAt: new Date().toISOString() })
      return { id, persisted: wrote, active }
    },

    /** 当前内存值是否已经成功写入过磁盘。 */
    isPersisted() {
      return persisted
    },

    /** 当前状态的深拷贝，供诊断、渲染与测试使用。 */
    snapshot() {
      return {
        ...state,
        overrides: Object.fromEntries(
          Object.entries(state.overrides).map(([id, values]) => [id, { ...values }]),
        ),
        customModes: state.customModes.map((mode) => ({
          ...mode,
          defaults: { ...mode.defaults },
          values: { ...mode.values },
        })),
      }
    },
  }
}
