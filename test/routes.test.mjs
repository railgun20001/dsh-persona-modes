/**
 * 宿主路由测试：不启动 DSH，直接用假 req/res 跑处理器。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRouteHandler, ROUTE_HEADER, ROUTE_PATH } from '../src/routes.js'
import { createStore } from '../src/store.js'
import { MODES } from '../src/modes.js'

/**
 * 造一个请求流。
 *
 * @param {{ method?: string, action?: string, headers?: Record<string, string>, body?: string }} options 请求参数。
 * @returns {import('node:stream').Readable} 可被 readJsonBody 读取的请求。
 */
function makeRequest(options = {}) {
  const { method = 'POST', action = 'state', headers = {}, body = '' } = options
  const request = Readable.from(body === '' ? [] : [Buffer.from(body, 'utf8')])
  request.method = method
  request.url = `${ROUTE_PATH}/${action}`
  request.headers = headers
  return request
}

/**
 * 调用一次路由并等待响应结束。
 *
 * @param {Function} handler 路由处理器。
 * @param {object} request 请求对象。
 * @returns {Promise<{ status: number, headers: object, body: any }>} 响应。
 */
function invoke(handler, request) {
  return new Promise((resolve) => {
    const response = {
      status: 0,
      headers: {},
      text: '',
      writeHead(status, headers) {
        this.status = status
        this.headers = headers
      },
      end(text) {
        this.text = String(text ?? '')
        resolve({
          status: this.status,
          headers: this.headers,
          body: this.text === '' ? null : JSON.parse(this.text),
        })
      },
    }
    handler(request, response)
  })
}

/** 带签名的标准头。 */
const SIGNED = { [ROUTE_HEADER]: '1', 'content-type': 'application/json' }

/**
 * 建一个临时状态存储。
 *
 * @returns {{ store: object, cleanup: () => void }} 存储与清理函数。
 */
function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-persona-modes-routes-'))
  return {
    store: createStore({ file: join(dir, 'state.json') }),
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('非 POST 返回 405', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const result = await invoke(handler, makeRequest({ method: 'GET', headers: SIGNED }))
    assert.equal(result.status, 405)
    assert.equal(result.body.error, 'method-not-allowed')
  } finally {
    temp.cleanup()
  }
})

test('缺签名头返回 403', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const result = await invoke(handler, makeRequest({}))
    assert.equal(result.status, 403)
    assert.equal(result.body.error, 'forbidden')
  } finally {
    temp.cleanup()
  }
})

test('ping 返回宿主标识与版本', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const result = await invoke(handler, makeRequest({ action: 'ping', headers: SIGNED }))
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.host, 'dsh-persona-modes')
    assert.equal(result.body.version, '9.9.9')
  } finally {
    temp.cleanup()
  }
})

test('state 返回全部模式与当前模式', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const result = await invoke(handler, makeRequest({ action: 'state', headers: SIGNED }))
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.active, 'off')
    assert.equal(result.body.modes.length, MODES.length)
    assert.equal(result.body.modes[0].id, 'off')
    assert.equal(result.body.modes[0].chars, 0)
  } finally {
    temp.cleanup()
  }
})

test('select 切换并持久化', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const result = await invoke(handler, makeRequest({
      action: 'select',
      headers: SIGNED,
      body: JSON.stringify({ id: 'catgirl' }),
    }))
    assert.equal(result.status, 200)
    assert.equal(result.body.active, 'catgirl')
    assert.equal(temp.store.getActive(), 'catgirl')
  } finally {
    temp.cleanup()
  }
})

test('select 未知模式返回 400', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const result = await invoke(handler, makeRequest({
      action: 'select',
      headers: SIGNED,
      body: JSON.stringify({ id: 'not-a-mode' }),
    }))
    assert.equal(result.status, 400)
    assert.equal(result.body.error, 'unknown-mode')
    assert.equal(temp.store.getActive(), 'off')
  } finally {
    temp.cleanup()
  }
})

