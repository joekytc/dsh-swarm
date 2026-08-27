# dsh-swarm v2 重构实施计划（需求澄清前置化 + PT 判定硬键 + 断代）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把需求澄清/仓库预取从看板任务前置到主 agent 的 grill-me 阶段（W1-pre/W1-supp 角色删除），PT 判定改为 P 交付硬键 `pt_decision`，旧链彻底断代，只保留 v2 串行链路 `p→(pt)→w2→d→dt→w3`。

**Architecture:** `/plan:` 零副作用仅捕获 workspaceDir/sessionId；主 agent 澄清期经 `planning_prefetch`（只读子代理）+ `planning_checklist_save`（结构化硬校验存 KB/临时目录）产出需求澄清清单；`/openspec:` 才建链+从清单机械映射规格卡六段+挂 file-prefetch 附件+批准 → V 从 `p` 串行自动建卡跑到 `w3`。主 agent 只读仓库、只写 KB/临时目录。

**Tech Stack:** TypeScript / Cordis 4 / dsh-tools / dsh-agent / vitest / wiki-vault HTTP client

## Global Constraints

- 不改 DSH 官方源码；所有改动限 `dsh-swarm/` 包内。
- 交付硬闸在工具边界抛错（throw），不靠提示软约束；P 卡缺 `pt_decision` 直接 blocked。
- v2 断代：`w1-pre`/`w1-supp` 阶段、`judgePTNeeded`/`review_complexity`、`w:file` 交付键、`validateManifestIfPresent`（completeTask 内 w:file 分支）全部删除。
- 主 agent 工具面不注册任何 `kanban_create/complete/block` 与仓库写工具；只读仓库 + 只写 KB/临时目录。
- `planning_checklist_save` 的 `manifest` 复用 `PrefetchManifest` schema（`validatePrefetchManifest`）。
- 阶段序 `['p','pt','w2','d','dt','w3','summary']`；V 仅在规格卡 approved（chain executing）后从 `p` 起跑。
- 库软链到 web profile node_modules；改后需 `npm run build` + 重启 dsh web 生效。

---

### Task 1: 工具边界 schema 修复（kanban-tools enum + spec_card_edit 类型校验）

**Files:**
- Modify: `dsh-swarm/src/tools/kanban-tools.ts:43-44,112`
- Modify: `dsh-swarm/src/tools/spec-card-tools.ts:26-39`
- Test: `dsh-swarm/tests/tools/kanban-tools.test.ts`
- Test: `dsh-swarm/tests/routes/planning-driver.test.ts`（type bug 回归）

**Interfaces:**
- Consumes: `SpecCardSections`（`src/domain/types.ts`）
- Produces: `kanban_create` 接受 `assignee: pt|dt`、`mode: review-plan|review-impl`；`kanban_list` 接受 `pt|dt`；`spec_card_edit` 对 sections 做逐字段类型校验（数组进 string 段 → 抛错）

- [ ] **Step 1: 写失败测试（kanban_create enum + spec_card_edit 类型校验）**

在 `tests/tools/kanban-tools.test.ts` 追加：

```typescript
it('PT/DT 卡可通过 kanban_create schema（v2 schema 漂移修复）', async () => {
  // 走真实 buildKanbanTools 参数校验：模拟 dsh-tools 的 schema 校验行为
  const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'kt-'))));
  const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
  // kanban_create 工具 execute 内部直接调 service.createTask（服务层无 enum 校验），
  // schema 校验由 dsh-tools 参数层完成；此处断言工具 schema 的 enum 值已扩展。
  const tools = buildKanbanTools(svc, () => ({ actor: 'v' as Actor }));
  const create = tools.find((t) => (t as { name?: string }).name === 'kanban_create') as unknown as {
    parameters: { assignee: { enum?: string[] }; mode: { enum?: string[] } };
  };
  expect(create.parameters.assignee.enum).toEqual(expect.arrayContaining(['pt', 'dt']));
  expect(create.parameters.mode.enum).toEqual(expect.arrayContaining(['review-plan', 'review-impl']));
  const list = tools.find((t) => (t as { name?: string }).name === 'kanban_list') as unknown as {
    parameters: { assignee: { enum?: string[] } };
  };
  expect(list.parameters.assignee.enum).toEqual(expect.arrayContaining(['pt', 'dt']));
});

it('spec_card_edit 拒绝数组进 string 段（type bug 回归：testing.trim is not a function）', async () => {
  const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'kt2-'))));
  const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
  const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
  const tools = buildSpecCardTools(svc, () => ({ actor: 'human' as Actor }));
  const edit = tools.find((t) => (t as { name?: string }).name === 'spec_card_edit') as unknown as {
    execute(args: { cardId: string; sections: unknown }): Promise<unknown>;
  };
  await expect(edit.execute({
    cardId: card.id,
    sections: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: ['array'], out_of_scope: 'o' },
  })).rejects.toThrow(/testing|must be a string/i);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd dsh-swarm && npx vitest run tests/tools/kanban-tools.test.ts -t 'PT/DT 卡'`
Expected: FAIL（enum 断言不匹配）+ `spec_card_edit 拒绝数组进 string 段` 尚未实现。

- [ ] **Step 3: 实现 enum 扩展 + spec_card_edit 类型校验**

`src/tools/kanban-tools.ts` 改两处：

```typescript
// L43
assignee: { type: 'string', enum: ['v', 'p', 'w', 'd', 'pt', 'dt'], required: true },
// L44
mode: { type: 'string', enum: ['file', 'external', 'kb', 'openspec', 'mattpocock', 'align', 'execute', 'review-plan', 'review-impl'], required: true },
// L112
assignee: { type: 'string', enum: ['v', 'p', 'w', 'd', 'pt', 'dt'] },
```

`src/tools/spec-card-tools.ts` 的 `spec_card_edit` execute 前加逐字段校验（新增私有函数）：

```typescript
function validateSections(sections: unknown): string[] {
  const errors: string[] = [];
  const s = (sections ?? {}) as Record<string, unknown>;
  const strFields: Array<[string, 'problem' | 'solution' | 'testing' | 'out_of_scope']> = [
    ['problem', 'problem'], ['solution', 'solution'], ['testing', 'testing'], ['out_of_scope', 'out_of_scope'],
  ];
  for (const [, key] of strFields) {
    if (typeof s[key] !== 'string') errors.push(`sections.${key} must be a string (got: ${JSON.stringify(s[key])})`);
  }
  const arrFields: Array<[string, 'user_stories' | 'impl_decisions']> = [['user_stories', 'user_stories'], ['impl_decisions', 'impl_decisions']];
  for (const [, key] of arrFields) {
    if (!Array.isArray(s[key])) errors.push(`sections.${key} must be an array`);
    else if (s[key]!.some((v) => typeof v !== 'string')) errors.push(`sections.${key} must be string[]`);
  }
  return errors;
}
```

`spec_card_edit.execute` 开头插入：

```typescript
const errs = validateSections(args.sections);
if (errs.length > 0) throw new Error('invalid spec card sections: ' + errs.join('; '));
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd dsh-swarm && npx vitest run tests/tools/kanban-tools.test.ts -t 'PT/DT 卡'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add dsh-swarm/src/tools/kanban-tools.ts dsh-swarm/src/tools/spec-card-tools.ts dsh-swarm/tests/tools/kanban-tools.test.ts
git commit -m "fix(tools): kanban_create/list enums add pt/dt/review-plan/review-impl; spec_card_edit typed sections validation"
```

---

### Task 2: 交付契约断代（p:openspec 加 pt_decision 硬键；删 w:file）

**Files:**
- Modify: `dsh-swarm/src/domain/delivery-contract.ts:14-18`
- Modify: `dsh-swarm/src/domain/kanban-service.ts`（pt_decision 闸 + 删 manifest 校验块）
- Test: `dsh-swarm/tests/domain/delivery-contract.test.ts`
- Test: `dsh-swarm/tests/domain/kanban-service.test.ts`

**Interfaces:**
- Consumes: `Handoff`、`Role`、`TaskMode`
- Produces: `pt_decision` 校验函数 `missingPtDecisionKeys(handoff): string[]`；`REQUIRED_DELIVERY['p:openspec'] = ['artifacts_path', 'pt_decision']`；删除 `'w:file'` 键

- [ ] **Step 1: 写失败测试**

`tests/domain/delivery-contract.test.ts` 追加：

```typescript
it('v2: p:openspec 必须带 pt_decision；needed=true 时 reason 必填', () => {
  expect(requiredDeliveryKeys('p', 'openspec')).toEqual(['artifacts_path', 'pt_decision']);
  // 缺 pt_decision → 缺失
  expect(missingDeliveryKeys('p', 'openspec', { summary: 's', metadata: { artifacts_path: '/ws/p.md' }, completedAt: 0 })).toEqual(['pt_decision']);
  // needed=true 无 reason → 缺失（reason 必填）
  expect(missingDeliveryKeys('p', 'openspec', {
    summary: 's', metadata: { artifacts_path: '/ws/p.md', pt_decision: { needed: true } }, completedAt: 0,
  })).toEqual(['pt_decision.reason']);
  // needed=false 无需 reason → 通过
  expect(missingDeliveryKeys('p', 'openspec', {
    summary: 's', metadata: { artifacts_path: '/ws/p.md', pt_decision: { needed: false } }, completedAt: 0,
  })).toEqual([]);
});

it('v2: w:file 交付键已删除（断代，无 W1-pre）', () => {
  expect(requiredDeliveryKeys('w', 'file')).toEqual([]);
});
```

