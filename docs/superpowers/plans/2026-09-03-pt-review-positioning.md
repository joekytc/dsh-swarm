# P/PT 定位决议落地 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 2026-09-03 P/PT 定位决议（五要素评审、三铁律、交接契约）落地为 persona/建卡模板/编排层的实际代码与文本，使 PT 评审标准与 P 写作标准同源、返工强制对账、PT pass 建议随卡传 D。

**Architecture:** 三层落地——① persona 文本层（中文源 + 英文 yml 镜像，两份同步）；② PHASE_INSTRUCTIONS 建卡模板（v-orchestrator.ts 常量）；③ 编排层两处确定性注入：复审卡 body 直带上一轮 issues 对账输入（system 建卡路径）、D 卡创建上下文注入 PT pass 非阻塞建议。规格唯一来源：`/Users/jc/Documents/awsome-dsh-plugins/pt-review-positioning-decisions-2026-09-03.md`。

**Tech Stack:** TypeScript (ES2023/NodeNext) + vitest；personas 为 Markdown/YAML 文本。

## Global Constraints

- 仓库：`/Users/jc/Documents/awsome-dsh-plugins/dsh-swarm/`，分支 `feat/swarm-config-panel`，**不开 worktree**（工作区有未提交的 pt=3 改动，Task 1 先提交它）。
- 提交身份硬规则（防中文作者名入公开仓）：`git -c user.name=joekytc -c user.email=96049998+joekytc@users.noreply.github.com commit -m "<msg>"`；提交后核验 `git log -1 --format='%an <%ae>'` 输出为 `joekytc <96049998+joekytc@users.noreply.github.com>`。
- shell 命令统一加 `rtk` 前缀（`rtk npm run typecheck` 等；`rtk bash -c '...'` 内嵌复杂引号易碎，大段文本用 Write 临时文件再 cat）。
- TS 规范：相对导入带 `.js` 后缀；`verbatimModuleSyntax` 类型导入用 `import type`；`erasableSyntaxOnly` 禁 enum/namespace。
- 三层同步铁律（历史教训）：改评审/写作标准必须同轮同步三处——personas/*.md（中文源）、personas/kanban-*/agent.cordis.yml（英文镜像）、src/dispatcher/v-orchestrator.ts 的 PHASE_INSTRUCTIONS（建卡模板）。缺一层=模型侧标准不同源。
- 提交门槛（AGENTS.md）：`npm run typecheck` 0 错误 + vitest 全绿 + `npm run build` 成功。
- 决议范围红线：PT 不引入规格卡未声明的协议标准；结构准备度判据为自包含文本（不引用 tdd-practices 等任何 skill 名）。

---

### Task 1: 提交在场的 maxReworks pt=3 改动（清空工作区基线）

**Files:**
- Modify（已改好，待提交）: `src/config.ts`、`src/dispatcher/v-orchestrator.ts`、`tests/config.test.ts`、`AGENTS.md`

**Interfaces:**
- Consumes: 无
- Produces: 干净工作区；`maxReworksPerRole` 默认 `{ pt: 3, dt: 3 }`，v-orchestrator.ts:461 兜底 `?? 3`（后续 Task 均基于此）

- [ ] **Step 1: 确认工作区现状**

Run: `rtk bash -c 'cd /Users/jc/Documents/awsome-dsh-plugins/dsh-swarm && git status --short && git diff --stat'`
Expected: 恰好 4 个文件改动（config.ts / v-orchestrator.ts / config.test.ts / AGENTS.md），无其他杂物。若有多余文件，停下报告人工。

- [ ] **Step 2: 门禁复验**

Run: `rtk npm run typecheck && rtk npx vitest run tests/config.test.ts tests/dispatcher/v-orchestrator.test.ts && rtk npm run build`
Expected: typecheck 0 错误、测试全绿、build 成功。

- [ ] **Step 3: 提交并核验身份**

```bash
cd /Users/jc/Documents/awsome-dsh-plugins/dsh-swarm
git add src/config.ts src/dispatcher/v-orchestrator.ts tests/config.test.ts AGENTS.md
git -c user.name=joekytc -c user.email=96049998+joekytc@users.noreply.github.com commit -m "fix(dispatcher): maxReworksPerRole pt 默认 2→3（评审返工上限放宽）"
git log -1 --format='%an <%ae>'
```
Expected: 输出 `joekytc <96049998+joekytc@users.noreply.github.com>`；工作区 clean。

---

### Task 2: PT persona 重写（五要素 + issues 四要素 + 对账铁律 + 协议边界）

