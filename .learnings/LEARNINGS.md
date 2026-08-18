# Learnings

> 看板插件（dsh-kanban）开发过程中的经验沉淀。格式遵循 self-improvement skill。

## [LRN-2026-08-17-001] best_practice

**Logged**: 2026-08-17T11:25:48.012Z
**Priority**: high
**Status**: promoted
**Area**: backend

### Summary
看板审计器/编排器用 `ctx.get('agents').list()` 会拿到**整个 DSH 进程所有活会话**（含其他项目的主会话），任何"扫描主会话"的逻辑都必须按作用域收窄，否则跨项目误报。

### Details
D23 链完成审计（chain-auditor.ts）原本扫描全部非 kbn- 活会话，结果把另一个项目（/Users/jc/Documents/awsome-dsh-plugins）里一次纯只读 ls 排查误判为"主 agent 越权写产物"。根因：插件无法解析主会话真实 session id（路由只用逻辑 id 'session_main'），以"非角色会话"为近似导致跨项目泄漏。修复：审计传入 `Chain.workspaceDir`（/plan: 主 agent 工作区，由 `session.header.cwd` 捕获），用 `isPathInside(session.header.cwd, workspaceDir)` 只扫本链工作区内的会话。

### Suggested Action
任何需要定位"主会话/本链会话"的地方，优先用 `Chain.workspaceDir` + `session.header.cwd` 匹配，而不是靠会话 id 前缀或"非角色"近似。

### Metadata
- Source: conversation
- Related Files: src/dispatcher/chain-auditor.ts, src/dispatcher/dispatcher.ts
- Tags: kanban, audit, scope, session
- See Also: FEAT-2026-08-17-001, LRN-20260815-006（历史同类问题：插件无法解析主会话真实 session id）
- Promoted: AGENTS.md（会话作用域）

### Resolution
- **Resolved**: 2026-08-17T11:25:48.012Z
- **Notes**: chain-auditor.ts 增加 workspaceDir 参数并过滤会话工作区；dispatcher.ts 链完成钩子传入 Chain.workspaceDir；11/11 测试通过。

---

## [LRN-2026-08-17-002] best_practice

**Logged**: 2026-08-17T11:25:48.012Z
**Priority**: high
**Status**: promoted
**Area**: backend

### Summary
判定 `run_code` 是否发生写操作，必须看其**实际派发的子调用**（`tool/code-dispatch-start` / `tool/code-dispatch`，按 `rootCallId` 关联外层调用），不能只看外层工具名或参数字符串。

### Details
旧启发式把 run_code/bash 一律算"写能力工具"，只要参数字符串含看板工作区路径就记为越权写证据。实际上 run_code 可能只派发只读子调用（bash ls、glob、read）。修复：收集 dispatch 事件建索引，子调用为直接写工具（write/edit/rm/mv/cp/mkdir/mkfile）或含写标记的 bash 才计证据；无派发记录时兜底要求 code 字符串同时含写标记与路径。

### Suggested Action
会话事件扫描类逻辑统一经 `session-events.ts` 助手读取事件（兼容 `{type, data}` 嵌套与顶层两种形态），派发子调用以 `rootCallId` 关联。

### Metadata
- Source: conversation
- Related Files: src/dispatcher/chain-auditor.ts
- Tags: kanban, audit, run_code, dispatch
- Promoted: AGENTS.md（run_code 写判定）

### Resolution
- **Resolved**: 2026-08-17T11:25:48.012Z
- **Notes**: handleCallEvidence() 按派发子调用判定；187/187 测试通过。

---

## [LRN-2026-08-17-003] best_practice

**Logged**: 2026-08-17T11:25:48.012Z
**Priority**: medium
**Status**: promoted
**Area**: backend

### Summary
bash 写操作标记正则中的重定向要用 `\s>>?`（要求 `>` 前有空白），避免把 `2>/dev/null`、`2>&1`、`1>&2` 等**只读 stderr/stdout 重定向**误判为写操作。

### Details
首次实现用裸 `>>?` 匹配任意位置的重定向符，导致只读命令 `ls ... 2>/dev/null` 被判定为写命令。收紧为 `\s>>?` 后，`> file`（重定向到真实文件）仍命中，而 `2>/dev/null`（> 前是数字无空白）不再误判。

### Suggested Action
写命令检测类启发式，重定向符必须带空白前缀，并补充"重定向到 /dev/null / fd"的负向用例。

### Metadata
- Source: conversation
- Related Files: src/dispatcher/chain-auditor.ts, tests/dispatcher/chain-auditor.test.ts
- Tags: kanban, audit, regex, bash
- Promoted: AGENTS.md（bash 写标记正则）

### Resolution
- **Resolved**: 2026-08-17T11:25:48.012Z
- **Notes**: BASH_WRITE_RE 重定向分支改为 \s>>?；回归用例覆盖只读 ls 2>/dev/null。

---

---

> 以下为历史经验，自 /Users/jc/Documents/awsome-dsh-plugins/.learnings 迁移合并（2026-08-17）。

## Learnings — dsh-kanban 计划修复记录

> 用途：每次计划修复前（意图复述）与修复后（复盘对齐）的 self-improvement 记录，防止修复偏离用户意图。

## [LRN-20260814-001] correction — P0-4 chain 事件语义修复（修复前）

**Logged**: 2026-08-14T12:00:00Z
**Priority**: critical
**Status**: in_progress
**Area**: docs

### Summary
计划中 chain/completed 事件语义颠倒（用于 planning→executing）且 rootTaskId 更新复用 chain/created 导致回放重置链状态；需新增 chain/executing 与 chain/root-task-set 事件。

### Details
- 问题：T4 状态机 planning --(chain/completed)--> executing 语义颠倒；T7 createTask 更新 rootTaskId 时 emit chain/created；T5 投影 chain/created 分支硬编码 status='planning'，回放会把 executing 链打回 planning。
- 用户意图：规格卡批准→链进入 executing；全部任务完成→completed。事件语义必须自洽、投影可回放。
- 修复方向：EventKind 增 chain/executing、chain/root-task-set；状态机改用 chain/executing；投影 root-task-set 只合并 rootTaskId 不重置 status；approveSpecCard 发 chain/executing。

### Suggested Action
按上述方向修改计划文档 T2/T4/T5/T7 及对应测试。

### Metadata
- Source: user_feedback (plan review P0-4)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, event-sourcing, state-machine
---
## [LRN-20260814-001-RESOLVED] P0-4 修复后复盘

**复盘时间**: 2026-08-14T12:10:00Z
**Status**: resolved（更新 LRN-20260814-001）

### 复盘核对（逐项对齐意图）
1. ✅ EventKind 新增 `chain/executing` 与 `chain/root-task-set`（L241）
2. ✅ 状态机 planning --(chain/executing)--> executing；planning 收到 chain/completed 抛非法转换（L538 + L506 测试断言）
3. ✅ 投影：chain/executing 与 completed/aborted 共用转换分支；chain/root-task-set 只合并 rootTaskId 不重置 status（L642-655）
4. ✅ approveSpecCard 发 chain/executing（L967-968）；createTask 的 root 更新发 chain/root-task-set（L978）
5. ✅ 复查全局无 planning→(chain/completed) 残留；L2551 注释属 P0-3 待修项（下一项处理）
6. ⚠️ 过程纠错：投影 case 体编辑曾产生重复代码块，已即时清理并复查（教训：case 合并编辑需先读完整分支）

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- See Also: LRN-20260814-001
---
## [LRN-20260814-002] correction — P0-5 失败重试路径统一（修复前）

**Logged**: 2026-08-14T12:15:00Z
**Priority**: critical
**Status**: in_progress
**Area**: docs

