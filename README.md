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
- 看板：GUI 看板页（列/抽屉/轨迹/评论/交接证据）
- 角色：V/P/W/D 由调度器按任务创建，persona + 工具面隔离（agent scope）

## 架构

- **领域层**（src/domain/）纯 TypeScript：事件溯源（JSONL 事件日志）+ 状态机 + 投影 + 权限矩阵，零 DSH 依赖，完全 TDD。
- **集成层**（src/tools, src/routes）：cordis 工具与服务注册；/plan: 与 /openspec: 前缀路由。
- **调度层**（src/dispatcher）：事件唤醒 V（R20 逐阶段建卡）、每任务一次性角色 agent（persona preset 装配 + 父任务交接原样注入）、看门狗（心跳/熔断）。
- **wiki 层**（src/wiki）：wiki-vault HTTP 客户端（search/read/write，prefix 白名单）。
- **client/**：浏览器半 React 看板（列/卡/抽屉）。

## 权限矩阵

| 动作 | V | P | W | D | 人类 |
|---|---|---|---|---|---|
| create-task | ✅ | ❌ | ❌ | ❌ | ✅(经 /plan: 路由/GUI) |
| create-chain | ✅ | ❌ | ❌ | ❌ | ✅(经路由) |
| complete/block/heartbeat | ❌ | 仅绑定任务 | 仅绑定任务 | 仅绑定任务 | block 可 |
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
- **浏览器看板没出现？** → client 半为 web 构建工具链产物（`./client` 入口），需要随 dsh web 构建打包；领域与测试不依赖该产物。