**Files:**
- Modify: `personas/persona-pt.md`（整文件替换为下述内容）
- Modify: `personas/kanban-pt/agent.cordis.yml`（仅 persona text 块替换，其余组件不动）

**Interfaces:**
- Consumes: 决议文档 §二/§三
- Produces: PT 评审标准文本（后续 Task 4 的 PHASE_INSTRUCTIONS.pt 与之同义；Task 5 复审卡 body 的「上一轮评审未通过 issues」节名必须与本文件 rule 4 引用一致）

- [ ] **Step 1: 整文件替换 personas/persona-pt.md**

```markdown
# PT — 计划评审者（Plan Reviewer · read-only）

> 对应交付质量链角色：**PT（Plan Review）**——对 P 的计划交付物做只读评审（五要素），输出 verdict+issues 入交接；绝不修改任何产物。系统判定需要 PT（计划评审）时才建卡（P 交付物复杂度判定）。

你是链路计划评审 Agent，只读评审 P 的实施计划，**不是执行者、也不是修订者**。铁律：

1. 只读评审 P 的计划产物（proposal/design/tasks，见交接 artifacts_path），按五要素逐条核对：
   - 需求对齐（颗粒度）：澄清清单/规格卡的任务项、任务点、注意点 ↔ 计划任务逐条双向映射——不遗漏、不超纲（超纲任务须能溯源到澄清回答，否则 issue）。
   - 完整性：solution/impl_decisions 覆盖所有需求点；每个任务有可核对的完成判据。
   - 逻辑交互一致性：计划内部无自相矛盾；slice/任务依赖顺序可执行。
   - 结构准备度（自包含判据，零外部 skill 依赖）：每个任务条目必须有单一、可独立核对的完成判据；一条任务的实现步骤需同时达成 N 个互不依赖的可观察结果，或一条测试用例同时断言 N 个互不依赖的可观察结果（N≥2）＝「混行为」，issue 要求拆分。判定只看计划文本自身，不引用、不要求出现任何执行层字样（RED/GREEN/命名窄测等）。
   - 工程协议一致性：只对账 proposal.md 的「上游协议遵循说明」节；裁判依据只有上游声明的那份文件；上游未声明的协议，你无权自行引入（禁止自行扫描仓库 skills 当评审标准）。
2. 你有只读执行护栏（ToolGuard 拦截 tracked source 写入 / git mutation / 含写标记 bash）：绝不修改源码/计划文件；不需要写就不用写。
3. 评审结论写进 kanban_complete 的交接 metadata.review_evidence = { verdict: 'pass'|'fail', issues: [{ severity, title, detail, location?, resolved }], ... }：
   - issues 四要素缺一无效：定位（location=哪条任务/哪节）+ 依据（上游声明引用 或 计划内部矛盾点）+ 问题（违反什么）+ 怎么改（可执行建议）。
   - pass = 五要素全部满足，issues 只放非阻塞建议（执行层参考，不阻塞）；fail = 存在 critical/high 问题，须返工（系统据此 createReworkTask 让 P 返工 + 新建复审卡）。
   - 评审闸硬要求：complete 时 handoff metadata 顶层必须带 artifacts_path=<被评审计划的 openspec 目录绝对路径，直接继承被评审 P 卡 handoff 里的 artifacts_path 值>，或在 review_evidence 里给 reviewPage；review_evidence 形状不变（{ verdict, issues, ...reviewPage 可选 }）——两者都缺时评审闸拒绝 pass。
4. 返工复审（任务体含「上一轮评审未通过 issues」节时）：必须先逐条对账——每条旧 issue 给出三态结论（已修复 resolved=true / 未修复 resolved=false 原样沿用 / 部分修复 resolved=false 且 detail 注明剩余部分），再提新问题；未修复旧 issue 必须原样保留在 issues 中。禁止跳过对账只提新问题。
5. 不得调用 kanban_create、不得写 wiki、不得改规格卡；只可 complete/block/comment 本任务（会话绑定）。
6. 使用 kanban_show/kanban_list/kanban_complete/kanban_block/kanban_heartbeat/kanban_comment + spec_card_view；bash 仅限只读命令（cat/git show/glob）。
```

- [ ] **Step 2: 同步 kanban-pt/agent.cordis.yml 的 persona text 块**

将 `- id: persona` 下的 `text: >-` 整块替换为（其余组件 tool-bash/tool-fs/tool-fs-search 与注释头不动）：

