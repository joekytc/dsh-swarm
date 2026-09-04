# 当前知识库自动检索增强设计

> 状态：**已完成** · 实施于 2026-05-28 · 对应 ADR-19 · 阶段 3.5 收尾补强
>
> 本文档是 codex 实施手册。先读 §0 决策摘要，再按 §9 顺序动手。
> 任何与 [PRODUCT.md](../PRODUCT.md) 冲突的描述以 PRODUCT.md 为准；本文档需要破例的地方在 §12 明确写出并对应到 ADR-19。

## 0. 决策摘要（codex 起手必读）

| 决策 | 选择 | 理由速记 |
|---|---|---|
| 架构路线 | **双轨**：新工具 `query_knowledge_base` + `/api/prompt` 预调用同一份代码 | 工具路径符合 ADR-7；预调用兜底弱模型不调工具的情况 |
| 触发策略 | **黑名单**：默认触发，特定场景跳过 | 漏触发的代价是当前 bug；误触发的代价只是浪费 token |
| 多轮检索 | **每轮 user turn 都判断 + 检索** | 用户切话题时能立刻拿到新页面，本地 grep 成本可接受 |
| 失败降级 | **静默降级裸 prompt + SSE error 事件 + 日志** | 用户体验不中断，问题可溯源 |
| 检索 cache | **复用 [pages.ts](../server/src/pages.ts) 的 `getCachedPages`** | 避免两套 cache 失效时机错位 |
| `@` 格式契约 | **解析消息中的 `[[wiki/...]]`**（前端 [ChatPanel.tsx:218-230](../web/src/components/ChatPanel.tsx) 已插入此格式） | 不发明新语法 |
| 上下文上限 | **按 main 模型 contextWindow 的 20% 动态算**；模型未知时 fallback 4000 字符 | 兼顾 glm（4k 级）与 Claude（200k 级） |
| 验收硬标志 | **日志 + 字符串命中**双重客观可查 | 防止"看起来对实际没注入"的 hallucination 蒙混过关 |

## 1. 问题

阶段 3.5 已实现非 wiki 目录初始化 + 批量消化，但用户进入新知识库直接问"这是我自媒体创作的文章，总结一下"，主模型反问用户提供文章内容。

已确认事实：

- 批量消化结果已写入 `wiki/synthesis/sessions/`
- `/api/refs` 能列出这些新页面（[pages.ts](../server/src/pages.ts) PAGE_DIRS 含 `synthesis`）
- 失败对话的会话日志显示模型未调用任何 KB 工具
- `/api/prompt`（[index.ts:745-832](../server/src/index.ts)）当前是裸 `session.prompt(message)`，无任何检索 / 注入
- 现有 Extension 工具 `current_knowledge_base` / `list_knowledge_base_pages`（[extensions/knowledge-base.ts](../server/src/extensions/knowledge-base.ts)）描述写得够强，但 agent 实际不调

**根因**：主对话缺少一层"系统兜底检索"。ADR-7 设计的"靠 Extension 工具让 agent 自觉调用"在弱模型场景下不可靠。

## 2. 设计目标

- 用户在当前库提问，系统默认把当前库作为上下文来源
- `@` 显式引用优先级高于自动检索
- 回答末尾列参考页面；空库 / 无命中时明确说明
- 不把整个库塞进每次对话；不引入新依赖
- 不改变 `@` 引用 / `/` 命令 / 子代理批量消化的现有心智

## 3. 核心思路：双轨

```text
用户提问
  ↓
后端解析消息中的 [[wiki/...]] → 显式引用列表 R_explicit
  ↓
shouldUseKnowledgeBase(message) 判断是否触发自动检索（黑名单）
  ↓
若触发 → 调用同一份 searchKnowledgeBase(kbPath, query, R_explicit)
  ↓
拼成隐藏上下文 + 原始消息 → session.prompt(wrapped)
  ↓
模型输出（包含末尾"参考页面"）
```

同一份 `searchKnowledgeBase` 同时暴露为：

- **新工具** `query_knowledge_base(query)`：让强模型 / 未来强 agent 显式调用，符合 ADR-7
- **后端预调用**：`/api/prompt` 在判断需要时主动调，兜底弱模型不调工具的失败模式

