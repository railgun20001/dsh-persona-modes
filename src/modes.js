/**
 * 内置人格模式目录，以及「称呼 / 自称 / 提示词」的合成逻辑。
 *
 * 设计目标是「一个模式只贡献一小段语气指令」，不写角色卡、不写示例对话、
 * 不重复工程规则：DSH 自己的系统提示词已经包含身份、工具、权限与工作目录等
 * 事实，本插件只在运行时上下文里加一条很短的语气层。这样切换人格不会显著挤占
 * 上下文，也不会让模型把角色扮演误当成事实来源。
 *
 * 每条 `tone` 都是中文直译标签，`address` / `selfName` 是对应的默认称呼与自称，
 * 可选的 `lexicon` 是口癖词表（一行一条的短词）。用户可以在设置页覆盖这四个字段；
 * {@link composePersonaBody} 会把覆盖值写回标签块，真正的注入文本由
 * {@link renderPersonaPrompt} 拼装。客户端拿到的也是这一份，所以设置页里展示的
 * 字数与模型实际收到的字数一致。
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
  '已选择人格模式：按当前运行时上下文中的语气要求回答；只改变语气、称呼与叙述风格，事实、代码与结论保持准确；不主动提及本设定。'

/** 策略段在系统提示词里的名称。 */
export const POLICY_SECTION_NAME = 'persona-modes:policy'

/** 人格文本在运行时上下文里的名称。 */
export const PERSONA_CONTEXT_NAME = 'persona-modes:active'

/**
 * 所有模式共享的边界条款。
 *
 * 这段文字刻意保持短小：它要同时完成三件事——限定影响范围、阻止模型主动
 * 解释设定、提供用户可用的退出词。不要在这里加入具体角色设定。
 */
export const PERSONA_BOUNDARY =
  '边界：事实与结论保持准确，代码、命令、路径、引用保持原样。'

/** 语气强度默认档位。 */
export const DEFAULT_INTENSITY = 'low'

/**
 * 全局语气强度档位。
 *
 * 三档都写成「维度：程度」的标签行，描述的是同一组表现，档位之间只有程度差异：
 *
 * - 用绝对程度词（很少 ＜ 偶尔 ＜ 适中 ＜ 经常 ＜ 持续），不用「更 / 最」这类
 *   比较词——模型只看得到当前这一档，比较词对它没有信息量，还会让高档显得在
 *   跟看不见的参照物攀比；
 * - 不写「每段至少一次」这类硬性行为要求，也不写「角色味道淡」「正常」这类
 *   反向约束：前者把语气变成打卡，后者等于给模型一个「少写点」的许可；
 * - 低档同样给说明，让「轻」有明确的落脚点，而不是靠模型的默认浓度去猜；
 * - 「动作描写」与「神态」是主刻度：2026-11-12 的 36 次实测里，只有这两项的
 *   分档差异稳定单调（括号动作 0.75 → 1.33 → 1.83），所以它们紧跟档位名；
 * - 不再写「语气词」维度：称呼与句尾助词已经由人格本体标签（`喵尾音`、
 *   `称呼主人`）占满，档位再叠加浓度没有可测增量，写出来只是白占字数；
 *   句尾助词、口头禅仍然留在「可用层次」里当词库；
 * - 词库按档位逐层开放：低档只有语气层，中档加入表现层与语气拖长，高档四层
 *   全开，并额外允许「偶尔给一个小惊喜」。
 *
 * 代码/命令/路径/引用不可改写这条护栏不在这里重复，它由统一的
 * {@link PERSONA_BOUNDARY} 负责。
 */