test('select 空 body 返回 400', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const result = await invoke(handler, makeRequest({ action: 'select', headers: SIGNED }))
    assert.equal(result.status, 400)
    assert.equal(result.body.error, 'unknown-mode')
  } finally {
    temp.cleanup()
  }
})

test('select 损坏 JSON 返回 400', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const result = await invoke(handler, makeRequest({ action: 'select', headers: SIGNED, body: '{' }))
    assert.equal(result.status, 400)
    assert.equal(result.body.error, 'invalid-json')
  } finally {
    temp.cleanup()
  }
})

test('select 超大 body 返回 413 而不是断连接', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const result = await invoke(handler, makeRequest({
      action: 'select',
      headers: SIGNED,
      body: JSON.stringify({ id: 'catgirl', padding: 'x'.repeat(20_000) }),
    }))
    assert.equal(result.status, 413)
    assert.equal(result.body.error, 'too-large')
  } finally {
    temp.cleanup()
  }
})

test('save 保存内置覆盖、reset 恢复默认', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const saved = await invoke(handler, makeRequest({
      action: 'save',
      headers: SIGNED,
      body: JSON.stringify({ id: 'catgirl', address: '铲屎官', selfName: '本喵', prompt: '【人格载入】\n猫科少女' }),
    }))
    assert.equal(saved.status, 200)
    assert.equal(saved.body.saved.id, 'catgirl')
    assert.equal(saved.body.modes.find((mode) => mode.id === 'catgirl').address, '铲屎官')

    const reset = await invoke(handler, makeRequest({
      action: 'reset',
      headers: SIGNED,
      body: JSON.stringify({ id: 'catgirl' }),
    }))
    assert.equal(reset.status, 200)
    assert.equal(reset.body.modes.find((mode) => mode.id === 'catgirl').address, '主人')
  } finally {
    temp.cleanup()
  }
})

test('save 新建自定义人格、select 后 delete', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const saved = await invoke(handler, makeRequest({
      action: 'save',
      headers: SIGNED,
      body: JSON.stringify({
        nameZh: '女儿',
        emoji: '👧',
        address: '爸爸',
        selfName: '女儿',
        prompt: '【人格载入】\n女儿\n乖巧黏人',
      }),
    }))
    assert.equal(saved.status, 200)
    const id = saved.body.saved.id
    assert.ok(id.startsWith('custom-'))
    assert.equal(saved.body.modes.find((mode) => mode.id === id).custom, true)

    const selected = await invoke(handler, makeRequest({
      action: 'select',
      headers: SIGNED,
      body: JSON.stringify({ id }),
    }))
    assert.equal(selected.body.active, id)

    const deleted = await invoke(handler, makeRequest({
      action: 'delete',
      headers: SIGNED,
      body: JSON.stringify({ id }),
    }))
    assert.equal(deleted.status, 200)
    assert.equal(deleted.body.active, 'off')
    assert.equal(deleted.body.modes.some((mode) => mode.id === id), false)
  } finally {
    temp.cleanup()
  }
})

test('delete 内置人格返回 400', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const result = await invoke(handler, makeRequest({
      action: 'delete',
      headers: SIGNED,
      body: JSON.stringify({ id: 'catgirl' }),
    }))
    assert.equal(result.status, 400)
    assert.equal(result.body.error, 'not-custom')
  } finally {
    temp.cleanup()
  }
})

test('debug 返回诊断回调的数据', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, {
      version: '9.9.9',
      diagnostics: async () => ({ sections: [{ name: 'persona-modes:policy', chars: 50 }] }),
    })
    const result = await invoke(handler, makeRequest({ action: 'debug', headers: SIGNED }))
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.sections[0].name, 'persona-modes:policy')
  } finally {
    temp.cleanup()
  }
})

test('未知动作返回 404', async () => {
  const temp = tempStore()
  try {
    const handler = createRouteHandler(temp.store, { version: '9.9.9' })
    const result = await invoke(handler, makeRequest({ action: 'nope', headers: SIGNED }))
    assert.equal(result.status, 404)
    assert.equal(result.body.error, 'unknown-action')
  } finally {
    temp.cleanup()
  }
})
