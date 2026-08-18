# AGENTS.md — dsh-kanban 插件开发经验

> 本文件沉淀对"完善看板插件功能/能力"有提升的通用经验。完整条目见 `.learnings/`。

## 看板插件核心经验（踩坑沉淀）

### 1. 会话作用域（★最重要）
- `ctx.get('agents').list()` 返回**整个 DSH 进程所有活会话**（含其他项目主会话）。任何"扫描主会话/本链会话"的逻辑必须收窄作用域。
- 标准做法：用 `Chain.workspaceDir`（/plan: 路由时从 `session.header.cwd` 捕获）+ `isPathInside(session.header.cwd, workspaceDir)` 只扫本链工作区内的会话。
- 路由只用逻辑 id `'session_main'`，无法直接匹配真实会话 id（见 `.learnings/FEATURE_REQUESTS.md` FEAT-001）。

### 2. run_code 写判定（审计/权限类逻辑）
- 判定 `run_code` 是否写，看**实际派发子调用**：`tool/code-dispatch-start` / `tool/code-dispatch` 事件，按 `rootCallId` 关联外层 `tool/call` 的 `callId`。
- 直接写工具 = write/edit/rm/mv/cp/mkdir/mkfile；bash 需命中写标记；read/glob/grep 与只读 bash 不算。
- 读会话事件统一经 `src/dispatcher/session-events.ts`（兼容 `{type,data}` 嵌套与顶层形态）。

### 3. bash 写标记正则
- 重定向用 `\s>>?`（要求 `>` 前有空白），避免 `2>/dev/null`、`2>&1` 只读重定向误判为写。

### 4. 写含正则的源码（模板字符串转义陷阱）
- 在模板字符串里写正则，`\b` → 退格符(U+0008)、`\s` → 裸 s，正则静默失效。
- 必须双重转义 `\\b`/`\\s`；写盘后用 `xxd`/sed 抽查字节（应见 0x5c 0x62 / 0x5c 0x73）。

### 5. 质量门禁
- 改完必须跑：`npx tsc -p tsconfig.json --noEmit`（0 错误）+ `npx vitest run`（当前 187/187）+ `npm run build`（产出 lib/ + client.js）。
- 部署生效需重启/重载 DSH 实例（127.0.0.1:3080），仅 build 不会热更新运行中的插件。
