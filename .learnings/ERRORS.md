# Errors

> 看板插件（dsh-kanban）开发中遇到的错误与踩坑。格式遵循 self-improvement skill。

## [ERR-2026-08-17-001] template_literal_regex_mangling

**Logged**: 2026-08-17T11:25:48.012Z
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
用模板字符串（反引号）写含正则的源码时，`\b` 被解释为退格符（U+0008）、`\s` 被丢弃为裸 `s`，正则静默失效，两个测试莫名失败且难以定位。

### Error
写入文件后的正则形如：
```
/(?: (?:touch|mkdir|rm|... ) | gits+(?:add|...) | ... |>>?)/i
```
（`\b` 变成 U+0008，`\s` 变成裸 s；只有 `>>?` 幸存，导致只读命令里的 `2>` 反而被误命中）

### Context
- 操作：在 run_code 里用模板字符串生成 chain-auditor.ts 全文再写盘
- 输入：模板里写 `\b`、`\s`
- 环境：TypeScript 模板字面量会处理 `\b` 等转义序列

### Suggested Fix
模板字符串中写正则必须双重转义（`\\b`/`\\s`）；写盘后立即用 `xxd`/sed 抽查目标行字节，确认反斜杠+字母（0x5c 0x62 / 0x5c 0x73）而非 U+0008。

### Metadata
- Reproducible: yes
- Related Files: src/dispatcher/chain-auditor.ts
- See Also: ERR-2026-08-17-002

### Resolution
- **Resolved**: 2026-08-17T11:25:48.012Z
- **Notes**: 全部正则转义改为 \\b/\\s 并追加 \s>>? 收紧重定向；xxd 验证通过，11/11 测试通过。

---

## [ERR-2026-08-17-002] sandbox_out_of_workspace_write

**Logged**: 2026-08-17T11:25:48.012Z
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
会话工作区（/Users/jc/Documents/work/workspace/dsh-dashboard）之外的目标（/Users/jc/Documents/awsome-dsh-plugins/dsh-kanban）执行写操作被 workspace-write 沙箱拒绝。

### Error
`[sandbox: file access denied under workspace-write mode]`，提示可一次性升级（`sandbox_permissions` + justification）。

### Context
- 操作：修改 dsh-kanban 插件源码（在评估目录，非当前会话工作区）
- 输入：tools.write / tools.edit / bash 指向 /Users/jc/Documents/awsome-dsh-plugins/dsh-kanban
- 环境：DSH 沙箱 workspace-write 策略；后用户将文件策略改为 danger-full-access、审批策略改为 never（此后不得再设置 sandbox_permissions）

### Suggested Fix
1. 先尝试当前模式，遇 denial 用最小必要模式升级（同次调用重试一次，带 justification，审批弹窗由用户放行）；
2. 用户已把策略设为 never + danger-full-access 时，**禁止再传 sandbox_permissions**（会直接报"不是严格更宽模式"错误）。

### Metadata
- Reproducible: yes
- Related Files: (harness 沙箱策略)
- See Also: ERR-2026-08-17-001

### Resolution
- **Resolved**: 2026-08-17T11:25:48.012Z
- **Notes**: 升级 danger-full-access 完成跨工作区写入；策略变更后移除 sandbox_permissions 参数。

---

---

> 以下为历史错误记录，自 /Users/jc/Documents/awsome-dsh-plugins/.learnings 迁移合并（2026-08-17）。

## Errors — dsh-kanban 运行期错误记录

> 用途：记录看板调度/角色 agent 运行期错误，沉淀可复现与修复线索。

## [ERR-20260817-001] dispatcher/wakeV — W1 完成后流水线停止（live session + done--task/failed）

**Logged**: 2026-08-17T06:35:00Z
**Priority**: critical
**Status**: resolved
**Area**: backend

### Summary
V 完成 w1-pre 建卡后，W1 任务完成事件触发第二次 wakeV，失败并停止流水线。dispatcher.log 两条报错：`illegal transition: done --task/failed--> (none)` 与 `cannot prepare session "kbn-v-<chainId>" while it is live`。

### Error
```
2026-08-17T05:39:29.553Z [tick] error: Error: illegal transition: done --task/failed--> (none)
2026-08-17T05:39:30.972Z [tick] wakeV failed ev=12 chain=ch_1_mswq8wut: Error: cannot prepare session "kbn-v-ch_1_mswq8wut" while it is live
```

