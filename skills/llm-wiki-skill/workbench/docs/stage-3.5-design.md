# 阶段 3.5 设计文档：导航 UX 重构 + 多模型子代理批量消化

> 状态：**已完成** · 创建于 2026-05-27 · 验收于 2026-05-27 · 阶段 3.5 验收通过后归档不再修改
>
> 与 PRODUCT.md 的关系：PRODUCT.md §4 阶段 3.5 + §10 是**顶层意图**，本文档是**落地细则**。冲突时以 PRODUCT.md 为准；本文档外发现新决策需要先回写 PRODUCT.md。

---

## §0 文档用法

- **范围**：阶段 3.5 共 7 个 step 的实施细则、API 契约、新增依赖、验收命令、执行 plan、总验收剧本
- **给谁看**：
  - codex（实施）：按 §9 执行 plan 一次性做完 7 step，每 step 一个 commit，最后提 1 个 PR
  - claude（总验收）：按 §10 端到端验收，发现问题按 §10.8 列 issue 清单交作者决策
  - 作者（决策）：审 issue 清单决定让 codex 修还是让 claude 修
- **不在范围**：图谱（阶段四）、Tauri 打包（阶段五）、媒体创作 / 浏览器扩展（阶段后规划）
- **工作流**（沿用阶段二 / 阶段三验证有效的流程）：
  1. 作者按 §9.6 完成前置准备（pi `auth.json` 至少配两组 provider 凭证用于多模型测试）
  2. codex 按 §9 一次性做完 7 step，提 1 个 PR（7 commit + 允许 fix-commit）
  3. claude 按 §10 端到端验收 + 安全审计 + §10.7 对账
  4. claude 列 issue 清单（§10.8 格式），作者决策让 codex 还是 claude 修
  5. 全过后作者按 §11 回写 PRODUCT.md

---

## §1 阶段 3.5 总览

**背景**：阶段 1-3 完成后作者实际使用 app 发现两类痛点——

1. **导航 UX 反直觉**：
   - 侧栏强行把 KB 分成"默认"/"外部"两类，违反"KB = 项目"心智（其他工具如 Codex App / Claude Desktop 都是一栏到底）
   - 对话列表挂在侧栏中间，没有从属于 KB 的视觉层级，看不出"这堆对话属于哪个库"
   - "添加现有库"需要手输绝对路径，常常失败；新建库要点完整 dialog，与"拖入 Finder 文件夹"的现代 UX 完全不沾
   - 拖入一个非 llm-wiki 目录（比如 `~/Documents/AI学习资料`），app 直接报错而不是问"要不要初始化成 wiki 并消化里面的文档"

2. **批量消化效率低**：
   - 阶段二的消化是"一次喂一篇"——拖一个目录里有 50 个 `.md` 要消化，用户得手动一个一个发到对话框
   - 阶段一以来一直挂着 TBD-2"多模型路由"——消化用便宜模型 / 聊天用强模型——但当时没有承载场景；阶段 3.5 的批量消化正好是承载场景

**目标**：

1. **导航统一**：侧栏只有"一栏到底"的 KB 列表，每个 KB 可展开成对话子树；增删 KB 用拖拽优先（HTML5 drag），输入框作 fallback；遇到非 wiki 目录提供"一键初始化 + 批量消化"路径
2. **子代理批量消化**：基于 pi SDK 的 `createAgentSession` + 多模型注册，落地"消化角色 → cheap 模型 / 聊天角色 → main 模型"双角色路由；用一个轻量的并发控制函数（30 行级别）调度 N 个子代理并行处理 N 个文件，通过 SSE 推送进度

**核心设计原则**（贯穿阶段 3.5 所有决策）：

> **拖拽优先、文本兜底**：浏览器没有"原生文件夹选择器返回绝对路径"的稳定标准能力（出于沙箱限制）。阶段 3.5 先实测 macOS Finder 在当前浏览器的 `DataTransfer` 中是否携带 `file://` URL；若携带则自动填入路径，若不携带则用拖拽区给出明确诊断并让用户粘贴路径。这里的核心原则不是"一定自动填"，而是"能自动就自动，不能自动也要给用户一条可靠路径"。

> **子代理框架轻量化**：omp 项目的 1600 行 `executor.ts` 是为通用子代理框架设计的（支持工作树隔离、嵌套子代理、worker 通讯协议）；我们只需要"创建独立 session + 限制并发数 + 拿结果"的 30 行版本（详见 §4 step 5）。

**7 step 概览**：

| # | Step | 后端 | 前端 | 重难度 |
|---|---|:---:|:---:|---|
| 1 | 侧栏重构：统一 KB 列表 + 折叠对话子树（去 default/external 分隔）| — | ✅ | 🟢 |
| 2 | 拖拽 + 输入框 KB 添加：HTML5 drag 探测路径，输入框兜底 | ✅ | ✅ | 🟡 |
| 3 | 非 wiki 目录检测 + 初始化引导（含批量消化预扫描） | ✅ | ✅ | 🟡 |
| 4 | 多模型配置：config.json 新增双角色（main/digest） + 设置面板选择 | ✅ | ✅ | 🟢 |
| 5 | 后端子代理批量消化框架（concurrency-limit + inMemory session） | ✅ | — | 🔴 含 TBD-3.5-1 |
| 6 | 批量消化 UI + SSE 进度推送 | ✅ | ✅ | 🟡 |
| 7 | 总验收 + UX 体感打磨 | — | ✅ | 🟢 |

**总验收 5 条**（作者拍板）：

1. **侧栏统一**：KB 列表"一栏到底"无 default/external 分隔；点当前 KB 名可展开/收起对话子树，点未选中 KB 会切换并展开；外部 KB 用文字 badge 而非分区
2. **拖拽添加**：从 Finder 拖一个文件夹到 "+ 添加现有库" dialog 的拖拽区；若浏览器暴露真实 `file://`，路径自动填入输入框；若不暴露，UI 明确提示用户粘贴路径（不立即提交，给用户最后修改机会）
3. **非 wiki 兜底**：拖入一个没有 `.wiki-schema.md` 的目录，弹"该目录看起来不是 wiki，是否初始化并批量消化里面的文档"对话框；选"是"→ 后台跑 init-wiki.sh + 子代理并行消化
4. **多模型双角色**：设置面板新增"模型分配"区，可选 main / digest 两个角色各自的 provider+model；digest 写入 `config.json` 后对新批量消化立即生效（不需要重启），main 本阶段只保存与展示，不接管主对话
5. **并发消化**：批量消化 10 个 `.md` 文件能看到 ≥3 个子代理同时跑（默认并发=3），SSE 实时推送每个子代理的"进行中 / 完成 / 失败"状态，全部完成后右抽屉刷新出新增的 wiki 页面

---

## §2 关键技术决策

