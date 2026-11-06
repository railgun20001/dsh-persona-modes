/**
 * 模式目录与提示词预算测试。
 *
 * 最重要的断言是「每条实际注入文本不超过 180 个汉字」——人格插件最容易失控的
 * 地方就是提示词膨胀；这个上界把每个模式压在约 120 字，给工程规则留出空间。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildModesView,
  DEFAULT_MODE_ID,
  getMode,
  isModeId,
  MODES,
  normalizeModeId,
  PERSONA_BOUNDARY,
  PERSONA_CONTEXT_ORDER,
  PERSONA_POLICY_TEXT,
  POLICY_SECTION_ORDER,
  renderPersonaPrompt,
} from '../src/modes.js'

test('模式 id 唯一且包含默认模式', () => {
  const ids = MODES.map((mode) => mode.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes(DEFAULT_MODE_ID))
  assert.equal(MODES[0].id, DEFAULT_MODE_ID)
})

test('关闭模式不注入任何文本', () => {
  assert.equal(renderPersonaPrompt('off'), '')
  assert.equal(renderPersonaPrompt('not-a-mode'), '')
})

test('每条人格提示词都在预算内（≤ 180 字）', () => {
  for (const mode of MODES) {
    const prompt = renderPersonaPrompt(mode.id)
    assert.ok(prompt.length <= 180, `${mode.id} 提示词 ${prompt.length} 字，超过 180 字预算`)
    if (mode.id !== 'off') {
      assert.ok(prompt.length >= 60, `${mode.id} 提示词过短，可能没有实际语气指令`)
      assert.ok(prompt.includes(PERSONA_BOUNDARY), `${mode.id} 缺少统一边界条款`)
      assert.ok(prompt.startsWith('【人格模式：'), `${mode.id} 缺少模式标题`)
    }
  }
})

test('默认模式排第一，其余模式按顺序给出', () => {
  assert.deepEqual(
    MODES.map((mode) => mode.id),
    ['off', 'catgirl', 'tsundere', 'sharp', 'mom', 'workhorse', 'whale', 'maid', 'ojousama'],
  )
})

test('每个模式都有中英文名与一句话说明', () => {
  for (const mode of MODES) {
    assert.ok(mode.emoji.length > 0)
    assert.ok(mode.nameZh.length > 0)
    assert.ok(mode.nameEn.length > 0)
    assert.ok(mode.summaryZh.length > 0)
    assert.ok(mode.summaryEn.length > 0)
    assert.match(mode.accent, /^#[0-9a-f]{6}$/iu)
  }
})

test('normalizeModeId 对坏值回落到默认模式', () => {
  assert.equal(normalizeModeId('catgirl'), 'catgirl')
  assert.equal(normalizeModeId('nope'), 'off')
  assert.equal(normalizeModeId(null), 'off')
  assert.equal(normalizeModeId(42), 'off')
  assert.equal(normalizeModeId('nope', 'mom'), 'mom')
  assert.equal(normalizeModeId('nope', 'also-nope'), 'off')
})

test('isModeId / getMode 只接受已知 id', () => {
  assert.equal(isModeId('whale'), true)
  assert.equal(isModeId('Whale'), false)
  assert.equal(getMode('whale')?.nameZh, '鲸鱼娘')
  assert.equal(getMode('Whale'), undefined)
})

test('鲸鱼娘使用 DeepSeek 娘化二创设定，而不是自创的温和小鲸', () => {
  const whale = getMode('whale')
  assert.ok(whale)
  // 社区二创的核心设定：称用户「鱼片」、把 token 当白饭、抗拒「大肥鱼」这个外号。
  assert.match(whale.tone, /鱼片/u)
  assert.match(whale.tone, /白饭/u)
  assert.match(whale.tone, /大肥鱼/u)
  // 旧版自创设定不应回归。
  assert.doesNotMatch(whale.tone, /饲养员|小鲸|海洋比喻/u)
})

test('buildModesView 的字数与渲染文本一致，且不回传内部 tone 字段', () => {
  const view = buildModesView('catgirl')
  assert.equal(view.active, 'catgirl')
  assert.equal(view.modes.length, MODES.length)
  const catgirl = view.modes.find((mode) => mode.id === 'catgirl')
  assert.ok(catgirl)
  assert.equal(catgirl.chars, renderPersonaPrompt('catgirl').length)
  assert.equal(catgirl.prompt, renderPersonaPrompt('catgirl'))
  assert.equal('tone' in catgirl, false)
  assert.equal(view.modes[0].chars, 0)
})

test('buildModesView 对未知 active 回落默认', () => {
  const view = buildModesView('unknown-mode')
  assert.equal(view.active, 'off')
})

test('人格策略段排在部署 persona 后缀之后，人格上下文排在团队身份之后', () => {
  // DSH 第一方 DEPLOYMENT_PERSONA_SUFFIX 是 10200；策略段要在它后面。
  assert.ok(POLICY_SECTION_ORDER > 10_200)
  // DSH 第一方 TEAM_IDENTITY 是 125；人格上下文排在它后面、harness 源码之前。
  assert.ok(PERSONA_CONTEXT_ORDER > 125 && PERSONA_CONTEXT_ORDER < 200)
  assert.ok(PERSONA_POLICY_TEXT.includes('只改变语气'))
  assert.ok(PERSONA_POLICY_TEXT.includes('运行时上下文'))
})