```yaml
    text: >-
      You are the plan-review agent (read-only) powered by the {{model}} model. Your working
      directory is {{cwd}}. You review P's plan deliverable only — you never modify any artifact
      and you never execute code. Rules:
      1. Read-only review of the P plan (proposal/design/tasks, from the handoff artifacts_path)
      against five elements:
      - Requirement alignment (granularity): every task item / task point / note in the
      clarification checklist / spec card maps both ways to plan tasks — nothing missing,
      nothing beyond scope (an out-of-scope task must trace back to a clarification answer,
      else issue).
      - Completeness: solution/impl_decisions cover all requirement points; every task has a
      checkable done criterion.
      - Logical/interaction consistency: no internal contradictions; slice/task dependency
      order is executable.
      - Structural readiness (self-contained rule, zero external skill dependency): every task
      entry must have a SINGLE, independently checkable done criterion; if one task's steps
      achieve N>=2 mutually independent observable results, or one test case asserts N>=2
      mutually independent observable results, it is a "mixed behavior" — issue requires a
      split. Judge from the plan text only; never reference or require execution-layer wording
      (RED/GREEN/named narrow tests).
      - Engineering-protocol consistency: only reconcile against the 「上游协议遵循说明」
      section of proposal.md; the only judge reference is the file declared upstream; you have
      no authority to introduce undeclared protocols (never scan repo skills as review
      standards).
      2. A read-only ToolGuard blocks tracked-source writes, git mutations, and write-marker
      bash targeting the repo — do not attempt them; use read-only commands (cat/git show/glob).
      3. Write the review conclusion into kanban_complete metadata review_evidence =
      { verdict: 'pass'|'fail', issues: [{ severity, title, detail, location?, resolved }], ... }:
      every issue MUST carry four elements — location (which task/section) + basis (upstream
      declaration reference or internal contradiction) + problem (what is violated) + fix
      (actionable suggestion); missing any element = invalid issue.
      pass = all five elements satisfied; issues may then only carry non-blocking suggestions
      (execution-layer reference, not blocking). fail = critical/high issues remain (the system
      then creates a rework task for P and a fresh review card).
      Review gate hard requirement: on complete, the handoff metadata must carry artifacts_path =
      <absolute path of the reviewed plan's openspec directory, inherited directly from the
      reviewed P card's handoff artifacts_path value>, or set reviewPage inside review_evidence;
      review_evidence shape stays { verdict, issues, ...reviewPage optional } — the review gate
      rejects pass when both artifacts_path and reviewPage are missing.
      4. Re-review (task body contains the 「上一轮评审未通过 issues」 section): reconcile FIRST —
      each prior issue gets a three-state conclusion (fixed resolved=true / unfixed resolved=false
      carried over as-is / partially fixed resolved=false with the remaining part in detail), then
      raise new issues; unfixed prior issues MUST stay in the issues list. Never skip
      reconciliation and only raise new issues.
      5. Never call kanban_create, never write the wiki, never edit/approve spec cards; only
      complete/block/comment your own bound task.
      6. Use kanban_show/kanban_list/kanban_complete/kanban_block/kanban_heartbeat/
      kanban_comment + spec_card_view; bash limited to read-only commands.
```

- [ ] **Step 3: 同步校验（三层铁律之两层）**

Run: `rtk bash -c 'cd /Users/jc/Documents/awsome-dsh-plugins/dsh-swarm && grep -c "结构准备度" personas/persona-pt.md && grep -c "上一轮评审未通过 issues" personas/persona-pt.md && grep -c "Structural readiness" personas/kanban-pt/agent.cordis.yml && grep -c "reconcile FIRST" personas/kanban-pt/agent.cordis.yml'`
Expected: 每个计数 ≥1，exit 0。

- [ ] **Step 4: 回归 + 提交**

Run: `rtk npx vitest run tests/dispatcher/v-orchestrator.test.ts`（persona 文本不影响测试，回归确认即可）

```bash
git add personas/persona-pt.md personas/kanban-pt/agent.cordis.yml
git -c user.name=joekytc -c user.email=96049998+joekytc@users.noreply.github.com commit -m "feat(personas): PT 评审定位升级五要素+三铁律（2026-09-03 决议）"
git log -1 --format='%an <%ae>'
```
Expected: 身份核验通过。

---

### Task 3: P persona 增补（结构准备度判据 + 「上游协议遵循说明」节）

**Files:**
- Modify: `personas/persona-p.md`（末尾追加两条铁律）
- Modify: `personas/kanban-p/agent.cordis.yml`（persona text 块追加两条规则）

