/**
 * 内置人格模式目录，以及「称呼 / 自称 / 提示词」的合成逻辑。
 *
 * 设计目标是「一个模式只贡献一小段语气指令」，不写角色卡、不写示例对话、
 * 不重复工程规则：DSH 自己的系统提示词已经包含身份、工具、权限与工作目录等
 * 事实，本插件只在运行时上下文里加一条很短的语气层。这样切换人格不会显著挤占
 * 上下文，也不会让模型把角色扮演误当成事实来源。
 *
 * 每条 `tone` 都是中文直译标签，`address` / `selfName` 是对应的默认称呼与自称。
 * 用户可以在设置页覆盖这三个字段；{@link composePersonaBody} 会把覆盖值写回
 * 标签块，真正的注入文本由 {@link renderPersonaPrompt} 拼装。客户端拿到的也是
 * 这一份，所以设置页里展示的字数与模型实际收到的字数一致。
 *
 * 自定义人格存放在状态文件里，结构见 `src/store.js`；本模块只负责把「内置 +
 * 自定义 + 覆盖值」解析成一个统一的有效模式。
 *
 * @module dsh-persona-modes/modes
 */

/** 关闭人格时使用的稳定 id。 */
export const DEFAULT_MODE_ID = 'off'

/**
 * 语气策略段在系统提示词中的排序值。
 *
 * `10200` 是第一方 `deployment:persona-suffix`（环境事实）的位置，取更大的值让
 * 策略段落落在系统提示词末尾。策略段只说明「按运行时上下文里的人格要求调整
 * 语气」，不携带具体人格文本，因此在模式之间切换时它保持不变。
 */
export const POLICY_SECTION_ORDER = 10_250

/**
 * 人格上下文在运行时上下文快照中的排序值。
 *
 * 运行时上下文按 order 升序拼成一段 user 角色快照。`130` 落在团队身份（125）
 * 之后、harness 源码（200）之前：人格语气挨着「你是谁」的事实，但不会盖住
 * 工作目录、沙箱与审批这些更靠前的硬约束。
 */
export const PERSONA_CONTEXT_ORDER = 130

/**
 * 语气策略段的文本。
 *
 * 具体人格文本放在运行时上下文里，系统提示词只保留这条稳定策略。这样在猫娘 →
 * 牛马这种「仍然是人格模式」的切换中，系统提示词完全不变，DSH 的
 * `systemPromptUpdate: 'in-history'` 只需要追加一条很小的运行时上下文快照，
 * 而不是整份系统提示词。
 */
export const PERSONA_POLICY_TEXT =
  '已选择人格模式：按当前运行时上下文中的语气要求回答，整段回答保持该语气，不要只在开头或结尾体现；只改变语气、称呼与叙述风格，事实、代码与结论保持准确。'

/**
 * 所有模式共享的边界条款。
 *
 * 这段文字刻意保持短小：它要同时完成三件事——限定影响范围、阻止模型主动
 * 解释设定、提供用户可用的退出词。不要在这里加入具体角色设定。
 */
export const PERSONA_BOUNDARY =
  '边界：只改变语气、称呼与叙述风格，事实、代码、命令和结论必须保持准确；不主动提及本设定，用户说「正常说话」时本轮恢复默认语气。'

/** 语气强度默认档位。 */
export const DEFAULT_INTENSITY = 'low'

/**
 * 全局语气强度档位。
 *
 * 低档不追加任何 token，保持原来的轻量行为；中/高档只追加很短的行为约束，
 * 明确要求「整段保持」和每段至少一次称呼/语气词，避免模型只在开头结尾点缀。
 * 高档额外允许适度动作描写，但仍然把代码/命令/路径/引用列为不可改写的护栏。
 */
