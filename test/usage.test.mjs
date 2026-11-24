/**
 * 匿名计数客户端测试。
 *
 * 全部使用注入的假 fetch 与假时钟：不访问 Abacus，也不创建任何真实计数键。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createUsage,
  isCountableId,
  USAGE_BASE_URL,
  USAGE_BREAKER_MS,
  USAGE_BUCKET_CAPACITY,
  USAGE_BUCKET_WINDOW_MS,
  USAGE_CACHE_MS,
  USAGE_MAX_BODY,
  USAGE_NAMESPACE,
  USAGE_PARTIAL_CACHE_MS,
  USAGE_READ_TIMEOUT_MS,
  USAGE_TIMEOUT_MS,
} from '../src/usage.js'

/**
 * 造一个 JSON 响应。
 *
 * @param {unknown} body 响应体。
 * @param {number} [status] 状态码。
 * @returns {object} Response 形状的桩。
 */
function jsonResponse(body, status = 200) {
  const text = JSON.stringify(body)
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return name === 'content-length' ? String(Buffer.byteLength(text)) : null
      },
    },
    text: async () => text,
  }
}

/**
 * 记录请求并给出固定响应的假 fetch。
 *
 * @param {(url: string) => object} responder 响应生成器。
 * @returns {{ calls: Array<{ url: string, init: object }>, fetch: Function }} 调用记录与 fetch。
 */
function fakeFetch(responder) {
  const calls = []
  return {
    calls,
    async fetch(url, init) {
      calls.push({ url, init })
      return responder(url)
    },
  }
}

/**
 * 造一个可拨动的时钟。
 *
 * @param {number} [start] 初始毫秒。
 * @returns {{ now: () => number, advance: (ms: number) => void }} 时钟。
 */
function clock(start = 1_000) {
  let value = start
  return {
    now: () => value,
    advance(ms) {
      value += ms
    },
  }
}

test('isCountableId 只接受内置人格 id', () => {
  assert.equal(isCountableId('catgirl'), true)
  assert.equal(isCountableId('off'), false)
  assert.equal(isCountableId('custom-abc'), false)
  assert.equal(isCountableId('Catgirl'), false)
  assert.equal(isCountableId('../etc'), false)
  assert.equal(isCountableId(''), false)
  assert.equal(isCountableId(null), false)
})

test('record 只发人格 id，且带超时、禁重定向、无凭据', async () => {
  const time = clock()
  const fake = fakeFetch(() => jsonResponse({ value: 7 }))
  const usage = createUsage({ fetch: fake.fetch, now: time.now, enabled: true })

  assert.equal(await usage.record('catgirl'), true)
  assert.equal(fake.calls.length, 1)
  const [call] = fake.calls
  assert.equal(call.url, `${USAGE_BASE_URL}/hit/${USAGE_NAMESPACE}/catgirl`)
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.redirect, 'error')
  assert.equal(call.init.credentials, 'omit')
  assert.equal(call.init.cache, 'no-store')
  assert.ok(call.init.signal !== undefined)
  assert.equal(call.init.headers['user-agent'], 'dsh-persona-modes')
})

test('record 对非法 id 不发请求', async () => {
  const fake = fakeFetch(() => jsonResponse({ value: 1 }))
  const usage = createUsage({ fetch: fake.fetch, enabled: true })

  assert.equal(await usage.record('off'), false)
  assert.equal(await usage.record('custom-x'), false)
  assert.equal(await usage.record('not valid'), false)
  assert.equal(fake.calls.length, 0)
})

test('record 失败只返回 false，不抛错', async () => {
  const usage = createUsage({
    fetch: async () => {
      throw new Error('network down')
    },
    enabled: true,
  })
  assert.equal(await usage.record('catgirl'), false)
})

test('非法计数被当作失败', async () => {
  const fake = fakeFetch(() => jsonResponse({ value: -3 }))
  const usage = createUsage({ fetch: fake.fetch, enabled: true })
  assert.equal(await usage.record('catgirl'), false)
})

