/**
 * 运行错误日志测试。
 *
 * 全部纯内存：不碰磁盘、不碰网络，用假时钟固定时间戳。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createErrorLog, describeError, LOG_LIMIT } from '../src/errors.js'

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

test('record 记录错误消息与来源，并带上时间戳', () => {
  const time = clock()
  const log = createErrorLog({ now: time.now })
  const entry = log.record('usage.read', new Error('boom'), { id: 'catgirl' })

  assert.equal(entry.level, 'error')
  assert.equal(entry.scope, 'usage.read')
  assert.equal(entry.message, 'boom')
  assert.equal(entry.at, 1_000)
  assert.match(entry.detail, /id=catgirl/u)

  const list = log.list()
  assert.equal(list.entries.length, 1)
  assert.equal(list.debug, false)
  assert.equal(list.dropped, 0)
  assert.equal(list.limit, LOG_LIMIT)
})

test('日志有上限：超出后丢最旧的并累计 dropped', () => {
  const log = createErrorLog({ limit: 3 })
  for (let index = 0; index < 5; index += 1) log.record('test', `e${index}`)
  const list = log.list()
  assert.deepEqual(list.entries.map((entry) => entry.message), ['e2', 'e3', 'e4'])
  assert.equal(list.dropped, 2)
})

test('debug 关闭时只记错误，打开后才收流程细节', () => {
  const log = createErrorLog()
  assert.equal(log.note('usage.read', '读取完成'), null)
  assert.equal(log.list().entries.length, 0)

  log.setDebug(true)
  const note = log.note('usage.read', '读取完成', { ok: 15 })
  assert.equal(note.level, 'info')
  assert.equal(log.list().entries.length, 1)
  assert.equal(log.isDebug(), true)

  log.setDebug(false)
  assert.equal(log.note('usage.read', '又完成一次'), null)
  assert.equal(log.list().entries.length, 1, '关闭后不再追加 info')
})

test('堆栈只在 debug 打开时附带', () => {
  const quiet = createErrorLog()
  assert.equal(quiet.record('x', new Error('boom')).stack, undefined)

  const loud = createErrorLog()
  loud.setDebug(true)
  const entry = loud.record('x', new Error('boom'))
  assert.equal(typeof entry.stack, 'string')
  assert.match(entry.stack, /boom/u)
})

test('clear 清空并返回条数', () => {
  const log = createErrorLog()
  log.record('a', 'e1')
  log.record('b', 'e2')
  assert.equal(log.clear(), 2)
  const list = log.list()
  assert.deepEqual(list.entries, [])
  assert.equal(list.dropped, 0)
})

test('URL 查询串被抹掉，不把一次性参数写进日志', () => {
  const log = createErrorLog()
  const entry = log.record(
    'usage.read',
    'failed https://abacus.jasoncameron.dev/get/ns/key?token=secret#frag',
  )
  assert.ok(!entry.message.includes('secret'))
  assert.ok(!entry.message.includes('#'))
  assert.match(entry.message, /https:\/\/abacus\.jasoncameron\.dev\/get\/ns\/key/u)
})

test('describeError 兼容字符串、普通对象与空值', () => {
  assert.deepEqual(describeError('plain'), { code: 'plain', message: 'plain' })
  assert.equal(describeError(null).code, 'unknown')

  const shaped = describeError({ name: 'TypeError', message: 'bad', status: 500 })
  assert.equal(shaped.code, 'TypeError')
  assert.equal(shaped.message, 'bad')
  assert.equal(shaped.status, 500)

  const coded = describeError({ code: 'ENOTFOUND', message: 'dns' })
  assert.equal(coded.code, 'ENOTFOUND')
})

test('超长消息被截断，避免一条错误撑爆面板', () => {
  const log = createErrorLog()
  const entry = log.record('test', 'x'.repeat(1_000))
  assert.ok(entry.message.length <= 240)
  assert.ok(entry.message.endsWith('…'))
})

test('list 返回拷贝，外部改写不影响内部状态', () => {
  const log = createErrorLog()
  log.record('a', 'e1')
  const list = log.list()
  list.entries[0].message = 'tampered'
  list.entries.push({ fake: true })
  assert.equal(log.list().entries.length, 1)
  assert.equal(log.list().entries[0].message, 'e1')
})
