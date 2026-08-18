# Feature Requests

> 看板插件（dsh-kanban）能力完善建议。格式遵循 self-improvement skill。

## [FEAT-2026-08-17-001] main_session_exact_id

**Logged**: 2026-08-17T11:25:48.012Z
**Priority**: medium
**Status**: pending
**Area**: backend

### Requested Capability
在链上记录主会话的**真实会话 id**，让审计/汇报/权限判定能精确限定到发起 /plan: 的主会话，而不是用 `Chain.workspaceDir` + "非角色会话"近似。

### User Context
当前 ownerSessionId 是逻辑 id 'session_main'，无法直接匹配真实会话 id；审计只能靠工作区路径过滤，遇到"同一工作区多个会话"或 cwd 缺失的边界仍可能误判/漏判。

### Complexity Estimate
medium

### Suggested Implementation
- `kanban_route` 的 execute 已能拿到 `exec.agent.session.header`，可同时捕获真实 session id（如 `session.header.id` 或 `session.id`）存入 Chain（新增字段或并入 ownerSessionId 附近）
- ChainAuditor.check 优先按 owner 真实 id 精确过滤，缺失时回退 workspaceDir 近似
- 注意：session id 为 DSH 内部标识，跨重启是否稳定需验证

### Metadata
- Frequency: first_time
- Related Features: D23 链完成验收核对

---

## [FEAT-2026-08-17-002] audit_evidence_paths

**Logged**: 2026-08-17T11:25:48.012Z
**Priority**: low
**Status**: pending
**Area**: backend

### Requested Capability
审计证据（AuditEvidence.paths）细化到具体写入路径/命令，并在 GUI 警告区展开显示，便于人工核对"确认产物归属"。

### User Context
现在 direct write 工具的路径证据收集的是整个参数串，run_code/bash 是整条命令；GUI 只显示线索条数，人工核对时看不清到底写了什么。

### Complexity Estimate
simple

### Suggested Implementation
- 直接写工具从 args 提取 path/file_path 字段精确到单个路径
- bash/run_code 从命令中提取含工作区路径的 token
- WorkflowRail.tsx 警告区按 evidence 展开路径列表

### Metadata
- Frequency: first_time
- Related Features: chain/audit-warning 视图

---
