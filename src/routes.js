/**
 * 人格模式的宿主侧 HTTP 路由。
 *
 * 客户端半运行在 DSH 页面里，拿不到宿主进程的 Node 模块，因此设置页与斜杠命令
 * 都通过这几条同源路由读写状态。路由挂在 DSH 自己的 `webServer` 上，约定与仓库
 * 内其他插件一致：客户端使用**文档相对路径**（`dsh-persona-modes/state`），
 * 桌面端由 shell 同源转发，Web 端落在部署前缀下。
 *
 * 安全模型：只接受 POST，并要求一个自定义请求头。自定义头会让浏览器把跨站请求
 * 升级成预检请求，而本服务不返回任何 CORS 响应头，于是其他网页无法完成调用。
 * 这不是身份认证（本机回环上的其他程序仍可伪造头），但足以挡住浏览器 CSRF；
 * 本插件也只保存一个模式 id，不接触会话内容。
 *
 * @module dsh-persona-modes/routes
 */

import { buildModesView } from './modes.js'

/** 本插件的宿主侧标识；客户端探活时用它确认宿主半确实在。 */
export const PLUGIN_ID = 'dsh-persona-modes'

/** 路由前缀。 */
export const ROUTE_PATH = '/dsh-persona-modes'

/** 客户端必须携带的签名头。 */
export const ROUTE_HEADER = 'x-dsh-persona-modes'

/** 签名头的唯一合法值；没有语义，只用于等值判断。 */
export const ROUTE_HEADER_VALUE = '1'

/** 单次请求体上限：要容纳自定义人格的提示词，留 16 KB。 */
export const MAX_BODY_BYTES = 16_384

/**
 * 写一个 JSON 响应；连接已断开时静默忽略。
 *
 * @param {object} res node:http 响应。
 * @param {number} status HTTP 状态码。
 * @param {object} body 响应体。
 */
function respond(res, status, body) {
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  } catch {
    /* 连接已经断了 */
  }
}

/**
 * 判断请求是否带签名头。
 *
 * Node 会把重复的头合并成数组，所以两种形状都要认。
 *
 * @param {object} req node:http 请求。
 * @returns {boolean} 是否合法。
 */
function hasRouteHeader(req) {
  const headers = req?.headers
  if (headers === null || typeof headers !== 'object') return false
  const value = headers[ROUTE_HEADER]
  if (typeof value === 'string') return value === ROUTE_HEADER_VALUE
  return Array.isArray(value) && value.includes(ROUTE_HEADER_VALUE)
}

/**
 * 读取并解析 JSON 请求体。
 *
 * 返回 Promise 而不是回调：路由 handler 本身可以是同步函数，但读 body 必须等流结束。
 * 所有错误都归一成 `{ ok: false, reason }`，由调用方映射成 HTTP 状态。
 *
 * @param {object} req node:http 请求。
 * @param {number} [limit] 允许的最大字节数。
 * @returns {Promise<{ ok: true, value: object } | { ok: false, reason: string }>} 解析结果。
 */
export function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    let settled = false
    let size = 0
    const chunks = []

    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    req.on?.('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        // 不再缓冲，但也不立刻 destroy：直接断连接会让客户端收到 ECONNRESET，
        // 而不是约定的 JSON 错误。继续把剩余数据读掉，由上层返回 413。
        chunks.length = 0
        finish({ ok: false, reason: 'too-large' })
        return
      }
      chunks.push(chunk)
    })
    req.on?.('error', () => finish({ ok: false, reason: 'read-error' }))
    req.on?.('end', () => {
      if (settled) return
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        if (text.trim() === '') {
          finish({ ok: true, value: {} })
          return
        }
        const value = JSON.parse(text)
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          finish({ ok: false, reason: 'invalid-json' })
          return
        }
        finish({ ok: true, value })
      } catch {
        finish({ ok: false, reason: 'invalid-json' })
      }
    })
  })
}

/**
 * 生成完整状态视图。
 *
 * @param {object} store 模式存储。
 * @param {string} version 插件版本。
 * @returns {object} 客户端需要的全部数据。
 */
export function buildStatePayload(store, version) {
  const view = buildModesView(store.getActive(), store.snapshot())
  return {
    ok: true,
    host: PLUGIN_ID,
    version,
    active: view.active,
    intensity: view.intensity,
    modes: view.modes,
    customDefaults: view.customDefaults,
  }
}

