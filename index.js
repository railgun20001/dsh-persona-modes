/**
 * dsh-persona-modes —— 宿主半。
 *
 * 本插件把「人格」做成一层可运行时切换的语气：
 *
 *   1. 设置页（客户端半）通过同源路由读取/切换模式；
 *   2. 宿主半把当前模式持久化到 `~/.dsh/persona-modes/state.json`；
 *   3. 系统提示词里注册一条**稳定的策略段**（只说明「按运行时上下文的人格要求
 *      调整语气」），具体人格文本放在 `ctx.systemPrompt.context` 的运行时上下文
 *      里。每次组装时上下文文本函数读取当前模式；关闭模式返回空串。
 *
 * 为什么用运行时上下文承接具体人格：
 * - DSH 的 `systemPromptUpdate: 'in-history'` 会在系统提示词变化时追加**整份**
 *   渲染结果；模式之间频繁切换若改系统提示词，历史成本会迅速膨胀；
 * - 运行时上下文快照本身声明「supersedes earlier runtime-context snapshots」，
 *   切换只追加一条较小的快照，语义上由最新快照覆盖旧人格；
 * - 不改用户文件，不需要重启即可切换；卸载时 effect 自动释放注册。
 *
 * 提示词预算：每个模式的实际注入文本控制在约 125 个汉字以内（关闭为 0），
 * 且同一时刻只有一条生效。具体定义见 `src/modes.js`。
 *
 * @module dsh-persona-modes
 */

import { readFileSync } from 'node:fs'

import {
  getMode,
  MODES,
  normalizeModeId,
  PERSONA_CONTEXT_ORDER,
  PERSONA_POLICY_TEXT,
  POLICY_SECTION_ORDER,
  renderPersonaPrompt,
} from './src/modes.js'
import { createRouteHandler, PLUGIN_ID, ROUTE_PATH } from './src/routes.js'
import { createStore } from './src/store.js'

/** Cordis 插件名（诊断与 patch 行定位用）。 */
export const name = 'persona-modes'

/** 对宿主服务的依赖通过 `ctx.inject` 软接入；硬 inject 留空，缺少 UI 时仍可加载。 */
export const inject = []

/**
 * 读取本包版本号（单一事实来源）。
 *
 * 宿主半只在 DSH 启动或插件重载时加载，版本号用于客户端探活与诊断。
 *
 * @type {string}
 */
const VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
})()

/**
 * 斜杠命令的文本帮助。
 *
 * @param {string} activeId 当前模式 id。
 * @returns {string} 可直接回给用户的多行文本。
 */
export function commandHelp(activeId) {
  const active = getMode(activeId) ?? getMode('off')
  const lines = MODES.map((mode) => `${mode.id}（${mode.nameZh}）`).join('、')
  return [
    `当前人格：${active.nameZh}（${active.id}）`,
    `可用模式：${lines}`,
    '用法：/persona <id> 切换；/persona off 关闭。',
  ].join('\n')
}

/**
 * 注册宿主半。
 *
 * @param {object} ctx Cordis 上下文。
 * @param {{ defaultMode?: string, command?: boolean, stateFile?: string }} [config] 插件行配置。
 */
