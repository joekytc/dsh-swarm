# AGENTS.md — dsh-swarm 开发指南

> 给在本仓库工作的 AI agent 的运行时指令集。README 讲"是什么"，本文件讲"怎么改不出错"。
> DSH 插件通用规范以 `dsh-plugin-dev` skill 为权威（硬规则、场景工作流、完成前清单）；本文件只写本仓库的落地差异与领域特例，不重复通用内容。
> 铁律：所有业务改动从领域层（纯 TS）出发，领域层禁止依赖任何 DSH 运行时。

## 1. 仓库布局（改动定位）

| 目录 | 职责 |
| --- | --- |
| `src/domain/` | 领域层：纯 TS 事件溯源看板（事件存储/状态机/投影/权限/交付契约）。**禁止 import 任何 `@deepseek-ai/*`** |
| `src/services/` | 插件服务：KanbanProvider、ConfigProvider、im-delivery、llm-catalog |
| `src/tools/` | 主会话模型工具：spec_card_*、kanban 只读子集、wiki_*、prefetch_*、前缀路由 |
| `src/routes/` | Web GUI 数据桥：`/kanban/*` HTTP+SSE |
| `src/dispatcher/` | 调度层：event-waker、v-orchestrator（阶段机）、agent-runner、watchdog、chain-auditor、merge-gate、session-events |
| `src/roles/` + `personas/` | 6 个角色裁剪 preset 安装与阶段指令模板 |
| `src/wiki/` | wiki 客户端 |
| `src/config.ts` | Schemastery 配置 schema 与默认值 |
| `src/index.ts` | `apply()` 入口：服务创建 + wireAllAvailable 延迟接线 |
| `client/` | Web 前端：React 半标签页 + board-store（快照+SSE+seq 缺口重拉）+ workflow-model（纯投影） |
| `tests/` | vitest（node 环境）+ `e2e/gui-check.py` GUI 冒烟 |
| `cordis.patch.yml` | 组合 patch：按包名引用插件行 |

## 2. 命令与验证回路

```bash
npm run typecheck   # tsc -p tsconfig.json --noEmit（0 错误才过）
npm test            # vitest run（tests/**/*.test.{ts,tsx}）
npm run build       # tsc -p tsconfig.build.json && node scripts/build-client.mjs（产出 lib/ + lib/client.js）
python tests/e2e/gui-check.py --url http://127.0.0.1:3080/   # GUI 冒烟（需运行中的 dsh web 实例）
```

验证面与改动面对齐，不默认全量：

- `src/domain/**` → typecheck + 领域 vitest + build。
- 改 stall/看门狗 → 必须同步三层测试（v-orchestrator、dispatcher、domain 状态机）。
- `client/**` → client vitest + `build:client`。
- 配置 schema → `dsh --dump-config` 核对 + config 测试。

部署生效需重载运行中的 DSH 实例（127.0.0.1:3080）；仅 build 不热更新运行中插件。禁止测试时启动第二个 dsh 实例。

## 3. 插件约定（DSH 规范在本仓库的落地）

- **领域层纯净**：业务逻辑一律从 `src/domain/` 纯函数出发；运行时交互只能在外圈（services/tools/routes/dispatcher）。
- **注册即副作用**：一切注册经 ctx（工具/事件/服务），随插件卸载清理；不建模块级单例。cordis 4 中 Service 构造即注册（`super(ctx,name)`），无需手动 provide。
- **依赖声明**：必需服务 inject，可选服务 `ctx.get()` 判空；多服务就绪后再接线用 `wireAllAvailable`（index.ts）。
- **配置一律 Schemastery**（config.ts）：部署可能改值的参数必须进配置，默认值写在 schema 里，禁止写死 tunables。
- **失败要响亮**：配置/交付契约校验失败明确报错并阻塞，不静默吞。有意例外：merge-gate 失败只记 `[merge-failed]` 不抛错（合入方向安全）。
- **模型可见即已记录**：新增模型可见输入必须落在会话日志可重建机制内；读取会话事件一律经 `session-events.ts`（`toolName/toolArgs/eventType`），禁止直接读 `e.name`——落盘形态是 `{type,seq,time,data}` 且 name/arguments 可能在 `data` 下或顶层展开。
- **工具 execute 返回规范 JSON 值**；面向人类的文本走 `output.render`。
- **上游 peer 包是 pre-stable**（`@deepseek-ai/*` 0.1.x-rc）：API 变更须同步更新所有消费点；不改 DSH 官方源码，适配差异收敛在本仓库。

## 4. 领域不变式（改前必读）

