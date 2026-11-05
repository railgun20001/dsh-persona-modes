/**
 * 人格模式的宿主侧持久化。
 *
 * 状态很小（只存当前模式 id），所以不需要数据库，也不值得注册一个 Host Config
 * 命名空间：一个 JSON 文件就够了。文件位置跟随 DSH 自己的 home，默认是
 * `~/.dsh/persona-modes/state.json`，测试可以通过 `file` 参数注入临时路径。
 *
 * 读取策略是「坏数据不阻塞启动」：文件不存在、JSON 损坏、字段类型不对、模式已被
 * 删除，都回落到默认模式，而不是让宿主在装配插件时抛错。写入采用临时文件 + 改名，
 * 读者要么看到旧完整文件、要么看到新完整文件。
 *
 * @module dsh-persona-modes/store
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { DEFAULT_MODE_ID, isModeId, normalizeModeId } from './modes.js'

/** DSH home；与 DSH 自身的数据目录保持一致。 */
export const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** 本插件的数据目录。 */
export const STATE_DIR = join(DSH_HOME, 'persona-modes')

/** 默认状态文件。 */
export const STATE_FILE = join(STATE_DIR, 'state.json')

/** 状态文件格式版本；未来形状变化时用于迁移。 */
export const STATE_VERSION = 1

/**
 * 从磁盘读取状态。
 *
 * 任何异常都返回 `null`，由调用方决定回落值；解析成功但形状不合法也返回 `null`。
 *
 * @param {string} file 状态文件路径。
 * @returns {{ version: number, active: string, updatedAt?: string } | null} 读取结果。
 */
export function readStateFile(file = STATE_FILE) {
  try {
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (!isModeId(parsed.active)) return null
    return {
      version: Number.isInteger(parsed.version) ? parsed.version : STATE_VERSION,
      active: parsed.active,
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
 * 创建一个带内存快照的模式状态存储。
 *
 * 选择模式是同步的：校验 → 写盘 → 更新内存。即使写盘失败，内存也会更新，
 * 让本次会话至少立刻生效；下一次宿主重启会回到旧值，但不会因为磁盘只读就
 * 让设置页完全不可用。写入结果通过 `persisted` 暴露，路由会把降级状态告诉客户端。
 *
 * @param {{ file?: string, defaultMode?: string }} [options] 存储选项。
 * @returns {{
 *   file: string,
 *   getActive: () => string,
 *   setActive: (id: unknown) => { active: string, persisted: boolean } | null,
 *   snapshot: () => { version: number, active: string, updatedAt?: string },
 * }} 存储对象。
 */
export function createStore(options = {}) {
  const file = typeof options.file === 'string' && options.file !== '' ? options.file : STATE_FILE
  const fallback = normalizeModeId(options.defaultMode, DEFAULT_MODE_ID)
  const loaded = readStateFile(file)
  let persisted = loaded !== null
  let state = {
    version: STATE_VERSION,
    active: loaded?.active ?? fallback,
    ...(loaded?.updatedAt === undefined ? {} : { updatedAt: loaded.updatedAt }),
  }

  return {
    file,

    /** 当前模式 id。 */
    getActive() {
      return state.active
    },

    /**
     * 切换模式。
     *
     * @param {unknown} id 目标模式 id。
     * @returns {{ active: string, persisted: boolean } | null} 成功结果；未知 id 返回 null。
     */
    setActive(id) {
      if (!isModeId(id)) return null
      // 内存里已经是这个值，且它确实已经落过盘，才可以直接返回成功。
      // 如果上一次写盘失败（persisted=false），再次选择同一模式必须重试写入，
      // 否则用户会看到「已保存」但重启后回到旧值。
      if (id === state.active && persisted) return { active: id, persisted: true }
      const next = {
        version: STATE_VERSION,
        active: id,
        updatedAt: new Date().toISOString(),
      }
      const wrote = writeStateFile(next, file)
      if (wrote) persisted = true
      state = next
      return { active: id, persisted: wrote }
    },

    /** 当前内存值是否已经成功写入过磁盘。 */
    isPersisted() {
      return persisted
    },

    /** 当前状态的浅拷贝，供诊断与测试使用。 */
    snapshot() {
      return { ...state }
    },
  }
}