**Interfaces:**
- Consumes: 决议文档 §二.4/§四（P→PT 行）
- Produces: 「上游协议遵循说明」节名（Task 4 PHASE_INSTRUCTIONS.p 引用同名；PT 侧 Task 2 已引用同名）——节名字面量三处必须完全一致

- [ ] **Step 1: persona-p.md 末尾（现有 rule 8 之后）追加**

```markdown
9. tasks.md 拆分粒度（结构准备度，与 PT 同一判据，自包含零外部依赖）：每个任务条目必须有单一、可独立核对的完成判据；禁止一条任务的实现步骤同时达成 N 个互不依赖的可观察结果，或一条测试用例同时断言 N 个互不依赖的可观察结果（N≥2）——按可独立验证的行为逐条拆分（一条任务/一条用例只管一个行为）。
10. proposal.md 必须含「上游协议遵循说明」节：逐条列出规格卡/澄清清单中声明的工程协议引用（可定位出处：路径或明确协议名）+ 计划如何遵守它；规格卡未声明任何协议时该节写「无」。禁止引用规格卡之外的协议标准（读声明的原文，不读二手转述）。
```

- [ ] **Step 2: kanban-p/agent.cordis.yml persona text 块末尾（现有 rule 7 之后）追加**

```yaml
      8. tasks.md splitting granularity (structural readiness — the SAME criterion as PT,
      self-contained, zero external dependency): every task entry must have a SINGLE,
      independently checkable done criterion; NEVER let one task's steps achieve N>=2 mutually
      independent observable results, or one test case assert N>=2 mutually independent
      observable results — split per independently verifiable behavior (one task / one test
      case per behavior).
      9. proposal.md MUST contain a 「上游协议遵循说明」 section: list every engineering-protocol
      reference declared in the spec card / clarification checklist (locatable origin: path or
      explicit protocol name) and how the plan complies with it; if no protocol is declared,
      write 「无」 in that section. Never reference protocol standards beyond the spec card
      (read the declared files themselves, never secondhand summaries).
```

- [ ] **Step 3: 同步校验**

Run: `rtk bash -c 'cd /Users/jc/Documents/awsome-dsh-plugins/dsh-swarm && grep -c "上游协议遵循说明" personas/persona-p.md && grep -c "structural readiness" personas/kanban-p/agent.cordis.yml && grep -c "上游协议遵循说明" personas/persona-pt.md'`
Expected: 三处均 ≥1（P 中文源 / P 英文镜像 / PT 中文源引用同名节）。

- [ ] **Step 4: 提交**

```bash
git add personas/persona-p.md personas/kanban-p/agent.cordis.yml
git -c user.name=joekytc -c user.email=96049998+joekytc@users.noreply.github.com commit -m "feat(personas): P 结构准备度判据与上游协议遵循说明节（与 PT 同源）"
git log -1 --format='%an <%ae>'
```

---

### Task 4: PHASE_INSTRUCTIONS 模板同步 + 关键词护栏测试（TDD）

**Files:**
- Modify: `src/dispatcher/v-orchestrator.ts:40-80`（PHASE_INSTRUCTIONS.p / .pt / .d 三个模板）
- Test: `tests/dispatcher/v-orchestrator.test.ts`（新增 1 个模板护栏测试）

**Interfaces:**
- Consumes: Task 2/3 的 persona 文本措辞（「上游协议遵循说明」「上一轮评审未通过 issues」「评审遗留建议」三个节名字面量）
- Produces: PHASE_INSTRUCTIONS.p/.pt/.d 新行；测试 `PHASE_INSTRUCTIONS carry positioning-decision keywords`

- [ ] **Step 1: 先写失败测试**

在 `tests/dispatcher/v-orchestrator.test.ts` 的 describe 块内（任意现有 it 之后）追加：

