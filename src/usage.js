/**
 * 匿名人气统计：把「某人格被对话了多少轮」记到一个第三方整数计数器上。
 *
 * 设计边界（与 README「匿名统计」一节同源）：
 * - 只上报人格 id，不包含会话内容、机器标识、用户名、工作目录或任何提示词；
 * - 端点硬编码，不支持配置，避免把本机请求变成 SSRF 跳板；
 * - 禁止跟随重定向，只接受 HTTPS 与 JSON，响应体有大小上限；
 * - 所有网络失败都静默降级，绝不影响对话主流程；
 * - 限流、熔断在内存里；读取结果**可选落盘**到
 *   `~/.dsh/persona-modes/usage-cache.json`，只存内置人格 id、公开计数与时间戳，
 *   用于重启后仍能立刻显示角标；关闭「显示统计」时该文件会被立即删除。
 *   （2026-11-26 之前是纯内存缓存，不写盘；这是有意的边界变更，口径见 README。）
 *
 * 计数来自 Abacus（`https://abacus.jasoncameron.dev`）：一个无需账号的公共
 * 整数计数器。它的键是可读的，因此计数只适合展示「热度」，不适合作为奖惩依据；
 * 数字可能被任何人刷高，也可能因为键六个月无人访问而过期归零。
 *
 * @module dsh-persona-modes/usage
 */

import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { STATE_DIR, writeJsonFile } from './store.js'

/** 计数服务根地址；硬编码，不接受配置覆盖。 */
export const USAGE_BASE_URL = 'https://abacus.jasoncameron.dev'

/** 计数命名空间；与 npm 包名一致，便于辨认归属。 */
export const USAGE_NAMESPACE = 'dsh-persona-modes'

/**
 * 单次网络请求超时；逐轮上报在用（读取走 `USAGE_READ_TIMEOUT_MS`）。
 *
 * 走代理或经代理客户端隧道时，首个请求的握手常在 1–2 秒，此前 2.5 秒、4 秒
 * 都误伤过本来能成功的请求。2026-11-24 运行日志实测：走代理时 `/hit` 单键
 * 要 3.4 秒以上才回来，同一天还有两条「上报超时（超过 4 秒）」。上报是
 * fire-and-forget，不 await、不阻塞对话，超时放宽没有体验代价，因此与
 * 批量读取一致放到 8 秒，把骑在边界上的慢响应救回来。
 */
export const USAGE_TIMEOUT_MS = 8_000

/**
 * 批量读取用的超时。
 *
 * Abacus 无 SLA，降级时单键响应会拖到 3 秒以上（2026-11-23 实测：走代理
 * 2.9 秒、直连 4.3 秒，还夹着 HTTP 500）。读取最多一天一两次（结果缓存
 * 24 小时）且并发进行，多等几秒不拖体验。
 */
export const USAGE_READ_TIMEOUT_MS = 8_000

/** 读取结果的缓存时长：打开设置页默认只读缓存，过期或点「刷新」才再请求第三方。 */
export const USAGE_CACHE_MS = 24 * 60 * 60 * 1_000

/** 部分成功的读取缓存得短一些：失败的那几个键下次能尽快补齐。 */
export const USAGE_PARTIAL_CACHE_MS = 60 * 60 * 1_000

/**
 * 统计缓存的落盘文件。
 *
 * 与 `state.json` 同目录但**独立成文件**：`state.json` 装的是用户意图，写坏会丢
 * 设置；缓存是派生数据，丢了重读即可。两者失败后果不对等，不该同生共死。
 */
export const USAGE_CACHE_FILE = join(STATE_DIR, 'usage-cache.json')

/** 缓存文件格式版本；结构变化时靠它决定是否迁移或丢弃。 */
export const USAGE_CACHE_VERSION = 1

/**
 * 缓存文件里的条目上限。
 *
 * 正常只有十来个内置人格；文件可能被手改或写坏，读取时按上限截断，避免一个
 * 被塞大的文件把内存与渲染拖垮。
 */