| ID | 决策 | 选定 | 拒绝项 & 拒绝原因 |
|---|---|---|---|
| F1 | 侧栏 KB 显示 | **统一列表 + 文字 badge 标外部**（KB 名右侧灰字 `(外部)`，悬停看路径） | default/external 分两区：与"KB = 项目"心智冲突，多一个无意义维度 |
| F2 | 对话层级 | **KB 展开/折叠对话子树**（点 KB 名展开 / 点 chevron 折叠，类似 VS Code 文件树）| 对话单独一栏：3 栏布局空间紧；对话挂在中间：看不出从属 |
| F3 | 文件路径输入方式 | **拖拽 + 输入框双通道**（拖 Finder 文件夹若能拿到绝对路径则自动填入；拿不到时显示诊断并让用户粘贴路径） | 仅拖拽：浏览器不保证暴露本地绝对路径；仅输入：违反"拖拽优先" |
| F4 | 拖拽 API 路线 | **先探针实测，再启用自动填路径**：实现一个本机 drag probe 记录 `dataTransfer.types/getData("text/uri-list")/getData("text/plain")/files/items`；若 macOS Finder 在当前浏览器确实提供 `file://`，才自动填路径；否则 dropzone 只做目录名/文件列表提示，输入框兜底 | Tauri/Electron 文件对话框：本阶段还是 web 形态，阶段五打包再说；把 `webkitGetAsEntry().fullPath` 当本机绝对路径：Entries API 的 path 是拖拽数据虚拟根路径，不等于 native path |
| F5 | 非 wiki 目录处理 | **预扫描 + 弹窗引导**：拖入后 server 先扫该目录看有没有 `.wiki-schema.md`，没有则前端弹"是否初始化为 wiki" | 直接拒绝：违反"拖拽优先 UX"；直接强转：用户可能误拖 |
| F6 | 子代理实现方式 | **复用 pi SDK 的 `createAgentSession` + `SessionManager.inMemory()`**（每个子代理一个独立 session，不持久化，共享主进程的 `authStorage` / `modelRegistry`） | 抄 omp 1600 行 `executor.ts`：过度工程，我们不需要工作树隔离 / 嵌套子代理；用主 session 顺序处理：丢掉并行收益 |
| F7 | 子代理并发控制 | **自写 30 行 `mapWithConcurrencyLimit`**（参考 omp/parallel.ts 简化），入口只接受并发数 `1/3/5`，内部再 `clamp >= 1` 防御 | 引入 p-limit / async-pool：增加依赖；用 `Promise.all` 一把开：N 个文件 = N 个并发请求，模型 provider 会 429 |
| F8 | 多模型角色配置 | **`config.json` 新增 `modelRoles: { main, digest }` 字段**，每个角色 `{provider, modelId}`；缺省时回退到 pi `settings.json` 的 `defaultProvider/defaultModel` | 写入 pi `settings.json`：跨工具污染；写入环境变量：本地工具不该读环境变量做行为决策 |
| F9 | 进度推送 | **沿用 SSE 协议**：批量接口 `POST /api/knowledge-bases/batch-digest` 直接返回 `text/event-stream`，事件类型见 `BatchDigestEvent` | 单独开 `/api/batch-digest/events` WebSocket：与 ADR-3"用 SSE"冲突；轮询：每个子代理一秒多个事件，轮询噪音大 |
| F10 | 批量消化触发 UI | **复用现有的 ingestChipVisible 入口**：检测到拖入的是目录而非单文件时，chip 文案改为 "🔍 扫到 N 个文件，批量消化？"，点击后弹"选模型 + 并发数"二次确认 | 新建"批量消化"按钮：discoverability 差且与拖拽流程脱节 |
| F11 | 失败处理 | **每个子代理独立 try/catch**：单个文件失败不影响其他文件；全部完成后汇总"成功 N / 失败 M"，失败的列具体原因（模型 429 / 文件读不到 / Skill 抛错） | 全或无：用户体感差；只记日志不上报：违反"求真不猜"原则，用户得看到失败列表才能决定是否重试 |
| F12 | 子代理 Skill 加载 | **阶段 3.5 的本地文件批量消化是 ADR-16 的明确例外**：子代理不加载 llm-wiki Skill 的复杂分支，直接用最小 prompt 让 cheap 模型按既定 schema 输出 wiki 页面 markdown，主进程负责写文件 | 让子代理跑完整 llm-wiki Skill：cheap 模型可能跟不上 Skill 的多步指令 + 工具调用复杂度；让子代理调 Skill：增加跨 session 状态传递复杂度 |
| F13 | 子代理工具集 | **只开 `read`**（读取被消化的文件原文），写盘由主进程做 | 开 `write`：cheap 模型可能写错路径，主进程已知正确路径无需 cheap 模型决策 |

---

## §3 新增依赖

### 前端
**零新依赖**。HTML5 拖拽用浏览器原生 API，拖拽视觉反馈用现有的 Tailwind 类。

### 后端
**零新依赖**。`mapWithConcurrencyLimit` 自写（30 行），`createAgentSession` / `SessionManager.inMemory()` / `ModelRegistry.find` 都是 pi SDK 已暴露的接口。

### 与 PRODUCT.md §3.2 的关系
阶段 3.5 继续保持**零新依赖**记录（阶段三也是零依赖）。验收通过后 PRODUCT.md §3.2 无需新增行，ADR-18 写"阶段 3.5 零新依赖"作为存档。

如果实施中发现**实在需要**新依赖（如想抄 p-limit 代替自写），按 CLAUDE.md 规则**先停下报备**，不要先 npm install。

---

## §4 七个 Step 详细设计

### Step 1：侧栏重构（统一 KB 列表 + 折叠对话子树）

**目标**：把 `web/src/components/Sidebar.tsx` 现有的"defaultKbs / externalKbs 双 section + 对话独立 section"改成"单一 KB 列表 + 每个 KB 可展开/折叠出对话子树"。

**前端文件**：

- `web/src/components/Sidebar.tsx`（重写主要渲染逻辑，~260 行 → ~280 行）
- `web/src/lib/types.ts`（如果有就不动；本 step 不改后端，`KnowledgeBaseInfo` 字段不变）

**新 UI 结构**：

```
┌─ aside ──────────────────────┐
│ llm-wiki-agent          ↻    │ ← header（不动）
├──────────────────────────────┤
│ 📚 知识库                     │ ← section title（删 hint "~/llm-wiki/"，统一）
│  ▾ stage2-research            │ ← 当前 active KB，自动展开
│      ▸ 第一次对话      11:30 │
│      ▸ 第二次对话      昨天  │
│      + 新对话                │
│  ▸ AI学习知识库  (外部)       │ ← 非 active KB 默认折叠，外部库右侧 badge
│  ▸ stage1-test                │
│  ▸ (失效) old-kb              │ ← invalid KB 灰显，hover 显示 reason
├──────────────────────────────┤
│  + 新建知识库                 │
│  + 添加现有库                 │
└──────────────────────────────┘
```

**交互规则**：

- 点当前 KB 名 = 展开/收起该 KB 的对话子树；点未选中 KB 名 = 选中并切换为 active，同时展开该 KB 的对话子树
- 点 chevron (`▸` / `▾`) = 仅展开/折叠（不切换 active）
- 当前 KB 允许收起但保持选中高亮；切换 active 时旧 active 自动折叠，新 active 自动展开
- 外部 KB 右侧加灰色 `(外部)` 文字（不再分独立 section）
- 失效 KB 用现有的 disabled + tooltip 模式
- "+ 新对话" 按钮挪到对话子树末尾（删除原来的 Section title 右侧"+ 新对话"）

**实现要点**：

- 用 `useState<Set<string>>` 维护展开的 KB path 集合，当前 KB 可从集合中移除以收起对话子树
- `KbItem` 拆成 `KbRow`（KB 名 + chevron + badge）+ `ConversationSubtree`（仅当展开时渲染对话列表 + 新对话按钮）
- 保留现有的 `Tooltip`（外部库的完整路径 / 失效原因都用 tooltip 展示，避免侧栏拥挤）

**验收命令**：

```bash
# 1. 启动 dev
npm run dev

# 2. 打开 http://localhost:5180
#    - 侧栏看不到"默认"/"外部"两个 section
#    - 当前选中库点 KB 名可展开 / 收起对话子树
#    - 点未选中库 → 切换 active + 展开子树 + 旧 active 折叠
#    - 外部库右侧有 (外部) 灰字
```

---

### Step 2：拖拽 + 输入框路径填充

**目标**：把 `AddExternalDialog.tsx` 改造成"拖拽区 + 输入框"的双通道；拖 Finder 文件夹时先探测能否拿到真实路径，能拿到就自动填，拿不到就明确提示用户粘贴路径。

**前端文件**：

- `web/src/components/AddExternalDialog.tsx`（改造主体）

**后端文件**：

- `server/src/index.ts`（新增 `POST /api/knowledge-bases/inspect` 端点：传一个路径，返回 `{exists, isDirectory, hasWikiSchema, fileCount?}`，给 Step 3 用）

**新 UI 结构**：