test('本地令牌桶限制突发请求', async () => {
  const time = clock()
  const fake = fakeFetch(() => jsonResponse({ value: 1 }))
  const usage = createUsage({ fetch: fake.fetch, now: time.now, enabled: true })

  for (let index = 0; index < 25; index += 1) {
    await usage.record('catgirl')
  }
  assert.equal(fake.calls.length, 20)
})

test('连续失败后熔断，时间过去后恢复', async () => {
  const time = clock()
  let fail = true
  const fake = fakeFetch(() => (fail ? jsonResponse({ error: 'boom' }, 500) : jsonResponse({ value: 1 })))
  const usage = createUsage({ fetch: fake.fetch, now: time.now, enabled: true })

  for (let index = 0; index < 3; index += 1) {
    await usage.record('catgirl')
  }
  assert.equal(fake.calls.length, 3)
  assert.equal(await usage.record('catgirl'), false)
  assert.equal(fake.calls.length, 3, '熔断期间不应再发请求')

  fail = false
  time.advance(USAGE_BREAKER_MS + 1)
  assert.equal(await usage.record('catgirl'), true)
  assert.equal(fake.calls.length, 4)
})

test('enabled=false 时 record/read 完全不出网', async () => {
  const fake = fakeFetch(() => jsonResponse({ value: 1 }))
  const usage = createUsage({ fetch: fake.fetch, enabled: false })
  assert.equal(await usage.record('catgirl'), false)
  assert.equal(await usage.read(['catgirl']), null)
  assert.equal(fake.calls.length, 0)
})

test('read 汇总计数并写长缓存', async () => {
  const time = clock()
  const fake = fakeFetch((url) => {
    if (url.endsWith('/catgirl')) return jsonResponse({ value: 12 })
    return jsonResponse({ value: 34 })
  })
  const usage = createUsage({ fetch: fake.fetch, now: time.now, enabled: true })

  const first = await usage.read(['catgirl', 'mom'])
  assert.deepEqual(first.counts, { catgirl: 12, mom: 34 })
  assert.equal(first.partial, false)
  assert.equal(fake.calls.length, 2)

  const second = await usage.read(['catgirl', 'mom'])
  assert.deepEqual(second.counts, { catgirl: 12, mom: 34 })
  assert.equal(fake.calls.length, 2, '缓存期内不应重复请求')

  time.advance(USAGE_CACHE_MS + 1)
  await usage.read(['catgirl', 'mom'])
  assert.equal(fake.calls.length, 4)
})

test('refresh=true 跳过新鲜度检查，直接重新读取', async () => {
  const time = clock()
  let calls = 0
  const fake = fakeFetch(() => {
    calls += 1
    return jsonResponse({ value: 7 })
  })
  const usage = createUsage({ fetch: fake.fetch, now: time.now, enabled: true })

  await usage.read(['catgirl'])
  assert.equal(calls, 1)

  const cached = await usage.read(['catgirl'])
  assert.equal(calls, 1, '无 refresh 时命中缓存')

  const fresh = await usage.read(['catgirl'], { refresh: true })
  assert.equal(calls, 2, 'refresh 应绕过缓存')
  assert.deepEqual(fresh.counts, { catgirl: 7 })
  assert.equal(fresh.partial, false)
})

