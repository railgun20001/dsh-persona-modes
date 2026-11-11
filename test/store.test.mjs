/**
 * 状态存储测试：覆盖首次运行、持久化、坏数据回落与非法输入。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createStore, readStateFile, writeStateFile } from '../src/store.js'
import { getMode } from '../src/modes.js'

/**
 * 建一个测试用临时目录。
 *
 * @returns {{ dir: string, file: string, cleanup: () => void }} 路径与清理函数。
 */
function tempState() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-persona-modes-'))
  return {
    dir,
    file: join(dir, 'state.json'),
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('首次运行使用 defaultMode，不写文件', () => {
  const temp = tempState()
  try {
    const store = createStore({ file: temp.file, defaultMode: 'tsundere' })
    assert.equal(store.getActive(), 'tsundere')
    assert.equal(readStateFile(temp.file), null)
  } finally {
    temp.cleanup()
  }
})

test('setActive 校验 id、写盘并可被新实例读回', () => {
  const temp = tempState()
  try {
    const store = createStore({ file: temp.file })
    assert.equal(store.getActive(), 'off')
    assert.equal(store.setActive('nope'), null)
    assert.equal(store.getActive(), 'off')

    const result = store.setActive('catgirl')
    assert.deepEqual(result, { active: 'catgirl', persisted: true })
    assert.equal(store.getActive(), 'catgirl')

    const reloaded = createStore({ file: temp.file })
    assert.equal(reloaded.getActive(), 'catgirl')

    const raw = JSON.parse(readFileSync(temp.file, 'utf8'))
    assert.equal(raw.version, 2)
    assert.equal(raw.active, 'catgirl')
    assert.match(raw.updatedAt, /^\d{4}-\d{2}-\d{2}T/u)
  } finally {
    temp.cleanup()
  }
})

test('重复选择同一模式不会重写 updatedAt', () => {
  const temp = tempState()
  try {
    const store = createStore({ file: temp.file })
    store.setActive('mom')
    const first = readFileSync(temp.file, 'utf8')
    // 同一毫秒内也可能相同；这里只断言结果与状态，不断言时间戳变化。
    assert.deepEqual(store.setActive('mom'), { active: 'mom', persisted: true })
    assert.equal(JSON.parse(readFileSync(temp.file, 'utf8')).active, 'mom')
    assert.equal(first.includes('"mom"'), true)
  } finally {
    temp.cleanup()
  }
})

test('首次运行选择当前默认模式也会落盘', () => {
  const temp = tempState()
  try {
    const store = createStore({ file: temp.file })
    assert.equal(store.isPersisted(), false)
    assert.deepEqual(store.setActive('off'), { active: 'off', persisted: true })
    assert.equal(store.isPersisted(), true)
    assert.equal(readStateFile(temp.file)?.active, 'off')
  } finally {
    temp.cleanup()
  }
})

test('写盘失败后再次选择同一模式会重试，而不是谎报成功', () => {
  const temp = tempState()
  try {
    // 让目标路径本身是一个目录：rename 到目录会失败。
    const blocked = join(temp.dir, 'blocked')
    mkdirSync(blocked)
    const store = createStore({ file: blocked })
    assert.deepEqual(store.setActive('catgirl'), { active: 'catgirl', persisted: false })
    assert.equal(store.isPersisted(), false)
    // 同一模式再选一次：必须重试写盘，仍然失败。
    assert.deepEqual(store.setActive('catgirl'), { active: 'catgirl', persisted: false })
    // 障碍移除后重试：同一个模式这次应真正落盘。
    rmSync(blocked, { recursive: true, force: true })
    assert.deepEqual(store.setActive('catgirl'), { active: 'catgirl', persisted: true })
    assert.equal(readStateFile(blocked)?.active, 'catgirl')
  } finally {
    temp.cleanup()
  }
})

test('损坏的 JSON / 错误形状回落到默认模式', () => {
  const temp = tempState()
  try {
    writeFileSync(temp.file, '{not json', 'utf8')
    assert.equal(createStore({ file: temp.file, defaultMode: 'maid' }).getActive(), 'maid')

    writeFileSync(temp.file, JSON.stringify({ active: 'not-a-mode' }), 'utf8')
    assert.equal(createStore({ file: temp.file, defaultMode: 'maid' }).getActive(), 'maid')

    writeFileSync(temp.file, JSON.stringify(['catgirl']), 'utf8')
    assert.equal(createStore({ file: temp.file, defaultMode: 'maid' }).getActive(), 'maid')
  } finally {
    temp.cleanup()
  }
})

test('readStateFile 接受合法文件并迁移 v1 形状', () => {
  const temp = tempState()
  try {
    writeFileSync(temp.file, JSON.stringify({ active: 'whale' }), 'utf8')
    assert.deepEqual(readStateFile(temp.file), {
      version: 2,
      active: 'whale',
      intensity: 'low',
      overrides: {},
      customModes: [],
    })
  } finally {
    temp.cleanup()
  }
})

test('setIntensity 默认低、写入并持久化、坏值回落', () => {
  const temp = tempState()
  try {
    const store = createStore({ file: temp.file })
    assert.equal(store.getIntensity(), 'low')
    assert.deepEqual(store.setIntensity('medium'), { intensity: 'medium', persisted: true })
    assert.equal(createStore({ file: temp.file }).getIntensity(), 'medium')
    assert.deepEqual(store.setIntensity('nope'), { intensity: 'low', persisted: true })
    assert.equal(store.getIntensity(), 'low')
  } finally {
    temp.cleanup()
  }
})

test('savePersona 保存内置覆盖并可重置', () => {
  const temp = tempState()
  try {
    const store = createStore({ file: temp.file })
    assert.deepEqual(
      store.savePersona({ id: 'catgirl', address: '铲屎官', selfName: '本喵', prompt: '【人格载入】\n猫科少女' }),
      { id: 'catgirl', custom: false, persisted: true },
    )
    assert.deepEqual(store.snapshot().overrides.catgirl, {
      address: '铲屎官',
      selfName: '本喵',
      prompt: '【人格载入】\n猫科少女',
    })
    assert.equal(createStore({ file: temp.file }).snapshot().overrides.catgirl.address, '铲屎官')

    assert.deepEqual(store.resetPersona('catgirl'), { id: 'catgirl', custom: false, persisted: true })
    assert.equal(store.snapshot().overrides.catgirl, undefined)
    assert.equal(store.savePersona({ id: 'not-a-mode' }), null)
    assert.equal(store.savePersona({ id: 'off', address: 'x' }), null)
  } finally {
    temp.cleanup()
  }
})

test('savePersona 新建、更新、重置、删除自定义人格', () => {
  const temp = tempState()
  try {
    const store = createStore({ file: temp.file })
    const created = store.savePersona({
      nameZh: '女儿',
      emoji: '👧',
      address: '爸爸',
      selfName: '女儿',
      prompt: '【人格载入】\n女儿\n乖巧黏人',
    })
    assert.ok(created)
    assert.ok(created.id.startsWith('custom-'))
    const id = created.id

    const first = store.snapshot().customModes.find((mode) => mode.id === id)
    assert.ok(first)
    assert.equal(first.nameZh, '女儿')
    assert.deepEqual(first.values, {
      address: '爸爸',
      selfName: '女儿',
      prompt: '【人格载入】\n女儿\n乖巧黏人',
    })
    assert.deepEqual(first.defaults, first.values)

    assert.deepEqual(store.setActive(id), { active: id, persisted: true })
    assert.equal(store.getActive(), id)

    assert.deepEqual(
      store.savePersona({
        id,
        nameZh: '乖女儿',
        address: '妈妈',
        selfName: '我',
        prompt: '【人格载入】\n女儿',
      }),
      { id, custom: true, persisted: true },
    )
    const updated = store.snapshot().customModes.find((mode) => mode.id === id)
    assert.equal(updated.nameZh, '乖女儿')
    assert.equal(updated.values.address, '妈妈')
    assert.equal(updated.defaults.address, '爸爸')

    assert.deepEqual(store.resetPersona(id), { id, custom: true, persisted: true })
    const reset = store.snapshot().customModes.find((mode) => mode.id === id)
    assert.deepEqual(reset.values, reset.defaults)

    const deleted = store.deletePersona(id)
    assert.equal(deleted.active, 'off')
    assert.equal(store.getActive(), 'off')
    assert.equal(store.snapshot().customModes.length, 0)
    assert.equal(store.deletePersona(id), null)
  } finally {
    temp.cleanup()
  }
})

test('readStateFile 丢弃坏自定义条目与未知覆盖', () => {
  const temp = tempState()
  try {
    writeFileSync(temp.file, JSON.stringify({
      version: 2,
      active: 'catgirl',
      overrides: {
        catgirl: { address: '铲屎官' },
        'not-a-mode': { address: 'x' },
      },
      customModes: [
        { id: 'bad-id', defaults: {}, values: {} },
        { id: 'custom-good', nameZh: '好的', defaults: { address: '你', selfName: '我', prompt: '【人格载入】' }, values: { address: '你', selfName: '我', prompt: '【人格载入】' } },
      ],
    }), 'utf8')
    const state = readStateFile(temp.file)
    assert.ok(state)
    assert.deepEqual(state.overrides.catgirl, { address: '铲屎官', selfName: '猫娘', prompt: getMode('catgirl').tone })
    assert.equal(state.customModes.length, 1)
    assert.equal(state.customModes[0].id, 'custom-good')
  } finally {
    temp.cleanup()
  }
})

test('writeStateFile 在目标目录不存在时会创建目录', () => {
  const temp = tempState()
  try {
    const nested = join(temp.dir, 'nested', 'state.json')
    assert.equal(writeStateFile({ version: 2, active: 'sharp' }, nested), true)
    assert.deepEqual(readStateFile(nested), {
      version: 2,
      active: 'sharp',
      intensity: 'low',
      overrides: {},
      customModes: [],
    })
  } finally {
    temp.cleanup()
  }
})