```
┌─ Dialog: 添加现有库 ─────────────────────┐
│  把 Finder 里的文件夹拖到下面            │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │   📁 拖拽文件夹到这里             │   │ ← dropzone，hover/drag-over 高亮
│  │   或在下方输入框粘贴路径          │   │
│  └──────────────────────────────────┘   │
│                                          │
│  ~/AI学习                                │ ← Input，被拖拽自动填、也可手编辑
│                                          │
│  ⚠ 路径不存在 / 该目录不是 wiki ...      │ ← 实时 inspect 反馈
│                                          │
│  [取消]                       [添加]    │
└──────────────────────────────────────────┘
```

**实现要点**：

- dropzone 用 `<div onDragOver onDrop>`；`e.preventDefault()` 阻止浏览器默认行为
- 浏览器标准的 `File` / `FileSystemEntry` **不保证**提供本机绝对路径；`webkitGetAsEntry().fullPath` 是拖拽数据虚拟根路径，不能当真实用户主目录路径
- Step 2 起手先加一个 dev-only 诊断输出：drop 时 `console.info` 打印 `types`、`getData("text/uri-list")`、`getData("text/plain")`、`files[].name/type/size`、`items[].kind/type`，并用一次 macOS Finder 实测结果决定是否启用自动填路径
- 若实测 `text/uri-list` 或 `text/plain` 含 `file://<user-home>/...`：`text/uri-list` 优先，回退 `text/plain`，正则提取 `file://` 前缀后 decodeURIComponent → 填入输入框
- 若实测拿不到 `file://`：dropzone 显示"浏览器没有暴露完整路径，请在下方粘贴路径"，并把检测到的文件夹名作为辅助提示；**不得**伪造绝对路径或把虚拟 `fullPath` 发给后端
- 输入框 onChange 后 debounce 300ms 调 `POST /api/knowledge-bases/inspect`，根据返回值决定后续：
  - 路径不存在 → 报错
  - 是目录但有 `.wiki-schema.md` → 走现有"添加现有库"流程（沿用阶段一的 `POST /api/knowledge-bases/external`）
  - 是目录但没 `.wiki-schema.md` → 标记 `needsInit=true` 并预扫文件数，提交时进入 Step 3 的初始化分支

**API 契约**：

```typescript
// POST /api/knowledge-bases/inspect
// 请求：{ path: string }
// 响应（200）：{
//   exists: boolean,
//   isDirectory: boolean,
//   hasWikiSchema: boolean,    // 看路径下有 .wiki-schema.md 否
//   resolvedPath?: string,      // 后端 realpath/resolve 后的绝对路径；不存在时可省略
//   ingestibleFiles?: {        // 仅 isDirectory=true 时返回
//     count: number,           // 可消化的文件数（递归扫 .md/.txt/.pdf 上限 500）
//     samples: string[],       // 前 5 个文件名（给用户预览）
//     truncated: boolean       // 是否超过上限
//   }
// }
// 错误：
//   400 path 为空或不是字符串
//   403 权限不足
//   500 inspect 过程发生未知错误
```

**实现要点**：

- 后端递归扫描时**限定深度 ≤ 5**、**文件数上限 500**，防止用户拖入 `/` 直接卡死
- 跳过 `node_modules` / `.git` / `.obsidian` / `.DS_Store` 等噪音
- 只统计 `.md` / `.txt` / `.pdf`（与阶段二的消化能力对齐）
- 后端接受 `~` 开头路径并展开到用户 home；macOS 上 Finder 拖一个 alias / symlink 时 `realpath` 解析后再 inspect
- 重复添加已登记 KB 时保持幂等：返回 ok，不重复写 config

**验收命令**：

```bash
# 1. 启动 dev
npm run dev

# 2. 点"+ 添加现有库"
# 3. 从 Finder 拖一个已有 wiki 库到 dropzone
#    → 若本机浏览器暴露 file://，输入框自动填 ~/xxx 或真实绝对路径
#    → 若没有暴露 file://，UI 明确提示需要手动粘贴路径，手动粘贴后继续验收
#    → "添加"按钮可用
#    → 添加成功，侧栏出现新库
# 4. 拖一个普通目录（无 .wiki-schema.md）
#    → inspect 返回 hasWikiSchema=false 与 ingestibleFiles
#    → UI 显示"该目录看起来不是 wiki（含 N 个可消化文件），是否初始化？"
#    → 此时不进入 add-external，跳到 Step 3 的初始化流程（"添加"按钮文案改成"初始化为 wiki"）
```

---

### Step 3：非 wiki 目录初始化引导

**目标**：用户拖入非 wiki 目录时，提供"初始化为 wiki 并批量消化"的一键路径。

**前端文件**：

- `web/src/components/AddExternalDialog.tsx`（继续 Step 2 的逻辑：当 `needsInit=true` 时切换按钮文案 + 二次确认弹窗）
- `web/src/components/InitExistingDirDialog.tsx`（新增；点"初始化为 wiki"后弹出的二次确认）

**后端文件**：

- `server/src/extensions/new-wiki.ts` 或 `server/src/wiki-init.ts`（沿用阶段二的 `init-wiki.sh` spawn 逻辑，新增一个 `initWikiInPlace(path, purpose)` 函数支持就地初始化，而不是在 `~/llm-wiki/` 下新建）
- `server/src/index.ts`（新增 `POST /api/knowledge-bases/init-existing`，请求体 `{path, purpose, overwrite?: boolean}`；服务端优先复用 `init-wiki.sh <path> <purpose> 中文` 或等价 TypeScript 骨架）

**关键问题**：当前已安装的 `init-wiki.sh` 签名实际是 `init-wiki.sh <知识库路径> <主题> <语言>`，第一个参数可以是已有目录路径；它会 `mkdir -p` 目录结构，并写入 `.gitignore`、`.wiki-schema.md`、`index.md`、`log.md`、`wiki/overview.md`、`purpose.md`、`.wiki-cache.json`。这说明"就地初始化"可行，但**不能静默覆盖已有同名文件**。

**实施路径**（Step 3 的 codex 实现起手第一件事是先确认）：

- 看 llm-wiki-skill 仓库或 `~/.claude/skills/llm-wiki-skill/scripts/init-wiki.sh` 的现有实现，确认参数与会写入的文件列表
- 调用前先扫描目标目录中将被写入的文件：`.gitignore`、`.wiki-schema.md`、`index.md`、`log.md`、`wiki/overview.md`、`purpose.md`、`.wiki-cache.json`
- 如果这些文件已存在且请求没有 `overwrite: true` → 返回 `409`，响应包含 `conflicts: string[]`，前端弹二次确认，明确告诉用户会覆盖哪些文件
- 若用户确认覆盖，后端先把冲突文件备份到 `.llm-wiki-agent-backup/<timestamp>/`，再调用脚本；若备份失败，初始化直接失败
- 如果脚本缺失或行为不匹配 → 后端用 TypeScript 模仿 `init-wiki.sh` 的最小骨架，仍然遵守同样的冲突检测与备份规则

**新 UI 结构**（InitExistingDirDialog）：

```
┌─ Dialog: 初始化为 wiki ──────────────────┐
│  目录：~/AI学习                          │
│  扫到 N 个可消化文件（.md / .txt / .pdf）│
│                                          │
│  研究方向（必填，将写入 .wiki-schema.md）│
│  [____________________________________]  │
│                                          │
│  ☑ 初始化后立即批量消化全部文件          │ ← 默认勾选
│                                          │
│  消化角色模型：zai/glm-4.5-air ▾         │ ← 下拉选当前可用模型
│  并发数：3 ▾                              │ ← 1/3/5
│                                          │
│  [取消]                  [初始化并消化]  │
└──────────────────────────────────────────┘
```

**API 契约**：

