/**
 * 匿名人气统计：把「某人格被对话了多少轮」记到一个第三方整数计数器上。
 *
 * 设计边界（与 README「匿名统计」一节同源）：
 * - 只上报人格 id，不包含会话内容、机器标识、用户名、工作目录或任何提示词；
 * - 端点硬编码，不支持配置，避免把本机请求变成 SSRF 跳板；
 * - 禁止跟随重定向，只接受 HTTPS 与 JSON，响应体有大小上限；
 * - 所有网络失败都静默降级，绝不影响对话主流程；
 * - 限流、熔断与缓存全部在内存里，不写盘，不在本机留下统计痕迹。
 *
 * 计数来自 Abacus（`https://abacus.jasoncameron.dev`）：一个无需账号的公共
 * 整数计数器。它的键是可读的，因此计数只适合展示「热度」，不适合作为奖惩依据；
 * 数字可能被任何人刷高，也可能因为键六个月无人访问而过期归零。
 *
 * @module dsh-persona-modes/usage
 */

/** 计数服务根地址；硬编码，不接受配置覆盖。 */
export const USAGE_BASE_URL = 'https://abacus.jasoncameron.dev'

/** 计数命名空间；与 npm 包名一致，便于辨认归属。 */
export const USAGE_NAMESPACE = 'dsh-persona-modes'

/** 单次网络请求超时；统计慢不能拖住设置页。 */
export const USAGE_TIMEOUT_MS = 2_500

/** 读取结果的缓存时长；避免每次打开设置页都打一轮请求。 */
export const USAGE_CACHE_MS = 60 * 60 * 1_000

/** 部分成功的读取只缓存一小会儿：下次打开设置页能尽快补齐失败的那几个键。 */
export const USAGE_PARTIAL_CACHE_MS = 10 * 60 * 1_000

/** 响应体上限；正常响应只有几十字节，超过即视为异常。 */
export const USAGE_MAX_BODY = 64 * 1024

/** 本地令牌桶容量：与 Abacus 的 30 次/10 秒/IP 限流留出余量。 */
export const USAGE_BUCKET_CAPACITY = 20

/** 令牌桶窗口。 */
export const USAGE_BUCKET_WINDOW_MS = 10 * 1_000

/** 连续失败多少次后熔断。 */
export const USAGE_BREAKER_THRESHOLD = 3

/** 熔断时长；期间不再发请求，直接用缓存或静默隐藏。 */
export const USAGE_BREAKER_MS = 10 * 60 * 1_000

/** 单个人格显示上限；超过后前端显示为「99,999+」。 */
export const USAGE_MAX_COUNT = 99_999

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
 * 创建一个计数客户端。
 *
 * @param {{
 *   fetch?: typeof fetch,
 *   now?: () => number,
 *   enabled?: boolean,
 *   userAgent?: string,
 * }} [options] 注入项；测试用假 fetch 与假时钟，绝不访问真实服务。
 * @returns {{
 *   record: (id: string) => Promise<boolean>,
 *   read: (ids: string[]) => Promise<{ counts: Record<string, number>, at: number, partial: boolean } | null>,
 *   status: () => { enabled: boolean, cachedAt: number | null, breakerOpenUntil: number | null },
 * }} 计数客户端。
 */
