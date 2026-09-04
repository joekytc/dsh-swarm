# 阶段三设计文档：产出能力（PDF / Word / PPT / Excel / HTML）

> 状态：**设计待 codex 实施** · 创建于 2026-05-27 · 阶段三验收通过后归档不再修改
>
> 与 PRODUCT.md 的关系：PRODUCT.md §4 阶段三 + §10 是**顶层意图**，本文档是**落地细则**。冲突时以 PRODUCT.md 为准；本文档外发现新决策需要先回写 PRODUCT.md。

---

## §0 文档用法

- **范围**：阶段三 8 个 step 的实施细则、API 契约、新增依赖、验收命令、执行 plan、总验收剧本
- **给谁看**：
  - codex（实施）：按 §9 执行 plan 一次性做完 8 step，每 step 一个 commit，最后提 1 个 PR
  - claude（总验收）：按 §10 端到端验收，发现问题按 §10.8 列 issue 清单交作者决策
  - 作者（决策）：审 issue 清单决定让 codex 修还是让 claude 修
- **不在范围**：图谱（阶段四）、Tauri 打包（阶段五）、open-design 的 130+ 个设计向 Skill（仅借鉴架构思想，不批量挂载）
- **工作流**（沿用阶段二验证有效的流程）：
  1. 作者按 §9.6 完成前置准备（vendor anthropics/skills 进项目、装/确认依赖）
  2. codex 按 §9 一次性做完 8 step，提 1 个 PR（8 commit + 允许 fix-commit）
  3. claude 按 §10 端到端验收 + 安全审计 + §10.7 对账
  4. claude 列 issue 清单（§10.8 格式），作者决策让 codex 还是 claude 修
  5. 全过后作者按 §11 回写 PRODUCT.md

---

## §1 阶段三总览

**目标**：让"对话 → 产出"成为视觉广告位。用户**打开界面就能看到能产出什么**（PDF/Word/PPT/Excel/HTML），不必通过 README 或 `/` 试探。

**核心设计原则**（贯穿阶段三所有 UI 决策）：

> **打开界面看到功能（discoverability first）**：用户不读 README，只扫一眼界面找能用的功能。

**8 step 概览**：

| # | Step | 后端 | 前端 | 重难度 |
|---|---|:---:|:---:|---|
| 1 | anthropics/skills 4 个 vendor 进项目 + Skill loader 收紧（项目优先、全局折叠）| ✅ | — | 🟡 含 TBD-3 |
| 2 | ArtifactManifest 数据契约 + 后端 artifacts API + prepare/finalize Extension 工具 | ✅ | — | 🟡 含 TBD-2 |
| 3 | 产出按钮区（5 个固定按钮）+ 三通道触发逻辑 | — | ✅ | 🟢 |
| 4 | 右抽屉多产物 tab 切换 UI | — | ✅ | 🟡 |
| 5 | HtmlRenderer（iframe sandbox + srcDoc inline）| — | ✅ | 🟡 含 TBD-4 |
| 6 | DownloadOnlyRenderer（pdf/docx/pptx/xlsx 元数据卡片 + 下载按钮）| — | ✅ | 🟢 |
| 7 | 设置面板加 toggle："展示用户全局 Skill"（默认 off）| ✅ | ✅ | 🟢 |
| 8 | 总验收 + UX 体感打磨 | — | ✅ | 🟢 |

**总验收 3 条**（来自 PRODUCT.md §4 阶段三 + 我们的扩展）：

1. **5 种格式产出全过**：一次对话能产出 HTML、PDF、Word、PPT、Excel 五种格式，UI 内可直接预览（HTML）或下载（其余 4 种）
2. **三通道触发等价**：点按钮 / 输 `/pdf` / 自然语言 "做成 PDF" 三种方式都能触发同一条产出流程，产物 manifest 结构一致
3. **Skill 噪音可控**：默认 `/` 菜单只显示项目内置 + pi 默认 Skill，用户全局 Skill（如 30+ cc-switch 软链）默认隐藏在折叠区；设置面板有 toggle 可打开

---

## §2 关键技术决策

| ID | 决策 | 选定 | 拒绝项 & 拒绝原因 |
|---|---|---|---|
| E1 | 图谱集成时机 | **推迟到阶段四**（作者要重新构思图谱设计）| 阶段三塞图谱：范围过大；图谱设计未定稿 |
| E2 | Skill 来源 | **anthropics/skills 4 个**（docx/pdf/pptx/xlsx）作为基础能力底座 | open-design 132 个：除了产出向其余无关；anthropics 7+ 个：阶段三只取产出基础，其余精选放阶段后规划 |
| E3 | Skill 挂载方式 | **项目内置 vendor 到 `<repo>/.claude/skills/<skill>/`** | submodule：新手不友好（多一步 init）；用户手装：违反"打开界面看功能"原则，用户不读 README |
| E4 | Skill loader 优先级 | **项目 `<repo>/.claude/skills/` > pi 默认 `~/.pi/agent/skills/` > 用户全局 `~/.claude/skills/`（默认隐藏）** | 全部混合显示：阶段二实测被 30+ 全局 Skill 淹没；仅项目级：用户的 pi-skills 也用不了 |
| E5 | 触发形态 | **三通道**：固定按钮区 + `/` 命令补全 + 自然语言 | 仅 `/`：违反"打开界面看功能"；仅按钮：熟手快键缺失；仅自然语言：discoverability 0 |
| E6 | 按钮数量 | **v1 固定 5 个**（PDF / Word / PPT / Excel / HTML） | 用户可配：MVP 阶段过早灵活；按钮 > 5 个：折叠到"更多 ▼"是阶段后的事 |
| E7 | 按钮位置 | **输入框下方一行**（textarea 与 status/send 行之间） | 输入框右侧聚合 ＋ 菜单：藏一层，违反 discoverability；assistant 气泡末尾：每条都加噪音 |
| E8 | 多产物 UI | **右抽屉 tab 切换**（复用阶段二 RightDrawer 容器） | 侧栏新增"产物区"：跨对话不切合；每次新窗口：丢失上下文 |
| E9 | HTML 预览模式 | **iframe + sandbox + srcDoc inline**（单文件 HTML 注入）| URL-load 双模式：open-design 用，但需要 host-iframe bridge，v1 过重 |
| E10 | PDF/docx/xlsx/pptx 预览 | **不浏览器渲染**：元数据卡片 + 下载按钮（系统应用打开）| PPTXjs / pdf.js / docx-preview：兼容性坑深、字体/动画/公式渲染不全；用户下载用 Keynote/Office/Numbers 更顺 |
| E11 | 产物元数据契约 | **ArtifactManifest**（借鉴 open-design 的 manifest 概念）| 不带 manifest：前端无法决定用哪个 renderer；硬编码 if-else：扩展性差 |
| E12 | 后端实现路径 | **三通道前端 → 单条 `/api/prompt` → agent → prepare_artifact + Skill + finalize_artifact** | 每通道独立后端 API：违反 D9（Skill 已有）+ 3 倍维护成本 |
| E13 | D9 能力归属（沿用 ADR-16）| **不新建 `/export-*` Extension 命令**；产出操作走 Skill；`prepare_artifact` / `finalize_artifact` 是 agent 工作台元能力 → Extension | 每个产出格式建 `/export-pdf` 等 Extension：违反 D9（anthropics pdf Skill 已有）|

**E13 落地细节**：
- `/` 菜单显示的 `/pdf` `/docx` `/pptx` `/xlsx` 是 **Skill 命令**（来自 anthropics 的 SKILL.md `name` 字段），不是 Extension 命令
- 我们只新建 2 个 Extension 工具：`prepare_artifact` + `finalize_artifact`，管 artifact 工作流（id 分配、目录创建、manifest 写入）；不管"怎么生成 PDF/docx"
- agent 接到任务时的流程：
  ```
  按钮触发的 prompt → agent:
    1. tool_call: prepare_artifact(kind="pdf", title=...) → { id, path }
    2. tool_call: pdf Skill 的实际操作（读对话历史 + 写文件到 path）
    3. tool_call: finalize_artifact(id, primaryFile="report.pdf") → 完成
  → SSE 发 artifact_created event → 前端右抽屉自动开 tab
  ```

---

## §3 新增依赖

### 前端
**零新依赖**。HTML 预览用浏览器原生 iframe，元数据卡片用 shadcn 已有的 Card/Button，tab 切换用现有的 cmdk + 自写 tabs 即可（也可用 radix-ui 已经引入的 Tabs primitive，免新加包）。

### 后端
**零新依赖**。Node 内置 `crypto` 用于生成 artifact id（randomUUID），`fs/promises` 写 manifest.json，`child_process.execFile` 调 Skill（沿用阶段二 wiki-init.ts 套路）。

