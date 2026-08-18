# DSH Kanban 问题与修复 Handoff

用途：下个会话继续完成 dsh-kanban 完整看板工作流修复、插件重打包/安装、3080 重启与真实链路验证。
日期：2026-08-15

## 路径

- 当前工作目录：/Users/jc/Documents/awsome-dsh-plugins
- 插件仓库：/Users/jc/Documents/awsome-dsh-plugins/dsh-kanban
- 事件存储：/Users/jc/.dsh/storages/kanban/events.jsonl
- 官方 code preset 参考：/Users/jc/.local/dsh-pnpm-global/5/.pnpm/@deepseek-ai+dsh@0.1.0-rc.6_4b02b31f4347d42e02dd8ae2631af2b2/node_modules/@deepseek-ai/dsh/config/agent-presets/code/agent.cordis.yml

## 当前状态

- 插件工作区有大量未提交改动，包含角色工具面、dispatcher、V 编排、client/SSE 看板与测试。
- 已生成旧的 dsh-kanban-0.1.0.tgz（未跟踪）。
- 本轮检查 lsof -nP -iTCP:3080 -sTCP:LISTEN 未发现 3080 监听；in-app browser 仍指向 http://127.0.0.1:3080/kanban/board。启动服务前需先确认 3080 dsh 是否真的已停止/由其他方式运行。
- 事件日志当前 seq=206。
- 旧链路 ch_1_msu2mf5s/t_5_msu2ohb5 与 ch_3_msu2ms0c/t_6_msu2oy9t 已由 watchdog 标记 task/blocked，原因均为 protocol_violation: idle without complete/block。
- 阻塞前，W 角色只持续产生 heartbeat/comment，没有真实 bash/fs 工具可用，说明旧角色 agent 工具面不完整。

## 核心问题

1. 主 agent 没有完整走“规划后等 V/P/W/D 执行”的流程。用户观察到主 agent 自己完成了任务，同时看板仍卡在 W1；需要重点确认并修复：/plan: 主会话只路由/建规格，不自己执行；执行必须等 V 分发的角色 agent。
2. meta.agentPreset=code 没有生效。官方 code preset 是 agent-plane 的 Cordis 组合（persona、instructions、bash/fs/fs-search、jobs/skills/goals、delegation 等），不是简单 persona/role preset。直接放 meta.agentPreset 时，V/W/P/D 会话只有 kanban_*、wiki_*、prefetch_*、spec_*，缺 bash/read/write/run_code，因此 W 只能 heartbeat 后卡 running。
3. 看板 UI 不更新。原因组合：3080 运行的是旧构建/旧插件、旧任务已阻塞、部分链路没有合法推进。不要通过手改 events.jsonl 制造非法状态；事件回放对非法状态会抛错。
4. V 链路行为需要复核。已出现 ch_1_msu2mf5s、ch_3_msu2ms0c 两条后续链，疑似 V 重复建链/误拆链。验证时重点看 V 是否只按主会话规格建一条链，且不在主 agent 未确认时自行创建多链。

## 已做修复（未提交）

### 1. 基座工具依赖

package.json 已新增并 npm install：

- @deepseek-ai/dsh-tool-bash
- @deepseek-ai/dsh-tool-fs
- @deepseek-ai/dsh-tool-fs-search

### 2. 角色工具面

src/roles/toolsets.ts：

- installRoleTools 改为 async
- p/w/d 角色通过官方 apply 注册 bash、fs、fs-search
- 保留 kanban/wiki/prefetch/spec 工具与角色权限边界

### 3. 执行角色 agent 创建

src/dispatcher/agent-runner.ts：

- 创建角色 agent 不再传 meta.agentPreset=code
- 改为 meta.cwd + async setup
- setup 调用 installRoleTools
- 模型配置支持默认模型 fallback

### 4. V 角色 agent 创建

src/dispatcher/v-orchestrator.ts：

- 同样移除 meta.agentPreset=code
- 改为 async setup + installRoleTools
- 模型配置支持默认模型 fallback

### 5. dispatcher 默认模型与依赖注入

src/dispatcher/dispatcher.ts：

- resolveDefaultModel 优先读 settings.get(agent-default-model)
- 增加 role default model 日志
- 把 wiki 和默认模型注入 AgentRunner / VOrchestrator

### 6. 其他上一轮工作