### Summary
失败重试路径四方矛盾（设计/T12/T13代码/T13测试）；统一为 task/failed 事件 + attempts 递增 + 达上限熔断 blocked(gave_up)。

### Details
- 矛盾点：设计=异常回 ready 重试 resume；T12 catch=blockTask(→blocked)；T13 stale=blockTask；T13 测试却断言 failed；attempts 无递增实现；maxRetries 熔断永不触发。
- 用户意图：每任务一次性 agent 失败可重试（resume 同会话），达上限熔断人工介入。协议违规例外：自动 block 不重启进同循环（Hermes 语义）。
- 修复方向：KanbanService 增 failTask；T12/T13 改发 failed；failed 时 attempts+1；attempts≥maxRetries→blocked(gave_up)；协议违规仍 block。

### Suggested Action
修改计划 T7（failTask 方法+接口）、T12（catch 分支+测试）、T13（stale+熔断+测试）。

### Metadata
- Source: user_feedback (plan review P0-5)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, retry, circuit-breaker
---
## [LRN-20260814-002-RESOLVED] P0-5 修复后复盘

**复盘时间**: 2026-08-14T12:30:00Z
**Status**: resolved（更新 LRN-20260814-002）

### 复盘核对（逐项对齐意图）
1. ✅ 投影 task/failed → attempts 递增（attempts=失败次数，熔断判据）
2. ✅ KanbanService 新增 failTask（接口签名+实现；权限仅 system/dispatcher）
3. ✅ T12 catch 改发 failed（runner-error），不再直接 block——协议违规仍保持 block（不重启进同循环，符合 Hermes 语义）
4. ✅ T13 stale 改发 failed；熔断判据改 attempts >= maxRetries；attempts 未达上限保持 failed 由调度器重派
5. ✅ T13 测试重写：完整熔断链（stale→failed(attempts=1)→claim 重派→running→stale→failed(attempts=2)→blocked(gave_up) + reason 断言）
6. ✅ T12 新增 runner 异常用例（failed + attempts=1 + runner-error reason）
7. ✅ 设计文档三处同步（状态机图/心跳熔断节/错误恢复矩阵），设计与计划不再矛盾
8. ⚠️ 遗留验证点：T13 helper 注入 heartbeat 事件依赖 snapshot 重投影——P0-3 修复 snapshot 后需回验（记入 P0-3 复盘）

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md, docs/superpowers/specs/2026-08-14-dsh-kanban-plugin-design.md
- See Also: LRN-20260814-002
---
## [LRN-20260814-003] correction — P0-3 链完成规则 + T19 hack（修复前）

**Logged**: 2026-08-14T12:35:00Z
**Priority**: critical
**Status**: in_progress
**Area**: docs

### Summary
T19 用 chainId-as-taskId hack 冒充链路收尾；链完成无机械规则；需在 completeTask 内嵌规则并修正 T19，同时修复 snapshot 双源竞态。

### Details
- 问题：T19 末行 completeTask(chainId,...) 无效；投影无"全部任务终态→chain/completed"规则；root 收尾仅注释承诺。
- 用户意图：R20 V 收尾→Chain(completed) 必须机械保证（注入≠强制）。
- 修复方向：completeTask 后检查链上任务全终态且链 executing → emit chain/completed(author=system)；T19 删除 hack；snapshot 改重投影权威（消除构造竞态，支撑 T13 helper）。

### Suggested Action
修改计划 T7（链完成规则+snapshot 重投影+构造函数同步化）、T5（事件接口同步读取）、T19（删 hack 断言）。

### Metadata
- Source: user_feedback (plan review P0-3)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, chain-completion, snapshot
---
## [LRN-20260814-003-RESOLVED] P0-3 修复后复盘

**复盘时间**: 2026-08-14T12:50:00Z
**Status**: resolved（更新 LRN-20260814-003）

### 复盘核对（逐项对齐意图）
1. ✅ EventStore 接口加 readAllSync（T3），FileEventStore 实现同步读取（readAll 委托 readAllSync）
2. ✅ KanbanService 构造函数同步投影（消除构造后立即调用基于空状态的竞态）
3. ✅ snapshot() 改为重投影权威（事件日志唯一事实源；非法转换在回放抛错）
4. ✅ completeTask 内嵌链完成机械规则：任务 done 后链上无未终态任务（done/archived 之外）且链 executing → emit chain/completed(author=system)——不靠 agent 自觉，符合"注入≠强制"意图
5. ✅ T7 测试断言更新：唯一任务完成后链自动 completed（验证机械规则）
6. ✅ T19 删除 completeTask(chainId) hack + 删除"如不满足再补"占位注释；链完成由规则自动产生
7. ✅ T20 的 snapshot 补丁段改为引用（避免与 T7 正文重复实现）
8. ✅ 连带验证：P0-5 遗留点（T13 helper 注入 heartbeat 事件依赖 snapshot 重投影）现已成立——重投影会把注入的 heartbeat 投影进 task.heartbeats

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- See Also: LRN-20260814-003, LRN-20260814-002
---
## [LRN-20260814-004] correction — P0-1 新增 V 编排驱动器任务（修复前）

**Logged**: 2026-08-14T13:00:00Z
**Priority**: critical
**Status**: in_progress
**Area**: docs

### Summary
设计的核心支柱 V 事件驱动编排循环在计划中无实现任务；新增 T11.5 VOrchestrator 任务填补。

### Details
- 问题：V 编排会话实体不存在；T11 唤醒桩无实现；T12 是任务级模型（V 编排是链路级）；T19 手写 for 循环冒充编排逻辑。
- 用户意图（D4/D7/D11）：V=独立链路级编排者，R20 阶段序列（w1-pre→w1-supp?→P→W2→D→W3→汇总），事件唤醒推进。
- 修复方向：VPhase 阶段模型 + ChainOrchestration 持久化（工作区）+ VOrchestrator.wakeV（创建/恢复 V agent、链状态+规格卡+R20 规则上下文、校验建卡、推进 phase）+ 假 V agent 专项测试（R20 序列断言+非法序列检测）；T11 wakeImpl 对接；T19 分工注明。

### Suggested Action
在计划 T11 与 T12 之间插入完整任务 T11.5；同步设计文档 §4。

### Metadata
- Source: user_feedback (plan review P0-1)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, orchestrator, r20
---
## [LRN-20260814-004-RESOLVED] P0-1 修复后复盘

**复盘时间**: 2026-08-14T13:30:00Z
**Status**: resolved（更新 LRN-20260814-004）

### 复盘核对（逐项对齐意图）
1. ✅ 新增 Task 11.5 VOrchestrator：VPhase 阶段模型（w1-pre→w1-supp→p→w2→d→w3→summary）+ R20_PHASE_ORDER + R20_PHASE_EXPECT（每 phase 期望建卡）
2. ✅ ChainOrchestration（chainId/phase/sessionId/waitingOn）由构造注入的 Map 持有（持久化由 T7 工作区扩展，测试可用内存 Map）
3. ✅ wakeV 语义：读 phase → 创建/恢复 V agent（persona-v）→ 上下文含 NEXT_TASK 期望 + 规格卡 + 链上任务状态 + R20 规则 → 校验建卡（assignee+mode 匹配才推进；w1-supp 可跳过）→ phase 不匹配不推进（防建错卡）
4. ✅ 假 V agent 测试：真实调用 svc.createTask（非只记录）、followup 同步入队 + whenIdle 等待（消除竞态）、断言 R20 序列（w1-pre→P→w2→d→w3）、链完成由机械规则产生、错误 assignee → phase 不推进
5. ✅ T11 wakeImpl 对接注释更新（→ VOrchestrator.wakeV）；T19 分工注明（编排逻辑 T11.5 覆盖，T19 聚焦领域集成）
6. ✅ 设计文档 §4 同步：补充 R20 阶段序列机械规则与建卡校验
7. ⚠️ 自查纠错：初版测试假 V 只记录不建卡（后续取任务会崩）+ 错误卡断言矛盾 + whenIdle 竞态——已重写为真实建卡并记录调用（教训：假 agent 必须模拟真实副作用，不能只记录返回值）

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md, docs/superpowers/specs/2026-08-14-dsh-kanban-plugin-design.md
- See Also: LRN-20260814-004
---
## [LRN-20260814-005] correction — P0-2 新增阶段 0 规划对话任务（修复前）