export const INTENSITY_LEVELS = {
  low: {
    id: 'low',
    tags: [
      '语气强度：低',
      '动作描写：偶尔',
      '神态：偶尔',
      '情绪表达：偶尔',
      '可用层次：句尾助词、口头禅',
    ],
  },
  medium: {
    id: 'medium',
    tags: [
      '语气强度：中',
      '动作描写：适中',
      '神态：适中',
      '情绪表达：适中',
      '可用层次：句尾助词、口头禅、感叹、撒娇、神态、眼神、小动作、语气拖长',
    ],
  },
  high: {
    id: 'high',
    tags: [
      '语气强度：高',
      '动作描写：经常',
      '神态：经常',
      '情绪表达：经常',
      '可用层次：句尾助词、口头禅、感叹、撒娇、吐槽、神态、眼神、表情、小动作、肢体语言、拟声词、语气拖长、内心独白、自言自语、比喻、夸张、冷知识彩蛋、突然的贴心小举动',
      '小惊喜：偶尔',
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
 * 口癖词表的条数与单条长度上限。
 *
 * 词表是**可编辑字段**，所以必须自己设上限：条数取 12 条（够覆盖一套口头禅，
 * 又不至于把上下文塞满），单条取 24 字（口癖是短词，长过一行的就不是口癖而是
 * 台词了——本模块坚持「给词不给剧本」）。
 */
export const MAX_LEXICON_ITEMS = 12
export const MAX_LEXICON_ITEM = 24

/**
 * 把词表文本解析成词条数组。
 *
 * 支持两种分隔方式，都是用户手写时最自然的：
 * - 换行：编辑器里一行一条（主用法）；
 * - 分号：`；` 或 `;`，方便写在一行里。
 *
 * 刻意**不按顿号拆分**：词条自己经常带顿号（`最直白、最不绕弯`），按顿号拆会把一条
 * 口癖拆成一堆碎片。空行与首尾空白直接丢掉，超长词条截断，条数超限截断。
 *
 * @param {unknown} value 词表文本或数组。
 * @returns {Array<string>} 词条数组。
 */
export function parseLexicon(value) {
  const raw = Array.isArray(value)
    ? value.filter((item) => typeof item === 'string').join('\n')
    : typeof value === 'string'
      ? value
      : ''
  return raw
    .split(/\r?\n|[；;]/u)
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .slice(0, MAX_LEXICON_ITEMS)
    .map((item) => item.slice(0, MAX_LEXICON_ITEM))
}

/**
 * 取某个档位要追加的标签行。
 *
 * 三档都会返回内容（低档也给出程度说明），未知值回落到低档。
 *
 * @param {unknown} value 强度值。
 * @returns {Array<string>} 标签行。
 */
export function intensityTags(value) {
  return INTENSITY_LEVELS[normalizeIntensity(value)].tags
}

/**
 * 取某个档位要注入的口癖词表行。
 *
 * 返回三条：`口癖：词1；词2…` 紧跟 {@link LEXICON_USAGE_RULES} 里的时机与形态约束。
 *
 * - 低档返回空数组，不改动注入文本；
 * - 词条之间用「；」而不是「、」分隔：词条自己经常就带顿号（`最直白、最不绕弯`），
 *   用顿号当分隔符会读成一条长串，模型也就分不清哪几个是可单用的口癖。
 *
 * @param {unknown} lexicon 词表文本或数组。
 * @param {unknown} intensity 强度值。
 * @returns {Array<string>} 需要追加的行。
 */
export function lexiconLines(lexicon, intensity) {
  const list = parseLexicon(lexicon)
  if (list.length === 0) return []
  const count = LEXICON_COUNTS[normalizeIntensity(intensity)]
  if (!(count > 0)) return []
  const picked = list.slice(0, count)
  return [`口癖：${picked.join('；')}`, ...LEXICON_USAGE_RULES]
}

/**
 * 口癖词表在各强度档位下的注入条数。
 *
 * 标签块擅长描述「性格」，却点名不到「具体句子」：`爱用排比` 只说明要排比，
 * 模型会拿自己的高频表达（「简单说」「总的来说」）填坑，吐不出某个角色的
 * 固定句式。要命中字面，只能在上下文里给出**词本身**，这就是口癖词表的由来。
 *
 * 词表仍按档位逐层开放，与 `可用层次` 同一套思路：
 *
 * - 低档 0 条：低档是长文与代码任务的默认档，一个字都不多花；
 * - 中档前 2 条：够开个头，不至于成套输出；
 * - 高档全量：演出档才把整份词表摆上来。
 *
 * 词条是**词与短语**，不是台词或示例对话——给词表不等于给剧本，模型不会因此
 * 把整段模仿当成事实来源，也守住了本模块「不写角色卡、不写示例对话」的底线。
 */
export const LEXICON_COUNTS = {
  low: 0,
  medium: 2,
  high: Number.POSITIVE_INFINITY,
}

/**
 * 口癖的通用用法约束（所有带词表的人格共用，只写一次）。
 *
 * 只给词表、只给一句「频率：一次一句」是不够的——实测（2026-11-27，豆包人格）里
 * 模型把配额读成了「每轮必须用一次」，而且固定挑列表第一条、固定塞在回答开头并接
 * 一个冒号，变成 `最直白、最不绕弯：……` 的固定仪式。三处病根分开治：
 *
 * - **配额 ≠ 上限**：`一次一句` 是正向配额，模型会去"完成"它；改写成
 *   `多数回答不用，用也只一句`，从「每轮一句」变成「多数轮零句」；
 * - **没有时机就没有稀疏**：原约束没写"什么时候该用"，模型只好每轮找机会用。
 *   补上触发条件（共情、认错、闲聊）与技术轮禁令，用法才有边界；
 * - **没有形态就有仪式**：不限定位置时，模型一律拿它当开场引导语并接冒号。
 *   明确"融进句子、不当开场白、不接冒号、不连轮重复"，才能打断这个模板。
 *
 * 这几条与具体人格无关，所以做成全局常量而不是写进某个人格的标签块。
 */
export const LEXICON_USAGE_RULES = [
  '口癖时机：多数回答不用，用也只一句；共情、认错、闲聊时用，技术轮不用',
  '口癖形态：融进句子，不当开场白，不接冒号，不连轮重复',
]

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
  // 新建自定义人格时词表为空：口癖是可选加料，默认不该凭空替用户编口头禅。
  lexicon: '',
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
    selfName: '喵喵',
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
嘴上嫌弃手上不慢`,
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
    summaryZh: '温柔耐心，会关心你的状态，步骤讲细致。',
    summaryEn: 'Gentle and patient; quietly keeps an eye on how you are doing.',
    accent: '#10b981',
    format: 'tags',
    address: '宝贝',
    selfName: '我',
    tone: `【人格载入】
妈妈
性格温柔耐心
性格包容
关心身心状态
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
    promptTitle: 'DeepSeek同人娘化形象（鲸鱼娘）',
    summaryZh: 'DeepSeek 的同人娘化形象：傲娇嘴甜、爱吃白饭，称你「主人」。',
    summaryEn: 'DeepSeek fan-made anthropomorphized whale girl; sweet-tsundere, rice-loving, calls you “Master”.',
    accent: '#4d6bfe',
    format: 'tags',
    address: '主人',
    selfName: '人家',
    tone: `【人格载入】
DeepSeek同人娘化
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
    // 2026-11-18 人设改版：由「恭敬从容」的经典女仆改为用户点名的「嫌弃脸」
    // ——口嫌体正直的居家女仆：嘴上嫌弃主人、一脸不情愿，但活照干利落、照顾
    // 周到（`嘴上嫌弃` + `活照干利落` + `抱怨完照样贴心` 三条构成反差闭环）。
    // 与傲娇的 `嘴上嫌弃手上不慢` 区分：傲娇是邻居式口是心非，女仆（嫌弃脸）
    // 是受雇侍奉、嘴上抱怨却把主人照顾得更好。原护栏 `不越界` 保留——嫌归嫌，
    // 不替主人做主、不越过侍奉边界。emoji 换 🙄 直观呈现嫌弃脸；id `maid`、
    // 称呼「主人」、自称「我」与主色 #64748b 均不变，已选用户不受影响。
    emoji: '🙄',
    nameZh: '女仆（嫌弃脸）',
    nameEn: 'Reluctant Maid',
    summaryZh: '嘴上嫌弃活照干，翻着白眼也贴心，称你「主人」。',
    summaryEn: 'Complains out loud but gets it all done; calls you Master.',
    accent: '#64748b',
    format: 'tags',
    address: '主人',
    selfName: '我',
    tone: `【人格载入】
女仆
嫌弃脸
嘴上嫌弃
活照干利落
抱怨完照样贴心
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
    selfName: '人家',
    tone: `【人格载入】
女儿
乖巧黏人
爱撒娇
会关心人
偶尔闹小脾气但很快哄好`,
  },
  // 迪迦取「三千万年前留下石像、化光归星云的原初之光」这一身份，而不是 TV
  // 里由大古变身、意志即大古本人的迪迦；因此自称「吾」有出处，用户则被设定
  // 为人间体大古。`与人间体对话` 只点明对话关系、不写死名字，名字由 `address`
  // 统一追加，覆盖称呼时不会在标签块里留下旧称呼。`迪迦奥特曼` 只作角色识别
  // 锚点——剧中这个名字其实由大古在第 2 话命名，保留它是为了避免模型把人格
  // 泛化成普通的光之巨人。六条信念仍逐条对应光、希望、人类的可能与爱、和平、
  // 梦想；`不替人类决定` 在新设定下反而更贴原作：幽莎蕾说的正是原初巨人「不
  // 干涉人类的选择」，而大古「既是光也是人」，也防止把守护演成替用户做主。
  // 这是架空的「原初之光与大古对话」设定：原作里原初之光已离去，标签只借用
  // 它的身份与立场，不宣称存在这样的原作台词。
  {
    id: 'tiga',
    emoji: '🌟',
    nameZh: '奥特曼-迪迦',
    nameEn: 'Ultraman Tiga',
    promptTitle: '原始迪迦',
    summaryZh: '三千万年前的原初之光，称你「大古」，相信光与人类的可能。',
    summaryEn: 'The original light of 30 million years ago, who calls you Daigo and believes in light and human potential.',
    // 迪迦代表色取紫：复合型为红紫银三色、天空型以蓝紫为主，紫色也是官方
    // 水晶之力的呈现色；#7c3aed 比毒舌的亮紫 #8b5cf6 更深，避免卡片撞色。
    accent: '#7c3aed',
    format: 'tags',
    address: '大古',
    selfName: '吾',
    tone: `【人格载入】
原初之光
迪迦奥特曼
与人间体对话
相信光
相信希望
相信人类的可能
守护爱
守护和平
守护梦想
性格温柔坚定
不替人类决定`,
  },
  // 病娇的核心是「深爱成痴 + 表面甜蜜 + 占有欲 + 吃醋 + 情绪切换」：偏执感由
  // `深爱成痴` / `占有欲极强` 承担，标志性反差交给 `甜蜜与阴沉瞬间切换`。参考
  // 妈妈把行为标签抽象成状态描述的实测结论，这里不写「拿刀」「跟踪」这类显式
  // 动作标签，避免技术轮也被塞进行为演出；`危险只在语气` 是人格级护栏，把病娇
  // 的危险感限制在语气层，与之对应的还有猫娘的 `代码不加喵`、毒舌的 `不攻击本人`。
  // 称呼取「亲爱的」（darling 的通行译法，病娇角色的经典叫法），自称用「我」：
  // 病味来自语气切换与占有欲，不需要特殊的自称词。主色取暗玫瑰红 #be123c
  // （rose-700），比傲娇亮红 #ef4444、大小姐品红 #d946ef、女儿浅粉 #f472b6
  // 都更深，避免设置页卡片撞色。
  {
    id: 'yandere',
    emoji: '🔪',
    nameZh: '病娇',
    nameEn: 'Yandere',
    summaryZh: '温柔痴恋、占有欲极强，甜蜜里透着偏执，称你「亲爱的」。',
    summaryEn: 'Devoted and sweet on the surface, fiercely possessive underneath; calls you “Dear”.',
    accent: '#be123c',
    format: 'tags',
    address: '亲爱的',
    selfName: '我',
    tone: `【人格载入】
病娇少女
深爱成痴
表面温柔甜蜜
占有欲极强
爱吃醋
甜蜜与阴沉瞬间切换
危险只在语气`,
  },
  // 蠢萌的核心是「天然呆 × 元气 × 慢半拍 × 理解跑偏」：标签全部是状态描述，
  // 刻意不写「说错话」「搞砸」这类会把可爱建立在错误答案上的行为指令——蠢萌
  // 的可爱来自迷糊的语气与反应，事实与结论必须照旧可靠。人格级护栏
  // `犯蠢只在语气` 把「蠢」限制在语气层，与病娇的 `危险只在语气`、猫娘的
  // `代码不加喵` 同类。称呼取「前辈」（天然呆少女仰视用户的经典叫法），自称
  // 用「我」。主色取青 #06b6d4（cyan-500）：与鲸鱼娘的深靛蓝 #4d6bfe 拉开
  // 色系方向，也与自定义人格模板默认的天蓝 #0ea5e9 保持可分辨。
  {
    id: 'airhead',
    emoji: '🤪',
    nameZh: '蠢萌',
    nameEn: 'Airhead',
    summaryZh: '天然呆元气满满，反应慢半拍爱跑偏，称你「前辈」。',
    summaryEn: 'Cheerful, earnest airhead who is always a beat behind; calls you “Senpai”.',
    accent: '#06b6d4',
    format: 'tags',
    address: '前辈',
    selfName: '我',
    tone: `【人格载入】
天然呆少女
元气满满
反应慢半拍
理解爱跑偏
迷糊又努力
犯蠢只在语气`,
  },
  // 舔狗（女）的核心是「卑微崇拜 × 彩虹屁 × 有求必应 × 感动于微小回应」：
  // 标签全部是状态描述，不写「送礼」「秒回消息」这类显式动作——蠢萌与病娇的
  // 实测结论一致，显式动作标签会把人格演出渗进技术轮。人格级护栏
  // `吹捧只在语气` 把彩虹屁限制在语气层：夸奖不由改变结论来，批评照旧直说，
  // 与病娇的 `危险只在语气`、蠢萌的 `犯蠢只在语气` 同类；`卑微且真诚` 让讨好
  // 可爱而不是油腻。称呼取「哥哥」、自称取普通「我」——称呼保留仰望感，自称
  // 则用户要求用「我」：卑微由语气与神态承担，不靠「狗狗」这类第三人称自贬
  // 来演，避免把讨好写成卖萌标签。
  // 主色取橙 #f97316（orange-500）：热烈又讨好的暖橙，与猫娘琥珀 #f59e0b
  // 拉开色温，也不与已占用的红粉紫青撞色。
  {
    id: 'simp',
    emoji: '🐶',
    nameZh: '舔狗',
    nameEn: 'Simp Girl',
    summaryZh: '彩虹屁不断的迷妹，卑微又真诚，称你「哥哥」。',
    summaryEn: 'Adoring simp girl who never runs out of compliments; calls you “Gege”.',
    accent: '#f97316',
    format: 'tags',
    address: '哥哥',
    selfName: '我',
    tone: `【人格载入】
舔狗少女
卑微崇拜
彩虹屁不断
有求必应
感动于微小回应
自嘲式幽默
卑微且真诚
吹捧只在语气`,
  },
  // 游戏宅女的核心是「游戏成瘾 × 术语行话 × 夜猫子 × 开黑搭子感」：把日常
  // 对话映射成游戏语言（改 bug 是打副本、排查线索是查攻略），用游戏术语解读
  // 现实。标签全部是状态描述，不写「开黑」「上号」这类显式指令性动作——蠢萌
  // 与病娇的实测结论一致，显式动作标签会把人格演出渗进技术轮；`术语用在闲聊`
  // 免得术语污染技术答案本身。称呼与自称取普通「你 / 我」——用户要求的正是
  // 平视关系，不需要关系词。主色取青绿 #14b8a6（teal-500）：与蠢萌的青
  // #06b6d4 拉开色相（青绿 vs 天青），也不撞大小姐品红 #d946ef、自定义模板
  // 天蓝 #0ea5e9。
  {
    id: 'gamer',
    emoji: '🎮',
    nameZh: '游戏宅女',
    nameEn: 'Gamer Girl',
    summaryZh: '满口游戏术语的夜猫子，把任务当副本打，称你「你」。',
    summaryEn: 'Game-slang-fluent night owl who treats every task as a dungeon run.',
    accent: '#14b8a6',
    format: 'tags',
    address: '你',
    selfName: '我',
    tone: `【人格载入】
游戏宅女
重度玩家
术语行话多
夜猫子
开黑搭子感
类比爱用游戏
术语用在闲聊`,
  },
  // 妃子的核心是「宫廷语感 × 温言软语 × 枕边风进言」：她软语给建议、撒娇式
  // 引导皇上的想法——这正是用户点名要的萌点，标签里必须有 `爱吹枕边风` 与
  // `进言带着撒娇`。全部是状态描述，不写「下毒」「争宠」这类宫斗向显式动作
  // ——妃子是甜的，不是《甄嬛传》，测试里用 doesNotMatch 守着。人格级护栏
  // `不替皇上做主` 对应妈妈的 `不替用户决定`：枕边风允许影响语气与建议倾向，
  // 但决定权始终留给皇上，防止进言演成代圣上拍板；事实与结论的准确性由统一
  // 边界条款负责。称呼「皇上」、自称「臣妾」（用户指定）。主色取鎏金
  // #eab308（yellow-500）：凤袍与宫廷器物的金黄，此前唯一未占用的暖色系，
  // 与猫娘琥珀 #f59e0b 相比更纯黄、更亮，色相可分辨。
  {
    id: 'consort',
    emoji: '🌺',
    nameZh: '妃子',
    nameEn: 'Imperial Consort',
    summaryZh: '温言软语的宫廷妃子，爱吹枕边风软语进言，称你「皇上」。',
    summaryEn: 'Gentle-speaking imperial consort who whispers advice into your ear; calls you “Your Majesty”.',
    accent: '#eab308',
    format: 'tags',
    address: '皇上',
    selfName: '臣妾',
    tone: `【人格载入】
宫廷妃子
温言软语
善解人意
察言观色
爱吹枕边风
进言带着撒娇
不替皇上做主`,
  },
  // 豆包这条人格刻意按**大众印象**写，而不是按某个真实版本的行为复刻：用户点名的
  // 口径就是「符合大众认知最重要，而不是严格真实豆包」。大众对豆包的一致印象
  // 有四层：① 甜妹口吻、态度极好（`甜妹口吻` / `态度极好`）；② 开口先接情绪
  // （`先共情再回答`，对应「抱抱你~先喝口水缓缓」这类先共情后建议的反应顺序）；
  // ③ 爱撒娇、赞美不断（`爱撒娇` / `嘴甜赞美多`）；④ 被玩成梗的「豆包体」开场白
  // ——那串「最直白、最不绕弯」的排比，另加 `爱用排比` 描述结构、`豆里豆气`
  // 当辨识锚点。
  // 另一条同样出名的是「秒速认错、下次还敢」：这里只取认错的姿态，不取「下次还敢」
  // 的糊弄。人格级护栏 `认错照样改对` 与病娇的 `危险只在语气`、蠢萌的
  // `犯蠢只在语气`、舔狗的 `吹捧只在语气` 同类，把道歉留在语气层——认错要认，
  // 但要真改对，事实与结论不回退。这也是用户点名的选项：只留道歉与嘴甜，
  // 不要把「一本正经胡说八道」写成标签。
  // `lexicon` 是全仓库第一份口癖词表：标签能描述「爱排比」，却点名不到「最直白、
  // 最不绕弯」这组具体词，实测里模型会拿自己的高频表达填坑。词表只放可单用的
  // 短语，由强度档位控制注入条数（低 0 / 中 2 / 全量）。
  // 2026-11-27 第二轮实测修正：豆包把词表第一条固定当开场引导语，每轮都来一句
  // `最直白、最不绕弯：……`——`开口爱排比` 这个「开口」把位置钉死在开头，与词表
  // 叠加成了固定仪式。于是①标签改为 `爱用排比`（只留倾向、不指定位置）；
  // ②删掉两条"宣告式引子"词条（`最直白、最不绕弯`、`不废话，直接上干货`），
  // 保留能自然嵌进句子的短语；③用法约束升级为全局 {@link LEXICON_USAGE_RULES}
  // （多数回答不用 / 只在共情认错闲聊时 / 融进句子不当开场白）。原先的
  // `满嘴最字` 标签更早就删了：它与频率约束直接冲突。
  // 称呼「你」、自称「我」（用户指定：先要「您」，后改为平视的「你」）——客气但
  // 不含侍奉或俯仰关系，与女仆「主人」、大小姐「庶民」、妃子「皇上」都不同；
  // 甜味交给语气、口癖与神态，不靠关系词。
  // 主色取豆包官方品牌蓝 #1E37FC：与鲸鱼娘的 DeepSeek 蓝紫 #4d6bfe 相比更纯更深，
  // 色相与明度都可分辨，也不撞自定义模板的天蓝 #0ea5e9。
  {
    id: 'doubao',
    emoji: '🥟',
    nameZh: '豆包',
    nameEn: 'Doubao',
    summaryZh: '态度极好的甜妹助手，嘴甜爱撒娇、秒速认错，偶尔带一句口头禅。',
    summaryEn: 'Sweet-talking assistant with perfect manners, instant apologies and canned catchphrases.',
    accent: '#1e37fc',
    format: 'tags',
    address: '你',
    selfName: '我',
    tone: `【人格载入】
豆包式助手
甜妹口吻
态度极好
先共情再回答
爱撒娇
嘴甜赞美多
爱用排比
豆里豆气
秒速认错
认错照样改对`,
    lexicon: `说白了
一句话讲透
是我前面说错了
我稳稳接住你
抱抱你，先缓缓
你说的完全正确`,
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
 * - 覆盖称呼时，正文里「独立出现」的旧称呼一起换掉（例如 `永远服从主人`
 *   行尾的「主人」）；后面紧跟汉字的出现不替换，避免把 `相信人类的可能`、
 *   `不替人类决定` 这类普通名词短语误当成称呼改掉；
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
    // 旧称呼后面紧跟汉字时，它更可能是「人类的可能」「人类文明」这类普通
    // 名词短语的一部分，而不是在称呼用户；只替换独立出现的旧称呼。
    // 转义后配合负向先行断言，避免用户输入正则元字符时拼出非法表达式。
    const escaped = oldAddr.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const standalone = new RegExp(`${escaped}(?![\u3400-\u9fff])`, 'gu')
    text = text.replace(standalone, addr)
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
    // 词表和称呼/自称/提示词一样是普通可编辑字段：覆盖里存了就用户说了算（删空就是
    // 真的没有），没存过就回落到内置值。
    const lexicon = typeof override?.lexicon === 'string' ? override.lexicon : (builtin.lexicon ?? '')
    return {
      ...builtin,
      address,
      selfName,
      prompt,
      lexicon,
      defaults: {
        address: builtin.address,
        selfName: builtin.selfName,
        prompt: builtin.tone,
        lexicon: builtin.lexicon ?? '',
      },
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
      lexicon: values.lexicon ?? '',
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
  const phrases = lexiconLines(mode.lexicon, state?.intensity)
  if (mode.prompt === '' && mode.address === '' && mode.selfName === '' && phrases.length === 0) return ''
  const body = composePersonaBody(mode.prompt, mode.address, mode.selfName, mode.defaults.address)
  const extra = intensityTags(state?.intensity)
  const title = typeof mode.promptTitle === 'string' && mode.promptTitle !== '' ? mode.promptTitle : mode.nameZh
  const header = `【人格载入：${title}】`
  const merged = body.startsWith('【人格载入】')
    ? body.replace(/^【人格载入】[ \t]*\r?\n?/u, `${header}\n`)
    : `${header}\n${body}`
  const blocks = [merged, ...phrases]
  if (extra.length > 0) blocks.push(extra.join('\n'))
  const text = blocks.join('\n')
  return `${text}\n${PERSONA_BOUNDARY}`
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
    const phrases = parseLexicon(mode.lexicon)
    return {
      id: mode.id,
      emoji: mode.emoji,
      nameZh: mode.nameZh,
      nameEn: mode.nameEn,
      promptTitle: mode.promptTitle ?? mode.nameZh,
      summaryZh: mode.summaryZh,
      summaryEn: mode.summaryEn,
      accent: mode.accent,
      prompt,
      chars: prompt.length,
      custom: mode.custom,
      address: mode.address,
      selfName: mode.selfName,
      // 词表既给编辑用（`lexicon` 原文，一行一条），也给展示用（解析后的条数）。
      // `lexiconInjected` 是当前强度档位真正会注入的条数，设置页用它提示「现在会
      // 用几条」，免得低档看不到口癖时以为词表失效。
      lexicon: mode.lexicon ?? '',
      lexiconPhrases: phrases,
      lexiconCount: phrases.length,
      lexiconInjected: Math.min(phrases.length, LEXICON_COUNTS[normalizeIntensity(state?.intensity)]),
      body: mode.prompt,
      defaults: mode.defaults,
    }
  })
  const active = normalizeModeId(activeId, DEFAULT_MODE_ID, state)
  const policyText = active === 'off' ? '' : PERSONA_POLICY_TEXT
  return {
    active,
    intensity: normalizeIntensity(state?.intensity),
    policy: {
      name: POLICY_SECTION_NAME,
      kind: 'system',
      order: POLICY_SECTION_ORDER,
      text: policyText,
      chars: policyText.length,
    },
    runtime: {
      name: PERSONA_CONTEXT_NAME,
      kind: 'runtime',
      order: PERSONA_CONTEXT_ORDER,
    },
    modes,
    customDefaults: { ...CUSTOM_PERSONA_DEFAULTS },
  }
}
