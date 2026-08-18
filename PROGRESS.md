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
| 1 领域类型+权限+投影 | ⬜ | |
| 2 配置 | ⬜ | |
| 3 buildContext 续修引导 | ⬜ | |
| 4 协议违规护栏 | ⬜ | |
| 5 V 阻塞复核 | ⬜ | |
| 6 V 编排扩展 | ⬜ | |
| 7 证据闸+返工 | ⬜ | |
| 8 PT 角色 | ⬜ | |
| 9 DT 角色 | ⬜ | |
| 10 D 方法论 | ⬜ | |
| 11 preset+UI | ⬜ | |
| 12 模型链 | ⬜ | |
| 13 全量验证 | ⬜ | |
