# dsh-swarm 升级迁移报告：DSH `~0.1.7-rc.2` → `0.2.0-rc.2`（P1 静态迁移段）

> 分支 `feat/dsh-0.2.0-rc.2` · 报告日期 2026-09-30 · 对应实施计划 [UPGRADE-0.2.0-rc.2-PLAN.md](./UPGRADE-0.2.0-rc.2-PLAN.md)
> 官方源码对照树（下称 b 树）：`tmp/0.1.7rc1-to-0.2.0rc2/b/node_modules/@deepseek-ai/*`（`@deepseek-ai/dsh` 0.2.0-rc.2 实装）

## 1. 概要

- **P0 基线**：三绿（typecheck / test / build 全过）；pre-existing 失败豁免清单 = **空**。
- **P1 五步提交**（每步独立 commit，均过三绿）：

| 步 | commit | 一句话 |
|---|---|---|
| P1.1 | `83daad2` | 13 个 peer 升联合范围 `"~0.1.7-rc.2 \|\| ^0.2.0-rc.2"` + devDeps 重锁 0.2.0-rc.2 + cordis-plugin-include 补录；含 ISessions.open 移除的 session-bridge 适配 |
| P1.2 | `e7b20c1` | 链审计 run_code 派发判定事件名双名兼容（code-dispatch / ptc-dispatch 皆认） |
| P1.3 | `e2d8eee` | AgentSetup 双参化，`ctx.agent.*` 引用改显式 agent 参数传递 |
| P1.4 | `3636b5d` | 7 个 persona yml `text:`→`prefix:` 迁移，语义逐字保留 |
| P1.5 | `3123252` | subagent 挂载显式 `maxDepth: 3`，对冲默认值收敛 |

- **双核验结论（P1.1 内）**：
  1. host 强制器对 `\|\|` union 范围实测通过（7/7 组合 satisfy），联合 peer 保留；
  2. `engines.dsh` 字段 host 不强制读取 → **未加**。

- **P1.7 出口门**：typecheck 0 错误 · vitest **87 文件 / 1212 用例全绿** · build 成功（lib/client.js 133092 bytes）· inject-lint **OK**（runtimeRefsLeft 空、rawWebServerRouteFiles 空、peersMissing 空、cordisOk）。

## 2. 必改清单逐项状态

