# 合入门控 + Prefetch Manifest 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 architecture-review.md 高优建议 1、2 —— (1) D 不再提前 merge+push 到 TARGET_BRANCH，改由 DT 通过后 system 合入；(2) W1-pre 引入可选结构化 prefetch manifest + schema 校验，P 缺事实显式 `kb-insufficient` 阻断。

**Architecture:** 保持现有"角色单职责 + 证据化交付 + 系统确定性推进"骨架，非破坏性补强。合入逻辑独立成 `src/dispatcher/merge-gate.ts`（纯函数 + 可注入 git 执行器，便于单测），挂到 dispatcher 链完成钩子（`setOnChainCompleted`），复用 `resolveTargetRepoDir` / git-credentials 模式。manifest 校验独立成 `src/domain/prefetch-manifest.ts` 纯函数，接入 `completeTask` 交付闸。D/DT 指令与 persona 同步调整（DT 评审目标改为 feature 分支）。

**Tech Stack:** TypeScript / Node 22 / vitest / cordis 插件（dsh-kanban）。无新增依赖。

## Global Constraints

- 质量门禁（AGENTS.md §5）：改完必须跑 `npx tsc -p tsconfig.json --noEmit`（0 错误）+ `npx vitest run` + `npm run build`（产出 lib/ + client.js）。
- 模板字符串里写正则必须双重转义 `\\b`/`\\s`（AGENTS.md §4），写盘后用 `xxd` 抽查字节（0x5c 0x62 / 0x5c 0x73）。
- 会话作用域：扫描会话必须用 `Chain.workspaceDir` + `isPathInside` 收窄（AGENTS.md §1）。
- 不改版本/依赖；注释用中文（项目惯例）。
- 非破坏性：legacy 链路（缺 manifest / 缺 branch metadata）一律软跳过、软记录，不引入新硬阻塞。

---

### Task 1: Prefetch manifest 领域模块（纯函数 + 单测）

**Files:**
- Create: `src/domain/prefetch-manifest.ts`
- Test: `tests/domain/prefetch-manifest.test.ts`

**Interfaces:**
- Consumes: `Handoff`、`Role`、`TaskMode`（`src/domain/types.ts`，已存在）
- Produces:
  - `interface PrefetchFileEntry { path: string; expected: 'exists'|'absent'|'content-hash'; note?: string }`
  - `interface PrefetchManifest { repo: { localPath: string; remoteUrl?: string; branch?: string; dirtyFiles: string[] }; files: PrefetchFileEntry[] }`
  - `validatePrefetchManifest(raw: unknown): string[]`（空数组 = 合法）
  - `validateManifestIfPresent(assignee: Role, mode: TaskMode, handoff: Handoff | undefined): string[]`（轻档：仅 w:file 且带 manifest 时校验；缺 manifest 不拦）

- [ ] **Step 1: Write the failing test**

创建 `tests/domain/prefetch-manifest.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { validatePrefetchManifest, validateManifestIfPresent } from '../../src/domain/prefetch-manifest.js';

const validManifest = {
  repo: { localPath: '/ws/repo', remoteUrl: 'http://x/r.git', branch: 'main', dirtyFiles: ['a.ts'] },
  files: [
    { path: 'README.md', expected: 'exists' },
    { path: 'src/old.ts', expected: 'absent' },
    { path: 'src/config.ts', expected: 'content-hash', note: 'abc123' },
  ],
};

describe('validatePrefetchManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(validatePrefetchManifest(validManifest)).toEqual([]);
  });
  it('rejects non-object', () => {
    expect(validatePrefetchManifest('x')).not.toEqual([]);
    expect(validatePrefetchManifest(null)).not.toEqual([]);
  });
  it('requires repo.localPath non-empty string', () => {
    expect(validatePrefetchManifest({ ...validManifest, repo: { ...validManifest.repo, localPath: '  ' } })).toContain('manifest.repo.localPath required');
  });
  it('requires repo.dirtyFiles array', () => {
    expect(validatePrefetchManifest({ ...validManifest, repo: { ...validManifest.repo, dirtyFiles: 'x' } })).toContain('manifest.repo.dirtyFiles must be an array');
  });
  it('requires files array with path and expected enum', () => {
    expect(validatePrefetchManifest({ ...validManifest, files: [] })).toEqual([]);
    expect(validatePrefetchManifest({ ...validManifest, files: [{ path: 'x', expected: 'bogus' }] })).toContain('manifest.files[].expected');
    expect(validatePrefetchManifest({ ...validManifest, files: [{ path: '  ', expected: 'exists' }] })).toContain('manifest.files[].path');
  });
  it('requires note for content-hash', () => {
    expect(validatePrefetchManifest({ ...validManifest, files: [{ path: 'x', expected: 'content-hash' }] })).toContain('manifest.files[].note');
  });
});

describe('validateManifestIfPresent (light tier)', () => {
  it('w:file without manifest passes (legacy compatible)', () => {
    expect(validateManifestIfPresent('w', 'file', { summary: 's', metadata: { ref: '/ws' }, completedAt: 1 })).toEqual([]);
    expect(validateManifestIfPresent('w', 'file', undefined)).toEqual([]);
  });
  it('w:file with invalid manifest reports errors', () => {
    expect(validateManifestIfPresent('w', 'file', { summary: 's', metadata: { ref: '/ws', manifest: { bad: true } }, completedAt: 1 })).not.toEqual([]);
  });
  it('non w:file roles ignore manifest', () => {
    expect(validateManifestIfPresent('p', 'openspec', { summary: 's', metadata: { manifest: { bad: true } }, completedAt: 1 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/prefetch-manifest.test.ts`