工作区还有 UI/SSE/board store 等整体改动，例如 src/routes/kanban-sse.ts、client 目录、tests 目录，当前 handoff 不重复展开，下个会话直接基于当前工作区继续。

## 上一轮验证结果

上一轮会话已跑过：

- npm run typecheck：exit 0
- npm run test：96/96 pass
- npm run build：exit 0

注意：本 handoff 轮次没有重新执行以上命令；3080 也没有加载最新构建。下一步必须重新构建、打包、安装、重启后再验证。

## 下一步

1. 重新构建并打包：cd /Users/jc/Documents/awsome-dsh-plugins/dsh-kanban；npm run build；npm pack。
2. 安装到 web profile（不要新建 profile/端口）：dsh plugin --profile web add ./dsh-kanban-0.1.0.tgz。若 README 方式更稳，也可用 dsh plugin --profile web add ./dsh-kanban。
3. 只重启 3080 单服务，不要起第二个 dsh/端口。启动后确认日志出现 main-session tools registered，以及 role default model = ark/deepseek-v4-flash。
4. 从 3080 web 新开会话发 /plan:，监控以下证据：主 agent 只调用 kanban_route，不自己改代码；V 只负责建链/建规格/分发，不自己建重复链；W/P/D 会话工具列表包含 bash、run_code、read、write、edit、glob、grep；W 能真实执行并调用 kanban_complete；链路从 W1 推进到后续阶段，看板 SSE 刷新。
5. 旧阻塞链 ch_1_msu2mf5s、ch_3_msu2ms0c 建议保留为 blocked/archive，不手改事件日志；新链路用干净链验证。

## 待确认

- 当前 3080 服务实际如何启动、是否已停止；确认后再重启，避免双服务。
- 安装插件最终使用 ./dsh-kanban 还是 ./dsh-kanban-0.1.0.tgz，取决于 DSH 版本对本地目录/tgz 的支持。
- 是否需要调整 ~/.dsh/profiles/web 或 settings.yaml 的 profile 配置；README 默认使用 web。

## 建议 skill

- systematic-debugging
- subagent-driven-development
- executing-plans
- writing-plans
- webapp-testing

---

## 2026-08-17 追加：调度器不运行 + W1 后不推进 问题与修复

> 本会话在 https://gitlab.jianzhikeji.com/jz-fe/dsh-dashboard 仓库走完整看板流水线（feat/ai-profile 分支任务），发现并修复了调度器与 V 编排的两类阻塞。修复已生效，流水线恢复推进（ch_1 已到 p 阶段，P agent 运行中）。

### 现象（用户可见）

1. /plan: 建链后规格卡批准成功、链进入 executing，但 **V 从未建卡**（任务数为 0），spec-card/approved 事件后无任何反应；dispatcher-state.json / orchestration.json 从不生成，V 会话从不创建。
2. /openspec: 批准被拦截：`missing: ["attachments:file-prefetch"]`——该附件本应由 V 完成 w1-pre 预取后挂载，因 V 未运行永远缺。
3. 服务重启后调度器恢复（能建 w1-pre 卡、W 能执行并 complete），但 **W1 完成后流水线停止**：orchestration 停在 w1-pre，报 `illegal transition: done --task/failed-->` 与 `cannot prepare session "kbn-v-..." while it is live`。

### 排查路径

- 看板快照 + events.jsonl 回放：确认 chain/created、spec-card/approved 等可唤醒事件发出后无 task/created。
- 调度器活体探测：新建 /plan: 测试链，30s 后仍 0 任务、无 dispatcher-state.json → 判定调度器未运行（非偶发）。
- 对比 8/15 成功会话（kbn-v-ch_1_msuai6cb）：当时 V 会话有 permission/sandbox/approval 策略（来自整包 code preset），本轮 V 无 preset 装配。
- 解码当前 V 会话（kbn-v-ch_1_mswq8wut）：turn/end completed、kanban_create 参数正确，但 orchestration.json 的 phase 未推进 → 锁定 firstMatch 判断缺陷。
- 定位 agent.session.events 中 tool/call 的 arguments 是 agent-loop 原样落盘的 **JSON 字符串**（非对象）。

### 根因（4 处，均在 /Users/jc/Documents/awsome-dsh-plugins/dsh-kanban）