这条路径只覆盖**主对话**。子代理批量消化（[digest/batch.ts](../server/src/digest/)）走的是裸 prompt + only read tool，本设计不涉及它。

## 4. 不采用的方案

### 4.1 纯改 prompt / 加强 system prompt

不稳定。同一模型不同问法、不同 provider 表现差异巨大。

### 4.2 每次塞整库

KB 大了就慢、贵、乱，污染普通聊天。

### 4.3 把批量消化结果写进聊天历史

消化结果属于知识库，不属于某一次对话。塞进历史会让切会话 / 切库 / 长期使用语义错乱。

### 4.4 立即引入向量库

本地文本检索足够覆盖当前阶段。未来 KB 规模 > 100 篇再升级。

### 4.5 纯工具路径（无后端预调用）

ADR-7 的精神路线，但已被你这次"反问要文章"的对话验证为不稳。本设计保留工具（双轨的一条腿），但不依赖它。

## 5. 解法方案

### 5.1 检索函数 `searchKnowledgeBase`

签名（伪代码，仅说明契约）：

```text
searchKnowledgeBase(kbPath, query, options) → SearchResult[]
  options:
    explicitRefs: string[]        // 来自 parseExplicitPageRefs，必含
    maxPages: number              // 默认 6
    snippetMaxChars: number       // 默认 600
    totalBudgetChars: number      // 由 /api/prompt 按模型 contextWindow 算后传入
  SearchResult:
    path: string                  // 相对 KB 根，如 wiki/synthesis/sessions/xxx.md
    title: string
    snippet: string
    mtime: number
    hitReason: 'explicit' | 'title' | 'filename' | 'body' | 'recent_synthesis' | 'kb_meta'
    score: number
```

**实现要点**：

1. **复用 [pages.ts](../server/src/pages.ts)**：调 `getCachedPages(kbPath)` 拿候选，不另建 cache。score 函数在 pages.ts 现有 title 2 / name 1 / path 0.5 基础上扩展（见下）。
2. **检索范围**：
   - `wiki/` 下所有 markdown（已被 pages.ts 覆盖）
   - 额外加 KB 元信息文件：`purpose.md` / `index.md` / `overview.md`（如果存在）—— 这些是"总结这个库"类问题的最强答案源
   - 现阶段**不读** `raw/` 下的原始素材（批量消化后用户应基于消化页问答）
3. **排序规则**（高到低）：
   - hitReason='explicit'（来自 `[[wiki/...]]` 显式引用，固定排首位）
   - hitReason='title'（标题命中）
   - hitReason='kb_meta'（purpose/index/overview 在泛化问题下加权）
   - hitReason='recent_synthesis'（`wiki/synthesis/sessions/` 在"这些文章 / 刚刚消化 / 总结"类问题下加权，按 mtime 降序）
   - hitReason='filename'
   - hitReason='body'
4. **片段提取**：命中 body 时，从命中位置前后各取 ~300 字符；标题/文件名命中时取页面开头 ~600 字符
5. **总预算控制**：累加每个 snippet 字符数，达到 `totalBudgetChars` 立即停止；至少保证 explicitRefs 全部入选（哪怕超 budget 也强保留显式引用的截断版本）
6. **空 KB 返回 `[]`，不抛错**
7. **cache 隔离**：pages.ts 的 cache 按 kbPath 隔离，retrieval 直接复用，无需自己维护

### 5.2 `parseExplicitPageRefs`

签名：

```text
parseExplicitPageRefs(message) → string[]   // 相对路径数组，如 ['wiki/synthesis/sessions/x.md']
```

**实现要点**：

- 正则匹配 `\[\[(wiki\/[^\]\n]+\.md)\]\]`
- 去重，保持出现顺序
- 不验证文件是否存在（验证交给 searchKnowledgeBase）

### 5.3 `shouldUseKnowledgeBase`（黑名单策略）

签名：

```text
shouldUseKnowledgeBase(message, kbSelected) → boolean
```

**实现要点**（按顺序判断，命中即返回）：