Expected: FAIL with "Cannot find module '../../src/domain/prefetch-manifest.js'".

- [ ] **Step 3: Write minimal implementation**

创建 `src/domain/prefetch-manifest.ts`：

```ts
// src/domain/prefetch-manifest.ts
import type { Handoff, Role, TaskMode } from './types.js';

export interface PrefetchFileEntry {
  path: string;
  expected: 'exists' | 'absent' | 'content-hash';
  note?: string;
}

export interface PrefetchManifest {
  repo: { localPath: string; remoteUrl?: string; branch?: string; dirtyFiles: string[] };
  files: PrefetchFileEntry[];
}

const EXPECTED_VALUES = new Set(['exists', 'absent', 'content-hash']);

/** W1-pre 预取清单 schema 校验：返回错误列表（空数组 = 合法）。 */
export function validatePrefetchManifest(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['manifest must be an object'];
  const m = raw as Record<string, unknown>;
  const repo = m['repo'];
  if (typeof repo !== 'object' || repo === null) {
    errors.push('manifest.repo required');
  } else {
    const r = repo as Record<string, unknown>;
    if (typeof r['localPath'] !== 'string' || r['localPath'].trim().length === 0) {
      errors.push('manifest.repo.localPath required (non-empty string)');
    }
    if (!Array.isArray(r['dirtyFiles'])) errors.push('manifest.repo.dirtyFiles must be an array');
  }
  if (!Array.isArray(m['files'])) {
    errors.push('manifest.files must be an array');
  } else {
    for (const f of m['files']) {
      if (typeof f !== 'object' || f === null) { errors.push('manifest.files entry must be an object'); continue; }
      const e = f as Record<string, unknown>;
      if (typeof e['path'] !== 'string' || e['path'].trim().length === 0) errors.push('manifest.files[].path required (non-empty string)');
      if (typeof e['expected'] !== 'string' || !EXPECTED_VALUES.has(e['expected'])) {
        errors.push('manifest.files[].expected must be one of exists|absent|content-hash (got ' + String(e['expected']) + ')');
      }
      if (e['expected'] === 'content-hash' && (typeof e['note'] !== 'string' || e['note'].trim().length === 0)) {
        errors.push('manifest.files[].note required when expected=content-hash');
      }
    }
  }
  return errors;
}

/** 轻档：仅 w:file（W1-pre）交接且带 manifest 时做 schema 校验；缺 manifest 不算缺失（legacy 兼容）。 */
export function validateManifestIfPresent(assignee: Role, mode: TaskMode, handoff: Handoff | undefined): string[] {
  if (assignee !== 'w' || mode !== 'file') return [];
  const m = (handoff?.metadata ?? {})['manifest'];
  if (m === undefined || m === null) return [];
  return validatePrefetchManifest(m).map((e) => 'invalid prefetch manifest: ' + e);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/prefetch-manifest.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/prefetch-manifest.ts tests/domain/prefetch-manifest.test.ts
git commit -m "feat: add prefetch manifest schema validation (light tier)"
```

---

### Task 2: completeTask 接入 manifest 校验闸

**Files:**
- Modify: `src/domain/kanban-service.ts:6`（import）+ `:162-168`（delivery-contract 块后插入 manifest 块）
- Test: `tests/domain/kanban-service.test.ts`（追加用例）

**Interfaces:**
- Consumes: `validateManifestIfPresent`（Task 1）
- Produces: W1-pre complete 时若 metadata.manifest 非法 → 任务被标 `blocked`（reason 前缀 `invalid prefetch manifest:`），complete 抛错；缺 manifest → 正常 done

- [ ] **Step 1: Write the failing test**

在 `tests/domain/kanban-service.test.ts` 的 `describe('KanbanService')` 内追加：