| # | 项 | 状态 | 改了什么 | 证据（文件:行） | commit |
|---|---|---|---|---|---|
| A1 | peer 硬闸 | ✅ 完成 | 13 peers → 联合范围；4 devDeps → `^0.2.0-rc.2`；lockfile 重锁，旧 cohort `0.1.2-rc.1` 残留 0 | package.json:61-75, 78-80 | `83daad2` |
| A2 | AgentSetup 双参 | ✅ 完成 | setup 改 `(agentCtx, agent)` 双参；approval/sandbox 种子事件走第二参 agent 显式直写 | src/dispatcher/agent-runner.ts:32, :340, :704 | `e2d8eee` |
| A3 | persona `text`→`prefix` | ✅ 完成 | 7 个 yml 逐字迁移（w/p/d/v/pt/dt/swarm） | personas/*/agent.cordis.yml（如 kanban-w:15、kanban-dt:14、swarm:9） | `3636b5d` |
| A4 | subagent maxDepth | ✅ 完成 | kanban-d 两处 + kanban-dt 一处显式 `maxDepth: 3` | personas/kanban-d/agent.cordis.yml:137,144；kanban-dt:98 | `3123252` |
| A5 | 事件名双名 | ✅ 完成 | 双名集合 + `isRunCodeDispatchEvent` 帮助函数，双名单测覆盖 | src/dispatcher/session-events.ts:40-51；chain-auditor.ts:21-22 | `e7b20c1` |
| B1 | client 槽位 | ✅ 闭项（零改） | 未改码；槽位与 ISessions 在 b 树存续（见 §4） | client/index.ts:53-61 | — |
| B2 | settings 服务 | ✅ 闭项（零改） | 未改码；`settings` 键在 b 树存续（见 §4） | src/dispatcher/dispatcher.ts:30；src/routes/kanban-http.ts:124 | — |
| B4 | cordis-plugin-include devDep | ✅ 完成 | 补 devDep `^1.0.9`（npm 无 0.2.0-rc.2 版本，按 b 树实装版本） | package.json:77 | `83daad2` |

## 3. 已知差异与计划外适配

| 差异 | 处置 |
|---|---|
| 0.2.0-rc.2 `ISessions` 移除 `open`（导航归视图所有者，接口注释明示） | session-bridge.ts:38-41 鸭子类型可选适配：旧宿主仍走 `open` 转发，新宿主缺失时响亮报错（fail loud），不静默无效 |
| `cordis-plugin-include` 无 0.2.0-rc.2 版本 | 按 b 树实装版本补 devDep `^1.0.9`（B4） |
| kanban-d 的 tool-subagent 实为 **2 处挂载**（计划写三挂载） | 2 处均加 `maxDepth: 3`；第三处经 tool-subagent-control 包挂载，该包配置面无 `maxDepth` 键，不加 |
| maxDepth 默认值 | b 树与 a 树均 = 1（计划所引 0.1.7-rc.1 默认 3 有误）；显式 3 保留旧行为的决策不变 |
| `SettingsForms` 无 `get(ns)` 方法（a/b 树皆然，非本段回归） | dispatcher.ts:30-31 鸭子类型调用 + try/catch 兜底，取不到时回退模型解析缺省路径；升级未引入新风险 |

## 4. B1/B2 闭项证据（P1.6）

### B1 · client 槽位与 ISessions

| 核验点 | b 树证据 |
|---|---|
| `conversation.view` 槽位声明 | dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:184 |
| `conversation.view` 运行时注册 | dsh-client-ui-chat/lib/client.js:12390-12392；dsh-client-ui-trajectory/lib/client.js:8736-8737 |
| `settings.section` 槽位声明 | dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:73 |
| `settings.section` 运行时注册 | dsh-client-ui-settings-general/lib/client.js:1171-1172 |
| `ISessions` 定义存续 | dsh-api-session-controller/lib/types/client/contract/sessions.d.ts:43 |
| `list` 快照成员存续 | sessions.d.ts:45（`list: ObservableSnapshot<SessionListState>`）+ …/client/sessions/service.d.ts:45（`ids: SessionId[]`）——插件订阅面 `list.subscribe` / `list.getSnapshot().ids` 完整可用 |
| `open` 成员 | **不在**接口中（已知差异，见 §3） |
| 插件挂载面 | client/index.ts:53-55（conversation.view, id=kanban）、:59-61（settings.section, id=swarm-config）、:34（ISessions 注入） |

typecheck 对 0.2.0-rc.2 peer 类型 0 错误 = 槽位/类型面成立的编译级证据。

### B2 · settings 服务键

| 核验点 | b 树证据 |
|---|---|
| `settings` 键注册（Context 扩充） | dsh-settings/lib/types/index.d.ts:24-29（`declare module '@deepseek-ai/cordis' { interface Context { settings: SettingsForms } }`） |
| 服务类存续 | 同文件 :62（`SettingsForms extends Service`）；运行时 lib/types/index.js:184 |
| 插件消费的 `describe()` 存续 | 同文件 :96 |
| 插件消费点 | src/dispatcher/dispatcher.ts:30；src/routes/kanban-http.ts:124（均 `ctx.get('settings')` 可选取用） |

**结论：键在，零改。**

## 5. 待运行时验证项（P3）

| 项 | 内容 | 对应计划 |
|---|---|---|
| 模型链点验 | 6 角色逐个发一轮，模型解析非 fail-open 兜底 | P3.6（B3） |
| ocr-cli | `dsh config set` 调用路径实测（两树皆无该配置面，非本段回归） | P3.7 |
| 0.1.7-rc.2 真实链路 | 隔离激活已过（见 §5.1）；真实 LLM 链路待主轨升级后带凭据复测 | P3.9 尾巴 |

### 5.1 P3.9 提前验证（主轨升级前完成激活门）

> 与主轨 host 升级无依赖，故提前执行；隔离环境 `/tmp/dsh-0.1.7rc2-test/`，不进 PATH、不碰运行轨。

| 门 | 结果 | 证据 |
|---|---|---|
| host 版本 | ✅ `0.1.7-rc.2` | 隔离目录 `npm install @deepseek-ai/dsh@0.1.7-rc.2` + `dsh --version` 实测 |
| 冷启动激活 | ✅ PASS（双通道） | 手动冷启动（端口 18427）日志：`[dsh-swarm] role presets installed: kanban-v,kanban-p,kanban-w,kanban-d,kanban-pt,kanban-dt,swarm`、`main-session tools registered`、web 服务起；`disabling profile plugin` / `incompatible-version` / `ERR_MODULE_NOT_FOUND` 全 0 命中 |
| verify-runtime.mjs | ✅ `status=pass, verdict=pass-timeout-alive` | l1-install / l2-listed / l3-boot-probe 全 PASS，exit 0 |
| 最小链路 | SKIP | 隔离环境无 LLM 凭据（仅能整拷含密钥 settings.yaml，不取）；领域层全链 p→w2→d→dt→w3 既有 vitest e2e 全绿兜底；留主轨 P3 复测 |

**结论：peer 联合范围下限 0.1.7-rc.2 的激活兼容性可背书**；真实 LLM 链路待 G2 后补测。

### 5.2 P2.0.1 安装轨道清点（只读，2026-09-30）

| 轨道 | 版本 | 说明 |
|---|---|---|
| pnpm-global（运行轨） | 0.1.2-rc.1 | `~/.local/bin/dsh` shim（PATH 首位，pnpm 管，内嵌 NODE_PATH 指 `.pnpm/@deepseek-ai+dsh@0.1.2-rc.1_72dcc747`）；127.0.0.1:3080 实例即此轨 |
| npm -g（僵尸） | 0.1.1-rc.2 | `~/.nvm/versions/node/v22.22.2/lib`，`which -a` 第二位 |

清单存档：`/tmp/upgrade-baseline/track-inventory.txt`。摘僵尸与 pinned 升级为人工步（计划 P2 纪律）。

## 6. 回滚指针

| 资产 | 位置 |
|---|---|
| 基线快照（HEAD SHA、lockfile sha256、cordis.patch.yml + 7 persona yml 备份） | `/tmp/upgrade-baseline/` |
| 会话数据快照（V3 审计安全网，唯一可回滚副本） | `~/.dsh/sessions.bak-20260930` |

> 提醒：新 host 打开过的会话旧 host 永久拒读（不可逆）；回滚 P2/P3 前先保快照。

## 7. plugin-upgrade skill 只读评审记录（G1 前，Mode A · inspect）

> 走廊卡片最远覆盖 0.1.7-rc.1；`0.1.7-rc.1 → 0.2.0-rc.2` 段无卡片，按 skill 规则以一手来源（b 树实装）+ 可复现测试推导（即本报告与 UPGRADE-ADAPTATION.md）。评审为独立交叉核验，不信任迁移执行方自报。

| 核验点 | 独立证据 | 结论 |
|---|---|---|
| `ctx.agent` 残留 | src 全扫 8 处命中均为注释/`ctx.agents` 注册表（另一物），零活代码引用 | ✅ 迁移彻底 |
| 事件双名 | session-events.ts:41-44 四名集合；chain-auditor 经谓词消费 | ✅ 单一事实源 |
| persona 逐字性 | 与基线备份 diff：仅 `text:`→`prefix:` 键名行 + maxDepth 3 行，其余零字节差 | ✅ 禁走样达成 |
| preset.yml 盲区排查 | 7 个 preset.yml 仅 name/description 展示元数据，无人设文本字段 | ✅ 无漏迁 |
| lockfile 旧 cohort | `0.1.2-rc.1` 全扫 = 0 | ✅ |
| peer 范围 | 联合范围实落 package.json | ✅ |

**评审结论：P1 静态迁移通过 Mode A 复核，无残留、无漏项。** 待运行时验证项见 §5；升级全链完成后将按目标要求做终审复审。
