/**
 * 运行错误日志：把「静默失败」变成可查的记录。
 *
 * 设计取舍：
 * - **只在内存里**：不落盘、不写缓存，宿主重启即清空。错误日志是排查工具，不是
 *   需要长期保存的数据；落盘还会引入「日志文件写坏 / 泄露路径」这类新问题。
 * - **有上限**：环形缓冲，超过 `LOG_LIMIT` 就丢最旧的，并记下丢弃条数。统计失败
 *   可能每轮对话都发生，没有上限会无限吃内存。
 * - **默认只记错误**：`debug` 关闭时只收错误；打开后额外收「成功/流程」这类
 *   细节记录（`note`），以及错误堆栈。开关由 `state.json` 里的 `debug` 决定，
 *   在插件详情页切换。
 * - **不留敏感信息**：URL 去掉查询串与片段，文本统一截断；不记录提示词、会话内容
 *   或用户文件内容——本插件的错误本来也不含这些。
 *
 * @module dsh-persona-modes/errors
 */

/** 环形缓冲容量：足以看清一次故障的来龙去脉，又不至于占太多内存。 */
export const LOG_LIMIT = 50

/** 单条消息的字符上限。 */
const MESSAGE_MAX = 240

/** 单条补充信息的字符上限。 */
const DETAIL_MAX = 300

/** 堆栈的字符上限：只在 debug 打开时附带。 */
const STACK_MAX = 800

/**
 * 压平空白并截断。
 *
 * @param {unknown} value 原始值。
 * @param {number} max 最大长度。
 * @returns {string} 清理后的文本。
 */
function clampText(value, max) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * 去掉 URL 的查询串与片段。
 *
 * 端点本身是硬编码的，但错误信息里可能带上第三方返回的完整地址；查询串可能含
 * 一次性参数，因此统一抹掉，只保留「协议 + 主机 + 路径」。
 *
 * @param {unknown} value 原始值。
 * @returns {string} 处理后的文本。
 */
function scrubUrls(value) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  return text.replace(/https?:\/\/[^\s"'<>]+/gu, (match) => {
    const cut = match.search(/[?#]/u)
    return cut === -1 ? match : match.slice(0, cut)
  })
}

/**
 * 从一个错误值里提炼出可记录的字段。
 *
 * 兼容 `Error`、字符串、以及带 `status`/`code` 的普通对象（fetch 失败与 HTTP
 * 状态码都走这条路径）。
 *
 * @param {unknown} error 错误值。
 * @returns {{ code: string, message: string, status?: number, stack?: string }} 提炼结果。
 */
export function describeError(error) {
  if (error === null || error === undefined) return { code: 'unknown', message: 'unknown' }
  if (typeof error === 'string') {
    return { code: clampText(scrubUrls(error), MESSAGE_MAX), message: clampText(scrubUrls(error), MESSAGE_MAX) }
  }
  if (typeof error !== 'object') {
    const text = clampText(String(error), MESSAGE_MAX)
    return { code: text, message: text }
  }
  const source = /** @type {Record<string, unknown>} */ (error)
  const name = typeof source.name === 'string' ? source.name : ''
  const rawMessage = typeof source.message === 'string' ? source.message : ''
  const causeCode = source.cause !== null && typeof source.cause === 'object'
    ? /** @type {Record<string, unknown>} */ (source.cause).code
    : undefined
  const code = typeof source.code === 'string'
    ? source.code
    : typeof causeCode === 'string'
      ? causeCode
      : name !== ''
        ? name
        : 'error'
  const message = clampText(scrubUrls(rawMessage), MESSAGE_MAX) || code
  const status = typeof source.status === 'number' && Number.isInteger(source.status) ? source.status : undefined
  const stack = typeof source.stack === 'string' ? clampText(scrubUrls(source.stack), STACK_MAX) : undefined
  return {
    code: clampText(code, 64),
    message,
    ...(status === undefined ? {} : { status }),
    ...(stack === undefined ? {} : { stack }),
  }
}

/**
 * 把补充信息压成一条短文本。
 *
 * 只接受标量，避免把整个响应体写进日志。
 *
 * @param {unknown} detail 补充信息。
 * @returns {string | undefined} 文本或 undefined。
 */
function describeDetail(detail) {
  if (detail === null || detail === undefined) return undefined
  if (typeof detail === 'object') {
    const parts = []
    for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (detail))) {
      if (value === null || value === undefined) continue
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
      parts.push(`${key}=${clampText(scrubUrls(typeof value === 'string' ? value : String(value)), 60)}`)
    }
    return parts.length === 0 ? undefined : clampText(parts.join(' '), DETAIL_MAX)
  }
  return clampText(scrubUrls(String(detail)), DETAIL_MAX)
}