1. 没选中 KB → `false`
2. 消息 trim 后以 `/` 开头（命令）→ `false`
3. 消息已含 `[[wiki/...]]`（显式引用）→ `true`（短路，必须检索）
4. 消息 trim 后字符数 < 3 → `false`
5. 命中**寒暄白名单**（精确匹配，忽略标点）→ `false`
   - 集合：`你好` / `hi` / `hello` / `在吗` / `谢谢` / `thanks` / `thx` / `ok` / `好的`
6. 命中**元问询白名单**（含其一即跳过）→ `false`
   - 关键词：`当前模型` / `模型是什么` / `怎么设置` / `怎么用` / `界面` / `快捷键` / `登录` / `API key`
7. 其余 → `true`（默认触发）

**关键**：本策略激进地默认触发。误触发的代价只是 token，漏触发的代价是当前观察到的 bug。

### 5.4 `buildKnowledgeContextPrompt`

签名：

```text
buildKnowledgeContextPrompt(originalMessage, kb, results) → wrappedMessage
```

**输出格式**（results 非空时）：

```text
{用户原始消息原样保留在最前}

---
[系统检索上下文 / 用户不可见]

当前知识库：
- 名称: {kb.name}
- 路径: {kb.path}

系统已从当前知识库检索到以下页面（按相关度排序）：

[1] {results[0].title}
    路径: {results[0].path}
    {results[0].snippet}

[2] ...

回答约束：
- 必须基于以上页面内容回答；不得编造未在页面中出现的事实
- 如果以上页面不足以回答，明确说明"当前知识库未找到相关内容"，禁止反问用户提供文章
- 回答末尾必须列出"参考页面"，格式为 `- 《标题》：路径`
- 参考页面只能从上述检索结果中选取，禁止编造路径
```

**results 为空时**：仍包装一段简短上下文：

```text
{用户原始消息}

---
[系统检索上下文]

当前知识库：{kb.name}
系统已尝试检索，但未在当前知识库找到与该问题相关的页面。
请明确告诉用户"当前知识库未找到相关内容"，禁止反问用户提供文章，也禁止编造来源。
```

**关键**：空结果也包装，因为弱模型一旦完全没拿到上下文就会回到"反问要文章"的失败模式。强制告诉它"找过了，没有"。

### 5.5 主对话 `/api/prompt` 改造

[index.ts:745-832](../server/src/index.ts) 当前逻辑：

```text
session.prompt(message)
```

改造后：

```text
1. 解析: explicitRefs = parseExplicitPageRefs(message)
2. 判断: shouldUse = shouldUseKnowledgeBase(message, kbSelected)
3. 若 !shouldUse → 直接 session.prompt(message)（与今日行为一致）
4. 若 shouldUse:
   a. 算 totalBudgetChars = floor(activeModel.contextWindow * 0.2) || 4000
   b. SSE 推送 knowledge_search_start
   c. try {
        results = searchKnowledgeBase(kbPath, message, { explicitRefs, totalBudgetChars })
        wrapped = buildKnowledgeContextPrompt(message, kb, results)
        SSE 推送 knowledge_search_done { count: results.length, paths: results.map(r => r.path) }
        写日志（见 §5.7）
        session.prompt(wrapped)
      } catch (err) {
        SSE 推送 knowledge_search_error { message: err.message }
        写日志
        session.prompt(message)   // 静默降级
      }
```

**每轮 user turn 独立判断 + 检索**。不缓存判断结果。

### 5.6 失败降级

任何一环抛异常（IO 失败、parseExplicitPageRefs throw、buildKnowledgeContextPrompt 字符数爆掉）：

- 不中断 prompt
- 降级为裸 `session.prompt(message)`
- SSE 推 `knowledge_search_error` 事件，前端在状态栏轻量显示"知识库检索失败，已按普通对话处理"
- 日志（见 §5.7）写完整 error stack

### 5.7 检索日志

写入 `~/.llm-wiki-agent/logs/retrieval/<YYYY-MM-DD>.jsonl`，每行：

