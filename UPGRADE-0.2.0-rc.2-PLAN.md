# dsh-swarm 升级实施计划：DSH `0.1.2-rc.1` → `0.2.0-rc.2`

> 依据：[UPGRADE-ADAPTATION.md](../tmp/0.1.7rc1-to-0.2.0rc2/UPGRADE-ADAPTATION.md)（缺口段 794 commits 零破坏）+ [SESSION-FORMAT-V3-AUDIT.md](../tmp/0.1.7rc1-to-0.2.0rc2/SESSION-FORMAT-V3-AUDIT.md)（356 会话全 V0，全链迁移可行）+ plugin-upgrade 走廊卡片（order 8-18）。
> 目标：插件 peer cohort `^0.1.2-rc.1` → `"~0.1.7-rc.2 || ^0.2.0-rc.2"`（联合范围），host pnpm-global 轨道同步升级，插件版本 0.3.11 → **0.5.0**。
> 纪律：每阶段有验证门（gate）与回滚动作；插件领域层（src/domain）禁止 import `@deepseek-ai/*` 不变；AGENTS.md 三绿铁律（typecheck/test/build）贯穿。

## 决策记录（已确认）

| 决策点 | 结论 |
|---|---|
| peer floor | `"~0.1.7-rc.2 \|\| ^0.2.0-rc.2"`（联合范围：admit 0.1.7-rc.2/0.1.7.x + 0.2.0-rc.2+；**P1.1 核验 host 强制器支持 `\|\|` union，不通则退回 `^0.2.0-rc.2`**） |
| 覆盖范围 | 全链 P0-P4（含 host 升级与 npm/市场发布） |
| A5 事件名 | **双名兼容**（新旧 `tool/code-dispatch[-start]` / `tool/ptc-dispatch[-start]` 都接受） |
| 插件版本号 | **0.5.0**（用户指定；原计划 0.4.0 作废） |
| dsh 安装源 | **统一官方源，单轨道**：清散落装 → pnpm-global 轨 pinned `0.2.0-rc.2`（见 P2.0） |
| subagent maxDepth | d/dt 组合显式 `maxDepth: 3`（保持旧行为，对冲 0.1.7-rc.1 默认 3→1） |
| WIP 落盘 | **人工闸 G0**——由用户自行提交/stash，agent 不擅动（用户未答，默认最安全） |

## 兼容性承诺（安装底线）

- **最低官方 DSH 版本 = `0.1.7-rc.2`**（联合 peer 范围 admit 0.1.7-rc.2+ 与 0.2.0-rc.2+；仍硬拒 0.1.7-rc.1 及以下、0.2.0-rc.1）。
- **验证深度声明（诚实标注）**：`0.2.0-rc.2` = 全量 P3 验证（主目标）；`0.1.7-rc.2` = **轻量验证**（隔离安装 + 冷启动 + 一条链路冒烟，见 P3.9），peer 允许但非全量 P3 级背书。
- 机制：host 在安装时（`ManagementFailure code: 'incompatible-version'`，包不落 profile）与启动时（`dsh: disabling profile plugin …`）双闸校验插件 peer 范围 vs host 版本（走廊卡 DSH-0.1.7-RC1-01，实测卡）。失败模式干净，不会静默坏。
- 迁移后代码天然落在 0.1.7-rc.2 兼容窗：AgentSetup 双参（0.1.5-alpha.1 起）、persona prefix（0.1.3-alpha.2 起）、ptc-dispatch 事件名（A5 双名）、maxDepth 显式、client 槽位/ISessions/webServer（缺口审计 a 树=0.1.7-rc.1 逐字核验）——证据见决策记录上方针审计报告。
- 长期承诺：floor = 持续测试的最老版本。0.2.0 正式版普及后 0.1.7 萎缩，届时可提 floor 单独发版（peer 收窄是 minor 级变更）。
- 可选加固：`package.json` `engines.dsh` 字段——外部插件是否被 host 读取 **[P1.1 核验]**，通过则加 `"engines": { "dsh": ">=0.1.7-rc.2" }`，不通过不加。

## 必改清单总账（实施即核对）