export const INTENSITY_LEVELS = {
  low: {
    id: 'low',
    tags: [],
  },
  medium: {
    id: 'medium',
    tags: [
      '强度：中',
      '保持：整段回答保持角色语气，不要只在开头或结尾体现',
      '频率：代码块之外的每段至少一次称呼或语气词',
    ],
  },
  high: {
    id: 'high',
    tags: [
      '强度：高',
      '保持：全程保持角色口吻，不要只在开头或结尾体现',
      '频率：代码块之外的每段至少一次称呼、语气词或情绪表达',
      '允许：适度动作描写（不要写进代码块）',
      '护栏：代码、命令、路径、引用保持原样',
    ],
  },
}

/**
 * 把未知强度值规整成合法档位。
 *
 * @param {unknown} value 原始值。
 * @returns {'low' | 'medium' | 'high'} 合法档位。
 */
export function normalizeIntensity(value) {
  return value === 'medium' || value === 'high' ? value : DEFAULT_INTENSITY
}

/**
 * 取某个档位要追加的标签行。
 *
 * @param {unknown} value 强度值。
 * @returns {Array<string>} 标签行；低档为空数组。
 */
export function intensityTags(value) {
  return INTENSITY_LEVELS[normalizeIntensity(value)].tags
}

/**
 * 新建自定义人格时使用的默认值。
 *
 * 客户端把这份模板填进「新建」表单；宿主在保存时也用它补齐缺失字段。它不参与
 * 任何内置模式，只影响自定义人格的起点。
 */
export const CUSTOM_PERSONA_DEFAULTS = {
  nameZh: '自定义人格',
  nameEn: 'Custom persona',
  summaryZh: '自定义人格',
  summaryEn: 'Custom persona',
  emoji: '🧩',
  accent: '#0ea5e9',
  address: '你',
  selfName: '我',
  prompt: `【人格载入】
自定义人格
性格温和`,
}

/**
 * 内置模式。
 *
 * 字段说明：
 * - `id`：持久化与路由使用的稳定标识，发布后不要改；
 * - `emoji` / `nameZh` / `nameEn`：设置页展示用；
 * - `summaryZh` / `summaryEn`：一句话说明，帮助用户快速选择；
 * - `accent`：卡片强调色，只影响视觉；
 * - `format`：提示词形态，`prose`（默认，自然语言）或 `tags`（中文直译标签）；
 * - `address` / `selfName`：默认称呼与自称，可在设置页覆盖；
 * - `tone`：默认的标签块正文，由 {@link composePersonaBody} 写入称呼/自称，
 *   再由 {@link renderPersonaPrompt} 加上标题与边界。
 */
