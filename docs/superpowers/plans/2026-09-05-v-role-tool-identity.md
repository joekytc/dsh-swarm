# V 角色工具与身份稳定性实施计划

> 目标：恢复 V agent scoped kanban_create 能力，阻断错误 persona/session 复用，并用真实 DSH scoped runtime 验证；随后完成缓存取证与版本治理。

## 架构与边界

- 工具定义继续位于 src/tools/kanban-tools.ts，角色装配继续位于 src/roles/toolsets.ts。
- 注册必须发生在真实 agentCtx scoped context；不改成全局注册。
- V 仍是唯一可 kanban_create 的角色；主会话、P/W/D/PT/DT 权限不扩张。
- setup 采用原子语义：preset、registry、工具可见性任一步失败，create/resume 失败，不写健康 marker。
- 事件读取继续统一经 src/dispatcher/session-events.ts；不修改领域层依赖边界、R20 阶段顺序、交付契约。

## 任务包

### Task 1：P0 原子角色装配

Files: src/roles/toolsets.ts, src/dispatcher/v-orchestrator.ts, src/dispatcher/agent-runner.ts, focused tests.

- 将 registry 缺失从日志+return 改为可识别失败。
- agentPresets 服务缺失直接失败；mount 成功后验证 preset identity。
- installRoleTools 返回注册来源/注册名，或提供等价机械结果。
- 注册后在 agent scope 查询必需工具；失败禁止写 marker。
- 保持 fallback 仅用于兼容，不允许 plain registry 静默冒充 agent scope。
- RED：新增失败路径测试，证明当前实现会错误成功或错误复用。
- GREEN：最小实现。
- 验证：focused role/orchestrator tests、typecheck。

### Task 2：P1 V live session 身份校验

Files: src/dispatcher/v-orchestrator.ts, src/dispatcher/agent-runner.ts, tests.

- 校验 session id、chain workspace/cwd、kanban-v preset、scope tool view。
- marker 缺失/不匹配/工具不可见时禁止直接复用。
- 确认宿主 live session 安全处置路径；无法安全修复时显式失败并进入 stall，不盲目 resume live session。
- 覆盖 GUI 重开同名会话、历史 agentPreset=null、跨 workspace 会话。

### Task 3：真实 DSH scoped integration tests

Files: tests/fixtures or tests/roles/toolsets.integration.test.ts, minimal test helpers only.

- 使用 DSH rc.1 真实 tool runtime/scoped context。
- 验证 tools.view(agent).visible、get('kanban_create', agent)、wireSchemas(agent)。
- 验证实际 execute 产生 task/created。
- 验证主会话和其他角色不可见；inherited restriction 不误删 own registration。
- 不接受只收集 fake register 调用作为通过依据。

### Task 4：P2 缓存与首轮身份取证

Files: src/dispatcher/v-orchestrator.ts, src/dispatcher/session-events.ts, tests/docs as needed.

- 从原始 session JSONL 机械读取 replayState、usage、tool/call、tool/result。
- 明确区分 preset 错误、live 复用错误、gateway from-cache。
- from-cache + zero usage/calls/output 进入既有 stall；正常响应不误判。
- 增加诊断字段，不用 persona 文案替代运行时证据。
- 不改缓存行为，除非原始事件确认后再提出独立变更。

### Task 5：P2 peer 版本治理

Files: package.json, lockfile only if required, compatibility test/docs.

- 根据 rc.1 实测结果收窄 peer 范围。
- 启动时输出宿主关键版本或增加兼容检查。
- 不与 P0/P1 混合，避免版本改动掩盖根因。

## 每包审查门

1. implementer 子代理只处理一个任务包，先写失败测试再实现。
2. controller 检查 diff、测试输出、改动范围。
3. 独立 reviewer 审查 spec compliance、scope、回归风险。
4. Critical/Important 必须修复并重新审查；Minor 记录，不静默丢弃。
5. 任务包审查干净后才进入下一包。

## 最终验证

- rtk npm run typecheck
- rtk npm test
- rtk npm run build
- 现有 http://127.0.0.1:3080 刷新后 GUI smoke；不启动第二实例。
- 新 V 会话：agentPreset=kanban-v、正确 cwd、可见 kanban_create、真实 tool/call/result。
- 负向：主会话及非 V 角色不可见建卡工具。
- 完成后写经验沉淀，记录根因、证据、失败模式、回归防线。