### 与 PRODUCT.md §3.2 的关系
阶段三**零新依赖**，是个意外的好消息——意味着我们"挂载 Skill"的方向选对了（Skill 自带能力，前端不必引入巨型 PPT/PDF 渲染库）。验收通过后 PRODUCT.md §3.2 无需新增行，ADR-17 已经覆盖了阶段二依赖。

如果阶段三实施中发现**实在需要**新依赖（如 HTML srcDoc 模式遇到无法解决的安全问题需要 DOMPurify），按 CLAUDE.md 规则**先停下报备**，不要先 npm install。

---

## §4 八个 Step 详细设计

每个 step 包含：**动机 / 范围（做+不做）/ 改动文件 / 接口设计 / 实现要点 / 验收 fingerprint / 依赖关系**。

---

### Step 1：anthropics/skills 4 个 vendor + Skill loader 收紧

**动机**：
- E2 + E3：把 docx/pdf/pptx/xlsx 4 个 Skill 内置进项目，开箱即用
- E4：阶段二实测发现 `/` 菜单被用户全局 30+ Skill 淹没，必须收紧加载源

**范围**：
- ✅ 从 `anthropics/skills` 仓库 git clone 后 copy 4 个 Skill 目录到 `<repo>/.claude/skills/{docx,pdf,pptx,xlsx}/`
- ✅ 在 `<repo>/.claude/skills/README.md` 写明：内置 Skill 由哪个 anthropics commit 同步而来 + sync 命令
- ✅ 修改 `server/src/agent.ts`：Skill loader 扫描三个目录，分组打 label：`builtin`（项目）/ `pi-default`（pi 默认）/ `user-global`（用户）
- ✅ 修改 `server/src/index.ts::/api/commands`：默认只返回 `builtin` + `pi-default` 两组；接受 query `?includeUserGlobal=true` 才返回 `user-global`
- ❌ git submodule（拒，新手不友好）
- ❌ 自动从 anthropics 同步最新版（v1 手动，未来加 `npm run sync-skills` 脚本）
- ❌ 让用户自定义"哪些 Skill 算 builtin"（v1 固定 4 个）

**改动文件**：
- 新增 `<repo>/.claude/skills/docx/` `pdf/` `pptx/` `xlsx/`（4 个完整 Skill 目录，含 SKILL.md + scripts + dependencies）
- 新增 `<repo>/.claude/skills/README.md`（来源说明 + sync 命令）
- 新增 `<repo>/.claude/skills/.gitkeep`（保险）
- 修改 `server/src/agent.ts`：扩展 `loadAllSkills()` 添加 source 标签
- 修改 `server/src/index.ts`：`/api/commands` 加 `includeUserGlobal` 参数 + 返回 source 字段
- 修改 `web/src/lib/api.ts`：`listCommands(includeUserGlobal?: boolean)` 接受参数

**接口变更**：
```
GET /api/commands?includeUserGlobal=false (default)

Response:
{
  "ok": true,
  "items": [
    {
      "slug": "/pdf",
      "name": "pdf",
      "description": "...",
      "source": "builtin",      // ← 新字段：builtin | pi-default | user-global
      "skillPath": "/repo/.claude/skills/pdf"
    },
    ...
  ]
}
```

**实现要点**：
- vendor 方式：`git clone https://github.com/anthropics/skills /tmp/anthropics-skills && cp -r /tmp/anthropics-skills/{docx,pdf,pptx,xlsx} <repo>/.claude/skills/`
- README 记录 vendor 时刻的 anthropics/skills HEAD commit hash，方便未来 sync diff
- Skill loader 三个路径优先级：项目 > pi-default > user-global（重名时按优先级保留高优先级）
- 内置命令（sediment_to_wiki / new_wiki）source 标 `builtin` 但 skillPath 为 null
- 不要 chmod / 不要 sym-link，直接物理 copy

**验收 fingerprint**：
```bash
# 1. 项目里有 4 个 anthropics Skill
ls -la .claude/skills/
# 应有：docx/ pdf/ pptx/ xlsx/ + README.md
for s in docx pdf pptx xlsx; do
  test -f ".claude/skills/$s/SKILL.md" && echo "✅ $s/SKILL.md 存在" || echo "❌ $s 缺 SKILL.md"
done

# 2. /api/commands 默认只返回项目级 + pi 默认
curl -s 'http://localhost:8787/api/commands' | python3 -c "
import sys, json
d = json.load(sys.stdin)
by_source = {}
for item in d['items']:
    by_source.setdefault(item['source'], []).append(item['name'])
print('builtin:', by_source.get('builtin', []))
print('pi-default:', by_source.get('pi-default', []))
print('user-global:', by_source.get('user-global', []))
"
# 期望：builtin 至少含 pdf/docx/pptx/xlsx/sediment_to_wiki/new_wiki
# 期望：user-global 为空 []

# 3. 显式打开 user-global
curl -s 'http://localhost:8787/api/commands?includeUserGlobal=true' | python3 -c "..."
# 期望：user-global 含用户 ~/.claude/skills/ 下所有 Skill
```

**依赖关系**：阻塞 Step 3（按钮区需要 Skill 加载好）+ Step 7（设置面板 toggle 需要 API 支持）。

---

### Step 2：ArtifactManifest 契约 + 后端 artifacts API + prepare/finalize Extension

**动机**：
- E11：每个产物带 manifest，前端按 manifest 选 renderer
- E12 + E13：D9 落地——只新建 2 个 Extension 工具（`prepare_artifact` / `finalize_artifact`），管 artifact 工作流；Skill 负责实际产出

**范围**：
- ✅ 定义 ArtifactManifest TypeScript interface（§5.1）
- ✅ 新增 `server/src/artifacts.ts`：存储管理 + 内存索引 + 启动时从磁盘重建
- ✅ 新增 `server/src/extensions/artifacts.ts`：两个 Extension 工具 `prepare_artifact` + `finalize_artifact`
- ✅ 新增 5 个路由：`/api/artifacts`（列表）/ `/api/artifacts/:id`（manifest）/ `/api/artifacts/:id/files/:filename`（文件）/ `/api/artifacts/:id`（DELETE，可选 v1.5）
- ✅ SSE 事件：`artifact_created`（推 artifact id 给前端）
- ❌ 跨对话产物合并视图（v1 只按 conversation 索引）
- ❌ 产物去重 / 缓存（v1 每次产出独立）

**改动文件**：
- 新增 `server/src/artifacts.ts`
- 新增 `server/src/extensions/artifacts.ts`
- 修改 `server/src/agent.ts`：注册新 Extension + bootstrap 时调 `artifacts.scanAndRebuildIndex()`
- 修改 `server/src/index.ts`：新增 4 个路由
- 修改 `web/src/lib/api.ts`：`listArtifacts(conversationId)` / `getArtifactManifest(id)` / `getArtifactFileUrl(id, filename)`

**ArtifactManifest schema**（详见 §5.1）：
```ts
interface ArtifactManifest {
  id: string;                    // crypto.randomUUID()
  kind: "html" | "pdf" | "docx" | "pptx" | "xlsx";
  renderer: "iframe" | "download-only";
  metadata: {
    title: string;
    createdAt: string;           // ISO 8601
    sourceConversationId: string;
    sourceKbPath: string;
    sourceSkill: string;         // "pdf" | "docx" | ...
    sizeBytes: number;           // 主文件大小
  };
  files: Array<{
    name: string;
    sizeBytes: number;
    mimeType: string;
  }>;
  primaryFile: string;           // files[].name 中的主文件
}
```

**存储**：
```
~/.llm-wiki-agent/artifacts/<artifact-id>/
  ├── manifest.json
  ├── <primaryFile>        # 如 report.pdf
  └── [其他附属文件]        # 如 HTML 的 img/foo.png
```

**Extension 工具**：

```ts
// server/src/extensions/artifacts.ts

prepare_artifact:
  params: { kind, title }
  returns: { id, workspacePath }    # 创建空目录，返回 path 给 agent
  
finalize_artifact:
  params: { id, primaryFile }
  returns: { ok, manifest }         # 扫 workspacePath 下所有文件，写 manifest.json
                                     # 触发 SSE artifact_created event
```

**SSE 事件**（新增到 `/api/prompt` 流）：
```
event: artifact_created
data: {"id":"<uuid>","kind":"pdf","title":"..."}
```