test('人格多于桶容量时自动分批限速，而不是整批放弃', async () => {
  const time = clock()
  /** @type {number[]} */
  const sleeps = []
  const fake = fakeFetch(() => jsonResponse({ value: 1 }))
  const usage = createUsage({
    fetch: fake.fetch,
    now: time.now,
    enabled: true,
    sleep: async (ms) => {
      sleeps.push(ms)
      time.advance(ms)
    },
  })
  const ids = Array.from({ length: USAGE_BUCKET_CAPACITY + 5 }, (_, index) => `persona-${index}`)

  const result = await usage.read(ids)
  assert.notEqual(result, null)
  assert.equal(result.partial, false)
  assert.equal(fake.calls.length, ids.length)
  // 20 个令牌先发前两批（10+10），剩下的 5 个按恢复速率等一次令牌再发：
  // 恢复速率 = 窗口/容量 = 500 毫秒/个，等待应不少于 2500 毫秒。
  assert.equal(sleeps.length, 1)
  assert.ok(sleeps[0] >= 5 * (USAGE_BUCKET_WINDOW_MS / USAGE_BUCKET_CAPACITY), '批间等待应按恢复速率计算')
})

test('read 把 404 当作「还没有计数」跳过', async () => {
  const fake = fakeFetch(() => jsonResponse({ error: 'Key not found' }, 404))
  const usage = createUsage({ fetch: fake.fetch, enabled: true })
  const result = await usage.read(['catgirl'])
  assert.deepEqual(result.counts, {})
  assert.equal(result.partial, false)
})

test('read 部分失败标 partial，结果按短 TTL 缓存', async () => {
  const time = clock()
  let calls = 0
  const fake = fakeFetch((url) => {
    calls += 1
    if (url.endsWith('/mom')) return jsonResponse({ error: 'boom' }, 500)
    return jsonResponse({ value: 5 })
  })
  const usage = createUsage({ fetch: fake.fetch, now: time.now, enabled: true })

  const first = await usage.read(['catgirl', 'mom'])
  assert.deepEqual(first.counts, { catgirl: 5 })
  assert.equal(first.partial, true)
  assert.equal(calls, 2)

  const second = await usage.read(['catgirl', 'mom'])
  assert.deepEqual(second.counts, { catgirl: 5 })
  assert.equal(second.partial, true)
  assert.equal(calls, 2, '短 TTL 内应直接用缓存')

  time.advance(USAGE_PARTIAL_CACHE_MS + 1)
  const third = await usage.read(['catgirl', 'mom'])
  assert.equal(calls, 4)
  assert.equal(third.partial, true)
})

test('read 全部失败时返回 null（无缓存）', async () => {
  const fake = fakeFetch(() => {
    throw new Error('offline')
  })
  const usage = createUsage({ fetch: fake.fetch, enabled: true })
  assert.equal(await usage.read(['catgirl']), null)
})

test('超大响应被拒绝', async () => {
  const huge = 'x'.repeat(USAGE_MAX_BODY + 1)
  const fake = fakeFetch(() => ({
    status: 200,
    ok: true,
    headers: { get: () => String(huge.length) },
    text: async () => huge,
  }))
  const usage = createUsage({ fetch: fake.fetch, enabled: true })
  assert.equal(await usage.record('catgirl'), false)
})

test('read 只请求合法 id，并去掉重复项', async () => {
  const fake = fakeFetch(() => jsonResponse({ value: 3 }))
  const usage = createUsage({ fetch: fake.fetch, enabled: true })
  await usage.read(['catgirl', 'catgirl', 'off', 'custom-x'])
  assert.equal(fake.calls.length, 1)
  assert.ok(fake.calls[0].url.endsWith('/get/dsh-persona-modes/catgirl'))
})

test('并发 read 共享同一次请求', async () => {
  const fake = fakeFetch(() => jsonResponse({ value: 9 }))
  const usage = createUsage({ fetch: fake.fetch, enabled: true })
  const [left, right] = await Promise.all([
    usage.read(['catgirl']),
    usage.read(['catgirl']),
  ])
  assert.equal(fake.calls.length, 1)
  assert.deepEqual(left.counts, { catgirl: 9 })
  assert.deepEqual(right.counts, { catgirl: 9 })
})

