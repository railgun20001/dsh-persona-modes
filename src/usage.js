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
 *   journal?: { record: (scope: string, error: unknown, detail?: unknown) => unknown, note: (scope: string, message: unknown, detail?: unknown) => unknown },
 * }} [options] 注入项；测试用假 fetch、假时钟与假 sleep，绝不访问真实服务。
 *   `journal` 是调试日志：失败必须留下记录，成功与流程细节在调试打开时也记录。
 * @returns {{
 *   record: (id: string) => Promise<boolean>,
 *   read: (ids: string[], settings?: { refresh?: boolean }) => Promise<{ counts: Record<string, number>, at: number, partial: boolean } | null>,
 *   status: () => { enabled: boolean, cachedAt: number | null, breakerOpenUntil: number | null },
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
   * 读取一批人格的累计轮次。
   *
   * 返回 null 表示「没有任何可展示的数据」。结果按整全/部分分别写入
   * 长/短缓存；`settings.refresh === true`（手动点「刷新」）时跳过新鲜度
   * 检查，但熔断与令牌桶仍然生效。人格数量超过桶容量时自动分批限速，
   * 任意 10 秒窗口内的请求数不会超过桶容量，只是读得慢一些。
   *
   * @param {string[]} ids 人格 id 列表。
   * @param {{ refresh?: boolean }} [settings] 读取选项。
   * @returns {Promise<{ counts: Record<string, number>, at: number, partial: boolean } | null>} 读取结果。
   */
  async function read(ids, settings = {}) {
    if (!enabled) return null
    const wanted = [...new Set(Array.isArray(ids) ? ids : [])].filter(isCountableId)
    if (wanted.length === 0) return { counts: {}, at: now(), partial: false }

    const skipCache = settings?.refresh === true
    const startedAt = now()
    if (!skipCache && cache !== null && startedAt - cache.at < (cache.partial ? USAGE_PARTIAL_CACHE_MS : USAGE_CACHE_MS)) {
      return { counts: { ...cache.counts }, at: cache.at, partial: cache.partial }
    }
    if (startedAt < openUntil) {
      trace('usage.read', '熔断中，跳过读取', { waitMs: openUntil - startedAt })
      return cache === null ? null : { counts: { ...cache.counts }, at: cache.at, partial: true }
    }
    if (inflightRead !== null) return inflightRead

    const pending = (async () => {
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
        return cache === null ? null : { counts: { ...cache.counts }, at: cache.at, partial: true }
      }

      if (failed > 0) reportReadFailures(failuresList, ok, report)
      if (limited) noteFailure(429)
      else failures = 0
      const result = { counts, at: now(), partial: failed > 0 }
      trace('usage.read', '读取完成', { ok, failed, ids: wanted.length })
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