```typescript
// POST /api/knowledge-bases/init-existing
// 请求：{ path: string, purpose: string, overwrite?: boolean }
// 响应（200）：{ kbPath: string, backedUpFiles?: string[] }  // 初始化后 KB 的绝对路径（即传入的 path）
// 行为：1. 在 path 下写 .wiki-schema.md（含 purpose 字段）
//      2. 在 path 下写 index.md（最小骨架，含"这个库的研究方向: <purpose>"）
//      3. 把 path 写入 config.json 的 externalKnowledgeBases[]
// 错误：
//   400 path/purpose 为空或 path 不是目录
//   403 权限不足
//   409 目标文件已存在且 overwrite 未确认，响应 { conflicts: string[] }
//   500 初始化脚本执行失败
```

**注意**：初始化本身**不消化**——批量消化是独立动作（Step 5/6），InitExistingDirDialog 的"☑ 初始化后立即批量消化"是 UI 便利，**实际调用顺序是 init → 前端拿到 kbPath → 前端再调 `/api/knowledge-bases/batch-digest` 触发批量消化 SSE**。

**验收命令**：

```bash
# 1. 准备测试目录
mkdir -p /tmp/test-not-wiki && cd /tmp/test-not-wiki
for i in 1 2 3; do echo "# 文件 $i" > "doc-$i.md"; done

# 2. 启动 dev，点"+ 添加现有库"，拖入 /tmp/test-not-wiki
#    → dialog 切到"初始化为 wiki"模式
#    → 显示"扫到 3 个可消化文件"
#    → 填研究方向 "测试初始化"
#    → 点"初始化并消化"

# 3. 验证
ls /tmp/test-not-wiki/.wiki-schema.md  # 存在
cat /tmp/test-not-wiki/.wiki-schema.md  # 含 purpose: 测试初始化
ls /tmp/test-not-wiki/index.md          # 存在

# 4. 侧栏出现 "test-not-wiki (外部)"，自动 active
# 5. 看到批量消化 chip 已激活（接 Step 6）
```

---

### Step 4：多模型双角色配置

**目标**：在 `~/.llm-wiki-agent/config.json` 新增 `modelRoles: { main, digest }` 字段，UI 给两个 dropdown 选 provider+model。digest 写回后对新批量消化立即生效；main 写回后只保存与展示，本阶段不接管主对话。

**后端文件**：

- `server/src/config.ts`（扩展 schema：新增 `modelRoles?: { main?: ModelRef, digest?: ModelRef }`，`ModelRef = {provider: string, modelId: string}`）
- `server/src/agent.ts`（新增导出 `getRoleModel(role: "main" | "digest")` 函数：先读 config.modelRoles.<role>，回退到 pi `ModelRegistry` 的可用列表中的默认；该函数被 Step 5 的子代理框架调用）
- `server/src/index.ts`（新增 `GET /api/models` 返回 `[{provider, modelId, hasAuth, cost?, contextWindow}]`；扩展现有 `POST /api/config` 接受新字段）

**前端文件**：

- `web/src/components/SettingsPanel.tsx`（或现有 settings 入口）新增"模型分配"区
- `web/src/lib/api.ts`（新增 `fetchAvailableModels()` 调 `/api/models`）

**新 UI 结构**（设置面板"模型分配"区）：

```
模型分配（双角色）

  聊天角色（main）         ← 用于主对话、产出工作流
  zai / glm-5.1 (默认) ▾

  消化角色（digest）        ← 用于批量消化子代理
  zai / glm-4.5-air ▾

  ℹ️ 留空 = 沿用 pi 默认（~/.pi/agent/settings.json）
```

**dropdown 内容**：从 `/api/models` 拿配置过 auth 的模型列表（即 `ModelRegistry.getAvailable()` 等价物），按 `provider/modelId` 显示，hover tooltip 显示成本与上下文窗口。

**API 契约**：

```typescript
// GET /api/models
// 响应（200）：{
//   models: Array<{
//     provider: string,
//     modelId: string,
//     name: string,            // 显示名
//     reasoning: boolean,
//     contextWindow: number,
//     cost: { input: number, output: number },  // per million tokens
//     hasAuth: boolean
//   }>,
//   currentRoles: { main?: ModelRef, digest?: ModelRef },
//   piDefault: { provider?: string, modelId?: string }  // 从 pi settings.json 读
// }

// POST /api/config（扩展）
// 请求新增字段：modelRoles?: { main?: ModelRef | null, digest?: ModelRef | null }
// 行为：null 表示清空该角色，回退 pi 默认
```

**`config.json` 示例**：

```json
{
  "lastUsedKbPath": "~/stage2-research",
  "externalKnowledgeBases": [...],
  "modelRoles": {
    "main": { "provider": "zai", "modelId": "glm-5.1" },
    "digest": { "provider": "zai", "modelId": "glm-4.5-air" }
  },
  "showUserGlobalSkills": false
}
```

**`getRoleModel(role)` 实现要点**：

```typescript
// server/src/agent.ts
import { getModel } from "@earendil-works/pi-ai";

export async function getRoleModel(role: "main" | "digest"): Promise<Model | undefined> {
  const config = await loadConfig();
  const ref = config.modelRoles?.[role];
  if (ref) {
    const model = modelRegistry.find(ref.provider, ref.modelId);
    if (model && modelRegistry.hasConfiguredAuth(model)) return model;
    console.warn(`[agent] role=${role} model ${ref.provider}/${ref.modelId} 不可用，回退`);
  }
  // 回退 pi 默认
  return undefined;  // 让 createAgentSession 自己用 pi 默认逻辑
}
```

**注意**：主对话（即现有 `selectKb` / `selectConversation` 创建的 session）**当前不强制使用 main 角色**——保持现状由 pi 默认决策；只有子代理消化路径**强制使用 digest 角色**。设置面板可以展示 main，但文案必须明确："聊天角色暂随 pi 默认，阶段 3.5 不接管主对话"。这是为了：

- 避免改动主对话路径降低稳定性
- 让用户的现有 pi `defaultModel` 设置仍然生效
- digest 角色是新功能，强制走子代理才能保证"消化用便宜模型"的承诺

如果阶段 3.5 后用户反馈"配了 main 但主对话没生效"，再进入 TBD-3.5-3，把现有 session 创建路径改为读取 main。

**验收命令**：

```bash
# 1. 启动 dev，打开设置面板"模型分配"区
# 2. main 选 zai/glm-5.1, digest 选 zai/glm-4.5-air
# 3. 点保存
cat ~/.llm-wiki-agent/config.json | jq .modelRoles
# {"main": {"provider":"zai","modelId":"glm-5.1"}, "digest": ...}

# 4. 再打开设置面板：dropdown 显示的就是刚才的选择
```

---

### Step 5：后端子代理批量消化框架 🔴

**目标**：实现"一组文件 → 一组子代理并行消化 → 主进程汇总写文件"的核心后端逻辑。

**后端文件**（新增）：

- `server/src/digest/concurrency.ts`（30 行级别，`mapWithConcurrencyLimit` 工具函数）
- `server/src/digest/subagent.ts`（单个文件 → 单个子代理 session 的逻辑）
- `server/src/digest/batch.ts`（编排：多文件 → 多子代理 + SSE 进度推送 + 主进程写文件）

**后端文件**（修改）：

- `server/src/index.ts`（新增 `POST /api/knowledge-bases/batch-digest`，接受 `{kbPath: string, filePaths: string[], concurrency?: 1 | 3 | 5}`，返回 SSE 流；KB path 放 body，避免中文、空格、斜杠在 URL path 里二次编码）

#### `concurrency.ts`（自写并发控制）

```typescript
// 简化版的 omp/parallel.ts，去掉 Semaphore / signal / per-task error handling
// 返回值统一 { ok, value?, error? }，让调用方决定怎么聚合

export interface Outcome<R> {
  ok: boolean;
  value?: R;
  error?: string;
}

export async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Outcome<R>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer");
  }
  const results: Outcome<R>[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
```

#### `subagent.ts`（单文件单子代理）