export function createUsage(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  // 显式传入 enabled 时以调用方为准（测试常用）；没传时才看进程级开关。
  const enabled = options.enabled === undefined
    ? process.env.DSH_PERSONA_USAGE !== 'off'
    : options.enabled !== false
  const userAgent = typeof options.userAgent === 'string' && options.userAgent !== ''
    ? options.userAgent
    : 'dsh-persona-modes'

  let tokens = USAGE_BUCKET_CAPACITY
  let lastRefill = now()
  let failures = 0
  let openUntil = 0
  /** @type {{ counts: Record<string, number>, at: number, partial: boolean } | null} */
  let cache = null
  /** 同一时刻只允许一轮读取在飞，避免两个设置页同时打开时重复打第三方。 */
  let inflightRead = null

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
      return
    }
    failures += 1
    if (failures >= USAGE_BREAKER_THRESHOLD) {
      openUntil = time + USAGE_BREAKER_MS
      failures = 0
    }
  }

  /**
   * 请求一个 JSON 端点。
   *
   * @param {string} url 完整地址。
   * @param {{ notFoundOk?: boolean }} [settings] 是否把 404 当作合法结果。
   * @returns {Promise<any>} 解析后的 JSON；`notFoundOk` 下 404 返回 null。
   */
  async function requestJson(url, settings = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch-unavailable')
    const { signal, dispose } = timeoutSignal(USAGE_TIMEOUT_MS)
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
    if (now() < openUntil) return false
    if (!take(1)) return false
    try {
      const data = await requestJson(`${USAGE_BASE_URL}/hit/${USAGE_NAMESPACE}/${id}`)
      if (!isCount(data?.value)) throw new Error('invalid-count')
      failures = 0
      return true
    } catch (error) {
      noteFailure(typeof error?.status === 'number' ? error.status : 0)
      return false
    }
  }

  /**
   * 读取一批人格的累计轮次。
   *
   * 返回 null 表示「没有任何可展示的数据」；部分成功时 `partial` 为 true 且不写缓存，
   * 下次打开设置页会重试。
   *
   * @param {string[]} ids 人格 id 列表。
   * @returns {Promise<{ counts: Record<string, number>, at: number, partial: boolean } | null>} 读取结果。
   */
  async function read(ids) {
    if (!enabled) return null
    const wanted = [...new Set(Array.isArray(ids) ? ids : [])].filter(isCountableId)
    if (wanted.length === 0) return { counts: {}, at: now(), partial: false }

    const startedAt = now()
    if (cache !== null && startedAt - cache.at < (cache.partial ? USAGE_PARTIAL_CACHE_MS : USAGE_CACHE_MS)) {
      return { counts: { ...cache.counts }, at: cache.at, partial: cache.partial }
    }
    if (startedAt < openUntil) {
      return cache === null ? null : { counts: { ...cache.counts }, at: cache.at, partial: true }
    }
    if (inflightRead !== null) return inflightRead
    if (!take(wanted.length)) {
      return cache === null ? null : { counts: { ...cache.counts }, at: cache.at, partial: true }
    }

    const pending = (async () => {
      /** @type {Record<string, number>} */
      const counts = {}
      let ok = 0
      let failed = 0
      let limited = false

      await Promise.all(wanted.map(async (id) => {
        try {
          const data = await requestJson(
            `${USAGE_BASE_URL}/get/${USAGE_NAMESPACE}/${id}`,
            { notFoundOk: true },
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
          // Abacus 限流是 30 次/10 秒/IP：两次快速打开设置页就会撞上。
          // 撞上就退避一分钟，让窗口复位，而不是把失败当成数据。
          if (error?.status === 429) limited = true
        }
      }))

      if (ok === 0) {
        noteFailure(limited ? 429 : 0)
        return cache === null ? null : { counts: { ...cache.counts }, at: cache.at, partial: true }
      }

      if (limited) noteFailure(429)
      else failures = 0
      const result = { counts, at: now(), partial: failed > 0 }
      // 部分成功也缓存，但 TTL 更短：角标能立刻显示，失败的那几个键下次尽快补齐。
      cache = { counts: { ...counts }, at: result.at, partial: result.partial }
      return result
    })()

    inflightRead = pending
    try {
      return await pending
    } finally {
      if (inflightRead === pending) inflightRead = null
    }
  }

  /**
   * 只读状态，供测试与诊断使用。
   *
   * @returns {{ enabled: boolean, cachedAt: number | null, breakerOpenUntil: number | null }} 状态。
   */
  function status() {
    return {
      enabled,
      cachedAt: cache === null ? null : cache.at,
      breakerOpenUntil: openUntil > now() ? openUntil : null,
    }
  }

  return { record, read, status }
}