**Logged**: 2026-08-14T13:40:00Z
**Priority**: critical
**Status**: in_progress
**Area**: docs

### Summary
阶段 0 规划对话（ask-matt/grill-me 循环、W1-pre 附件、/openspec: 批准校验）在计划中缺失；新增 T10.5 填补。

### Details
- 问题：T10 只建链+空规格卡；无方法论注入；无编辑循环；无"确认无疑问"判定；无 W1-pre 触发；/openspec: 无条件 approve。
- 用户意图（D8/D9）：主会话前台承载规划对话；W1-pre 产物挂规格卡附件；/openspec: 校验六段完整+附件存在才批准。
- 修复方向：规划方法论注入模块 + 批准前置校验 + KanbanService.addSpecCardAttachment + 假对话测试。

### Suggested Action
在计划 T10 与 T11 之间插入 T10.5。

### Metadata
- Source: user_feedback (plan review P0-2)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, planning-phase, spec-card
---
## [LRN-20260814-005-RESOLVED] P0-2 修复后复盘

**复盘时间**: 2026-08-14T14:00:00Z
**Status**: resolved（更新 LRN-20260814-005）

### 复盘核对（逐项对齐意图）
1. ✅ 新增 Task 10.5：MATTPOCOCK_PLANNING_GUIDANCE（ask-matt 澄清式提问 + grill-me 苏格拉底拷问 + 六段收敛 + /openspec: 收尾指引）
2. ✅ validateSpecCardForApproval：六段完整性 + file-prefetch 附件存在性校验，返回缺失项列表
3. ✅ approveIfReady：/openspec: 批准前置校验；不满足返回 {ok:false, missing, guidance} 回显缺失项（防跳过 grill-me 直接执行——对齐用户"反复循环直至确认"意图）
4. ✅ T7 扩展 addSpecCardAttachment（仅 draft + spec-edit 权限 + spec-card/edited 事件）——W1-pre 产物挂规格卡附件的落点
5. ✅ T10 handleOpenspecRoute 委托 approveIfReady（T10.5 修改 T10 文件声明 + import 顺序处理）
6. ✅ 设计文档阶段 0 同步批准前置校验机械闸
7. ⚠️ 自查纠错两处：① 初版在 T10 实现里 import 尚未存在的 T10.5 模块（任务顺序矛盾）→ 改为 T10 基础版+标注、T10.5 声明 Modify；② 设计文档编辑两次 old_string 不匹配（前导空格/括号字符差异）→ 用 sed 核对精确字符后成功（教训：编辑文档前先 cat -A 核对空白字符）

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md, docs/superpowers/specs/2026-08-14-dsh-kanban-plugin-design.md
- See Also: LRN-20260814-005
---
## [LRN-20260814-006] correction — P1-9 T8 环境矛盾（修复前）

**Logged**: 2026-08-14T14:10:00Z
**Priority**: high
**Status**: in_progress
**Area**: docs

### Summary
T8 inject=['storage'] 为未核实依赖且 KanbanProvider 实际不需要；require('node:os') 在 ESM 非法；测试缺提供方会 PENDING。

### Details
- 核实结果：ctx.storage 是 dsh-storage hub 服务；KanbanProvider 用 FileEventStore（文件系统）不需要该服务。
- 用户意图：计划可执行、无占位承诺。
- 修复方向：移除 inject（或明确不需要）；require 改 ES import homedir；测试无需 storage 提供方。

### Suggested Action
修改计划 T8（inject/import/实现/测试说明）。

### Metadata
- Source: user_feedback (plan review P1-9)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, esm, dependency
---
## [LRN-20260814-006-RESOLVED] P1-9 修复后复盘

**复盘时间**: 2026-08-14T14:20:00Z
**Status**: resolved（更新 LRN-20260814-006）

### 复盘核对（逐项对齐意图）
1. ✅ 核实 ctx.storage 为 dsh-storage hub 服务（非必需依赖）
2. ✅ 移除 inject=['storage']（KanbanProvider 只用 FileEventStore 文件系统）——消除占位承诺与测试 PENDING 风险
3. ✅ require('node:os') 改顶部 ES import { homedir }（ESM 合法）
4. ✅ 接口描述/测试期望同步更新（无 inject 依赖说明）

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- See Also: LRN-20260814-006
---
## [LRN-20260814-007] correction — P1-4+P1-5 权限矩阵与红队用例（修复前）

**Logged**: 2026-08-14T14:25:00Z
**Priority**: high
**Status**: in_progress
**Area**: docs

### Summary
权限矩阵 4 处缺陷（system complete 过宽、P spec-edit 越权、跨任务绑定缺失、T20 自相矛盾）；引入 boundTaskId 会话绑定修正。

### Details
- 问题：can('complete','system')=true；spec-edit 允许 p；own 判断只查 assignee → P 任务 agent 可 complete 链上任意 P 任务（跨任务越权）；T20 human create 用例断言矛盾；红队跨链路用例无实现。
- 用户意图：agent 会话级隔离——角色 agent 只操作其绑定的任务；人类 GUI 例外通道。
- 修复方向：can() 增 opts.boundTaskId（complete 仅绑定/system；block 加 human/system；heartbeat 仅绑定）；spec-edit 仅 human + 新增 spec-attach(v/human)；服务方法加 opts；修正 T20 用例 + 补绑定红队用例。

### Suggested Action
修改计划 T6/T7（签名+测试）、T9（ToolCaller 带 boundTaskId）、T19/T11.5 调用点、T20 用例。

### Metadata
- Source: user_feedback (plan review P1-4/P1-5)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, permissions, session-binding
---
## [LRN-20260814-007-RESOLVED] P1-4+P1-5 修复后复盘

**复盘时间**: 2026-08-14T15:00:00Z
**Status**: resolved（更新 LRN-20260814-007）

### 复盘核对（逐项对齐意图）
1. ✅ can() 引入 boundTaskId 会话绑定：complete 仅绑定任务/system；block 加 human/system；heartbeat 仅绑定——旧 own（只查 assignee）废弃（跨任务越权封堵）
2. ✅ spec-edit 收紧为仅 human（P 只读）；新增 spec-attach（v/human）供 V 挂 W1-pre 附件（addSpecCardAttachment 改用 spec-attach）
3. ✅ 服务方法 completeTask/blockTask/heartbeat 加 opts.boundTaskId 并透传 can()
4. ✅ ToolCaller 接口加 boundTaskId；工具 execute 传绑定；T12 installRoleTools 注明闭包捕获 taskId 注入
5. ✅ 全部测试调用点修正：T7（human actor+binding）、T10.5、T11.5 completeLatest、T12/T13 setupTask、T19（w1pre/循环 complete/block）
6. ✅ T20 修正自相矛盾用例（human create 语义准确化）+ 新增跨任务绑定红队用例（W 会话绑定 t_1 不能 complete 链上另一 W 任务 t_2）

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- See Also: LRN-20260814-007
---
## [LRN-20260814-008] correction — P1-1+P1-2 规格卡注入与附件接线（修复前）