### Context
- 操作：W1-pre 任务完成后，event-waker 对 task/completed 事件调用 wakeV(chainId)。
- 环境：dsh-kanban 插件（web profile，3080），roles 由 dispatcher 创建。
- 可复现：是（每次 W1 完成后必现）。

### Root Cause
1. getVAgent 复用会话走 agents.resume，但 V 会话首轮后仍 live → resume 抛 cannot prepare session while it is live（dsh-session-persistence prepare 守卫）。
2. 角色 agent 对已 done 任务再次 failTask（AgentRunner 收尾路径）→ 状态机拒绝 done --task/failed-->。

### Resolution
- **Resolved**: 2026-08-17T06:00:00Z
- **Files**: dsh-kanban/src/dispatcher/v-orchestrator.ts, dsh-kanban/src/dispatcher/dispatcher.ts
- **Notes**: getVAgent 改为优先 agents.get(id) 复用 live 会话；firstMatch 解析 JSON 字符串 arguments；阶段期望卡 done 时直接推进 phase；tick 加 60s 超时护栏。详见 LRN-20260817-001/002/003。

### Metadata
- Reproducible: yes
- Related Files: dsh-kanban/src/dispatcher/v-orchestrator.ts, dsh-kanban/src/dispatcher/dispatcher.ts
- See Also: LRN-20260817-002, LRN-20260817-003
---

## [ERR-20260817-002] 沙箱 — 工作区外写插件源码/看板存储被拒（workspace-write）

**Logged**: 2026-08-17T06:40:00Z
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
编辑 /Users/jc/Documents/awsome-dsh-plugins/dsh-kanban 源码与写 /Users/jc/.dsh/storages/kanban 均被 DSH 文件沙箱拒绝（workspace-write 只允许会话工作区）；升级权限的审批提示在无人应答时超时（600s）。

### Error
```
[sandbox: file access denied under workspace-write mode]
bash: /Users/jc/.dsh/storages/kanban/dispatcher-state.json: Operation not permitted
Error: code run failed (timeout): wall-clock ceiling reached (600000ms)
```

### Context
- 操作：edit 插件源码 / 写 kanban 存储 / ask_user_question 确认。
- 环境：DSH 文件策略 workspace-write；approval policy ask。

### Resolution
- **Resolved**: 2026-08-17T06:50:00Z（用户授权 danger-full-access 后恢复）
- **Notes**: 用户明确授权后沙箱放宽（danger-full-access）；后续审批提示被禁用。

### Metadata
- Reproducible: yes（workt workspace 外的写一律触发）
- Related Files: /Users/jc/Documents/awsome-dsh-plugins/dsh-kanban
- Tags: sandbox, workspace-write, approval-timeout
---

## [ERR-20260817-003] agent-runner — 已 done 任务被误 block/fail（done --task/blocked--> / done --task/failed-->）

**Logged**: 2026-08-17T06:55:00Z
**Priority**: critical
**Status**: resolved
**Area**: backend

### Summary
P(openspec) 任务完成后，AgentRunner 对已 done 任务调 blockTask 抛 `illegal transition: done --task/blocked--> (none)`，异常又被 catch 转 failTask 抛 `done --task/failed--> (none)`，在 dispatcher.log 反复出现。

### Error
```
[dsh-kanban][debug] runner error t_1_mswtnrje: Error: illegal transition: done --task/blocked--> (none)
[dsh-kanban][debug] tick error: Error: illegal transition: done --task/failed--> (none)
```

### Context
- 操作：P 角色 agent 已完成任务（调用 kanban_complete）后，AgentRunner 的协议违规检测。
- 环境：dsh-kanban web profile（3080），角色 agent 会话 kbn-t_<taskId>。
- 可复现：是（所有完成任务的角色 agent 都会触发，W1 也中招过）。

### Root Cause
`used` 检测 `agent.session.events.some(e => e.name === 'kanban_complete')` 中 `e.name` 取不到（实际在 `e.data.name`）→ 恒 false → 误判 idle → 对已完成任务 blockTask。

### Resolution
- **Resolved**: 2026-08-17T07:00:00Z
- **Files**: dsh-kanban/src/dispatcher/session-events.ts, agent-runner.ts
- **Notes**: `used` 改用 `toolName(e)`（读 `e.data.name`）；blockTask/failTask 加终态防御。详见 LRN-20260817-004。

### Metadata
- Reproducible: yes
- Related Files: dsh-kanban/src/dispatcher/agent-runner.ts
- See Also: LRN-20260817-004
---