/**
 * 创建路由处理器。
 *
 * 动作：
 * - `POST /dsh-persona-modes/ping`：宿主半探针（无副作用）；
 * - `POST /dsh-persona-modes/state`：读取当前模式、全部模式与自定义模板；
 * - `POST /dsh-persona-modes/select`：切换模式，body `{ "id": "catgirl" }`；
 * - `POST /dsh-persona-modes/intensity`：切换全局语气强度，body `{ "value": "low|medium|high" }`；
 * - `POST /dsh-persona-modes/save`：保存称呼/自称/提示词，带 `id` 改已有模式，不带 `id` 新建自定义；
 * - `POST /dsh-persona-modes/reset`：恢复默认值，body `{ "id": "catgirl" }`；
 * - `POST /dsh-persona-modes/delete`：删除自定义人格，body `{ "id": "custom-..." }`；
 * - `POST /dsh-persona-modes/debug`：只读诊断，返回本插件在组装结果里的段/上下文字数。
 *
 * @param {object} store 模式存储。
 * @param {{ version?: string }} [options] 版本信息。
 * @returns {(req: object, res: object) => void} node:http 处理器。
 */
export function createRouteHandler(store, options = {}) {
  const version = typeof options.version === 'string' && options.version !== '' ? options.version : 'unknown'

  return (req, res) => {
    const url = typeof req.url === 'string' ? req.url : ''
    const action = url.startsWith(`${ROUTE_PATH}/`)
      ? url.slice(ROUTE_PATH.length + 1).split('?')[0]
      : ''

    // 方法检查排在签名头之前：跨站预检（OPTIONS）应得到 405，而不是「缺签名头」。
    if (req.method !== 'POST') {
      respond(res, 405, { ok: false, error: 'method-not-allowed' })
      return
    }
    if (!hasRouteHeader(req)) {
      req.resume?.()
      respond(res, 403, { ok: false, error: 'forbidden' })
      return
    }

    if (action === 'ping') {
      req.resume?.()
      respond(res, 200, { ok: true, host: PLUGIN_ID, version })
      return
    }

    if (action === 'state') {
      req.resume?.()
      respond(res, 200, buildStatePayload(store, version))
      return
    }

    if (action === 'debug') {
      req.resume?.()
      Promise.resolve(options.diagnostics?.())
        .then((data) => respond(res, 200, { ok: true, ...(data ?? {}) }))
        .catch(() => respond(res, 500, { ok: false, error: 'diagnostics-failed' }))
      return
    }

    if (action === 'select') {
      void readJsonBody(req).then((parsed) => {
        if (!parsed.ok) {
          respond(res, parsed.reason === 'too-large' ? 413 : 400, { ok: false, error: parsed.reason })
          return
        }
        const result = store.setActive(parsed.value.id)
        if (result === null) {
          respond(res, 400, { ok: false, error: 'unknown-mode' })
          return
        }
        const payload = buildStatePayload(store, version)
        respond(res, 200, {
          ...payload,
          ...(result.persisted ? {} : { persisted: false }),
        })
      })
      return
    }

    if (action === 'intensity') {
      void readJsonBody(req).then((parsed) => {
        if (!parsed.ok) {
          respond(res, parsed.reason === 'too-large' ? 413 : 400, { ok: false, error: parsed.reason })
          return
        }
        const result = store.setIntensity(parsed.value.value)
        const payload = buildStatePayload(store, version)
        respond(res, 200, {
          ...payload,
          ...(result.persisted ? {} : { persisted: false }),
        })
      })
      return
    }

    if (action === 'save') {
      void readJsonBody(req).then((parsed) => {
        if (!parsed.ok) {
          respond(res, parsed.reason === 'too-large' ? 413 : 400, { ok: false, error: parsed.reason })
          return
        }
        const result = store.savePersona(parsed.value)
        if (result === null) {
          respond(res, 400, { ok: false, error: 'invalid-input' })
          return
        }
        const payload = buildStatePayload(store, version)
        respond(res, 200, {
          ...payload,
          saved: result,
          ...(result.persisted ? {} : { persisted: false }),
        })
      })
      return
    }

    if (action === 'reset') {
      void readJsonBody(req).then((parsed) => {
        if (!parsed.ok) {
          respond(res, parsed.reason === 'too-large' ? 413 : 400, { ok: false, error: parsed.reason })
          return
        }
        const result = store.resetPersona(parsed.value.id)
        if (result === null) {
          respond(res, 400, { ok: false, error: 'unknown-mode' })
          return
        }
        const payload = buildStatePayload(store, version)
        respond(res, 200, {
          ...payload,
          ...(result.persisted ? {} : { persisted: false }),
        })
      })
      return
    }

    if (action === 'delete') {
      void readJsonBody(req).then((parsed) => {
        if (!parsed.ok) {
          respond(res, parsed.reason === 'too-large' ? 413 : 400, { ok: false, error: parsed.reason })
          return
        }
        const result = store.deletePersona(parsed.value.id)
        if (result === null) {
          respond(res, 400, { ok: false, error: 'not-custom' })
          return
        }
        const payload = buildStatePayload(store, version)
        respond(res, 200, {
          ...payload,
          ...(result.persisted ? {} : { persisted: false }),
        })
      })
      return
    }

    req.resume?.()
    respond(res, 404, { ok: false, error: 'unknown-action' })
  }
}
