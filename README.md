# dsh-kanban

防越权方案对齐的 4 角色（V/P/W/D）协作看板插件。

## 安装

```bash
dsh plugin --profile <name> add ./dsh-kanban
```

## 配置

见 `src/config.ts` 的 KanbanConfig（storageDir / wikiVault / roles / dispatcher / prefixRoutes / ui）。

| 键 | 默认值 | 说明 |
|---|---|---|
| storageDir | `$DSH_HOME/storages/kanban` | 事件日志（events.jsonl）与编排状态 |
| wikiVault.baseUrl | `http://192.168.122.111:3000` | wiki-vault HTTP 服务 |
| wikiVault.pagePrefix | `projects/` | W 写页面前缀白名单 |
| dispatcher.staleTimeoutSeconds | 14400 | 心跳超时回收 |
| dispatcher.maxRetries | 3 | 失败熔断上限（attempts 达上限 → blocked(gave_up)） |
| dispatcher.heartbeatIntervalSeconds | 300 | 看门狗心跳周期 |
| prefixRoutes.plan / openspec | `/plan:` / `/openspec:` | 阶段 0 / 批准前缀 |

## 使用

- 用户：`/plan: <需求> / <项目> / <API>` 起手 → 规格卡对话（mattpocock 方法论：ask-matt → grill-me → 收敛六段）→ `/openspec: 确认执行` 进入链路
- 角色：V/P/W/D 由调度器按任务创建，persona + 工具面隔离（agent scope）

## Workflow 看板 tab

- 位于会话中心 对话、轨迹 之后的第三个 tab（conversation.view，id=kanban，order=20）；不注册 shell.overlay/sidebar/details
- 内容最大 660px，窄视口自适应，全高布局；无浮层、无拖拽、无宽度记忆
- 多链路垂直轨道；当前链路展开，阻塞链路始终显示警告摘要
- 点击任务进入概览/轨迹/交接/规格/评论五区详情，Esc 或返回按钮回到列表
- 数据通过初始快照 + SSE 实时更新；断线后按事件 seq 自动补齐

## 架构

- **领域层**（src/domain/）纯 TypeScript：事件溯源（JSONL 事件日志）+ 状态机 + 投影 + 权限矩阵，零 DSH 依赖，完全 TDD。
- **集成层**（src/tools, src/routes）：cordis 工具与服务注册；/plan: 与 /openspec: 前缀路由。
- **调度层**（src/dispatcher）：事件唤醒 V（R20 逐阶段建卡）、每任务一次性角色 agent（persona preset 装配 + 父任务交接原样注入）、看门狗（心跳/熔断）。
- **wiki 层**（src/wiki）：wiki-vault HTTP 客户端（search/read/write，prefix 白名单）。
- **client/**：浏览器半 React tab 组件。`npm run build:client` 产出 `lib/client.js`（`window.__ModuleLoader__.load()` 格式，与 dsh-client-* 一致），`apply()` 把看板注册为会话中心 `conversation.view` 第三个 tab（id=kanban，order=20，位于 对话、轨迹 之后；不注册 shell.overlay/sidebar/details）；数据桥为节点端 `/kanban` HTTP 路由（GET /kanban/board 快照、GET /kanban/events SSE、POST /kanban/action 状态操作），仅 webServer 存在时挂载。UI 无业务轮询：初始快照 + SSE 增量 + seq 缺口重拉。

## 权限矩阵

| 动作 | V | P | W | D | 人类 |
|---|---|---|---|---|---|
| create-task | ✅ | ❌ | ❌ | ❌ | ✅(经 /plan: 路由/GUI) |
| create-chain | ✅ | ❌ | ❌ | ❌ | ✅(经路由) |
| complete/block/heartbeat | ❌ | 仅绑定任务 | 仅绑定任务 | 仅绑定任务 | block/complete(GUI 强制收尾) |
| unblock | ❌ | ❌ | ❌ | ❌ | ✅ |
| spec-approve | ❌ | ❌ | ❌ | ❌ | ✅ |
| spec-edit | ❌ | ❌ | ❌ | ❌ | ✅ |
| spec-attach | ✅ | ❌ | ❌ | ❌ | ✅ |
| wiki-write | ❌ | ❌ | ✅ | ❌ | ❌ |
| wiki-read | ❌ | ❌ | ✅ | ✅ | ❌ |
| prefetch | ❌ | ❌ | ✅ | ❌ | ❌ |

完整矩阵见 `tests/redteam/anti-escalation.test.ts`。

## 事件溯源

所有状态变更追加 `<storageDir>/events.jsonl`（JSONL，seq 单调由存储层分配）。轨迹 = 事件日志本身；重启回放重建。非法状态转换在回放时抛错（红队防护）。

## FAQ

- **角色 agent 停稳但没 complete/block？** → 自动 `block(protocol_violation)`，不重启进同循环。
- **任务失败怎么重试？** → `task/failed` 事件 + attempts 递增；看门狗在 attempts 达 maxRetries 时熔断为 `blocked(gave_up)` 等待人工。
- **为什么主会话没有 kanban_create？** → 防越权：主会话建卡走 /plan: 前缀路由或 GUI；kanban_create 仅 V/人类（经路由）工具面可见。
- **浏览器看板怎么出现？** → `npm run build:client` 产出 `lib/client.js`（`window.__ModuleLoader__.load()` 格式）；把 dsh-kanban 加入 web profile 后，client-modules 自动把看板编入 `__DSH_BOOT__` 并注册为会话中心第三个 tab（对话→轨迹→看板）。已实测（默认端口 3080）：boot 成功、`/plugins/dsh-kanban/client.js` 200、`GET /kanban/board` 返回真实快照 JSON、`GET /kanban/events` 推送 SSE。注意：`storageDir` 必须用未加引号的 `!!js dshHomePath("storages/kanban")`（引号会使其退化为字面量路径）。
## GUI 验证

```bash
# 1) 构建
npm run build          # lib/*.js + lib/client.js（ModuleLoader bundle）
# 2) 使用 DSH web 默认端口 3080（不要新开端口，避免双 dsh 服务/会话错乱）
dsh plugin --profile web add ./dsh-kanban
# 3) 浏览器验收（Playwright），仅在 3080 无 dsh web 运行或已运行于 3080 时执行
python tests/e2e/gui-check.py --url http://127.0.0.1:3080/
```

组件层已验证（Vitest）：SSE 补偿/去重、board store 缺口重拉、多链路轨道、五区详情、tab 布局（≤660px 全高）、HTTP action 校验全部通过；真实 GUI 验收请在有 dsh web（3080）运行的环境执行 `gui-check.py`，不要在已有 dsh web 服务时再起第二个实例。
