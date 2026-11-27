/**
 * 统计缓存落盘与 stale-while-revalidate 测试。
 *
 * 与 `usage.test.mjs` 分开：那边验证「怎么数」，这边验证「数怎么留下来、
 * 过期以后怎么先给旧值」。全部使用假 fetch、假时钟与临时目录，不访问
 * Abacus，也不碰用户真实的 `~/.dsh`。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createUsage,
  restoreCache,
  USAGE_CACHE_MS,
  USAGE_CACHE_VERSION,
  USAGE_PARTIAL_CACHE_MS,
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

/**
 * 造一个临时目录，测试结束后整目录删掉。
 *
 * @returns {{ dir: string, cleanup: () => void }} 临时目录与清理函数。
 */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-persona-modes-usage-'))
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * 写一份缓存文件，字段形状与宿主写出的一致。
 *
 * @param {string} file 目标路径。
 * @param {{ at: number, partial: boolean, counts: Record<string, number> }} entry 缓存内容。
 * @param {number} [version] 格式版本。
 */
function writeCacheFile(file, entry, version = USAGE_CACHE_VERSION) {
  writeFileSync(file, JSON.stringify({ version, ...entry }))
}

test('restoreCache 按不可信输入校验条目，并把未来时间戳降级成过期', () => {
  const now = 10_000
  const restored = restoreCache({
    version: USAGE_CACHE_VERSION,
    at: 5_000,
    partial: false,
    counts: {
      catgirl: 3,
      mom: 0,
      'custom-x': 1,
      off: 9,
      whale: 1.5,
      cat: 'x',
    },
  }, now)
  assert.deepEqual(restored, { counts: { catgirl: 3 }, at: 5_000, partial: false })

  assert.equal(restoreCache({ version: 2, at: 1, counts: {} }, now), null, '版本不符应整份丢弃')
  assert.equal(restoreCache(null, now), null)
  assert.equal(restoreCache({ version: USAGE_CACHE_VERSION, at: 'x', counts: {} }, now), null)
  assert.equal(restoreCache({ version: USAGE_CACHE_VERSION, at: 1, counts: [] }, now), null)

  const future = restoreCache({
    version: USAGE_CACHE_VERSION,
    at: now + 60 * 60 * 1_000,
    partial: true,
    counts: { catgirl: 1 },
  }, now)
  assert.equal(future.at, 0, '未来时间戳按已过期处理，避免时钟回拨让缓存永不刷新')
  assert.equal(future.partial, true)
  assert.deepEqual(future.counts, { catgirl: 1 })
})

test('读取结果落盘：新客户端重启后直接命中，不再出网', async () => {
  const temp = tempDir()
  try {
    const file = join(temp.dir, 'usage-cache.json')
    const time = clock()
    const first = fakeFetch(() => jsonResponse({ value: 12 }))
    const usage = createUsage({ fetch: first.fetch, now: time.now, enabled: true, file })
    await usage.read(['catgirl'])

    const raw = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(raw.version, USAGE_CACHE_VERSION)
    assert.equal(raw.partial, false)
    assert.deepEqual(raw.counts, { catgirl: 12 })

    // 模拟宿主重启：新客户端读同一个文件，不应再发请求。
    const second = fakeFetch(() => {
      throw new Error('不该出网')
    })
    const restarted = createUsage({ fetch: second.fetch, now: time.now, enabled: true, file })
    const cached = await restarted.read(['catgirl'])
    assert.deepEqual(cached.counts, { catgirl: 12 })
    assert.equal(cached.stale, false)
    assert.equal(second.calls.length, 0)
  } finally {
    temp.cleanup()
  }
})