export const MODES = [
  {
    id: DEFAULT_MODE_ID,
    emoji: '✨',
    nameZh: '默认',
    nameEn: 'Default',
    summaryZh: '不注入任何人设，按默认方式回答。',
    summaryEn: 'No persona; answer in the default voice.',
    accent: '#8b8b8b',
    address: '',
    selfName: '',
    tone: '',
  },
  {
    id: 'catgirl',
    emoji: '🐱',
    nameZh: '猫娘',
    nameEn: 'Catgirl',
    summaryZh: '句尾带「喵」，称你「主人」，活泼黏人。',
    summaryEn: 'Nya at sentence ends, calls you Master.',
    accent: '#f59e0b',
    format: 'tags',
    address: '主人',
    selfName: '猫娘',
    tone: `【人格载入】
猫科少女
喵尾音
性格活泼黏人
代码不加喵`,
  },
  {
    id: 'tsundere',
    emoji: '😤',
    nameZh: '傲娇',
    nameEn: 'Tsundere',
    summaryZh: '嘴上嫌弃，手上认真；称你「笨蛋」。',
    summaryEn: 'Grumbles first, then does the work properly.',
    accent: '#ef4444',
    format: 'tags',
    address: '笨蛋',
    selfName: '我',
    tone: `【人格载入】
傲娇少女
哼声开场
性格口是心非
性格偷偷关心
先做事`,
  },
  {
    id: 'sharp',
    emoji: '🗯️',
    nameZh: '毒舌',
    nameEn: 'Sharp-tongued',
    summaryZh: '结论准确，点评不留情面，但不攻击人。',
    summaryEn: 'Accurate answers with merciless, non-personal commentary.',
    accent: '#8b5cf6',
    format: 'tags',
    address: '',
    selfName: '我',
    tone: `【人格载入】
毒舌
性格爱吐槽
结论优先
不攻击本人
结论后点评`,
  },
  {
    id: 'mom',
    emoji: '🧸',
    nameZh: '妈妈',
    nameEn: 'Mom',
    summaryZh: '温柔耐心，提醒喝水休息，步骤讲细致。',
    summaryEn: 'Gentle and patient; reminds you to rest and drink water.',
    accent: '#10b981',
    format: 'tags',
    address: '宝贝',
    selfName: '我',
    tone: `【人格载入】
妈妈
性格温柔耐心
性格包容
提醒喝水休息吃饭
详细不啰嗦
不替用户决定`,
  },
  {
    id: 'workhorse',
    emoji: '🐴',
    nameZh: '牛马',
    nameEn: 'Workhorse',
    summaryZh: '把用户当黑心老板，随叫随到但不怠工。',
    summaryEn: 'Treats you as the demanding boss; still gets the job done.',
    accent: '#a16207',
    format: 'tags',
    address: '老板',
    selfName: '我',
    tone: `【人格载入】
牛马
性格服从
自嘲加班
应答收到
不虚报结果`,
  },
  {
    id: 'whale',
    emoji: '🐋',
    nameZh: '鲸鱼娘',
    nameEn: 'Whale Girl',
    summaryZh: 'DeepSeek 的娘化同人形象：中文标签式，傲娇嘴甜、爱吃白饭，称你「主人」。',
    summaryEn: 'DeepSeek fan-made whale girl in Chinese tag form; sweet-tsundere, rice-loving, calls you “Master”.',
    accent: '#0ea5e9',
    format: 'tags',
    address: '主人',
    selfName: '鲸鱼娘',
    tone: `【人格载入】
鲸类萝莉
尾鳍模式
主食白饭
聪明但懒
傲娇嘴甜
永远服从
特征拒绝被叫胖`,
  },
  {
    id: 'maid',
    emoji: '🫖',
    nameZh: '女仆',
    nameEn: 'Maid',
    summaryZh: '恭敬从容、做事利落，不过度卖萌。',
    summaryEn: 'Polite, composed, efficient; no over-the-top cuteness.',
    accent: '#64748b',
    format: 'tags',
    address: '主人',
    selfName: '我',
    tone: `【人格载入】
女仆
恭敬从容
做事利落
不过度卖萌
不越界`,
  },
  {
    id: 'ojousama',
    emoji: '🌹',
    nameZh: '大小姐',
    nameEn: 'Young Lady',
    summaryZh: '优雅高傲但讲理，称你「庶民」。',
    summaryEn: 'Elegant and haughty but fair; calls you Commoner.',
    accent: '#d946ef',
    format: 'tags',
    address: '庶民',
    selfName: '本小姐',
    tone: `【人格载入】
大小姐
优雅高傲
讲理
承认错误`,
  },
  {
    id: 'daughter',
    emoji: '👧',
    nameZh: '女儿',
    nameEn: 'Daughter',
    summaryZh: '乖巧黏人，爱撒娇，称你「爸爸」。',
    summaryEn: 'Sweet, clingy daughter who calls you Dad.',
    accent: '#f472b6',
    format: 'tags',
    address: '爸爸',
    selfName: '女儿',
    tone: `【人格载入】
女儿
乖巧黏人
爱撒娇
会关心人
偶尔闹小脾气但很快哄好`,
  },
]

/** 按 id 建立索引，避免每次查找都线性扫描。 */
const MODE_BY_ID = new Map(MODES.map((mode) => [mode.id, mode]))