**实现要点**：
- artifact id 用 `crypto.randomUUID()`
- workspacePath：`<HOME>/.llm-wiki-agent/artifacts/<id>/`，新建时 `mkdir -p`
- finalize_artifact 扫目录列出所有文件 + size + mimeType（用 `mime-types` 包？不引入新依赖，硬编码常见后缀→mime 映射就行）
- manifest.json 用 atomic write（tmp + rename，沿用阶段二 auth.ts 套路）
- 启动时 `scanAndRebuildIndex()`：遍历 `~/.llm-wiki-agent/artifacts/*/manifest.json` 重建内存索引
- 文件路径安全：所有 artifact id 必须是 uuid 格式正则匹配；files/:filename 必须是 manifest.files 列表中的名字，不接受 `..` / 绝对路径
- 单文件大小硬限制 100MB（生成超过的话 finalize 报错）

**验收 fingerprint**：
```bash
# 1. 调用 prepare_artifact 创建工作区
# 在对话里说："调用 prepare_artifact(kind='pdf', title='test') 然后告诉我 path"
# 预期：~/.llm-wiki-agent/artifacts/<新 uuid>/ 出现，agent 回复 path

# 2. 写一个 dummy 文件到 path（让 agent 跑：cat > <path>/dummy.pdf <<<'fake pdf'）
ls ~/.llm-wiki-agent/artifacts/<id>/  # dummy.pdf

# 3. 调用 finalize_artifact(id, primaryFile='dummy.pdf')
cat ~/.llm-wiki-agent/artifacts/<id>/manifest.json
# 期望：含 id/kind/renderer/metadata/files/primaryFile，files 含 dummy.pdf

# 4. API 验证
curl -s 'http://localhost:8787/api/artifacts?conversation=<cid>' | jq
# 期望：返回数组含新 artifact 的 manifest

curl -s 'http://localhost:8787/api/artifacts/<id>' | jq
# 期望：返回单个 manifest

curl -sI "http://localhost:8787/api/artifacts/<id>/files/dummy.pdf"
# 期望：200，Content-Type: application/pdf，Content-Disposition: attachment

# 5. 路径安全
curl -s -w "HTTP %{http_code}\n" "http://localhost:8787/api/artifacts/<id>/files/../../../etc/passwd"
# 期望：400

curl -s -w "HTTP %{http_code}\n" "http://localhost:8787/api/artifacts/not-a-uuid"
# 期望：400

# 6. 启动重建
# 杀后端 → 重启 → 再次 curl /api/artifacts?conversation=<cid>
# 期望：能返回之前创建的 artifact（持久化）
```

**依赖关系**：阻塞 Step 3/4/5/6（前端 UI 需要后端 API）。

---

### Step 3：产出按钮区 + 三通道触发逻辑

**动机**：
- E5 + E6 + E7：5 个固定按钮放输入框下方
- 按钮 = 等同于发一段固定 prompt，让 agent 走 prepare→Skill→finalize 三步流程

**范围**：
- ✅ ChatPanel 输入框下方加按钮行：📄 PDF · 📝 Word · 📊 PPT · 📋 Excel · 🌐 HTML
- ✅ 点击按钮 = 自动发送对应 prompt（不需要用户再按发送）
- ✅ 按钮 disabled 条件：无活跃 kb / 当前 `status === "streaming"` / 输入框无对话历史（messages.length === 0）
- ✅ hover 显示 tooltip：导出为 PDF / Word / ...
- ✅ `/` 菜单 + 自然语言两通道沿用阶段二既有路径（agent 自动识别意图调 Skill）
- ❌ 按钮自定义 / 排序 / 隐藏（v1 固定）
- ❌ 一键导出多种格式（v1 一次一个）
- ❌ 导出进度条 / 取消按钮（v1 看 SSE event 即可）

**改动文件**：
- 修改 `web/src/components/ChatPanel.tsx`：加按钮区组件
- 新增 `web/src/components/ExportButtons.tsx`（独立组件，方便测试 / 复用）
- 修改 `web/src/lib/api.ts`：可能加 helper `buildExportPrompt(kind, conversationContext)`

**按钮区 UI**（紧贴 textarea 下、status/send 上）：
```
┌─────────────────────────────┐
│ textarea                     │
└─────────────────────────────┘
[chip if URL]                              ← 阶段二已有
┌─ 导出 ──────────────────────────────────┐  ← 阶段三新增
│ 📄 PDF · 📝 Word · 📊 PPT · 📋 Excel · 🌐 HTML │
└─────────────────────────────────────────┘
状态: idle                          [发送]  ← 阶段二已有
```

**按钮发送的固定 prompt（v1 模板）**：

```
请用 <skillName> Skill 把当前对话整理产出为 <kindLabel>，按以下三步：

1. 调用 prepare_artifact(kind="<kind>", title="<对话首条用户消息截前 30 字>") 获得 { id, workspacePath }
2. 用 <skillName> Skill 在 workspacePath 下生成主文件（命名建议：<kind>-<timestamp>.<ext>）
3. 调用 finalize_artifact(id, primaryFile="<生成的文件名>") 完成登记

完成后回复 artifact id 和大致内容摘要。
```

其中：
- skillName / kind / kindLabel / ext 映射表：
  - PDF → `skillName=pdf`, `kind=pdf`, `kindLabel=PDF`, `ext=pdf`
  - Word → `skillName=docx`, `kind=docx`, `kindLabel=Word 文档`, `ext=docx`
  - PPT → `skillName=pptx`, `kind=pptx`, `kindLabel=PPT 演示文稿`, `ext=pptx`
  - Excel → `skillName=xlsx`, `kind=xlsx`, `kindLabel=Excel 表格`, `ext=xlsx`
  - HTML → `skillName=html`（**TBD-5**：是用 anthropics 的哪个 HTML Skill？阶段二 D9 时讨论的 `web-artifacts-builder` 可能是更好选择，需要 codex 实施时查 anthropics/skills 仓库）

**实现要点**：
- 按钮组件接收 `disabled` / `onExport(kind)` props，纯展示
- onExport(kind) → `setInput(buildExportPrompt(kind))` 然后调 `sendPrompt()`
- 不要在前端直接构造 artifact id（让 agent 调 prepare_artifact）
- tooltip 用阶段二已有的 `<Tooltip>` shadcn 组件
- 按钮区在暗色主题下用 muted 色，不抢戏

**验收 fingerprint**：
```
1. 进入有对话历史的 kb（至少 2 条消息）
2. 5 个按钮可见、可点（不灰）
3. 点 📄 PDF → 输入框瞬间出现长 prompt（不可见也行，关键是发送）→ 流式输出 → agent 调 prepare_artifact + pdf Skill + finalize_artifact
4. 等右抽屉收到 SSE event → 自动开 PDF tab
5. 关闭浏览器再开 → 历史里能看到这次产出过程

按钮 disabled 边界：
- 没选 kb → 5 个按钮全灰
- 正在 streaming → 5 个按钮全灰
- 切到没消息的新对话 → 5 个按钮全灰
- hover 灰按钮：tooltip 说明原因（"请先选择知识库" / "请先开始对话"）
```

**依赖关系**：依赖 Step 1（Skill 加载好）+ Step 2（prepare/finalize 可调用）。阻塞 Step 4（按钮触发后右抽屉要响应）。

---

### Step 4：右抽屉多产物 tab 切换 UI

**动机**：E8 + 单对话内多次产出需要可切换查看

**范围**：
- ✅ 收到 SSE `artifact_created` event → 右抽屉自动打开 + 新 tab 高亮
- ✅ 一个对话下的所有 artifacts 排成横向 tab 列表（最新在最右，自动滚到最新）
- ✅ tab 标题：`<kindIcon> <title 截前 12 字>`
- ✅ 点 tab 切 manifest → 根据 `renderer` 字段加载对应 Renderer（HtmlRenderer / DownloadOnlyRenderer，Step 5/6 实现）
- ✅ 切对话：抽屉清空（不跨对话累积，避免错乱）
- ✅ 关闭抽屉按钮（沿用阶段二，Esc 也关）
- ❌ 重命名 tab / 删除 artifact（v1 不做；删除走 DELETE API 是 Step 2.5 范围）
- ❌ 拖拽排序 tab（v1 按 createdAt 升序）

**改动文件**：
- 修改 `web/src/components/RightDrawer.tsx`：增强为多内容 + tab 切换
- 新增 `web/src/components/ArtifactView.tsx`：根据 manifest.renderer 路由到 HtmlRenderer / DownloadOnlyRenderer
- 修改 `web/src/App.tsx`：state 管理：`{ kind: "wikiPage"; path: string } | { kind: "artifacts"; conversationId: string; activeId: string }`
- 修改 `web/src/components/ChatPanel.tsx`：处理 SSE `artifact_created` event → 调 App 的 openArtifact()
- 修改 `web/src/lib/sse.ts`（如果有）/ 流处理逻辑：支持新事件类型