| # | 根因 | 位置 |
|---|------|------|
| 1 | 调度器从未启动（wireAllAvailable 60s 窗口内 agents 未就绪则静默放弃；startDispatcher 有 `if(!provider || !agents) return;` 静默早退，且装配异常在异步 interval 中被吞） | src/index.ts / src/dispatcher/dispatcher.ts |
| 2 | B6 ensureLastSeq 首启无状态文件时回退到**事件日志尾部 seq** → 已有事件（chain/created 等）被跳过，V 永不唤醒 | src/dispatcher/dispatcher.ts |
| 3 | firstMatch 用 `e.arguments?.['assignee']` 判断建卡，但 arguments 是 JSON 字符串 → 永不命中 → **phase 永不推进**（W1 完成即停） | src/dispatcher/v-orchestrator.ts |
| 4 | getVAgent 复用会话走 agents.resume，但 V 会话首轮后仍 live，resume 抛 cannot prepare session while it is live → 第二次 wakeV 失败 | src/dispatcher/v-orchestrator.ts |

### 已应用修复（已 tsc 编译，lib 已重建）

- **dispatcher.ts**：
  - 无状态文件时 lastSeq 回退 -1（首启全量重放，B6 幂等保证不重复建卡）。
  - tick 给 waker.onEvent 加 60s 超时护栏（单个挂起 wakeV 不再卡死整条流水线）。
  - 新增 dispatcher.log 文件日志；startDispatcher 容错包裹（异常落盘不阻断插件加载）；agents/kanban 缺失时落盘记录。
- **v-orchestrator.ts**：
  - firstMatch 解析 arguments（兼容 JSON 字符串 / 对象）后比对 assignee/mode。
  - getVAgent 优先 agents.get(sessionId) 复用 live 会话，仅下线后才 resume。
  - 当前阶段期望卡已存在且 done/archived → 直接推进 phase（避免重复建卡）。
  - w1-supp 对已批准规格卡（事实已固化）直接跳过。
  - V 会话 setup 补齐 approval/policy=never + sandbox/mode=workspace-write。
- **运行侧**：重启前删除 dispatcher-state.json 以强制从 -1 重放既有事件（仅首次；之后 B6 正常持久化）。

### 验证结果（当前）

- 调度器日志：[startDispatcher] invoked provider=true agents=true / dispatcher started / initial lastSeq=-1，无新报错。
- ch_1_mswq8wut（用户任务链）：phase 已推进 w1-pre → w1-supp → p，P(openspec) agent 运行中（t_1_mswtnrje）。
- ch_3_mswqxfqh（调度器存活探测测试链）：按预期停在 w1-supp（规格卡未批准，不继续建卡）。

### 下一步

1. 等流水线走完 p → w2 → d → w3；w3 执行用户任务（feat/ai-profile 分支 + README 追加 written by agent 2026-08-17 + 推送，不建 MR）。
2. 链完成后核对产物与轨迹，向用户汇报；测试链 ch_3 可归档。
3. 沉淀：本会话经验已写入 /Users/jc/Documents/awsome-dsh-plugins/.learnings/LEARNINGS.md 与 ERRORS.md。

### 待确认

- w3（implementation）是否由 W(kb) 角色实际执行 git 操作；若设计上实现落在 p/d 阶段，需按实际链路核对。
- 流水线对「琐碎 git 任务」的 R20 全流程是否过重（p/w2/d/w3），后续可评估为简单任务走简化路径。

---

## 2026-08-17 第二轮追加：P 卡住 —— session.events 形态 bug 与系统性修复（举一反三）

> 第一轮修复后流水线推进到 p(openspec)，P 卡完成后出现 `done --task/blocked-->` / `done --task/failed-->` 非法转换报错，随后停在 w2 不建卡。定位为**读取 `agent.session.events` 时字段层级错误**，并做了同类问题全量排查与修复。

### 现象

- P(openspec) 任务已完成（`task/completed` 存在），但 AgentRunner 仍报 `illegal transition: done --task/blocked--> (none)` 与 `tick error: done --task/failed--> (none)`。
- 根因链路：AgentRunner 的 `used` 检测 `agent.session.events.some(e => e.name === 'kanban_complete')` **永远 false**（`name` 实际在 `e.data.name`）→ 误判「idle without complete/block」→ 对已 done 任务 `blockTask`（非法转换）→ catch 转 `failTask`（再次非法转换）。

### 根因（同一类问题，三处消费点）

