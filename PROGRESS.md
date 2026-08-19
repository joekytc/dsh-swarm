# PROGRESS.md — dsh-kanban 执行总计划（协议失败恢复 + 交付质量链）

> 执行依据：docs/superpowers/plans/2026-08-17-dsh-kanban-execution-master.md（13 个 Task，合并去重版）。

## 任务 0：基线核对（2026-08-18）

- `./node_modules/.bin/tsc -p tsconfig.json --noEmit` → exit 0，0 错误 ✓
- `./node_modules/.bin/vitest run` → Test Files 36 passed / Tests 188 passed (188)，skipped 0 ✓
- 数字与任务书基线一致（188/188，36 files）→ 符合，继续动工。

**理解的目标**：把 dsh-kanban 从"能跑链路"升级为"失败能自愈 + 质量有人闸"——①任意角色停稳未收尾 → block→V [blocked-review]→人工解除→同会话 resume→护栏熔断 [blocked-final]；②P 后按复杂度判定可选 PT（计划评审），D 后固定 DT（实证校验+ocr 评审），评审失败走 done 不可变 + rework task 返工 + 护栏 [review-final]；③角色模型 primary+fallbacks+High。

**顺序**：基础契约（T1 领域类型 / T2 配置）→ 通用恢复机制（T3 续修引导 / T4 护栏 / T5 V 复核）→ 评审质量链（T6 编排 / T7 证据闸+返工 / T8 PT / T9 DT / T10 D 方法论 / T11 preset+UI / T12 模型链）→ T13 全量验证。

**最大风险**：①评审失败路径严禁对已完成 P/D 调 blockTask（状态机 only running→blocked），返工必须走 done 不可变 + createReworkTask；②DT ToolGuard 的 execution 参数字段名与 tools.guard agent 注册路径以 dsh-tools 实际类型为准（计划末尾标注待现场确认）；③ocr CLI Delegation 模式入口与输出解析需现场查实。

## 现场查实结论（任务书"猜的"项）

- 待 T9 实现时核对 dsh-tools 的 ToolGuard execution 参数实际字段名与 tools.guard 注册路径（读 node_modules/@deepseek-ai/dsh-tools 类型）。
- 待 T9 实现时核对 ocr CLI Delegation 模式入口与输出解析；查不到写 BLOCKED.md。

## 基线快照

- 工作树含上一会话遗留未提交 WIP（修复轮 6/7：target-repo/git-credentials/session-events/delivery-evidence + D-execute 编排），实测基线 188/188 已含其测试。为保持每 Task 一次纯净 commit，先以基线快照提交落盘，再按计划逐 Task 实施。

## 逐 Task 进度