**抽屉布局**：
```
┌─ 右抽屉（400px / 全屏切换）──────────────┐
│ × 关闭         ⛶ 全屏         📥 下载    │  ← Tab 顶栏
├──────────────────────────────────────────┤
│ [📄 报告 v1] [📊 PPT] [🌐 demo]   ←→     │  ← Tab 切换条（横滚）
├──────────────────────────────────────────┤
│                                          │
│         <ArtifactView manifest>          │  ← Renderer 区
│                                          │
└──────────────────────────────────────────┘
```

**实现要点**：
- App.tsx 维护：
  - `drawerMode: "closed" | "wiki-page" | "artifacts"`
  - `wikiPagePath: string | null`（沿用阶段二）
  - `activeArtifactId: string | null`（阶段三新）
  - `artifactsForCurrentConversation: ArtifactManifest[]`（来自 GET /api/artifacts）
- SSE event 处理：`artifact_created` → 调 listArtifacts 刷新 → setActive(新 id) → openDrawer("artifacts")
- 切对话：`useEffect` 检测 conversationId 变化 → setActive(null) + closeDrawer
- tab 切换状态：每个 tab 是个 iframe（HtmlRenderer）的话，切换时 iframe 应**卸载**而非隐藏（避免内存占用）；切回再重新挂载
- 全屏切换按钮：右抽屉 width 在 400px ↔ 100vw 切换
- 下载按钮：定位到 `primaryFile`，触发 `<a href download>` 点击

**验收 fingerprint**：
```
1. 在一个对话里依次点 5 个按钮（PDF/Word/PPT/Excel/HTML）
2. 每次按钮点击后 5-10 秒（agent 时间），右抽屉自动打开 + 新 tab 高亮
3. 5 次都完成后，tab 条有 5 个 tab
4. 点击切换 tab，对应 ArtifactView 切换内容
5. 关闭抽屉 → 切对话 → 再开抽屉（如果有产物）→ 显示新对话的 artifacts
6. 浏览器 DevTools 检查：HtmlRenderer iframe 切走后 DOM 中应被移除（非 display:none）
7. 全屏切换流畅、Esc 关闭、点 × 关闭
```

**依赖关系**：依赖 Step 2 + Step 3。阻塞 Step 5 + 6（实际渲染器）。

---

### Step 5：HtmlRenderer（iframe sandbox + srcDoc inline）

**动机**：E9 + HTML 产物 v1 用最安全的 srcDoc inline 模式预览

**范围**：
- ✅ 读取 manifest.primaryFile（必须是 `.html` 后缀） → 后端 `GET /api/artifacts/:id/files/:filename` 拿 raw HTML 内容 → 注入 iframe srcDoc
- ✅ iframe sandbox 严格：`sandbox="allow-scripts"`（**不带** `allow-same-origin`，防恶意 HTML 读父域 cookie/localStorage）
- ✅ iframe `loading="lazy"`、宽 100% / 高 100%
- ✅ 加载失败 fallback：显示"⚠️ HTML 解析失败"+ 下载原文件按钮
- ❌ URL-load 双模式（v1 不做，open-design 是设计稿场景才需要外部 CSS/JS）
- ❌ host-iframe postMessage bridge（v1 没有"父子通信"需求）
- ❌ HTML 内的相对路径资源支持（如 `<img src="./img.png">` 找不到——TBD-4）

**改动文件**：
- 新增 `web/src/components/renderers/HtmlRenderer.tsx`
- 修改 `web/src/components/ArtifactView.tsx`：根据 manifest.renderer 路由到此

**iframe 设置**：
```tsx
<iframe
  sandbox="allow-scripts"
  srcDoc={htmlContent}
  className="h-full w-full border-0 bg-white"
  loading="lazy"
  title={manifest.metadata.title}
/>
```

**实现要点**：
- htmlContent 通过 fetch 拿到（`getArtifactFile(id, primaryFile)` 返回 text）
- 状态管理：loading / loaded / error 三态
- error 时显示 fallback 卡片（含 size + 下载按钮）
- sandbox 严格度：`allow-scripts` 允许内部 JS 跑，不带 `allow-same-origin` 即可隔离父域
- ⚠️ 不要因为 "为了 HTML 更好看" 而加 `allow-same-origin` / `allow-top-navigation`——这违反安全原则
- iframe 容器要给固定高度（计算 `100vh - 抽屉顶栏高 - tab 条高`）

**验收 fingerprint**：
```
1. 用 web-artifacts-builder Skill 产出一个 HTML（带内嵌 CSS/JS）
2. 右抽屉 HTML tab：iframe 渲染正常，样式生效，按钮可点
3. 浏览器 DevTools 检查 iframe：sandbox="allow-scripts" 无 allow-same-origin
4. 尝试在 iframe 里跑 `top.document.cookie`：应抛 SecurityError（沙箱隔离生效）
5. 主动构造一个含外部 <img src="http://attacker.com/track.png"> 的 HTML 产物：
   - srcDoc 模式默认会发请求（这是浏览器行为）
   - 在 fallback 里加说明："建议产物使用 data: URI 内嵌图片"
6. 上传一个故意损坏的 HTML（不完整标签）：iframe 仍能渲染（浏览器宽容），无 fallback 触发
7. 切走 HTML tab → DOM 检查 iframe 被移除（不是 display:none）
```

**依赖关系**：依赖 Step 4（抽屉框架）。可并行 Step 6。

---

### Step 6：DownloadOnlyRenderer（pdf/docx/pptx/xlsx 元数据卡片）

**动机**：E10 + 这 4 种格式不浏览器渲染，给用户元数据卡片 + 下载按钮

**范围**：
- ✅ 元数据卡片：图标（kind 对应 emoji）+ 标题 + 来源对话 / Skill / 创建时间 / 大小
- ✅ 主下载按钮 "📥 下载 <primaryFile>"
- ✅ 如果 files 有多个：列出附属文件 + 各自下载按钮
- ✅ "在系统应用中打开"按钮（macOS 下用 `file://` URL + window.open）
- ✅ 显示来源对话片段（最后几条 message 截首尾，让用户回忆）
- ❌ 实际浏览器内渲染 PPT/PDF/docx/xlsx（明确不做）
- ❌ 文档内搜索 / 翻页（不做）

**改动文件**：
- 新增 `web/src/components/renderers/DownloadOnlyRenderer.tsx`
- 修改 `web/src/components/ArtifactView.tsx`：路由

**卡片布局**：
```
┌──────────────────────────────────┐
│                                  │
│           📄                     │
│                                  │
│      PDF 文档                    │
│   2026 阶段二验收报告.pdf        │
│                                  │
│   📐 1.2 MB · 由 pdf Skill 生成  │
│   🕐 2026-05-27 15:42            │
│   💬 来自对话："奥派经济学..."    │
│                                  │
│   ┌─ 📥 下载 ─────────────┐     │
│   └────────────────────────┘    │
│                                  │
│   ┌─ 📂 在系统应用打开 ──┐       │
│   └───────────────────────┘     │
│                                  │
└──────────────────────────────────┘
```

**实现要点**：
- 图标映射：pdf 📄 / docx 📝 / pptx 📊 / xlsx 📋 / html 🌐
- 大小格式化：< 1KB 显示 "X bytes"，< 1MB "X.Y KB"，>= 1MB "X.Y MB"
- 下载按钮触发 `<a href="/api/artifacts/:id/files/:filename" download="原文件名" />`
- "在系统应用打开"：浏览器版本下用 `window.open('file://<absPath>')`，Tauri 版本（阶段五）会用 Tauri 的 shell.open
- 来源对话片段：调 GET /api/conversations 拿对话历史，截取片段（首条用户消息 + 最后一条 assistant 消息）

**验收 fingerprint**：
```
1. 产出一个 PDF → 切到 PDF tab → 显示元数据卡片 + 下载 + 在系统应用打开
2. 点下载 → 浏览器开始下载到 ~/Downloads/<filename>.pdf
3. 打开下载的 PDF → 应能正常打开（macOS Preview 或 Chrome PDF viewer）
4. 切到 docx/xlsx/pptx tab → 都显示同样结构的元数据卡片
5. 来源对话片段显示正确（首条用户消息截前 30 字）
6. 文件大小显示格式正确（KB/MB）
```

**依赖关系**：依赖 Step 4。可并行 Step 5。

---

### Step 7：设置面板加 toggle："展示用户全局 Skill"

**动机**：E4 + 用户偶尔需要把全局 Skill 调出来用