export const USAGE_CACHE_MAX_ENTRIES = 64

/**
 * 时间戳容忍窗口：缓存里的 `at` 比「现在」还晚这么多，视为时钟回拨或文件被改。
 *
 * 不处理的话 `现在 - at` 会是负数，永远小于 TTL，缓存再也不会过期；这里把未来
 * 时间戳降级成「已过期」，数字仍先显示，但会立刻触发后台刷新校正。
 */
export const USAGE_CLOCK_SKEW_MS = 5 * 60 * 1_000

/** 单批最大请求数：人格再多也只是读得慢，任意 10 秒窗口内的请求数不超过桶容量。 */
export const USAGE_READ_CHUNK = 10

/** 响应体上限；正常响应只有几十字节，超过即视为异常。 */
export const USAGE_MAX_BODY = 64 * 1024

/** 本地令牌桶容量：与 Abacus 的 30 次/10 秒/IP 限流留出余量。 */
export const USAGE_BUCKET_CAPACITY = 20

/** 令牌桶窗口。 */
export const USAGE_BUCKET_WINDOW_MS = 10 * 1_000

/** 连续失败多少次后熔断。 */
export const USAGE_BREAKER_THRESHOLD = 3

/**
 * 熔断时长；期间不再发请求，直接用缓存或静默隐藏。
 *
 * 统计只是装饰性数据：熔断太久（比如十分钟）会让「统计暂时不可用」在页面上
 * 停留得比实际网络故障还久，用户反复点刷新也救不回来；一分钟足够让限流
 * 窗口复位，客户端还会按 `retryAfterMs` 自动重试。
 */
export const USAGE_BREAKER_MS = 60 * 1_000

/** 单个人格显示上限；超过后前端显示为「99,999+」。 */
export const USAGE_MAX_COUNT = 99_999

/** 统计端点的主机名；日志里只写主机，不带完整 URL。 */
export const USAGE_HOST = 'abacus.jasoncameron.dev'

/** 宿主侧可能与代理有关的进程环境变量名（只检查是否存在，从不读取值）。 */
const PROXY_ENV_NAMES = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY']

/** 合法的人格 id：只接受小写字母、数字与连字符。 */
const ID_PATTERN = /^[a-z][a-z0-9-]{2,31}$/u

/**
 * 判断一个 id 是否允许上报。
 *
 * `off` 不是人格，自定义人格（`custom-*`）也可能带用户私设信息，一律排除。
 *
 * @param {unknown} id 候选 id。
 * @returns {boolean} 是否可计数。
 */
export function isCountableId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return false
  return id !== 'off' && !id.startsWith('custom-')
}

/**
 * 判断返回值是否是一个可展示的计数。
 *
 * @param {unknown} value 候选值。
 * @returns {boolean} 是否合法。
 */
function isCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000
}

/**
 * 把磁盘上的缓存文件还原成内存缓存；形状不对就返回 null。
 *
 * 文件是「自己写的」，但仍然按**不可信输入**校验：它可能被手改、被旧版本写坏，
 * 或者来自另一个进程。只接受内置人格 id 与正整数计数，未知键与坏值直接丢弃；
 * 未来时间戳降级成已过期，避免时钟回拨让缓存永不刷新。
 *
 * @param {unknown} data 解析后的文件内容。
 * @param {number} time 当前时间毫秒。
 * @returns {{ counts: Record<string, number>, at: number, partial: boolean } | null} 还原结果。
 */