```json
{
  "ts": 1735000000000,
  "sessionId": "abc12345",
  "kbPath": "~/my-kb",
  "messagePreview": "这是我自媒体创作的文章...",
  "triggered": true,
  "explicitRefs": [],
  "results": [{"path": "wiki/synthesis/sessions/x.md", "hitReason": "recent_synthesis", "score": 3.2}],
  "wrappedCharCount": 4823,
  "error": null
}
```

**作用**：验收脚本、用户反馈复现、长期效果分析都依赖这份日志。

### 5.8 新工具 `query_knowledge_base`

在 [extensions/knowledge-base.ts](../server/src/extensions/knowledge-base.ts) 注册第三个工具：

```text
pi.registerTool({
  name: 'query_knowledge_base',
  parameters: { query: string },
  execute: ({ query }) => {
    results = searchKnowledgeBase(currentKbPath, query, { explicitRefs: [], totalBudgetChars: 4000 })
    return formatted text for agent
  }
})
```

**作用**：让强模型在主对话流中也能继续追问 KB；未来若改为"工具优先 + 注入降级"也只是改 `/api/prompt` 的判断条件，retrieval 函数不动。

工具描述要点："Search the user's current knowledge base for pages relevant to a query. Use this when the user asks a follow-up question that may require pulling additional context from the knowledge base beyond what's already in the conversation."

### 5.9 前端反馈

复用现有 tool 状态显示样式。新增三个 SSE 事件渲染：

- `knowledge_search_start` → 显示"正在检索当前知识库…"
- `knowledge_search_done { count, paths }` → 显示"已检索到 N 个相关页面"
- `knowledge_search_empty`（count=0 时）→ 显示"当前知识库未找到相关内容"
- `knowledge_search_error` → 显示"知识库检索失败，已按普通对话处理"

不新增大面板。

## 6. API 与模块边界

### 6.1 新增文件

- `server/src/retrieval.ts`：导出 `searchKnowledgeBase` / `parseExplicitPageRefs` / `shouldUseKnowledgeBase` / `buildKnowledgeContextPrompt`
- 单测 `server/src/retrieval.test.ts`：触发策略、`[[...]]` 解析、空 KB、cache 隔离、budget 控制

### 6.2 复用与改动

- **复用** [pages.ts](../server/src/pages.ts) 的 `getCachedPages` —— retrieval 在其上加片段提取与扩展 score
- **改动** [index.ts](../server/src/index.ts) 的 `/api/prompt`：按 §5.5 改造，新增 SSE 事件类型
- **改动** [extensions/knowledge-base.ts](../server/src/extensions/knowledge-base.ts)：新增 `query_knowledge_base` 工具
- **不动**：digest/ 目录全部（子代理批量消化不受影响）

### 6.3 不新增对外 HTTP API

第一版只在 `/api/prompt` 内部使用。

## 7. 验收标准

### 7.1 客观可查标志（**所有验收的硬底线**）

每条主对话验收必须同时满足：

1. **日志可查**：`~/.llm-wiki-agent/logs/retrieval/*.jsonl` 中存在对应记录，`triggered` / `results` / `wrappedCharCount` 字段符合预期
2. **字符串命中**：模型回答中至少出现一次检索结果的页面标题或独特短语（grep 可验）

无法同时通过这两条的验收一律不算过。

### 7.2 检索函数 `searchKnowledgeBase`

1. 对"总结这些文章"类问题，能命中 `wiki/synthesis/sessions/` 下最新页面
2. 对具体关键词（如 `OpenClaw`），能命中标题或正文相关页面
3. 返回结果含 path / title / snippet / mtime / hitReason / score
4. 默认 maxPages=6，可配置
5. 单页 snippet 不超过 snippetMaxChars
6. 总字符数不超过 totalBudgetChars
7. explicitRefs 即使超 budget 也强保留（可截断片段）
8. 空 KB 返回 `[]`，不抛错
9. 同一 query 在 cache 未失效时多次调用，结果一致
10. 批量消化新文件后，调用 pages.ts cache 失效路径，下一次检索能拿到新页

### 7.3 `parseExplicitPageRefs`