**Logged**: 2026-08-14T15:05:00Z
**Priority**: high
**Status**: in_progress
**Area**: docs

### Summary
T12 buildContext 缺规格卡六段注入；VOrchestrator w1-pre 完成后挂附件无调用代码。

### Details
- 问题：buildContext 只拼 body+父交接（规格卡缺）；addSpecCardAttachment 有 API 无接线。
- 用户意图（D5/D9）：角色 agent 上下文=规格卡+父交接+W1-pre 附件，原汁原味。
- 修复方向：buildContext 经 Chain.specCardId 注入六段+附件；wakeV 幂等挂附件；补测试。

### Suggested Action
修改计划 T12（buildContext+测试）、T11.5（wakeV 挂附件+测试）。

### Metadata
- Source: user_feedback (plan review P1-1/P1-2)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, context-injection, spec-card
---
## [LRN-20260814-008-RESOLVED] P1-1+P1-2 修复后复盘

**复盘时间**: 2026-08-14T15:20:00Z
**Status**: resolved（更新 LRN-20260814-008）

### 复盘核对（逐项对齐意图）
1. ✅ T12 buildContext 注入规格卡六段 + 附件引用（经 Chain.specCardId；原汁原味，无压缩）——补齐 D5"上下文=规格卡+父交接"的一半缺口
2. ✅ VOrchestrator.wakeV 加幂等挂附件：w1-pre 任务 done 且规格卡无 file-prefetch 附件 → addSpecCardAttachment（actor=v，spec-attach 权限）→ 满足 T10.5 批准前置校验
3. ✅ T11.5 测试：freshChain 加规格卡；w1-pre 完成后断言附件挂载 + 后续 phase 推进不受影响
4. ⚠️ 编辑过程教训：第一次 buildContext edit 因 TS 模板串嵌套反引号解析失败（run_code 的 TS 解析器把旧字符串里的反引号当模板）→ 改为 tools.edit 直接调用成功

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- See Also: LRN-20260814-008
---
## [LRN-20260814-009] correction — P1-3 工具注册策略统一（修复前）

**Logged**: 2026-08-14T15:25:00Z
**Priority**: high
**Status**: in_progress
**Area**: docs

### Summary
工具注册双机制并存（全局+can 兜底 vs agent-scope 装配）且 execute 第二参数未核实；统一为工厂+闭包 getCaller 模式。

### Details
- 问题：T9 全局注册全部工具；T15 又按角色装配——两套机制未整合；execute(args, caller) 第二参数形状未核实（官方示例只有 args）。
- 用户意图：agent-scope 装配为唯一注册机制；can() 兜底保留；计划无未核实 API。
- 修复方向：T9 改工厂 buildKanbanTools(service, getCaller)；execute 内 const caller=getCaller()；T15 按角色从工厂装配；主会话工具面单独注册；测试改闭包。

### Suggested Action
修改计划 T9（工厂+测试）、T15 toolsets（装配说明）、T8/T10 主会话工具注册。

### Metadata
- Source: user_feedback (plan review P1-3)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, tool-registration, agent-scope
---
## [LRN-20260814-009-RESOLVED] P1-3 修复后复盘

**复盘时间**: 2026-08-14T15:40:00Z
**Status**: resolved（更新 LRN-20260814-009）

### 复盘核对（逐项对齐意图）
1. ✅ T9 buildKanbanTools 改为工厂（service + getCaller 闭包）；8 处 execute(args, caller) 全部改为 execute(args) + 首行 const caller=getCaller()——不依赖未核实的第二参数
2. ✅ T9 测试闭包化：create 拒绝用例（getCaller 返回 {actor:'p'}）+ 新增 bound complete 用例（{actor:'w', boundTaskId:t.id}）
3. ✅ T15 installRoleTools 声明统一装配策略：角色工具从工厂选取 + getCaller 闭包捕获（actor=role、boundTaskId=taskId）；can() 兜底保留为第二道
4. ✅ 主会话工具面明确（T8 apply registerMainSessionTools）：spec_card_* + kanban 只读子集 + 前缀路由；主会话无 kanban_create/complete/block（防越权）

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- See Also: LRN-20260814-009
---
## [LRN-20260814-010] correction — P1-6 W external 模式（修复前）

**Logged**: 2026-08-14T15:45:00Z
**Priority**: high
**Status**: in_progress
**Area**: docs

### Summary
T15 executePrefetch 对 external/kb 模式抛占位异常；补齐三模式实现与测试。

### Details
- 问题：executePrefetch 仅 file 模式落地；external/kb 抛 'not yet wired'（No Placeholders 违规）。
- 用户意图：W 三模式可执行（external=外网查询、kb=知识库查询、file=仓库只读）。
- 修复方向：实现 external（web 搜索封装→产物入工作区）与 kb（wiki.search/read→产物）；补测试。

### Suggested Action
修改计划 T15（WikiWorker.executePrefetch 三模式 + 测试）。

### Metadata
- Source: user_feedback (plan review P1-6)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, prefetch, w-modes
---
## [LRN-20260814-010-RESOLVED] P1-6 修复后复盘

**复盘时间**: 2026-08-14T15:55:00Z
**Status**: resolved（更新 LRN-20260814-010）

### 复盘核对（逐项对齐意图）
1. ✅ executePrefetch 三模式落地：file（工作区产物登记+路径校验）、external（ws/prefetch-external.md 登记，检索由 agent web 工具执行）、kb（ws/prefetch-kb.md 登记，查询由 wiki 工具执行）——移除 'not yet wired' 占位异常
2. ✅ 补充 external/kb 测试用例（产物 ref 断言）

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- See Also: LRN-20260814-010
---
## [LRN-20260814-011] correction — P1-7 waitingOn/AgentSessionRef 收敛（修复前）

**Logged**: 2026-08-14T16:00:00Z
**Priority**: medium
**Status**: in_progress
**Area**: docs

### Summary
Task.waitingOn 无写入者；AgentSessionRef 实体设计声明未实现（确定性 sessionId 派生使映射冗余）；删除以收敛。

### Details
- 问题：Task.waitingOn 字段无人写入；AgentSessionRef 只在设计存在，计划用 kbn-<taskId>/kbn-v-<chainId> 确定性派生。
- 用户意图：模型诚实无冗余。
- 修复方向：删 Task.waitingOn（等待语义在 ChainOrchestration.waitingOn）；删设计 AgentSessionRef 实体；同步构造点。

### Suggested Action
修改设计 §2 与计划 T2/T7 及测试构造。

### Metadata
- Source: user_feedback (plan review P1-7)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md, docs/superpowers/specs/2026-08-14-dsh-kanban-plugin-design.md
- Tags: plan-fix, data-model
---
## [LRN-20260814-011-RESOLVED] P1-7 修复后复盘

**复盘时间**: 2026-08-14T16:10:00Z
**Status**: resolved（更新 LRN-20260814-011）

### 复盘核对（逐项对齐意图）
1. ✅ 设计：Task 字段删 waiting_on（注明等待语义归 ChainOrchestration）；删 AgentSessionRef 实体（注明确定性 sessionId 派生规则）
2. ✅ 计划：T2 Task 接口删 waitingOn；9 处构造点清理；T2/T11 接口描述同步修正
3. ✅ waitingOn 语义保留于 ChainOrchestration.waitingOn（T11.5 实现 orch.waitingOn='task/completed'）——等待语义单一归属

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md, docs/superpowers/specs/2026-08-14-dsh-kanban-plugin-design.md
- See Also: LRN-20260814-011
---
## [LRN-20260814-012] correction — P1-8 并发安全（修复前）