export function restoreCache(data, time) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  if (data.version !== USAGE_CACHE_VERSION) return null
  const at = data.at
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return null
  const source = data.counts
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return null
  /** @type {Record<string, number>} */
  const counts = {}
  let kept = 0
  for (const [id, value] of Object.entries(source)) {
    if (kept >= USAGE_CACHE_MAX_ENTRIES) break
    if (!isCountableId(id) || !isCount(value) || value <= 0) continue
    counts[id] = value
    kept += 1
  }
  return {
    counts,
    // 未来时间戳不拒绝：数字仍值得先显示，但按「已过期」处理，立刻走后台刷新。
    at: at > time + USAGE_CLOCK_SKEW_MS ? 0 : at,
    partial: data.partial === true,
  }
}

/**
 * 造一个带超时的信号。
 *
 * 优先用 `AbortSignal.timeout`；没有时退回 `AbortController` + 定时器。
 *
 * @param {number} ms 超时毫秒数。
 * @returns {{ signal: AbortSignal | undefined, dispose: () => void }} 信号与清理函数。
 */
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms), dispose() {} }
  }
  if (typeof AbortController === 'function') {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    if (typeof timer?.unref === 'function') timer.unref()
    return {
      signal: controller.signal,
      dispose() {
        clearTimeout(timer)
      },
    }
  }
  return { signal: undefined, dispose() {} }
}

/**
 * 判断一个错误是不是「请求超时」。
 *
 * undici 的超时以 `TimeoutError` 抛出，手动中止是 `AbortError`；统计路径没有
 * 手动中止，两者都按超时处理。超时的原因（第三方变慢、没走代理）与处理建议
 * 都依赖这个判断，给它一个统一的出口。
 *
 * @param {unknown} error 错误值。
 * @returns {boolean} 是否超时。
 */