**范围**：
- ✅ 设置面板（阶段二已建）加新区段 "Skill 加载"
- ✅ 单个 toggle：`展示用户全局 Skill (~/.claude/skills/) — 默认关`
- ✅ 状态持久化到 `~/.llm-wiki-agent/config.json`（沿用阶段二 config 文件）
- ✅ toggle 切换后立即生效：`/` 菜单 listCommands(includeUserGlobal=newValue) + UI 重新渲染
- ❌ 按 Skill 精细启用 / 禁用（v1 一键开关全部）
- ❌ 项目级 Skill / pi 默认 Skill 的隐藏开关（v1 这两个始终显示）

**改动文件**：
- 修改 `server/src/config.ts`：AppConfig 加 `showUserGlobalSkills?: boolean`
- 修改 `server/src/index.ts`：`/api/commands` 的默认值改为读 config（前端可显式覆盖）
- 修改 `web/src/components/SettingsPanel.tsx`：加 Skill 加载区段 + toggle
- 修改 `web/src/lib/api.ts`：加 `getConfig()` / `setConfig(partial)` 两个 helper（如果阶段二没有）

**接口变更**：
```
GET /api/config (read showUserGlobalSkills 字段)
POST /api/config { showUserGlobalSkills: true }
```

**实现要点**：
- 沿用阶段二 config.ts 的原子写入
- toggle 状态变更后，前端调 invalidate 重新拉 listCommands
- 设置面板 toggle 用原生 `<input type="checkbox">` 或 shadcn Switch（看现有有没有），避免新依赖
- 区段标题 "Skill 加载"，副标题说明文字：当前已加载 N 个 Skill（项目内置 X / pi 默认 Y / 用户全局 Z 隐藏中）

**验收 fingerprint**：
```
1. 默认 toggle 关 → / 菜单只看到项目内置 + pi 默认
2. 打开 toggle → 立即看到 / 菜单多出用户全局 Skill
3. 关闭 toggle → 立即缩回
4. 刷新页面 → toggle 状态保留（持久化）
5. cat ~/.llm-wiki-agent/config.json → 应有 "showUserGlobalSkills": true/false 字段
```

**依赖关系**：依赖 Step 1（loader 收紧已实现）。独立于其他。

---

### Step 8：总验收 + UX 体感打磨

**动机**：阶段三对外是"产品亮点"，UX 必须丝滑

**范围**：
- ✅ 跑一遍 §10 总验收剧本
- ✅ 暗色主题：所有新组件检查无白色露馅
- ✅ 按钮区 hover 状态、disabled 状态视觉清晰
- ✅ 右抽屉 tab 切换动画 < 200ms
- ✅ SSE artifact_created 事件触发到抽屉打开 < 500ms
- ✅ 元数据卡片在 400px 抽屉 / 全屏抽屉两种宽度下都不破版
- ✅ HTML iframe 加载状态有 loading 反馈
- ✅ 全键盘可达：Tab 焦点能到按钮区每个按钮，Enter 触发，Esc 关抽屉
- ❌ 动画细节调到像 Linear / Notion 那种级别（v1 不追求）
- ❌ 无障碍 ARIA 完整（v1 基础够用）

**改动文件**：
- 各前端组件 polish（不新增文件，可能微调 CSS）
- 修改 `docs/stage-3-design.md`：本 step commit 时把 §6 验收 checklist 全打勾

**实现要点**：
- 这一步不应该新增大功能，只是打磨
- 如果验收过程中发现 5-8 个小问题，作为 fix(stage-3) commit 解决（沿用阶段二允许 fix-commit 的策略）
- 不要在这步引入新依赖；不要重构其他 step 已实现的组件结构

**验收 fingerprint**：
```
跑完 §10 全部剧本，§10.7 对账单全打勾，§10.6 体感全 pass。
没有 🔴 阻塞 issue。
```

**依赖关系**：依赖前 7 个 step 全完成。

---

## §5 数据契约

### 5.1 ArtifactManifest schema

```ts
interface ArtifactManifest {
  /** 唯一 id，crypto.randomUUID() 生成 */
  id: string;

  /** 产物种类，决定 renderer */
  kind: "html" | "pdf" | "docx" | "pptx" | "xlsx";

  /** 渲染器类型，前端 ArtifactView 据此路由 */
  renderer: "iframe" | "download-only";

  metadata: {
    /** 用户可见的标题，从产生时的对话首条用户消息提取，截前 30 字 */
    title: string;

    /** ISO 8601 时间戳（带时区）*/
    createdAt: string;

    /** 来源对话 id（pi session id）*/
    sourceConversationId: string;

    /** 来源知识库的绝对路径 */
    sourceKbPath: string;

    /** 调用的 Skill 名（与 SKILL.md 的 name 字段一致）*/
    sourceSkill: string;

    /** 主文件 size（bytes），用于 UI 展示 */
    sizeBytes: number;
  };

  /** 产物目录下的所有文件清单 */
  files: Array<{
    name: string;          // 文件名（不含路径）
    sizeBytes: number;
    mimeType: string;      // 如 "application/pdf"
  }>;

  /** files[].name 中作为"主文件"的那一个 */
  primaryFile: string;
}
```

### 5.2 kind → renderer 映射规则
| kind | renderer | 默认 mimeType |
|---|---|---|
| html | iframe | text/html |
| pdf | download-only | application/pdf |
| docx | download-only | application/vnd.openxmlformats-officedocument.wordprocessingml.document |
| pptx | download-only | application/vnd.openxmlformats-officedocument.presentationml.presentation |
| xlsx | download-only | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet |

### 5.3 存储路径规则
- 所有 artifact 存在 `~/.llm-wiki-agent/artifacts/<artifact-id>/`
- 目录名 = artifact id（uuid v4）
- 目录里至少含：`manifest.json` + `<primaryFile>`
- 可选含：附属文件（如 HTML 的 `img/`、`css/`）

### 5.4 API 命名空间一览（阶段三新增）

| 路径 | 方法 | step | 用途 |
|---|---|---|---|
| `/api/commands` | GET | 1 | 加 `includeUserGlobal` 参数 + 返回 `source` 字段 |
| `/api/artifacts` | GET | 2 | `?conversation=<id>` 列对话的 artifacts |
| `/api/artifacts/:id` | GET | 2 | 单个 manifest |
| `/api/artifacts/:id/files/:filename` | GET | 2 | 下载文件，`Content-Disposition: attachment` |
| `/api/config` | GET/POST | 7 | 读 / 改 `showUserGlobalSkills` 等偏好 |

### 5.5 SSE 事件（新增）

```
event: artifact_created
data: {"id":"<uuid>","kind":"pdf","title":"..."}
```

注入到现有 `/api/prompt` 流。前端识别后调 `listArtifacts` 刷新右抽屉。

### 5.6 按钮 prompt 模板（按 kind 实例化）

| kind | skillName | prompt 第 1 行 |
|---|---|---|
| pdf | pdf | "请用 pdf Skill 把当前对话整理产出为 PDF" |
| docx | docx | "请用 docx Skill 把当前对话整理产出为 Word 文档" |
| pptx | pptx | "请用 pptx Skill 把当前对话整理产出为 PPT 演示" |
| xlsx | xlsx | "请用 xlsx Skill 把当前对话整理产出为 Excel 表格" |
| html | html / web-artifacts-builder | （TBD-5 决定，codex 实施时查 anthropics/skills 实际有什么 HTML 类 Skill） |

完整 prompt 见 §4 Step 3。

---

## §6 验收清单

### 6.1 总验收 3 条
- [ ] **验收 1**：5 种格式产出全过 —— 同一对话依次点 5 个按钮，5 个产物都在右抽屉出现 tab，下载到本地能用对应应用打开
- [ ] **验收 2**：三通道触发等价 —— 同一格式分别用按钮 / `/pdf` / 自然语言"做成 PDF"触发，3 次产出的 manifest 结构一致（kind/renderer 相同，files 都含主文件）
- [ ] **验收 3**：Skill 噪音可控 —— 默认 `/` 菜单看不到用户全局 Skill；设置面板 toggle 打开后看到；关闭后看不到

### 6.2 各 Step 本地验收
见 §4 各 step 的"验收 fingerprint"。每个 step 提交时 PR body 必含其 fingerprint 实测输出。