| Task | 状态 | 说明 |
|---|---|---|
| 0 基线核对 + PROGRESS | ✅ | 188/188，tsc 0 错误 |
| 1 领域类型+权限+投影 | ✅ | cffebfc；Role+=pt/dt、TaskMode+=review-plan/impl、ReviewStatus/Verdict/Issue/Evidence、EventKind+=review/*、Task+=sessionId/rework 字段、permissions+=create-rework-task、wiki-write=w+dt、projection 归一化；红→绿（3 fail→25 pass） |
| 2 配置 | ✅ | c579128；maxProtocolViolations=2、maxReworksPerRole{pt:2,dt:3}、roles.models{provider/model/reasoningEffort default high/fallbacks default []}；红→绿。注：计划写 Schema.object({v:...})，但 schemastery object 全键必填会拒绝部分配置，改用 Schema.dict(modelItemSchema()) 允许按角色部分配置（更好路，记录） |
| 3 buildContext 续修引导 | ✅ | 86f8531；阻塞 resume 注入 [Review guidance (blocked task resume)]（最近阻塞原因+阻塞后评论）；rework 卡注入 [Review guidance (rework task)]（review/failed issues 摘要）；红→绿（2 fail→10 pass） |
| 4 协议违规护栏 | ✅ | 68f3211；!used 分支按 prior protocol_violation 计数：≥maxProtocolViolations（默认2）后 → block(gave_up)+system 发 [blocked-final]（block 时间线+复核/评论时间线+最终 reason）；任意角色（pt/dt 用例覆盖）；红→绿 |
| 5 V 阻塞复核 | ✅ | 24ba0e9；wakeV 在 completed/aborted 早退后、B4 门控前插入阻塞复核 pass：链上 status=blocked 且 reason 含 protocol_violation/gave_up 且无 [blocked-review] → 向 V 发阻塞复核轮（V 只评论不建卡不改状态）；hasBlockReview 幂等；persona-v.md + kanban-v yml 补职责；红→绿 |
| 6 V 编排扩展 | ✅ | 65dcb54；R20_PHASE_ORDER += pt（P 判定触发）/dt（固定）；judgePTNeeded（hard_flags>0 或 soft_count≥2 需要 PT；override 优先；缺失=legacy 跳过；非法=默认需要）；pt 阶段按需跳过；d 段 PHASE_INSTRUCTIONS += TARGET_BRANCH；P persona 输出 review_complexity；红→绿（3 fail→7 pass）。注：既有 "gates" 测试原断言 d→w3，计划新增固定 dt 阶段后按计划改 d→dt→w3（计划要求的链路变更，非放宽断言） |
| 7 证据闸+返工 | ✅ | 3a95c6c；review-evidence.ts 纯 validator（PT 需 verdict+issues+plan 结构；DT 需 test/build/typecheck/lint/diff/git/ocr，fail 评审 test 存在即可）；kanban-service：completeTask 证据闸（pt/dt 缺证据拒）、recordReview/reviewGaveUp（system 限定）、createReworkTask（source 保持 done，新卡 reworkOfTaskId/resumeSessionId/reviewAttempt+1/reviewStatus=pending）、projection 按 review/* 事件更新 target.reviewStatus；orchestrator handleReviewCompletion（pass→recordReview+推进；fail→recordReview+createReworkTask+新复审卡；超限→review/gave-up+[review-final]；严禁 blockTask(done)）；agent-runner resume 用 task.resumeSessionId；红→绿（3 fail→27 pass） |
| 8 PT 角色 | ✅ | c7a97a7；toolsets namesFor.pt + spec_card_view；buildReadOnlyWriteGuard（DIRECT_WRITE_TOOLS 指向 repo→拒；bash 含写标记且 cmd 含 repoRoot→拒；git -C 支持）；agent-runner 对 pt/dt 注册 ToolGuard（dsh-tools 现场查实：tools.guard 参数 execution.name/arguments，非 tool.name）；persona-pt.md + kanban-pt preset（persona+instructions+bash+fs+fs-search）；红→绿（2 fail→13 pass） |
| 9 DT 角色 | ✅ | 250332a；isReviewNamespacePath（projects/<chain>/review/，拒 ../、绝对、跨链）；buildDTWriteGuard（=只读护栏 + wiki_write 仅 review namespace）；resolveReviewEngine（ocr→code-review→review-tool-unavailable 纯函数）；run_code 用 CODE_WRITE_RE（JS/Python 写 API）判写意图；agent-runner 对 pt/dt 挂裁剪 preset；persona-dt.md + kanban-dt preset（+run_code both）；红→绿（3 fail→17 pass）。ocr CLI 现场查实本机未安装 → 已按计划写 BLOCKED.md（fallback 路径落地，Delegation 模式实测留待有 ocr 环境） |
| 10 D 方法论 | ✅ | 130d690；persona-d.md + kanban-d yml 补第 6/7 条：执行方法论（tdd/verification/systematic-debugging/worktrees + 提交前 ocr 自审）、[AI-GEN] commit 规范 + worktree→实现+验证→commit→合并回 TARGET_BRANCH→push |
| 11 preset+UI | ✅ | eee1bbe；PRESET_IDS += kanban-pt/kanban-dt（installer 6 项幂等）；kanban.css --dsh-kb-pt(靛 #6366f1)/--dsh-kb-dt(玫红 #ec4899) + .dsh-kb-profile--pt/dt；workflow-model phaseOf 测试（PT/DT 标签）；红→绿 |
| 12 模型链 | ✅ | 8d07eec；model-candidates.ts（buildModelCandidates primary+fallbacks，reasoningEffort 缺省 high；isModelUnavailableError 分类）；agent-runner 候选链 spawn（静默切换+[model-fallback] 证据评论；全候选不可用→block(model-unavailable)；非 model 错误立即 fail）；v-orchestrator getVAgent 同候选链（V 无任务卡→全不可用抛错）；cordis.patch.yml roles.models 六角色 ark/deepseek-v4-flash + fallback openai/gpt-5.6-sol（High）；删两处死代码 modelOptions。注：hasBlockReview 由 at 比较改 seq 比较——at=Date.now() 毫秒精度，block 与评论同毫秒碰撞致幂等失效（实测红），seq 确定性（更好路，记录）；续接上一会话 WIP（未提交），先修 tsc TS2454（agent 未赋值）再补齐 |
| 13 全量验证 | ✅ | tsc --noEmit exit 0；vitest 220/220（39 files，skipped 0，≥188 达标）；tsc -p tsconfig.build.json + build-client.mjs exit 0（lib/client.js 62890 bytes，含 dsh-kb-profile--pt/dt）；lib/ 含 blocked-final/validateReviewEvidence |