export function isTimeoutError(error) {
  return error !== null && typeof error === 'object'
    && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

/**
 * 把一次读取里的失败汇总成尽量少的日志条目。
 *
 * 15 个键同时超时会一次产出 15 条一模一样的记录，把 50 条的上限瞬间吃掉；
 * 这里按「一个键失败就记细节，多个键失败就记一条汇总 + 样本 id」处理。
 * 全部超时的主消息带上超时阈值（读日志的人第一反应是「超时是多少秒」），
 * 成因猜测只进 hint：第三方变慢与代理问题在面板上无法区分，别把猜测当结论。
 *
 * @param {Array<{ id: string, error: unknown }>} list 失败明细。
 * @param {number} ok 成功的条数。
 * @param {(scope: string, error: unknown, detail?: unknown) => void} record 写日志的函数（createUsage 内部的 report）。
 */
function reportReadFailures(list, ok, record) {
  if (list.length === 0) return
  // 超时的原始错误是 undici 英文长句；两个分支都换成带阈值的中文文案。
  if (list.length === 1) {
    const [first] = list
    if (isTimeoutError(first.error)) {
      record('usage.read', `单个人格数据读取超时（超过 ${USAGE_READ_TIMEOUT_MS / 1_000} 秒）`, { id: first.id, host: USAGE_HOST })
    } else {
      record('usage.read', first.error, { id: first.id, host: USAGE_HOST })
    }
    return
  }
  const codes = [...new Set(list.map((item) => {
    const itemError = item.error
    if (typeof itemError?.name === 'string' && itemError.name !== '') return itemError.name
    if (typeof itemError?.code === 'string' && itemError.code !== '') return itemError.code
    return 'error'
  }))]
  const sample = list.slice(0, 3).map((item) => item.id).join(',')
  const allTimeout = list.every((item) => isTimeoutError(item.error))
  const message = allTimeout
    ? `${list.length} 个人格数据读取超时（超过 ${USAGE_READ_TIMEOUT_MS / 1_000} 秒）`
    : `${list.length} 个人格数据读取失败（${codes.join('/')}）`
  // 只报告「有没有配代理」，不读代理的具体值：日志不该带凭据。
  const proxyConfigured = typeof process !== 'undefined'
    && process.env !== undefined
    && PROXY_ENV_NAMES.some((name) => typeof process.env[name] === 'string' && process.env[name] !== '')
  record('usage.read', message, {
    failed: list.length,
    ok,
    sample,
    host: USAGE_HOST,
    ...(allTimeout
      ? {
        hint: proxyConfigured
          ? '已走代理仍超时：第三方可能变慢，或代理出口异常'
          : '未配置 https_proxy，重启 DSH 后生效',
      }
      : {}),
  })
}

/**
 * 创建一个计数客户端。
 * @param {{
 *   fetch?: typeof fetch,
 *   now?: () => number,
 *   enabled?: boolean,
 *   userAgent?: string,
 *   sleep?: (ms: number) => Promise<void>,
 *   file?: string | null,
 *   persist?: () => boolean,
 *   journal?: { record: (scope: string, error: unknown, detail?: unknown) => unknown, note: (scope: string, message: unknown, detail?: unknown) => unknown },
 * }} [options] 注入项；测试用假 fetch、假时钟与假 sleep，绝不访问真实服务。
 *   `journal` 是调试日志：失败必须留下记录，成功与流程细节在调试打开时也记录。
 *   `file` 是本地缓存路径，**默认 null（纯内存）**：单测不传就不会碰用户的
 *   `~/.dsh`；宿主半传 `USAGE_CACHE_FILE` 才启用落盘。`persist` 是动态开关，
 *   默认恒真，宿主半用它跟随「显示统计」——关闭时既不读也不写。
 * @returns {{
 *   record: (id: string) => Promise<boolean>,
 *   read: (ids: string[], settings?: { refresh?: boolean }) => Promise<{ counts: Record<string, number>, at: number, partial: boolean, stale: boolean, refreshing: boolean } | null>,
 *   discard: () => void,
 *   status: () => { enabled: boolean, cachedAt: number | null, breakerOpenUntil: number | null, refreshing: boolean },
 * }} 计数客户端。
 */
export function createUsage(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const journal = options.journal ?? null
  // 显式传入 enabled 时以调用方为准（测试常用）；没传时才看进程级开关。
  const enabled = options.enabled === undefined
    ? process.env.DSH_PERSONA_USAGE !== 'off'
    : options.enabled !== false
  // 缓存文件：默认不落盘，由宿主半显式传入路径；测试天然隔离。
  const file = typeof options.file === 'string' && options.file !== '' ? options.file : null
  // 动态持久化开关：宿主半用它跟随「显示统计」；关闭时连读盘都不做。
  const canPersist = typeof options.persist === 'function' ? options.persist : () => true
  const userAgent = typeof options.userAgent === 'string' && options.userAgent !== ''
    ? options.userAgent
    : 'dsh-persona-modes'
  // 分批限速的等待函数；测试注入假实现并拨动假时钟。
  const sleep = typeof options.sleep === 'function'
    ? options.sleep
    : (ms) => new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        if (typeof timer?.unref === 'function') timer.unref()
      })

  /**
   * 记一条错误到运行日志；日志本身不可用时也不能反过来抛错。
   *
   * @param {string} scope 来源。
   * @param {unknown} error 错误值。
   * @param {unknown} [detail] 补充信息。
   */
  function report(scope, error, detail) {
    try {
      journal?.record?.(scope, error, detail)
    } catch {
      /* 日志只是辅助，不能影响计数 */
    }
  }

  /**
   * 记一条流程细节（仅 debug 打开时保留）。
   *
   * @param {string} scope 来源。
   * @param {unknown} message 文本。
   * @param {unknown} [detail] 补充信息。
   */
  function trace(scope, message, detail) {
    try {
      journal?.note?.(scope, message, detail)
    } catch {
      /* 同上 */
    }
  }

  let tokens = USAGE_BUCKET_CAPACITY
  let lastRefill = now()
  let failures = 0
  let openUntil = 0
  /** @type {{ counts: Record<string, number>, at: number, partial: boolean } | null} */
  let cache = null
  /** 同一时刻只允许一轮读取在飞，避免两个设置页同时打开时重复打第三方。 */
  let inflightRead = null
  /** 是否已经尝试过从磁盘恢复；只读一次，避免每次读取都摸盘。 */
  let cacheLoaded = false
  /** 写盘失败只记一条日志；成功后复位，下次再坏还能再记。 */
  let persistWarned = false

  /**
   * 从磁盘恢复缓存；只做一次，失败一律静默降级。
   *
   * 关闭「显示统计」时不读盘：用户关掉之后，本机不该再因为统计去碰文件。
   * 文件损坏（JSON 不合法）只记流程日志；读文件本身的 I/O 错误才记错误日志。
   */
  function loadCache() {
    if (cacheLoaded) return
    cacheLoaded = true
    if (file === null || !canPersist()) return
    let raw = ''
    try {
      raw = readFileSync(file, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') report('usage.cache', '本地统计缓存读取失败', { code: error?.code ?? null })
      return
    }
    let parsed = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      trace('usage.cache', '本地统计缓存不是合法 JSON，已忽略')
      return
    }
    const restored = restoreCache(parsed, now())
    if (restored === null) {
      trace('usage.cache', '本地统计缓存形状不符，已忽略')
      return
    }
    cache = restored
    trace('usage.cache', '已恢复本地统计缓存', {
      at: restored.at,
      partial: restored.partial,
      ids: Object.keys(restored.counts).length,
    })
  }

  /**
   * 把内存缓存原子写回磁盘；关闭「显示统计」时跳过。
   *
   * 只在第三方读取成功后调用：一天最多几次，不需要节流。写失败不影响本次
   * 显示，只记一条日志（不刷屏），下次读取成功会重试写入。
   */
  function persistCache() {
    if (file === null || cache === null || !canPersist()) return
    const payload = {
      version: USAGE_CACHE_VERSION,
      at: cache.at,
      partial: cache.partial,
      counts: { ...cache.counts },
    }
    if (writeJsonFile(file, payload)) {
      persistWarned = false
      return
    }
    if (!persistWarned) {
      persistWarned = true
      report('usage.cache', '本地统计缓存写入失败', {})
    }
  }

  /**
   * 丢弃缓存：清掉内存并删除文件。
   *
   * 关闭「显示统计」时调用——既然不再显示，本机就不该留着统计痕迹。删除失败
   * （只读目录等）只记日志；标记 `cacheLoaded` 让后续读取不再从文件恢复。
   */
  function discard() {
    cache = null
    cacheLoaded = true
    persistWarned = false
    if (file === null) return
    try {
      unlinkSync(file)
    } catch (error) {
      if (error?.code !== 'ENOENT') report('usage.cache', '本地统计缓存删除失败', { code: error?.code ?? null })
    }
  }

  /**
   * 按时间补充令牌。
   *
   * @param {number} time 当前时间。
   */
  function refill(time) {
    const elapsed = time - lastRefill
    if (elapsed <= 0) return
    tokens = Math.min(
      USAGE_BUCKET_CAPACITY,
      tokens + (elapsed / USAGE_BUCKET_WINDOW_MS) * USAGE_BUCKET_CAPACITY,
    )
    lastRefill = time
  }

  /**
   * 尝试取走若干令牌。
   *
   * @param {number} count 需要几个。
   * @returns {boolean} 是否取到。
   */
  function take(count) {
    const time = now()
    refill(time)
    if (tokens < count) return false
    tokens -= count
    return true
  }

  /**
   * 记一次失败；429 只短暂退避，其他错误累计到阈值后熔断。
   *
   * @param {number} [status] HTTP 状态码。
   */
  function noteFailure(status) {
    const time = now()
    if (status === 429) {
      openUntil = Math.max(openUntil, time + 60 * 1_000)
      failures = 0
      trace('usage.breaker', '触发 429 退避 60 秒')
      return
    }
    failures += 1
    if (failures >= USAGE_BREAKER_THRESHOLD) {
      openUntil = time + USAGE_BREAKER_MS
      failures = 0
      trace('usage.breaker', `连续失败 ${USAGE_BREAKER_THRESHOLD} 次，熔断 ${Math.round(USAGE_BREAKER_MS / 1_000)} 秒`)
    }
  }

  /**
   * 请求一个 JSON 端点。
   *
   * @param {string} url 完整地址。
   * @param {{ notFoundOk?: boolean, timeoutMs?: number }} [settings]
   *   `notFoundOk`：把 404 当作合法结果；`timeoutMs`：本次请求超时，缺省用上报超时。
   * @returns {Promise<any>} 解析后的 JSON；`notFoundOk` 下 404 返回 null。
   */
  async function requestJson(url, settings = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch-unavailable')
    const { signal, dispose } = timeoutSignal(settings.timeoutMs ?? USAGE_TIMEOUT_MS)
    let response
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          accept: 'application/json',
          'user-agent': userAgent,
        },
        ...(signal === undefined ? {} : { signal }),
      })
    } finally {
      dispose()
    }

    if (response.status === 404 && settings.notFoundOk === true) return null

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`)
      // 只带状态码，不把响应正文拼进错误，避免把第三方文本带进日志。
      error.status = response.status
      throw error
    }

    const length = Number(response.headers?.get?.('content-length') ?? 0)
    if (Number.isFinite(length) && length > USAGE_MAX_BODY) throw new Error('response-too-large')
    const text = await response.text()
    if (text.length > USAGE_MAX_BODY) throw new Error('response-too-large')
    return JSON.parse(text)
  }

  /**
   * 给一个人格记一轮对话。
   *
   * 这是 fire-and-forget 语义：失败返回 false，不抛错。调用方不需要 await。
   *
   * @param {string} id 人格 id。
   * @returns {Promise<boolean>} 是否成功记上。
   */
  async function record(id) {
    if (!enabled || !isCountableId(id)) return false
    if (now() < openUntil) {
      trace('usage.record', '熔断中，跳过上报', { id })
      return false
    }
    if (!take(1)) {
      trace('usage.record', '本地令牌桶已空，跳过上报', { id })
      return false
    }
    try {
      const data = await requestJson(`${USAGE_BASE_URL}/hit/${USAGE_NAMESPACE}/${id}`)
      if (!isCount(data?.value)) throw new Error('invalid-count')
      failures = 0
      trace('usage.record', '上报成功', { id, value: data?.value })
      return true
    } catch (error) {
      // 上报失败过去是静默的；现在留一条记录，便于在设置页底部查看。
      // 超时是最常见的失败，原始错误是英文长句，换成带阈值的中文文案更好读。
      if (isTimeoutError(error)) {
        report('usage.record', `上报超时（超过 ${USAGE_TIMEOUT_MS / 1_000} 秒）`, { id, host: USAGE_HOST })
      } else {
        report('usage.record', error, { id, host: USAGE_HOST })
      }
      noteFailure(typeof error?.status === 'number' ? error.status : 0)
      return false
    }
  }

  /**
   * 判断缓存是否仍然新鲜；未来时间戳（时钟回拨）一律算过期。
   *
   * @param {{ at: number, partial: boolean }} entry 缓存条目。
   * @param {number} time 当前时间。
   * @returns {boolean} 是否命中新鲜度。
   */
  function isFresh(entry, time) {
    const age = time - entry.at
    return age >= 0 && age < (entry.partial ? USAGE_PARTIAL_CACHE_MS : USAGE_CACHE_MS)
  }

  /**
   * 把缓存条目包装成一次读取结果。
   *
   * 每次返回新对象与新 counts：调用方（含客户端）不该拿到内部引用。
   *
   * @param {{ counts: Record<string, number>, at: number, partial: boolean }} entry 缓存或新结果。
   * @returns {{ counts: Record<string, number>, at: number, partial: boolean, stale: boolean, refreshing: boolean }} 读取结果。
   */
  function snapshot(entry) {
    return {
      counts: { ...entry.counts },
      at: entry.at,
      partial: entry.partial,
      stale: false,
      refreshing: false,
    }
  }

  /**
   * 读取一批人格的累计轮次。
   *
   * 返回 null 表示「没有任何可展示的数据」。缓存分两层：内存 + 可选磁盘；
   * 新鲜就直接返回。**过期但仍有旧数字**时先回旧值（`stale: true`），同时
   * 在后台补新值——重启后第一次进入设置页也能立刻看到角标，不必等第三方。
   * `settings.refresh === true`（手动点「刷新」）跳过缓存与 SWR，强制等待新值。
   *
   * 失败不清空已有数据：整批失败时沿用旧缓存；部分失败时失败的那几个键
   * 沿用上一次的旧计数（`partial` 置真、缓存按短 TTL 尽快补齐）。键在
   * 第三方真实不存在（404）不算失败，不会被旧值复活。
   *
   * @param {string[]} ids 人格 id 列表。
   * @param {{ refresh?: boolean }} [settings] 读取选项。
   * @returns {Promise<{ counts: Record<string, number>, at: number, partial: boolean, stale: boolean, refreshing: boolean } | null>} 读取结果。
   */
  async function read(ids, settings = {}) {
    if (!enabled) return null
    const wanted = [...new Set(Array.isArray(ids) ? ids : [])].filter(isCountableId)
    if (wanted.length === 0) return snapshot({ counts: {}, at: now(), partial: false })

    loadCache()
    const skipCache = settings?.refresh === true
    const startedAt = now()
    if (!skipCache && cache !== null && isFresh(cache, startedAt)) return snapshot(cache)

    if (startedAt < openUntil) {
      trace('usage.read', '熔断中，跳过读取', { waitMs: openUntil - startedAt })
      return cache === null ? null : { ...snapshot(cache), partial: true, stale: true }
    }
    if (inflightRead !== null) return inflightRead

    // 有旧缓存但已过期（常见于宿主刚重启）：先把旧数字交给页面，后台再校正。
    // 手动刷新不走这条路——用户点「刷新」就是要等真值。
    if (cache !== null && !skipCache) {
      void startRefresh(wanted, false)
      return { ...snapshot(cache), stale: true, refreshing: true }
    }

    return startRefresh(wanted, skipCache)
  }

  /**
   * 启动一轮真实读取，并登记为在飞任务。
   *
   * 后台刷新（SWR）也走这里：调用方不 await，结果只用于更新缓存。内部的错误
   * 已全部降级处理；这里再挂一个空处理器，避免后台 promise 变成未捕获拒绝。
   *
   * @param {string[]} wanted 已过滤的 id。
   * @param {boolean} manual 是否手动刷新（跳过缓存）。
   * @returns {Promise<{ counts: Record<string, number>, at: number, partial: boolean, stale: boolean, refreshing: boolean } | null>} 读取结果。
   */
  function startRefresh(wanted, manual) {
    const pending = (async () => {
      // 读取的结论（成功/失败）要等批请求全部结束才落笔，慢时每批要等满
      // 8 秒超时；先留一条开始痕迹，日志面板才不会在这段真空期里显得
      // 「点了刷新却什么都没发生」。
      trace('usage.read', '开始读取', { ids: wanted.length, refresh: manual })
      /** @type {Record<string, number>} */
      const counts = {}
      let ok = 0
      let failed = 0
      let limited = false
      /** @type {Array<{ id: string, error: unknown }>} */
      const failuresList = []

      const fetchOne = async (id) => {
        try {
          const data = await requestJson(
            `${USAGE_BASE_URL}/get/${USAGE_NAMESPACE}/${id}`,
            { notFoundOk: true, timeoutMs: USAGE_READ_TIMEOUT_MS },
          )
          // 键还没被创建时返回 null：视为 0，不展示。
          if (data === null) {
            ok += 1
            return
          }
          if (!isCount(data?.value)) throw new Error('invalid-count')
          counts[id] = data.value
          ok += 1
        } catch (error) {
          failed += 1
          failuresList.push({ id, error })
          // Abacus 限流是 30 次/10 秒/IP：两次快速打开设置页就会撞上。
          // 撞上就退避一分钟，让窗口复位，而不是把失败当成数据。
          if (error?.status === 429) limited = true
        }
      }

      // 分批限速：单批不超过 USAGE_READ_CHUNK 与当前令牌数，批间按桶的
      // 恢复速率等待。人格再多也只是把读取时间拉长，而不是打爆第三方限流。
      const queue = wanted.slice()
      while (queue.length > 0) {
        refill(now())
        const size = Math.min(queue.length, USAGE_READ_CHUNK, Math.max(1, Math.floor(tokens)))
        if (!take(size)) {
          // 理论上不会走到这里（size 已按当前令牌数收缩）；兜底等一个令牌再试。
          await sleep(USAGE_BUCKET_WINDOW_MS / USAGE_BUCKET_CAPACITY)
          continue
        }
        const batch = queue.splice(0, size)
        await Promise.all(batch.map(fetchOne))
        if (queue.length === 0) break
        const want = Math.min(queue.length, USAGE_READ_CHUNK)
        const deficit = want - tokens
        if (deficit > 0) {
          await sleep(Math.ceil(deficit * (USAGE_BUCKET_WINDOW_MS / USAGE_BUCKET_CAPACITY)))
        }
      }

      if (ok === 0) {
        noteFailure(limited ? 429 : 0)
        reportReadFailures(failuresList, 0, report)
        return cache === null
          ? null
          : { ...snapshot(cache), partial: true, stale: true, refreshing: false }
      }

      if (failed > 0) reportReadFailures(failuresList, ok, report)
      if (limited) noteFailure(429)
      else failures = 0
      // 失败的键沿用上一次的旧计数：超时/失败只说明「这次没读到」，不代表
      // 热度消失，把旧值丢掉会让角标凭空消失、被误读成「没人用过」。
      // 404（键在第三方真实不存在）不进失败列表，不会被旧值复活。
      const stale = {}
      if (failed > 0 && cache !== null) {
        for (const item of failuresList) {
          const previous = cache.counts[item.id]
          if (typeof previous === 'number') stale[item.id] = previous
        }
      }
      const merged = { ...stale, ...counts }
      const result = { counts: merged, at: now(), partial: failed > 0 }
      trace('usage.read', '读取完成', {
        ok,
        failed,
        ...(failed > 0 ? { stale: Object.keys(stale).length } : {}),
        ids: wanted.length,
      })
      // 部分成功也缓存（失败键的旧值已并入），但 TTL 更短：角标全部保留，
      // 失败的那几个键下次尽快用真值补齐。成功即写盘，重启后仍能立刻显示。
      cache = { counts: { ...merged }, at: result.at, partial: result.partial }
      persistCache()
      return { ...result, stale: false, refreshing: false }
    })()
    inflightRead = pending
    const settle = () => {
      if (inflightRead === pending) inflightRead = null
    }
    pending.then(settle, settle)
    return pending
  }

  /**
   * 只读状态，供测试与诊断使用。
   *
   * @returns {{ enabled: boolean, cachedAt: number | null, breakerOpenUntil: number | null, refreshing: boolean }} 状态。
   */
  function status() {
    return {
      enabled,
      cachedAt: cache === null ? null : cache.at,
      breakerOpenUntil: openUntil > now() ? openUntil : null,
      // 后台刷新是否在飞：客户端据此决定要不要短延迟再取一次。
      refreshing: inflightRead !== null,
    }
  }

  return { record, read, discard, status }
}