```ts
  it('light-tier manifest: W1-pre invalid manifest is blocked, absent manifest completes', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      // 缺 manifest → 通过（legacy 兼容）
      const w1 = await svc.createTask({ chainId: chain.id, title: 'w1', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1.id, 'system');
      const ok = await svc.completeTask(w1.id, { summary: 'f', metadata: { ref: '/ws' }, completedAt: Date.now() }, 'w', { boundTaskId: w1.id });
      expect(ok.status).toBe('done');
      // 非法 manifest → 拒绝完成 + 标 blocked
      const w1b = await svc.createTask({ chainId: chain.id, title: 'w1b', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1b.id, 'system');
      await expect(svc.completeTask(w1b.id, { summary: 'f', metadata: { ref: '/ws', manifest: { bad: true } }, completedAt: Date.now() }, 'w', { boundTaskId: w1b.id })).rejects.toThrow(/invalid prefetch manifest/);
      const st = await svc.snapshot();
      expect(st.tasks.get(w1b.id)!.status).toBe('blocked');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/kanban-service.test.ts -t manifest`
Expected: FAIL（completeTask 尚未校验 manifest，非法 manifest 不会 block）。

- [ ] **Step 3: Write minimal implementation**

`src/domain/kanban-service.ts` 顶部 import 区加一行（第 7 行 `missingDeliveryKeys` 之后）：

```ts
import { validateManifestIfPresent } from './prefetch-manifest.js';
```

在 delivery-contract 块（`missingDeliveryKeys` 的 `{...}` 结束 `}`，第 168 行）之后、`task/completed` emit（第 169 行）之前插入：

```ts
    // 轻档 manifest 校验（W1-pre）：交接带 manifest 则 schema 校验，非法即 block（缺 manifest 不拦，legacy 兼容）。
    {
      const manifestErrors = validateManifestIfPresent(t.assignee, t.mode, handoff);
      if (manifestErrors.length > 0) {
        await this.emit({ chainId: t.chainId, taskId, kind: 'task/blocked', payload: { reason: manifestErrors.join('; ') }, author: 'system', at: Date.now() });
        throw new Error(manifestErrors.join('; '));
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/kanban-service.test.ts`
Expected: PASS（含新用例 + 既有 45/45 用例）。

- [ ] **Step 5: Commit**

```bash
git add src/domain/kanban-service.ts tests/domain/kanban-service.test.ts
git commit -m "feat: block W1-pre on invalid prefetch manifest in completeTask"
```

---

### Task 3: W1/P 阶段指令更新（manifest 产出 + kb-insufficient 显式阻断）

**Files:**
- Modify: `src/dispatcher/v-orchestrator.ts`（`PHASE_INSTRUCTIONS` 加 `export`；w1-pre / p 数组追加文案）
- Test: `tests/dispatcher/v-orchestrator.test.ts`（追加断言）

**Interfaces:**
- Consumes: 无新依赖
- Produces: `PHASE_INSTRUCTIONS` 改为导出（测试可读）；w1-pre 指令含 manifest 说明；P 指令含 `kb-insufficient` 阻断说明

- [ ] **Step 1: Write the failing test**

在 `tests/dispatcher/v-orchestrator.test.ts` 顶部 import 增加 `PHASE_INSTRUCTIONS`，文件内追加：

```ts
import { VOrchestrator, PHASE_INSTRUCTIONS, type ChainOrchestration } from '../../src/dispatcher/v-orchestrator.js';
```

```ts
describe('PHASE_INSTRUCTIONS (M5 阶段指令)', () => {
  it('w1-pre 指令说明可选 manifest 产出', () => {
    expect(PHASE_INSTRUCTIONS['w1-pre']).toContain('manifest');
  });
  it('P 指令含 kb-insufficient 显式阻断通道', () => {
    expect(PHASE_INSTRUCTIONS['p']).toContain('kb-insufficient');
    expect(PHASE_INSTRUCTIONS['p']).toContain('kanban_block');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dispatcher/v-orchestrator.test.ts -t PHASE_INSTRUCTIONS`
Expected: FAIL（当前无 `manifest`/`kb-insufficient` 文案，且 `PHASE_INSTRUCTIONS` 未导出）。

- [ ] **Step 3: Write minimal implementation**

`src/dispatcher/v-orchestrator.ts`：
1. 第 68 行 `const PHASE_INSTRUCTIONS` 改 `export const PHASE_INSTRUCTIONS`。
2. `'w1-pre'` 数组（第 69-72 行）在现有元素后追加：

```ts
    'complete 时 metadata 可选带 manifest（结构化预取清单：repo.localPath/remoteUrl/branch/dirtyFiles + files[{path, expected: exists|absent|content-hash, note}]）。提供则 system 会 schema 校验，非法即 block；不提供不拦（legacy 兼容）。',
```

3. `p` 数组（第 77-82 行）在末尾追加：

```ts
    '仓库事实不足（W1 未给 manifest 或关键目标文件缺失）时，禁止编造计划——调用 kanban_block，reason 带 kb-insufficient，等补预取/人工介入后再规划。',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dispatcher/v-orchestrator.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/dispatcher/v-orchestrator.ts tests/dispatcher/v-orchestrator.test.ts
git commit -m "feat: add manifest output + kb-insufficient guidance to W1/P phase instructions"
```

---

### Task 4: D/DT 指令与 persona 更新（停止提前合入，DT 评审 feature 分支）