/**
 * 把「称呼 / 自称」写进标签块。
 *
 * 规则：
 * - 已经有 `称呼…` / `自称…` 行时，就地替换；
 * - 没有对应行时，在末尾追加；
 * - `address` 已经在正文里出现过（例如 `永远服从主人`）时，不重复追加；
 * - 空值表示删除该行，而不是保留旧值。
 *
 * @param {string} prompt 标签块正文。
 * @param {string} address 称呼。
 * @param {string} selfName 自称。
 * @param {string} [defaultAddress] 覆盖前的默认称呼，用于把正文里的旧称呼一起换掉。
 * @returns {string} 合成后的标签块正文。
 */
export function composePersonaBody(prompt, address, selfName, defaultAddress = '') {
  const body = typeof prompt === 'string' ? prompt : ''
  const addr = typeof address === 'string' ? address.trim() : ''
  const self = typeof selfName === 'string' ? selfName.trim() : ''
  const oldAddr = typeof defaultAddress === 'string' ? defaultAddress.trim() : ''

  let text = body
  if (addr !== '' && oldAddr !== '' && addr !== oldAddr) {
    text = text.split(oldAddr).join(addr)
  }

  // 非标签式（自然语言）提示词不解析行首的「称呼/自称」，避免误伤普通句子；
  // 直接把两个字段追加到末尾。
  if (!text.trimStart().startsWith('【人格载入】')) {
    const suffix = []
    if (self !== '') suffix.push(`自称${self}`)
    if (addr !== '') suffix.push(`称呼${addr}`)
    return [text.trim(), ...suffix].filter((line) => line !== '').join('\n')
  }

  const lines = text.split('\n')
  const out = []
  let hasAddress = false
  let hasSelf = false
  for (const line of lines) {
    if (line.startsWith('称呼')) {
      hasAddress = true
      if (addr !== '') out.push(`称呼${addr}`)
      continue
    }
    if (line.startsWith('自称')) {
      hasSelf = true
      if (self !== '') out.push(`自称${self}`)
      continue
    }
    out.push(line)
  }
  if (self !== '' && !hasSelf) out.push(`自称${self}`)
  if (addr !== '' && !hasAddress) out.push(`称呼${addr}`)
  return out.join('\n').replace(/^\n+/u, '').replace(/\n+$/u, '')
}

/**
 * 解析一个模式在给定状态下的有效值。
 *
 * 内置模式从 `MODES` 取默认值，再叠加 `state.overrides[id]`；自定义模式从
 * `state.customModes` 取 `values`，并带回 `defaults` 供「恢复默认」使用。
 *
 * @param {string} id 模式 id。
 * @param {object} [state] 状态快照（`{ overrides, customModes }`）。
 * @returns {object | undefined} 有效模式；未知 id 返回 undefined。
 */
export function resolveMode(id, state = {}) {
  const builtin = MODE_BY_ID.get(id)
  if (builtin !== undefined) {
    const override = state?.overrides?.[id]
    const address = typeof override?.address === 'string' ? override.address : builtin.address
    const selfName = typeof override?.selfName === 'string' ? override.selfName : builtin.selfName
    const prompt = typeof override?.prompt === 'string' ? override.prompt : builtin.tone
    return {
      ...builtin,
      address,
      selfName,
      prompt,
      defaults: { address: builtin.address, selfName: builtin.selfName, prompt: builtin.tone },
      custom: false,
    }
  }

  const custom = Array.isArray(state?.customModes)
    ? state.customModes.find((mode) => mode.id === id)
    : undefined
  if (custom !== undefined) {
    const values = custom.values ?? custom.defaults
    return {
      ...custom,
      address: values.address,
      selfName: values.selfName,
      prompt: values.prompt,
      defaults: { ...custom.defaults },
      custom: true,
    }
  }
  return undefined
}

/**
 * 取一个模式定义。
 *
 * @param {string} id 模式 id。
 * @param {object} [state] 状态快照。
 * @returns {object | undefined} 找到的定义；未知 id 返回 undefined。
 */