`tests/domain/kanban-service.test.ts` 追加（硬闸）：

```typescript
it('P(openspec) complete 缺 pt_decision → 直接 blocked（hard gate）', async () => {
  // freshChain 建链 + p 卡
  const { svc, chain } = ...; // 复用文件内既有建链 helper
  const p = await svc.createTask({ chainId: chain.id, title: 'p', assignee: 'p', mode: 'openspec' }, 'v');
  await svc.claimTask(p.id, 'system');
  await expect(svc.completeTask(p.id, { summary: 'plan', metadata: { artifacts_path: '/ws/p.md' }, completedAt: 0 }, 'p', { boundTaskId: p.id }))
    .rejects.toThrow(/pt_decision/i);
  const state = await svc.snapshot();
  expect(state.tasks.get(p.id)!.status).toBe('blocked');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd dsh-swarm && npx vitest run tests/domain/delivery-contract.test.ts tests/domain/kanban-service.test.ts`
Expected: FAIL（新断言未实现）。

- [ ] **Step 3: 实现 delivery-contract + kanban-service**

`src/domain/delivery-contract.ts` 修改：

```typescript
const REQUIRED_DELIVERY: Record<string, string[]> = {
  'w:kb': ['kb_url', 'page_path'],
  'p:openspec': ['artifacts_path', 'pt_decision'],
};

/** v2：pt_decision 结构校验（needed 布尔必填；needed=true 时 reason 必填）。返回缺失键列表。 */
export function missingPtDecisionKeys(handoff: Handoff | undefined): string[] {
  const d = (handoff?.metadata ?? {})['pt_decision'];
  if (typeof d !== 'object' || d === null) return ['pt_decision'];
  const o = d as Record<string, unknown>;
  if (typeof o['needed'] !== 'boolean') return ['pt_decision.needed'];
  if (o['needed'] === true && (typeof o['reason'] !== 'string' || o['reason'].trim().length === 0)) {
    return ['pt_decision.reason'];
  }
  return [];
}
```

`missingDeliveryKeys` 内对 `p:openspec` 追加结构校验（在既有 keys 过滤后）：

```typescript
export function missingDeliveryKeys(assignee: Role, mode: TaskMode, handoff: Handoff | undefined): string[] {
  const keys = requiredDeliveryKeys(assignee, mode);
  if (keys.length === 0) return [];
  if (!handoff) return keys.slice();
  const m = handoff.metadata ?? {};
  const missing = keys.filter((k) => {
    if (k === 'pt_decision') return missingPtDecisionKeys(handoff).length > 0;
    const v = m[k];
    return typeof v !== 'string' || v.trim().length === 0;
  });
  return missing;
}
```

`src/domain/kanban-service.ts`：
- 删除 completeTask 内 manifest 校验块（`validateManifestIfPresent` 调用，L177-182）与对应 import。
- 交付契约闸保持（missingDeliveryKeys 已含 pt_decision），其余不变。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd dsh-swarm && npx vitest run tests/domain/delivery-contract.test.ts tests/domain/kanban-service.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add dsh-swarm/src/domain/delivery-contract.ts dsh-swarm/src/domain/kanban-service.ts dsh-swarm/tests/domain/delivery-contract.test.ts dsh-swarm/tests/domain/kanban-service.test.ts
git commit -m "feat(delivery): p:openspec requires pt_decision hard key (reason when needed); drop w:file delivery key (clean break)"
```

---

### Task 3: 需求澄清清单 schema 校验（planning-checklist.ts）

**Files:**
- Create: `dsh-swarm/src/domain/planning-checklist.ts`
- Test: `dsh-swarm/tests/domain/planning-checklist.test.ts`（新）

**Interfaces:**
- Consumes: `PrefetchManifest`、`validatePrefetchManifest`（`src/domain/prefetch-manifest.ts`）、`SpecCardSections`
- Produces:
  - `interface PlanningChecklist { spec: SpecCardSections; manifest: PrefetchManifest; clarifications: Array<{q: string; a: string}>; doubts: Array<{q: string; resolved: boolean; answer?: string}>; }`
  - `validatePlanningChecklist(raw: unknown): string[]`（空数组=合法）

- [ ] **Step 1: 写失败测试**

`tests/domain/planning-checklist.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { validatePlanningChecklist } from '../../src/domain/planning-checklist.js';