```typescript
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { authStorage, modelRegistry, getRoleModel } from "../agent.js";

export interface DigestSubagentResult {
  filePath: string;
  wikiMarkdown: string;       // 子代理输出的 wiki 页面 markdown
  tokenUsage?: { input: number; output: number };
  durationMs: number;
}

export async function digestFileViaSubagent(
  filePath: string,
  kbPurpose: string,             // 从 .wiki-schema.md 读
  onProgress?: (msg: string) => void,
): Promise<DigestSubagentResult> {
  const startMs = Date.now();
  const model = await getRoleModel("digest");

  const { session } = await createAgentSession({
    model,                       // undefined 时 SDK 用 pi 默认
    thinkingLevel: "off",        // 消化任务不需要 thinking
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),  // 不持久化
    tools: ["read"],             // 只读
    // 不传 resourceLoader → 用 SDK 默认（不挂 KB extension / synthesis / etc.）
  });

  // 拼一个最小 prompt：让 cheap 模型按固定 schema 输出 wiki markdown
  const prompt = buildDigestPrompt(filePath, kbPurpose);

  let captured = "";
  const unsub = session.subscribe((evt) => {
    if (evt.type === "message_update" && evt.assistantMessageEvent.type === "text_delta") {
      captured += evt.assistantMessageEvent.delta;
      onProgress?.(`已生成 ${captured.length} 字符`);
    }
  });

  try {
    await session.prompt(prompt);
  } finally {
    unsub();
    session.dispose();
  }

  return {
    filePath,
    wikiMarkdown: captured,
    durationMs: Date.now() - startMs,
  };
}

function buildDigestPrompt(filePath: string, kbPurpose: string): string {
  return `你是一个 wiki 消化助手。请：
1. 用 read 工具读取文件 ${filePath} 的全部内容
2. 把内容提炼成符合 llm-wiki 风格的 wiki 页面 markdown
3. 输出格式：
   - 第一行是 H1 标题（提炼自原文核心）
   - 然后是 frontmatter（YAML，含 source/digestedAt）
   - 然后是 ## 概述 / ## 关键点 / ## 引用片段 三个 section
   - 末尾留空，不要解释、不要寒暄

本库的研究方向是：${kbPurpose}
请确保消化内容与该方向有意义的关联（无关内容也要保留事实，但摘要部分点出"与本库主线的关系"）。

只输出 markdown 内容本身，不要 \`\`\`markdown 包裹。`;
}
```

**关键设计点（解释给 codex）**：

- `SessionManager.inMemory()`：消化是一次性任务，不需要持久化对话历史
- `authStorage` / `modelRegistry`：从 `server/src/agent.ts` 顶层导出，子代理共享
- 不传 `resourceLoader`：让 SDK 用默认逻辑（不挂任何 KB / synthesis extension）→ 子代理 prompt 是"裸"的
- `tools: ["read"]`：子代理只能读文件，不能写盘 → 主进程负责写
- `thinkingLevel: "off"`：消化是结构化任务，不需要思考

#### `batch.ts`（编排）

```typescript
import path from "node:path";
import { writeFile, mkdir, readFile } from "node:fs/promises";

import { mapWithConcurrencyLimit, Outcome } from "./concurrency.js";
import { digestFileViaSubagent, DigestSubagentResult } from "./subagent.js";

export interface BatchDigestParams {
  kbPath: string;
  filePaths: string[];
  concurrency: 1 | 3 | 5;       // 默认 3；API 层拒绝其他值
  onEvent: (event: BatchDigestEvent) => void;  // SSE 推送给前端
}

export type BatchDigestEvent =
  | { type: "start"; total: number }
  | { type: "file_start"; index: number; filePath: string }
  | { type: "file_progress"; index: number; message: string }
  | { type: "file_complete"; index: number; filePath: string; wikiPath: string }
  | { type: "file_error"; index: number; filePath: string; error: string }
  | { type: "done"; succeeded: number; failed: number };

export async function runBatchDigest(params: BatchDigestParams): Promise<void> {
  const { kbPath, filePaths, concurrency, onEvent } = params;
  const kbPurpose = await readKbPurpose(kbPath);
  const sessionsDir = path.join(kbPath, "wiki", "synthesis", "sessions");
  await mkdir(sessionsDir, { recursive: true });

  onEvent({ type: "start", total: filePaths.length });

  const outcomes: Outcome<DigestSubagentResult>[] = await mapWithConcurrencyLimit(
    filePaths,
    concurrency,
    async (filePath, i) => {
      onEvent({ type: "file_start", index: i, filePath });
      const result = await digestFileViaSubagent(filePath, kbPurpose, (msg) =>
        onEvent({ type: "file_progress", index: i, message: msg }),
      );
      // 主进程写文件
      const slug = path.basename(filePath).replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-]/gi, "-");
      const wikiPath = path.join(sessionsDir, `${slug}-${Date.now()}.md`);
      await writeFile(wikiPath, result.wikiMarkdown, "utf8");
      onEvent({ type: "file_complete", index: i, filePath, wikiPath });
      return result;
    },
  );

  const succeeded = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - succeeded;
  outcomes.forEach((o, i) => {
    if (!o.ok) onEvent({ type: "file_error", index: i, filePath: filePaths[i], error: o.error! });
  });
  onEvent({ type: "done", succeeded, failed });
}

async function readKbPurpose(kbPath: string): Promise<string> {
  try {
    const schema = await readFile(path.join(kbPath, ".wiki-schema.md"), "utf8");
    const m = schema.match(/^purpose:\s*(.+)$/m);
    return m?.[1]?.trim() ?? "（未设置研究方向）";
  } catch {
    return "（未设置研究方向）";
  }
}
```

**TBD-3.5-1（关键风险，见 §8）**：

子代理 session 的 `authStorage` / `modelRegistry` 复用主进程实例 — 需要验证 pi SDK **不会**在 session dispose 时回收这些共享资源（按 SDK 文档应该不会，但需要实测）。

**API 契约**：

```typescript
// POST /api/knowledge-bases/batch-digest
// 请求：{ kbPath: string, filePaths: string[], concurrency?: 1 | 3 | 5 }
// 响应：Content-Type: text/event-stream
// 事件：BatchDigestEvent，每条 SSE event 名与 type 相同，data 为该事件 JSON
// 错误：
//   400 kbPath/filePaths 缺失、filePaths 为空、concurrency 不在 1/3/5、文件不在允许范围
//   403 权限不足
//   404 kbPath 或某个文件不存在
//   500 批量任务启动失败；单文件失败走 file_error，不中断整批
```

**文件路径安全规则**：

- `filePaths` 必须是绝对路径；`~` 不在此接口展开，前端应传 inspect 后的 `resolvedPath`
- 每个文件必须存在，扩展名只允许 `.md` / `.txt` / `.pdf`
- 文件必须位于 `kbPath` 下，或位于刚刚通过 inspect 扫描并由前端确认的外部目录下；不允许任意读用户磁盘上的无关路径
- 后端在任务开始前先做一次全量校验；不存在/越界/扩展名不允许的文件直接产生对应 `file_error`，不创建子代理

**验收命令**：

```bash
# 1. 单元测试 concurrency.ts
node --import tsx --test server/src/digest/concurrency.test.ts
# 测试用例：10 个 task，concurrency=3，验证最多 3 个并发
# 额外用例：items=[]、items.length < concurrency、concurrency=0/负数/NaN

# 2. 集成测试 subagent.ts（手工，开启 dev 后）
# 准备 3 个 .md 文件，调用 /api/knowledge-bases/.../batch-digest
# 用 curl 看 SSE 流：
curl -N -X POST http://localhost:8787/api/knowledge-bases/batch-digest \
  -H 'Content-Type: application/json' \
  -d '{"kbPath": "/tmp/test-not-wiki", "filePaths": ["/tmp/test-not-wiki/doc-1.md", "/tmp/test-not-wiki/doc-2.md", "/tmp/test-not-wiki/doc-3.md"], "concurrency": 3}'