test('过期缓存先回旧值，后台刷新完成后写回新值', async () => {
  const temp = tempDir()
  try {
    const file = join(temp.dir, 'usage-cache.json')
    const base = USAGE_CACHE_MS + 10_000
    const time = clock(base)
    // 手工放一份比 24 小时还旧的缓存：重启后第一次进入就属于这种情形。
    writeCacheFile(file, {
      at: base - USAGE_CACHE_MS - 1,
      partial: false,
      counts: { catgirl: 5 },
    })

    const fake = fakeFetch(() => jsonResponse({ value: 9 }))
    const usage = createUsage({ fetch: fake.fetch, now: time.now, enabled: true, file })

    const stale = await usage.read(['catgirl'])
    assert.equal(stale.stale, true, '过期缓存应先交出去')
    assert.equal(stale.refreshing, true, '同时应开始后台刷新')
    assert.deepEqual(stale.counts, { catgirl: 5 }, '旧数字不能丢')

    // 第二次读取会等到后台刷新完成，拿到新值。
    const fresh = await usage.read(['catgirl'])
    assert.equal(fresh.stale, false)
    assert.deepEqual(fresh.counts, { catgirl: 9 })
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).counts, { catgirl: 9 }, '新值应写回文件')
  } finally {
    temp.cleanup()
  }
})

test('手动刷新不走 SWR：即使有旧缓存也等真值', async () => {
  const temp = tempDir()
  try {
    const file = join(temp.dir, 'usage-cache.json')
    const base = USAGE_CACHE_MS + 10_000
    const time = clock(base)
    writeCacheFile(file, {
      at: base - USAGE_CACHE_MS - 1,
      partial: false,
      counts: { catgirl: 5 },
    })
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const fake = {
      async fetch() {
        await gate
        return jsonResponse({ value: 11 })
      },
    }
    const usage = createUsage({ fetch: fake.fetch, now: time.now, enabled: true, file })
    const pending = usage.read(['catgirl'], { refresh: true })
    release()
    const result = await pending
    assert.equal(result.stale, false)
    assert.deepEqual(result.counts, { catgirl: 11 })
  } finally {
    temp.cleanup()
  }
})

test('缓存文件损坏时静默忽略，照常冷读并在成功后修复文件', async () => {
  const temp = tempDir()
  try {
    const file = join(temp.dir, 'usage-cache.json')
    writeFileSync(file, '{ 这不是 JSON')
    const fake = fakeFetch(() => jsonResponse({ value: 3 }))
    const usage = createUsage({ fetch: fake.fetch, enabled: true, file })

    const result = await usage.read(['catgirl'])
    assert.deepEqual(result.counts, { catgirl: 3 })
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).counts, { catgirl: 3 })
  } finally {
    temp.cleanup()
  }
})

test('discard 删除缓存文件并清空内存', async () => {
  const temp = tempDir()
  try {
    const file = join(temp.dir, 'usage-cache.json')
    const fake = fakeFetch(() => jsonResponse({ value: 6 }))
    const usage = createUsage({ fetch: fake.fetch, enabled: true, file })
    await usage.read(['catgirl'])
    assert.equal(existsSync(file), true)
    assert.notEqual(usage.status().cachedAt, null)

    usage.discard()
    assert.equal(existsSync(file), false, 'discard 应删除文件')
    assert.equal(usage.status().cachedAt, null)

    // 删掉之后就是冷读，不会再从文件恢复旧值。
    const again = await usage.read(['catgirl'])
    assert.deepEqual(again.counts, { catgirl: 6 })
  } finally {
    temp.cleanup()
  }
})

test('persist 关闭时不读也不写缓存文件', async () => {
  const temp = tempDir()
  try {
    const file = join(temp.dir, 'usage-cache.json')
    // 文件里放着与第三方不同的旧值：一旦被读取，结果会是 99。
    writeCacheFile(file, { at: 1, partial: false, counts: { catgirl: 99 } })
    const fake = fakeFetch(() => jsonResponse({ value: 3 }))
    const usage = createUsage({
      fetch: fake.fetch,
      enabled: true,
      file,
      persist: () => false,
    })

    const result = await usage.read(['catgirl'])
    assert.deepEqual(result.counts, { catgirl: 3 }, '关闭持久化时不应读取本地文件')
    assert.equal(result.stale, false)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).counts, { catgirl: 99 }, '也不应改写文件')
    assert.equal(fake.calls.length, 1)
  } finally {
    temp.cleanup()
  }
})