`session.append(type, data)` 落盘的条目是 `{ type, seq, time, data: { name, arguments, ... } }` —— **`name`/`arguments` 都在 `data` 下，不在顶层**；且 `arguments` 是 agent-loop 原样写入的 JSON 字符串。插件三处直接读 `e.name`/`e.arguments`/`e.type` 全部失效：

| # | 消费点 | 失效表现 |
|---|--------|---------|
| 1 | agent-runner.ts `used` 检测 | `e.name` 取不到 → 已 done 任务被误 block/fail（**P 卡住的直接原因**） |
| 2 | v-orchestrator.ts firstMatch | `e.name` 取不到 → 建卡后 phase 不即时推进（靠 existing-done 兜底才走通） |
| 3 | chain-auditor.ts 会话写证据扫描 | `e.type !== 'tool-call'` 永不命中（真实类型是 `tool/call`）+ `e.name` 取不到 → 审计源 1 完全失效 |

### 已应用修复（举一反三，统一封装）

- **新增 `src/dispatcher/session-events.ts`**：`eventType`/`toolName`/`toolArgs` 三个读取助手，兼容 `{type,data}` 与顶层两种形态、`arguments` 兼容 JSON 字符串/对象。
- **agent-runner.ts**：`used` 检测改用 `toolName`；`blockTask`/`failTask` 加终态（done/archived）防御，避免对已完成任务抛非法转换。
- **v-orchestrator.ts**：firstMatch 用 `toolName`/`toolArgs`；wakeV 阶段推进重构为循环（跳过终态卡阶段、按需跳 w1-supp、停在需建卡阶段建卡）；修正 **w2/w3 同 `(w,kb)` 的歧义**——仅当当前 phase 的 (assignee,mode) 在 R20 序列唯一时才做「已终态 existing → 推进」，否则视为上一阶段卡（避免 w3 被误跳过）。
- **chain-auditor.ts**：事件类型兼容 `tool/call` 与 `tool-call`，读写走 helper。
- **dispatcher.test.ts**：B6 首启语义修正为「无状态文件首启重放既有事件（防孤儿链），幂等防重复」；`wakes1` 断言相应更新。

### 验证

- `npx tsc -p tsconfig.build.json`：exit 0；lib 已重建。
- `npx vitest run`：**155/155 全过**（含 v-orchestrator 4、dispatcher 3、chain-auditor 全过；w2→w3 序列断言通过）。

### 运行侧（待重启）

- 已将 `dispatcher-state.json` 的 lastSeq 设为 **17**：重启后仅重放 seq 18（P 卡 completed）→ 唤醒 V 建 w2 卡 → `w2→d→w3` 依次执行；不再出现 `done--task/blocked/failed` 报错。
- **注意**：w2 与 w3 同为 `(w,kb)`，后续若需精确区分阶段归属，建议在任务上落阶段标记或按创建序计数，当前以「唯一性」判断规避歧义。

# 附：2026-08-17 追加 Handoff — D23 审计器误报修复（本日会话）

> 本次会话解决了「主 agent 疑似越权写工作区产物」误报警告的定位与修复。此前 08-15 的旧交接仍在上文保留。

## 1. 背景：本轮会话做了什么

用户通过看板工作流（/plan: → /openspec:）执行需求：在 https://gitlab.jianzhikeji.com/jz-fe/dsh-dashboard 新建 feat/ai-profile 分支 → README.md 末尾追加 written by agent <当前日期> → 推送到远端。链路 ch_1_msx3152q 全流程打通（W1-pre → P 规划 → W2 KB → D 执行 → W3 KB 收尾），产物已验证：分支 feat/ai-profile（基于 origin/master f9182f63）、README 追加 written by agent 2026-08-17、commit 597d819b6e46972dbf236f70ef0aece81ca1fc75 已推送远端。

**问题**：链完成后看板出现「主 agent 疑似越权写工作区产物（1 条线索），最终汇报已阻塞」+「确认产物归属」按钮。

## 2. 核心问题 ①：误报（已判定 False Positive，无真实越权）