1. `这是什么 [[wiki/synthesis/sessions/x.md]]` → `['wiki/synthesis/sessions/x.md']`
2. `[[wiki/a.md]] 和 [[wiki/b.md]]` → `['wiki/a.md', 'wiki/b.md']`
3. `[[wiki/a.md]] [[wiki/a.md]]` → `['wiki/a.md']`（去重）
4. `普通文本无引用` → `[]`
5. `[[notwiki.md]]` → `[]`（必须以 wiki/ 开头）

### 7.4 `shouldUseKnowledgeBase`（黑名单）

1. 未选 KB → false
2. `/sediment` / `/pdf` → false
3. `你好` / `谢谢` / `ok` → false
4. `当前模型是什么` → false
5. `[[wiki/x.md]] 说了啥` → true（含显式引用，短路）
6. `总结一下` → true
7. `这是我自媒体创作的文章，总结一下` → true（本 bug 的原始 case）
8. `OpenClaw 相关页面讲了什么` → true
9. 长度 < 3 → false（如 `嗯`）

### 7.5 `/api/prompt` 端到端

1. 触发路径：SSE 顺序为 `knowledge_search_start → knowledge_search_done → text_delta* → done`
2. 不触发路径：SSE 不出现任何 knowledge_search_* 事件
3. 触发但检索抛错：SSE 出现 `knowledge_search_error`，但 `text_delta` 仍正常流出（裸 prompt 降级）
4. 注入字符数符合模型 contextWindow * 20% 上限
5. 模型回答末尾出现"参考页面"列表，所有路径都在 `results.paths` 中（禁止幻觉路径）
6. 多轮：第 1 轮触发后第 2 轮再问新话题，第 2 轮独立判断 + 独立检索

### 7.6 `@` 显式引用

1. `@A` 选中后输入框变成 `[[wiki/.../A.md]]`，发送后 A 在 results 首位（hitReason='explicit'）
2. `[[wiki/.../A.md]] [[wiki/.../B.md]] 对比` → results 前两个是 A 和 B
3. `[[wiki/.../A.md]] 再结合全库看看` → results[0]=A，后续是自动检索补充
4. `[[wiki/不存在.md]] 说了啥` → results 中无该路径，buildKnowledgeContextPrompt 在末尾加一行"用户引用了 wiki/不存在.md，但该页面不存在"

### 7.7 切库隔离

1. A 库批量消化后，问"总结" → results 全部属于 A 库
2. 切到 B 库（B 库为空）→ 问"总结" → results 为空 / 模型说"未找到"
3. 切回 A 库 → 问"总结" → 仍能命中 A 库的页面

### 7.8 失败降级

1. mock fs read 失败 → SSE 推 error 事件、回答仍能流式输出、日志写 error stack
2. 注入字符数超 contextWindow → 自动截断到 budget 内，不抛错
3. shouldUseKnowledgeBase 抛错（不应发生，但兜底）→ 走裸 prompt

## 8. 端到端验收剧本

### 场景 1：批量消化后总结（本 bug 原始 case）

1. 选择普通目录 → 初始化为 KB → 批量消化 7 篇文章
2. 进入该 KB
3. 问："这是我自媒体创作的文章，总结一下。"

**必须结果**：
- 不反问用户要文章
- 回答覆盖多篇文章主题
- 末尾"参考页面"列出 ≥ 3 篇 sessions/ 下的页面
- 日志 jsonl 中 `triggered=true`、`results.length ≥ 3`
- 模型回答中 grep 到至少 1 个 results.paths 中页面的标题

### 场景 2：具体主题检索

1. 同一库问："OpenClaw 相关的文章讲了什么？"

**必须结果**：
- results 中至少 1 篇含 `OpenClaw`
- 回答基于这些页面，无幻觉

### 场景 3：切库隔离

1. 切到另一个 KB（已知不含相关内容）
2. 问："这些文章总结一下。"

**必须结果**：
- results 为空 or 全部属于新 KB
- 模型明确说"当前知识库未找到相关内容"
- 不出现上一 KB 的页面路径

### 场景 4：`@` 显式引用

1. 输入 `@某篇文章 总结它的传播亮点`（前端会替换为 `[[wiki/.../某篇.md]] 总结它的传播亮点`）