/**
 * 创建一个有上限的内存错误日志。
 *
 * @param {{ limit?: number, now?: () => number }} [options] 注入项。
 * @returns {{
 *   record: (scope: string, error: unknown, detail?: unknown) => object,
 *   note: (scope: string, message: unknown, detail?: unknown) => object | null,
 *   list: () => { entries: Array<object>, dropped: number, limit: number, debug: boolean },
 *   clear: () => number,
 *   setDebug: (value: boolean) => boolean,
 *   isDebug: () => boolean,
 * }} 错误日志。
 */
export function createErrorLog(options = {}) {
  const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : LOG_LIMIT
  const now = typeof options.now === 'function' ? options.now : () => Date.now()

  /** @type {Array<object>} */
  let entries = []
  let dropped = 0
  let seq = 0
  let debug = false

  /**
   * 追加一条记录；debug 关闭时忽略 info 级。
   *
   * @param {'error' | 'info'} level 级别。
   * @param {string} scope 来源（如 `usage.read`）。
   * @param {string} message 主消息。
   * @param {string | undefined} detail 补充信息。
   * @param {string | undefined} stack 堆栈（仅 debug）。
   * @returns {object | null} 写入的记录。
   */
  function push(level, scope, message, detail, stack) {
    if (level === 'info' && !debug) return null
    seq += 1
    const entry = {
      seq,
      at: now(),
      level,
      scope: clampText(scrubUrls(scope), 40),
      message: clampText(scrubUrls(message), MESSAGE_MAX),
      ...(detail === undefined ? {} : { detail }),
      // 堆栈只在 debug 打开时附带：默认模式下日志要短到能一眼看完。
      ...(debug && stack !== undefined ? { stack } : {}),
    }
    entries = [...entries, entry]
    if (entries.length > limit) {
      const overflow = entries.length - limit
      entries = entries.slice(overflow)
      dropped += overflow
    }
    return entry
  }

  return {
    /**
     * 记一条错误。**总是**记录，不受 debug 开关影响。
     *
     * @param {string} scope 来源。
     * @param {unknown} error 错误值。
     * @param {unknown} [detail] 补充信息。
     * @returns {object} 写入的记录（可能因为超限而立刻被丢弃）。
     */
    record(scope, error, detail) {
      const info = describeError(error)
      const statusText = info.status === undefined ? undefined : `status=${info.status}`
      const merged = [statusText, describeDetail(detail)].filter((part) => part !== undefined).join(' ')
      return push('error', scope, info.message, merged === '' ? info.code : `${info.code} · ${merged}`, info.stack)
    },

    /**
     * 记一条「流程细节」，只在 debug 打开时生效。
     *
     * @param {string} scope 来源。
     * @param {unknown} message 文本。
     * @param {unknown} [detail] 补充信息。
     * @returns {object | null} 写入的记录；debug 关闭时为 null。
     */
    note(scope, message, detail) {
      return push('info', scope, typeof message === 'string' ? message : String(message ?? ''), describeDetail(detail), undefined)
    },

    /** 当前日志内容（拷贝，调用方改了不影响内部状态）。 */
    list() {
      return { entries: entries.map((entry) => ({ ...entry })), dropped, limit, debug }
    },

    /**
     * 清空日志。
     *
     * @returns {number} 清掉的条数。
     */
    clear() {
      const removed = entries.length
      entries = []
      dropped = 0
      return removed
    },

    /**
     * 设置 debug 开关。
     *
     * @param {unknown} value 新值。
     * @returns {boolean} 生效后的值。
     */
    setDebug(value) {
      debug = value === true
      return debug
    },

    /** 当前 debug 开关。 */
    isDebug() {
      return debug
    },
  }
}