const base = {
  spec: { problem: 'p', solution: 's', user_stories: ['u1'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
  manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
  clarifications: [{ q: '目的?', a: 'A' }],
  doubts: [{ q: '权限细节?', resolved: true, answer: '仅本人' }],
};

describe('planning-checklist schema', () => {
  it('合法清单返回空错误', () => {
    expect(validatePlanningChecklist(base)).toEqual([]);
  });
  it('缺 spec 六段 → 报错', () => {
    const bad = { ...base, spec: { ...base.spec, testing: '' } };
    expect(validatePlanningChecklist(bad).join('; ')).toContain('spec.testing');
  });
  it('spec 数组段非数组 → 报错', () => {
    const bad = { ...base, spec: { ...base.spec, user_stories: 'not-array' as never } };
    expect(validatePlanningChecklist(bad).join('; ')).toContain('spec.user_stories');
  });
  it('manifest 非法（复用 validatePrefetchManifest）→ 报错', () => {
    const bad = { ...base, manifest: { repo: { localPath: '' }, files: [] } };
    expect(validatePlanningChecklist(bad).join('; ')).toContain('localPath');
  });
  it('clarifications/doubts 非数组 → 报错', () => {
    expect(validatePlanningChecklist({ ...base, clarifications: 'x' as never })).not.toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd dsh-swarm && npx vitest run tests/domain/planning-checklist.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 planning-checklist.ts**

```typescript
// src/domain/planning-checklist.ts
import type { SpecCardSections } from './types.js';
import { validatePrefetchManifest, type PrefetchManifest } from './prefetch-manifest.js';

export interface PlanningChecklist {
  spec: SpecCardSections;
  manifest: PrefetchManifest; // 复用 PrefetchManifest schema（repo.files 为预取基线）
  clarifications: Array<{ q: string; a: string }>;
  doubts: Array<{ q: string; resolved: boolean; answer?: string }>;
}

const STR_FIELDS: Array<[string, keyof SpecCardSections]> = [
  ['problem', 'problem'], ['solution', 'solution'], ['testing', 'testing'], ['out_of_scope', 'out_of_scope'],
];
const ARR_FIELDS: Array<[string, keyof SpecCardSections]> = [['user_stories', 'user_stories'], ['impl_decisions', 'impl_decisions']];

/** 需求澄清清单 schema 硬校验：返回错误列表（空数组=合法）。清单缺段即拒绝保存（硬闸，主 agent 会话内修正）。 */
export function validatePlanningChecklist(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['checklist must be an object'];
  const c = raw as Record<string, unknown>;
  // spec 六段
  const spec = c['spec'] as Record<string, unknown> | undefined;
  if (typeof spec !== 'object' || spec === null) {
    errors.push('checklist.spec required');
  } else {
    for (const [label, key] of STR_FIELDS) {
      if (typeof spec[key] !== 'string' || (spec[key] as string).trim().length === 0) {
        errors.push(`checklist.spec.${label} must be a non-empty string (got: ${JSON.stringify(spec[key])})`);
      }
    }
    for (const [label, key] of ARR_FIELDS) {
      if (!Array.isArray(spec[key]) || (spec[key] as unknown[]).some((v) => typeof v !== 'string')) {
        errors.push(`checklist.spec.${label} must be string[]`);
      }
    }
  }
  // manifest 复用 PrefetchManifest schema
  errors.push(...validatePrefetchManifest(c['manifest']).map((e) => 'checklist.' + e));
  // 澄清问答/疑问点
  for (const key of ['clarifications', 'doubts'] as const) {
    if (!Array.isArray(c[key])) errors.push(`checklist.${key} must be an array`);
  }
  return errors;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd dsh-swarm && npx vitest run tests/domain/planning-checklist.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add dsh-swarm/src/domain/planning-checklist.ts dsh-swarm/tests/domain/planning-checklist.test.ts
git commit -m "feat(planning): planning-checklist structured schema validation (spec six sections + PrefetchManifest)"
```

---

### Task 4: /plan: 零副作用路由 + /openspec: v2 建链路由

**Files:**
- Modify: `dsh-swarm/src/routes/prefix-router.ts`
- Modify: `dsh-swarm/src/routes/planning-driver.ts`（guidance 文案 v2；approveIfReady 改为 planning 建链入口）
- Test: `dsh-swarm/tests/routes/prefix-router.test.ts`
- Test: `dsh-swarm/tests/routes/planning-driver.test.ts`

**Interfaces:**
- Consumes: `PlanningChecklist`（Task 3）、`KanbanService`、`WikiVaultClient`
- Produces:
  - `handlePlanRoute(message, cfg, ownerSessionId): Promise<PrefixRouteResult>`（不建任何东西，仅返回 kind='plan' + rest）
  - `interface OpenspecPlanningInput { workspaceDir: string | null; checklist: PlanningChecklist; checklistRef: string; }`
  - `handleOpenspecRoute(message, service, cfg, planning, sessionId): Promise<PrefixRouteResult>`（建链+规格卡六段映射+挂 file-prefetch/kb 附件+批准 → chain executing）

- [ ] **Step 1: 写失败测试**

`tests/routes/prefix-router.test.ts` 追加：

```typescript
it('v2: /plan: 零副作用——不建链、不建规格卡、不建任务卡', async () => {
  const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'pr-'))));
  const r = await handlePlanRoute('/plan: 优化登录', { plan: '/plan:', openspec: '/openspec:' }, 'session_main');
  expect(r.kind).toBe('plan');
  expect(r.chainId).toBeUndefined();
  const state = await svc.snapshot();
  expect(state.chains.size).toBe(0);
  expect(state.specCards.size).toBe(0);
  expect(state.tasks.size).toBe(0);
});

it('v2: /openspec: 用清单建链+规格卡六段+附件+批准', async () => {
  const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'pr2-'))));
  const checklist: PlanningChecklist = {
    spec: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
    manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
    clarifications: [], doubts: [],
  };
  const r = await handleOpenspecRoute('/openspec: 确认', svc, { plan: '/plan:', openspec: '/openspec:' }, { workspaceDir: '/ws', checklist, checklistRef: 'projects/checklists/session_main.md' }, 'session_main');
  expect(r.kind).toBe('openspec');
  expect(r.chainId).toBeDefined();
  expect(r.specCardId).toBeDefined();
  const state = await svc.snapshot();
  const chain = state.chains.get(r.chainId!)!;
  expect(chain.status).toBe('executing');
  expect(chain.workspaceDir).toBe('/ws');
  const card = state.specCards.get(r.specCardId!)!;
  expect(card.status).toBe('approved');
  expect(card.sections.problem).toBe('p');
  expect(card.attachments.some((a) => a.kind === 'file-prefetch' && a.ref === '/ws/repo')).toBe(true);
  expect(card.attachments.some((a) => a.kind === 'kb' && a.ref === 'projects/checklists/session_main.md')).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd dsh-swarm && npx vitest run tests/routes/prefix-router.test.ts`
Expected: FAIL（新函数/行为未实现）。

- [ ] **Step 3: 实现 prefix-router v2**

`src/routes/prefix-router.ts` 重写：

```typescript
import { KanbanService } from '../domain/kanban-service.js';
import type { PlanningChecklist } from '../domain/planning-checklist.js';

export interface PrefixRouteResult {
  kind: 'plan' | 'openspec' | 'none';
  chainId?: string;
  specCardId?: string;
  rest: string;
}

export function parsePrefix(message: string, cfg: { plan: string; openspec: string }): PrefixRouteResult {
  const trimmed = message.trim();
  if (trimmed.startsWith(cfg.plan)) return { kind: 'plan', rest: trimmed.slice(cfg.plan.length).trim() };
  if (trimmed.startsWith(cfg.openspec)) return { kind: 'openspec', rest: trimmed.slice(cfg.openspec.length).trim() };
  return { kind: 'none', rest: trimmed };
}

/** v2：/plan: 零副作用——不建链/规格卡/任务卡，仅返回路由结果（workspaceDir/sessionId 由 main-session-tools 捕获）。 */
export async function handlePlanRoute(
  message: string,
  _service: KanbanService,
  cfg: { plan: string; openspec: string },
  _ownerSessionId: string,
): Promise<PrefixRouteResult> {
  return parsePrefix(message, cfg);
}

export interface OpenspecPlanningInput {
  workspaceDir: string | null;
  checklist: PlanningChecklist;
  checklistRef: string; // KB page path 或临时目录路径（checklist 完整资料落点）
}

/** v2：/openspec: 建链——从清单机械映射规格卡六段 → 挂 file-prefetch(仓库 localPath)+kb(清单页) → 批准 → executing。 */
export async function handleOpenspecRoute(
  message: string,
  service: KanbanService,
  cfg: { plan: string; openspec: string },
  planning: OpenspecPlanningInput,
  ownerSessionId: string,
): Promise<PrefixRouteResult> {
  const parsed = parsePrefix(message, cfg);
  if (parsed.kind !== 'openspec') return parsed;
  const chain = await service.createChain({ title: parsed.rest.slice(0, 60), ownerSessionId, workspaceDir: planning.workspaceDir }, 'human');
  const card = await service.createSpecCard(chain.id, planning.checklist.spec, 'human');
  await service.addSpecCardAttachment(card.id, { name: '需求澄清清单(仓库事实)', kind: 'file-prefetch', ref: planning.checklist.manifest.repo.localPath }, 'v');
  await service.addSpecCardAttachment(card.id, { name: '需求澄清清单(完整资料)', kind: 'kb', ref: planning.checklistRef }, 'v');
  await service.approveSpecCard(card.id, 'human');
  return { kind: 'openspec', chainId: chain.id, specCardId: card.id, rest: parsed.rest };
}
```

- [ ] **Step 4: 更新 planning-driver 的 validate 使用 + 跑测试**

`src/routes/planning-driver.ts`：
- `validateSpecCardForApproval` 保留（六段+file-prefetch 附件校验，作为 /openspec: 建卡后防御性断言）。
- `approveIfReady` 保留但不再被 main-session 使用（v2 走 handleOpenspecRoute）；`MATTPOCOCK_PLANNING_GUIDANCE` 文案在 Task 8 改。
- 修复 `validateSpecCardForApproval` 对 `testing.trim` 的 type 脆弱性（v2 由 Task 1 工具层已拦，此处加 guard 兜底）：

```typescript
export function validateSpecCardForApproval(card: SpecCard): string[] {
  const missing: string[] = [];
  const s = card.sections;
  if (typeof s.problem !== 'string' || !s.problem.trim()) missing.push('problem');
  if (typeof s.solution !== 'string' || !s.solution.trim()) missing.push('solution');
  if (!Array.isArray(s.user_stories) || s.user_stories.length === 0) missing.push('user_stories');
  if (typeof s.testing !== 'string' || !s.testing.trim()) missing.push('testing');
  if (typeof s.out_of_scope !== 'string' || !s.out_of_scope.trim()) missing.push('out_of_scope');
  if (!card.attachments.some((a) => a.kind === 'file-prefetch')) missing.push('attachments:file-prefetch');
  return missing;
}
```

Run: `cd dsh-swarm && npx vitest run tests/routes/prefix-router.test.ts tests/routes/planning-driver.test.ts`
Expected: PASS（新增两测试通过；planning-driver 既有测试若引用 handlePlanRoute 旧行为需同步调整——见 Step 5）。

- [ ] **Step 5: 修正旧测试引用（planning-driver.test / main-session 旧用法）**

`tests/routes/planning-driver.test.ts`：若测试走 `handlePlanRoute` 建链再 approve，改为：直接建链+建卡（六段齐全+file-prefetch 附件）后调 `approveIfReady`；或改用 `handleOpenspecRoute`。确保 `approveIfReady` 测试仍覆盖"缺段拒绝"分支。

- [ ] **Step 6: Commit**

```bash
git add dsh-swarm/src/routes/prefix-router.ts dsh-swarm/src/routes/planning-driver.ts dsh-swarm/tests/routes/prefix-router.test.ts dsh-swarm/tests/routes/planning-driver.test.ts
git commit -m "feat(routes): /plan: zero side-effect; /openspec: create chain+spec card from planning checklist with file-prefetch/kb attachments"
```

---

### Task 5: planning_checklist_save + planning_prefetch 工具

**Files:**
- Create: `dsh-swarm/src/tools/planning-tools.ts`
- Test: `dsh-swarm/tests/tools/planning-tools.test.ts`（新）

**Interfaces:**
- Consumes: `KanbanService`、`WikiVaultClient`、`validatePlanningChecklist`、`ToolCaller`、`AgentModelOptions`
- Produces:
  - `interface PlanningToolDeps { service: KanbanService; wiki: WikiVaultClient; getCaller(): ToolCaller; spawnPrefetch?: (prompt: string, workspaceDir: string) => Promise<string>; tempDir: () => string; }`
  - `buildPlanningTools(deps: PlanningToolDeps): Array<{name: string; execute(...): Promise<unknown>}>`
  - 工具 `planning_checklist_save(checklist)` → `{ ok: true; ref: string; source: 'kb'|'temp'; repoPath: string }`（KB 失败兜底临时目录）
  - 工具 `planning_prefetch(scope, repoPath?)` → `{ ok: true; manifest: PrefetchManifest }`（只读子代理返回结构化 repo_facts）

- [ ] **Step 1: 写失败测试**

`tests/tools/planning-tools.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildPlanningTools } from '../../src/tools/planning-tools.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseChecklist = {
  spec: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
  manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
  clarifications: [], doubts: [],
};

function deps(over: Partial<Parameters<typeof buildPlanningTools>[0]> = {}) {
  const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'pt-'))));
  const wiki = { write: vi.fn(async () => ({ path: 'projects/checklists/s.md' })) } as unknown as WikiVaultClient;
  return {
    service: svc, wiki, getCaller: () => ({ actor: 'human' as const }),
    tempDir: () => '/tmp/checklists', ...over,
  };
}

describe('planning tools', () => {
  it('planning_checklist_save: 合法清单写 KB 返回 ref', async () => {
    const tools = buildPlanningTools(deps());
    const t = tools.find((x) => x.name === 'planning_checklist_save')!;
    const res = await t.execute({ checklist: baseChecklist }) as { ok: true; source: string; repoPath: string };
    expect(res.ok).toBe(true);
    expect(res.source).toBe('kb');
    expect(res.repoPath).toBe('/ws/repo');
    expect(res.ref).toContain('projects/checklists/');
  });
  it('planning_checklist_save: KB 不可达 → 兜底临时目录', async () => {
    const wiki = { write: vi.fn(async () => { throw new Error('kb-unreachable'); }) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ wiki }));
    const t = tools.find((x) => x.name === 'planning_checklist_save')!;
    const res = await t.execute({ checklist: baseChecklist }) as { ok: true; source: 'temp'; ref: string };
    expect(res.source).toBe('temp');
    expect(res.ref).toContain('/tmp/checklists/');
  });
  it('planning_checklist_save: schema 非法 → 抛错拒绝', async () => {
    const tools = buildPlanningTools(deps());
    const t = tools.find((x) => x.name === 'planning_checklist_save')!;
    const bad = { ...baseChecklist, spec: { ...baseChecklist.spec, testing: '' } };
    await expect(t.execute({ checklist: bad })).rejects.toThrow(/spec.testing/);
  });
  it('planning_prefetch: 派只读子代理并返回 manifest', async () => {
    const spawnPrefetch = vi.fn(async () => JSON.stringify(baseChecklist.manifest));
    const tools = buildPlanningTools(deps({ spawnPrefetch }));
    const t = tools.find((x) => x.name === 'planning_prefetch')!;
    const res = await t.execute({ scope: '登录模块', repoPath: '/ws/repo' }) as { ok: true; manifest: unknown };
    expect(spawnPrefetch).toHaveBeenCalled();
    expect((res.manifest as { repo: { localPath: string } }).repo.localPath).toBe('/ws/repo');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd dsh-swarm && npx vitest run tests/tools/planning-tools.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 planning-tools.ts**

```typescript
// src/tools/planning-tools.ts
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import type { KanbanService } from '../domain/kanban-service.js';
import type { WikiVaultClient, WikiError } from '../wiki/wiki-vault-client.js';
import { validatePlanningChecklist, type PlanningChecklist } from '../domain/planning-checklist.js';
import { validatePrefetchManifest, type PrefetchManifest } from '../domain/prefetch-manifest.js';
import type { ToolCaller } from './kanban-tools.js';
import type { AgentModelOptions } from '../dispatcher/dispatcher.js';

export interface PlanningToolDeps {
  service: KanbanService;
  wiki: WikiVaultClient;
  getCaller(): ToolCaller;
  /** 真实实现：spawn 只读预取子代理并返回其文本输出；测试注入 stub。 */
  spawnPrefetch?(prompt: string, workspaceDir: string, agentOptions?: AgentModelOptions): Promise<string>;
  tempDir(): string; // 兜底目录（KB 不可达时）
  pagePrefix?: string; // KB 页面前缀（默认 projects/）
  ownerSessionId?: string;
  defaultModel?: AgentModelOptions;
}

const isWikiError = (e: unknown): e is WikiError =>
  e instanceof Error && (e as { code?: string }).code === 'kb-unreachable';

/** 主 agent 规划期工具：需求澄清清单落库（KB 优先/临时目录兜底）+ 只读仓库预取（子代理）。 */
export function buildPlanningTools(deps: PlanningToolDeps) {
  const pagePrefix = deps.pagePrefix ?? 'projects/';
  const session = deps.ownerSessionId ?? 'session_main';

  return [
    defineTool({
      name: 'planning_checklist_save',
      description: 'Save the converged requirement-clarification checklist (structured schema) to KB, falling back to a temp dir if KB is unreachable. Returns ref/path + authoritative repo path.',
      parameters: { checklist: { type: 'json', required: true, description: 'Structured PlanningChecklist: spec six sections + manifest(repo.files) + clarifications + doubts' } },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { checklist: unknown }) {
        const caller = deps.getCaller();
        if (caller.actor !== 'human') throw new Error('permission denied: planning_checklist_save');
        const errors = validatePlanningChecklist(args.checklist);
        if (errors.length > 0) throw new Error('invalid planning checklist: ' + errors.join('; '));
        const checklist = args.checklist as PlanningChecklist;
        const pagePath = `${pagePrefix}checklists/${session}-${Date.now().toString(36)}.md`;
        const body = [
          '# 需求澄清清单',
          '## Spec',
          JSON.stringify(checklist.spec, null, 2),
          '## Repo 事实 (manifest)',
          JSON.stringify(checklist.manifest, null, 2),
          '## 澄清问答',
          JSON.stringify(checklist.clarifications, null, 2),
          '## 疑问点',
          JSON.stringify(checklist.doubts, null, 2),
        ].join('\n\n');
        try {
          await deps.wiki.write(pagePath, body);
          return { ok: true, ref: pagePath, source: 'kb', repoPath: checklist.manifest.repo.localPath } as unknown as JsonValue;
        } catch (err) {
          if (!isWikiError(err)) throw err;
          // KB 不可达 → 临时目录兜底
          const local = `${deps.tempDir()}/${session}-${Date.now().toString(36)}.md`;
          const { writeFileSync, mkdirSync } = await import('node:fs');
          mkdirSync(deps.tempDir(), { recursive: true });
          writeFileSync(local, body, 'utf8');
          return { ok: true, ref: local, source: 'temp', repoPath: checklist.manifest.repo.localPath } as unknown as JsonValue;
        }
      },
    }),
    defineTool({
      name: 'planning_prefetch',
      description: 'Dispatch a READ-ONLY sub-agent to gather repo/material/KB facts for requirement clarification. Returns a structured PrefetchManifest (repo.localPath + files baseline). Never modifies the repo.',
      parameters: {
        scope: { type: 'string', required: true, description: 'What to prefetch (e.g. the target feature area, existing tab implementation, enums)' },
        repoPath: { type: 'string', description: 'Target repo absolute path (if known); sub-agent confirms it' },
      },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { scope: string; repoPath?: string }) {
        const caller = deps.getCaller();
        if (caller.actor !== 'human') throw new Error('permission denied: planning_prefetch');
        const prompt = [
          '# 只读仓库预取（planning_prefetch）',
          `scope: ${args.scope}`,
          `目标仓库路径: ${args.repoPath ?? '(未指定，需你确认绝对路径)'}`,
          '规则：只读采集仓库事实（本地路径/远端 URL/当前分支/未提交改动/目标文件基线），禁止 git 写操作、禁止修改任何文件。',
          '输出：仅输出一个 JSON 对象（无前后缀文字），形如 {"repo":{"localPath":"<绝对路径>","remoteUrl":"<可选>","branch":"<可选>","dirtyFiles":[]},"files":[{"path":"<相对路径>","expected":"exists|absent|content-hash","note":"<可选>"}]}',
        ].join('\n');
        const output = deps.spawnPrefetch
          ? await deps.spawnPrefetch(prompt, args.repoPath ?? '')
          : (() => { throw new Error('planning_prefetch: spawnPrefetch not wired — main-session-tools 必须注入只读预取子代理'); })();
        const manifest = parseManifestOutput(output);
        return { ok: true, manifest } as unknown as JsonValue;
      },
    }),
  ];
}

function parseManifestOutput(output: string): PrefetchManifest {
  const text = output.trim();
  const jsonText = text.startsWith('{') ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error('planning_prefetch: sub-agent did not return valid JSON manifest');
  }
  const errors = validatePrefetchManifest(raw);
  if (errors.length > 0) throw new Error('planning_prefetch: invalid manifest from sub-agent: ' + errors.join('; '));
  return raw as PrefetchManifest;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd dsh-swarm && npx vitest run tests/tools/planning-tools.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add dsh-swarm/src/tools/planning-tools.ts dsh-swarm/tests/tools/planning-tools.test.ts
git commit -m "feat(tools): planning_checklist_save (KB+temp fallback) + planning_prefetch (read-only sub-agent manifest)"
```

---

### Task 6: 主会话工具面重做（planning 工具接线 + /plan: /openspec: 路由 + 护栏）

**Files:**
- Modify: `dsh-swarm/src/tools/main-session-tools.ts`
- Test: `dsh-swarm/tests/tools/planning-route.test.ts`（新，覆盖 kanban_route /plan: + /openspec: 全流程）

**Interfaces:**
- Consumes: `buildPlanningTools`（Task 5）、`handlePlanRoute`/`handleOpenspecRoute`（Task 4）、`PlanningChecklist`
- Produces:
  - `interface PlanningContext { workspaceDir: string | null; sessionId: string; checklist: PlanningChecklist | null; checklistRef: string | null; checklistSource: 'kb' | 'temp' | null; }`
  - `planningBySession: Map<string, PlanningContext>`（模块级，供 planning_checklist_save 回写 + /openspec: 读取）
  - 主 agent 工具面：`kanban_route` + `spec_card_view` + 只读 kanban + `planning_checklist_save` + `planning_prefetch`（无 spec_card_edit/approve、无 kanban_create/complete/block）

- [ ] **Step 1: 写失败测试（规划全流程 + 护栏断言）**

`tests/tools/planning-route.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { registerMainSessionTools } from '../../src/tools/main-session-tools.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseChecklist = {
  spec: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
  manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
  clarifications: [], doubts: [],
};

describe('main-session planning route (v2)', () => {
  it('/plan: 零建卡 + planning_checklist_save + /openspec: 建链→executing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const ctx = {
        get(key: string) {
          if (key === 'tools') return { register(def: { name?: string }): () => void { registry.push(def as never); return () => {}; } };
          if (key === 'kanban') return { service: svc };
          if (key === 'wiki') return new WikiVaultClient({ baseUrl: 'http://mock', pagePrefix: 'projects/' });
          return undefined;
        },
      } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' } } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      const plan = await route.execute({ message: '/plan: 优化登录' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string };
      expect(plan.kind).toBe('plan');
      let state = await svc.snapshot();
      expect(state.chains.size).toBe(0);
      // 保存清单
      const save = registry.find((t) => t.name === 'planning_checklist_save')!;
      await save.execute({ checklist: baseChecklist }, { agent: { session: { header: { cwd: '/ws' } } } });
      // /openspec: 建链
      const open = await route.execute({ message: '/openspec: 确认' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string; chainId?: string };
      expect(open.kind).toBe('openspec');
      state = await svc.snapshot();
      expect(state.chains.size).toBe(1);
      expect(state.chains.get(open.chainId!)!.status).toBe('executing');
      expect(state.chains.get(open.chainId!)!.workspaceDir).toBe('/ws');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('护栏：主 agent 工具面无 spec_card_edit/approve 与 kanban_create', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr2-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const names: string[] = [];
      const ctx = {
        get(key: string) {
          if (key === 'tools') return { register(def: { name?: string }): () => void { if (def.name) names.push(def.name); return () => {}; } };
          if (key === 'kanban') return { service: svc };
          if (key === 'wiki') return new WikiVaultClient({ baseUrl: 'http://mock', pagePrefix: 'projects/' });
          return undefined;
        },
      } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' } } as never);
      expect(names).not.toContain('spec_card_edit');
      expect(names).not.toContain('spec_card_approve');
      expect(names).not.toContain('kanban_create');
      expect(names).not.toContain('kanban_complete');
      expect(names).toContain('kanban_route');
      expect(names).toContain('planning_checklist_save');
      expect(names).toContain('planning_prefetch');
      expect(names).toContain('spec_card_view');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('/openspec: 无清单 → 拒绝（ok:false, reason:no-checklist）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr3-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const ctx = { get: (k: string) => k === 'tools' ? { register: (d: never) => { registry.push(d as never); return () => {}; } } : k === 'kanban' ? { service: svc } : k === 'wiki' ? new WikiVaultClient({ baseUrl: 'http://mock', pagePrefix: 'projects/' }) : undefined } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' } } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      await route.execute({ message: '/plan: 优化登录' }, { agent: { session: { header: { cwd: '/ws' } } } });
      const open = await route.execute({ message: '/openspec: 确认' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string; approved?: boolean };
      expect(open.kind).toBe('openspec');
      expect(open.approved).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd dsh-swarm && npx vitest run tests/tools/planning-route.test.ts`
Expected: FAIL（v2 行为未实现）。

- [ ] **Step 3: 实现 main-session-tools v2**

`src/tools/main-session-tools.ts` 重写核心逻辑：

```typescript
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import type { KanbanConfig } from '../config.js';
import { KanbanProvider } from '../services/kanban-provider.js';
import { buildKanbanTools } from './kanban-tools.js';
import { buildSpecCardTools } from './spec-card-tools.js';
import { buildPlanningTools, type PlanningToolDeps } from './planning-tools.js';
import { handlePlanRoute, handleOpenspecRoute, type OpenspecPlanningInput } from '../routes/prefix-router.js';
import { MATTPOCOCK_PLANNING_GUIDANCE } from '../routes/planning-driver.js';
import { buildReadOnlyWriteGuard } from '../roles/toolsets.js';
import type { PlanningChecklist } from '../domain/planning-checklist.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';

/** v2 规划上下文（/plan: 捕获 → planning_checklist_save 回写 → /openspec: 建链）。模块级内存，随插件进程存活。 */
export interface PlanningContext {
  workspaceDir: string | null;
  sessionId: string;
  checklist: PlanningChecklist | null;
  checklistRef: string | null;
  checklistSource: 'kb' | 'temp' | null;
}
export const planningBySession = new Map<string, PlanningContext>();

const KANBAN_HANDOFF_RULE = `
## 主 agent 铁律（看板工作流 v2）
- 你是计划者：只做需求澄清（grill-me）与最终收尾汇报；绝不执行任务本身。
- 最高护栏：只读仓库——禁止 git 操作、禁止 write/edit 任何仓库源码；只允许写 KB（planning_checklist_save）与临时目录兜底。
- 澄清期：调 planning_prefetch（只读子代理）采集仓库事实 → 逐问用户收敛 → 调 planning_checklist_save 存需求澄清清单 → 提醒用户 /openspec: 确认。
- /openspec: 后链路进入 executing，V 自动串行建卡 p→(pt)→w2→d→dt→w3；你不要自己执行。
- 用 kanban_show / kanban_list / spec_card_view 观察进度，链完成后向用户汇报产物链接与轨迹入口。
`;

export function registerMainSessionTools(ctx: Context, config: KanbanConfig): void {
  const registry = ctx.get('tools') as { register(def: unknown): () => void } | undefined;
  if (!registry) return;
  const provider = ctx.get('kanban') as KanbanProvider | undefined;
  if (!provider) return;
  const service = provider.service;
  const wiki = (ctx.get('wiki') as WikiVaultClient | undefined) ?? (ctx as unknown as { wiki?: WikiVaultClient }).wiki;
  const caller = () => ({ actor: 'human' as const });

  // 只读 kanban 子集（无 create/complete/block）
  const readOnly = new Set(['kanban_show', 'kanban_list', 'kanban_comment']);
  for (const tool of buildKanbanTools(service, caller)) {
    const name = (tool as { name?: string }).name;
    if (name && readOnly.has(name)) registry.register(tool);
  }
  // spec_card_view 仅保留（主 agent 只读规格卡；编辑/批准经清单→/openspec: 建链，GUI 走 HTTP 桥）
  for (const tool of buildSpecCardTools(service, caller)) {
    if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
  }
  // planning 工具（清单落库 + 只读预取）
  const agents = (ctx.get('agents') as { create(o: unknown): Promise<{ agent: unknown }> } | undefined);
  const spawnPrefetch: PlanningToolDeps['spawnPrefetch'] = agents
    ? async (prompt, workspaceDir) => {
        const h = await agents.create({
          sessionId: `kbn-prefetch-${Date.now().toString(36)}`,
          meta: { cwd: workspaceDir || process.cwd() },
          setup: async (agentCtx: Context) => {
            const session = (agentCtx as unknown as { agent?: { session?: { append?(k: string, v: unknown): void } } }).agent?.session;
            session?.append?.('approval/policy', { policy: 'never', source: 'delegation' });
            session?.append?.('sandbox/mode', { mode: 'workspace-write', source: 'delegation' });
            // 只读护栏：拦截仓库写入/git mutation
            const toolsSvc = (agentCtx as { tools?: { guard?: (g: (e: unknown) => string | undefined) => unknown } }).tools;
            const repoRoot = workspaceDir || '/';
            toolsSvc?.guard?.((e: unknown) => buildReadOnlyWriteGuard(repoRoot)(e as { name?: string; arguments?: unknown }));
          },
        });
        // 发送预取指令并等待 idle（假实现以会话事件读取返回；真实实现以 agent 最终文本为准）
        const a = h.agent as { followup?(msg: unknown): void; whenIdle?(): Promise<void>; run?(msg: unknown): Promise<unknown> };
        if (typeof a.run === 'function') {
          const res = await a.run({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } });
          return String((res as { text?: string })?.text ?? res);
        }
        a.followup?.({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } });
        await a.whenIdle?.();
        return '';
      }
    : undefined;

  for (const tool of buildPlanningTools({
    service, wiki,
    getCaller: caller,
    spawnPrefetch,
    tempDir: () => (config.storageDir ?? '$DSH_HOME/storages/kanban').replace('$DSH_HOME', process.env.DSH_HOME ?? process.cwd()) + '/checklists',
    ownerSessionId: 'session_main',
  })) registry.register(tool);

  // kanban_route：/plan: 捕获规划上下文；/openspec: 用清单建链
  registry.register(defineTool({
    name: 'kanban_route',
    description: 'MUST be called when the human message starts with /plan: or /openspec:. This is dsh-swarm planning, NOT the built-in /plan plan mode. /plan: = zero side-effect + start grill-me; /openspec: = create chain from saved checklist and start execution.',
    parameters: { message: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args: { message: string }, exec?: { agent?: { session?: { header?: { cwd?: string } } } }) {
      const workspaceDir = exec?.agent?.session?.header?.cwd ?? null;
      const plan = await handlePlanRoute(args.message, service, config.prefixRoutes, 'session_main');
      if (plan.kind === 'plan') {
        planningBySession.set('session_main', { workspaceDir, sessionId: 'session_main', checklist: null, checklistRef: null, checklistSource: null });
        return { kind: 'plan', guidance: MATTPOCOCK_PLANNING_GUIDANCE + KANBAN_HANDOFF_RULE } as unknown as JsonValue;
      }
      const pctx = planningBySession.get('session_main');
      if (!pctx || !pctx.checklist || !pctx.checklistRef) {
        return { kind: 'openspec', approved: false, reason: 'no-checklist', guidance: '尚未保存需求澄清清单：请先调 planning_prefetch 采集仓库事实、完成 grill-me 澄清后，调 planning_checklist_save 保存清单，再发 /openspec: 确认。' + MATTPOCOCK_PLANNING_GUIDANCE } as unknown as JsonValue;
      }
      const input: OpenspecPlanningInput = { workspaceDir: pctx.workspaceDir, checklist: pctx.checklist, checklistRef: pctx.checklistRef };
      const r = await handleOpenspecRoute(args.message, service, config.prefixRoutes, input, 'session_main');
      return { kind: 'openspec', chainId: r.chainId, specCardId: r.specCardId, approved: true, guidance: KANBAN_HANDOFF_RULE } as unknown as JsonValue;
    },
  }));
  console.info('[dsh-swarm] main-session tools registered (v2: kanban_route + planning + spec view + read-only kanban)');
}
```

`planning_checklist_save` 需要回写 `planningBySession`——`buildPlanningTools` 的 execute 内需拿到 store。给 `PlanningToolDeps` 加 `onChecklistSaved?(ctx: PlanningContext): void`，或直接传 `planningStore` 引用。**修正**：在 Task 5 的 `PlanningToolDeps` 增加字段并在 execute 成功时回调：

```typescript
// planning-tools.ts 追加到 PlanningToolDeps：
onChecklistSaved?(saved: { ref: string; source: 'kb' | 'temp'; checklist: PlanningChecklist }): void;
// planning_checklist_save 成功分支（kb 与 temp 两处）各调用：
deps.onChecklistSaved?.({ ref: pagePath, source: 'kb', checklist });
// temp 分支：
deps.onChecklistSaved?.({ ref: local, source: 'temp', checklist });
```

main-session-tools 接线（规划工具注册处）增加：

```typescript
onChecklistSaved({ ref, source, checklist }) {
  const cur = planningBySession.get('session_main') ?? { workspaceDir: null, sessionId: 'session_main', checklist: null, checklistRef: null, checklistSource: null };
  planningBySession.set('session_main', { ...cur, checklist, checklistRef: ref, checklistSource: source });
},
```

- [ ] **Step 4: 复用 buildReadOnlyWriteGuard（roles/toolsets.ts 已导出）**

`src/roles/toolsets.ts` 已导出 `buildReadOnlyWriteGuard(repoRoot)`（PT/DT 评审同款只读护栏，拦截仓库写入/git mutation）——Step 3 已 import 直接复用，无需新 guard。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd dsh-swarm && npx vitest run tests/tools/planning-route.test.ts`
Expected: PASS。

- [ ] **Step 6: 类型检查**

Run: `cd dsh-swarm && npx tsc -p tsconfig.json --noEmit`
Expected: 无错误（Task 5/6 接口闭合）。

- [ ] **Step 7: Commit**

```bash
git add dsh-swarm/src/tools/main-session-tools.ts dsh-swarm/src/tools/planning-tools.ts dsh-swarm/tests/tools/planning-route.test.ts
git commit -m "feat(main-session): v2 planning route (plan: zero side-effect capture / openspec: create chain from checklist) + planning tools + read-only guardrail"
```

---

### Task 7: V 阶段机 v2（去 w1-pre/w1-supp；PT 读 pt_decision；建卡失败防护）

**Files:**
- Modify: `dsh-swarm/src/dispatcher/v-orchestrator.ts`
- Modify: `dsh-swarm/src/dispatcher/event-waker.ts`
- Test: `dsh-swarm/tests/dispatcher/v-orchestrator.test.ts`

**Interfaces:**
- Consumes: P 卡交接 `pt_decision`（Task 2）、`handleOpenspecRoute` 挂好的 file-prefetch 附件（Task 4）
- Produces:
  - `VPhase = 'p' | 'pt' | 'w2' | 'd' | 'dt' | 'w3' | 'summary'`
  - `R20_PHASE_ORDER = ['p','pt','w2','d','dt','w3','summary']`
  - `ChainOrchestration` 增加可选 `stallCount?: number`
  - V 仅在 approved 后从 `p` 起跑；PT 判定读 `pt_decision.needed`；建卡失败连续 2 轮 → `[create-failed]` system 评论停住

- [ ] **Step 1: 写失败测试（v2 阶段序 + pt_decision 分流 + 建卡失败防护）**

`tests/dispatcher/v-orchestrator.test.ts` 更新既有 `gates phase p on spec approval` 测试 + 新增：

```typescript
it('v2: w1-pre 不再建卡；批准后 V 直接建 p', async () => {
  const { svc, dir, chain, card } = await freshChain();
  try {
    const agents = fakeV(svc, chain.id, 'none');
    const orchMap = new Map();
    const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
    await orch.wakeV(chain.id);
    expect(fakeV.lastCreated).toEqual({ assignee: '', mode: '', taskId: '' }); // 未批准：不建卡
    await svc.approveSpecCard(card.id, 'human');
    await orch.wakeV(chain.id);
    expect(fakeV.lastCreated.assignee).toBe('p');
    expect(fakeV.lastCreated.mode).toBe('openspec');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('v2: P pt_decision.needed=false → 跳过 PT 直接 w2；needed=true → 建 PT 卡（reason 入 body）', async () => {
  const { svc, dir, chain, card } = await freshChain();
  try {
    const agents = fakeV(svc, chain.id, 'none');
    const orchMap = new Map();
    const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
    await orch.wakeV(chain.id); // p
    await completePWithPtDecision(svc, false); // needed=false
    await orch.wakeV(chain.id);
    expect(fakeV.lastCreated.assignee).toBe('w');
    expect(fakeV.lastCreated.mode).toBe('kb'); // 跳过 pt
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

在测试文件加 helper（替代 `completePWithComplexity`）：

```typescript
async function completePWithPtDecision(svc: KanbanService, needed: boolean, reason?: string) {
  const t = [...(await svc.snapshot()).tasks.values()].find((x) => x.assignee === 'p' && x.mode === 'openspec' && x.status !== 'done')!;
  await svc.claimTask(t.id, 'system');
  const meta: Record<string, unknown> = { artifacts_path: '/ws/plan.md', pt_decision: { needed } };
  if (needed) meta['pt_decision'] = { needed, reason: reason ?? '涉及多模块接口改动' };
  await svc.completeTask(t.id, { summary: 'plan', metadata: meta, completedAt: 0 }, 'p', { boundTaskId: t.id });
  return t;
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd dsh-swarm && npx vitest run tests/dispatcher/v-orchestrator.test.ts`
Expected: FAIL（v2 行为未实现）。

- [ ] **Step 3: 实现 v-orchestrator v2**

`src/dispatcher/v-orchestrator.ts` 修改：

```typescript
export type VPhase = 'p' | 'pt' | 'w2' | 'd' | 'dt' | 'w3' | 'summary';
export interface ChainOrchestration {
  chainId: string;
  phase: VPhase;
  sessionId: string | null;
  waitingOn: string | null;
  stallCount?: number;
}
export const R20_PHASE_ORDER: VPhase[] = ['p', 'pt', 'w2', 'd', 'dt', 'w3', 'summary'];
export const R20_PHASE_EXPECT: Record<VPhase, { assignee: Role; mode: TaskMode } | null> = {
  p: { assignee: 'p', mode: 'openspec' },
  pt: { assignee: 'pt', mode: 'review-plan' },
  w2: { assignee: 'w', mode: 'kb' },
  d: { assignee: 'd', mode: 'execute' },
  dt: { assignee: 'dt', mode: 'review-impl' },
  w3: { assignee: 'w', mode: 'kb' },
  summary: null,
};
```

删除 `ReviewComplexity` 接口与 `judgePTNeeded` 函数（断代）。

`PHASE_INSTRUCTIONS` 删除 `w1-pre`/`w1-supp`；`p` 段改：

```typescript
p: [
  '## P 阶段任务体要求（计划者，非执行者）',
  'body 写入规划指令：读规格卡（含 file-prefetch/kb 附件=需求澄清清单）→ 产出 openspec 实施计划（proposal/design/tasks）写入任务工作区，complete 带 artifacts_path。',
  '铁律：P 是计划者，绝不执行任何 git/worktree/commit/push/代码改动；不得把执行步骤当作 P 的交付。',
  'complete 时 metadata 必须带 schema 合法的 pt_decision = { needed: boolean, reason?: string }（needed=true 时 reason 必填）：按设计规则（复杂度标准）判定是否需要计划评审，需要则给简短理由。',
  '仓库事实不足（清单/附件缺关键目标文件或仓库路径未实证）时，禁止编造计划——调用 kanban_block，reason 带 kb-insufficient，等主 agent 补清单后恢复。',
].join('\n'),
pt: [
  '## PT 阶段任务体要求（计划评审，只读）',
  'body 写入计划评审指令：P 已判定需要计划评审（理由见上）。只读评审 P 的计划产物（对齐需求/完整性/逻辑交互一致性），输出 verdict+issues 入交接 metadata.review_evidence。',
  '铁律：PT 是只读评审角色，绝不修改任何产物/源码；不调用 kanban_create、不执行代码。',
].join('\n'),
```

`currentPhase` 默认 phase 改：

```typescript
o = { chainId, phase: 'p', sessionId: null, waitingOn: null };
```

`wakeV` 修改：
- 删除 P1-2 挂附件块（L150-161）。
- B4 门控（L198/L205）改：`if (!approved) return;`（V 仅 approved 后行动）。
- 删除 w1-supp 跳过块（L208-216）。
- PT 跳过逻辑（L222-234）改读 pt_decision：

```typescript
if (orch.phase === 'pt') {
  const fresh = await this.kanban.snapshot();
  const hasPtCard = [...fresh.tasks.values()].some((t) => t.chainId === chainId && t.assignee === 'pt' && t.mode === 'review-plan');
  if (!hasPtCard) {
    const pTask = [...fresh.tasks.values()].find((t) => t.chainId === chainId && t.assignee === 'p' && t.mode === 'openspec');
    const pHandoff = pTask ? fresh.handoffs.get(pTask.id) : null;
    const decision = (pHandoff?.metadata?.['pt_decision'] as { needed?: boolean } | undefined);
    if (decision && decision.needed === false) {
      orch.phase = this.advance(orch.phase);
      orch.waitingOn = 'task/completed';
      continue;
    }
  }
}
```

- 建卡失败防护（在 `if (firstMatch)` 之前插入）：

```typescript
if (!firstMatch) {
  orch.stallCount = (orch.stallCount ?? 0) + 1;
  if (orch.stallCount >= 2) {
    const anchor = chainTasks.filter((t) => terminal.includes(t.status)).at(-1) ?? chainTasks.at(-1);
    if (anchor && !state.events.some((e) => e.taskId === anchor.id && e.kind === 'task/commented' && String(e.payload['body'] ?? '').startsWith('[create-failed]'))) {
      await this.kanban.comment(anchor.id, `[create-failed] 阶段 ${orch.phase} 建卡未产生期望卡（assignee=${expect.assignee}, mode=${expect.mode}）。请检查工具 schema/可用性后人工处理。`, 'system');
    }
  }
  return;
}
orch.stallCount = 0;
```

- PT 卡 body 注入 reason：在 context 组装处，`PHASE_INSTRUCTIONS[orch.phase]` 前对 pt 阶段注入 P 的 reason：

```typescript
// 在 wakeV 的 context 数组里（既有各元素之后）追加两行：
const ptReason = orch.phase === 'pt' ? extractPtReason(state, chainId) : '';
// ...(既有 context 数组元素保持不动)...
PHASE_INSTRUCTIONS[orch.phase] ?? '',
(ptReason ? '## P 判定需要计划评审的理由\n' + ptReason : ''),
```

加 helper：

```typescript
function extractPtReason(state: BoardState, chainId: string): string {
  const pTask = [...state.tasks.values()].find((t) => t.chainId === chainId && t.assignee === 'p' && t.mode === 'openspec');
  const d = (pTask ? state.handoffs.get(pTask.id)?.metadata?.['pt_decision'] : undefined) as { reason?: string } | undefined;
  return typeof d?.reason === 'string' ? d.reason : '';
}
```

- 建卡指令中 `NEXT_TASK_ASSIGNEE=... MODE=...` 保留；`title 自拟` 文案去 W1-pre 示例。

`src/dispatcher/event-waker.ts` 的 `wakeable` 去掉 `chain/created`：

```typescript
const wakeable =
  (ev.kind === 'task/completed' || ev.kind === 'task/blocked' || ev.kind === 'spec-card/approved');
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd dsh-swarm && npx vitest run tests/dispatcher/v-orchestrator.test.ts tests/dispatcher/event-waker.test.ts`
Expected: PASS（既有"detects wrong-assignee"等测试按新 R20 行为对齐；`fakeV` 的 `NEXT_TASK_ASSIGNEE` 解析兼容）。

- [ ] **Step 5: 类型检查**

Run: `cd dsh-swarm && npx tsc -p tsconfig.json --noEmit`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add dsh-swarm/src/dispatcher/v-orchestrator.ts dsh-swarm/src/dispatcher/event-waker.ts dsh-swarm/tests/dispatcher/v-orchestrator.test.ts dsh-swarm/tests/dispatcher/event-waker.test.ts
git commit -m "feat(orchestrator): v2 phase order p→(pt)→w2→d→dt→w3; PT via pt_decision; create-failure guard; drop w1-pre/w1-supp & judgePTNeeded"
```

---

### Task 8: 主会话 guidance 文案 v2 + 规划驱动校验加固

**Files:**
- Modify: `dsh-swarm/src/routes/planning-driver.ts`（`MATTPOCOCK_PLANNING_GUIDANCE` v2）
- Test: `dsh-swarm/tests/routes/planning-driver.test.ts`

**Interfaces:**
- Consumes: `planning_checklist_save`/`planning_prefetch`（Task 5）
- Produces: v2 规划引导文案（grill-me + prefetch + checklist + 只读仓库铁律）

- [ ] **Step 1: 改文案**

`src/routes/planning-driver.ts`：

```typescript
export const MATTPOCOCK_PLANNING_GUIDANCE = `
# 阶段 0 规划对话（v2：需求澄清前置化）
1. 需求澄清（grill-me）：一次只问一个问题，先澄清目的、约束、成功标准；逐项拷问假设直至用户"没有任何疑问"。
2. 仓库事实（planning_prefetch）：调只读子代理采集目标仓库/资料/知识库事实（本地路径/分支/目标文件基线/既有实现），不凭空假设。
3. 收敛（planning_checklist_save）：把结论写成结构化需求澄清清单（spec 六段 + manifest repo.files + 澄清问答 + 疑问点）存入 KB（KB 不可达自动兜底临时目录）。
4. 收尾：提醒用户以 /openspec: 确认执行结束规划阶段——/openspec: 会从清单建链并自动串行执行。
护栏：规划期只读仓库，禁止任何 git/源码写入；只写 KB 与临时目录。
`;
```

- [ ] **Step 2: 更新测试断言（若引用旧文案）**

`tests/routes/planning-driver.test.ts`：文案断言改为包含 `planning_prefetch` / `planning_checklist_save`。

- [ ] **Step 3: 跑测试 + Commit**

Run: `cd dsh-swarm && npx vitest run tests/routes/planning-driver.test.ts`
Expected: PASS。

```bash
git add dsh-swarm/src/routes/planning-driver.ts dsh-swarm/tests/routes/planning-driver.test.ts
git commit -m "docs(planning): v2 planning guidance (grill-me + prefetch + checklist, read-only repo rule)"
```

---

### Task 9: personas/预设更新（P pt_decision、W 去 W1-pre、V 去 W1-pre）

**Files:**
- Modify: `dsh-swarm/personas/persona-p.md`
- Modify: `dsh-swarm/personas/persona-w.md`
- Modify: `dsh-swarm/personas/persona-v.md`
- Modify: `dsh-swarm/personas/persona-dt.md` / `persona-pt.md`（若引用 w1-pre/review_complexity）

**Interfaces:**
- Consumes: Task 7 的 phase 语义
- Produces: 角色提示与 v2 阶段序/交付契约一致

- [ ] **Step 1: persona-p.md 补 pt_decision 交付契约**

在"交付物"段补充：

```markdown
- complete 时 metadata 必须带 `pt_decision`：`{ needed: boolean, reason?: string }`（needed=true 时 reason 必填）。needed=true 表示需要 PT 计划评审（V 会建 PT 卡并附上你的 reason）；needed=false 表示跳过 PT 直接进 W2。
```

- [ ] **Step 2: persona-w.md 去 W1-pre/W1-supp 职责**

删除 W1-pre 预取/manifest 相关描述；W 职责收敛为 W2/W3 KB 同步（wiki_write → kb_url+page_path），明确"不做仓库预取、不做代码操作"。

- [ ] **Step 3: persona-v.md 去 w1-pre 编排 + 失败防护说明**

更新 V 编排序列为 `p→(pt)→w2→d→dt→w3`；说明 PT 卡按 P 的 pt_decision 创建（reason 入 body）；建卡连续失败 → 停等人工（[create-failed] 评论）。

- [ ] **Step 4: 全局 grep 清理残留**

Run: `cd dsh-swarm && rg -n "w1-pre|w1-supp|review_complexity|judgePTNeeded" personas/ src/ --glob '!**/lib/**'`
Expected: 无命中（或仅注释残留已清理）。

- [ ] **Step 5: Commit**

```bash
git add dsh-swarm/personas/
git commit -m "docs(personas): v2 roles — P pt_decision contract, W kb-only (no w1-pre), V new phase order + failure guard"
```

---

### Task 10: 测试套件重写（e2e + fake-driver 走 v2）

**Files:**
- Modify: `dsh-swarm/tests/e2e/fake-agent-driver.ts`
- Modify: `dsh-swarm/tests/e2e/full-chain.test.ts`
- Test: 全部 `cd dsh-swarm && npx vitest run`

**Interfaces:**
- Consumes: v2 路由（Task 4）、pt_decision（Task 2）、V 阶段机（Task 7）
- Produces: v2 全链 e2e（/plan: → 清单 → /openspec: → p→w2→d→dt→w3 → completed）

- [ ] **Step 1: 重写 fake-agent-driver v2**

`tests/e2e/fake-agent-driver.ts` 重写 `runFullChain`（去掉 w1-pre 阶段；/plan: 零副作用；清单保存 + /openspec: 建链）：

```typescript
import { KanbanService } from '../../src/domain/kanban-service.js';
import { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';
import { handlePlanRoute, handleOpenspecRoute } from '../../src/routes/prefix-router.js';
import { validatePlanningChecklist, type PlanningChecklist } from '../../src/domain/planning-checklist.js';
import type { Task } from '../../src/domain/types.js';

const R20_ORDER: Array<{ assignee: 'p' | 'w' | 'd'; mode: Task['mode'] }> = [
  { assignee: 'p', mode: 'openspec' },
  { assignee: 'w', mode: 'kb' }, { assignee: 'd', mode: 'execute' },
  { assignee: 'dt', mode: 'review-impl' }, { assignee: 'w', mode: 'kb' },
];

const CHECKLIST: PlanningChecklist = {
  spec: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
  manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
  clarifications: [], doubts: [],
};

export async function runFullChain(
  svc: KanbanService,
  opts: { planMsg: string; openspecMsg: string; failWiki?: boolean; ptNeeded?: boolean },
): Promise<{ chainId: string; tasks: Task[]; wiki: { setOk(v: boolean): void } }> {
  const cfg = { plan: '/plan:', openspec: '/openspec:' };
  const wiki = { ok: !opts.failWiki, setOk(v: boolean) { this.ok = v; } };
  const wc = { write: async () => { if (!wiki.ok) throw Object.assign(new Error('unreachable'), { code: 'kb-unreachable' }); return { path: 'projects/x' }; }, baseUrl: 'http://mock' } as unknown as WikiVaultClient;
  // /plan: 零副作用（v2）
  const plan = await handlePlanRoute(opts.planMsg, svc, cfg, 'session_main');
  expectPlan(plan.kind === 'plan');
  // 清单保存 + /openspec: 建链
  expect(validatePlanningChecklist(CHECKLIST)).toEqual([]);
  const open = await handleOpenspecRoute(opts.openspecMsg, svc, cfg, { workspaceDir: '/ws', checklist: CHECKLIST, checklistRef: 'projects/checklists/session_main.md' }, 'session_main');
  const chainId = open.chainId!;
  // 阶段 1：串行执行（v2：p→w2→d→dt→w3）
  const tasks: Task[] = [];
  for (const step of R20_ORDER) {
    const t = await svc.createTask({ chainId, title: step.mode, assignee: step.assignee, mode: step.mode, parents: tasks.map((x) => x.id) }, 'v');
    await svc.claimTask(t.id, 'system');
    if (step.assignee === 'w' && step.mode === 'kb') {
      const res = await wc.write('projects/x', 'content').catch((e) => e);
      if (res && res.code === 'kb-unreachable') {
        await svc.blockTask(t.id, 'kb-unreachable', 'w', { boundTaskId: t.id });
        tasks.push(t);
        return { chainId, tasks, wiki: wiki as never };
      }
      await svc.completeTask(t.id, { summary: 'synced', metadata: { kb_url: 'http://mock/#/page/projects/x', page_path: 'projects/x' }, completedAt: Date.now() }, 'w', { boundTaskId: t.id });
    } else if (step.assignee === 'p') {
      await svc.completeTask(t.id, { summary: 'plan', metadata: { artifacts_path: '/ws/plan.md', pt_decision: { needed: opts.ptNeeded ?? false } }, completedAt: Date.now() }, 'p', { boundTaskId: t.id });
    } else if (step.assignee === 'd') {
      await svc.completeTask(t.id, { summary: 'impl', metadata: { changed_files: ['auth.ts'], verification: ['pytest'], commit_hash: 'deadbeef', push: true }, completedAt: Date.now() }, 'd', { boundTaskId: t.id });
    } else if (step.assignee === 'dt') {
      await svc.completeTask(t.id, { summary: 'reviewed', metadata: { review_evidence: { verdict: 'pass', issues: [], test: { exit: 0 }, build: { exit: 0 }, lint: { exit: 0 }, diff: { files: ['auth.ts'] }, git: { branch: 'feat/x' }, openCodeReview: { conclusion: 'pass' } } }, completedAt: Date.now() }, 'dt', { boundTaskId: t.id });
    }
    tasks.push(t);
  }
  return { chainId, tasks, wiki: wiki as never };
}

function expectPlan(v: boolean): asserts v { if (!v) throw new Error('expected /plan: route'); }
```

- [ ] **Step 2: 更新 full-chain.test.ts 断言**

`tests/e2e/full-chain.test.ts`：

```typescript
const order = tasks.map((t) => `${t.assignee}:${t.mode}`);
expect(order).toEqual(['p:openspec', 'w:kb', 'd:execute', 'dt:review-impl', 'w:kb']); // v2：含 dt，无 w1-pre
```

- [ ] **Step 3: 全量跑测试**

Run: `cd dsh-swarm && npx vitest run`
Expected: 全部 PASS（如有残留失败，按断代语义修正对应断言——`rg review_complexity|w1-pre|w:file` 清理测试残留）。

- [ ] **Step 4: Commit**

```bash
git add dsh-swarm/tests/
git commit -m "test(e2e): v2 full-chain (plan zero-side-effect → checklist → openspec → p→w2→d→dt→w3)"
```

---

### Task 11: 断代数据清理 + build + lib 重建 + 重启验证

**Files:**
- 数据: `~/.dsh/storages/kanban/orchestration.json`、`events.jsonl`（旧链）
- Build: `dsh-swarm/lib/**`（npm run build 重建）
- 运行: dsh web 进程（软链 node_modules 已指向源码）

**Interfaces:**
- Consumes: 全部 v2 代码（Task 1-10）

- [ ] **Step 1: 备份并清理旧链编排状态**

Run（备份后清空 orchestration.json 中旧链条目；旧任务已 archived 无需迁移）：

```bash
cp ~/.dsh/storages/kanban/orchestration.json ~/.dsh/storages/kanban/orchestration.json.bak-$(date +%s)
node -e "const fs=require('fs');const p=process.env.HOME+'/.dsh/storages/kanban/orchestration.json';const o=JSON.parse(fs.readFileSync(p,'utf8'));const keys=Object.keys(o);for(const k of keys){if(/^ch_/.test(k))delete o[k];}fs.writeFileSync(p,JSON.stringify(o,null,2));console.log('cleared chains:',keys.filter(k=>/^ch_/.test(k)).join(','))"
```

Expected: 输出旧链 id 列表；orchestration.json 仅剩非链键（若有）。

- [ ] **Step 2: 类型检查 + 全量测试 + build**

```bash
cd dsh-swarm && npx tsc -p tsconfig.json --noEmit && npx vitest run && npm run build
```

Expected: typecheck 无错、全部测试 PASS、`lib/` 重建成功（含 kanban-tools.js / v-orchestrator.js / prefix-router.js 等新内容）。

- [ ] **Step 3: 重启 dsh web 加载新 lib**

```bash
rtk ps aux | rg 'dsh'   # 找到 dsh web 进程（PID）
# 停止并重启 dsh web（沿用既有重启方式）
```

Expected: 新进程加载重建后的 lib；`dsh-swarm` 正常启动日志无异常。

- [ ] **Step 4: 冒烟验证 v2 全流程（GUI 或 /plan: 触发）**

发起 `/plan: 优化登录 / projA / auth` → 确认：无 W1-pre 卡；主 agent 走 grill-me + planning_prefetch + planning_checklist_save → `/openspec: 确认` → 链 executing → V 建 p 卡串行执行。

Expected: 看板出现 p→(pt)→w2→d→dt→w3 序列，无 w1-pre。

- [ ] **Step 5: Commit（若代码残留）**

```bash
git add -A dsh-swarm
git commit -m "chore: v2 refactor build + lib rebuild + old chain data cleanup"
```

---

## Self-Review

**Spec coverage:**
- Q1 /plan: 零副作用捕获 workspaceDir/sessionId → Task 4/6；W1-pre 删除 → Task 7/9/11；子代理预取 → Task 5/6
- Q2 PT schema 漂移 → Task 1；pt_decision 硬键 → Task 2/7；V 建卡失败防护 → Task 7
- Q3 工具面错位/spec 卡查询/类型 bug → Task 1/6（spec_card_view 保留、edit 去注册、类型校验）
- 护栏（只读仓库/只写 KB+临时）→ Task 5/6；需求澄清清单存 KB/临时兜底 → Task 3/5；/openspec: 建链+派生六段+挂附件 → Task 4；阶段序 → Task 7；断代 → Task 2/11
- 旧链清理 → Task 11；personas → Task 9；e2e → Task 10

**Placeholder scan:** 无 TBD；所有新增函数给全签名与代码；测试含具体断言。

**Type consistency:** `PlanningChecklist`（Task 3）被 Task 4 `OpenspecPlanningInput` 与 Task 5 工具、Task 6 `PlanningContext` 引用，字段一致（spec/manifest/clarifications/doubts）。`pt_decision { needed, reason? }` 在 Task 2 契约、Task 7 V 判定、Task 9 persona、Task 10 驱动统一。`PlanningToolDeps.onChecklistSaved` 在 Task 5 定义、Task 6 接线闭合。