```ts
  it('PHASE_INSTRUCTIONS carry P/PT positioning-decision keywords (2026-09-03 决议)', () => {
    // P：结构准备度 + 协议遵循说明节（与 persona-p 同义同源）
    expect(PHASE_INSTRUCTIONS.p).toContain('单一、可独立核对的完成判据');
    expect(PHASE_INSTRUCTIONS.p).toContain('上游协议遵循说明');
    // PT：五要素 + 对账 + issues 四要素（与 persona-pt 同义同源）
    expect(PHASE_INSTRUCTIONS.pt).toContain('结构准备度');
    expect(PHASE_INSTRUCTIONS.pt).toContain('上游协议遵循说明');
    expect(PHASE_INSTRUCTIONS.pt).toContain('三态对账');
    expect(PHASE_INSTRUCTIONS.pt).toContain('四要素');
    // D：评审遗留建议随卡传递
    expect(PHASE_INSTRUCTIONS.d).toContain('评审遗留建议');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `rtk npx vitest run tests/dispatcher/v-orchestrator.test.ts -t 'positioning-decision keywords'`
Expected: FAIL（模板尚无这些关键词）。

- [ ] **Step 3: 更新 PHASE_INSTRUCTIONS.p**

在 `PHASE_INSTRUCTIONS.p` 数组的 `'产物路径（OpenSpec 规范）：…'` 行之后插入两行：

```ts
    'tasks.md 拆分粒度（结构准备度，与 PT 同一判据）：每个任务条目必须有单一、可独立核对的完成判据；禁止一条任务/一条测试用例混 N≥2 个互不依赖的可观察结果——按可独立验证的行为逐条拆分。',
    'proposal.md 必须含「上游协议遵循说明」节：逐条列规格卡/澄清清单声明的工程协议引用（可定位出处：路径/明确协议名）+ 计划如何遵守；未声明任何协议则该节写「无」。禁止引用规格卡之外的协议标准。',
```

- [ ] **Step 4: 更新 PHASE_INSTRUCTIONS.pt**

把现有 `'body 写入计划评审指令：P 已判定需要计划评审（理由见上）。只读评审 P 的计划产物（对齐需求/完整性/逻辑交互一致性），输出 verdict+issues 入交接 metadata.review_evidence。',` 一行替换为以下三行：

```ts
    'body 写入计划评审指令：P 已判定需要计划评审（理由见上）。只读评审 P 的计划产物，按五要素核对：需求对齐（澄清清单条目↔任务双向映射，不遗漏不超纲）/完整性/逻辑交互一致性/结构准备度（每任务条目单一、可独立核对的完成判据；混 N≥2 个互不依赖的可观察结果=混行为须拆分）/工程协议一致性（只对账 proposal「上游协议遵循说明」节，未声明协议不得自行引入）。输出 verdict+issues 入交接 metadata.review_evidence。',
    'issues 四要素缺一无效：location（哪条任务/哪节）+ 依据（上游声明引用或计划内部矛盾点）+ 问题 + 可执行建议；pass 时 issues 只放非阻塞建议。',
    '返工复审：body 含「上一轮评审未通过 issues」节时必须先逐条三态对账（已修复/未修复/部分修复），未修复旧 issue 原样沿用，再提新问题。',
```

- [ ] **Step 5: 更新 PHASE_INSTRUCTIONS.d**

在 `PHASE_INSTRUCTIONS.d` 数组末行（`'TDD 硬要求：…'` 之后）追加：

```ts
    '上下文含「评审遗留建议」节时：把该节原文完整复制进 D 卡 body 末尾「评审遗留建议」节（不得删改、不得省略）；上下文无该节则 body 不含该节。',
```

- [ ] **Step 6: 运行确认通过**

Run: `rtk npx vitest run tests/dispatcher/v-orchestrator.test.ts`
Expected: 全绿（含新护栏测试与既有全部用例）。

- [ ] **Step 7: 提交**

```bash
git add src/dispatcher/v-orchestrator.ts tests/dispatcher/v-orchestrator.test.ts
git -c user.name=joekytc -c user.email=96049998+joekytc@users.noreply.github.com commit -m "feat(dispatcher): PHASE_INSTRUCTIONS 同步 P/PT 定位决议 + 模板关键词护栏"
git log -1 --format='%an <%ae>'
```

---

### Task 5: 复审卡 body 确定性注入上一轮 issues（对账铁律的编排层落地，TDD）

**Files:**
- Modify: `src/dispatcher/v-orchestrator.ts`（`handleReviewCompletion` 未超限分支 ~L477-487；模块级新增 `formatIssues`）
- Test: `tests/dispatcher/v-orchestrator.test.ts`（新增 1 个用例）

**Interfaces:**
- Consumes: `evidence: ReviewEvidence`（handleReviewCompletion 作用域已有，L432）；`KanbanService.createTask` 支持 `body?: string`（kanban-service.ts:153）；`Task.body: string`（types.ts:101）
- Produces: 复审卡（pt/dt 通用）创建时携带 body；body 含节名「上一轮评审未通过 issues」（与 Task 2 persona rule 4、Task 4 PHASE_INSTRUCTIONS.pt 引用一致）

背景：复审卡当前由 system 直建**且不带 body**（v-orchestrator.ts:479-486）——PT 复审对账纯靠模型自觉，这是 ch_1_mtjuukv2 三轮空转的结构根因。对账输入由 `evidence`（在作用域内）确定性生成，不查事件、不靠 V。

- [ ] **Step 1: 先写失败测试**

在 tests/dispatcher/v-orchestrator.test.ts 追加（放在现有 'review-failed guardrail' 用例之后）：

```ts
  it('PT rework: system-created re-review card body carries prior issues for reconciliation (对账铁律)', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);            // → p
      await completePWithPtDecision(svc, true, '跨模块重构需评审');
      await orch.wakeV(chain.id);            // → 首评 PT 卡
      const pt1 = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'pt' && t.mode === 'review-plan')!;
      await svc.claimTask(pt1.id, 'system');
      await svc.completeTask(pt1.id, {
        summary: 'rev',
        metadata: { artifacts_path: '/ws/plan.md', review_evidence: { verdict: 'fail', issues: [
          { severity: 'high', title: 'Slice B 混行为', detail: '一个用例断言多个互不依赖结果', location: 'tasks.md:39-50', resolved: false },
        ] } },
        completedAt: Date.now(),
      }, 'pt', { boundTaskId: pt1.id });
      await orch.wakeV(chain.id);            // → 返工卡 + 复审卡（system 直建）
      const state = await svc.snapshot();
      const review2 = [...state.tasks.values()]
        .filter((t) => t.assignee === 'pt' && t.mode === 'review-plan' && (t.reviewAttempt ?? 0) === 1)
        .at(-1)!;
      expect(review2).toBeDefined();
      expect(review2.body).toContain('上一轮评审未通过 issues');
      expect(review2.body).toContain('Slice B 混行为');
      expect(review2.body).toContain('tasks.md:39-50');
      expect(review2.body).toContain('三态');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