**必须结果**：
- results[0] 是该指定页面
- 自动检索补充 ≤ 3 篇
- 回答主要基于指定页面

### 场景 5：普通聊天不检索

1. 问："你好。"
2. 问："当前模型是什么？"
3. 输入 `/sediment`

**必须结果**：
- 三次都不触发 knowledge_search_* 事件
- 日志 jsonl 中 `triggered=false`

### 场景 6：多轮切话题

1. 第 1 轮："总结一下这批文章"
2. 第 2 轮（在同一对话）："其中讲 AI 的那篇具体说了什么？"

**必须结果**：
- 两轮独立检索，各自有日志记录
- 第 2 轮 results 与第 1 轮不必相同（query 变了）

### 场景 7：失败降级

1. 用 `chmod 000` 临时让 KB 某文件不可读
2. 问："总结一下"

**必须结果**：
- SSE 出现 `knowledge_search_error`
- 但 `text_delta` 仍正常输出
- 日志 jsonl 中 `error` 字段非空
- 前端状态栏短暂显示"知识库检索失败，已按普通对话处理"

## 9. 实施顺序（codex 起手必读）

| 步骤 | 任务 | 验收 |
|---|---|---|
| 1 | 新建 `server/src/retrieval.ts` + 单测；实现 `parseExplicitPageRefs` / `shouldUseKnowledgeBase` | §7.3 §7.4 全过 |
| 2 | 在 retrieval.ts 实现 `searchKnowledgeBase`（复用 pages.ts `getCachedPages`） | §7.2 全过 |
| 3 | 实现 `buildKnowledgeContextPrompt` + 日志写入 | 单测覆盖空 results / 含 explicit / 含 error 三种形态 |
| 4 | 改造 [index.ts](../server/src/index.ts) `/api/prompt`：增加判断 + 调用 + SSE 新事件 + 失败降级 | §7.5 §7.8 全过 |
| 5 | 在 [extensions/knowledge-base.ts](../server/src/extensions/knowledge-base.ts) 注册 `query_knowledge_base` 工具 | 单测：工具签名正确、execute 返回格式符合 §5.8 |
| 6 | 前端新增 3 个 SSE 事件渲染（knowledge_search_start/done/error） | 手动验：剧本 1 能看到检索状态 |
| 7 | 跑完 §8 全部 7 个端到端剧本 | 所有剧本通过 §7.1 双重客观标志 |

每步动手前先在对话里说"准备改 X，影响 Y"，作者确认后再动。

## 10. 风险与边界

### 10.1 模型不读注入内容

弱模型（glm 等）可能拿到注入仍反问。
- 缓解：§5.4 wrappedMessage 末尾加强约束句（"如未基于以下页面回答而再次反问用户提供文章，视为错误"）
- 监控：日志可统计"注入了但模型反问"的发生率

### 10.2 cache 失效窗口

批量消化刚跑完、pages.ts cache 还指向旧 fingerprint。
- 缓解：pages.ts 已用 mtime+size fingerprint，每次 retrieval 都会触发重新扫描
- 验收：场景 1 必须在批量消化结束后立即问（不等手动刷新）

### 10.3 切库 cache 串库

pages.ts cache 按 kbPath 隔离，retrieval 复用，不会串库。
- 验收：场景 3 必须通过

### 10.4 检索误触发

黑名单策略激进。
- 缓解：寒暄白名单 + 元问询白名单 + `/` 命令短路 + 长度 < 3 短路
- 监控：日志可统计触发率，过高时回头收紧

### 10.5 来源不真实

模型可能编造路径作为来源。
- 缓解：§5.4 prompt 中强约束"参考页面只能从上述检索结果中选取"
- 验收：§7.5.5 grep 检验回答中所有路径都在 results.paths 中

### 10.6 与 `@` 心智冲突

用户老心智："想引用必须 @"。新行为："不 @ 系统也可能引用"。
- 缓解：§5.9 前端轻量状态显示让用户知道何时检索了
- 长期：如果用户反馈混乱，提供"关闭自动检索"开关（本轮不做）