# 期望 SSE 输出：
# event: start
# data: {"total":3}
# event: file_start  data: {"index":0,...}
# event: file_start  data: {"index":1,...}
# event: file_start  data: {"index":2,...}  ← 验证并发数=3 时最多同时启动 3 个
# event: file_complete  data: {"index":0,...}
# event: done  data: {"succeeded":3,"failed":0}

# 3. 检查输出文件
ls <kb-path>/wiki/synthesis/sessions/*-*.md
```

---

### Step 6：批量消化 UI + SSE 进度推送

**目标**：把 Step 5 的后端能力接入前端 UI。

**前端文件**：

- `web/src/components/ChatPanel.tsx`（修改 ingestChipVisible 逻辑：拖入目录时改文案）
- `web/src/components/BatchDigestPanel.tsx`（新增，进度面板）
- `web/src/lib/api.ts`（新增 `streamBatchDigest()` 用 EventSource 或 fetch 流读 SSE）

**新 UI 流程**：

```
[拖入目录到 ChatPanel] → ChatPanel 检测是目录 →
  → 调 /api/knowledge-bases/inspect → ingestible=N →
  → chip 文案: "🔍 扫到 N 个文件，批量消化？"
  → 点击 → 弹"选模型 + 并发数"二次确认（复用 Step 3 的 InitExistingDirDialog 的"模型 + 并发"区作 component） →
  → 确认后调 /api/knowledge-bases/batch-digest → BatchDigestPanel 浮窗显示

┌─ BatchDigestPanel (右下角浮窗或 Toast 集合) ─┐
│ 批量消化进行中 (3/10)                        │
│                                              │
│  ✅ doc-1.md          → ✨ doc-1-...md       │
│  ✅ doc-2.md          → ✨ doc-2-...md       │
│  ✅ doc-3.md          → ✨ doc-3-...md       │
│  ⏳ doc-4.md          ... 已生成 234 字符    │
│  ⏳ doc-5.md          ... 读取中             │
│  ⏳ doc-6.md          ... 启动               │
│  ⌛ doc-7.md          ... 排队               │
│  ⌛ doc-8.md          ... 排队               │
│                                              │
│  [取消]   完成后自动关闭                     │
└──────────────────────────────────────────────┘
```

**实现要点**：

- `BatchDigestPanel` 是全局浮窗（位置：右下角，z-index 高于普通 toast）；用户切对话不影响显示
- 单条目状态：⌛ 排队 → ⏳ 进行中 → ✅ 成功 / ❌ 失败
- 完成后浮窗保留 5 秒后自动关闭（带"展示新页面"按钮跳右抽屉看产物）
- "取消"按钮：发 `AbortController.abort()` 到 fetch，后端检测 abort signal 后停止派发新的 task（已在跑的 subagent 不强制 kill，让它跑完——避免半成品文件）

**API 行为细节**：

- `POST /api/knowledge-bases/batch-digest` 返回 `Content-Type: text/event-stream`，SSE 事件顺序与 `BatchDigestEvent` 定义一致；`kbPath` 放 JSON body
- 前端用 `fetch` + `ReadableStream`（而不是 `EventSource`）以便支持 POST + abort
- 前端只提供并发数 `1/3/5` 三档；后端也必须校验，其他值返回 400

**验收命令**：

```bash
# 1. 启动 dev
# 2. 准备一个有 5 个 .md 文件的目录
# 3. 拖目录到对话框 → chip 显示 "扫到 5 个文件，批量消化？"
# 4. 点击 chip → 弹"模型 + 并发数"
# 5. 选 zai/glm-4.5-air，并发 3，点确认
# 6. 右下角浮窗出现，看到 3 个 ⏳ + 2 个 ⌛
# 7. 完成后浮窗显示 "✅ 5/5"
# 8. 点"展示新页面" → 右抽屉跳到 wiki/synthesis/sessions/ 列出 5 个新文件
```

---

### Step 7：总验收 + UX 体感打磨

**目标**：跑 §10 的总验收剧本，发现的小问题在这一 step 收口；不引入新功能。

**预期打磨项**（codex 边验收边记录到 commit 描述）：

- 拖拽 dropzone 的视觉反馈（hover/drag-over 高亮颜色）
- BatchDigestPanel 的滚动条样式（条目超过 8 个时）
- 失败重试按钮（每条失败的右侧加 "↻ 重试"，单独跑该文件）
- 侧栏 KB 折叠状态的 localStorage 持久化（刷新页面记得上次折叠了哪几个）
- 在 BatchDigestPanel 浮窗里点单条 "✅" 直接打开右抽屉看该页面

**验收命令**：

```bash
# 跑 §10 的完整剧本
```

---

## §5 数据契约

### 5.1 config.json 扩展

```typescript
interface AppConfig {
  // 原有字段
  lastUsedKbPath?: string;
  externalKnowledgeBases?: Array<{ path: string; addedAt: string }>;
  showUserGlobalSkills?: boolean;

  // 阶段 3.5 新增
  modelRoles?: {
    main?: { provider: string; modelId: string } | null;
    digest?: { provider: string; modelId: string } | null;
  };

  uiPrefs?: {
    sidebarExpandedKbs?: string[];  // KB path 列表，控制折叠状态持久化（Step 7）
  };
}
```

向后兼容：所有新字段都是 optional；缺省时回退 pi 默认 / 全部 KB 默认折叠（active 例外）。

### 5.2 SSE 事件协议（批量消化）

详见 §4 Step 5 的 `BatchDigestEvent` 类型定义。事件名（`type` 字段）固定 6 种，前端按 `type` switch。

### 5.3 inspect 端点响应

详见 §4 Step 2 的 API 契约。

---

## §6 验收清单

| # | 验收项 | 命令/操作 | 期望结果 |
|---|---|---|---|
| 1 | 侧栏统一 | 看侧栏 | 无 default/external 分区，外部库右侧 `(外部)` 文字 |
| 2 | 对话子树折叠 | 点 KB chevron | 展开/折叠对话列表 |
| 3 | 拖拽填路径 | 从 Finder 拖文件夹到 dropzone | 输入框自动填绝对路径 |
| 4 | inspect 非 wiki 目录 | 拖普通目录 | dialog 切到"初始化为 wiki"模式 |
| 5 | 就地初始化 | 填 purpose 点初始化 | 目录下出现 `.wiki-schema.md` + `index.md`，侧栏出现该库 |
| 6 | 多模型保存 | 设置面板选 main/digest | `config.json` 出现 `modelRoles` |
| 7 | 多模型生效 | 触发批量消化 | 后端日志显示 `[agent] role=digest model=zai/glm-4.5-air` |
| 8 | 并发消化 | 5 个文件并发=3 | SSE 流显示同时启动 ≤3 个 file_start |
| 9 | 单文件失败不影响其他 | 准备一个不存在的路径混进 filePaths | done 事件 succeeded=4 failed=1 |
| 10 | 完成后产物可见 | 右抽屉看 wiki/synthesis/sessions/ | 5 个新 markdown 文件 |

---

## §7 给 codex 的交接说明

### 7.1 起手第一步：阅读以下文件

1. **PRODUCT.md** §4 阶段 3.5 + §10 进度追踪（顶层意图）
2. **本文档**（细则）
3. `server/src/agent.ts`（理解现有 session 创建逻辑）
4. `web/src/components/Sidebar.tsx`（理解现有侧栏）
5. `web/src/components/AddExternalDialog.tsx`（理解现有 add-external 流程）
6. `server/src/extensions/new-wiki.ts`（理解现有 init-wiki 流程）

### 7.2 与 PRODUCT.md 关系

- 本阶段所有架构决策已写入 PRODUCT.md ADR-18（合并多模型双角色 + 子代理框架）
- 实施中若发现与 ADR-18 / 本文档冲突的事实（如 pi SDK 的 `inMemory` 行为与我预期不符），**停下报备**，不要自己改方向

### 7.3 不要做的事

- ❌ **不要** 抄 omp 的 `executor.ts` / `index.ts` 那 3000 行代码（我们只要 30 行 concurrency.ts）
- ❌ **不要** 在子代理 session 里挂 KB / synthesis / artifacts extension（消化是裸 prompt，子代理只读不写）
- ❌ **不要** 把 `main` 角色配置硬编码到主对话路径（保持当前 pi 默认逻辑兜底，避免破坏现有稳定性）
- ❌ **不要** 在拖拽实现里假设浏览器能拿到绝对路径 — 先实测 `dataTransfer.types/getData`；只有拿到真实 `file://` 才自动填路径，否则明确提示用户粘贴路径
- ❌ **不要** 静默覆盖用户已有文件 — 就地初始化前必须做冲突检测，确认覆盖时必须先备份
- ❌ **不要** 引入 p-limit / async-pool 等并发库（自写 30 行）
- ❌ **不要** 引入 react-dropzone（用原生 onDragOver/onDrop）

### 7.4 重点验证（实施过程中务必跑通）

1. **TBD-3.5-1**：子代理 session 共享主进程的 `authStorage` / `modelRegistry` 是否会被回收 → 写一个小测试连开 3 个 session 看主 session 是否仍能工作
2. **TBD-3.5-2**：`init-wiki.sh` 就地初始化会写哪些文件 → 必须确认冲突检测/备份列表覆盖完整
3. **macOS Finder 拖拽 MIME 协议**：实测 Finder 拖文件夹时 `dataTransfer.types` 含什么 → 确认是否有 `text/uri-list` / `text/plain` 的 `file://`；没有则按输入框兜底验收

---

## §8 风险与待办（TBD）

### TBD-3.5-1：子代理 session 资源共享

**问题**：pi SDK 的 `createAgentSession` 接受 `authStorage` / `modelRegistry`，但文档没说子代理 dispose 时是否会影响主 session 共享的这些实例。

**应对**：
- **首选**：实测开 3 个并发 inMemory session 共享一个 authStorage / modelRegistry，dispose 后主 session 是否仍能 prompt
- **回退**：若发现共享有副作用，每个子代理 `new AuthStorage()` / `new ModelRegistry()`（成本是每个子代理重新读 `~/.pi/agent/auth.json`，单次成本 < 1ms，可接受）

**何时定**：Step 5 实施过程中第一件事就是写 60 行测试代码验证。

### TBD-3.5-2：init-wiki.sh 就地初始化

**问题**：阶段 3.5 需要把已有目录就地初始化为 wiki。当前 `init-wiki.sh` 第一个参数就是目标路径，因此可用于已有目录；真正风险是脚本会写入固定文件，可能覆盖用户已有的 `index.md` / `purpose.md` 等资料。

**应对**：
- **首选**：复用 `init-wiki.sh <path> <purpose> 中文`，但调用前检查 `.gitignore`、`.wiki-schema.md`、`index.md`、`log.md`、`wiki/overview.md`、`purpose.md`、`.wiki-cache.json` 是否已存在；存在则返回 409 让前端二次确认
- **覆盖确认后**：先备份冲突文件到 `.llm-wiki-agent-backup/<timestamp>/`，再执行初始化
- **回退**：后端用 TypeScript 模仿 init-wiki.sh 的最小骨架，仍然执行同样的冲突检测和备份

**何时定**：Step 3 实施起手第一件事，验收时必须覆盖“已有 index.md 不被静默覆盖”的场景。

### TBD-3.5-3：main 角色是否影响主对话

**当前决定**：main 角色配置**不**影响 `selectKb/selectConversation` 的 session 创建，保持现有 pi 默认行为。

**未来扩展**：如果用户反馈"配了 main 但主对话没生效"，则把 `selectKb` 改为读 `modelRoles.main` → 传给 `createAgentSession` 的 `model` 字段。本阶段先不做。

**何时定**：阶段 3.5 验收后看用户反馈。

### TBD-3.5-4：并发数上限

**问题**：默认并发=3，用户可调；但理论上 zai 免费层有 RPM 上限（具体不明）。

**应对**：
- 提供 1/3/5 三档（drop-down 不允许自定义）
- 失败时观察 status code = 429 → SSE 推 `file_error` 带 `error: "rate limited, please reduce concurrency"`
- 不做自动降级（让用户决定重试 + 调小并发）

**何时定**：本阶段直接采纳，验收后看实际遇到 429 的频率。

### TBD-3.5-5：消化输出 schema 漂移

**问题**：cheap 模型不一定严格按 `# H1 + frontmatter + 三个 section` 输出，可能漏 section / 多解释。

**应对**：
- prompt 里反复强调"只输出 markdown 不要寒暄"
- 主进程拿到 `wikiMarkdown` 后**不做**强校验（万一格式漂移也不丢内容，让人工后续修）
- 阶段 3.5 不做"输出格式校验 + 失败重试"——那是阶段后做

**何时定**：本阶段先放过；阶段 3.5 验收时看实际命中率，写入妥协清单。

---

## §9 执行 plan（codex 工作清单）

### 9.0 起手准备（codex 第一件事）

1. 切到 `stage-3.5` 分支（已存在）
2. 跑 `npm run dev` 确认阶段三末态可用
3. 读 §7.1 的文件清单 + 本文档全文 + PRODUCT.md ADR-18
4. **写 TBD-3.5-1 验证脚本**（60 行 / 跑 `node --input-type=module -e ...`）确认 SDK 行为
5. **加一个临时 drag probe** 实测 macOS Finder 拖文件夹时 `dataTransfer.types/getData` 是否含真实 `file://`；探针结论写进 Step 2 commit message
6. **看 init-wiki.sh 源码**确认写入文件列表，并先实现冲突检测/备份策略

### 9.1 Step 1：侧栏重构

- 实现：§4 Step 1
- 验收：§4 Step 1 末尾验收命令
- Commit：`refactor(stage-3.5-step-1): unify sidebar with collapsible conversation subtree`

### 9.2 Step 2：拖拽 + inspect

- 实现：§4 Step 2
- 验收：§4 Step 2 末尾验收命令；如果当前浏览器拿不到 `file://`，必须验收“提示用户粘贴路径”的兜底流程
- Commit：`feat(stage-3.5-step-2): drag-to-fill path + inspect endpoint`

### 9.3 Step 3：非 wiki 目录初始化

- 实现：§4 Step 3
- 验收：§4 Step 3 末尾验收命令；额外准备一个已有 `index.md` 的目录，确认首次提交返回冲突提示，确认覆盖后文件被备份
- Commit：`feat(stage-3.5-step-3): init-existing-dir flow with purpose prompt`

### 9.4 Step 4：多模型双角色

- 实现：§4 Step 4
- 验收：§4 Step 4 末尾验收命令
- Commit：`feat(stage-3.5-step-4): dual model roles (main/digest) in config`

### 9.5 Step 5：子代理批量消化框架

- 实现：§4 Step 5（含 §8 TBD-3.5-1 验证）
- 验收：§4 Step 5 末尾验收命令
- Commit：`feat(stage-3.5-step-5): subagent batch digest framework with concurrency limit`

### 9.6 Step 6：批量消化 UI

- 实现：§4 Step 6
- 验收：§4 Step 6 末尾验收命令
- Commit：`feat(stage-3.5-step-6): batch digest panel with SSE progress`

### 9.7 Step 7：总验收

- 跑 §10 总验收剧本
- 把发现的小问题修在本 step 内（不跨阶段）
- Commit：`polish(stage-3.5-step-7): batch digest UX touches`

### 9.8 前置准备（codex 不做，作者做）

- pi `auth.json` 至少配两组 provider 凭证（zai 已有 zai+deepseek，作者无需额外配）
- 准备测试目录 `/tmp/test-batch-digest/` 含 5 个 `.md` 文件

### 9.9 PR

- 7 commit + 允许 fix-commit
- PR base: `main`, head: `stage-3.5`
- Title: `feat: stage 3.5 - navigation refactor & subagent batch digest`
- Body 含 §10 的快速验收命令清单

---

## §10 总验收剧本（claude 总验收用）

### 10.1 前置确认

```bash
cd ../llm-wiki-agent
git status                # 干净
git log --oneline -8      # 看到 7 个 stage-3.5-step-* commit
```

### 10.2 启动

```bash
npm run dev
# 浏览器开 http://localhost:5180
```

### 10.3 侧栏验收（Step 1）

- [ ] 侧栏看不到 "默认" / "外部" 两个 section
- [ ] 外部库右侧有 `(外部)` 灰字
- [ ] 当前选中库点 KB 名可展开 / 收起对话子树
- [ ] 点未选中库 → 切换 active + 展开子树 + 旧 active 折叠
- [ ] 点 chevron 仅折叠不切换 active

### 10.4 拖拽与初始化验收（Step 2 + 3）

```bash
# 准备测试目录
rm -rf /tmp/test-batch-digest
mkdir -p /tmp/test-batch-digest
cd /tmp/test-batch-digest
for i in $(seq 1 5); do
  cat > "doc-$i.md" <<EOF
# 测试文档 $i

这是一篇关于 LLM agent 框架的笔记。
- pi-agent 是基于 TypeScript 的
- 支持 Anthropic Skills 标准
- 阶段三完成了产出能力

## 关键技术决策
为什么选 pi-agent 而非 Vercel AI SDK？因为前者原生支持 Skill 标准。
EOF
done
```

- [ ] 点 "+ 添加现有库"，从 Finder 拖 `/tmp/test-batch-digest`
- [ ] 若本机浏览器暴露 `file://` → 输入框自动填路径；若不暴露 → UI 明确提示粘贴路径，粘贴后继续
- [ ] inspect 显示 `(看起来不是 wiki，含 5 个可消化文件)`
- [ ] 按钮文案变 "初始化为 wiki"
- [ ] 点击 → 弹 InitExistingDirDialog
- [ ] 填 purpose "LLM agent 框架研究"
- [ ] 选 digest 模型 `zai/glm-4.5-air`，并发=3
- [ ] 点 "初始化并消化"
- [ ] 验证：
```bash
cat /tmp/test-batch-digest/.wiki-schema.md      # 含 purpose
cat /tmp/test-batch-digest/index.md             # 含 purpose
ls /tmp/test-batch-digest/wiki/synthesis/sessions/  # 5 个 .md 文件
```

冲突保护额外验收：

```bash
rm -rf /tmp/test-init-conflict
mkdir -p /tmp/test-init-conflict
echo "# 用户原有索引" > /tmp/test-init-conflict/index.md
```

- [ ] 添加 `/tmp/test-init-conflict` 并初始化时，前端显示将覆盖 `index.md`
- [ ] 不确认覆盖时，`index.md` 内容不变
- [ ] 确认覆盖后，旧 `index.md` 出现在 `.llm-wiki-agent-backup/<timestamp>/index.md`

### 10.5 多模型配置验收（Step 4）

```bash
# 看 config.json
cat ~/.llm-wiki-agent/config.json | jq .modelRoles
# 期望：{"main": null, "digest": {"provider":"zai","modelId":"glm-4.5-air"}}
# （main 没配是因为我们让用户自由 / 默认不动）
```

- [ ] 打开设置面板"模型分配"区，看到当前 digest = zai/glm-4.5-air
- [ ] 切 digest 到 deepseek/deepseek-v4-flash 保存
- [ ] 再批量消化一个文件 → 后端 log 显示 `[agent] role=digest model=deepseek/deepseek-v4-flash`

### 10.6 批量消化进度验收（Step 5 + 6）

观察 BatchDigestPanel：
- [ ] 启动后 3 秒内有 3 个 ⏳（并发 3 同时启动）
- [ ] 每条目状态变化：⌛ → ⏳ → ✅
- [ ] file_progress 实时更新（"已生成 N 字符"）
- [ ] 全部完成显示 "✅ 5/5"
- [ ] 主动制造失败：传一个不存在的路径混进 filePaths → 期望 4 ✅ + 1 ❌，❌ 行显示错误信息
- [ ] 主动传 `concurrency=0` 或 `2` → 期望接口返回 400，不启动任务

### 10.7 对账：实施细节 vs 设计文档

claude 总验收时对照本文档 §4 所有 step 与实际 commit diff，记录差异：

| Step | 设计意图（本文档） | 实施现状（实际 commit） | 偏差 |
|---|---|---|---|
| 1 | 侧栏统一 | _填写实际_ | _无 / 有偏差描述_ |
| ... | ... | ... | ... |

### 10.8 issue 清单（claude 列出，作者决策）

发现的问题按以下格式列：

```markdown
## issue-N: <一句话标题>

**严重度**：🔴 阻塞 / 🟡 妨碍验收 / 🟢 微妙打磨
**所在 step**：Step X
**现象**：...
**期望**：...
**建议修复路径**：...
**作者决策**：[ ] codex 修 [ ] claude 修 [ ] 接受妥协写入 PRODUCT.md
```

作者从清单选每条决策；codex 修的列回 PR；claude 修的直接提 PR 上 commit。

---

## §11 文档维护

- **本文档冻结时机**：阶段 3.5 验收通过、PR 合并到 main 之后，本文档**只允许加完成情况附录**（类比阶段三设计文档的"完成情况"段），不改原文
- **回写 PRODUCT.md**：验收通过后，作者按 §11.1 检查清单更新 PRODUCT.md
- **本文档与 PRODUCT.md 冲突**：以 PRODUCT.md 为准；本文档外发现新决策需要先回写 PRODUCT.md

### 11.1 验收后 PRODUCT.md 更新清单

- [x] §4 阶段 3.5 标题加 `✅ 已完成 2026-05-27`
- [x] §4 阶段 3.5 末尾加"完成情况"小节（范围交付、接受的妥协、新增依赖）
- [x] §10 进度追踪更新"阶段 3.5"章节（完成情况 + 验收实况）
- [x] §7 ADR-18 保持与实现一致
- [x] §9 待决事项把 TBD-2 标 ✅ 已解决（多模型路由落地）
- [x] CLAUDE.md 的"项目当前阶段"段改为 "阶段 3.5 已完成"，指向下一阶段（图谱 / 阶段后规划）

### 11.2 与阶段三设计文档的关系

阶段三设计文档与本文档**完全独立**：阶段三的 manifest / artifact 概念不在本阶段使用；本阶段的子代理框架不影响阶段三的产出工作流。

唯一交集：批量消化产生的 wiki 页面如果用户后续要"做成 PDF"，走的是阶段三的产出流程，与本阶段无关。

### 11.3 完成情况附录

- 完成时间：2026-05-27
- 范围：侧栏统一、拖拽/输入路径检查、非 wiki 目录就地初始化、多模型角色配置、子代理批量消化、SSE 进度浮窗
- 新增依赖：无
- 保留妥协：浏览器拖拽若拿不到真实路径，继续要求用户粘贴路径
- 验收后修正：main 角色已接管主对话；设置切换 main 后重载当前活跃对话，让右上角模型显示与配置保持一致
- 验证：`npm run --silent typecheck`、`node --import tsx --test server/src/digest/concurrency.test.ts`、本地接口实测、单文件批量消化真实跑通

### 11.4 验收后补强（2026-05-28）

- 批量消化失败隔离：单个文件缺失、类型不支持或来源校验失败时，只标记该文件失败，不中断同批其他文件。
- 批量消化面板：从总进度浮窗补强为逐文件状态列表，显示排队 / 运行 / 完成 / 失败、已生成字数，并给完成项提供打开结果入口。
- 外部目录来源校验：`inspect` 端点返回 `scanId`，批量消化只接受刚扫描确认过的外部文件；不再信任前端传任意 `sourceRoot`。
- 初始化后批量消化：初始化非 wiki 目录时可为本次任务选择 digest 模型，不需要改全局设置。