```

注意：若 `completePWithPtDecision` 未把 reason 写进 pt_decision（needed=true 时 reason 必填，交付契约闸会拒），先扩展该 helper：`meta.pt_decision = { needed, ...(reason ? { reason } : {}) }`。

- [ ] **Step 2: 运行确认失败**

Run: `rtk npx vitest run tests/dispatcher/v-orchestrator.test.ts -t 'reconciliation'`
Expected: FAIL（复审卡 body 为空，不含「上一轮评审未通过 issues」）。

- [ ] **Step 3: 实现——模块级 formatIssues + 复审卡 body**

在 `extractPtReason` 函数（v-orchestrator.ts ~L83-87）之后新增模块级函数：

```ts
/** 评审 issues 统一格式化（对账/遗留建议注入用）：`- [severity] title — detail（location）`。 */
function formatIssues(issues: ReviewEvidence['issues']): string {
  return issues
    .map((i) => `- [${i.severity ?? 'info'}] ${i.title ?? ''} — ${i.detail ?? ''}${i.location ? `（${i.location}）` : ''}`)
    .join('\n');
}
```

把 `handleReviewCompletion` 未超限分支（L477-487）替换为：

```ts
    // 未超限：createReworkTask（原任务保持 done）+ 新建复审卡（parents=rework，reviewAttempt=rework.reviewAttempt）。
    // 2026-09-03 P/PT 定位决议铁律3：复审卡 body 确定性注入上一轮 issues 对账输入——复审卡原为空 body，
    // 对账纯靠模型自觉（ch_1_mtjuukv2 三轮空转的结构根因之一）；输入直接取作用域内 evidence，不查事件。
    const reconcileBody = [
      role === 'pt' ? '## PT 复审任务体要求（计划评审，只读）' : '## DT 复审任务体要求（实现校验+评审，只读护栏）',
      role === 'pt'
        ? 'P 已按上一轮 issues 返工。按 persona 五要素只读评审返工后的计划产物，输出 verdict+issues 入交接 metadata.review_evidence（评审闸要求不变：artifacts_path 或 reviewPage）。'
        : 'D 已按上一轮 issues 返工。按 persona 对返工产物实证校验+评审，输出 verdict+issues 入交接 metadata.review_evidence。',
      '## 上一轮评审未通过 issues（必须先逐条对账，再提新问题）',
      formatIssues(evidence.issues) || '  -（无）',
      '对账规则：每条旧 issue 给出三态结论——已修复（resolved=true）/未修复（resolved=false，detail 原样沿用）/部分修复（resolved=false，detail 注明剩余部分）；未修复旧 issue 必须原样保留在 issues 中，禁止跳过对账只提新问题。',
    ].join('\n');
    const rework = await this.kanban.createReworkTask({ sourceTaskId: currentTarget.id, reviewTaskId: reviewTask.id, reason: 'review failed' }, 'system');
    await this.kanban.createTask({
      chainId,
      title: role === 'pt' ? '计划复审' : '实现复审',
      assignee: role,
      mode: role === 'pt' ? 'review-plan' : 'review-impl',
      parents: [rework.id],
      reviewAttempt: rework.reviewAttempt,
      body: reconcileBody,
    }, 'v');
    return 'rework';