test('缓存写盘失败只记一条日志，不影响返回结果', async () => {
  const temp = tempDir()
  try {
    const file = join(temp.dir, 'usage-cache.json')
    // 让目标路径变成目录：写入必然失败，但读取流程必须照常。
    mkdirSync(file)
    const journal = {
      records: [],
      notes: [],
      record(scope, error, detail) {
        this.records.push({ scope, error, detail })
      },
      note() {},
    }
    const fake = fakeFetch(() => jsonResponse({ value: 4 }))
    const usage = createUsage({ fetch: fake.fetch, enabled: true, file, journal })

    const result = await usage.read(['catgirl'])
    assert.deepEqual(result.counts, { catgirl: 4 })
    // 读/写失败各自可能记一条；关键是「重复失败不刷屏」。
    const cacheLogs = () => journal.records.filter((entry) => entry.scope === 'usage.cache')
    const reportedAfterFirst = cacheLogs().length
    assert.ok(reportedAfterFirst >= 1, '写盘失败应留下日志')

    // 再次失败不重复刷屏。
    await usage.read(['catgirl'], { refresh: true })
    assert.equal(cacheLogs().length, reportedAfterFirst)
  } finally {
    temp.cleanup()
  }
})

test('恢复的缓存按整全/部分各自的 TTL 判断新鲜度', async () => {
  const temp = tempDir()
  try {
    const base = USAGE_CACHE_MS + 10_000
    const time = clock(base)

    // 整全缓存：距 24 小时只差一秒，仍然新鲜，不该出网。
    const wholeFile = join(temp.dir, 'whole.json')
    writeCacheFile(wholeFile, {
      at: base - (USAGE_CACHE_MS - 1_000),
      partial: false,
      counts: { catgirl: 7 },
    })
    const noFetch = fakeFetch(() => {
      throw new Error('不该出网')
    })
    const whole = createUsage({
      fetch: noFetch.fetch,
      now: time.now,
      enabled: true,
      file: wholeFile,
    })
    const fresh = await whole.read(['catgirl'])
    assert.equal(fresh.stale, false)
    assert.deepEqual(fresh.counts, { catgirl: 7 })
    assert.equal(noFetch.calls.length, 0)

    // 部分缓存：同样的时间差，但短 TTL 只有 1 小时，已过期 → 先回旧值。
    const partialFile = join(temp.dir, 'partial.json')
    writeCacheFile(partialFile, {
      at: base - (USAGE_PARTIAL_CACHE_MS + 1_000),
      partial: true,
      counts: { catgirl: 7 },
    })
    const fake = fakeFetch(() => jsonResponse({ value: 8 }))
    const partial = createUsage({
      fetch: fake.fetch,
      now: time.now,
      enabled: true,
      file: partialFile,
    })
    const stale = await partial.read(['catgirl'])
    assert.equal(stale.stale, true)
    assert.equal(stale.partial, true)
    assert.deepEqual(stale.counts, { catgirl: 7 })
  } finally {
    temp.cleanup()
  }
})

test('熔断期间读取：旧缓存标 stale，不再发请求', async () => {
  const time = clock()
  let fail = false
  const fake = fakeFetch(() => {
    if (fail) throw new Error('offline')
    return jsonResponse({ value: 3 })
  })
  const usage = createUsage({ fetch: fake.fetch, now: time.now, enabled: true })

  await usage.read(['catgirl'])
  fail = true
  for (let index = 0; index < 3; index += 1) {
    time.advance(USAGE_CACHE_MS + 1)
    await usage.read(['catgirl'], { refresh: true })
  }
  assert.notEqual(usage.status().breakerOpenUntil, null)

  const callsBefore = fake.calls.length
  time.advance(1)
  const stale = await usage.read(['catgirl'])
  assert.equal(stale.stale, true)
  assert.equal(stale.refreshing, false)
  assert.deepEqual(stale.counts, { catgirl: 3 })
  assert.equal(fake.calls.length, callsBefore, '熔断期间不应再发请求')
})