### 10.7 中文路径 / emoji

PRODUCT.md §6.6 UTF-8 铁律。
- retrieval 所有字符串处理用 raw UTF-8，不 normalize
- cache key 用原始 absolute path

### 10.8 多轮成本

每轮都检索 = 每轮多 100-300ms IO。
- 本地 grep + cache 命中下可接受
- 监控：日志记 retrieval 耗时，> 1s 时考虑优化

## 11. 本轮不做

- 不引入向量数据库
- 不引入新 npm 包
- 不做复杂搜索 UI
- 不把整个知识库塞进每次 prompt
- 不把批量消化结果写进聊天历史
- 不改变 `@` / `/` / 子代理批量消化的现有心智
- 不动 digest/ 目录任何代码
- 不做"关闭自动检索"开关（等用户反馈再说）

## 12. ADR 影响

本设计**正面破例** [PRODUCT.md ADR-7](../PRODUCT.md)（"知识库上下文用 Extension 注入，不拼 prompt"）。需要在 PRODUCT.md 第 7 节追加：

### ADR-19：主对话引入"系统检索 + 上下文注入"

**背景**：ADR-7 设计的"靠 Extension 工具让 agent 自觉调用"在阶段 3.5 批量消化后的真实场景下不稳——弱模型不调 `list_knowledge_base_pages` / `read`，直接反问用户提供文章。

**决策**：

1. 主对话 `/api/prompt` 路径破例采用"后端检索 + 拼隐藏上下文"模式
2. ADR-7 的"应用状态用 Extension 注入"原则在 `currentKnowledgeBase` 等状态查询上仍然成立，本破例只针对"问答类知识库检索"
3. 同一份 `searchKnowledgeBase` 同时暴露为新工具 `query_knowledge_base`，保留 ADR-7 路径供未来强模型使用
4. 子代理批量消化（digest/ 目录）不受影响，继续走裸 prompt + only read tool
5. 主对话流式输出过程中，每个 user turn 独立判断 + 独立检索，不跨轮缓存
6. 失败降级为裸 prompt，SSE 推 error 事件 + 写日志，绝不中断对话

**与既有 ADR 的关系**：

- 破例 **ADR-7**：仅限主对话问答检索，状态查询工具保留
- 兼容 **ADR-3**（SSE）：新增 3 个轻量事件类型
- 兼容 **ADR-16**（Skill 优先 / agent 元能力用 Extension）：检索是 agent 工作台元能力，落 server/ 端合理
- 兼容 **ADR-18**（子代理路径）：不影响 digest/ 目录

**何时重新评估**：

- 主流模型工具调用稳定性显著提升 → 考虑改回纯工具路径
- 用户大量反馈"参考页面被编造" → 强化 prompt 约束 + 引入后置校验
- KB 规模 > 100 篇时检索耗时不可接受 → 引入向量检索

## 13. 完成情况

本设计已在阶段 3.5 收尾中落地。

- `/api/prompt` 已接入当前知识库自动检索；每轮用户消息独立判断，触发时推送 `knowledge_search_start` / `knowledge_search_done` / `knowledge_search_empty` / `knowledge_search_error`
- `query_knowledge_base` 工具已注册，和主对话预检索共用同一套检索函数
- 检索结果复用 `pages.ts` 的缓存与扫描路径，覆盖 `wiki/synthesis/sessions/`、`purpose.md`、`index.md`、`wiki/overview.md`
- `[[wiki/...]]` 显式引用会优先进入结果；缺失页面会进入包装提示，不静默吞掉
- 检索日志写入 `~/.llm-wiki-agent/logs/retrieval/<YYYY-MM-DD>.jsonl`
- 普通寒暄、`/` 命令、模型/设置类问题、导出产物指令不会触发知识库检索

**验收实况**：

- `node --import tsx --test server/src/retrieval.test.ts server/src/digest/concurrency.test.ts` 通过
- `npm run --silent typecheck` 通过
- 真实接口验证通过：`这是我自媒体创作的文章，总结一下` 触发检索并返回参考页面；`你好` 不触发检索；导出 PDF 指令不触发检索