**Files:**
- Modify: `src/dispatcher/v-orchestrator.ts`（`PHASE_INSTRUCTIONS` 的 `d` / `dt` 数组）
- Modify: `personas/kanban-d/agent.cordis.yml`（规则 3、7）
- Modify: `personas/kanban-dt/agent.cordis.yml`（规则 3）
- Test: `tests/dispatcher/v-orchestrator.test.ts`（追加断言）

**Interfaces:**
- Consumes: 无
- Produces: D 完成交接必须带 `branch`（feature 分支名）；D 不再 merge-back / 推 TARGET_BRANCH；DT 评审目标为 `metadata.branch` 指向的 feature 分支

- [ ] **Step 1: Write the failing test**

`tests/dispatcher/v-orchestrator.test.ts` 的 `describe('PHASE_INSTRUCTIONS')` 内追加：

```ts
  it('D 指令停止 merge-back，要求 branch metadata', () => {
    const d = PHASE_INSTRUCTIONS['d']!;
    expect(d).toContain('branch=<feature 分支名>');
    expect(d).toContain('禁止合并回 TARGET_BRANCH');
    expect(d).not.toContain('合并回 TARGET_BRANCH 再 push');
  });
  it('DT 指令评审目标为 feature 分支（非 TARGET_BRANCH）', () => {
    expect(PHASE_INSTRUCTIONS['dt']).toContain('metadata.branch');
    expect(PHASE_INSTRUCTIONS['dt']).toContain('--to <branch>');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dispatcher/v-orchestrator.test.ts -t 'D 指令|DT 指令'`
Expected: FAIL（旧文案 `合并回 TARGET_BRANCH 再 push` 仍在，缺 branch 要求）。

- [ ] **Step 3: Write minimal implementation**

`src/dispatcher/v-orchestrator.ts` `PHASE_INSTRUCTIONS.d`（第 92-98 行）整体替换为：

```ts
  d: [
    '## D 阶段任务体要求（执行者，唯一，非只读对齐/校验）',
    'body 写入执行指令：先读父任务交接（W2）里的 page_path/kb_url，用 wiki_read 读取 openspec 实施计划原文，再按计划执行规格卡 solution/testing —— git worktree/branch → 改代码/README → git commit → git push（仅 feature 分支，可选）→ 自检（跑测试/构建）并附产物证据（changed_files/commit_hash）。',
    'body 第一行以 TARGET_REPO=<真实仓库绝对路径> 声明目标仓库：必须取自规格卡 file-prefetch 附件 ref（W1-pre 交接的真实路径），禁止写 kanban 存储目录、禁止猜测回退。',
    'body 同时声明 TARGET_BRANCH=<目标分支名>（来自规格卡/用户声明）：D 在 worktree feature 分支完成实现并验证后即 complete，禁止合并回 TARGET_BRANCH、禁止推 TARGET_BRANCH——合入由 DT 通过后 system 统一执行。',
    'complete 时 metadata 必须带 branch=<feature 分支名>（DT 评审与 system 合入定位该分支用）；git 证据 changed_files + commit_hash 必须（push 可选，可推 feature 分支）。',
    '禁止把 D 任务体写成"只读对齐/校验/审核"类措辞——D 是唯一执行者，必须实际改代码并提交推送。',
  ].join('\n'),
```

`PHASE_INSTRUCTIONS.dt`（第 99-103 行）第一条文案替换为：

```ts
    'body 写入实现校验指令：对 D 产物实证校验（test/build/typecheck/diff/git 证据 + open-code-review 评审），输出 verdict+issues 入交接 metadata.review_evidence。评审目标为 D 交接 metadata.branch 指向的 feature 分支（ocr review --from <TARGET_BRANCH> --to <branch>），而非 TARGET_BRANCH。',
```

`personas/kanban-d/agent.cordis.yml`：
- 规则 3（第 23-25 行）改为：

```yaml
      3. Handoff metadata MUST carry git artifact evidence: changed_files (array) + (commit_hash |
      push at least one), plus branch=<your feature branch name> (required: DT reviews it and the
      system merges it into TARGET_BRANCH only after DT approves), plus verification/kb_url where
      applicable, and a non-empty summary; without evidence kanban_complete is rejected and the
      chain will not close.
```

- 规则 7（第 36-37 行）改为：

```yaml
      7. Commit convention: `<type>: [AI-GEN] <one-line concise description>` (type in
      feat/fix/chore/docs/refactor/test/perf/ci...). Workflow: worktree isolated branch →
      implement + verify → [AI-GEN] commit → (optionally push the feature branch). Do NOT merge
      back into the Body's TARGET_BRANCH and do NOT push TARGET_BRANCH — that merge is performed
      by the system only after DT approves.
```

`personas/kanban-dt/agent.cordis.yml` 规则 3（第 24-26 行）改为：

