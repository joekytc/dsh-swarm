# AGENTS.md — dsh-kanban 开发指南

> 给在本仓库工作的 AI agent 的运行时指令集。README 讲"是什么"，本文件讲"怎么改不出错"。
> 铁律：所有业务改动从领域层（纯 TS）出发，领域层禁止依赖任何 DSH 运行时。

## 1. 常用命令（完整标志）

```bash
npm run typecheck   # npx tsc -p tsconfig.json --noEmit（0 错误才过）
npm test            # npx vitest run（tests/**/*.test.{ts,tsx}，node 环境）
npm run build       # tsc -p tsconfig.build.json && node scripts/build-client.mjs（产出 lib/ + lib/client.js）
python tests/e2e/gui-check.py --url http://127.0.0.1:3080/   # GUI 验证（需已运行 dsh web 实例）
```

- 部署生效需重载运行中的 DSH 实例（127.0.0.1:3080）；仅 build 不会热更新运行中插件。
- 禁止在测试时启动第二个 dsh 实例。

## 2. 架构与目录（改动定位）

- `src/domain/`（纯 TS，**禁止 import 任何 `@deepseek-ai/*`**）：event-store、state-machine、projection、permissions、kanban-service、delivery-contract/evidence、review-evidence、prefetch-manifest、task-parents、types
- `src/tools/`、`src/routes/`（cordis 集成）：kanban_*、spec_card_*、wiki_*、prefetch_*、/kanban/* HTTP+SSE
- `src/dispatcher/`：event-waker、v-orchestrator（R20 阶段机）、agent-runner、watchdog、chain-auditor、merge-gate、model-candidates、git-credentials、target-repo、session-events
- `src/roles/` + `personas/`：6 个裁剪 preset 与每角色工具面
- `client/`：React 半标签页 + board-store（快照+SSE+seq 缺口重拉）+ workflow-model（纯投影）

## 3. 领域规则（改前必读）

- **交付契约**（delivery-contract.ts）：`w:file`→`ref`；`w:kb`→`kb_url`+`page_path`；`p:openspec`→`artifacts_path`。缺键阻塞当前卡，且 V 在缺交付父卡上不建下游卡（missingParentDelivery）。
- **预取 manifest**（prefetch-manifest.ts）：仅 `w:file` 且带 manifest 才 schema 校验；非法阻塞；缺省不阻塞（legacy 兼容）。
- **任务父级**（task-parents.ts）：只解析 done/archived 父卡；`w:kb` 特判 w3→D、w2→P。父卡缺交付发 `[delivery-required]` 评论并停住。
- **PT 判定**（judgePTNeeded）：`review_override` 优先；hard_flags 非空或 soft_count≥2→建 PT；未声明→跳过。判定是系统确定性逻辑，V 只建卡不自判。
- **done 不可变**：评审失败不改写 done 卡，走 createReworkTask 新返工卡（继承 resumeSessionId、reviewAttempt+1）；超 maxReworksPerRole（pt=2/dt=3）→ review/gave-up + `[review-final]`。

## 4. 踩坑经验（每条都改错过，勿重复踩）

1. **会话作用域**：`ctx.get('agents').list()` 返回整个 DSH 进程所有活会话（含其他项目主会话）。扫描必须用 `Chain.workspaceDir` + `isPathInside(session.header.cwd, workspaceDir)` 收窄。路由只用逻辑 id `'session_main'`，匹配不到真实会话 id。
2. **会话事件形态**：`session.events` 条目落盘为 `{ type, seq, time, data:{...} }`，name/arguments 在 `e.data` 下（也可能顶层展开）。一律经 `src/dispatcher/session-events.ts` 的 `toolName/toolArgs/eventType` 读取，不要直接 `e.name`。
3. **run_code 写判定**：看实际派发子调用 `tool/code-dispatch-start`/`tool/code-dispatch`，按 `rootCallId` 关联外层 `tool/call` 的 `callId`。直接写工具=write/edit/rm/mv/cp/mkdir/mkfile；bash 需命中写标记；read/glob/grep 与只读 bash 不算写。
4. **bash 写标记正则**：重定向用 `\s>>?`（`>` 前必须有空白），否则 `2>/dev/null`、`2>&1` 只读重定向被误判为写。此正则在 toolsets.ts 与 chain-auditor.ts 各一份，改动须两处同步。
5. **模板字符串写正则**：`\b` 变退格符(U+0008)、`\s` 变裸 s，正则静默失效。必须双重转义 `\\b`/`\\s`；写盘后 `xxd`/sed 抽查字节（应见 0x5c 0x62 / 0x5c 0x73）。
6. **V 编排上下文膨胀**：勿每次 wakeV 注入完整规格卡+全任务列表而不压缩。V 会话保持 live 时优先 followup 续用，勿重复 create/resume。
7. **human 强制收尾**：所有 actor（含 human GUI complete）都过交付契约闸。曾有 human 缺交付强制完成致下游报错，去掉豁免才修复——勿再加回豁免。

## 5. 代码风格

- TS：target ES2023 / module NodeNext，相对导入必须带 `.js` 后缀（如 `./config.js`）。
- `verbatimModuleSyntax`：类型导入必须用 `import type`。
- `erasableSyntaxOnly`：禁止 enum/namespace 等需运行时类型发射的语法。
- 领域层写纯函数；校验器返回错误数组（如 validatePrefetchManifest 返回 string[]，空数组=合法）。

## 6. 边界

### Always do
- 改领域层后：typecheck 0 错误 + vitest 全绿 + build 成功才提交。
- 消费/新增会话事件时统一走 session-events.ts。
- 新增写判定逻辑时与 toolsets.ts 的 BASH_WRITE_RE 对齐。

### Ask first
- 改交付契约必需键 / manifest schema / 权限矩阵（permissions.ts）——影响所有角色与现有链路。
- 改 R20_PHASE_ORDER 或阶段建卡/跳过规则。
- 改配置 schema 与默认值（config.ts）。

### Never do
- 领域层 import 任何 `@deepseek-ai/*` 包。
- 主会话/角色 agent 调 kanban_create 建链建卡（只经 /plan:、/openspec: 路由；角色只建本阶段卡）。
- 角色 agent 批准规格、unblock、audit-confirm（仅人类；system 只做机械记账）。
- 修改 done 卡或重标 blocked（done 不可变）。
- D/DT 合并或推送 TARGET_BRANCH（只推 feature 分支；合入由 merge-gate 在 DT 通过后执行）。
- 测试中启动第二个 DSH 实例。

## 7. Git 工作流（本仓库开发）

- D 卡：worktree feature 分支实现 → `[AI-GEN]` 提交 → 推送 feature 分支 → complete 带 `branch` + `changed_files` + `commit_hash`。
- DT 评审 `--from <TARGET_BRANCH> --to <feature-branch>`，评审目标=D 交接 metadata.branch，非 TARGET_BRANCH。
- 系统合入（merge-gate.ts）：checkout TARGET_BRANCH → merge --no-ff feature → push；幂等（`[merge-done]` 或 git merge-base --is-ancestor）；失败记 `[merge-failed]` 不抛错（方向安全）。
- 链完成钩子先 chain-auditor（孤儿写入告警→人工 audit-confirm），后 merge-gate。