**Logged**: 2026-08-14T16:15:00Z
**Priority**: high
**Status**: in_progress
**Area**: docs

### Summary
FileEventStore 无锁 + seq 内存分配 + tmp 追加残留 bug；改为原子追加与尾行 seq 分配。

### Details
- 问题：设计承诺 revision 防陈旧但无实现；多进程 seq 冲突；writeFileSync(tmp,line,{flag:'a'}) 多行残留。
- 用户意图：事件日志跨进程安全（多链路并行协作）。
- 修复方向：appendFileSync 原子追加（单行<4KB POSIX 原子）；seq 每次从尾行重读+1；删 tmp/rename；补并发测试；设计 §10 对齐。

### Suggested Action
修改计划 T3（append 实现+测试）、设计 §10。

### Metadata
- Source: user_feedback (plan review P1-8)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, concurrency, event-store
---
## [LRN-20260814-012-RESOLVED] P1-8 修复后复盘

**复盘时间**: 2026-08-14T16:30:00Z
**Status**: resolved（更新 LRN-20260814-012）

### 复盘核对（逐项对齐意图）
1. ✅ append 原子化：appendFileSync 单行追加（<4KB POSIX 原子）；seq 每次从尾行重读+1（多实例并发唯一）——移除内存 seq 缓存与有 bug 的 tmp/rename 段
2. ✅ 构造函数清理（seq 缓存删除）；import 清理（writeFileSync/renameSync 移除）
3. ✅ T3 补并发测试：两实例交错 append → seq 全部唯一
4. ✅ 设计 §10 并发行对齐实际机制（单路由串行 + 原子追加 + seq 尾行重读）

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md, docs/superpowers/specs/2026-08-14-dsh-kanban-plugin-design.md
- See Also: LRN-20260814-012
---
## [LRN-20260814-013] correction — P1-10 UI 列模型统一（修复前）

**Logged**: 2026-08-14T16:35:00Z
**Priority**: medium
**Status**: in_progress
**Area**: docs

### Summary
设计 5 列 vs 计划 8 列不一致；统一为 6 列（planning[链级]+todo+running+blocked+failed+done）。

### Details
- 问题：设计 5 列（无 triage/todo/failed 展示）；foldBoard 8 列含 triage/todo/failed——不一致且 failed 卡片无归处。
- 用户意图：看板列覆盖所有任务状态；planning 是链级展示。
- 修复方向：foldBoard 输出任务列（triage→todo、archived→done 折叠）+ 组件拼装链级 planning；同步测试与设计 §6。

### Suggested Action
修改设计 §6、计划 T16（foldBoard+测试）。

### Metadata
- Source: user_feedback (plan review P1-10)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md, docs/superpowers/specs/2026-08-14-dsh-kanban-plugin-design.md
- Tags: plan-fix, ui-columns
---
## [LRN-20260814-013-RESOLVED] P1-10 修复后复盘

**复盘时间**: 2026-08-14T16:45:00Z
**Status**: resolved（更新 LRN-20260814-013）

### 复盘核对（逐项对齐意图）
1. ✅ foldBoard 统一 5 任务列（todo[含 triage/ready]+running+blocked+failed+done[含 archived]）+ 链级 planning 由组件拼装——与设计 6 列模型一致
2. ✅ T16 测试重写：折叠映射断言（triage→todo、archived→done、failed 独立列）
3. ✅ 设计 §6 列定义更新为统一 6 列（P1-10 标注）

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md, docs/superpowers/specs/2026-08-14-dsh-kanban-plugin-design.md
- See Also: LRN-20260814-013
---
## [LRN-20260814-014] correction — P2 批量修正（修复前）

**Logged**: 2026-08-14T16:50:00Z
**Priority**: medium
**Status**: in_progress
**Area**: docs

### Summary
6 个 P2 点批量修正：resume setup、SessionId 构造、T19 按需、wikiBase getter、UI 真实挂载、多链路并行验证。

### Details
- T12 resume 未传 setup；as never 绕过 branded type；T19 W1-supp 固化；T15 强转挖私有；UI 无 roster 挂载；多链路无验证。
- 修复方向：resume 传 setup；SessionId() 构造；T19 按需参数化；WikiVaultClient.baseUrl getter；T17 加挂载步骤；T19 加双链用例。

### Suggested Action
修改计划 T12/T14/T15/T17/T19。

### Metadata
- Source: user_feedback (plan review P2)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, p2-batch
---
## [LRN-20260814-014-RESOLVED] P2 批量修正修复后复盘

**复盘时间**: 2026-08-14T17:10:00Z
**Status**: resolved（更新 LRN-20260814-014）

### 复盘核对（逐项对齐意图）
1. ✅ T12 resume 分支补 setup（恢复会话重新装配角色工具面）+ SessionId() 构造替换 as never + import（@deepseek-ai/dsh-session，与 headless 用法一致）
2. ✅ T19 R20_ORDER 按需化：W1-supplement 默认跳过（规格卡含 W1-pre 附件即已覆盖）；断言改为 ['p:openspec','w:kb','d:align','w:kb']
3. ✅ WikiVaultClient 暴露 baseUrl getter；WikiWorker.wikiBase() 改用 getter（消除类型强转挖私有）
4. ✅ client/index.ts 补 P2 接入说明（dsh.client roster 行注册参照 dsh-web-app 模式；slot 挂载以 dsh-client-ui-layout 真实 API 对齐）
5. ✅ T19 新增双链并行用例：两链同跑各自 completed + 任务不串链断言

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- See Also: LRN-20260814-014
---
## [LRN-20260814-015] correction — P1-11 自查记录重写（修复前）

**Logged**: 2026-08-14T17:15:00Z
**Priority**: medium
**Status**: in_progress
**Area**: docs

### Summary
计划自查记录为修复前版本（声称无缺口），需重写为反映两轮修复的真实状态并做全局终验。

### Suggested Action
重写计划末尾自查记录；grep 终验占位符/残迹。

### Metadata
- Source: user_feedback (plan review P1-11)
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- Tags: plan-fix, self-review
---
## [LRN-20260814-015-RESOLVED] P1-11 修复后复盘

**复盘时间**: 2026-08-14T17:25:00Z
**Status**: resolved（更新 LRN-20260814-015）

### 复盘核对（逐项对齐意图）
1. ✅ 自查记录重写：如实反映两轮修复（P0 5 项 + P1/P2 10 项）、设计同步 6 处、23 任务总数
2. ✅ 终验扫描结果：无 TBD/TODO/not yet wired；24 处 as never 均为测试桩惯用法；无 waitingOn/双空格/storage inject/require 残留
3. ✅ 遗留项明确归类（实施时验证 vs 后续版本），非隐性缺口

### Metadata
- Related Files: docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md
- See Also: LRN-20260814-015
---


## [LRN-20260814-004] implementation — dsh-kanban 插件落地完成（复盘）

**时间**: 2026-08-14
**Status**: resolved
**Area**: implementation

### 摘要
按 docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md 的 23 个任务（T1-T21 + T10.5 + T11.5）完整实现 dsh-kanban bundle，全部 checklist 勾选，70/70 测试绿。

