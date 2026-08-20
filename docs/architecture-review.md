# dsh-kanban 工作链路 架构审查报告

## 一、总结报告

这是一套 **"规划-评审-执行"分层 + 事件驱动的多角色 agent 编排链**，核心设计支柱清晰且自洽：

| 支柱 | 落地 |
|---|---|
| **角色单一职责** | V(编排/只路由)→P(计划)→PT(计划评审)→W(知识桥)→D(唯一执行)→DT(交付评审)，经 `R20_PHASE_EXPECT` 硬编码成状态机 |
| **权限最小化** | [permissions.ts](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/domain/permissions.ts) session-bound(`boundTaskId`)+actor 矩阵；preset 裁剪 + ToolGuard 只读护栏 |
| **证据化交付** | [delivery-evidence.ts](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/domain/delivery-evidence.ts)、[review-evidence.ts](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/domain/review-evidence.ts) 机械校验，无证据不闭合 |
| **反脆弱** | 协议违规熔断→gave_up、返工护栏(maxReworksPerRole)、阻塞复核 blocked-review、[blocked-final]/[review-final] 证据链、事件日志 lastSeq 幂等恢复、watchdog 心跳回收 |
| **可审计** | [chain-auditor.ts](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/dispatcher/chain-auditor.ts) 主会话越权写 + 无主产物核对、[dispatcher.log](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/dispatcher/dispatcher.ts#L80-L82) 落盘 |

**定位**：这是一套"正确性优先、人为信任锚(human)只做批准/确认"的工程质量链。做得对的地方：状态机确定性、幂等防重、证据闭链、纵深防御。**短板集中在：流程顺序、成本/预算、真实性验证、可观测性、human 插话点**五类。

---

## 二、不足之处 + 质量优化建议

### 高优（影响正确性/安全）

**1. D 在 DT 评审通过前已 merge+push（流程顺序缺陷）**
- 现状：D persona 规则([kanban-d/agent.cordis.yml#L33-L36](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/personas/kanban-d/agent.cordis.yml#L33-L36))要求 `worktree → 实现 → verify → commit → merge back TARGET_BRANCH → push`，然后才进 DT。且 [delivery-evidence](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/domain/delivery-evidence.ts#L20-L24) 要求 commit_hash/push 之一才准 complete——**这反而逼 D 在评审前就推远程**。
- 风险：DT fail → 只能返工，但坏代码已进目标分支，污染主仓、无回滚。
- 建议（非破坏性）：保留 worktree 隔离 + commit + **只推 feature 分支/发 MR**，把 `merge back TARGET_BRANCH` 的动作后置到 DT pass 后由 system/human 执行；delivery-evidence 改判 `push 到 feature 分支` 即算证据。core 思想(证据化)不变，只调合入时点。

**2. W1 预取无结构化契约**
- 现状：模板只写"目标文件基线"([v-orchestrator.ts#L68-L70](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/dispatcher/v-orchestrator.ts#L68-L70))，具体取哪些文件由 V 即兴决定，`prefetch_file` 只登记 ref 不校验内容([wiki-worker.ts#L25-L29](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/roles/wiki-worker.ts#L25-L29))。
- 风险：预取不足→P 缺源码依据→要么瞎编计划被 PT 拦，要么返工重取。
- 建议：引入 **结构化 prefetch manifest**（file glob 列表 + 每项 expected 状态），schema 校验 W1 交接；或从 spec 卡 `file-prefetch` 附件 ref 反向声明清单，让 P 缺事实时能显式 `kanban_block(kb-insufficient)` 而非编造。

**3. D 仓库写护栏与 DT 只读护栏是"字符串启发式"，存在绕过面**
- 现状：`BASH_WRITE_RE`/`CODE_WRITE_RE` 正则([toolsets.ts#L14-L19](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/roles/toolsets.ts#L14-L19)) + 路径子串命中判定。别名、间接写、编码均可绕过。
- 风险：PT/DT 的 repo 在会话外，靠正则拦写，是软约束非硬隔离。
- 建议：软硬结合——PT/DT 会话给 **只读挂载/无 git 凭据**（已做到无凭据），让写操作**机械失败**而非靠正则；正则仅作第二道 + 审计线索。D 的 full-access 保留，但配合建议 1 的 feature-branch 隔离。

### 中优（影响成本/可靠性）

**4. 无预算/成本护栏**
- 现状：watchdog 只回收 running 无心跳([watchdog.ts](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/dispatcher/watchdog.ts#L15-L23))，staleTimeout 默认 4 小时；无单任务 token/耗时/tool-call 上限。
- 风险：角色 agent 空转烧 token，链路成本失控。
- 建议：per-task 预算（max tokens / max tool-calls / max wall-clock），超限→fail→重派或 gave_up，配合下一项。

**5. 失败重试无退避、无同因去重**
- 现状：[dispatcher.tick](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/dispatcher/dispatcher.ts#L147-L157) 对 failed 直接重派，`maxRetries=3`，无退避；resume 注入上次原因但重试策略单一。
- 风险：瞬时错误(网络/限流)立即连试 3 次浪费；结构性错误反复撞墙。
- 建议：失败分类（model/协议/工具/瞬态）+ 指数退避 + 相同 reason 去重；model-unavailable 已在 runTask 内正确走 block，可上提到 dispatcher 统一。

**6. 评审证据是"存在性"非"可复现性"，且单评审源**
- 现状：[review-evidence.ts](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/domain/review-evidence.ts#L30-L38) 校验 DT 的 `test.exit===0`、`diff` 非空等**字段存在**，无法证明"测试真的跑过"；DT 是单 agent 单模型（fallback 同 provider）。
- 风险：agent 可自我报告 pass 而实际未验证；单视角漏判。
- 建议：（a）DT 强制**重放验证命令并附 stdout 摘要**，让证据可审计；（b）`review_override==='required'` 或 hard_flags 命中时启用**双模型仲裁**（跨 provider 交叉评审），普通链路保持单评审降本。

**7. V 上下文随链膨胀 + 单点**
- 现状：V 每轮把规格卡全文 + 全量任务列表塞入([v-orchestrator.ts#L272-L283](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/dispatcher/v-orchestrator.ts#L272-L283))，kanban-v preset 无 compaction；V 会话常驻。
- 风险：长链上下文超限、V 单点故障阻塞全链。
- 建议：V 注入"状态摘要"而非全量；kanban-v 增加 compaction；V 编排状态已持久化(orchestration.json)，可考虑 V 会话断线自愈。

### 低优（影响体验/可维护）

**8. 可观测性弱**：`dispatcher.log` 纯文本追加，无结构化指标（每链耗时、每阶段 token/返工率/失败率）。建议加 metrics + 每链审计轨迹聚合。

**9. 缺端到端契约测试**：单测 187/187 覆盖纯函数，但多 agent 协作真实链路无 e2e harness（当前只能"模拟"）。建议补编排状态机 + rework/gave-up/重启恢复的契约测试。

**10. human 插话点不足**：`approval=never` 下整条链无人值守自动推进，仅 D 仓库授权 + audit-confirm + blocked 有人工入口。建议在 **hard_flags 命中或 push 前**加可选人工确认点（与建议 1 的合入门控合流）。

**11. hard_flags 依赖 P 自报**：[judgePTNeeded](file:///Users/jc/Documents/awsome-dsh-plugins/dsh-kanban/src/dispatcher/v-orchestrator.ts#L49-L61) 全信 P 的 `review_complexity`。P 可能漏报 db_migration 等。建议系统从 spec 卡内容/仓库信号辅助探测 hard_flags，非只信自报。

---

## 三、总结

这套链路 **设计理念优秀、工程纪律极强**——确定性状态机、幂等、证据闭链、权限最小化、反脆弱护栏，是"AI 多角色协作工程质量链"的正确骨架。**核心短板不是架构方向错，而是五类执行层软肋**：合入时序、预取契约、成本预算、真实性验证、可观测性。且多数短板**不需要破坏性重构**，在现有分层/证据/护栏理念上做"补强"即可闭环。

优先级一句话：**先补正确性(1/2/3)，再补成本(4/5/6)，后补体验(7-11)**。

> 注：建议 3（写护栏加固）未实施，见实施计划 2026-08-19-merge-gate-and-prefetch-manifest.md 裁剪说明。

---

## 四、后续发展路径

**阶段一 · 正确性加固（近期）**
- [x] D 改推 feature 分支，merge→TARGET_BRANCH 后置到 DT pass 后（建议 1）
- [x] W1 预取 manifest 结构化 + schema 校验（建议 2）
- [ ] PT/DT 只读改"机械失败"(只读挂载/无凭据) + 正则降级为审计线索（建议 3）

**阶段二 · 成本与真实性（中期）**
- [ ] per-task 预算护栏 + 失败分类退避（建议 4/5）
- [ ] DT 验证可复现(重放命令 + stdout 摘要) + hard_flags 双模型仲裁（建议 6）

**阶段三 · 可观测与健壮（远期）**
- [ ] 结构化 metrics + 每链审计轨迹聚合（建议 8）
- [ ] V 状态摘要注入 + compaction + 断线自愈（建议 7）
- [ ] e2e 契约测试 harness（建议 9）
- [ ] human 插话点（push 前/硬旗标）与 hard_flags 系统辅助探测（建议 10/11）