```yaml
      3. Review engine priority: open-code-review (ocr review --from <TARGET_BRANCH> --to
      <branch>, delegation mode; <branch> = D's feature branch from the parent handoff
      metadata.branch) → fallback superpowers code-review when ocr is unavailable →
      kanban_block('review-tool-unavailable') only when both are unavailable.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dispatcher/v-orchestrator.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: PASS + 0 错误。

- [ ] **Step 5: Commit**

```bash
git add src/dispatcher/v-orchestrator.ts personas/kanban-d/agent.cordis.yml personas/kanban-dt/agent.cordis.yml tests/dispatcher/v-orchestrator.test.ts
git commit -m "feat: D stops early merge/push, DT reviews feature branch (branch metadata)"
```

---

### Task 5: merge-gate 模块（纯函数 + 单测）

**Files:**
- Create: `src/dispatcher/merge-gate.ts`
- Test: `tests/dispatcher/merge-gate.test.ts`

**Interfaces:**
- Consumes: `resolveTargetRepoDir`（`src/dispatcher/target-repo.ts`，已存在）、`KanbanService`、`BoardState`/`Task`（`types.ts`）、`execFileSync`
- Produces:
  - `interface MergeInput { repoDir: string; targetBranch: string; featureBranch: string }`
  - `MERGE_DONE_PREFIX` / `MERGE_SKIP_PREFIX` / `MERGE_FAILED_PREFIX`
  - `interface GitRun { (args: string[], cwd: string): string }`
  - `realGitRun(args: string[], cwd: string): string`
  - `resolveMergeInput(dTask: Task, state: BoardState, fallbackRepo: string): MergeInput | null`
  - `isAlreadyMerged(state: BoardState, dTaskId: string, repoDir: string, targetBranch: string, featureBranch: string, git: GitRun): boolean`
  - `runMergeGate(kanban: KanbanService, state: BoardState, dTask: Task, input: MergeInput, git?: GitRun): Promise<'merged'|'failed'|'skipped'>`
  - `mergeDAfterReview(kanban: KanbanService, chainId: string, fallbackRepo: string): Promise<'merged'|'failed'|'skipped'>`

- [ ] **Step 1: Write the failing test**

创建 `tests/dispatcher/merge-gate.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveMergeInput, isAlreadyMerged, runMergeGate,
  MERGE_DONE_PREFIX, MERGE_FAILED_PREFIX, type GitRun,
} from '../../src/dispatcher/merge-gate.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import type { BoardState, Task } from '../../src/domain/types.js';

function dTask(body: string): Task {
  return { id: 't_d', chainId: 'ch_1', title: 'd', body, assignee: 'd', status: 'done', mode: 'execute', priority: 1, parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [], sessionId: 'kbn-t_d', reworkOfTaskId: null, resumeSessionId: null, reviewAttempt: 0, reviewStatus: 'not-required' };
}
function stateWith(d: Task, metadata: Record<string, unknown>, events: Array<{ taskId: string | null; kind: string; payload: Record<string, unknown> }>): BoardState {
  return { chains: new Map(), tasks: new Map([[d.id, d]]), specCards: new Map(), handoffs: new Map([[d.id, { summary: 's', metadata, completedAt: 1 }]]), auditWarnings: new Map(), events };
}
const noopKanban = { comment: async () => ({}) } as unknown as KanbanService;