test('read 撞上 429 时按一分钟退避并沿用缓存', async () => {
  const time = clock()
  let calls = 0
  const fake = fakeFetch((url) => {
    calls += 1
    if (url.endsWith('/mom')) return jsonResponse({ error: 'rate limited' }, 429)
    return jsonResponse({ value: 5 })
  })
  const usage = createUsage({ fetch: fake.fetch, now: time.now, enabled: true })

  const first = await usage.read(['catgirl', 'mom'])
  assert.deepEqual(first.counts, { catgirl: 5 })
  assert.equal(first.partial, true)
  assert.equal(calls, 2)
  assert.equal(typeof usage.status().breakerOpenUntil, 'number', '429 应触发一分钟退避')

  // 退避窗口内再读：命中短缓存，不再发请求。
  const second = await usage.read(['catgirl', 'mom'])
  assert.equal(calls, 2)
  assert.deepEqual(second.counts, { catgirl: 5 })

  // 退避结束、短缓存过期后重新拉取。
  time.advance(USAGE_PARTIAL_CACHE_MS + 1)
  const third = await usage.read(['catgirl', 'mom'])
  assert.equal(calls, 4)
  assert.equal(third.partial, true)
})

test('未显式传 enabled 时，DSH_PERSONA_USAGE=off 生效', async () => {
  const original = process.env.DSH_PERSONA_USAGE
  process.env.DSH_PERSONA_USAGE = 'off'
  try {
    const fake = fakeFetch(() => jsonResponse({ value: 1 }))
    const usage = createUsage({ fetch: fake.fetch })
    assert.equal(await usage.record('catgirl'), false)
    assert.equal(await usage.read(['catgirl']), null)
    assert.equal(fake.calls.length, 0)
  } finally {
    if (original === undefined) delete process.env.DSH_PERSONA_USAGE
    else process.env.DSH_PERSONA_USAGE = original
  }
})

test('失败的读取与上报都写进运行日志，不再静默', async () => {
  const time = clock()
  const journal = { records: [], notes: [], record(scope, error, detail) { this.records.push({ scope, error, detail }) }, note(scope, message, detail) { this.notes.push({ scope, message, detail }) } }
  const fake = fakeFetch((url) => {
    if (url.includes('/hit/')) return jsonResponse({ error: 'offline' }, 500)
    if (url.endsWith('/mom')) return jsonResponse({ error: 'boom' }, 500)
    return jsonResponse({ value: 3 })
  })
  const usage = createUsage({ fetch: fake.fetch, now: time.now, enabled: true, journal })

  assert.equal(await usage.record('catgirl'), false)
  assert.equal(journal.records.length, 1)
  assert.equal(journal.records[0].scope, 'usage.record')
  assert.equal(journal.records[0].detail.id, 'catgirl')

  const result = await usage.read(['catgirl', 'mom'])
  assert.deepEqual(result.counts, { catgirl: 3 })
  assert.equal(result.partial, true)
  const readFailures = journal.records.filter((entry) => entry.scope === 'usage.read')
  assert.equal(readFailures.length, 1)
  assert.equal(readFailures[0].detail.id, 'mom')

  // 成功路径只在 debug 打开时留下 note。
  assert.ok(journal.notes.some((entry) => entry.scope === 'usage.read'))
})

test('日志对象自己抛错也不影响计数', async () => {
  const journal = {
    record() {
      throw new Error('journal-down')
    },
    note() {
      throw new Error('journal-down')
    },
  }
  const fake = fakeFetch(() => jsonResponse({ value: 1 }))
  const usage = createUsage({ fetch: fake.fetch, enabled: true, journal })
  const result = await usage.read(['catgirl'])
  assert.deepEqual(result.counts, { catgirl: 1 })
  assert.equal(await usage.record('catgirl'), true)
})