export function apply(ctx, config = {}) {
  const store = createStore({
    file: typeof config.stateFile === 'string' && config.stateFile !== '' ? config.stateFile : undefined,
    defaultMode: normalizeModeId(config.defaultMode),
  })

  /**
   * 只读诊断回调：给 `/debug` 路由用，返回当前组装结果里本插件贡献的段与上下文
   * 名称及字数，不返回系统提示词正文。用于确认插件在真实宿主里确实接上了
   * `systemPrompt`，而不是只注册了路由。
   *
   * @type {null | (() => Promise<object>)}
   */
  let diagnostics = null

  // 路由是可选的：没有 webServer 的 headless 组合仍然可以只用斜杠命令。
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(
      () => scoped.webServer.register({
        kind: 'prefix',
        path: ROUTE_PATH,
        handler: createRouteHandler(store, { version: VERSION, diagnostics: () => diagnostics?.() }),
      }),
      'persona-modes: routes',
    )
    scoped.logger?.info?.(`[${PLUGIN_ID}] 宿主半 v${VERSION}：路由 ${ROUTE_PATH}（ping/state/select/debug）已挂载`)
  })

  // 核心：一条稳定的语气策略段 + 一条动态运行时上下文。
  //
  // 为什么把具体人格文本放在 runtime context，而不是系统提示段：
  // DSH 的 DeepSeek 路由声明了 `systemPromptUpdate: 'in-history'`，系统提示词
  // 一旦变化，追加进历史的是一整份渲染结果（可能上万字），不是变化的那一小段。
  // 模式之间来回切换如果每次都改系统提示词，历史成本会迅速膨胀。放在运行时
  // 上下文里，每次切换只追加一条较小的上下文快照，而且快照本身声明「supersedes
  // earlier runtime-context snapshots」，语义上覆盖旧人格。
  //
  // 策略段只在「有人格 / 无人格」之间切换时变化（它不含具体模式名），因此
  // 猫娘 → 牛马不会改系统提示词，只有开启 / 关闭时才会触发一次系统提示词更新。
  ctx.inject(['systemPrompt'], (scoped) => {
    scoped.effect(
      () => scoped.systemPrompt.section({
        name: 'persona-modes:policy',
        order: POLICY_SECTION_ORDER,
        text: () => (store.getActive() === 'off' ? '' : PERSONA_POLICY_TEXT),
      }),
      'persona-modes: prompt policy section',
    )
    scoped.effect(
      () => scoped.systemPrompt.context({
        name: 'persona-modes:active',
        order: PERSONA_CONTEXT_ORDER,
        required: true,
        interpolate: false,
        text: () => renderPersonaPrompt(store.getActive()),
      }),
      'persona-modes: runtime context',
    )
    scoped.logger?.info?.(`[${PLUGIN_ID}] 宿主半 v${VERSION}：人格策略与运行时上下文已注册，当前模式 ${store.getActive()}`)

    diagnostics = async () => {
      const assembly = await scoped.systemPrompt.assemble({})
      return {
        active: store.getActive(),
        sections: assembly.sections
          .filter((section) => section.name.startsWith('persona-modes:') && section.text.length > 0)
          .map((section) => ({ name: section.name, chars: section.text.length })),
        contexts: assembly.contexts
          .filter((context) => context.name.startsWith('persona-modes:') && context.text.length > 0)
          .map((context) => ({ name: context.name, chars: context.text.length })),
      }
    }
  })

  // 斜杠命令是设置页之外的快速入口；不需要时可以配置 command: false 关掉。
  if (config.command !== false) {
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.effect(
        () => commandCtx.commands.register({
          name: 'persona',
          description: '切换人格模式：/persona [id|off]，不带参数查看当前模式与列表',
          // 没有 input 提示时，官方命令适配器会把该命令当成「无参数命令」，
          // `/persona catgirl` 根本不会进入 handler。这里声明可接受任意文本。
          input: { hint: '[id|off]' },
          handler: async (invocation) => {
            const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
            if (raw === '') {
              return { kind: 'success', text: commandHelp(store.getActive()) }
            }
            const target = raw.split(/\s+/u)[0]
            const mode = getMode(target)
            if (mode === undefined) {
              return {
                kind: 'error',
                text: `没有「${target}」这个模式。\n${commandHelp(store.getActive())}`,
              }
            }
            const result = store.setActive(mode.id)
            if (result === null) {
              return { kind: 'error', text: `切换失败：未知模式 ${target}` }
            }
            const suffix = result.persisted ? '' : '（状态文件写入失败，本次会话内仍生效）'
            return {
              kind: 'success',
              text: mode.id === 'off'
                ? `已关闭人格模式，下一轮对话恢复默认语气。${suffix}`
                : `已切换到「${mode.nameZh}」，下一轮对话生效。${suffix}`,
            }
          },
        }),
        'persona-modes: /persona command',
      )
    })
  }
}

/** 供离线测试使用的内部导出（不参与运行时行为）。 */
export const __test = {
  VERSION,
  commandHelp,
  createRouteHandler,
  createStore,
  renderPersonaPrompt,
}

export default { name, inject, apply }