### 交付证据
- 领域层纯 TS 零 DSH 依赖：事件溯源（FileEventStore JSONL）、状态机、投影、权限矩阵（P1-4 boundTaskId 会话绑定）。
- 集成层：config（schemastery）、KanbanProvider（cordis Service）、kanban/spec-card/wiki/prefetch 工具工厂、前缀路由 + 阶段 0 规划驱动（mattpocock + 批准前置校验）。
- 调度层：EventWaker（去重）、VOrchestrator（R20 阶段序列 + 建卡校验 + w1-supp 跳过 + W1-pre 附件挂载）、AgentRunner（每任务一次性 + 协议违规 block + 失败 failed/attempts）、Watchdog（stale 回收 + 熔断 gave_up）。
- wiki 层：WikiVaultClient（prefix 白名单 + WikiError）+ WikiWorker（三模式预取 + KB 同步）。
- client：foldBoard/BoardCard/TaskDrawer/KanbanBoard（vitest + testing-library）。
- e2e：runFullChain 假 agent 全链路（R20 串行、KB 中转、双链并行）+ 红队越权用例。
- 打包：cordis.patch.yml（kanban 行 + kanban-board client roster 行 + 4 persona 行）、personas/*.md、README。
- 验收：npm run build / typecheck / test 全过；tests/e2e/install-check.sh PASS（dsh plugin --profile kanban-check add 后 --dump-config 含 dsh-kanban）；构建产物 node apply() 冒烟通过（kanban 服务挂载 + snapshot）。

### 实施时对计划的校正（如实记录）
1. cordis 4 API：Service 构造即注册（super(ctx,name) 调 reflect.provide），无需 ctx.provide(类)；Context 无 start/stop。
2. erasableSyntaxOnly：参数属性（private readonly x）不允许 → 改为显式字段 + 构造赋值。
3. T11.5 测试：fakeV 的 resume 返回同一会话（V 会话延续语义）；链 completion 需先 approve 规格卡（链 planning 期间机械规则不触发，避免中间阶段提前完成）。
4. T12 测试：fake agent followup 只排队一次、whenIdle 等待（避免重复 complete）；配置桩（{}）下 persona preset 走缺省。
5. T13 测试：熔断用例的心跳改为过期值（now-200s），否则第一次 tick 不 stale。
6. T15 wiki-worker：pagePath 保留完整 chainId（projects/ch_1/...）；syncToWiki 测试需先落盘产物文件。
7. 投影：task/created 归一化缺省字段（status/parents/children/attempts/heartbeats）使最小 payload 可回放；spec-card/created 接线 chain.specCardId。
8. 权限：complete 在 bound 基础上要求 actor === task.assignee（跨角色 bound 拒）。
9. readSince 语义为含端点（>=）。
10. T19 e2e：用 plan.specCardId 取本链规格卡（多链不串）；w2/d 索引修正为 tasks[1]/tasks[2]。

### 遗留项（计划已列为后续验证，非缺口）
- client 浏览器半 bundle 需随 dsh web 构建工具链产出（./client 入口）；T17 以 dsh-client-ui-layout 真实 slot API 对齐。
- T12 协议违规检测的会话事件形状以 DSH 工具事件真实形状对齐。
- /plan、/execute-plan 斜杠命令细化（设计 §12 范围外）。


## [LRN-20260815-001] correction — 主 agent 自带宿主执行工具，插件无法机械禁止其执行（根因复盘）

**Logged**: 2026-08-15T11:00:00Z
**Priority**: critical
**Status**: resolved
**Area**: backend

### Summary
主 agent（主会话）默认挂 DSH 官方 `standard` agent preset（含 bash/fs/fs-search/skill/goal/subagent，无 run_code）；dsh-kanban 插件只能往主会话 **追加** kanban/spec/route 工具，无法删除宿主已有执行工具。因此"主 agent 只路由/规划、执行交给 V"只能靠提示词软约束，handoff 证实会失效（主 agent 自己完成了任务，看板卡在 W1）。

### Details
- 根因链：主 agent 有 bash/fs → 插件提示词（KANBAN_HANDOFF_RULE）不构成机械闸 → LLM 自驱完成需求 → 看板无进展、V 空转、用户看到"主 agent 自己处理任务"（严重错误）。
- 修复方向（用户确认）：软约束加固（提示词铁律保留+强化）+ **链完成验收核对（重）**——Chain(completed) 时核对链上工作区产物与主会话会话事件，主 agent 越权写 → 发 chain/audit-warning + 阻塞最终汇报直至用户 GUI 确认。
- 设计决策 D23；计划新增 Task 34。

### Suggested Action
已落地：design.md D20-D23 + §5 阶段 1 验收核对 + §10 错误矩阵；计划 T34。实现时注意：核对数据源是主会话会话事件（bash/fs 写 workspaces/ 路径），需从 agents 服务读取。

### Metadata
- Source: user_feedback (2026-08-15)
- Related Files: docs/superpowers/specs/2026-08-14-dsh-kanban-plugin-design.md, docs/superpowers/plans/2026-08-14-dsh-kanban-plugin.md, handoff-dsh-kanban-2026-08-15.md
- Tags: main-agent, delegation, soft-constraint, audit
---

## [LRN-20260815-002] knowledge_gap — meta.agentPreset=code 不生效；官方 preset 是 agent-plane 组合，须用 agentPresets.mount()

**Logged**: 2026-08-15T11:05:00Z
**Priority**: critical
**Status**: resolved
**Area**: backend

### Summary
交接文档记录"meta.agentPreset=code 没有生效"——官方 `code` preset 是 agent-plane 的 Cordis 组合（persona/instructions/bash/fs/fs-search/jobs/skills/goals/plan/compaction/delegation/ask-user/todo/web/tool-presentation），不是简单 persona/role preset。直接放 meta.agentPreset 时，V/W/P/D 会话只有 kanban_*/wiki_*/prefetch_*/spec_* 工具，缺 bash/read/write/run_code，W 只能 heartbeat 后卡 running。

### Details
- 正确装配方式：setup 内 `agentPresets.mount(agentCtx, 'code')`（或自定义裁剪 preset id），把 agent 的 scope key 绑定到 preset 的 standing composition。
- 依赖：`@deepseek-ai/dsh-agent-presets` 服务；mount(agentCtx, id) 从配置 roots + `$DSH_HOME/.agent-presets` 发现。
- 连带：V 不挂 code preset（只装 kanban/spec 工具）→ 零执行能力，符合"编排者只分解不做事"。

### Suggested Action
已落地：agent-runner.ts/v-orchestrator.ts 已从 meta.agentPreset 改为 setup + mount；D22 决定进一步按角色裁剪（T33）。实施时验证 DSH 版本对该 API 的实际形状。

### Metadata
- Source: handoff + 官方 preset 文件核对
- Related Files: dsh-kanban/src/dispatcher/agent-runner.ts, dsh-kanban/src/dispatcher/v-orchestrator.ts
- Tags: agent-presets, mount, code-preset, tool-surface
---

## [LRN-20260815-003] best_practice — 角色 agent 工具面：全量 preset 会越权，须按角色裁剪并加单测断言

**Logged**: 2026-08-15T11:10:00Z
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
给 P/W/D 全量挂官方 code preset 解决了"缺 bash 阻塞"，但引入越权面：W 能 git push/run_code（设计意图是只读仓库+写 wiki）、P 能执行、D 能 subagent 派单。正解是按角色裁剪 preset（include 官方片段 + disabled 多余行），并在工具面单测中断言裁剪结果（W 无 bash 写、D 无 subagent 等）。

### Details
- 能力清单（2026-08-15 决策文档 §2）：code preset 提供 bash/fs/fs-search/run_code/jobs/skill/goal/plan/compaction/delegation/ask-user/todo/web；插件只追加 kanban/spec/wiki/prefetch。
- 裁剪三档：P（禁 bash 写/run_code/delegation）、W（禁 bash 写/run_code/fs 全局写）、D（禁 delegation，保留开发能力）。
- 组合文件随包分发 personas/<role>/agent.cordis.yml + cordis.patch.yml 配 agent-presets roots（D22/T33）。