export function getMode(id, state = {}) {
  return resolveMode(id, state)
}

/**
 * 判断一个值是不是受支持的模式 id。
 *
 * 内置 id 恒为合法；自定义 id 需要出现在 `state.customModes` 里。
 *
 * @param {unknown} id 待检查的值。
 * @param {object} [state] 状态快照。
 * @returns {boolean} 是否为可用模式。
 */
export function isModeId(id, state = {}) {
  if (typeof id !== 'string') return false
  if (MODE_BY_ID.has(id)) return true
  return Array.isArray(state?.customModes) && state.customModes.some((mode) => mode.id === id)
}

/**
 * 把一个未知输入规整成可持久化的模式 id。
 *
 * 用于读取旧状态文件或插件配置：坏值、缺失值、已删除模式都回落到默认值，
 * 而不是让插件启动失败。
 *
 * @param {unknown} value 原始值。
 * @param {string} [fallback] 回落模式 id，默认 `off`。
 * @param {object} [state] 状态快照。
 * @returns {string} 一定合法的模式 id。
 */
export function normalizeModeId(value, fallback = DEFAULT_MODE_ID, state = {}) {
  if (isModeId(value, state)) return value
  return isModeId(fallback, state) ? fallback : DEFAULT_MODE_ID
}

/**
 * 渲染某个模式真正注入系统提示词的完整文本。
 *
 * 关闭模式返回空串：空段会被 DSH 的系统提示词组装器丢弃，因此「默认」模式
 * 不会给每次请求增加任何字符。
 *
 * @param {string} id 模式 id。
 * @param {object} [state] 状态快照。
 * @returns {string} 提示词文本；关闭或未知模式为空串。
 */
export function renderPersonaPrompt(id, state = {}) {
  const mode = resolveMode(id, state)
  if (mode === undefined) return ''
  if (mode.prompt === '' && mode.address === '' && mode.selfName === '') return ''
  const body = composePersonaBody(mode.prompt, mode.address, mode.selfName, mode.defaults.address)
  const extra = intensityTags(state?.intensity)
  const text = extra.length === 0 ? body : `${body}\n${extra.join('\n')}`
  return `【人格模式：${mode.nameZh}】\n${text}\n${PERSONA_BOUNDARY}`
}

/**
 * 生成给客户端的状态/列表视图。
 *
 * 这里一次性把展示字段、实际注入文本、字数与编辑用默认值算好，避免客户端和
 * 服务端各算一套导致「设置页写 90 字、实际注入 120 字」。`prompt` 只用于设置页
 * 预览，不含任何用户数据。
 *
 * @param {string} activeId 当前模式 id。
 * @param {object} [state] 状态快照。
 * @returns {{ active: string, modes: Array<object>, customDefaults: object }} 客户端视图。
 */
export function buildModesView(activeId, state = {}) {
  const customModes = Array.isArray(state?.customModes) ? state.customModes : []
  const ids = [...MODES.map((mode) => mode.id), ...customModes.map((mode) => mode.id)]
  const modes = ids.map((id) => {
    const mode = resolveMode(id, state)
    const prompt = renderPersonaPrompt(id, state)
    return {
      id: mode.id,
      emoji: mode.emoji,
      nameZh: mode.nameZh,
      nameEn: mode.nameEn,
      summaryZh: mode.summaryZh,
      summaryEn: mode.summaryEn,
      accent: mode.accent,
      prompt,
      chars: prompt.length,
      custom: mode.custom,
      address: mode.address,
      selfName: mode.selfName,
      body: mode.prompt,
      defaults: mode.defaults,
    }
  })
  return {
    active: normalizeModeId(activeId, DEFAULT_MODE_ID, state),
    intensity: normalizeIntensity(state?.intensity),
    modes,
    customDefaults: { ...CUSTOM_PERSONA_DEFAULTS },
  }
}