describe('resolveMergeInput', () => {
  it('parses repoDir/TARGET_BRANCH/feature branch from D body + handoff', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mg-'));
    try {
      const d = dTask('TARGET_REPO=' + dir + '\nTARGET_BRANCH=main');
      const input = resolveMergeInput(d, stateWith(d, { branch: 'feat/abc' }, []), '/fallback');
      expect(input).toEqual({ repoDir: dir, targetBranch: 'main', featureBranch: 'feat/abc' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('returns null when branch metadata missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mg2-'));
    try {
      const d = dTask('TARGET_REPO=' + dir + '\nTARGET_BRANCH=main');
      expect(resolveMergeInput(d, stateWith(d, {}, []), '/fallback')).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('returns null when TARGET_BRANCH marker missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mg3-'));
    try {
      const d = dTask('TARGET_REPO=' + dir);
      expect(resolveMergeInput(d, stateWith(d, { branch: 'feat/a' }, []), '/fallback')).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('isAlreadyMerged', () => {
  const gitFail: GitRun = () => { throw new Error('exit 1'); };
  it('true when a [merge-done] comment exists', () => {
    const d = dTask('');
    const st = stateWith(d, { branch: 'f' }, [{ taskId: 't_d', kind: 'task/commented', payload: { body: '[merge-done] merged' } }]);
    expect(isAlreadyMerged(st, 't_d', '/r', 'main', 'f', gitFail)).toBe(true);
  });
  it('true when branch is ancestor of target (git exit 0)', () => {
    const d = dTask('');
    const okGit: GitRun = () => '';
    expect(isAlreadyMerged(stateWith(d, { branch: 'f' }, []), 't_d', '/r', 'main', 'f', okGit)).toBe(true);
  });
  it('false when neither (git exits non-zero, no comment)', () => {
    const d = dTask('');
    expect(isAlreadyMerged(stateWith(d, { branch: 'f' }, []), 't_d', '/r', 'main', 'f', gitFail)).toBe(false);
  });
});

describe('runMergeGate', () => {
  it('runs checkout/merge/push and records [merge-done]', async () => {
    const calls: string[][] = [];
    const git: GitRun = (a) => { calls.push(a); if (a[0] === 'rev-parse') return 'abc123'; return ''; };
    const d = dTask('');
    const comments: string[] = [];
    const kanban = { comment: async (_t: string, b: string) => { comments.push(b); } } as unknown as KanbanService;
    const r = await runMergeGate(kanban, stateWith(d, { branch: 'f' }, []), d, { repoDir: '/r', targetBranch: 'main', featureBranch: 'f' }, git);
    expect(r).toBe('merged');
    expect(calls.map((a) => a[0])).toEqual(['checkout', 'merge', 'push', 'rev-parse']);
    expect(comments[0]).toContain(MERGE_DONE_PREFIX);
  });
  it('records [merge-failed] without throwing on git error', async () => {
    const git: GitRun = () => { throw new Error('conflict'); };
    const d = dTask('');
    const comments: string[] = [];
    const kanban = { comment: async (_t: string, b: string) => { comments.push(b); } } as unknown as KanbanService;
    const r = await runMergeGate(kanban, stateWith(d, { branch: 'f' }, []), d, { repoDir: '/r', targetBranch: 'main', featureBranch: 'f' }, git);
    expect(r).toBe('failed');
    expect(comments[0]).toContain(MERGE_FAILED_PREFIX);
  });
  it('skips when already merged (no git calls)', async () => {
    const git: GitRun = () => { throw new Error('should not run'); };
    const d = dTask('');
    const st = stateWith(d, { branch: 'f' }, [{ taskId: 't_d', kind: 'task/commented', payload: { body: '[merge-done] x' } }]);
    const r = await runMergeGate(noopKanban, st, d, { repoDir: '/r', targetBranch: 'main', featureBranch: 'f' }, git);
    expect(r).toBe('skipped');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dispatcher/merge-gate.test.ts`
Expected: FAIL with "Cannot find module '../../src/dispatcher/merge-gate.js'".

- [ ] **Step 3: Write minimal implementation**

创建 `src/dispatcher/merge-gate.ts`：

```ts
// src/dispatcher/merge-gate.ts
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KanbanService } from '../domain/kanban-service.js';
import type { BoardState, Task } from '../domain/types.js';
import { resolveTargetRepoDir } from './target-repo.js';

/** 合入输入：repoDir=目标仓库绝对路径；targetBranch=规格卡声明分支；featureBranch=D 交接 metadata.branch。 */
export interface MergeInput {
  repoDir: string;
  targetBranch: string;
  featureBranch: string;
}

export const MERGE_DONE_PREFIX = '[merge-done]';
export const MERGE_SKIP_PREFIX = '[merge-skip]';
export const MERGE_FAILED_PREFIX = '[merge-failed]';

export interface GitRun { (args: string[], cwd: string): string }

/** 真实 git 执行器：execFileSync 同步执行，非零退出抛错（与 git-credentials.ts 同模式）。 */
export function realGitRun(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** 从 D(execute) 终态卡解析合入输入。任一要素缺失（repo 不存在 / TARGET_BRANCH 标记 / branch metadata）→ null（软跳过）。 */
export function resolveMergeInput(dTask: Task, state: BoardState, fallbackRepo: string): MergeInput | null {
  const repoDir = resolveTargetRepoDir(dTask, state, fallbackRepo);
  if (!repoDir || !existsSync(resolve(repoDir))) return null;
  const targetBranch = dTask.body?.match(/TARGET_BRANCH\s*=\s*(\S+)/)?.[1];
  const featureBranch = String(state.handoffs.get(dTask.id)?.metadata?.['branch'] ?? '').trim();
  if (!targetBranch || !featureBranch) return null;
  return { repoDir, targetBranch, featureBranch };
}

/** 幂等判定：已存在 [merge-done] 评论，或 feature 分支已是 target 祖先（git merge-base --is-ancestor exit 0）。 */
export function isAlreadyMerged(
  state: BoardState,
  dTaskId: string,
  repoDir: string,
  targetBranch: string,
  featureBranch: string,
  git: GitRun,
): boolean {
  const doneComment = state.events.some((e) =>
    e.taskId === dTaskId && e.kind === 'task/commented' &&
    String(e.payload['body'] ?? '').startsWith(MERGE_DONE_PREFIX));
  if (doneComment) return true;
  try { git(['merge-base', '--is-ancestor', featureBranch, targetBranch], repoDir); return true; } catch { return false; }
}

/**
 * 执行合入（DT 通过后由 system 调用）：checkout target → merge --no-ff feature → push。
 * 返回 'merged' | 'failed' | 'skipped'。失败不抛：记录 [merge-failed] 评论，链仍可收尾
 * （坏代码未被合入 = 方向安全；人工可事后修复）。
 */
export async function runMergeGate(
  kanban: KanbanService,
  state: BoardState,
  dTask: Task,
  input: MergeInput,
  git: GitRun = realGitRun,
): Promise<'merged' | 'failed' | 'skipped'> {
  const { repoDir, targetBranch, featureBranch } = input;
  if (isAlreadyMerged(state, dTask.id, repoDir, targetBranch, featureBranch, git)) return 'skipped';
  try {
    git(['checkout', targetBranch], repoDir);
    git(['merge', '--no-ff', featureBranch, '-m', `[AI-GEN] merge ${featureBranch} into ${targetBranch} after DT pass`], repoDir);
    git(['push'], repoDir);
    const hash = git(['rev-parse', 'HEAD'], repoDir);
    await kanban.comment(dTask.id, `${MERGE_DONE_PREFIX} merged ${featureBranch} → ${targetBranch} hash=${hash}`, 'system');
    return 'merged';
  } catch (err) {
    await kanban.comment(dTask.id, `${MERGE_FAILED_PREFIX} merge ${featureBranch} → ${targetBranch} failed: ${String(err)}`, 'system');
    return 'failed';
  }
}

/** 链完成钩子入口（dispatcher setOnChainCompleted 调用）：DT 通过后合入。解析失败软跳过。 */
export async function mergeDAfterReview(
  kanban: KanbanService,
  chainId: string,
  fallbackRepo: string,
): Promise<'merged' | 'failed' | 'skipped'> {
  const state = await kanban.snapshot();
  const dTask = [...state.tasks.values()].find((t) =>
    t.chainId === chainId && t.assignee === 'd' && t.mode === 'execute' && t.status === 'done');
  if (!dTask) return 'skipped';
  const input = resolveMergeInput(dTask, state, fallbackRepo);
  if (!input) {
    await kanban.comment(dTask.id, `${MERGE_SKIP_PREFIX} 无法解析合入输入（缺 branch metadata / TARGET_BRANCH 标记 / repo 不存在），跳过自动合入`, 'system');
    return 'skipped';
  }
  return runMergeGate(kanban, state, dTask, input);
}
```

注意 AGENTS.md §4：本文件唯一正则 `TARGET_BRANCH\s*=\s*(\S+)` 在普通字符串字面量里（非模板字符串），`\s` 不受转义陷阱影响，无需双重转义。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dispatcher/merge-gate.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: PASS + 0 错误。

- [ ] **Step 5: Commit**

```bash
git add src/dispatcher/merge-gate.ts tests/dispatcher/merge-gate.test.ts
git commit -m "feat: add merge gate (post-DT system merge to TARGET_BRANCH)"
```

---

### Task 6: dispatcher 链完成钩子接入合入门控

**Files:**
- Modify: `src/dispatcher/dispatcher.ts:8`（import）+ `:228-237`（`setOnChainCompleted` 回调）
- Test: 无新单测（`startDispatcherInner` 未导出，薄胶水；由 tsc + 既有 dispatcher 测试 + e2e 覆盖）

**Interfaces:**
- Consumes: `mergeDAfterReview`（Task 5）、`storageDir`/`logFile`（`startDispatcherInner` 作用域内）
- Produces: 每条链 `chain/completed` 后自动执行 post-DT 合入；结果落 `dispatcher.log`

- [ ] **Step 1: Write minimal implementation**

`src/dispatcher/dispatcher.ts` 顶部 import 区加：

```ts
import { mergeDAfterReview } from './merge-gate.js';
```

`startDispatcherInner` 的 `kanban.setOnChainCompleted(async (chainId) => { ... })` 回调体（第 228-237 行）末尾追加：

```ts
    // 合入门控（architecture-review 建议1）：DT 通过后由 system 合入 TARGET_BRANCH；D 不再提前 merge/push。
    // 解析失败软跳过（[merge-skip]），合入失败记录 [merge-failed]，均不阻断收尾（坏代码未被合入 = 方向安全）。
    try {
      const r = await mergeDAfterReview(kanban, chainId, storageDir);
      if (r !== 'skipped') logToFile(logFile, '[merge-gate] chain=' + chainId + ' result=' + r);
    } catch (err) {
      console.error('[dsh-kanban][debug] merge gate failed ' + chainId + ': ' + String(err));
      logToFile(logFile, '[merge-gate] error chain=' + chainId + ' ' + String(err));
    }
```

- [ ] **Step 2: Verify compile + existing tests**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run tests/dispatcher/dispatcher.test.ts`
Expected: 0 错误 + PASS。

- [ ] **Step 3: Commit**

```bash
git add src/dispatcher/dispatcher.ts
git commit -m "feat: run post-DT merge gate on chain completion"
```

---

### Task 7: 文档同步 + 全量质量门禁

**Files:**
- Modify: `personas/persona-d.md`（第 7、13 行）、`personas/persona-v.md`（第 10 行）、`personas/persona-dt.md`（第 9、17 行）
- Modify: `docs/chain-simulation-user-crud.md`（第 92-100、149 行）
- Modify: `docs/architecture-review.md`（第 83-84 行勾选）

**Interfaces:** 无（纯文档一致性同步，防止文档描述的合入时序与实际实现脱节）

- [ ] **Step 1: 同步 persona markdown**

`personas/persona-d.md`：
- 第 7 行：`git worktree/branch → 按规格卡 solution/testing 改代码/README → git commit → git push → 自检` 改为 `git worktree/branch → 按规格卡 solution/testing 改代码/README → git commit →（可选推 feature 分支）→ 自检（跑测试/构建/typecheck）→ complete 带 branch=<feature 分支名>`。
- 第 13 行：`worktree 隔离分支 → 实现+验证 → [AI-GEN] commit → 合并回 Body 的 TARGET_BRANCH → push` 改为 `worktree 隔离分支 → 实现+验证 → [AI-GEN] commit →（可选推 feature 分支）。禁止合并回 TARGET_BRANCH / 推 TARGET_BRANCH——由 DT 通过后 system 合入`。

`personas/persona-v.md` 第 10 行：`git worktree/branch → 改代码/README → commit → push → 自检` 改为 `git worktree/branch → 改代码/README → commit → 自检；complete 带 branch metadata；TARGET_BRANCH 合入由 DT 通过后 system 执行`。

`personas/persona-dt.md` 第 9、17 行：`ocr review --from <base> --to <TARGET_BRANCH>` 改为 `ocr review --from <TARGET_BRANCH> --to <branch>`（branch 取 D 交接 metadata.branch）。

- [ ] **Step 2: 同步 flow 文档**

`docs/chain-simulation-user-crud.md`：第 100 行 `[AI-GEN] commit → 合并回 TARGET_BRANCH → push` 改为 `[AI-GEN] commit → 推 feature 分支 → complete(branch)`；第 149 行 mermaid `[AI-GEN] commit → merge → push` 改为 `[AI-GEN] commit → complete(branch)`。

`docs/architecture-review.md`：第 83 行 `- [ ] D 改推 feature 分支，merge→TARGET_BRANCH 后置到 DT pass 后（建议 1）` 改 `- [x] ...`；第 84 行 `- [ ] W1 预取 manifest 结构化 + schema 校验（建议 2）` 改 `- [x] ...`。并在"总结"后加一行注记：`注：建议 3（写护栏加固）未实施，见实施计划 2026-08-19-merge-gate-and-prefetch-manifest.md 裁剪说明。`

- [ ] **Step 3: 全量质量门禁**

Run:
```bash
npx tsc -p tsconfig.json --noEmit
npx vitest run
npm run build
```
Expected: 0 错误；vitest 全绿（187 + 新增用例）；build 产出 lib/ + client.js。

- [ ] **Step 4: Commit**

```bash
git add personas/persona-d.md personas/persona-v.md personas/persona-dt.md docs/chain-simulation-user-crud.md docs/architecture-review.md
git commit -m "docs: sync merge-timing + manifest flow after merge gate"
```

---

## Self-Review（对照 spec 自查）

1. **Spec 覆盖**：建议 1（合入时序）→ Task 4（D/DT 指令）/Task 5/6（merge gate）；建议 2（manifest）→ Task 1/2/3。无遗漏。
2. **Placeholder 扫描**：所有代码步骤含完整实现，无 "TBD"/"适当处理" 占位。
3. **类型一致性**：`validateManifestIfPresent(assignee: Role, mode: TaskMode, handoff)` 在 Task 1 定义、Task 2 消费一致；`MergeInput`/`resolveMergeInput`/`runMergeGate`/`mergeDAfterReview` 在 Task 5 定义、Task 6 消费一致；`PHASE_INSTRUCTIONS` 导出在 Task 3 引入、Task 3/4 测试消费一致。
4. **已确认的权衡**：
   - 合入挂在链完成钩子（W3 之后）而非 DT pass 当刻——`chain/completed` 事件由状态机机械保证（DT pass 是 W3 建卡前提），故链完成 ⟹ DT 已通过；钩子天然幂等、重启无缺口，避免改 VOrchestrator 构造。
   - DT 评审目标从 TARGET_BRANCH 改为 feature 分支（`metadata.branch`），否则 D 未合入时 DT 无可审 diff——这是建议 1 的必然伴随调整。
   - 缺 `branch`/`TARGET_BRANCH` 标记 → 软跳过 + `[merge-skip]` 评论，不阻断链（legacy 兼容）；合入冲突 → `[merge-failed]` 评论，链仍收尾（坏代码未合入，方向安全）。

---

## Execution Handoff

计划已保存。两种执行方式：

**1. Subagent-Driven（推荐）** — 每个 Task 派独立 subagent，任务间我评审，快速迭代
**2. Inline Execution** — 本会话内按 executing-plans 批量执行，检查点暂停评审

选哪种？