### Suggested Action
已落地：设计 §3 工具面隔离表扩展 + §4「角色工具面与基座能力」；计划 T33。实现时先写裁剪断言失败测试。

### Metadata
- Source: user_feedback (2026-08-15, Q3)
- Related Files: docs/superpowers/specs/2026-08-15-dsh-kanban-core-flow-alignment.md
- Tags: tool-surface, preset-trim, least-privilege, anti-escalation
---
## [LRN-20260815-004] knowledge_gap — agent-presets 无 include/patch 语义；裁剪 preset 只能手写最小组合

**Logged**: 2026-08-15T12:30:00Z
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
设计/计划假设"组合文件 include 官方 code 片段 + disabled 多余行"（cordis-plugin-include）可行——实测官方 agent-presets **没有 include 语义**：cordis/code preset 都是 standard 的整目录副本（README 明言 "no patch semantics at this layer"），@deepseek-ai/cordis-plugin-include 只是文件型 loader 树（读 YAML→entries），不提供 include 指令。→ 按计划预判的退化路径：**手写最小组合文件**（整目录独立，行 id/name 对齐官方 code preset），已在 Task 33 提交信息与计划书中注明取舍。

### Details
- 关键证据：agent-presets README "A copy is a snapshot that drifts ... there is no patch semantics at this layer to express 'standard plus one change' (that is the bundle layer's cordis.patch.yml)"；cordis-plugin-include 包导出的是 Include（文件型 loader 树）+ entryListSchema（YAML 方言），无 include 指令。
- 实现：personas/kanban-{p,w,d}/agent.cordis.yml 手写最小组合（仅列出角色保留的基座行）；测试用 entryListSchema（真实 loader 方言，处理 !!js 标量）解析断言。
- 附带教训：组合文件里的 !!js process.platform === 'win32' 用 js-yaml 默认 schema 解析会抛 unresolved tag；须用 entryListSchema 或自定义 schema。

### Suggested Action
已完成（Task 33）。后续做 preset 类工作时先查官方 preset 目录的组成方式（整目录副本 vs include），勿假设 include。

### Metadata
- Source: implementation (2026-08-15, T33)
- Related Files: dsh-kanban/personas/kanban-{p,w,d}/agent.cordis.yml, dsh-kanban/tests/roles/toolsets.test.ts
- Tags: agent-presets, include, yaml, preset-trim
- See Also: LRN-20260815-002, LRN-20260815-003
---

## [LRN-20260815-005] knowledge_gap — profile-boot 强制覆盖 agent-presets roots；插件 patch 加 roots 无效

**Logged**: 2026-08-15T12:35:00Z
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
设计/计划要求"cordis.patch.yml 配置 agent-presets roots 指向包内 personas/ 目录"——实测 web 启动的 composeProfile（lib/profile-boot-*.js）在组装 agent-presets 行时**强制把 roots 覆盖为官方 shipped root 单一路径**（roots: [{path: SHIPPED_PRESET_ROOT, trust:'system'}]，spread 后硬写 roots 键），任何 patch 层加的 roots 都被丢弃。唯一可发现的自定义根是 includeUserRoot:true 派生的 $DSH_HOME/.agent-presets（user trust，追加于官方根之后）。

### Details
- 关键证据：profile-boot-DG5t9aNs.js composeProfile 内 config: { ...rows.get("agent-presets")?.config ?? {}, roots: [{path: SHIPPED_PRESET_ROOT, trust:"system"}] }；AgentPresets 服务 roots 构造时解析一次、无运行时注册 API。
- 落地取舍（计划选项 3）：插件 apply() 时把包内组合复制到 $DSH_HOME/.agent-presets/kanban-{p,w,d}/（src/roles/preset-installer.ts，幂等、尽力而为——写失败仅告警不抛出，mount 失败由 runner 降级日志兜底）。组合文件仍随包分发（npm 包 files 含 personas/）。
- 附带教训：测试环境沙箱拒绝写 ~/.dsh（EPERM），installRolePresets 必须 try/catch 单 preset 失败不阻塞插件启动。

### Suggested Action
已完成（Task 33）。记录取舍到计划书 T33 与提交信息；后续涉及宿主服务配置（非插件自身行）时先核对 composeProfile/组装逻辑再设计 patch。

### Metadata
- Source: implementation (2026-08-15, T33)
- Related Files: dsh-kanban/src/roles/preset-installer.ts, dsh-kanban/src/index.ts
- Tags: agent-presets, roots, composeProfile, profile-boot
- See Also: LRN-20260815-004
---

## [LRN-20260815-006] knowledge_gap — 插件无法解析主会话真实 session id；验收核对数据源需双轨

**Logged**: 2026-08-15T12:40:00Z
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
设计 D23 要求"链完成时读主会话会话事件中 bash/fs 对 storages/kanban/workspaces/ 的写"——实测插件只知主会话**逻辑 id 'session_main'**（prefix-router/main-session-tools 硬编码），真实 DSH session id 不可解析；主会话 agent 是否在 ctx.agents.list() 中也不保证。→ 核对数据源双轨：① 活 agent 注册表扫描（非 kbn-* 会话的写能力工具事件，尽力而为）；② 产物归属核对（链工作区根下非任务 id 的无主条目，机械可测，兜底）。已在计划书 T34 与提交信息注明。

### Details
- 角色会话 id 确定（kbn-<taskId> / kbn-v-<chainId>，P1-7 派生规则），故"非 kbn- 会话写 kanban 工作区"可作为主会话越权近似。
- ChainAuditor 位于 src/dispatcher/chain-auditor.ts，依赖注入 listLiveAgents（dispatcher 注入 ctx.agents.list 适配，测试可伪造）；KanbanService.setOnChainCompleted 钩子在链完成机械规则后触发核对，异常不阻断 completeTask。
- 权限：auditWarning 仅 system；confirmAudit 仅 human（permissions.ts 新增 audit-confirm 动作）。

### Suggested Action
已完成（Task 34）。若后续 DSH 暴露主会话事件读取 API，可将源 ① 升级为精确 session 读取；当前以产物归属核对兜底已保证机械可测。

### Metadata
- Source: implementation (2026-08-15, T34)
- Related Files: dsh-kanban/src/dispatcher/chain-auditor.ts, dsh-kanban/src/domain/kanban-service.ts
- Tags: audit, main-session, session-id, anti-escalation
- See Also: LRN-20260815-001
---
## [LRN-20260817-001] knowledge_gap — 调度器从未启动 + B6 lastSeq 首启回退会跳过既有事件，V 永不建卡

**Logged**: 2026-08-17T06:20:00Z
**Priority**: critical
**Status**: resolved
**Area**: backend

### Summary
dsh-kanban 调度器在 web 环境从未启动：wireAllAvailable 60s 窗口内 agents 未就绪则静默放弃，startDispatcher 的 `if(!provider || !agents) return;` 静默早退，装配异常在异步 interval 中被吞。且 B6 ensureLastSeq 首启无状态文件时回退到**事件日志尾部 seq**，导致已有 chain/created / spec-card/approved 等可唤醒事件被跳过，V 永不建卡（链一直 executing、0 任务）。