- **交付契约**（delivery-contract.ts）：`w:file`→`ref`；`w:kb`→`kb_url`+`page_path`；`p:openspec`→`artifacts_path`。缺键阻塞当前卡，且 V 在缺交付父卡上不建下游卡（missingParentDelivery）。所有 actor（含 human GUI complete）都过此闸，无豁免。
- **预取 manifest**（prefetch-manifest.ts）：仅 `w:file` 且带 manifest 才 schema 校验；非法阻塞；缺省不阻塞（legacy 兼容）。
- **任务父级**（task-parents.ts）：只解析 done/archived 父卡；`w:kb` 特判 w3→D、w2→P。父卡缺交付发 `[delivery-required]` 评论并停住。
- **PT 判定**（pt_decision）：P 卡 complete 时 handoff metadata 必须带 `pt_decision = { needed, reason? }`（needed=true 时 reason 必填，硬闸；缺则 blocked）。`needed=false` → V 跳过 PT 直接进 W2。判定输入 = P 的交接（V 只读不自判）；复杂度清单写在 V 建 P 卡的模板（PHASE_INSTRUCTIONS.p）。
- **P/PT 收敛闸**（v-orchestrator.handleReviewCompletion）：仅 PT + 复审轮（reviewAttempt≥1）生效——旧账清零（无未修复 legacy 条目）且无未解决 critical 时，fail 降级为 pass（新问题转下游「评审遗留建议」+ `[review-final]` 留痕）。PT 须给对账条目标 `legacy: true`；complete 闸另有口径锁死：PT 判 fail 必须至少一条未解决 critical/high。
- **done 不可变**：评审失败不改写 done 卡，走 createReworkTask 新返工卡（独立会话 `kbn-<reworkId>`，resumeSessionId=null；reviewAttempt+1；body 追加「本轮修复清单」携带上一轮 issues 全文）；超 maxReworksPerRole（pt=3/dt=3）→ review/gave-up + `[review-final]` + IM「评审超限待裁决」。
- **人工出口仅 human**：`kanban_waive_review`（评审豁免，reviewStatus∈{failed,gave-up}→waived）/ `kanban_reopen_chain`（blocked→executing）。GUI：任务详情「豁免评审」/ 链头「人工恢复」；HTTP：`POST /kanban/action {type:waive-review|reopen-chain}`；服务层 `can()` 仅 human。
- **停滞四防线**：wakeV 异常落盘（dispatcher.log）→ V 内建 stall（异常收场也计数）→ /openspec: 同步等首卡（fail-open）→ dispatcher 链级看门狗（90s×重唤醒3次 → `[create-failed]` + chain/blocked）。
- **链完成钩子顺序**：先 chain-auditor（孤儿写入告警→人工 audit-confirm），后 merge-gate（checkout TARGET_BRANCH → merge --no-ff feature → push；幂等：`[merge-done]` 或 merge-base --is-ancestor）。

## 5. 运行时事实（易错边界，规则化记录）

- **会话扫描作用域**：`ctx.get('agents').list()` 返回整个 DSH 进程所有活会话（含其他项目主会话）。扫描必须用 `Chain.workspaceDir` + `isPathInside(session.header.cwd, workspaceDir)` 收窄。逻辑 id `'session_main'` 匹配不到真实会话 id，路由不能只靠它。
- **写判定**：run_code 看实际派发子调用 `tool/code-dispatch-start`/`tool/code-dispatch`，按 `rootCallId` 关联外层 `tool/call` 的 `callId`。直接写工具=write/edit/rm/mv/cp/mkdir/mkfile；bash 需命中写标记；read/glob/grep 与只读 bash 不算写。bash 重定向写标记正则用 `\s>>?`（`>` 前必须有空白，否则 `2>/dev/null`、`2>&1` 只读重定向被误判为写）；此正则在 toolsets.ts 与 chain-auditor.ts 各一份，改动须两处同步。
- **模板字符串写正则**：`\b` 变退格符(U+0008)、`\s` 变裸 s，正则静默失效。必须双重转义 `\\b`/`\\s`；写盘后 `xxd`/sed 抽查字节（应见 0x5c 0x62 / 0x5c 0x73）。
- **网关缓存回放（from-cache）**：远程网关回复缓存键对 messages 前缀/工具结果不敏感，可能把旧回复整包回放给不同请求（`responseModel='from-cache'`、usage 0/0、零工具调用）——口播可与工具结果完全脱节。判定一律以 session.jsonl 的 tool/result 为准；V 轮零产出+from-cache 由 v-orchestrator 按 stall 处理。
- **V 上下文纪律**：wakeV 勿每次注入完整规格卡+全任务列表而不压缩；V 会话保持 live 时优先 followup 续用，勿重复 create/resume。

## 6. 代码风格

- TS：target ES2023 / module NodeNext，相对导入必须带 `.js` 后缀（如 `./config.js`）。
- `verbatimModuleSyntax`：类型导入必须用 `import type`。
- `erasableSyntaxOnly`：禁止 enum/namespace 等需运行时类型发射的语法。
- 领域层写纯函数；校验器返回错误数组（如 validatePrefetchManifest 返回 string[]，空数组=合法）。
- 注释黑话禁令：注释禁止出现内部编号黑话（`Task xx`/`Txx`/`Rxx`/`Bx`/`Mx`/`Cx`/`Qx`/`P0-x`/`A1`/`D22`/`spec FRx`/「设计 §x」/「grill Qx」等）——直接用简约语义说明（例：「Task 7：收 ConfigProvider」→「收 ConfigProvider」）。纯变更记录型注释（仅为某任务做过什么的留痕）整条不写。必须保留的注释：废弃/兼容性说明、踩坑警告、协议标记、正则与边界约束等技术语义。角色代号（V/P/W/D/DT/PT）与阶段名（W2/W3）不是黑话，可正常使用。

## 7. 边界

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
- D/DT 子代理写链工作区根（workspaces/<chainId>/ 下非任务条目）——chain-auditor 无主产物核对仍会抓。
- 手动 emit `chain/blocked`（仅看门狗/V stall 超限经 `KanbanService.blockChain` 的 system 机械记账可产生；人工恢复=删链重跑）。

## 8. 维护本文件

- 只写 durable 规则与边界；变更叙事（何时改的、哪个需求改的）进 git log / wiki，不进本文件。
- 踩坑经验沉淀为第 3/4/5 节的可执行规则后，删除故事性叙述与日期戳。
- 每条规则自包含；精简优先，不为留痕扩容。