- **结论**：被标记的是另一个项目（/Users/jc/Documents/awsome-dsh-plugins，dsh-kanban 插件开发会话）一次纯只读 ls 排查，run_code 代码字符串恰好含看板工作区路径，被启发式误判。
- **证据**：events.jsonl seq 23 chain/audit-warning → 会话 session-21d5570a-8024-4b3c-8efa-f8b6e2d02ddb（cwd=/Users/jc/Documents/awsome-dsh-plugins，与 dsh-dashboard 无关）；被标记调用 seq 159636（17:53:15）run_code 只派发 bash(ls)+glob+read，零写工具。
- **根因**：① listLiveAgents=ctx.get('agents').list() 扫整个 DSH 进程所有活会话（跨项目作用域泄漏，插件无法解析主会话真实 id 只能以'非角色会话'近似）；② 纯子串匹配不判行为（WRITE_TOOLS 无条件含 run_code/bash）；③ 源 2 产物归属核对未触发。
- **按钮语义**：WorkflowRail.tsx → POST /kanban/action {type:'confirm-audit'} → confirmAudit()（仅 human，kanban-service.ts 176-182）→ chain/audit-confirmed 放行汇报。

## 3. 核心问题 ②：修复实现（已完成，构建+测试通过）

| # | 修改点 | 实现 |
|---|--------|------|
| Fix 1 | 作用域收窄 | ChainAuditor.check(chainId, workspaceDir)；仅扫描 session.header.cwd 位于 Chain.workspaceDir 内（isPathInside）的会话；无 cwd 保守保留 |
| Fix 2 | 行为判定 | run_code 按实际派发子调用（tool/code-dispatch-start / tool/code-dispatch，rootCallId 关联）判定；子调用为直接写工具/写标记 bash 才计证据 |
| Fix 3 | 只读排除 | bash/兜底 code 仅当命中 BASH_WRITE_RE（touch/mkdir/git add·commit·push/重定向等）且含工作区路径时计证据；重定向用 \s>>?（> 前须空白）避免 2>/dev/null、2>&1 误判 |
| Fix 4 | 回归测试 | 新增 5 用例（误报回归/写派发/兜底双分支/bash 写与只读/作用域 3 例） |
| Fix 5 | 构建+测试 | 187/187 通过；tsc 0 错误；npm run build 产出 lib/ + client.js |

- **改动文件（仅 3 个）**：src/dispatcher/chain-auditor.ts（核心）、src/dispatcher/dispatcher.ts（链完成钩子传 Chain.workspaceDir）、tests/dispatcher/chain-auditor.test.ts。其余 git status 改动为存量未提交开发工作。
- **经验坑**：模板字符串写正则会把 \b 变退格符(U+0008)、\s 变裸 s，导致正则失效；需 \\b/\\s 转义并用 xxd 验证字节；同时把 >>? 收紧为 \s>>?。

## 4. 当前状态与待办

### 已就绪
- 代码改完、187/187 通过、npm run build 已产出 lib/（lib/dispatcher/chain-auditor.js 含 header?.cwd 与 code-dispatch；lib/dispatcher/dispatcher.js 含 workspaceDir）。

### ⚠️ 待办
1. **部署**：当前运行的 DSH 实例（127.0.0.1:3080）加载旧插件，需重启/重载 dsh web 才生效。
2. **旧链误报警告**：ch_1_msx3152q 的 audit-warning 不会自动撤销（审计只在链完成时跑一次），需用户在 GUI 点「确认产物归属」放行汇报。
3. **可选加固**（未做）：ownerSessionId 目前是逻辑 id 'session_main'，可考虑在链上记录真实会话 id 以便精确匹配；直接写工具的路径证据可细化到具体路径。

## 5. 关键文件/数据位置

- 插件源码：/Users/jc/Documents/awsome-dsh-plugins/dsh-kanban（src/dispatcher/chain-auditor.ts、dispatcher.ts、tests/dispatcher/chain-auditor.test.ts）
- 看板数据/事件：~/.dsh/storages/kanban/（events.jsonl、dispatcher.log、orchestration.json、workspaces/）
- 会话数据：~/.dsh/sessions/（--Users-jc-Documents-~8BC4~4F30--/ 评估项目；--Users-jc-Documents-work-workspace-dsh-dashboard--/ dsh-dashboard）
- 警告 UI：client/WorkflowRail.tsx；确认动作：src/domain/kanban-service.ts confirmAudit；审计器：src/dispatcher/chain-auditor.ts

## 6. 建议下个会话使用的技能/工具

- 继续插件开发：self-improvement（转义/作用域教训）、verification-before-completion（交付前跑完整验证）。
- dsh-dashboard 仓库后续（如 MR）：走 AGENTS.md 看板工作流（/plan: /openspec:），主 agent 只做规划与收尾汇报。