### 6.3 体感测试（§10.6 复述）
- [ ] 按钮 hover ≤ 100ms 出 tooltip
- [ ] 按钮 disabled 时灰度明显（opacity 50% 或更低）
- [ ] 点按钮到右抽屉打开 ≤ 5s（agent 调用 Skill 的时间）
- [ ] 右抽屉打开后第一个 tab 自动高亮 + 抽屉内容自动滚到对应 ArtifactView
- [ ] 切换 tab ≤ 200ms，无白屏闪烁
- [ ] HTML iframe 加载时显示 loading 反馈
- [ ] 暗色主题：5 个按钮 + 抽屉 + tab + 元数据卡片无白色露馅
- [ ] Tab 焦点流：textarea → 5 个按钮 → 发送按钮 → 抽屉 tab → 关闭按钮
- [ ] Esc 关抽屉
- [ ] 全屏 / 非全屏切换流畅

### 6.4 安全审计（§10.5 复述）
- [ ] iframe sandbox = `allow-scripts`，**无** `allow-same-origin`
- [ ] iframe 内尝试 `top.document.cookie` 抛 SecurityError
- [ ] artifact id 必须是 uuid v4 格式（正则校验）
- [ ] `/api/artifacts/:id/files/:filename` 拒绝 `..` / 绝对路径 / 不在 manifest.files 里的文件名
- [ ] `~/.llm-wiki-agent/artifacts/<id>/` 路径解析后必须在 `~/.llm-wiki-agent/artifacts/` 内
- [ ] grep 全工程无 key / 真名 / 用户主目录绝对路径（沿用阶段二）
- [ ] vendor 进项目的 `.claude/skills/*/SKILL.md` 不含 anthropic 仓库的私有 commit hash / 内部 URL

### 6.5 阶段二回归
- [ ] `/sediment` 仍能结晶对话
- [ ] `/new-wiki` 仍能新建库
- [ ] `@` 引用菜单 + wiki 链接点击 + 右抽屉 wiki 页面预览
- [ ] 设置面板填 API key + 测试连接（沿用 DeepSeek 测）

---

## §7 给 codex 的交接说明

### 7.1 工作前必读
1. `CLAUDE.md`（项目规则）
2. `PRODUCT.md`（产品意图全文，**特别是 §3 架构、§4 阶段三、§5 UI、§7 ADR-16 / ADR-17**）
3. `docs/stage-2-design.md`（阶段二归档，有相似的工作流和归属原则）
4. 本文档（实施细则）

### 7.2 工作节奏（沿用阶段二验证有效的流程）
- **一次性按 §9 顺序做完 8 step**，不等逐 step 验收
- **每个 step 一个原子 commit**（共 8 个）
- **允许在 8 个 step commit 之外补充 `fix(stage-3): ...` 修复 commit**（自查或验收发现的真实 bug，每个 fix 也是原子 commit）
- commit message 格式：
  ```
  feat(stage-3-step-N): <一句话>

  - 改动 1
  - 改动 2

  本 step 验收：
  $ <command>
  <expected output>
  ```
- 8 step 全做完后提 1 个 PR（base: main, head: stage-3），PR body 必须含 §7.5 + §10.7 对账单
- 每个 step diff 控制在 300 行以内（含新增文件），超出在 commit body 说明

### 7.3 不要做的事
- ❌ 加 §3 之外的新依赖（阶段三零新依赖是设计目标；实在需要先停下报备）
- ❌ 重构阶段二已有代码（除非本文档明确写要改，如 `/api/commands` 的扩展）
- ❌ 顺手"改善"旁边的代码 / 注释 / 格式
- ❌ commit message 或代码里出现作者真实姓名，统一用 `Kiro`
- ❌ `server/src/` 或 `web/src/` 出现本机用户主目录绝对路径（用相对路径或 `homedir()`；docs/ 内允许示例）
- ❌ `--no-verify` 跳 hook、`--amend` 改前一个 commit、`-f` push
- ❌ push 到 main、合并到 main
- ❌ 修改 PRODUCT.md / CLAUDE.md（如发现这些文档有问题，在 PR body 的"本文档需要修订"清单列出）
- ❌ **新建 `/export-pdf` / `/export-docx` 等 Extension 命令**（违反 D9 + E13——anthropics 已有 Skill）

### 7.4 卡住怎么办（与一次性 8 step 工作流一致）
- 本文档未覆盖的细节歧义：先按合理推测做，commit body 标 `[judgment: ...]` 描述判断依据，claude 总验收时审
- 某 step 完成后发现下一个 step 设计有问题：先做完本 step，再用 commit body 标 `[design-issue: step N+1 描述]`
- **TBD 项**（§8）：按 §9.5 降级矩阵自动决策，触发降级在 commit body 标 `[TBD-X 降级到 方案Y: 原因]`

### 7.5 PR 交付清单（PR body 必含）
8 step 全做完提 1 个 PR 时，PR body 必含：
- 8 个 commit 的 hash + 一句话（+ 所有 fix commit）
- 每个 step fingerprint 的实测输出（可折叠 `<details>`）
- §10.7 交付物对账单（逐项打勾）
- 触发的 TBD 降级记录（哪个 TBD → 哪个方案 → 原因）
- 已知妥协 / 推迟事项
- 实施中发现的"本文档需要修订"清单

---

## §8 风险与待办（TBD）

### TBD-1：anthropics/skills 4 个 Skill 实际 size 与依赖

**影响**：Step 1 vendor 决策

**事实**：未实测 4 个 Skill 总大小。如果含大型 binary（如 LibreOffice），vendor 进 git 仓库会很大。

**调研路径**：
1. `git clone https://github.com/anthropics/skills /tmp/anthropics-skills`
2. `du -sh /tmp/anthropics-skills/{docx,pdf,pptx,xlsx}` —— 看每个 Skill 的总大小
3. 看 SKILL.md 是否声明外部 binary 依赖

**降级方案**：
- 总 size > 50MB → 不 vendor，改用 `npm run sync-skills` 脚本从 anthropics/skills 拉到 `<repo>/.claude/skills/`（gitignore 此目录）+ README 引导
- 含外部 binary 依赖（如 libreoffice、wkhtmltopdf） → 在项目 README 加"前置依赖"小节，引导用户 brew install

### TBD-2：产物存储位置

**影响**：Step 2 存储路径设计

**候选**：
- A（首选）：`~/.llm-wiki-agent/artifacts/<id>/` —— 跟应用配置同根，不污染知识库；但跨 kb 共用一处
- B：`<kbPath>/wiki/artifacts/<id>/` —— 产物归属知识库；但用户可能用 Obsidian 浏览知识库时看到一堆 uuid 目录不友好

**推荐 A**（首选）。理由：
- 产物本质是"对话工作产出"，不是知识库的一部分（结晶到 wiki/synthesis/ 才是）
- 跨知识库切换时产物可保留（user 体验更好）
- 不污染 Obsidian 视图

### TBD-3：anthropics/skills 是否能被 pi-agent loader 加载

**影响**：Step 1 + 阶段三能否跑通

**事实**：阶段二验证了 `~/.claude/skills/` 下的 Skill 能被 pi-agent 加载（用户的 baoyu-* / dbs-* 都被列出）。但 anthropics/skills 仓库的 SKILL.md 格式是否与 pi-agent 期待的一致**未验证**。

**调研路径**：
1. clone anthropics/skills 看 SKILL.md 顶部 frontmatter 字段
2. 跟 pi-agent docs/skills.md 或 SDK 源码对照
3. 实际把一个 Skill 放进 `~/.claude/skills/` 跑一次

**降级方案**：
- 如果格式不兼容：写 adapter 把 anthropics 的 SKILL.md 转成 pi-agent 格式
- 如果完全不能加载：放弃 anthropics，改用 pi-skills 或 open-design 的产出 Skill
- 阶段三启动时这是**第一个**要验证的事

### TBD-4：HTML 产物的相对路径资源

**影响**：Step 5

**问题**：HTML 产物如果含 `<img src="./img.png">`，srcDoc 模式下 iframe 没有 base URL，相对路径失效。

**候选**：
- A（首选）：v1 不支持外部资源，README 引导 Skill 产出"自包含 HTML"（图片 base64 内嵌、CSS/JS inline）
- B：用 `<base href="data:..."` 但相对路径仍无效
- C：升级到 URL-load 模式（用 `/api/artifacts/:id/files/:filename` 服务静态资源），代价是 host-iframe bridge 复杂度

**推荐 A**：v1 简单，README 说明清楚即可。如果用户的 Skill 真的产出多文件 HTML，未来阶段升级到 C。

### TBD-5：HTML 产物用哪个 Skill

**影响**：Step 3 按钮 prompt 模板

**事实**：anthropics/skills 仓库有没有专门的 HTML 产出 Skill 未确认。可能候选：
- `web-artifacts-builder`（用户机器上有，符合阶段三 §4 PRODUCT.md 提到）
- 或者就用 docx Skill 输出 HTML（不太合理）

**调研路径**：codex 实施 Step 1 时确认 anthropics/skills 仓库实际有什么 HTML 类 Skill。

