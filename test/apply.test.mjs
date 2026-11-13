/**
 * 宿主半接线测试：不启动 Cordis，只验证 apply() 是否把路由、系统提示段和
 * /persona 命令接到正确的服务上，以及模式的动态读取是否真的生效。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, commandHelp } from '../index.js'
import { renderPersonaPrompt } from '../src/modes.js'
import { createStore } from '../src/store.js'

test('apply 注册路由、策略段、运行时上下文与 /persona 命令', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-persona-modes-apply-'))
  const file = join(dir, 'state.json')
  try {
    const captured = { section: null, context: null, command: null, route: null }
    const ctx = {
      inject(deps, callback) {
        const scoped = {
          effect(fn) {
            return fn()
          },
          logger: { info() {} },
          webServer: {
            register(definition) {
              captured.route = definition
              return () => {}
            },
          },
          systemPrompt: {
            section(definition) {
              captured.section = definition
              return () => {}
            },
            context(definition) {
              captured.context = definition
              return () => {}
            },
          },
          commands: {
            register(definition) {
              captured.command = definition
              return () => {}
            },
          },
        }
        return callback(scoped)
      },
      effect(fn) {
        return fn()
      },
    }

    apply(ctx, { defaultMode: 'catgirl', stateFile: file })

    assert.equal(captured.route?.kind, 'prefix')
    assert.equal(captured.route?.path, '/dsh-persona-modes')
    assert.equal(captured.section?.name, 'persona-modes:policy')
    assert.equal(captured.section?.order, 10_250)
    assert.equal(typeof captured.section?.text, 'function')
    assert.equal(captured.context?.name, 'persona-modes:active')
    assert.equal(captured.context?.order, 130)
    assert.equal(captured.context?.required, true)
    assert.equal(typeof captured.context?.text, 'function')
    assert.equal(captured.command?.name, 'persona')
    assert.equal(captured.command?.input?.hint, '[id|off]')
    assert.equal(typeof captured.command?.handler, 'function')
    assert.ok(captured.section.text().includes('人格模式'))
    assert.ok(captured.context.text().includes('猫娘'))

    // 官方适配器只有在声明 input 后才会把带参数的整行送进 handler。
    const switched = await captured.command.handler({ rawInput: ' workhorse' })
    assert.equal(switched.kind, 'success')
    assert.ok(switched.text.includes('牛马'))
    assert.ok(captured.context.text().includes('牛马'))

    const unknown = await captured.command.handler({ rawInput: ' not-a-mode' })
    assert.equal(unknown.kind, 'error')

    const off = await captured.command.handler({ rawInput: ' off' })
    assert.equal(off.kind, 'success')
    assert.equal(captured.section.text(), '')
    assert.equal(captured.context.text(), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('commandHelp 列出当前模式与全部 id', () => {
  const text = commandHelp('whale')
  assert.ok(text.includes('当前人格：鲸鱼娘（whale）'))
  assert.ok(text.includes('catgirl（猫娘）'))
  assert.ok(text.includes('daughter（女儿）'))
  assert.ok(text.includes('tiga（奥特曼-迪迦）'))
  assert.ok(text.includes('off（默认）'))
})

test('系统提示段文本函数随 store 变化', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-persona-modes-apply-'))
  try {
    const store = createStore({ file: join(dir, 'state.json') })
    const text = () => renderPersonaPrompt(store.getActive(), store.snapshot())
    assert.equal(text(), '')
    store.setActive('mom')
    assert.ok(text().includes('妈妈'))
    store.setActive('off')
    assert.equal(text(), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
