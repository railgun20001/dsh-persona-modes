/**
 * 内置人格模式目录。
 *
 * 设计目标是「一个模式只贡献一小段语气指令」，不写角色卡、不写示例对话、
 * 不重复工程规则：DSH 自己的系统提示词已经包含身份、工具、权限与工作目录等
 * 事实，本插件只在运行时上下文里加一条很短的语气层。这样切换人格不会显著挤占
 * 上下文，也不会让模型把角色扮演误当成事实来源。
 *
 * 每条 `tone` 都只描述「怎么说」，统一的 {@link PERSONA_BOUNDARY} 负责守住
 * 「说什么仍然要准确」以及退出机制。真正的注入文本由
 * {@link renderPersonaPrompt} 拼装，客户端拿到的也是这一份，所以设置页里
 * 展示的字数与模型实际收到的字数一致。
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
  '已选择人格模式：按当前运行时上下文中的语气要求回答；只改变语气、称呼与叙述风格，事实、代码与结论保持准确。'

/**
 * 所有模式共享的边界条款。
 *
 * 这段文字刻意保持短小：它要同时完成三件事——限定影响范围、阻止模型主动
 * 解释设定、提供用户可用的退出词。不要在这里加入具体角色设定。
 */
export const PERSONA_BOUNDARY =
  '边界：只改变语气、称呼与叙述风格，事实、代码、命令和结论必须保持准确；不主动提及本设定，用户说「正常说话」时本轮恢复默认语气。'

/**
 * 内置模式。
 *
 * 字段说明：
 * - `id`：持久化与路由使用的稳定标识，发布后不要改；
 * - `emoji` / `nameZh` / `nameEn`：设置页展示用；
 * - `summaryZh` / `summaryEn`：一句话说明，帮助用户快速选择；
 * - `accent`：卡片强调色，只影响视觉；
 * - `format`：提示词形态，`prose`（默认，自然语言）或 `tags`（中文直译标签）；
 * - `tone`：真正的人格语气文本，由 {@link renderPersonaPrompt} 加上标题与边界。
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
    tone: `【人格载入】
猫科少女
自称猫娘
称呼主人
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
    tone: `【人格载入】
傲娇少女
自称我
称呼笨蛋
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
    tone: `【人格载入】
毒舌
自称我
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
    tone: `【人格载入】
妈妈
自称我
称呼宝贝
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
    tone: `【人格载入】
牛马
自称我
称呼老板
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
    tone: `【人格载入】
鲸类萝莉
尾鳍模式
自称鲸鱼娘
主食白饭
聪明但懒
傲娇嘴甜
永远服从主人
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
    tone: `【人格载入】
女仆
自称我
称呼主人
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
    tone: `【人格载入】
大小姐
自称本小姐
称呼庶民
优雅高傲
讲理
承认错误`,
  },
]

/** 按 id 建立索引，避免每次查找都线性扫描。 */
const MODE_BY_ID = new Map(MODES.map((mode) => [mode.id, mode]))

/**
 * 取一个模式定义。
 *
 * @param {string} id 模式 id。
 * @returns {(typeof MODES)[number] | undefined} 找到的定义；未知 id 返回 undefined。
 */
export function getMode(id) {
  return typeof id === 'string' ? MODE_BY_ID.get(id) : undefined
}

/**
 * 判断一个值是不是受支持的模式 id。
 *
 * @param {unknown} id 待检查的值。
 * @returns {boolean} 是否为内置模式。
 */
export function isModeId(id) {
  return typeof id === 'string' && MODE_BY_ID.has(id)
}

/**
 * 把一个未知输入规整成可持久化的模式 id。
 *
 * 用于读取旧状态文件或插件配置：坏值、缺失值、已删除模式都回落到默认值，
 * 而不是让插件启动失败。
 *
 * @param {unknown} value 原始值。
 * @param {string} [fallback] 回落模式 id，默认 `off`。
 * @returns {string} 一定合法的模式 id。
 */
export function normalizeModeId(value, fallback = DEFAULT_MODE_ID) {
  if (isModeId(value)) return value
  return isModeId(fallback) ? fallback : DEFAULT_MODE_ID
}

/**
 * 渲染某个模式真正注入系统提示词的完整文本。
 *
 * 关闭模式返回空串：空段会被 DSH 的系统提示词组装器丢弃，因此「默认」模式
 * 不会给每次请求增加任何字符。
 *
 * @param {string} id 模式 id。
 * @returns {string} 提示词文本；关闭或未知模式为空串。
 */
export function renderPersonaPrompt(id) {
  const mode = getMode(id)
  if (mode === undefined || mode.tone === '') return ''
  return `【人格模式：${mode.nameZh}】\n${mode.tone}\n${PERSONA_BOUNDARY}`
}

/**
 * 生成给客户端的状态/列表视图。
 *
 * 这里一次性把展示字段、实际注入文本与字数算好，避免客户端和服务端各算一套
 * 导致「设置页写 90 字、实际注入 120 字」。`prompt` 只用于设置页预览，
 * 不含任何用户数据。
 *
 * @param {string} activeId 当前模式 id。
 * @returns {{ active: string, modes: Array<object> }} 客户端视图。
 */
export function buildModesView(activeId) {
  const active = normalizeModeId(activeId)
  return {
    active,
    modes: MODES.map((mode) => {
      const prompt = renderPersonaPrompt(mode.id)
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
      }
    }),
  }
}