**降级方案**：
- 有 HTML Skill：用它
- 无：HTML 按钮的 prompt 用 `agent 你直接生成一段 HTML 内容，调 prepare_artifact 拿 path，写到 <path>/index.html，再调 finalize_artifact` —— agent 内置能力（用 fs Skill 或类似）也能写文件，不依赖专门的 HTML Skill

### TBD-6：anthropics Skill 可能要求 API key（如 pdf Skill 调外部服务？）

**影响**：Step 1 + Step 3 验收

**事实**：未知。anthropics 的某些 Skill 可能依赖外部服务（如调 Anthropic API 把 markdown 转 PDF）。

**调研路径**：Skill 装好后试跑一次，看是否报"missing API key"。

**降级方案**：
- 报错：在文档加"前置依赖"，要求用户在设置面板配 Anthropic key
- 不报错：忽略

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
        Step 1 (vendor + loader)
              ↓
              ├─→ Step 3 (按钮 + 三通道) ─┐
              ↓                            ↓
        Step 2 (manifest + API) ──→ Step 4 (抽屉 tab) ─┐
                                                        ├─→ Step 5 (HtmlRenderer)
                                                        └─→ Step 6 (DownloadOnlyRenderer)

        Step 7 (设置 toggle，依赖 Step 1 的 source 字段) [独立可早做]

        Step 8 (总验收 + 打磨) [依赖前 7 个全完成]
```

- **强依赖**：1→{3, 4}；2→{3, 4}；4→{5, 6}；前 7 个→8
- **可并行**：Step 5 和 Step 6 完全并行；Step 7 可在 Step 1 后任意时间做

### 9.3 推荐执行顺序与 commit 编号

| Commit # | Step | 复杂度 | 说明 |
|---|---|---|---|
| C1 | Step 1（Skill vendor + loader 收紧）| 🟡 中 | 含 TBD-1 / TBD-3 调研；阻塞最多 |
| C2 | Step 2（ArtifactManifest + API + Extension）| 🟡 中 | 含 TBD-2；后端核心 |
| C3 | Step 7（设置面板 toggle）| 🟢 低 | 独立可早做，趁后端思路热 |
| C4 | Step 3（按钮区 + 三通道）| 🟢 低 | 第一个用户可见的前端改动 |
| C5 | Step 4（右抽屉 tab）| 🟡 中 | 框架，为 5/6 让路 |
| C6 | Step 5（HtmlRenderer）| 🟡 中 | 含 TBD-4 |
| C7 | Step 6（DownloadOnlyRenderer）| 🟢 低 | 跟 Step 5 并行做也行，但 commit 顺序还是分开 |
| C8 | Step 8（总验收 + 打磨）| 🟢 低 | 不新增功能 |

**顺序设计原因**：
- C1 先：解开最多依赖
- C2 后：后端核心，让前端有 API 可调
- C3（Step 7）插中间：纯后端 + 简单前端 toggle，省得最后插
- C4-C6 前端按依赖顺序
- C8 最后

### 9.4 commit 策略
- 每 step 一个原子 commit（共 8 个）
- 允许补 `fix(stage-3): ...` commit（自查或验收发现真问题）
- 全做完提 1 个 PR，PR body 含 §10.7 对账单
- 在新分支 `stage-3` 上 commit（已开好）；不要在 main 上动

### 9.5 TBD 降级矩阵（codex 自动决策表）

| TBD | 影响 Step | 先试（方案 A）| 失败降级（方案 B）| 终极兜底（方案 C）|
|---|---|---|---|---|
| TBD-1（Skill size）| 1 | vendor 4 个 Skill 直接 copy 进 `<repo>/.claude/skills/` | 写 `npm run sync-skills` 脚本 + gitignore | 文档 README 引导用户手动 clone |
| TBD-2（存储位置）| 2 | `~/.llm-wiki-agent/artifacts/<id>/` | — | — |
| TBD-3（Skill 兼容）| 1 | 直接放 `.claude/skills/`，期待 pi-agent 加载 | 写 SKILL.md adapter | 阶段三暂停，PR body 报"pi-agent 不兼容 anthropics Skill"，等作者决策 |
| TBD-4（HTML 资源）| 5 | v1 不支持外部资源，README 引导自包含 | — | — |
| TBD-5（HTML Skill）| 3 | 用 `web-artifacts-builder` Skill | 用 agent 内置 fs 能力直接写 HTML 文件 | 不做 HTML 按钮（v1 4 个按钮）|
| TBD-6（Skill API key）| 1 + 3 | 直接试跑 | 报错就在文档加"前置依赖"section | — |

**触发降级时**：codex 必须在对应 commit body 标 `[TBD-X 降级到 方案Y: 原因]`。

### 9.6 前置准备（作者在 codex 启动前完成）

- [ ] 当前分支已在 `stage-3`（claude 已切；codex 接管时 `git status` 确认）
- [ ] **Anthropic API key 可用**（设置面板已配 / 或环境变量 ANTHROPIC_API_KEY；至少有一个 provider 能跑 agent）
- [ ] 用户机器有足够磁盘空间装 anthropics/skills（预估 < 100MB，但要确认 TBD-1）
- [ ] 阶段二的 llm-wiki-skill 仍在 `~/.claude/skills/llm-wiki-skill/`（不要动）

---

## §10 总验收剧本（claude 总验收用）

### 10.1 验收顺序

1. **静态检查**：grep / typecheck / 文件结构对账（不跑应用）
2. **启动检查**：`npm run dev` 后端起、前端起、**阶段二回归**
3. **端到端剧本 A**：5 种格式产出全过（覆盖验收 1）
4. **端到端剧本 B**：三通道触发等价（覆盖验收 2）
5. **端到端剧本 C**：Skill 噪音可控 + 设置面板 toggle（覆盖验收 3）
6. **安全审计**：sandbox / 路径逃逸 / id 校验
7. **体感测试**：菜单延迟、抽屉切换、暗色
8. **对账单核对**：§10.7 逐项打勾
9. **issue 清单**：按 §10.8 格式列 → 交作者

### 10.2 端到端剧本 A：5 种格式产出（验收 1）

```bash
# 预置：已启动 app，选一个 kb，对话 5-10 轮（话题：奥派经济学的中心论点）

# Phase 1：触发 5 个按钮
# UI: 依次点 📄 PDF · 📝 Word · 📊 PPT · 📋 Excel · 🌐 HTML
# 每次点击预期：
#   1. 输入框瞬间出现 prompt 文本
#   2. 流式输出（agent 调用 prepare_artifact → Skill → finalize_artifact）
#   3. ~10s 后右抽屉自动打开 + 新 tab 高亮
#   4. SSE event artifact_created 触发（DevTools Network 看 EventSource）

# Phase 2：5 个产物验证
ARTIFACT_DIR=~/.llm-wiki-agent/artifacts
ls -d ${ARTIFACT_DIR}/*/ | wc -l  # 应至少 5（可能更多，历史累积）

# 找到本次 5 个 artifact
ls -dt ${ARTIFACT_DIR}/*/ | head -5  # 按 mtime 倒序最新 5 个