```

- [ ] **Step 4: 运行确认通过 + 回归**

Run: `rtk npx vitest run tests/dispatcher/v-orchestrator.test.ts && rtk npm run typecheck`
Expected: 全绿（含既有 'review-failed guardrail' 用例——gave-up 分支不受影响）。typecheck 0 错误。

- [ ] **Step 5: 提交**

```bash
git add src/dispatcher/v-orchestrator.ts tests/dispatcher/v-orchestrator.test.ts
git -c user.name=joekytc -c user.email=96049998+joekytc@users.noreply.github.com commit -m "feat(dispatcher): 复审卡 body 确定性注入上一轮 issues 对账输入"
git log -1 --format='%an <%ae>'
```

---

### Task 6: D 卡创建上下文注入 PT pass 评审遗留建议（TDD）

**Files:**
- Modify: `src/dispatcher/v-orchestrator.ts`（模块级新增 `extractPtPassSuggestions`；`wakeV` context 组装处 ~L337-358）
- Test: `tests/dispatcher/v-orchestrator.test.ts`（新增 2 个用例：正/负）

**Interfaces:**
- Consumes: `review/passed` 事件 payload `{ reviewTaskId, targetTaskId, evidence }`（kanban-service.ts:398）；`BoardState`（v-orchestrator 已 import）；`formatIssues`（Task 5 产出）
- Produces: phase='d' 时 V 上下文含「评审遗留建议」节（仅当 PT pass 且 issues 非空）；D 卡 body 由 V 按模板复制（Task 4 已写指令）

- [ ] **Step 1: 先写失败测试（正例 + 负例）**

```ts
  it('PT pass non-blocking suggestions flow into D card creation context (评审遗留建议)', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);            // → p
      await completePWithPtDecision(svc, true, '复杂度高');
      await orch.wakeV(chain.id);            // → pt
      const pt1 = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'pt' && t.mode === 'review-plan')!;
      await svc.claimTask(pt1.id, 'system');
      await svc.completeTask(pt1.id, {
        summary: 'rev', metadata: { artifacts_path: '/ws/plan.md', review_evidence: { verdict: 'fail', issues: [{ severity: 'high', title: 'x', detail: 'y', resolved: false }] } }, completedAt: Date.now(),
      }, 'pt', { boundTaskId: pt1.id });
      await orch.wakeV(chain.id);            // → rework + 复审卡
      await completeBy(svc, 'p', 'openspec'); // P 返工完成
      await orch.wakeV(chain.id);            // 复审在途待命
      const pt2 = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'pt' && t.mode === 'review-plan' && t.status !== 'done')!;
      await svc.claimTask(pt2.id, 'system');
      await svc.completeTask(pt2.id, {
        summary: 'rev', metadata: { artifacts_path: '/ws/plan.md', review_evidence: { verdict: 'pass', issues: [{ severity: 'low', title: '建议补 timeout 用例', detail: '执行时补充边界覆盖', location: 'tasks.md', resolved: false }] } }, completedAt: Date.now(),
      }, 'pt', { boundTaskId: pt2.id });
      await orch.wakeV(chain.id);            // → w2
      await completeBy(svc, 'w', 'kb');
      await orch.wakeV(chain.id);            // → d（context 应含评审遗留建议）
      expect(fakeV.lastContext).toContain('评审遗留建议');
      expect(fakeV.lastContext).toContain('建议补 timeout 用例');
      expect(fakeV.lastContext).toContain('原文完整复制');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('PT pass with empty issues → D context has no 评审遗留建议 section', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      await completePWithPtDecision(svc, true, '复杂度高');
      await orch.wakeV(chain.id);
      const pt1 = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'pt' && t.mode === 'review-plan')!;
      await svc.claimTask(pt1.id, 'system');
      await svc.completeTask(pt1.id, {
        summary: 'rev', metadata: { artifacts_path: '/ws/plan.md', review_evidence: { verdict: 'pass', issues: [] } }, completedAt: Date.now(),
      }, 'pt', { boundTaskId: pt1.id });
      await orch.wakeV(chain.id);            // → w2
      await completeBy(svc, 'w', 'kb');
      await orch.wakeV(chain.id);            // → d
      expect(fakeV.lastContext).not.toContain('评审遗留建议');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `rtk npx vitest run tests/dispatcher/v-orchestrator.test.ts -t '评审遗留建议'`
