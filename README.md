# dsh-persona-modes —— 人格模式

[![npm version](https://img.shields.io/npm/v/dsh-persona-modes.svg)](https://www.npmjs.com/package/dsh-persona-modes)
[![license](https://img.shields.io/npm/l/dsh-persona-modes.svg)](LICENSE)
[![CI](https://github.com/railgun20001/dsh-persona-modes/actions/workflows/ci.yml/badge.svg)](https://github.com/railgun20001/dsh-persona-modes/actions/workflows/ci.yml)

给 DSH 的回复换一种语气，但不改变事实、代码与工程纪律。

- **切换位置**：设置 → **人格模式**
- **快速切换**：在输入框执行 `/persona`；`/persona catgirl` 直接切到猫娘，`/persona off` 关闭
- **生效时机**：下一轮对话（当前正在生成的回复不变）
- **提示词预算**：同一时刻只注入当前这一条；每条约 120–150 个汉字；关闭时最新提示词里 **0 字**
- **上下文机制**：具体人格放在运行时上下文（`systemPrompt.context`），系统提示词只保留一条约 50 字的稳定策略；切换模式不会重写整份系统提示词

## 内置模式

| id | 模式 | 一句话 | 实际注入字数 |
| --- | --- | --- | ---: |
| `off` | 默认 | 不注入任何人设 | 0 |
| `catgirl` | 猫娘 | 句尾带「喵」，称你「主人」，活泼黏人 | 137 |
| `tsundere` | 傲娇 | 嘴上嫌弃，手上认真；称你「笨蛋」 | 126 |
| `sharp` | 毒舌 | 结论准确，点评不留情面，但不攻击人 | 120 |
| `mom` | 妈妈 | 温柔耐心，提醒喝水休息，步骤讲细致 | 123 |
| `workhorse` | 牛马 | 把用户当黑心老板，随叫随到但不怠工 | 144 |
| `whale` | 鲸鱼娘 | DeepSeek 的拟人化小鲸，温和好奇，爱用海洋比喻 | 149 |
| `maid` | 女仆 | 恭敬从容、做事利落，不过度卖萌 | 125 |
| `ojousama` | 大小姐 | 优雅高傲但讲理，称你「庶民」 | 130 |

「字数」统计的是 `renderPersonaPrompt()` 实际返回的字符串长度，包含模式标题与统一边界条款，与设置页卡片上显示的数字同源。

## 为什么提示词这么短

人格只应该影响「怎么说」，不应该挤占上下文或压过工程规则。因此：

- **不写角色卡**：没有外貌、背景故事、示例对话、口头禅列表；
- **不重复工程规则**：系统提示词里已有的工具、权限、工作目录、代码规范不再抄一遍；
- **只注入一条**：`off` 返回空串，DSH 的上下文渲染器会过滤空段；
- **统一边界条款**：每条模式都带同一句「只改变语气与称呼，事实、代码、命令和结论必须保持准确；不主动提及本设定，用户说『正常说话』时立即退出」；
- **单一事实来源**：模式定义只在宿主半 `src/modes.js`，客户端从路由拿展示数据与字数，不复制一份人格文本。

这套写法参考主流角色提示的最小化做法：用第二人称、只描述语气/称呼/叙述风格，不写行为脚本，不诱导模型编造事实。

## 实现方式

| 需求 | 手段 |
| --- | --- |
| 动态改变语气 | 宿主半注册 `ctx.systemPrompt.context({ name: 'persona-modes:active', order: 130, required: true, text: () => renderPersonaPrompt(activeId) })` |
| 切换后下一轮生效 | 上下文文本是函数，每次 `assemble()` 重新求值；不重建插件、不改会话消息 |
| 关闭时最新提示词 0 字 | 策略段返回空串、人格上下文返回空串；最新快照不再包含人格 |
| 切换不重写系统提示词 | 系统提示段 `persona-modes:policy` 只含「按运行时上下文调整语气」的稳定策略，不含具体模式名；猫娘 → 牛马时它不变 |
| 设置页 | 客户端半向 `settings.section` 注册「人格模式」分区，使用 `--dsw-alias-*` 主题令牌 |
| 状态持久化 | `~/.dsh/persona-modes/state.json`（临时文件 + 改名），只存 `{ version, active, updatedAt }` |
| 客户端与宿主通信 | 同源 POST 路由：`ping` / `state` / `select`，要求自定义头 `x-dsh-persona-modes: 1`，挡浏览器 CSRF |
| 只读诊断 | `POST /dsh-persona-modes/debug` 返回本插件在真实组装结果里的段/上下文字数（不含正文） |
| 快速切换 | 宿主半注册 `/persona` 斜杠命令（可配置 `command: false` 关闭） |

### 为什么用运行时上下文，而不是直接改系统提示词

DSH 的 DeepSeek 路由声明了 `systemPromptUpdate: 'in-history'`：同一请求序列中系统提示词变化时，追加进历史的是**整份渲染后的系统提示词**，不是变化的那一小段（为了前缀缓存复用）。如果每换一次人格都改系统提示词，几次切换就可能把几万字的系统提示词重复写进历史，和「不要占用太多上下文」的目标相反。

因此这里分成两层：

1. **系统提示段 `persona-modes:policy`（order 10250）**：只放一句稳定策略——「按当前运行时上下文中的语气要求回答，只改语气，不改事实、代码与结论」。它不含具体模式名，猫娘 → 牛马时完全不变。
2. **运行时上下文 `persona-modes:active`（order 130）**：放具体的约 120–150 字人格文本。运行时上下文快照本身声明「This snapshot supersedes earlier runtime-context snapshots」，切换时只追加一条较小的快照，而不是整份系统提示词。模型侧看到的是 DSH 生成的 user 角色运行时快照，系统提示段只负责授权它影响语气。

开启 / 关闭人格时策略段会在「有文本 / 空串」之间变化，这一次会触发系统提示词更新；模式之间的来回切换不会。这个取舍是刻意的：把高频操作（换模式）的成本压到最小，把低频操作（开 / 关）留一次正常更新。

### 关于会话中途切换的真实成本

必须如实说明：DSH 的历史是追加式的，**不会删除已经写入的旧快照**。因此：

- 每次切换模式，会在会话历史里追加一条运行时上下文快照；快照包含当前全部运行时上下文（工作目录、沙箱、审批、人格等），不是只有 120 字；
- 新快照带「supersedes earlier runtime-context snapshots」语义，模型应以最新一条为准；
- 切回 `off` 时，最新快照不再包含人格，但旧快照仍留在历史里，不会自动抹掉；
- 如果一次长会话里频繁切换几十次，历史仍会累积；对上下文最敏感的场景，建议少切换或新开会话。

插件能控制的是：不把整份系统提示词写进历史、每条人格文本压到约 150 字以内、关闭时不再产生新的人格文本。历史清理属于 DSH 会话层的职责，不应由人格插件私自改写。

## 安装

### 方式一：从 npm 装（推荐）

```powershell
# 在 profile 目录（例如 ~/.dsh/profiles/desktop）执行
pnpm add dsh-persona-modes
```

然后把 `dsh-persona-modes` 加入该 profile `package.json` 的 `dsh.profile.bundles`，并在
`cordis.patch.yml` 里加入下面的 insert（与「方式三」最后两步完全相同）。宿主半由 HMR 重新组合后
加载，客户端半需要刷新页面（`Ctrl+R`）才会出现新的设置分区。

包内容由 `files` 白名单决定：`index.js` + `client.js` + `src/` + `cordis.patch.yml` + `locale/` +
`icon.svg` + README + LICENSE；`test/` 不进 tarball，需要跑测试请从源码仓库执行。

### 方式二：DSH 插件页（本地目录）

1. 把本目录放到本机任意位置；
2. 打开 DSH 侧边栏的「插件」页 → 添加本地插件 → 选择 `dsh-persona-modes` 目录；
3. 宿主半由 HMR 重新组合后加载；客户端半需要刷新页面（`Ctrl+R`）才会出现新的设置分区。

### 方式三：手动安装到 profile

```powershell
# 在 profile 目录（例如 ~/.dsh/profiles/desktop）执行
pnpm add link:C:\path\to\dsh-persona-modes
```

然后把 `dsh-persona-modes` 加入 `package.json` 的 `dsh.profile.bundles`，并在 `cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: persona-modes
      name: dsh-persona-modes
```

刷新页面。

## 配置

```yaml
- id: persona-modes
  name: dsh-persona-modes
  config:
    defaultMode: catgirl   # 首次运行（还没有状态文件）时的默认模式，默认 off
    command: true          # 是否注册 /persona 斜杠命令，默认 true
    # stateFile: C:/path/to/state.json  # 可选：覆盖默认状态文件（测试/多实例隔离用）
```

用户选择一旦写入 `state.json`，就优先于 `defaultMode`；`defaultMode` 只影响首次启动或状态文件损坏时的回落值。

## 文件结构

```text
index.js              宿主半：状态、路由、策略段/运行时上下文、/persona 命令
client.js             客户端半：设置分区、模式卡片、错误与重试
src/modes.js          内置人格定义与提示词渲染（单一事实来源）
src/store.js          状态文件读写
src/routes.js         HTTP 路由与请求校验
locale/{zh,en}.json   插件管理页展示文案
cordis.patch.yml      bundle patch
icon.svg              插件图标
test/                 离线测试
```

## 开发与验证

```powershell
npm test
```

覆盖：

- 模式 id 唯一、提示词预算（每条 ≤ 180 汉字）、关闭模式 0 字；
- 状态文件读写、坏数据回落、原子写入、写盘失败后的重试；
- 路由的 405 / 403 / 413 / ping / state / select / 未知模式；
- `/persona` 命令的 input 声明、参数解析与切换结果；
- 客户端工厂、`settings.section` 注册、字典键集、卡片渲染、字数展示与写盘失败提示。

## 发布与维护

CI（`.github/workflows/ci.yml`）在 `ubuntu-latest` 与 `windows-latest` 上跑 Node 20 / 22 / 24，
每条腿两步：`npm test`（离线测试）+ `npm pack --dry-run` 校验 tarball 里确实带上宿主半、客户端半、
`src/`、`cordis.patch.yml`、`locale/`、`icon.svg`、README 与 LICENSE —— 少一个文件，用户装完就是
「装了但设置页不出现」，比测试红更难排查。真实宿主里的开关验证不在 CI：它要在隔离 profile 里启动
桌面宿主，托管 runner 没有交互式桌面会话，结论见下面的「验证记录」。

发版（`.github/workflows/release.yml`）推 `v*` tag 触发：校验 tag 与 `package.json` 版本一致 →
`npm test` → 已发布则跳过、未发布则 `npm publish --provenance` → 建 GitHub Release。
认证走 npm 可信发布（Trusted Publishing / OIDC），仓库里不存任何 npm token。

首次发布按这个顺序（可信发布要求包已存在，且配置创建后 **2 天内**要完成首次成功发布，所以先发再配）：

```powershell
# 本机 npm 默认 registry 是镜像源，登录与发布都要显式指官方源
npm login --registry=https://registry.npmjs.org/
npm test
npm publish --registry=https://registry.npmjs.org/
```

然后在 npmjs.com 的包设置里补 Trusted publishing：GitHub Actions、`railgun20001`、
`dsh-persona-modes`、工作流文件名 `release.yml`。之后每次发版只需改版本号、提交、推 tag：

```powershell
npm version patch --no-git-tag-version
git commit -am "chore(release): 0.1.1"
git tag v0.1.1
git push origin master --tags
```

流程幂等：registry 上已存在的版本不会重发，只补一个 GitHub Release。版本号语义按 0.x 处理 ——
`0.1.x` 修 bug，`0.2.0` 起加模式或改配置/状态文件形状（状态文件只有 `{ version, active, updatedAt }`，
改形状要同时升 `version` 并写迁移）。

## 验证记录（2026-11-05）

- 离线测试：`npm test`，33 项全部通过（模式预算、状态读写失败重试、路由 405/403/413、命令 input、客户端渲染与写盘失败提示）。
- 真实宿主：在隔离 profile 中启动 DSH 0.2.1-rc.5 桌面宿主，插件正常加载；设置 → 人格模式在中文 / English 下均显示 9 张卡片，点击切换立即更新 `state.json`。
- 组装诊断：`POST /dsh-persona-modes/debug` 返回 `sections=[{persona-modes:policy, 53 chars}]`、`contexts=[{persona-modes:active, 149 chars}]`（鲸鱼娘）；切到 `off` 后两者均为空数组，证明关闭模式不产生人格文本。

## 设置页不出现时

按顺序检查：

1. `~/.dsh/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 里有 `dsh-persona-modes`；
2. `~/.dsh/profiles/<profile>/cordis.patch.yml` 里**没有**这类覆盖（有就改成 `disabled: false`）：
   ```yaml
   - id: persona-modes
     name: dsh-persona-modes
     disabled: true
   ```
   插件管理器的开关反映 bundle 选择，但 profile patch 在 bundle 之后应用，`disabled: true` 会真正关掉宿主半。
3. 宿主半在线：`POST http://127.0.0.1:<port>/dsh-persona-modes/ping` 应返回 200；
4. 客户端半属于页面 bundle，改完 profile 后在 DSH 窗口按 `Ctrl+R` 刷新一次。

## 已知限制

- **全局生效**：模式是当前 DSH 用户的全局偏好，不是按会话隔离。切换后所有会话的下一轮都使用新语气。
- **只影响语气**：不会改变模型能力、工具权限或事实准确性；如果模型在长上下文中忽略语气，可以重新切换一次或新开会话。
- **人格设定为非官方拟人**：尤其是「鲸鱼娘」，提示词明确写了「不是官方形象」，不代表 DeepSeek 官方。
- **状态文件是本机用户级**：多个 profile 共用 `~/.dsh/persona-modes/state.json`；如果希望按 profile 隔离，可把 `DSH_HOME` 指到不同目录。

## License

MIT