### Details
- 现象：/plan: 建链 → 规格卡批准 → 链 executing，但 0 任务、无 dispatcher-state.json / orchestration.json、无 V 会话。
- 排查：看板快照 + events.jsonl 回放 + 新建 /plan: 测试链探测（30s 无反应）→ 判定调度器未运行（非偶发）。
- 修复：ensureLastSeq 无状态文件回退 -1（首启全量重放，B6 幂等保证不重复建卡）；tick 加 60s 超时护栏；startDispatcher 容错包裹 + dispatcher.log 文件日志；agents/kanban 缺失时落盘记录。
- 运行侧：重启前需删 dispatcher-state.json 强制重放既有事件（仅首次；之后 B6 正常持久化）。

### Suggested Action
已完成。重启验证：dispatcher.log 出现 [startDispatcher] invoked provider=true agents=true / dispatcher started / initial lastSeq=-1。

### Metadata
- Source: conversation/error (2026-08-17)
- Related Files: dsh-kanban/src/dispatcher/dispatcher.ts, dsh-kanban/src/index.ts
- Tags: dispatcher, lastSeq, event-replay, b6
- See Also: LRN-20260817-002
---

## [LRN-20260817-002] knowledge_gap — session.events 的 tool/call arguments 是 JSON 字符串，firstMatch 永不命中 → phase 不推进（W1 完成即停）

**Logged**: 2026-08-17T06:25:00Z
**Priority**: critical
**Status**: resolved
**Area**: backend

### Summary
v-orchestrator 用 `e.arguments?.['assignee']` 判断 V 是否建了对的卡（firstMatch），但 `agent.session.events` 中 tool/call 的 arguments 是 agent-loop **原样落盘的 JSON 字符串**（block.arguments），不是对象 → 取不到 assignee/mode，firstMatch 永不命中 → phase 永不推进（W1 完成后流水线停在 w1-pre）。

### Details
- 现象：W1-pre 完成即停；orchestration.json 停在 w1-pre；V 会话 turn/end completed 且 kanban_create 参数正确。
- 证据：dsh-agent-loop lib `appendToolCall` 写入 `arguments: block.arguments`（字符串）；session.events 返回 `{ type, ...data }` 展开结构。
- 修复：firstMatch 处 parseArgs（兼容 JSON 字符串 / 对象）后比对 assignee/mode。
- 附带：同一轮发现「当前阶段期望卡已 done/archived 时直接推进 phase」（避免 firstMatch 缺陷造成重复建卡）、w1-supp 对已批准规格卡跳过。

### Suggested Action
已完成。教训：读 agent 会话事件时先确认 tool/call 事件载荷形态（arguments 字符串 vs 对象），勿假设为对象。

### Metadata
- Source: error/debugging (2026-08-17)
- Related Files: dsh-kanban/src/dispatcher/v-orchestrator.ts, dsh-agent-loop/lib/index.js (appendToolCall)
- Tags: session-events, arguments, firstMatch, phase-advance
- See Also: LRN-20260817-001
---

## [LRN-20260817-003] knowledge_gap — agents.resume 对仍 live 的会话抛错；复用 live 会话走 agents.get

**Logged**: 2026-08-17T06:30:00Z
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
V 编排 `getVAgent` 复用会话走 `agents.resume({ resumeSessionId })`，但 V 会话首轮创建后一直保持 live（未 dispose），第二次 wakeV 的 resume 抛 `cannot prepare session "kbn-v-..." while it is live`，wakeV 失败、phase 卡死。正确做法：优先 `agents.get(sessionId)` 复用 live agent（followup 续用同一会话），仅当会话已下线时才 resume。

### Details
- 报错来源：dsh-session-persistence prepare() 中 `if (ctx.sessions.get(id) !== undefined) throw cannot prepare session ... while it is live`。
- AgentRegistry 有 `get(id)` 返回 store 中 live agent（agent.id === session.id）。
- 修复：getVAgent 先 `(this.agents as {get?}).get?.(orch.sessionId)`，命中则直接返回复用；未命中才 resume。

### Suggested Action
已完成。设计上「同一角色会话跨 wakeV 复用」= followup 同一 live agent，不是 resume（resume 面向下线/持久化会话）。

### Metadata
- Source: error/debugging (2026-08-17)
- Related Files: dsh-kanban/src/dispatcher/v-orchestrator.ts, dsh-session-persistence/lib/index.js (prepare)
- Tags: agents.resume, live-session, session-reuse
- See Also: LRN-20260817-002
---

## [LRN-20260817-004] knowledge_gap — session.events 条目为 {type, data:{name, arguments}}，所有 e.name/e.arguments 读取都失效

**Logged**: 2026-08-17T06:45:00Z
**Priority**: critical
**Status**: resolved
**Area**: backend

### Summary
dsh-session 的 `session.events` 条目落盘形态是 `{ type, seq, time, data: { name, arguments, ... } }`（append 时 data 嵌套在 data 键下），且 `arguments` 是 agent-loop 原样写入的 **JSON 字符串**（不是对象）。插件三处直接读 `e.name` / `e.arguments` / `e.type` 的代码全部失效：AgentRunner `used` 检测永远 false（→ 已 done 任务被误 block/fail）、v-orchestrator firstMatch 永不命中、chain-auditor 会话写证据扫描永不匹配。

### Details
- 证据：dsh-session `append()` 构造 `event = deepFreeze({ type, seq, time, data: dataSnapshot, ... })`；agent-loop `appendToolCall` 写 `arguments: block.arguments`（字符串）。
- 影响：P 卡完成后报 `done --task/blocked-->` / `done --task/failed-->`（used 误判 idle → 对已 done 任务 block/fail）。
- 修复：新增 `src/dispatcher/session-events.ts` 统一助手 `eventType`/`toolName`/`toolArgs`（兼容 `{type,data}` 与顶层两种形态、arguments 兼容字符串/对象），三处消费点全部改用。

### Suggested Action
已完成（155/155 测试过）。教训：读 agent 会话事件前先确认 dsh-session 的 append 落盘结构（`data` 嵌套 + JSON 字符串 arguments），勿假设顶层展开。

### Metadata
- Source: error/debugging (2026-08-17, P 卡住)
- Related Files: dsh-kanban/src/dispatcher/session-events.ts, agent-runner.ts, v-orchestrator.ts, chain-auditor.ts
- Tags: session-events, data-nesting, arguments-string, systemic
- See Also: LRN-20260817-002
---

## [LRN-20260817-005] knowledge_gap — w2/w3 同为 (w,kb)，按 assignee+mode 无法区分阶段归属

**Logged**: 2026-08-17T06:50:00Z
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
R20 阶段序列中 w2 与 w3 的期望卡都是 `(assignee=w, mode=kb)`。若用「当前 phase 的期望 (assignee,mode) 匹配到已终态 existing 卡即认为本阶段完成」来推进 phase，w3 会把 w2 已完成卡误判为 w3 卡 → 推进到 summary 且不建 w3（流水线提前结束）。

### Details
- 触发：wakeV 循环里 existing-done → 直接推进 phase 的恢复逻辑，在 w2/w3 上产生歧义。
- 修复：仅当当前 phase 的 (assignee,mode) 在 R20_PHASE_EXPECT 中**唯一**（sameExpectCount===1）时才做 existing-done 推进；w2/w3 共享时走原逻辑（只拦截未终态卡，已终态则新建下一张卡）。
- 局限：任务上未落阶段标记，靠「唯一性」规避；若需精确归属建议按创建序计数或任务加 phase 字段。

### Suggested Action
已完成。建议后续在任务体/元数据落 phase 标记，彻底消除同 (assignee,mode) 阶段的歧义。

### Metadata
- Source: test/debugging (2026-08-17)
- Related Files: dsh-kanban/src/dispatcher/v-orchestrator.ts, tests/dispatcher/v-orchestrator.test.ts
- Tags: phase, w2, w3, assignee-mode-collision
- See Also: LRN-20260817-004
---