test('上报超时记中文文案并带阈值', async () => {
  const journal = { records: [], notes: [], record(scope, error, detail) { this.records.push({ scope, error, detail }) }, note() {} }
  const timeout = () => {
    const error = new Error('The operation was aborted due to timeout')
    error.name = 'TimeoutError'
    return error
  }
  const fake = { async fetch() { throw timeout() } }
  const usage = createUsage({ fetch: fake.fetch, enabled: true, journal })
  assert.equal(await usage.record('whale'), false)
  assert.equal(journal.records.length, 1, '连续失败前只记一条')
  assert.match(journal.records[0].error, /上报超时（超过 8 秒）/u)
  assert.equal(journal.records[0].detail.id, 'whale')
  assert.equal(journal.records[0].detail.host, 'abacus.jasoncameron.dev')
})

test('read 与 record 的超时同为 8 秒', async () => {
  // AbortSignal.timeout 不暴露毫秒数；拦下它记录入参，验证两条路径的接线。
  const original = AbortSignal.timeout
  const seen = []
  AbortSignal.timeout = function stub(ms) {
    seen.push(ms)
    return original.call(AbortSignal, ms)
  }
  try {
    const fake = fakeFetch(() => jsonResponse({ value: 1 }))
    const usage = createUsage({ fetch: fake.fetch, enabled: true })
    await usage.read(['catgirl', 'mom'])
    assert.equal(await usage.record('whale'), true)
    assert.deepEqual(seen, [USAGE_READ_TIMEOUT_MS, USAGE_READ_TIMEOUT_MS, USAGE_TIMEOUT_MS])
  } finally {
    AbortSignal.timeout = original
  }
})

test('多个键同时超时只写一条汇总日志，并给出排查方向', async () => {
  const names = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY']
  // 代理环境变量会影响提示文案：保存现场，测完恢复，测试不依赖宿主机配置。
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    for (const name of names) delete process.env[name]
    const journal = { records: [], notes: [], record(scope, error, detail) { this.records.push({ scope, error, detail }) }, note() {} }
    const timeout = () => {
      const error = new Error('The operation was aborted due to timeout')
      error.name = 'TimeoutError'
      return error
    }
    const fake = {
      async fetch() {
        throw timeout()
      },
    }
    let usage = createUsage({ fetch: fake.fetch, enabled: true, journal })
    let result = await usage.read(['catgirl', 'mom', 'sharp', 'tiga'])

    assert.equal(result, null, '全部失败且无缓存时返回 null')
    let readEntries = journal.records.filter((entry) => entry.scope === 'usage.read')
    assert.equal(readEntries.length, 1, '四个键失败只记一条')
    assert.match(readEntries[0].error, /4 个人格数据读取超时（超过 8 秒）/u)
    assert.equal(readEntries[0].detail.failed, 4)
    assert.equal(readEntries[0].detail.sample, 'catgirl,mom,sharp')
    assert.equal(readEntries[0].detail.host, 'abacus.jasoncameron.dev')
    assert.match(readEntries[0].detail.hint, /未配置 https_proxy/u)

    // 配了代理时文案换成另一种提示，不带「未配置」的误导。
    process.env.https_proxy = 'http://127.0.0.1:7890'
    journal.records.length = 0
    usage = createUsage({ fetch: fake.fetch, enabled: true, journal })
    result = await usage.read(['catgirl', 'mom', 'sharp', 'tiga'])
    assert.equal(result, null)
    readEntries = journal.records.filter((entry) => entry.scope === 'usage.read')
    assert.equal(readEntries.length, 1)
    assert.match(readEntries[0].detail.hint, /已走代理仍超时/u)
    assert.ok(!readEntries[0].detail.hint.includes('未配置'))
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('status 暴露缓存与熔断状态', async () => {
  const fake = fakeFetch(() => jsonResponse({ value: 1 }))
  const usage = createUsage({ fetch: fake.fetch, enabled: true })
  assert.deepEqual(usage.status(), { enabled: true, cachedAt: null, breakerOpenUntil: null })
  await usage.read(['catgirl'])
  assert.equal(typeof usage.status().cachedAt, 'number')
})