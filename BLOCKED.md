# BLOCKED.md — 待裁决清单

## 待裁决

### 1. open-code-review（ocr）CLI Delegation 模式入口与输出解析（Task 9 现场查实结论）
- 现场查实（2026-08-18）：本环境 `which ocr` / `which open-code-review` / npm 全局均未找到 ocr 二进制；设计文档（spec 2026-08-17-delivery-quality-chain-design.md）记载入口为 `ocr review --from <base> --to <TARGET_BRANCH>`（Delegation 模式），但**无法在本机实测输出解析**。
- 处置：按计划"查不到的写 BLOCKED.md"，ocrc CLI 的 Delegation 模式实测与输出解析留待有 ocr 环境时裁决/补测。
- 已落地（不依赖 ocr 二进制）：resolveReviewEngine 纯函数（ocr 优先 → code-review fallback → review-tool-unavailable）+ persona-dt.md / kanban-dt 组合明确 fallback 路径，两者均不可用时 DT block(review-tool-unavailable)。
- 建议：部署环境若装有 ocr，补一条集成验证（ocr review 输出解析）后关闭本条。

### 2. DSH ToolGuard 的 execution 参数实际字段名（现场查实结论，已闭环）
- 现场查实：以 node_modules/@deepseek-ai/dsh-tools 类型为准，`ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined`，字段为 `execution.name` + `execution.arguments`（**非** execution.tool?.name）；`tools.guard` 在 agent scope 通过 agentCtx.tools.guard 注册。已按此落地（非阻塞，仅为记录）。

## 已解决 / 不再阻塞
- （无）
