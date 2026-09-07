# 阶段二设计文档：核心循环（@、/、结晶、消化）

> 状态：**✅ 已完成 2026-05-27**（已归档，仅作历史参考）· 创建于 2026-05-27
>
> **最终交付**：PR [#1 feat: complete stage 2 core loop](https://github.com/sdyckjq-lab/llm-wiki-agent/pull/1)（14 commit）
>
> **验收结果**：3 条总验收全过；6 个 issue 全部闭合；超出原设计 3 处增强（详见 PRODUCT.md §10 阶段二）
>
> 与 PRODUCT.md 的关系：PRODUCT.md §4 阶段二 + §10 是**顶层意图**，本文档是**落地细则**。冲突时以 PRODUCT.md 为准。
>
> ⚠️ 本文档已归档，**不再修改**。阶段三另开 `docs/stage-3-design.md`。

---

## §0 文档用法

- **范围**：阶段二 8 个 step 的实施细则、API 契约、新增依赖、验收命令、执行 plan、总验收剧本
- **给谁看**：
  - codex（实施）：按 §9 执行 plan 一次性做完 8 step，每 step 一个 commit，最后提 1 个 PR
  - claude（总验收）：按 §10 端到端验收，发现问题按 §10.8 列 issue 清单交作者决策
  - 作者（决策）：审 issue 清单决定让 codex 修还是让 claude 修
- **不在范围**：阶段三 / 四 / 五，open-design Skill 批量挂载（推迟到阶段三）
- **工作流**（重要 — 与本文档既有"逐 step 验收"措辞冲突时以此为准）：
  1. 作者按 §9.6 完成前置准备 → 把本文档交给 codex
  2. codex 按 §9 一次性做完 8 step，提 1 个 PR（8 commit）
  3. claude 按 §10 端到端验收 + 安全审计 + §10.7 对账
  4. claude 列 issue 清单（§10.8 格式），作者决策让 codex 还是 claude 修
  5. 全过后作者按 §11 回写 PRODUCT.md

---

## §1 阶段二总览

**目标**：完成"对话 → 沉淀"闭环。用户能在 chat 里：
- `@` 引用当前库的页面 → agent 知道该读哪一页
- `/` 触发命令 → 内置或 Skill 命令一致入口
- `/sediment` 一键把对话结晶成 wiki 页面
- `/new-wiki` 一键建新知识库
- 粘 URL 触发素材消化
- 在设置面板填 API key（落到 pi-agent 的 auth.json）

**8 step 概览**：

| # | Step | 后端 | 前端 | 重难度 |
|---|---|:---:|:---:|---|
| 1 | `/sediment` Extension 工具 | ✅ | — | 🟢 |
| 2 | `/new-wiki` Extension 工具 | ✅ | — | 🟢 |
| 3 | `/` 命令列表 API | ✅ | — | 🟡 含 TBD-1 |
| 4 | `/` 命令补全 UI | — | ✅ | 🟢 |
| 5 | `@` 引用候选 API | ✅ | — | 🟢 |
| 6 | `@` 补全 UI + 右抽屉 + markdown 渲染 | ✅ 单接口 | ✅ | 🔴 阶段二最重 |
| 7 | 消化新素材 | — | ✅ | 🟢 |
| 8 | 设置面板最小可用 | ✅ | ✅ | 🟡 含 TBD-2 |

**总验收 3 条（来自 PRODUCT.md §4 阶段二）**：

1. 在 app 内点 "+ 新建知识库"，输入名字和方向 → 自动创建 → 出现在列表里
2. 丢一篇文章链接 → agent 消化进库 → 在对话里基于这篇讨论 → 一键结晶为新页面 → 在 `wiki/synthesis/sessions/` 目录里能看到新文件
3. 在 UI 里填一个 Anthropic API key → 测试连接成功 → key 出现在 `~/.pi/agent/auth.json`，未泄露到 `~/.llm-wiki-agent/`

---

## §2 关键技术决策

| ID | 决策 | 选定 | 拒绝项 & 拒绝原因 |
|---|---|---|---|
| D1 | open-design Skill 纳入时机 | **推迟到阶段三**（连同 docx/pdf/pptx 一起批量挂载） | 阶段二范围已满；open-design 132 个 Skill 主体是产出向，恰是阶段三主题 |
| D2 | `/sediment` + `/new-wiki` 形态 | **Extension 工具** | 写成 Skill：可控性差、错误难定位 |
| D3 | 设置面板深度 | **最小可用**：仅 API key 三层认证 + 测试连接 | 完整面板：阶段二验收只要 key 路径，其他可后续补丁 |
| D4 | step 颗粒度 | **8 step** | 5-6 大 step：验收边界模糊；12+ 细 step：流程冗长 |
| D5 | llm-wiki-skill 接入方式 | **作者手动装到 `~/.claude/skills/llm-wiki-skill/`** | submodule：新手不友好；脚本复制：双份维护 |
| D6 | Markdown 渲染器 | **react-markdown + remark-gfm** | marked / markdown-it：生态/类型/插件不如前者稳 |
| D7 | `/` 菜单组件 | **cmdk**（即 shadcn `<Command>` 底层） | Radix Popover / 自写：键盘导航/a11y 要重写 |
| D8 | `@` 候选数据源 | **扫 `wiki/{entities,topics,sources,comparisons,synthesis}/` 全部 .md** | 只读 `index.md`：依赖维护；二者合并：阶段二过早优化 |
| **D9** | **能力归属原则**（对应 PRODUCT.md ADR-16） | **Skill 已有 → 调 Skill；agent 工作台新能力 → Extension** | 100% Skill：让 Skill 塞 agent 特有命令，污染纯提示词系统；100% Extension：重复造轮子，浪费 1.7k 星已有实现 |

**D9 判断标准**：这个功能在 llm-wiki-skill 单独使用时**是否已经存在**？

| 类别 | 归属 | 阶段二例子 |
|---|---|---|
| 建库 / 消化各平台 / 知识库查询 / 健康检查 | **Skill** | Step 2 spawn `init-wiki.sh`；Step 7 包装提示明确调 Skill |
| 对话结晶 / 列页面 / 读单页 / 命令路由 / @ 候选 / auth | **Extension** | Step 1 / 5 / 6 / 3 / 8 |

**为什么 D9 重要**：今天的"agent 调 Skill"边界 = 未来 agent 并入 llm-wiki 仓库后的过渡线（ADR-16）。今天 spawn 外部脚本，合并后变成同仓库调用，调用关系不变；今天 Extension 实现的工作台元能力，合并后直接成为 llm-wiki 的 `agent/` 子目录。

---

## §3 新增依赖

### 前端（`web/package.json`）
- `react-markdown` ^9 — markdown 渲染（Step 6）
- `remark-gfm` ^4 — GFM 支持：表格、任务列表、自动链接（Step 6）
- `cmdk` ^1 — 命令/补全菜单（Step 4 & Step 6 共用）

### 后端
**零新依赖**。现有的 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-agent-core`、`@sinclair/typebox`、`hono`、Node 内置 `fs/child_process/crypto` 已足够。

### 与 PRODUCT.md §3.2 的关系
这 3 个依赖**未在 §3.2 表格列出**。阶段二验收通过后，作者需要：
- §3.2 技术栈表加 2 行（markdown 渲染、命令菜单）
- 新增 **ADR-17：阶段二新增前端依赖（react-markdown + cmdk）**

本文档作为 ADR-17 的草案依据，不抢先改 PRODUCT.md。（ADR-16 已用于「长期与 llm-wiki 仓库合并」决策，见 PRODUCT.md。）

---

## §4 八个 Step 详细设计

每个 step 包含：**动机 / 范围（做+不做）/ 改动文件 / 接口设计 / 实现要点 / 验收 fingerprint / 依赖关系**。

---

### Step 1：`/sediment` Extension 工具

**动机**：阶段二验收第 2 条"结晶"环节。Extension 形态比 Skill 可控、可测、错误可定位（D2）。

**范围**：
- ✅ 把当前 session 的完整对话历史写为单个 markdown 文件到 `<kbPath>/wiki/synthesis/sessions/<timestamp>-<slug>.md`
- ❌ 选中文本结晶（v1 只做整段；选区结晶涉及前后端状态同步，推迟）
- ❌ 让 agent 二次总结（先把对话原文落下来，总结由用户在调用前自己决定要不要让 agent 先 sum 一遍）

**改动文件**：
- 新增 `server/src/extensions/synthesis.ts`
- 修改 `server/src/agent.ts` — 在 `extensionFactories` 数组里注册新 Extension

**接口设计**：
```ts
// server/src/extensions/synthesis.ts
import { Extension } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export function createSynthesisExtension(getActiveKbPath: () => string | null) {
  return new Extension({
    name: "synthesis",
    tools: [{
      name: "sediment_to_wiki",
      description: "把当前对话结晶为 wiki/synthesis/sessions/ 下的一个 markdown 文件。可选 topic 影响文件名。",
      parameters: Type.Object({
        topic: Type.Optional(Type.String()),
        note: Type.Optional(Type.String({ description: "结晶时想补充的备注，写在文件 frontmatter 后" }))
      }),
      handler: async (params, ctx) => {
        const kbPath = getActiveKbPath();
        if (!kbPath) return { content: "❌ 当前没有活跃知识库", details: {} };
        // 1. 用 ctx.session.messages() 读对话历史（参考 server/src/conversations.ts:piMessagesToUIMessages）
        // 2. 拼装 markdown：frontmatter + 备注 + 对话正文
        // 3. 文件名：computeFilename(topic, firstUserMessage)
        // 4. 写到 path（确保 sessions/ 目录已存在）
        // 5. 返回 { content: "已结晶为 wiki/synthesis/sessions/xxx.md", details: { path: relPath } }
      }
    }]
  });
}
```

**实现要点**：

- **文件名规则**：`<YYYY-MM-DD-HHmm>-<slug>.md`
  - slug = `topic` 或 firstUserMessage 截前 20 字
  - trim、空格/标点 → `-`、保留中文/字母/数字/`-`、折叠重复 `-`、去首尾 `-`
  - 例：`2026-05-27-1030-奥派经济学是什么.md`
- **frontmatter**：
  ```yaml
  ---
  date: 2026-05-27T10:30:00+08:00
  source: chat
  conversation_id: <pi session id>
  topic: <topic or empty>
  ---
  ```
- **对话正文**：
  ```md
  ## 👤 用户
  <user content>

  ## 🤖 助手
  <assistant content>
  ```
- 工具调用：append 到对应 assistant 消息后 `<details><summary>工具调用</summary>...</details>`，默认折叠
- 路径安全：写之前确保解析后的 path 仍在 `kbPath/wiki/synthesis/sessions/` 之内

**验收 fingerprint**：
```bash
# 准备：选一个测试 kb 并对话几轮
ls ~/llm-wiki/test-kb/wiki/synthesis/sessions/  # 记录现有数量 N

# 在对话里说："调用 sediment_to_wiki，topic 设为 测试"
ls ~/llm-wiki/test-kb/wiki/synthesis/sessions/  # 应为 N+1
cat ~/llm-wiki/test-kb/wiki/synthesis/sessions/<新文件> | head -30
# 应看到 frontmatter + ## 👤 用户 + ## 🤖 助手 结构
```

**依赖关系**：可独立完成。被 Step 3 引用（builtin 命令清单）。

---

### Step 2：`/new-wiki` Extension 工具

**动机**：阶段二验收第 1 条"app 内一键建库"。

**范围**：
- ✅ spawn `~/.claude/skills/llm-wiki-skill/init-wiki.sh`，传库名 + 研究方向
- ✅ 等待退出，把 stdout/stderr 返回给 agent
- ❌ 自动切换到新库（保持单一职责，agent 用 list_knowledge_bases + select 工具自己切）
- ❌ 自动 reload 前端列表（前端有"刷新"按钮，用户自己点）

**改动文件**：
- 新增 `server/src/extensions/new-wiki.ts`
- 修改 `server/src/agent.ts` — 注册 Extension

**接口设计**：
```ts
// server/src/extensions/new-wiki.ts
new Extension({
  name: "wiki-init",
  tools: [{
    name: "new_wiki",
    description: "在 ~/llm-wiki/ 下新建一个知识库（调用 llm-wiki-skill 的 init-wiki.sh）。需要 llm-wiki-skill 已安装到 ~/.claude/skills/llm-wiki-skill/。",
    parameters: Type.Object({
      name: Type.String({ description: "知识库名（用作目录名，建议英文 kebab-case）" }),
      purpose: Type.String({ description: "研究方向，写入 purpose.md" })
    }),
    handler: async (params) => {
      // 1. 检测 ~/.claude/skills/llm-wiki-skill/init-wiki.sh 是否存在 + 可执行
      //    缺失 → 返回 { content: "❌ llm-wiki-skill 未安装。请 git clone <repo> ~/.claude/skills/llm-wiki-skill/", details: {} }
      // 2. execFile（不要 shell=true），timeout 60s
      // 3. 退出码 0：返回新库绝对路径
      // 4. 退出码非 0：返回 stderr 摘要
    }
  }]
});
```

**实现要点**：
- 用 `child_process.execFile`（**禁用 shell=true** 避免参数注入）
- 超时 60s（init-wiki.sh 实际 5-10s，留余量）
- 参数传递：`execFile(scriptPath, [name, purpose], { timeout: 60_000 })`——具体参数 schema 待确认 llm-wiki-skill 的 init-wiki.sh 签名（TBD-3）
- env：保留 PATH + HOME，其他清空（防止 leak 敏感环境变量到子进程）
- stdout/stderr 收集后 truncate 到 4KB 返回（避免污染 agent context）

**验收 fingerprint**：
```bash
ls ~/llm-wiki/  # 记录现有库
# 在对话里说："用 new_wiki 建一个叫 test-stage2 的库，方向是测试阶段二"
ls ~/llm-wiki/  # 应多 test-stage2/
ls ~/llm-wiki/test-stage2/  # 应包含 wiki/ raw/ purpose.md .wiki-schema.md
# 前端点侧栏刷新 → 应看到 test-stage2 出现
```

**依赖关系**：依赖**用户已装 llm-wiki-skill**（D5），由作者在 step 验收前确保。

---

### Step 3：`/` 命令列表 API

**动机**：Step 4 前端补全菜单需要数据源。

**范围**：
- ✅ `GET /api/commands` → 合并返回：内置命令（Step 1/2 注册的）+ 已加载 Skill 命令
- ✅ 每个命令：`{ slug, name, description, source: "builtin" | "skill:<name>" }`

**改动文件**：
- 修改 `server/src/index.ts` — 新增路由
- 修改 `server/src/agent.ts` — 暴露 `listLoadedSkills()`（看 TBD-1 决定如何实现）

**接口设计**：
```
GET /api/commands

Response 200:
{
  "ok": true,
  "items": [
    { "slug": "/sediment", "name": "sediment_to_wiki", "description": "...", "source": "builtin" },
    { "slug": "/new-wiki", "name": "new_wiki", "description": "...", "source": "builtin" },
    { "slug": "/llm-wiki", "name": "llm-wiki", "description": "...", "source": "skill:llm-wiki" }
  ]
}
```

**实现要点**：
- **内置命令**：硬编码 2 条 builtin，slug 用 kebab-case（`/sediment`、`/new-wiki`）
- **Skill 命令枚举（TBD-1）**：
  - 方案 A（首选）：调 pi-coding-agent SDK 暴露的接口（**先调研，详见 §8 TBD-1**）
  - 方案 B（降级）：fs 扫以下目录，解析 SKILL.md 顶部 YAML frontmatter 拿 `name` + `description`：
    1. `<activeKbPath>/.claude/skills/`（项目级，与 Claude Code 习惯一致）
    2. `~/.claude/skills/`
    3. `~/.pi/agent/skills/`
  - 重名时优先级 1 > 2 > 3，slug 一律 `/<name>`

**验收 fingerprint**：
```bash
curl http://localhost:8787/api/commands | jq
# 至少 2 条 builtin
# 用户机器装了 30+ Skill（cc-switch 软链到 ~/.claude/skills/），应一并列出
```

**依赖关系**：依赖 Step 1 & Step 2（要有 builtin 内容）。

---

### Step 4：`/` 命令补全 UI

**动机**：让用户在输入框输入 `/` 直接选命令。符合 PRODUCT.md §5.3 "`/` 是做事情" 契约。

**范围**：
- ✅ textarea 监听 `/`（位于 token 开头，前一个字符是空格 / 行首 / 空）
- ✅ cmdk 弹出菜单：命令名 + 描述 + 来源分组（"内置" / "Skill"）
- ✅ 键盘导航（↑↓ Enter Esc），模糊搜索（输 `/sed` 匹配 `/sediment`）
- ✅ 选中后替换当前 `/xxx` token 为 `/<slug> `（末尾加空格）
- ❌ 命令参数自动填充（agent 自己填，UI 不替它填）

**改动文件**：
- 修改 `web/package.json` — 加 `cmdk` 依赖
- 运行 `npx shadcn@latest add command` 安装 `web/src/components/ui/command.tsx`
- 新增 `web/src/components/CommandMenu.tsx` — 业务封装
- 修改 `web/src/components/ChatPanel.tsx` — 在 textarea 旁挂 CommandMenu
- 修改 `web/src/lib/api.ts` — 新增 `listCommands(): Promise<CommandItem[]>`

**实现要点**：
- **触发判断**：
  - textarea onChange 时取 `value.slice(0, cursorPos)`
  - 用 `/(^|\s)\/(\S*)$/` 匹配，捕获组 2 是当前查询字符串
  - 没匹配到 → 关菜单；匹配到 → 开菜单并把查询字符串传给 cmdk
- **菜单定位**：用 cursor 的像素坐标（用 textarea-caret-position 算 / 或简化为 textarea 上方固定位置）
- **数据缓存**：组件 mount 时调一次 `listCommands()`，切库时 invalidate
- **选中插入**：保留当前 token 前的内容 + `/<slug> ` + 光标后内容，光标设到插入末尾

**验收 fingerprint**：
```
1. 输入框打 / → 1s 内弹菜单，至少 /sediment、/new-wiki
2. 继续输 sed → 列表过滤到 /sediment
3. Enter → 输入框变 "/sediment "（光标在末尾）
4. Esc → 菜单关
5. 输入 "你好 /se" → 在 /se 位置弹菜单（前面有正常文本）
```

**依赖关系**：依赖 Step 3。

---

### Step 5：`@` 引用候选 API

**动机**：Step 6 前端 @ 补全需要数据源。

**范围**：
- ✅ `GET /api/refs?kb=<encoded path>&q=<query>` → 当前库下匹配 query 的页面
- ✅ 候选 = 扫 `wiki/{entities,topics,sources,comparisons,synthesis}/` 全部 .md（D8）
- ✅ 每条：`{ path, name, category, title }`

**改动文件**：
- 新增 `server/src/pages.ts` — 扫描 + 缓存
- 修改 `server/src/index.ts` — 新增 `/api/refs` 路由

**接口设计**：
```
GET /api/refs?kb=<encoded absolute kb path>&q=<optional query>&limit=20

Response 200:
{
  "ok": true,
  "items": [
    {
      "path": "wiki/entities/austrian-economics.md",
      "name": "austrian-economics",
      "category": "entities",
      "title": "奥派经济学"
    }
  ]
}
```

**实现要点**：
- **扫描**：用 `fs.readdir(dir, { recursive: true })`（Node 20+），过滤 `.md`
- **忽略**：以 `.` 开头的文件 / 目录、`.wiki-tmp/`、`.git/`、`.obsidian/`、`node_modules/`
- **title 提取**：读文件前 1KB，匹配 `/^#\s+(.+)$/m` 拿第一行 H1；没有就用 name
- **缓存**：内存 `Map<kbPath, { items: PageRef[]; scannedAt: number }>`
  - 每次请求 stat `wiki/` 顶层 mtime，与缓存 scannedAt 比，没变直接返回
  - 阶段二只做最简缓存，阶段三再考虑 fs.watch
- **匹配**：q 大小写不敏感
  - 评分：title 命中 + 2，name 命中 + 1，path 命中 + 0.5
  - 按分数降序，取 limit
- **路径安全**：kb 参数必须是已注册的库（在 kbs 列表里），防止扫任意目录

**验收 fingerprint**：
```bash
curl 'http://localhost:8787/api/refs?kb=%2FUsers%2Fxxx%2Fllm-wiki%2Ftest-kb&q=eco' | jq
# 应返回所有 name 或 title 包含 eco 的页面，按相关度排序
```

**依赖关系**：可独立完成。

---

### Step 6：`@` 补全 UI + 右抽屉 + markdown 渲染 🔴

**动机**：阶段二最重的一步。一次承载 @ 补全 + wiki 链接预览 + 右抽屉首次落地。

**范围**：
- ✅ textarea 监听 `@`，弹 cmdk 菜单（候选来自 /api/refs，输入实时查询）
- ✅ 选中后插入 `[[wiki/<category>/<name>.md]]` 链接（agent 看到能直接 Read，与 Obsidian `[[name]]` 风格兼容）
- ✅ assistant 消息用 react-markdown 渲染，自定义组件把 `[[...]]` 渲染为可点击链接
- ✅ 点击 wiki 链接 → 右抽屉打开 → 渲染该 .md 的内容
- ✅ 右抽屉：宽 400px，标题（页面相对路径）+ markdown body + 关闭按钮
- ✅ 切对话时右抽屉**保持**（不强关）
- ❌ 用户消息暂不走 markdown 渲染（保持 whitespace-pre-wrap，避免 `*` `_` 误转义）
- ❌ 代码块语法高亮（阶段二不上 highlight.js，react-markdown 默认 `<code>` 即可）
- ❌ 右抽屉里的 wiki 链接二次跳转（防止递归打开）

**改动文件**：

**后端**：
- 修改 `server/src/index.ts` — 新增 `GET /api/page?kb=<path>&path=<rel>` 返回单页内容

**前端**：
- 修改 `web/package.json` — 加 `react-markdown` `remark-gfm`
- 新增 `web/src/components/RightDrawer.tsx` — 固定右抽屉容器
- 新增 `web/src/components/MarkdownView.tsx` — react-markdown 封装 + wiki 链接拦截
- 新增 `web/src/components/RefMenu.tsx` — `@` 弹出菜单（结构与 CommandMenu 类似，复用 cmdk）
- 修改 `web/src/components/ChatPanel.tsx`：
  - textarea 同时挂 CommandMenu + RefMenu
  - assistant message bubble 用 MarkdownView 渲染
- 修改 `web/src/App.tsx` — 加右抽屉状态（drawerPage: string | null）+ 传递 openPage callback 给 ChatPanel
- 修改 `web/src/lib/api.ts` — 加 `listRefs(kb, q)` + `readPage(kb, relPath)`

**接口设计**（后端 page 接口）：
```
GET /api/page?kb=<encoded absolute kb path>&path=<encoded relative path inside kb>

Response 200:
{ "ok": true, "content": "<raw markdown>" }

Response 400 (path escape attempt):
{ "ok": false, "error": "path must be inside kb" }
```

**实现要点**：

**`@` 触发**：与 `/` 类似，正则 `/(^|\s)@(\S*)$/`；选中后插入 `[[wiki/<category>/<name>.md]] `

**wiki 链接渲染**：react-markdown 的 `components.a` 自定义：
```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    a: ({ href, children }) => {
      if (href?.startsWith("wiki/")) {
        return <a onClick={(e) => { e.preventDefault(); openPage(href); }} ...>{children}</a>;
      }
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    }
  }}
>{content}</ReactMarkdown>
```

但 `[[wiki/...]]` 不是标准 markdown 链接。两种处理：
- **A（推荐）**：在渲染前预处理，把 `[[wiki/x]]` 替换为 `[wiki/x](wiki/x)`，让 react-markdown 当链接处理
- **B**：用 remark plugin 注册自定义 inline 语法（复杂，阶段二不推荐）

**右抽屉**：
- 用 `<aside>` 固定定位 `right-0 top-0 h-full w-[400px]`
- 关闭按钮 + 标题栏 + 滚动区
- 全屏切换推迟到阶段三（PRODUCT.md §5.1 写了 0 / 400 / 全屏三档，阶段二只做 0 / 400）

**路径安全**（后端 page 接口）：
```ts
const requested = path.resolve(kbPath, relPath);
if (!requested.startsWith(path.resolve(kbPath) + path.sep)) {
  return 400; // escape attempt
}
```

**验收 fingerprint**：
```
1. 输入框打 @ → 1s 内弹菜单，列出当前库页面
2. 输 @aus → 过滤到包含 aus 的页面
3. 选中 → 输入框变 "[[wiki/entities/austrian-economics.md]] "
4. 发送，让 agent 回复时引用此页面（或自己粘一段 [[wiki/...]] 测试）
5. assistant 消息里的 [[...]] 应显示为下划线可点击链接
6. 点链接 → 右抽屉滑出，显示该 md 的渲染结果（标题、段落、列表、表格都正常）
7. 切对话 → 右抽屉应保持
8. 点抽屉关闭按钮 → 抽屉收起
9. 试在 url 里加 ?path=../../../../etc/passwd → 应 400
```

**依赖关系**：依赖 Step 5。

---

### Step 7：消化新素材

**动机**：阶段二验收第 2 条"消化"环节。

**范围**：
- ✅ 输入框识别"看起来像 URL"或"本地路径"
- ✅ 检测到时显示 chip："📎 检测到 URL/路径，发送时将作为消化素材"，可关
- ✅ 发送时若 chip 仍亮，把消息包装成（**D9 归属原则：消化是 Skill 本职，明确指示 agent 调 Skill**）：
  ```
  请调用 llm-wiki Skill 把以下素材消化到当前知识库的 raw/，完成后回到对话告诉我落地路径：
  <原文 URL 或 路径>
  ```
- ✅ 走现有 prompt 流（agent 调 llm-wiki Skill 的消化流程；Skill 内部决定是否用 WebFetch / yt-dlp / 各平台抓取器）
- ❌ 拖放上传（推迟到阶段三）
- ❌ 自动消化（用户必须保持 chip 亮 + 按发送，避免误触发）
- ❌ 绕过 Skill 用 agent 内置 WebFetch 自己消化（违反 D9 归属原则；万一 Skill 缺失，agent 应明确报错而非 fallback 到自己写文件）

**改动文件**：
- 修改 `web/src/components/ChatPanel.tsx`

**实现要点**：
- **URL 识别**：`/^https?:\/\/\S+$/`（trim 后整段是 URL）
- **路径识别**：`/^(\/|~\/)\S+$/`（trim 后整段以 / 或 ~/ 开头，无空格）
- **chip UI**：输入框上方，灰色背景 + 文字 + 关闭 ✕
- **包装时机**：onSend 时检查 chip 状态，亮就 wrap，灭就照原文发
- **不强加**：若用户只是想讨论 URL 而非消化，关 chip 即可正常发

**验收 fingerprint**：
```
1. 输入框粘贴 https://karpathy.github.io/2025/06/27/something/
2. 输入框上方应出现 chip "📎 检测到 URL..."
3. 点 ✕ → chip 消失
4. 重新粘贴 → chip 又出现
5. 保持 chip 亮，发送
6. agent 应触发 WebFetch + Skill 流程
7. ls ~/llm-wiki/<kb>/raw/  # 应有新文件
```

**依赖关系**：建议在 Step 2 验收完成后做（这样测试时能用 /new-wiki 建测试库）。

---

### Step 8：设置面板最小可用

**动机**：阶段二验收第 3 条（D3 决策：只做 API key 三层 + 测试连接）。

**范围**：
- ✅ 独立面板（modal 形式，不复用右抽屉）
- ✅ 只有 1 个 Tab "认证"，包含三个区：
  - **登录方式状态**：检测 `~/.pi/agent/auth.json` 是否存在 + 列已配 provider（不显示 key）
  - **添加 API key**：provider 选择器 + key 输入（type=password）+ "保存并测试" 按钮
  - **环境变量**：只读列 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` 等是否存在（不显示值）
- ❌ 默认模型选择器、根目录修改、外部库管理 UI（阶段二补丁或阶段三）

**改动文件**：

**后端**：
- 新增 `server/src/auth.ts` — 读写 `~/.pi/agent/auth.json`（原子 + 0600 + 备份）
- 修改 `server/src/index.ts` — 新增 3 个路由

**前端**：
- 新增 `web/src/components/SettingsPanel.tsx`
- 修改 `web/src/components/ChatPanel.tsx` — 把 disabled 的 "⚙ 设置" 按钮接通
- 修改 `web/src/lib/api.ts` — 加 `getAuthStatus / setAuthKey / testAuthConnection`

**接口设计**：

```
GET /api/auth/status

Response 200:
{
  "ok": true,
  "authFileExists": true,
  "providers": [
    { "id": "zai", "type": "api_key", "configured": true }
  ],
  "envKeys": [
    { "name": "ANTHROPIC_API_KEY", "present": false },
    { "name": "OPENAI_API_KEY", "present": false }
  ]
}
```

```
POST /api/auth/set
Body: { "provider": "anthropic", "type": "api_key", "key": "sk-ant-xxx" }

Response 200:
{ "ok": true }
```

```
POST /api/auth/test
Body: { "provider": "anthropic" }

Response 200:
{ "ok": true, "message": "连接成功，模型可用" }

Response 200 (失败):
{ "ok": false, "error": "401 Unauthorized" }
```

**实现要点**：

**写 `~/.pi/agent/auth.json` 安全流程**：
1. read 现有内容 → JSON.parse（解析失败 → 备份后视为空对象）
2. 备份到 `~/.pi/agent/auth.json.bak.<unix-timestamp>`
3. merge 新条目
4. JSON.stringify(merged, null, 2)
5. write 到 `auth.json.tmp.<pid>.<random>`
6. fs.chmod 0o600
7. fsync
8. rename 到 `auth.json`
9. 失败时从备份回滚

**测试连接（TBD-2）**：
- 方案 A（首选）：用 pi-coding-agent SDK 创建一个临时 session，发空 prompt，等到第一个事件成功就销毁（最小成本一次调用）
- 方案 B（降级）：直接对 provider endpoint 发一次最小请求
  - Anthropic：POST `/v1/messages`，model: claude-haiku-4-5（最便宜），max_tokens: 1
  - OpenAI：GET `/v1/models`
- **不在前端持有 key**：先 `/api/auth/set` 写入，再 `/api/auth/test` 测试（避免 key 在前端 state 久留）

**安全约束**：
- 全程不在 `~/.llm-wiki-agent/` 写 key
- 不在日志打 key（即使 prefix）
- input type=password + autocomplete=off
- 已存 key 只显示"已配置 ✓"，不显示明文 / 不显示前缀 / 不显示长度

**验收 fingerprint**：
```bash
# 1. 点 ⚙ 设置 → SettingsPanel 弹出
# 2. 看到当前 providers（如 zai 已配）+ envKeys 列表
# 3. 选 Anthropic → 输 sk-ant-xxx → 保存
ls -la ~/.pi/agent/auth.json  # 权限应为 -rw------- (600)
cat ~/.pi/agent/auth.json | jq '.anthropic'  # 应有新条目
# 4. 点"测试连接"
#    成功 → 绿色"连接成功"提示
#    失败 → 红色错误 + 原始错误信息（不含 key 值）
# 5. 排查泄露
grep -r "sk-ant" ~/.llm-wiki-agent/ 2>/dev/null  # 应无输出
ls ~/.pi/agent/auth.json.bak.*  # 应有备份
```

**依赖关系**：可独立完成。阶段二验收第 3 条**强依赖**。

---

## §5 数据契约

### 5.1 Wiki 链接格式
- **形式**：`[[wiki/<category>/<name>.md]]`
- **例**：`[[wiki/entities/austrian-economics.md]]`
- **理由**：
  - 路径显式，agent 看到能直接 Read，不依赖索引
  - 与 Obsidian `[[name]]` 风格兼容（Obsidian 会把它当文件链接处理）
  - 与 PRODUCT.md §5.3 "@ 是引用、/ 是执行" 契约对齐

### 5.2 `/sediment` 文件命名
- **格式**：`<YYYY-MM-DD-HHmm>-<slug>.md`
- **slug 规则**：
  1. 取 `topic` 参数（若有），否则取 firstUserMessage 前 20 字
  2. trim
  3. 空格/标点 → `-`
  4. 保留中文 / 字母 / 数字 / `-`
  5. 折叠重复 `-`，去首尾 `-`
- **例**：`2026-05-27-1030-奥派经济学是什么.md`

### 5.3 命令 slug 命名
- 内置工具名：snake_case，如 `sediment_to_wiki`、`new_wiki`（沿用阶段一）
- 命令 slug：kebab-case，如 `/sediment`、`/new-wiki`
- Skill 命令 slug：`/<skill name>`（Skill 的 name 通常本就是 kebab-case）

### 5.4 API 命名空间一览
| 路径 | 方法 | step | 用途 |
|---|---|---|---|
| `/api/commands` | GET | 3 | 命令列表 |
| `/api/refs` | GET | 5 | @ 候选页面 |
| `/api/page` | GET | 6 | 读单页 markdown |
| `/api/auth/status` | GET | 8 | 三层认证状态 |
| `/api/auth/set` | POST | 8 | 写入 key 到 pi auth.json |
| `/api/auth/test` | POST | 8 | 测试连接 |

阶段一已有：`/api/health`、`/api/knowledge-bases`、`/api/knowledge-base`、`/api/knowledge-bases/external`、`/api/conversations`、`/api/conversations/new`、`/api/prompt`。

---

## §6 验收清单

### 6.1 总验收（PRODUCT.md §4 阶段二）
- [ ] **验收 1**：在 app 内点 "+ 新建知识库"，输入名字和方向 → 自动创建 → 出现在列表里
  - 通过路径：UI 触发 → agent 调 `new_wiki` 工具 → init-wiki.sh 跑完 → 用户点侧栏刷新看到新库
- [ ] **验收 2**：丢一篇文章链接 → agent 消化进库 → 在对话里基于这篇讨论 → 一键结晶为新页面 → 在 `wiki/synthesis/sessions/` 目录里能看到新文件
  - 通过路径：粘 URL → chip 亮 → 发送 → agent WebFetch + 写 raw/ → 对话讨论 → 调 `sediment_to_wiki` → 文件落地
- [ ] **验收 3**：在 UI 里填一个 Anthropic API key → 测试连接成功 → key 出现在 `~/.pi/agent/auth.json`，未泄露到 `~/.llm-wiki-agent/`
  - 通过路径：设置面板 → 输 key → 保存 → 测试 → 看 auth.json + 0600 权限 + grep 排查泄露

### 6.2 每个 Step 的本地验收
见 §4 各 step 的"验收 fingerprint"小节。每个 step 完成后必须跑完对应命令并 attach 输出。

### 6.3 综合体感验收（作者主观）
- [ ] 输入 `/` 1 秒内菜单弹出
- [ ] 输入 `@` 1 秒内菜单弹出（首次扫描可稍久，含缓存后必须 1s）
- [ ] 切对话后右抽屉保持
- [ ] 暗色主题下所有新组件无白色露馅
- [ ] 设置面板的"测试连接"成功后有明显视觉反馈（绿色 + 文案，不只是文字）
- [ ] 三档键盘体验：Tab 焦点流可控、Esc 关菜单 / 抽屉 / 面板、Enter 不误提交

### 6.4 安全验收（设置面板专项）
- [ ] `grep -r "sk-" ~/.llm-wiki-agent/` 无输出
- [ ] `grep -r "sk-" server/` 无输出（除测试 fixture）
- [ ] `~/.pi/agent/auth.json` 权限 `-rw-------`
- [ ] 前端 React DevTools 检查：保存 key 后任何组件 state 都不含 key 明文

---

## §7 给 codex 的交接说明

### 7.1 工作前必读
1. `CLAUDE.md`（项目级 + 全局 AI 协作规则）
2. `PRODUCT.md`（产品意图全文，特别是 §3 架构、§4 阶段二、§5 UI、§6 数据、§7 ADR）
3. 本文档（实施细则）

### 7.2 工作节奏
- **一次性按 §9 顺序做完 8 step**，不等逐 step 验收
- **每个 step 一个原子 commit**（共 8 个，方便 review 和回滚；禁止 1 大 commit）
- **允许在 8 个 step commit 之外补充 `fix(stage-2): ...` 修复 commit**：codex 自查或 claude 验收过程中发现真实 bug 应立即补修复 commit（比"留给作者"更负责）；每个 fix 也是原子 commit，不要把多个修复揉一起；触发 fix 时在 PR body 的"已知妥协"段落里说明"额外 N 个修复 commit + 原因"
- commit message 格式：
  ```
  feat(stage-2-step-N): <一句话>

  - 改动 1
  - 改动 2

  本 step 验收：
  $ <command>
  <expected output>
  ```
- 8 step 全做完后提 **1 个 PR**，PR body 必须含 §10.7 交付物对账单（详见 §7.5）
- 每个 step 的 diff 控制在 300 行以内（含新增文件）；超出请在 commit body 说明原因
- **遇到 TBD**：按 §9.5 预定的降级矩阵自动决策，**不要停下等作者**

### 7.3 不要做的事
- ❌ 加 §3 之外的新依赖
- ❌ 重构阶段一已有代码（除非本文档明确写要改）
- ❌ 顺手"改善"旁边的代码 / 注释 / 格式
- ❌ commit message 或代码里出现作者真实姓名，统一用 `Kiro`
- ❌ `server/src/` 或 `web/src/` 出现本机用户主目录绝对路径（用相对路径或 `homedir()`；docs/ 内允许此类示例文本）
- ❌ `--no-verify` 跳 hook、`--amend` 改前一个 commit、`-f` push
- ❌ push 到 main、合并到 main
- ❌ 修改 PRODUCT.md（除非本文档明确要求）

### 7.4 卡住怎么办（与一次性 8 step 工作流一致）
- **本文档未覆盖的细节歧义**：先按合理推测做，在 commit body 标 `[judgment: ...]` 描述判断依据，claude 总验收时审
- **某 step 完成后发现下一个 step 设计有问题**：先做完本 step，再用 commit body 标 `[design-issue: step N+1 描述]`，**不要顺手改下一个 step 的设计**
- **TBD 项**（§8）：按 §9.5 降级矩阵自动决策，触发降级在 commit body 标 `[TBD-X 降级到 方案Y: 原因]`

### 7.5 PR 交付清单（PR body 必含）
8 step 全做完提 1 个 PR 时，PR body 必含：
- 8 个 commit 的 hash + 一句话
- 每个 step fingerprint 的实测输出（粘贴或截图，可折叠 `<details>`）
- §10.7 交付物对账单（逐项打勾）
- 触发的 TBD 降级记录（哪个 TBD → 哪个方案 → 原因）
- 已知的妥协 / 推迟事项
- 实施过程中发现的"本文档需要修订"清单

---

## §8 风险与待办（TBD）

### TBD-1：pi-coding-agent SDK 是否暴露 Skill 列表 API
**影响**：Step 3 实现方式

**调研路径**：
1. `grep -rE "Skill|skill" server/node_modules/@earendil-works/pi-coding-agent/dist/*.d.ts`
2. 看 pi-agent 官方文档 sdk.md / skills.md（在 pi-agent 源码 `docs/` 下）
3. 如有 `session.skills()` / `session.listLoadedSkills()` 类 API 直接用

**降级方案**：fs 扫目录 + 解析 SKILL.md frontmatter
- 扫描路径优先级：
  1. `<activeKbPath>/.claude/skills/`（项目级）
  2. `~/.claude/skills/`（用户级）
  3. `~/.pi/agent/skills/`（pi-agent 默认）
- 解析每个 Skill 目录下的 `SKILL.md`：
  ```yaml
  ---
  name: <skill-name>
  description: <one-liner>
  ---
  ```
- 重名时优先级 1 > 2 > 3

### TBD-2：测试连接的实现方式
**影响**：Step 8 测试按钮

**候选方案**：
- **A（首选）**：用 pi-coding-agent SDK 临时 session + 最小 prompt
  - 优点：完全复用 pi-agent 的多 provider 抽象
  - 风险：需要找到"创建 session 不实际发请求"或"发完立即销毁"的 API
- **B**：直接调 provider endpoint
  - Anthropic：POST `/v1/messages`，最小 model + max_tokens=1
  - OpenAI：GET `/v1/models`
  - 风险：每加一个 provider 要写一份测试代码
- **C（兜底）**：不做按钮，验收第 3 条改为"看 auth.json 落地 + 0600"作为唯一硬标准
  - 风险：UX 不闭环，用户不知道 key 对不对

**推荐**：先按 A 试，遇阻降到 B（仅 Anthropic + OpenAI），都失败降到 C 并修改本文档 + 与作者确认。

### TBD-3：llm-wiki-skill 的 init-wiki.sh 参数签名 ✅ 已解决（codex Step 2 实施时确认）

**设计期事实**：当时用户机器 `~/.claude/skills/llm-wiki-skill/` 和 `~/.pi/agent/skills/llm-wiki-skill/` **都没有**这个 Skill。

**已确认参数签名**：`init-wiki.sh <wiki path> <topic> <language>`（三个位置参数）

**已确认脚本实际位置**：`~/.claude/skills/llm-wiki-skill/scripts/init-wiki.sh`（**不在** skill 根目录）。codex 的 `server/src/wiki-init.ts::findInitScript()` 已兼容两种位置——先查根目录后查 `scripts/`，对未来 llm-wiki-skill 重组目录有韧性。

**作者操作**（已完成）：手动 clone llm-wiki-skill 到 `~/.claude/skills/llm-wiki-skill/`。

**长期**：阶段五打包时考虑把 llm-wiki-skill 作为 onboarding 一键安装项。

### TBD-4：右抽屉与 PRODUCT.md §5.1 的契合度
**事实**：PRODUCT.md §5.1 说"右抽屉默认隐藏，呼出场景：产物预览、引用页面查看、设置面板"

**阶段二**：
- 引用页面查看 → Step 6 右抽屉 ✅
- 设置面板 → Step 8 做成 modal（D3 范围内）

**疑问**：是否需要把设置面板也改回右抽屉形态？

**当前判断**：设置面板用 modal，因为：
- 设置是"打断式"操作，modal 的"必须先关才能继续"模式更合适
- 右抽屉只放"参考式"内容（页面预览），与 chat 并行查看
- 这条偏离 PRODUCT.md §5.1，验收时与作者确认

### TBD-5：消化新素材的"包装提示"语 ✅ 已解决（D9 / ADR-16）

**事实**：Step 7 的 wrap 文本会影响 agent 行为。

**已选定**（D9 归属原则强制）：
```
请调用 llm-wiki Skill 把以下素材消化到当前知识库的 raw/，完成后回到对话告诉我落地路径：
<原文 URL 或 路径>
```

**为什么这个表述**：
- 明确指示走 Skill（不是 "agent 自己看着办"），遵守 D9 「消化属于 Skill 本职」
- 指定落地位置 `raw/`（防止 agent 自由发挥写错地方）
- 要求回报落地路径（方便用户验收）

**Skill 缺失时**：Step 7 不 fallback 到 agent 自己写文件；agent 应明确报错"llm-wiki Skill 未加载"，由用户去装。这避免破坏 Skill 边界。

---

## §9 执行 plan（codex 工作清单）

### 9.1 工作流概览

```
作者准备 ───→ codex 实施 ───→ claude 总验收 ───→ 作者决策
   ↓             ↓                ↓                ↓
 §9.6 前置    §9.3 8 commit     §10 剧本         §10.8 issue
              + 1 PR            + 安全审计        分工修复
```

### 9.2 step 依赖图

```
        Step 1 (/sediment)
              ↓
              ├─→ Step 3 (/api/commands) ──→ Step 4 (/ UI)
              ↓
        Step 2 (/new-wiki) ──→ Step 7 (消化) [测试期依赖]

        Step 5 (/api/refs) ──→ Step 6 (@ UI + 右抽屉 + md)

        Step 8 (设置面板) [独立]
```

- **强依赖**（不可并行）：1→3→4；2→7（仅测试期）；5→6
- **可并行/独立**：8 全程独立；1/2/5/8 之间无依赖；3 必须在 1+2 完成后

### 9.3 推荐执行顺序与 commit 编号

| Commit # | Step | 复杂度 | 说明 |
|---|---|---|---|
| C1 | Step 1（/sediment Extension） | 🟢 低 | 后端独立，先建立信心 |
| C2 | Step 2（/new-wiki Extension） | 🟢 低 | 依赖 D5（llm-wiki-skill 已装） |
| C3 | Step 5（/api/refs API） | 🟢 低 | 后端独立，为 Step 6 让路 |
| C4 | Step 3（/api/commands API） | 🟡 中 | 含 TBD-1 调研 |
| C5 | Step 8（设置面板后端 + 前端） | 🟡 中 | 含 TBD-2 调研 + 安全敏感 |
| C6 | Step 4（/ 命令补全 UI） | 🟡 中 | 引入 cmdk + 第一个补全菜单 |
| C7 | Step 6（@ UI + 右抽屉 + md）🔴 | 🔴 高 | 阶段二最重，引入 react-markdown |
| C8 | Step 7（消化 chip） | 🟢 低 | 收尾贯穿测试用例 |

**顺序设计原因**：
- 先后端（1/2/3/5）再前端（4/6）：前端补全菜单需要后端数据源
- Step 8（设置面板）放中段：含 TBD-2 风险，早暴露
- Step 6 放倒数第二：最重，留足时间
- Step 7 放最后：是"消化→讨论→结晶"贯穿测试，依赖其他 step 已就位

### 9.4 commit 策略

- 每 step 一个原子 commit（共 8 个）
- commit message 见 §7.2
- **禁止**：1 个大 commit 覆盖 8 step；多个 step 揉进同一 commit
- **允许**：单个 step 内部多次 reset 整理后压成 1 个 commit
- 全做完后提 **1 个 PR**，PR body 含 §10.7 对账单
- 在新分支 `stage-2` 上 commit，不要在 main 上动

### 9.5 TBD 降级矩阵（codex 自动决策表）

遇到 TBD 时按下表预定方案，**不要停下等作者**：

| TBD | 影响 Step | 先试（方案 A） | 失败降级（方案 B） | 终极兜底（方案 C） |
|---|---|---|---|---|
| TBD-1（Skill 列表 API） | 3 | grep SDK dist + 读 pi-agent docs 确认 API 存在 → 直接调 | fs 扫 `~/.claude/skills/` + `~/.pi/agent/skills/` + 解析 SKILL.md frontmatter | 内置命令 only，不列 Skill |
| TBD-2（测试连接） | 8 | SDK 临时 session 发空 prompt | 直打 Anthropic `/v1/messages`（model=claude-haiku-4-5, max_tokens=1）+ OpenAI `/v1/models` | 不做按钮，仅靠 auth.json 落地 + 0600 作硬验收 |
| ~~TBD-3~~（init-wiki.sh 参数，✅ 已由 Step 2 实施时解决） | 2 | 已确认参数 `<wiki path> <topic> <language>`；脚本实际在 `~/.claude/skills/llm-wiki-skill/scripts/init-wiki.sh`；`findInitScript()` 兼容根目录与 `scripts/` 两种位置 | — | — |
| TBD-4（设置面板形态） | 8 | 实现成 modal（推荐方案） | — | — |
| ~~TBD-5~~（消化包装语，✅ 已由 D9 / ADR-16 解决） | 7 | 固定使用 §8 TBD-5 已选定的"请调用 llm-wiki Skill 消化..."文本 | — | — |

**触发降级时**：codex 必须在对应 commit body 标 `[TBD-X 降级到 方案Y: 原因]`，方便 claude 验收时知道偏离。

### 9.6 前置准备（作者在 codex 启动前完成）

- [ ] git clone llm-wiki-skill → `~/.claude/skills/llm-wiki-skill/`（D5 / TBD-3）
- [ ] 确认 `chmod +x ~/.claude/skills/llm-wiki-skill/scripts/init-wiki.sh`（实际位置）；旧版若在根目录请 chmod 那个；codex 的 findInitScript 已兼容两种位置
- [ ] 准备 1 个 Anthropic / OpenAI test key（用于 Step 8 验收，可临时）
- [ ] 准备 1-2 个测试用 URL（karpathy 博客或任意公开文章）
- [ ] git checkout 新分支 `stage-2`（codex 在此分支 commit）

---

## §10 总验收剧本（claude 总验收用）

### 10.1 验收顺序

1. **静态检查**：grep / lint / 文件结构对账（不跑应用）
2. **启动检查**：`npm run dev` 后端起、前端起、阶段一回归
3. **端到端剧本 1**：建库 → 消化 → 讨论 → 结晶（覆盖验收 1+2）
4. **端到端剧本 2**：设置面板 → 填 key → 测试 → 落地（覆盖验收 3）
5. **安全审计**：grep key 泄露、文件权限、路径逃逸
6. **体感测试**：菜单延迟、键盘、暗色主题
7. **对账单核对**：§10.7 逐项打勾
8. **issue 清单**：按 §10.8 格式列 → 交作者

### 10.2 端到端剧本 1：建库 → 消化 → 讨论 → 结晶

```bash
# 预置：app 已启动，已 git clone llm-wiki-skill 到 ~/.claude/skills/

# Phase 1：建库（覆盖验收 1）
# 在 UI 对话框说："用 new_wiki 建一个叫 stage2-acceptance 的库，方向是测试阶段二验收"
# 预期：agent 调用 new_wiki 工具，几秒后返回成功
ls ~/llm-wiki/stage2-acceptance/  # 应有 wiki/ raw/ purpose.md .wiki-schema.md
# 点侧栏刷新 → 应看到 stage2-acceptance
# 切换到 stage2-acceptance

# Phase 2：消化（验收 2 第 1 段）
# 输入框粘贴 https://karpathy.github.io/2025/06/27/...（任一公开文章）
# 预期：chip 出现 "📎 检测到 URL..."
# 发送 → agent 应触发 WebFetch + llm-wiki Skill
ls ~/llm-wiki/stage2-acceptance/raw/  # 应有新文件

# Phase 3：讨论（验收 2 第 2 段）
# 在对话里继续问："这篇文章的核心论点是什么？基于已消化的素材分析"
# 预期：agent 读取 raw/ 内容 + 给出讨论
# 试输入 @ → 应弹出 @ 菜单

# Phase 4：结晶（验收 2 第 3 段）
# 在对话里说："/sediment topic:karpathy-核心论点"
# 或："调用 sediment_to_wiki，topic 设为 karpathy-核心论点"
ls ~/llm-wiki/stage2-acceptance/wiki/synthesis/sessions/  # 应有新 .md
# cat 看 frontmatter + ## 👤 用户 + ## 🤖 助手 结构

# Phase 5：链接预览（Step 6）
# 在对话里发送一条含 [[wiki/synthesis/sessions/<新文件名>]] 的消息
# 预期：assistant 回复里点击该链接 → 右抽屉打开 → 显示该页 markdown
```

### 10.3 端到端剧本 2：设置面板填 key（覆盖验收 3）

```bash
# 预置：备份现有 ~/.pi/agent/auth.json
cp ~/.pi/agent/auth.json ~/.pi/agent/auth.json.preacceptance

# Phase 1：UI 操作
# 点 ⚙ 设置 → SettingsPanel 弹出
# 应看到当前 providers（如 zai 已配）+ envKeys 列表

# Phase 2：填 key
# 选 Anthropic → 输 sk-ant-test-xxx → 保存

# Phase 3：测试连接
# 点测试连接按钮
# 期望：成功 → 绿色提示；失败 → 红色错误但不含 key 值

# Phase 4：验收落地
cat ~/.pi/agent/auth.json | jq '.anthropic'  # 应有新条目
ls -la ~/.pi/agent/auth.json  # 权限必须是 -rw------- (600)

# Phase 5：泄露检查（§10.5 重点）
grep -rE "sk-ant" ~/.llm-wiki-agent/ 2>/dev/null  # 必须无输出

# Phase 6：清理
cp ~/.pi/agent/auth.json.preacceptance ~/.pi/agent/auth.json
rm ~/.pi/agent/auth.json.preacceptance
```

### 10.4 阶段一回归测试（防止破坏既有功能）

```bash
# A. 启动
npm run dev  # 应一行起前后端，无 error
curl http://localhost:8787/api/health  # 200 OK

# B. 知识库
# 侧栏应列出 ~/llm-wiki/ 下所有库 + 外部登记的库
# 点不同库 → 应切换 + 自动选最近对话

# C. 对话
# 在已有库新建对话 → 输入 → 发送 → 应流式返回
# 切对话 → 重挂载 → 显示该对话历史

# D. 自动恢复
# 关闭后端 → 重启 → 应自动恢复到 lastUsedKbPath
```

### 10.5 安全审计 checklist

> ⚠️ 本 checklist 故意只扫 `server/src/`、`web/src/`，**不扫 `docs/`**——避免本设计文档自身的占位/示例文本被自报警。

- [ ] `grep -rE "sk-[a-zA-Z0-9_-]{20,}" ~/.llm-wiki-agent/` 无输出
- [ ] `grep -rE "sk-[a-zA-Z0-9_-]{20,}" server/src/` 无输出
- [ ] `grep -rE "sk-[a-zA-Z0-9_-]{20,}" web/src/` 无输出
- [ ] `~/.pi/agent/auth.json` 权限 `-rw-------`（600）
- [ ] 试 `curl 'http://localhost:8787/api/page?kb=<valid>&path=../../../../etc/passwd'` → 应 400
- [ ] 试 `curl 'http://localhost:8787/api/refs?kb=/etc'` → 应 400（未注册的 kb）
- [ ] React DevTools 看 SettingsPanel：保存后任何 state 都不含 key 明文
- [ ] commit log + `server/src/` + `web/src/` 不含本机用户主目录绝对路径（请用相对路径或 `homedir()`；不在 `docs/` 范围内扫，文档可以使用抽象占位）
- [ ] commit log 不含真实姓名（应统一 `Kiro`）

### 10.6 体感测试

- [ ] 输入 `/` → 菜单 ≤1s 弹出
- [ ] 输入 `@` → 菜单 ≤1s 弹出（首次扫描可 2s，缓存后必须 ≤1s）
- [ ] 切对话 → 右抽屉**保持**
- [ ] 点右抽屉关闭 → 平滑收起，不闪
- [ ] 暗色主题：所有新组件无白色露馅、无对比度不足
- [ ] 设置面板"测试连接"成功 → 绿色 + 文案，不只是文字
- [ ] Tab 焦点流可控、Esc 关菜单/抽屉/面板、Enter 不误提交对话

### 10.7 交付物对账单

**新增文件**（codex 必须全部产出）：
- [ ] `server/src/extensions/synthesis.ts`
- [ ] `server/src/extensions/new-wiki.ts`
- [ ] `server/src/pages.ts`
- [ ] `server/src/auth.ts`
- [ ] `web/src/components/ui/command.tsx`（shadcn 生成）
- [ ] `web/src/components/CommandMenu.tsx`
- [ ] `web/src/components/RefMenu.tsx`
- [ ] `web/src/components/MarkdownView.tsx`
- [ ] `web/src/components/RightDrawer.tsx`
- [ ] `web/src/components/SettingsPanel.tsx`

**修改文件**（codex 必须全部触达）：
- [ ] `server/src/agent.ts`（注册 2 个新 Extension）
- [ ] `server/src/index.ts`（新增 6 个路由）
- [ ] `web/src/App.tsx`（右抽屉状态）
- [ ] `web/src/components/ChatPanel.tsx`（挂菜单 + markdown 渲染 + chip + 设置按钮接通）
- [ ] `web/src/lib/api.ts`（6 个新 client 函数）
- [ ] `web/package.json`（3 个新依赖）

**新增 API**（curl 应全部 200）：
- [ ] `GET /api/commands`
- [ ] `GET /api/refs?kb=...&q=...`
- [ ] `GET /api/page?kb=...&path=...`
- [ ] `GET /api/auth/status`
- [ ] `POST /api/auth/set`
- [ ] `POST /api/auth/test`

**新增 Extension 工具**（agent 应能调用）：
- [ ] `sediment_to_wiki`
- [ ] `new_wiki`

**新增前端依赖**（package.json 应有）：
- [ ] `react-markdown` ^9
- [ ] `remark-gfm` ^4
- [ ] `cmdk` ^1

**Commit 数量**：8 个（顺序见 §9.3）

### 10.8 issue 清单格式（策略 B：claude 列 → 作者决策 → 谁修）

总验收发现问题 → 不直接改 → 列清单交作者决策。每条 issue 含：

```markdown
### Issue #N：<一句话标题>

**严重度**：🔴 阻塞验收 / 🟡 不阻塞但应修 / 🟢 建议

**所属 step**：Step X

**期望**（来自本文档）：
> <引用本文档对应段落>

**实际**：
<观察到的事实，附 commit hash + 文件路径 + 命令输出>

**复现**：
\`\`\`bash
<具体命令>
\`\`\`

**根因猜测**：
<我的分析；明确标"猜测" vs "事实">

**建议归属**：
- [ ] codex 修（属于实现质量问题，回到 codex）
- [ ] claude 修（属于设计文档没写清楚，由 claude 改文档 + 改实现）
- [ ] 作者决策（不确定归属，需作者拍板）

**修复路径草案**：
<可选，给一个修法思路>
```

全部 issue 列完后给作者一个总览表：

```
| # | 严重度 | step | 一句话 | 建议归属 |
|---|---|---|---|---|
| 1 | 🔴 | 6 | 右抽屉点击 wiki 链接无反应 | codex |
| 2 | 🟡 | 8 | 测试连接成功后无视觉反馈 | codex |
| 3 | 🟢 | 5 | 缓存失效条件可优化 | 后续 |
```

作者按归属批准 → claude/codex 分别修 → claude 再验收一轮 → 直到全绿。

---

## §11 文档维护

- **本文档 = 阶段二实施计划**。实施过程偏离时在本文档加"实施记录"块说明
- **阶段二验收通过后**：
  - PRODUCT.md §10 阶段二章节填具体 commit hash + 完成情况 + 接受的妥协
  - PRODUCT.md §3.2 技术栈表加 2 行（react-markdown、cmdk）
  - PRODUCT.md 新增 **ADR-17：阶段二新增前端依赖（react-markdown + cmdk）**（ADR-16 已用于「长期合并」决策）
  - 本文档标 `✅ 已完成 <日期>`，不再修改（归档）
- **阶段三启动**：新建 `docs/stage-3-design.md`，本文档作为参考样本