| # | 项 | 文件 | 动作 |
|---|---|---|---|
| A1 | peer 硬闸 | package.json | 13 个 peer `^0.1.2-rc.1` → `"~0.1.7-rc.2 \|\| ^0.2.0-rc.2"`（联合）；4 个 devDep → `^0.2.0-rc.2`（编译靶保持最新）；lockfile 重锁；全 lockfile 扫无旧 cohort 残留 |
| A2 | `ctx.agent`/AgentSetup | src/dispatcher/agent-runner.ts（:315 setup、:323-329 agent/request、:334-337 session.append）、v-orchestrator.ts（:693） | setup 改双参 `(agentCtx, agent)`；`ctx.agent.*` 引用改显式 agent 参数传递 |
| A3 | persona `text`→`prefix` | personas/*/agent.cordis.yml × 7 | `config.text` 内容整体迁 `config.prefix`；语义逐字保留（评审引擎/护栏描述不得走样） |
| A4 | subagent maxDepth | personas/kanban-d/agent.cordis.yml（tool-subagent 三挂载）、kanban-dt（:93） | 显式 `maxDepth: 3` |
| A5 | ptc-dispatch 双名 | src/dispatcher/chain-auditor.ts（:141、:159）、src/dispatcher/session-events.ts | 事件名双名兼容 + 双名单测；BASH_WRITE_RE 两处同步纪律不变 |
| B1 | client 槽位 | client/index.ts | 审计已证 `conversation.view`/`settings.section`/`ISessions` 在 0.2.0 存续——**预期零改**；typecheck+挂载后核验即闭项 |
| B2 | settings 服务 | kanban-http.ts:124、dispatcher.ts:30 | `ctx.get('settings')` 键在——**预期零改**；闭项核验 |
| B3 | 模型链点验 | cordis.patch.yml 部署配置 | `deepseek-v4-flash`/`gpt-5.6-sol` GUI catalog 语义收紧后实测（core 路由仍放行） |
| B4 | 顺手项 | tests/roles/toolsets.test.ts:383 | `@deepseek-ai/cordis-plugin-include` 补 devDep |

---

## P0 · 准备与基线

| 步 | 动作 | 验证门 |
|---|---|---|
| P0.1 | **【人工闸 G0】用户落盘 20 个未提交文件**（commit 到 main 或 stash，自定） | `git status` 干净 |
| P0.2 | 基线三绿：`npm run typecheck` / `npm test` / `npm run build`（现依赖态，无目标 pin） | 0 错误/全绿/成功；**pre-existing 失败记录为豁免清单**（R-06），迁移不得新增失败 |
| P0.3 | 会话数据快照（V3 审计 T1）：`cp -R ~/.dsh/sessions ~/.dsh/sessions.bak-$(date +%Y%m%d)` | 目录存在且大小合理 |
| P0.4 | 回滚基线记录：HEAD SHA、`package-lock.json` sha256、cordis.patch.yml + 7 个 persona yml 备份到 `/tmp/upgrade-baseline/` | 清单落盘 |
| P0.5 | 在途 kanban 链收尾或登记（102 个 kbn 会话，V3 审计 R2）：GUI 导出链状态 | 链清单归档 |

## P1 · 静态迁移（分支 `feat/dsh-0.2.0-rc.2`，worktree 隔离）

按 A1→A2→A5→A3→A4→B 顺序，每步一提交，每步过三绿：

| 步 | 动作 | 验证门 |
|---|---|---|
| P1.1 | A1 依赖：13 peers → 联合范围 `"~0.1.7-rc.2 \|\| ^0.2.0-rc.2"` + devDeps `^0.2.0-rc.2` + `npm install` 重锁 + B4 devDep；**核验① host 强制器支持 `\|\|` union**（读 b 树 `app-boot/plugin-compatibility` lib 或实装观察——semver `satisfies('0.1.7-rc.2', 范围)` 与 `satisfies('0.2.0-rc.2', 范围)` 须双真）；**核验② `engines.dsh` 外部插件支持**，通过则加 `"engines": { "dsh": ">=0.1.7-rc.2" }`；任一核验不过：peer 退回 `^0.2.0-rc.2`、engines 不加，底线回 0.2.0-rc.2 并记录 | 三绿；`grep -c "0\.1\.2-rc\.1" package-lock.json` = 0（排除本插件自身版本）；两项核验结论记录 |
| P1.2 | A5 双名：chain-auditor.ts:159 与 :141、session-events.ts 接受新旧事件名；新增双名单测（code 名命中写判定 + ptc 名命中写判定 + 只读事件不误判） | 三绿；`npm test -- chain-auditor session-events` 全绿 |
| P1.3 | A2 AgentSetup：agent-runner/v-orchestrator setup 双参化；`ctx.agent.*` 改显式传递（对齐 b 树 `AgentSetup=(agentCtx,agent)` 签名）；approval/policy、sandbox/mode append 改走显式 agent | 三绿 |
| P1.4 | A3 persona：7 个 yml `text:`→`prefix:`，逐文件人工对照语义（人设资产，禁走样） | 三绿 + 7 文件 diff 逐行评审 |
| P1.5 | A4 maxDepth：d/dt 显式 `maxDepth: 3` | 三绿 |
| P1.6 | B1/B2 闭项核验：typecheck 对新 peer 类型编译通过即证槽位/服务类型面成立；结果记入迁移报告 | typecheck 0 错误 |
| P1.7 | 全量三绿 + `node ~/.agents/skills/plugin-upgrade/scripts/inject-lint.mjs .` 复跑 | inject-lint OK |

**P1 出口门 G1**：所有 A 项完成、B 项核验记录、三绿、豁免清单无新增 → 用户确认后进 P2。

## P2 · Host 清理统一 + 升级（人工执行，外部终端；agent 不得在会话内执行）

### P2.0 · 清散落、去噪声、统一官方源（升级前先清）

| 步 | 动作 | 验证 |
|---|---|---|
| P2.0.1 | **全量清点**：`which -a dsh`、`npm ls -g @deepseek-ai/dsh`、各 nvm node 版本 `ls <nvm>/versions/node/*/lib/node_modules/@deepseek-ai`、`ls ~/.local/dsh-pnpm-global/global/*/node_modules/@deepseek-ai`、`cat ~/.local/bin/dsh`（看 shim 解析轨道） | 清单落盘：轨道、版本、shim 指向 |
| P2.0.2 | **摘僵尸**：`npm uninstall -g @deepseek-ai/dsh`（0.1.1-rc.2 僵尸装）；其他非运行轨道逐一 uninstall（保留 pnpm-global 运行轨） | `which -a dsh` 仅剩 `~/.local/bin/dsh` → pnpm-global |
| P2.0.3 | （可选，用户手动）`~/.dsh` 内旧备份散料：`settings.yaml.bak-*`、`backups-2026-08-15` 等——agent 不动，用户自决 | — |

### P2.1 · Pinned 升级（清理后单轨道执行）

```sh
# 1. 完全停止所有 dsh 进程（3080 实例在内；浏览器刷新≠停止）
# 2. 外部终端，pinned install（绝不裸包名，绝不 session 内跑）。
#    pnpm-global 轨道（本机实际轨，按 shim 实际解析方式等价执行）：
pnpm --global-dir ~/.local/dsh-pnpm-global add -g @deepseek-ai/dsh@0.2.0-rc.2
#    若 shim 属桌面端自装器管理，改用「管理 dsh 命令」菜单 pinned 装同版本
# 3. 重启 dsh web，浏览器硬刷新
```

- **禁用** `compatibility.json` 豁免路径（peer 已对齐，无需豁免）。
- **禁手**：不手工拷包目录、不手写 shim——安装中断一律外部终端重跑 pinned install 修复。
- 门 **G2**：`which -a dsh` 单轨 + `dsh --version` = 0.2.0-rc.2；启动 stderr 含插件装载行、无 `disabling profile plugin`。

## P3 · 运行时验证

| 步 | 动作 | 通过标准 |
|---|---|---|
| P3.1 | 依赖/启用解析：`dsh --dump-config` | 插件行在、无 denied、无旧 cohort |
| P3.2 | 隔离冷启动：`node ~/.agents/skills/plugin-upgrade/scripts/verify-runtime.mjs` | 失败归因非插件码/依赖解析 |
| P3.3 | 会话迁移（V3 审计 T2-T4）：拒载演练 → 6 代表样本实迁（最老/最大/种子委派/run_code kbn/有题/无步骤）→ 全量 356 遍历统计 | 拒载时源 md5 不变；成功/拒载分布落盘 |
| P3.4 | 插件链路（T5）：resume 已完成链角色会话 + 重驱动一条在途链；chain-auditor 对 ptc-dispatch 写判定正确 | 审计事件落盘含 run_code 写记录 |
| P3.5 | 完整冒烟：/openspec 建链 → V 建卡 → W 实现 → DT 评审 → merge-gate 合入；GUI check（`python tests/e2e/gui-check.py --url http://127.0.0.1:3080/`） | 链跑通；kanban 标签页+配置面板渲染 |
| P3.6 | 模型链点验（B3）：6 角色逐个发一轮 | 角色会话起得来，模型解析非 fail-open 兜底 |
| P3.7 | ocr-cli 实测：`dsh config set providers.dsh-managed.*` 调用路径（审计遗留 [待实机验证]） | 通过 → 闭项；失败 → 记缺陷另案 |
| P3.8 | 性能留痕（T6）：小/中/大 3 会话首开 vs 二开计时 | 数据入验证报告 |
| P3.9 | **0.1.7-rc.2 轻量验证**（仅当 P1.1 联合 peer 核验通过）：隔离目录装 `@deepseek-ai/dsh@0.1.7-rc.2`（`/tmp/dsh-0.1.7rc2-test/`，**不进 PATH、不动单轨**）→ verify-runtime 冷启动挂插件 → 起一条最小 kanban 链（V→W→DT 一轮） | 冷启动激活 + 链路通；失败则 peer 收窄回 `^0.2.0-rc.2` 并记录（P4 发布前发现即改） |

**出口门 G3**：P3.1-P3.6 全过（P3.7 允许带缺陷闭项；P3.9 按其行内标准）→ 进 P4。

## P4 · 发布

1. 插件版本 `0.3.11 → 0.5.0`（兼容断裂，禁用 host 版本当插件版本）。
2. `npm pack` 校验：packed 文件名含 0.5.0、packed manifest（`dsh` 字段/client inject/engines）正确。
3. `npm publish`（registry.npmjs.org，joekytc 身份）。
4. 市场更新：走 `dsh-market-submit` 流程——commit 身份硬规则（`git -c user.name=joekytc -c user.email=96049998+joekytc@users.noreply.github.com`，提交后核验 `%an <%ae>`）、README 由脚本再生、diff 仅条目 yml + 两 README 各 1 行、代理 127.0.0.1:7897 兜底。
5. 门 **G4**：市场 PR 可见、CI 过、插件页版本 0.5.0。

## 回滚矩阵

| 阶段 | 回滚动作 | 安全网 |
|---|---|---|
| P1 | 删迁移分支/worktree，main 不受影响 | 基线记录 P0.4 |
| P2 | host pinned install 回 `0.1.2-rc.1` | 会话快照 P0.3——**新 host 打开过的会话旧 host 永久拒读（不可逆），快照是唯一安全网**（V3 审计 R3） |
| P3 | 同 P2；插件 profile node_modules 重装旧版 | 同上 |
| P4 | npm `dist-tag` / deprecate 0.5.0；市场关 PR | npm 不可删，靠新 patch 版本覆盖 |

## 开放项（不阻塞计划，带出实施）

| 项 | 状态 | 归属 |
|---|---|---|
| ocr-cli `dsh config set` 面不存在于发布树 | [待实机验证]（两树皆无，非本段回归） | P3.7 |
| 跨版本 resume「cursor behind」历史缺陷 | 0.1.3-alpha.1 卡记录，未确认修复 | P3.4 覆盖验证 |
| revert 审计覆盖 250/794 截断 | 低风险（唯一 revert test-only） | 不处理 |
| `npm -g` 陈旧 0.1.1-rc.2 僵尸装 | 与运行轨道无关 | 建议用户择机清理 |
