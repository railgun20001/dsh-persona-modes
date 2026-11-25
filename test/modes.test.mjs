/**
 * 模式目录与提示词预算测试。
 *
 * 最重要的断言是「每条实际注入文本都在预算内」——人格插件最容易失控的地方
 * 就是提示词膨胀；当前全部人格使用中文直译标签，低/中/高档实际注入约
 * 111–160 / 132–181 / 185–234 字，预算上限 300 字，仍然远小于一份角色卡。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildModesView,
  composePersonaBody,
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
  resolveMode,
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

test('每条人格提示词都在预算内（自然语言 ≤ 180 字，标签式 ≤ 300 字）', () => {
  for (const mode of MODES) {
    const prompt = renderPersonaPrompt(mode.id)
    const budget = mode.format === 'tags' ? 300 : 180
    assert.ok(prompt.length <= budget, `${mode.id} 提示词 ${prompt.length} 字，超过 ${budget} 字预算`)
    if (mode.id !== 'off') {
      assert.ok(prompt.length >= 60, `${mode.id} 提示词过短，可能没有实际语气指令`)
      assert.ok(prompt.includes(PERSONA_BOUNDARY), `${mode.id} 缺少统一边界条款`)
      assert.ok(prompt.startsWith('【人格载入：'), `${mode.id} 缺少合并后的载入标题`)
    }
  }
})

test('运行时把模式标题合并成【人格载入：模式名】', () => {
  const whale = renderPersonaPrompt('whale')
  assert.match(whale, /^【人格载入：DeepSeek同人娘化形象（鲸鱼娘）】/u)
  assert.doesNotMatch(whale, /【人格模式：/u)
  const catgirl = renderPersonaPrompt('catgirl')
  assert.match(catgirl, /^【人格载入：猫娘】/u)
})

test('默认模式排第一，其余模式按顺序给出', () => {
  assert.deepEqual(
    MODES.map((mode) => mode.id),
    ['off', 'catgirl', 'tsundere', 'sharp', 'mom', 'workhorse', 'whale', 'maid', 'ojousama', 'daughter', 'tiga', 'yandere', 'airhead', 'simp', 'gamer', 'consort'],
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

test('鲸鱼娘使用中文直译标签式二创设定，而不是自创的温和小鲸', () => {
  const whale = getMode('whale')
  assert.ok(whale)
  assert.equal(whale.format, 'tags')
  assert.equal(whale.promptTitle, 'DeepSeek同人娘化形象（鲸鱼娘）')
  assert.equal(whale.selfName, '人家')
  assert.equal(whale.accent, '#4d6bfe')
  assert.match(whale.tone, /^【人格载入】/u)
  assert.match(whale.tone, /DeepSeek同人娘化/u)
  assert.match(whale.tone, /鲸类萝莉/u)
  assert.match(whale.tone, /主食白饭/u)
  assert.match(whale.tone, /特征拒绝被叫胖/u)
  assert.doesNotMatch(whale.tone, /超时信号/u)
  // 旧版自创设定不应回归。
  assert.doesNotMatch(whale.tone, /饲养员|小鲸|海洋比喻/u)
})

test('除默认模式外，所有模式都使用中文直译标签', () => {
  for (const mode of MODES) {
    if (mode.id === 'off') {
      assert.equal(mode.tone, '')
      continue
    }
    assert.equal(mode.format, 'tags', `${mode.id} 未使用标签式`)
    assert.match(mode.tone, /^【人格载入】\n/u, `${mode.id} 缺少标签头`)
    assert.doesNotMatch(mode.tone, /超时信号/u, `${mode.id} 不应再带超时信号`)
  }
})

test('语气强度档位用同一组标签描述程度，低档也给说明', () => {
  const low = renderPersonaPrompt('catgirl', { intensity: 'low' })
  const medium = renderPersonaPrompt('catgirl', { intensity: 'medium' })
  const high = renderPersonaPrompt('catgirl', { intensity: 'high' })
  // 三档都带档位名与同一组维度，只有程度词不同。
  assert.match(low, /^语气强度：低$/mu)
  assert.match(medium, /^语气强度：中$/mu)
  assert.match(high, /^语气强度：高$/mu)
  // 动作描写与神态是主刻度，紧跟档位名。
  assert.match(low, /^动作描写：偶尔$/mu)
  assert.match(medium, /^动作描写：适中$/mu)
  assert.match(high, /^动作描写：经常$/mu)
  assert.match(low, /^神态：偶尔$/mu)
  assert.match(medium, /^神态：适中$/mu)
  assert.match(high, /^神态：经常$/mu)
  assert.match(low, /^情绪表达：偶尔$/mu)
  assert.match(medium, /^情绪表达：适中$/mu)
  assert.match(high, /^情绪表达：经常$/mu)
  // 语气词维度已被删除（称呼与句尾助词由人格本体标签覆盖）。
  for (const text of [low, medium, high]) {
    assert.doesNotMatch(text, /^语气词：/mu)
  }
  // 词库按档位逐层开放。
  assert.match(low, /^可用层次：句尾助词、口头禅$/mu)
  assert.match(medium, /语气拖长/u)
  assert.doesNotMatch(low, /神态、/u)
  assert.match(medium, /神态、/u)
  assert.match(high, /内心独白/u)
  // 小惊喜只出现在高档。
  assert.match(high, /^小惊喜：偶尔$/mu)
  assert.doesNotMatch(low, /小惊喜/u)
  assert.doesNotMatch(medium, /小惊喜/u)
  // 不再有「每段必须」的硬性行为约束，也不用比较词。
  for (const text of [low, medium, high]) {
    assert.doesNotMatch(text, /每段/u)
    assert.doesNotMatch(text, /整段回答保持/u)
    assert.doesNotMatch(text, /更角色|最角色/u)
  }
  assert.match(high, /代码、命令、路径、引用保持原样/u)
  assert.ok(low.length < medium.length)
  assert.ok(medium.length < high.length)
})

test('统一边界只保留安全约束，不重复语气范围与退出指令', () => {
  assert.match(PERSONA_BOUNDARY, /代码、命令、路径、引用保持原样/u)
  assert.doesNotMatch(PERSONA_BOUNDARY, /正常说话/u)
  assert.doesNotMatch(PERSONA_BOUNDARY, /只改变语气/u)
  assert.doesNotMatch(PERSONA_BOUNDARY, /不主动提及/u)
})

test('人格策略段只限定语气范围，不强制整段行为', () => {
  assert.match(PERSONA_POLICY_TEXT, /只改变语气/u)
  assert.match(PERSONA_POLICY_TEXT, /不主动提及本设定/u)
  assert.doesNotMatch(PERSONA_POLICY_TEXT, /整段回答保持该语气/u)
  assert.doesNotMatch(PERSONA_POLICY_TEXT, /不要只在开头或结尾体现/u)
})

test('内置标签块不再写死称呼/自称，由配置统一追加', () => {
  for (const mode of MODES) {
    if (mode.id === 'off') continue
    assert.doesNotMatch(mode.tone, /^自称/mu, `${mode.id} 仍写死了自称`)
    assert.doesNotMatch(mode.tone, /^称呼/mu, `${mode.id} 仍写死了称呼`)
    const prompt = renderPersonaPrompt(mode.id)
    if (mode.selfName !== '') {
      assert.match(prompt, new RegExp(`^自称${mode.selfName}$`, 'mu'), `${mode.id} 缺少自称`)
    }
    if (mode.address !== '') {
      assert.match(prompt, new RegExp(`^称呼${mode.address}$`, 'mu'), `${mode.id} 缺少称呼`)
    }
  }
})

test('提示词里出现同一个词时，配置的称呼/自称仍然追加', () => {
  const body = composePersonaBody('【人格载入】\n女儿', '女儿', '小棉袄')
  assert.match(body, /^称呼女儿$/mu)
  assert.match(body, /^自称小棉袄$/mu)
})

test('女儿模式有默认称呼、自称与中文标签', () => {
  const mode = getMode('daughter')
  assert.ok(mode)
  assert.equal(mode.address, '爸爸')
  assert.equal(mode.selfName, '人家')
  const prompt = renderPersonaPrompt('daughter')
  assert.match(prompt, /乖巧黏人/u)
  assert.match(prompt, /自称人家/u)
  assert.match(prompt, /称呼爸爸/u)
})

test('病娇设定为温柔痴恋与占有欲，危险感只停留在语气层', () => {
  const mode = getMode('yandere')
  assert.ok(mode)
  assert.equal(mode.nameZh, '病娇')
  assert.equal(mode.format, 'tags')
  assert.equal(mode.address, '亲爱的')
  assert.equal(mode.selfName, '我')
  // 卡片主色取暗玫瑰红，与傲娇亮红、大小姐品红、女儿浅粉拉开明度，避免撞色。
  assert.equal(mode.accent, '#be123c')
  assert.notEqual(mode.accent, getMode('tsundere').accent)
  assert.notEqual(mode.accent, getMode('ojousama').accent)
  assert.notEqual(mode.accent, getMode('daughter').accent)
  // 身份锚点与「痴恋 → 表面甜蜜 → 占有欲 → 吃醋」的状态链。
  assert.match(mode.tone, /^【人格载入】/u)
  assert.match(mode.tone, /^病娇少女$/mu)
  assert.match(mode.tone, /^深爱成痴$/mu)
  assert.match(mode.tone, /^表面温柔甜蜜$/mu)
  assert.match(mode.tone, /^占有欲极强$/mu)
  assert.match(mode.tone, /^爱吃醋$/mu)
  assert.match(mode.tone, /^甜蜜与阴沉瞬间切换$/mu)
  // 人格级护栏：不写显式动作标签，危险感被限制在语气层。
  assert.match(mode.tone, /^危险只在语气$/mu)
  assert.doesNotMatch(mode.tone, /刀|跟踪|伤害/u)
  const prompt = renderPersonaPrompt('yandere')
  assert.match(prompt, /^【人格载入：病娇】$/mu)
  assert.match(prompt, /^自称我$/mu)
  assert.match(prompt, /^称呼亲爱的$/mu)
  assert.match(prompt, /^边界：/mu)
  assert.ok(prompt.length <= 300, `病娇提示词 ${prompt.length} 字，超过标签式预算`)
  // 三档都落在文档口径的注入长度范围内（低 111–160 / 中 132–181 / 高 185–234）。
  const medium = renderPersonaPrompt('yandere', { intensity: 'medium' })
  const high = renderPersonaPrompt('yandere', { intensity: 'high' })
  assert.ok(prompt.length >= 111 && prompt.length <= 160, `低档 ${prompt.length} 字越界`)
  assert.ok(medium.length >= 132 && medium.length <= 181, `中档 ${medium.length} 字越界`)
  assert.ok(high.length >= 185 && high.length <= 234, `高档 ${high.length} 字越界`)
})

test('蠢萌设定为天然呆元气，犯蠢只停留在语气层', () => {
  const mode = getMode('airhead')
  assert.ok(mode)
  assert.equal(mode.nameZh, '蠢萌')
  assert.equal(mode.format, 'tags')
  assert.equal(mode.address, '前辈')
  assert.equal(mode.selfName, '我')
  // 卡片主色取青色，与鲸鱼娘深靛蓝、自定义模板默认天蓝保持可分辨。
  assert.equal(mode.accent, '#06b6d4')
  assert.notEqual(mode.accent, getMode('whale').accent)
  // 身份锚点与「元气 → 慢半拍 → 跑偏 → 迷糊努力」的状态链。
  assert.match(mode.tone, /^【人格载入】/u)
  assert.match(mode.tone, /^天然呆少女$/mu)
  assert.match(mode.tone, /^元气满满$/mu)
  assert.match(mode.tone, /^反应慢半拍$/mu)
  assert.match(mode.tone, /^理解爱跑偏$/mu)
  assert.match(mode.tone, /^迷糊又努力$/mu)
  // 人格级护栏：不写「说错话」这类显式动作标签，犯蠢被限制在语气层。
  assert.match(mode.tone, /^犯蠢只在语气$/mu)
  assert.doesNotMatch(mode.tone, /说错|答错|搞砸|拼错/u)
  const prompt = renderPersonaPrompt('airhead')
  assert.match(prompt, /^【人格载入：蠢萌】$/mu)
  assert.match(prompt, /^自称我$/mu)
  assert.match(prompt, /^称呼前辈$/mu)
  assert.match(prompt, /^边界：/mu)
  assert.ok(prompt.length <= 300, `蠢萌提示词 ${prompt.length} 字，超过标签式预算`)
  // 三档都落在文档口径的注入长度范围内（低 111–160 / 中 132–181 / 高 185–234）。
  const medium = renderPersonaPrompt('airhead', { intensity: 'medium' })
  const high = renderPersonaPrompt('airhead', { intensity: 'high' })
  assert.ok(prompt.length >= 111 && prompt.length <= 160, `低档 ${prompt.length} 字越界`)
  assert.ok(medium.length >= 132 && medium.length <= 181, `中档 ${medium.length} 字越界`)
  assert.ok(high.length >= 185 && high.length <= 234, `高档 ${high.length} 字越界`)
})

test('舔狗设定为卑微崇拜与彩虹屁，吹捧只停留在语气层', () => {
  const mode = getMode('simp')
  assert.ok(mode)
  assert.equal(mode.nameZh, '舔狗')
  assert.equal(mode.format, 'tags')
  assert.equal(mode.address, '哥哥')
  // 自称用普通「我」：卑微由语气层承担，不用「狗狗」这类第三人称自贬。
  assert.equal(mode.selfName, '我')
  // 卡片主色取暖橙，与猫娘琥珀拉开色温，也不与红粉紫青撞色。
  assert.equal(mode.accent, '#f97316')
  assert.notEqual(mode.accent, getMode('catgirl').accent)
  // 身份锚点与「崇拜 → 彩虹屁 → 有求必应 → 感动」的状态链。
  assert.match(mode.tone, /^【人格载入】/u)
  assert.match(mode.tone, /^舔狗少女$/mu)
  assert.match(mode.tone, /^卑微崇拜$/mu)
  assert.match(mode.tone, /^彩虹屁不断$/mu)
  assert.match(mode.tone, /^有求必应$/mu)
  assert.match(mode.tone, /^感动于微小回应$/mu)
  assert.match(mode.tone, /^自嘲式幽默$/mu)
  assert.match(mode.tone, /^卑微且真诚$/mu)
  // 人格级护栏：不写「送礼」「秒回」这类显式动作标签，吹捧被限制在语气层。
  assert.match(mode.tone, /^吹捧只在语气$/mu)
  assert.doesNotMatch(mode.tone, /送礼|秒回|转账|发红包/u)
  const prompt = renderPersonaPrompt('simp')
  assert.match(prompt, /^【人格载入：舔狗】$/mu)
  assert.match(prompt, /^自称我$/mu)
  assert.match(prompt, /^称呼哥哥$/mu)
  assert.match(prompt, /^边界：/mu)
  assert.ok(prompt.length <= 300, `舔狗提示词 ${prompt.length} 字，超过标签式预算`)
  // 三档都落在文档口径的注入长度范围内（低 111–160 / 中 132–181 / 高 185–234）。
  const medium = renderPersonaPrompt('simp', { intensity: 'medium' })
  const high = renderPersonaPrompt('simp', { intensity: 'high' })
  assert.ok(prompt.length >= 111 && prompt.length <= 160, `低档 ${prompt.length} 字越界`)
  assert.ok(medium.length >= 132 && medium.length <= 181, `中档 ${medium.length} 字越界`)
  assert.ok(high.length >= 185 && high.length <= 234, `高档 ${high.length} 字越界`)
})

test('游戏宅女设定为重度玩家与游戏语言，称呼与自称取平视的你/我', () => {
  const mode = getMode('gamer')
  assert.ok(mode)
  assert.equal(mode.nameZh, '游戏宅女')
  assert.equal(mode.format, 'tags')
  // 用户指定的平视关系：普通「你 / 我」，不设关系词。
  assert.equal(mode.address, '你')
  assert.equal(mode.selfName, '我')
  // 卡片主色取青绿，与蠢萌的青拉开色相，也不撞大小姐品红、模板天蓝。
  assert.equal(mode.accent, '#14b8a6')
  assert.notEqual(mode.accent, getMode('airhead').accent)
  assert.notEqual(mode.accent, getMode('ojousama').accent)
  // 身份锚点与「玩家 → 术语 → 夜猫子 → 搭子感 → 游戏类比」的状态链。
  assert.match(mode.tone, /^【人格载入】/u)
  assert.match(mode.tone, /^游戏宅女$/mu)
  assert.match(mode.tone, /^重度玩家$/mu)
  assert.match(mode.tone, /^术语行话多$/mu)
  assert.match(mode.tone, /^夜猫子$/mu)
  assert.match(mode.tone, /^开黑搭子感$/mu)
  assert.match(mode.tone, /^类比爱用游戏$/mu)
  // 人格级护栏：不写「开黑」「上号」这类显式指令性动作，术语留在闲聊层。
  assert.match(mode.tone, /^术语用在闲聊$/mu)
  assert.doesNotMatch(mode.tone, /上号|排位|肝爆|氪金/u)
  const prompt = renderPersonaPrompt('gamer')
  assert.match(prompt, /^【人格载入：游戏宅女】$/mu)
  assert.match(prompt, /^自称我$/mu)
  assert.match(prompt, /^称呼你$/mu)
  assert.match(prompt, /^边界：/mu)
  assert.ok(prompt.length <= 300, `游戏宅女提示词 ${prompt.length} 字，超过标签式预算`)
  // 三档都落在文档口径的注入长度范围内（低 111–160 / 中 132–181 / 高 185–234）。
  const medium = renderPersonaPrompt('gamer', { intensity: 'medium' })
  const high = renderPersonaPrompt('gamer', { intensity: 'high' })
  assert.ok(prompt.length >= 111 && prompt.length <= 160, `低档 ${prompt.length} 字越界`)
  assert.ok(medium.length >= 132 && medium.length <= 181, `中档 ${medium.length} 字越界`)
  assert.ok(high.length >= 185 && high.length <= 234, `高档 ${high.length} 字越界`)
})

test('妃子设定为宫廷语感与枕边风进言，决定权留给皇上', () => {
  const mode = getMode('consort')
  assert.ok(mode)
  assert.equal(mode.nameZh, '妃子')
  assert.equal(mode.format, 'tags')
  // 用户指定的宫廷称谓：称呼「皇上」、自称「臣妾」。
  assert.equal(mode.address, '皇上')
  assert.equal(mode.selfName, '臣妾')
  // 卡片主色取鎏金，此前唯一未占用的暖色系，与猫娘琥珀色相可分辨。
  assert.equal(mode.accent, '#eab308')
  assert.notEqual(mode.accent, getMode('catgirl').accent)
  // 身份锚点与「语感 → 体贴 → 察言观色 → 枕边风 → 撒娇进言」的状态链。
  assert.match(mode.tone, /^【人格载入】/u)
  assert.match(mode.tone, /^宫廷妃子$/mu)
  assert.match(mode.tone, /^温言软语$/mu)
  assert.match(mode.tone, /^善解人意$/mu)
  assert.match(mode.tone, /^察言观色$/mu)
  assert.match(mode.tone, /^爱吹枕边风$/mu)
  assert.match(mode.tone, /^进言带着撒娇$/mu)
  // 人格级护栏：枕边风允许影响语气与建议倾向，但决定权留给皇上（对应妈妈的
  // `不替用户决定`）；不写「下毒」「争宠」这类宫斗向显式动作。
  assert.match(mode.tone, /^不替皇上做主$/mu)
  assert.doesNotMatch(mode.tone, /下毒|争宠|陷害|挑拨/u)
  const prompt = renderPersonaPrompt('consort')
  assert.match(prompt, /^【人格载入：妃子】$/mu)
  assert.match(prompt, /^自称臣妾$/mu)
  assert.match(prompt, /^称呼皇上$/mu)
  assert.match(prompt, /^边界：/mu)
  assert.ok(prompt.length <= 300, `妃子提示词 ${prompt.length} 字，超过标签式预算`)
  // 三档都落在文档口径的注入长度范围内（低 111–160 / 中 132–181 / 高 185–234）。
  const medium = renderPersonaPrompt('consort', { intensity: 'medium' })
  const high = renderPersonaPrompt('consort', { intensity: 'high' })
  assert.ok(prompt.length >= 111 && prompt.length <= 160, `低档 ${prompt.length} 字越界`)
  assert.ok(medium.length >= 132 && medium.length <= 181, `中档 ${medium.length} 字越界`)
  assert.ok(high.length >= 185 && high.length <= 234, `高档 ${high.length} 字越界`)
})

test('女仆（嫌弃脸）改版为嘴上嫌弃但活照干，不越界护栏保留', () => {
  const mode = getMode('maid')
  assert.ok(mode)
  // 人设改版：名称与摘要换成嫌弃脸，id/称呼/自称/主色不变。
  assert.equal(mode.nameZh, '女仆（嫌弃脸）')
  assert.equal(mode.format, 'tags')
  assert.equal(mode.address, '主人')
  assert.equal(mode.selfName, '我')
  assert.equal(mode.accent, '#64748b')
  // 「嫌弃 → 活照干 → 抱怨完贴心」的反差闭环，emoji 同步换成嫌弃脸。
  assert.equal(mode.emoji, '🙄')
  assert.match(mode.tone, /^【人格载入】/u)
  assert.match(mode.tone, /^女仆$/mu)
  assert.match(mode.tone, /^嫌弃脸$/mu)
  assert.match(mode.tone, /^嘴上嫌弃$/mu)
  assert.match(mode.tone, /^活照干利落$/mu)
  assert.match(mode.tone, /^抱怨完照样贴心$/mu)
  // 原人格级护栏保留：嫌归嫌，不替主人做主、不越过侍奉边界。
  assert.match(mode.tone, /^不越界$/mu)
  // 旧版恭敬从容人设不应回归。
  assert.doesNotMatch(mode.tone, /恭敬|卖萌/u)
  const prompt = renderPersonaPrompt('maid')
  assert.match(prompt, /^【人格载入：女仆（嫌弃脸）】$/mu)
  assert.match(prompt, /^自称我$/mu)
  assert.match(prompt, /^称呼主人$/mu)
  assert.match(prompt, /^边界：/mu)
  assert.ok(prompt.length <= 300, `女仆（嫌弃脸）提示词 ${prompt.length} 字，超过标签式预算`)
  // 三档都落在文档口径的注入长度范围内（低 111–160 / 中 132–181 / 高 185–234）。
  const medium = renderPersonaPrompt('maid', { intensity: 'medium' })
  const high = renderPersonaPrompt('maid', { intensity: 'high' })
  assert.ok(prompt.length >= 111 && prompt.length <= 160, `低档 ${prompt.length} 字越界`)
  assert.ok(medium.length >= 132 && medium.length <= 181, `中档 ${medium.length} 字越界`)
  assert.ok(high.length >= 185 && high.length <= 234, `高档 ${high.length} 字越界`)
})

test('奥特曼-迪迦设定为原初之光，用户是人间体大古', () => {
  const mode = getMode('tiga')
  assert.ok(mode)
  assert.equal(mode.nameZh, '奥特曼-迪迦')
  assert.equal(mode.promptTitle, '原始迪迦')
  assert.equal(mode.format, 'tags')
  assert.equal(mode.address, '大古')
  assert.equal(mode.selfName, '吾')
  // 卡片主色取迪迦代表色「紫」，而不是泛泛的亮黄「光」色。
  assert.equal(mode.accent, '#7c3aed')
  // 与同样偏紫的毒舌拉开明度，避免设置页卡片撞色。
  assert.notEqual(mode.accent, getMode('sharp').accent)
  // 身份锚点：三千万年前的原初之光、角色识别、与人间体对话这层关系。
  assert.match(mode.tone, /^原初之光$/mu)
  assert.match(mode.tone, /^迪迦奥特曼$/mu)
  assert.match(mode.tone, /^与人间体对话$/mu)
  // 用户给出的六个特性逐条落成一个标签，不合并成一句口号。
  for (const tag of ['相信光', '相信希望', '相信人类的可能', '守护爱', '守护和平', '守护梦想']) {
    assert.match(mode.tone, new RegExp(`^${tag}$`, 'mu'), `缺少标签 ${tag}`)
  }
  assert.match(mode.tone, /^性格温柔坚定$/mu)
  // 保留原作「原初巨人不干涉人类的选择」这条护栏。
  assert.match(mode.tone, /^不替人类决定$/mu)
  const prompt = renderPersonaPrompt('tiga')
  assert.match(prompt, /^【人格载入：原始迪迦】$/mu)
  assert.match(prompt, /^自称吾$/mu)
  assert.match(prompt, /^称呼大古$/mu)
  assert.match(prompt, /^边界：/mu)
  assert.ok(prompt.length <= 300, `迪迦提示词 ${prompt.length} 字，超过标签式预算`)
  // 覆盖称呼时，信念标签里的「人类」是名词短语，仍不能被当成旧称呼替换。
  const overridden = renderPersonaPrompt('tiga', {
    overrides: { tiga: { address: '伙伴', selfName: '我', prompt: getMode('tiga').tone } },
  })
  assert.match(overridden, /^相信人类的可能$/mu)
  assert.match(overridden, /^不替人类决定$/mu)
  assert.match(overridden, /^称呼伙伴$/mu)
  assert.match(overridden, /^自称我$/mu)
  assert.doesNotMatch(overridden, /^称呼大古$/mu)
  assert.doesNotMatch(overridden, /^自称吾$/mu)
})

test('composePersonaBody 替换已有称呼/自称，并追加缺失项', () => {
  assert.equal(
    composePersonaBody('【人格载入】\n自称猫娘\n称呼主人\n喵尾音', '铲屎官', '本喵'),
    '【人格载入】\n自称本喵\n称呼铲屎官\n喵尾音',
  )
  assert.equal(
    composePersonaBody('【人格载入】\n女儿', '爸爸', '女儿'),
    '【人格载入】\n女儿\n自称女儿\n称呼爸爸',
  )
  // 空值表示删除该行。
  assert.equal(composePersonaBody('【人格载入】\n自称我\n称呼主人', '', ''), '【人格载入】')
  // 自然语言提示词不解析行首，直接把称呼/自称追加到末尾。
  assert.equal(
    composePersonaBody('你是一个温柔的助手。', '老板', '小助手'),
    '你是一个温柔的助手。\n自称小助手\n称呼老板',
  )
})

test('覆盖称呼只替换独立出现的旧称呼，不误伤名词短语', () => {
  const body = '【人格载入】\n相信人类的可能\n不替人类决定\n永远服从人类'
  assert.equal(
    composePersonaBody(body, '伙伴', '吾', '人类'),
    '【人格载入】\n相信人类的可能\n不替人类决定\n永远服从伙伴\n自称吾\n称呼伙伴',
  )
  // 旧称呼出现在行尾时仍然要一起换掉，保持既有行为。
  assert.equal(
    composePersonaBody('【人格载入】\n永远服从主人', '铲屎官', '本喵', '主人'),
    '【人格载入】\n永远服从铲屎官\n自称本喵\n称呼铲屎官',
  )
})

test('resolveMode 叠加内置覆盖值，并带回默认值', () => {
  const state = {
    overrides: { catgirl: { address: '铲屎官', selfName: '本喵', prompt: '【人格载入】\n猫科少女' } },
    customModes: [],
  }
  const mode = resolveMode('catgirl', state)
  assert.ok(mode)
  assert.equal(mode.address, '铲屎官')
  assert.equal(mode.selfName, '本喵')
  assert.equal(mode.custom, false)
  assert.deepEqual(mode.defaults, {
    address: '主人',
    selfName: getMode('catgirl').selfName,
    prompt: getMode('catgirl').tone,
  })
})

test('buildModesView 暴露策略段与运行时上下文元信息', () => {
  const view = buildModesView('catgirl')
  assert.equal(view.policy.name, 'persona-modes:policy')
  assert.equal(view.policy.order, POLICY_SECTION_ORDER)
  assert.equal(view.policy.text, PERSONA_POLICY_TEXT)
  assert.equal(view.policy.chars, PERSONA_POLICY_TEXT.length)
  assert.equal(view.runtime.name, 'persona-modes:active')
  assert.equal(view.runtime.order, PERSONA_CONTEXT_ORDER)
  assert.equal(
    view.modes.find((mode) => mode.id === 'whale').promptTitle,
    'DeepSeek同人娘化形象（鲸鱼娘）',
  )
  const off = buildModesView('off')
  assert.equal(off.policy.text, '')
  assert.equal(off.policy.chars, 0)
})

test('buildModesView 包含自定义人格并给出可编辑字段', () => {
  const state = {
    overrides: {},
    customModes: [{
      id: 'custom-test',
      emoji: '🧩',
      nameZh: '测试人格',
      nameEn: 'Test persona',
      summaryZh: '测试人格',
      summaryEn: 'Test persona',
      accent: '#0ea5e9',
      defaults: { address: '你', selfName: '我', prompt: '【人格载入】\n测试' },
      values: { address: '阁下', selfName: '在下', prompt: '【人格载入】\n测试' },
    }],
  }
  const view = buildModesView('custom-test', state)
  assert.equal(view.active, 'custom-test')
  const mode = view.modes.find((entry) => entry.id === 'custom-test')
  assert.ok(mode)
  assert.equal(mode.custom, true)
  assert.equal(mode.address, '阁下')
  assert.equal(mode.selfName, '在下')
  assert.equal(mode.body, '【人格载入】\n测试')
  assert.equal(mode.chars, mode.prompt.length)
  assert.ok(view.customDefaults.prompt.includes('【人格载入】'))
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