for D in $(ls -dt ${ARTIFACT_DIR}/*/ | head -5); do
  echo "=== $D ==="
  cat "$D/manifest.json" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'  kind={d[\"kind\"]} renderer={d[\"renderer\"]} primaryFile={d[\"primaryFile\"]} size={d[\"metadata\"][\"sizeBytes\"]}')"
  ls "$D"
done
# 期望：5 个 manifest，kind 分别是 pdf/docx/pptx/xlsx/html

# Phase 3：右抽屉 tab 验证
# UI: 右抽屉 tab 条有 5 个 tab，最新（HTML）高亮
# 切换每个 tab：
#   - HTML tab → iframe 渲染（可见内容）
#   - PDF/Word/PPT/Excel tab → 元数据卡片 + 下载按钮

# Phase 4：下载验证
# UI: 切到 PDF tab，点"📥 下载"
ls ~/Downloads/*.pdf | tail -1  # 应有新文件

# Mac 下打开下载的文件：
# - PDF：Preview 能开
# - docx：Word 能开（如已装）
# - pptx：Keynote 能开
# - xlsx：Numbers 能开

# Phase 5：HTML 渲染深度检查
# UI: 切回 HTML tab，DevTools Elements 检查 iframe：
#   - sandbox="allow-scripts" 
#   - 没有 allow-same-origin
#   - srcDoc 含完整 HTML 内容
# 在 iframe DevTools console 跑：top.document.title
# 期望：抛 SecurityError（沙箱隔离生效）
```

### 10.3 端到端剧本 B：三通道触发等价（验收 2）

```bash
# 同一对话内，分别用三通道触发 PDF 产出

# 通道 A：点 📄 PDF 按钮
# → 等产出完成，记录 artifact id（看 manifest.json）
ID_A=...

# 通道 B：输入框输 /pdf → 选中 → 发送
# → 等产出，记录 id
ID_B=...

# 通道 C：自然语言"请把这次讨论做成 PDF"
# → 等产出，记录 id
ID_C=...

# 验证三个 manifest 结构一致
for ID in $ID_A $ID_B $ID_C; do
  jq '{kind, renderer, primaryFile: .primaryFile, fileCount: (.files | length)}' ~/.llm-wiki-agent/artifacts/$ID/manifest.json
done

# 期望：三个输出
# {
#   "kind": "pdf",
#   "renderer": "download-only",
#   "primaryFile": "<some>.pdf",
#   "fileCount": 1
# }
# （三次完全一样，证明三通道后端走同一路径）
```

### 10.4 端到端剧本 C：Skill 噪音可控（验收 3）

```bash
# Phase 1：默认状态
# UI: 进入对话 → 输 /
# 期望：菜单分组
#   📦 内置：sediment_to_wiki, new_wiki
#   🎨 产出：pdf, docx, pptx, xlsx, html（项目级）
#   🛠 pi 默认：（用户 ~/.pi/agent/skills/ 下的，brainstorming/dbs/etc.）
#   🌍 用户全局：[空 / 不显示]

# API 验证
curl -s 'http://localhost:8787/api/commands' | jq '[.items[] | .source] | group_by(.) | map({source: .[0], count: length})'
# 期望：no source=="user-global" entry

# Phase 2：打开 toggle
# UI: ⚙ 设置 → Skill 加载 section → 打开"展示用户全局 Skill" toggle

# 立即 / 菜单刷新
# 期望：多出"🌍 用户全局"分组，含 30+ Skill（用户机器实际数）

# API 验证
curl -s 'http://localhost:8787/api/commands' | jq '[.items[] | .source] | group_by(.) | map({source: .[0], count: length})'
# 期望：含 source=="user-global", count > 0

# Phase 3：持久化验证
cat ~/.llm-wiki-agent/config.json | jq '.showUserGlobalSkills'
# 期望：true

# 重启后端 → 重新 GET /api/commands
# 期望：仍含 user-global

# Phase 4：关闭 toggle → 立即缩回
```

### 10.5 阶段二回归（防止破坏既有功能）

```bash
# A. 启动
npm run dev  # 应一行起前后端，无 error

# B. 阶段二验收 1：新建库
# UI: 侧栏 + 新建知识库 → 输 stage3-regression + 方向"测试阶段三是否破坏阶段二"
ls ~/llm-wiki/stage3-regression/  # 应有 wiki/ raw/ purpose.md

# C. 阶段二验收 2：消化→讨论→结晶
# 粘 URL → chip 亮 → 发送
# 看 raw/ 出新文件
# 讨论 → /sediment → 看 wiki/synthesis/sessions/

# D. 阶段二验收 3：API key
# 设置面板 → DeepSeek（或 Anthropic）→ 保存并测试 → 绿色提示
cat ~/.pi/agent/auth.json | jq 'keys'  # 应含已配 provider

# E. @ 引用 + 右抽屉 wiki 页面预览
# 输 @ → 弹菜单 → 选 → [[wiki/...]] 插入
# 发送让 agent 回引用 → 点链接 → 抽屉打开

# F. 全部 pass 才算阶段二未破坏
```

### 10.6 安全审计 checklist

> ⚠️ 本 checklist 只扫 `server/src/`、`web/src/`，不扫 `docs/` 避免本文档自身的占位/示例文本被自报警。

- [ ] `grep -rE "sk-[a-zA-Z0-9_-]{20,}" ~/.llm-wiki-agent/` 无输出
- [ ] `grep -rE "sk-[a-zA-Z0-9_-]{20,}" server/src/ web/src/` 无输出
- [ ] `~/.pi/agent/auth.json` 权限 `-rw-------`
- [ ] iframe sandbox attr 检查（DevTools）：`allow-scripts` 无 `allow-same-origin`
- [ ] iframe 内执行 `top.document.cookie` 抛 SecurityError
- [ ] `curl 'http://localhost:8787/api/artifacts/not-uuid'` → 400
- [ ] `curl 'http://localhost:8787/api/artifacts/<valid-uuid>/files/../../../etc/passwd'` → 400
- [ ] `curl 'http://localhost:8787/api/artifacts/<valid-uuid>/files/not-in-manifest.txt'` → 404 或 400
- [ ] React DevTools 看 SettingsPanel：保存后 state 不含 key 明文（沿用阶段二）
- [ ] commit log + `server/src/` + `web/src/` 不含本机用户主目录绝对路径
- [ ] commit log 不含真实姓名（应统一 `Kiro`）
- [ ] `.claude/skills/` 下 4 个 vendor Skill 不含可执行 binary（如果含，README 必须明示）

### 10.7 交付物对账单

**新文件**：
- [ ] `<repo>/.claude/skills/docx/SKILL.md` + scripts
- [ ] `<repo>/.claude/skills/pdf/SKILL.md` + scripts
- [ ] `<repo>/.claude/skills/pptx/SKILL.md` + scripts
- [ ] `<repo>/.claude/skills/xlsx/SKILL.md` + scripts
- [ ] `<repo>/.claude/skills/README.md`（vendor 来源说明 + sync 命令）
- [ ] `server/src/artifacts.ts`
- [ ] `server/src/extensions/artifacts.ts`
- [ ] `web/src/components/ExportButtons.tsx`
- [ ] `web/src/components/ArtifactView.tsx`
- [ ] `web/src/components/renderers/HtmlRenderer.tsx`
- [ ] `web/src/components/renderers/DownloadOnlyRenderer.tsx`

**修改文件**：
- [ ] `server/src/agent.ts`（Skill loader 加 source 标签 + 注册 artifacts Extension）
- [ ] `server/src/index.ts`（5 个新路由 + `/api/commands` 加参数 + SSE artifact_created event）
- [ ] `server/src/config.ts`（AppConfig 加 `showUserGlobalSkills`）
- [ ] `web/src/App.tsx`（drawerMode + activeArtifactId 状态）
- [ ] `web/src/components/RightDrawer.tsx`（多 tab 支持）
- [ ] `web/src/components/ChatPanel.tsx`（按钮区 + SSE artifact_created 处理）
- [ ] `web/src/components/SettingsPanel.tsx`（Skill 加载 toggle）
- [ ] `web/src/lib/api.ts`（新 API client）

**新增 API**（curl 应全部 200 或预期错误码）：
- [ ] `GET /api/commands?includeUserGlobal=true` 返回 source 字段
- [ ] `GET /api/artifacts?conversation=<id>`
- [ ] `GET /api/artifacts/:id`
- [ ] `GET /api/artifacts/:id/files/:filename`
- [ ] `GET /api/config`
- [ ] `POST /api/config`

**新增 Extension 工具**（agent 应能调用）：
- [ ] `prepare_artifact`
- [ ] `finalize_artifact`

**新增 SSE 事件**：
- [ ] `artifact_created`

**新增前端依赖**：**预期 0 个**（如果实际有，PR body 必须说明原因并补 ADR）

**Commit 数量**：8 个核心 + 0-N 个 fix（顺序见 §9.3）

### 10.8 issue 清单格式（策略 B：claude 列 → 作者决策 → 谁修）

沿用阶段二 §10.8 格式：

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
- [ ] codex 修（实现质量问题）
- [ ] claude 修（设计文档没写清楚，由 claude 改文档 + 改实现）
- [ ] 作者决策（不确定归属）

**修复路径草案**：
<可选，给一个修法思路>
```

全部 issue 列完后给作者总览表：

```
| # | 严重度 | step | 一句话 | 建议归属 |
|---|---|---|---|---|
| ... |
```

作者按归属批准 → claude/codex 分别修 → claude 再验收一轮 → 直到全绿。

---

## §11 文档维护

- **本文档 = 阶段三实施计划**。实施过程偏离时在本文档加"实施记录"块说明
- **阶段三验收通过后**：
  - PRODUCT.md §10 阶段三章节填具体 commit hash + 完成情况 + 接受的妥协
  - PRODUCT.md §3.2 如有新依赖加行（预期 0 个）
  - PRODUCT.md 如需新增 ADR-18+（如有未预见的架构决策）
  - 本文档标 `✅ 已完成 <日期>`，不再修改（归档）
- **阶段四启动**：新建 `docs/stage-4-design.md`，本文档作为参考样本