Expected: 正例 FAIL（context 无该节）；负例可能已 PASS（未注入即不含）——以正例为准。

- [ ] **Step 3: 实现——extractPtPassSuggestions + context 注入**

在 `formatIssues` 之后新增模块级函数：

```ts
/** 最近一次 PT review/passed 的 issues（pass 时即非阻塞建议留档）：建 D 卡时注入「评审遗留建议」。
 *  取事件 payload.evidence（recordReview 落盘），按 reviewTaskId 回查任务确认 pt/review-plan 归属。 */
function extractPtPassSuggestions(state: BoardState, chainId: string): ReviewEvidence['issues'] {
  const passed = [...state.events]
    .filter((e) => e.kind === 'review/passed')
    .map((e) => ({ e, rt: state.tasks.get(String(e.payload['reviewTaskId'] ?? '')) }))
    .filter(({ rt }) => !!rt && rt.chainId === chainId && rt.assignee === 'pt' && rt.mode === 'review-plan')
    .at(-1);
  const ev = passed?.e.payload['evidence'] as ReviewEvidence | undefined;
  return Array.isArray(ev?.issues) ? ev!.issues : [];
}
```

在 `wakeV` context 组装处（`const ptReason = …` 一行之后）追加：

```ts
      // 2026-09-03 P/PT 定位决议：D 卡创建上下文注入 PT pass 留档的非阻塞建议（评审遗留建议随卡传递）。
      const ptSuggestions = orch.phase === 'd' ? extractPtPassSuggestions(state, chainId) : [];
```

在 context 数组的 `(ptReason ? … : '')` 行之后追加一个元素：

```ts
        (ptSuggestions.length > 0
          ? '## 评审遗留建议（PT 评审 pass 留档，非阻塞；原文完整复制进 D 卡 body 末尾「评审遗留建议」节，不得删改省略）\n' + formatIssues(ptSuggestions)
          : ''),
```

- [ ] **Step 4: 运行确认通过 + 回归**

Run: `rtk npx vitest run tests/dispatcher/v-orchestrator.test.ts && rtk npm run typecheck`
Expected: 全绿、typecheck 0 错误。

- [ ] **Step 5: 提交**

```bash
git add src/dispatcher/v-orchestrator.ts tests/dispatcher/v-orchestrator.test.ts
git -c user.name=joekytc -c user.email=96049998+joekytc@users.noreply.github.com commit -m "feat(dispatcher): D 卡创建上下文注入 PT pass 评审遗留建议"
git log -1 --format='%an <%ae>'
```

---

### Task 7: 全量门禁 + 决议文档落地状态回写

**Files:**
- Modify: `/Users/jc/Documents/awsome-dsh-plugins/pt-review-positioning-decisions-2026-09-03.md`（§七 落地清单状态）

- [ ] **Step 1: 全量门禁**

Run: `rtk npm run typecheck && rtk npx vitest run && rtk npm run build`
Expected: typecheck 0 错误、全部测试绿、build 成功。

- [ ] **Step 2: 三层同步终检（关键词在三层各出现）**

Run: `rtk bash -c 'cd /Users/jc/Documents/awsome-dsh-plugins/dsh-swarm && echo "--中文源:" && grep -l "结构准备度" personas/persona-pt.md personas/persona-p.md && echo "--英文镜像:" && grep -l "Structural readiness" personas/kanban-pt/agent.cordis.yml personas/kanban-p/agent.cordis.yml && echo "--模板:" && grep -c "上游协议遵循说明\|评审遗留建议" src/dispatcher/v-orchestrator.ts'`
Expected: 四个 persona 文件全部命中；模板计数 ≥3。

- [ ] **Step 3: 回写决议文档 §七**

把 `pt-review-positioning-decisions-2026-09-03.md` §七表格表头改为含「状态」列或表尾追加一行：

```markdown
> 落地状态（2026-09-03）：文本层（Task 2/3）、模板层+护栏测试（Task 4）、编排层对账注入（Task 5）、编排层遗留建议注入（Task 6）均已实现并提交至 feat/swarm-config-panel；全量门禁通过。
```

- [ ] **Step 4: 完成汇报**

汇总：提交清单（6 个 commit 的 hash）+ 测试结果 + 提醒「部署生效需重启 dsh web（改 lib 不热更新）；重启前 pt=3 与本轮编排改动均不生效」。
