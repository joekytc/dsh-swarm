import { describe, it, expect, vi } from 'vitest';
import { VOrchestrator, PHASE_INSTRUCTIONS, type ChainOrchestration } from '../../src/dispatcher/v-orchestrator.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

/** 假 V agent：从注入上下文解析"下一步期望"，真实调用 svc.createTask 建卡（模拟 V 经 kanban_create 工具派单），
 *  并在会话事件中记录调用（供驱动校验）。resume 返回同一会话（事件日志共享，符合 V 会话延续语义）。 */
function fakeV(svc: KanbanService, chainId: string, failMode: 'none' | 'wrong-assignee' | 'no-create' | 'double-create') {
  const events: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const pending: Promise<void>[] = [];
  const followup = vi.fn((msg: { content: { text: string }[] }) => {
    pending.push((async () => {
      const text = msg.content.map((b) => b.text).join('\n');
      const m = text.match(/NEXT_TASK_ASSIGNEE=(\w+) MODE=([\w-]+)/);
      if (failMode === 'no-create' || !m) return;
      const expectAssignee = m[1];
      const mode = m[2];
      const assignee = failMode === 'wrong-assignee' ? (expectAssignee === 'w' ? 'd' : 'w') : expectAssignee;
      const task = await svc.createTask(
        { chainId, title: `phase-${mode}`, assignee: assignee as never, mode: mode as never },
        'v',
      );
      events.push({ name: 'kanban_create', arguments: { assignee, mode } });
      fakeV.lastCreated = { assignee, mode, taskId: task.id };
      if (failMode === 'double-create') {
        // R4：V 连发第二张卡（p/openspec）——驱动只按第一张匹配卡推进 phase
        const extra = await svc.createTask({ chainId, title: 'phase-extra', assignee: 'p', mode: 'openspec' }, 'v');
        events.push({ name: 'kanban_create', arguments: { assignee: 'p', mode: 'openspec' } });
        fakeV.lastCreated = { assignee: 'p', mode: 'openspec', taskId: extra.id };
      }
    })());
  });
  const whenIdle = vi.fn(async () => { await Promise.all(pending); });
  const agent = { followup, whenIdle, session: { events } };
  return {
    create: vi.fn(async (opts: { setup?: (c: never) => void }) => {
      opts.setup?.({} as never);
      return { agent };
    }),
    resume: vi.fn(async () => ({ agent })), // 同一 V 会话延续
  };
}
fakeV.lastCreated = { assignee: '', mode: '', taskId: '' };

/** 假 V agent（阻塞复核版）：从注入上下文提取"阻塞任务 id 列表"，对每个任务真实调用 svc.comment
 *  以 [blocked-review] 开头评论（模拟 V 经 kanban_comment 工具给方向）。 */
function fakeReviewV(svc: KanbanService) {
  const events: Array<{ name: string }> = [];
  const pending: Promise<void>[] = [];
  const followup = vi.fn((msg: { content: { text: string }[] }) => {
    pending.push((async () => {
      const text = msg.content.map((b) => b.text).join('\n');
      const taskIds = [...text.matchAll(/^(\S+)\s+\S+\/\S+\s+blocked/gm)].map((m) => m[1]);
      for (const id of taskIds) {
        events.push({ name: 'kanban_comment' });
        await svc.comment(id, '[blocked-review] 请按阶段要求补充交付后调用 kanban_complete（阻塞原因见上文）', 'v');
      }
    })());
  });
  const whenIdle = vi.fn(async () => { await Promise.all(pending); });
  const agent = { followup, whenIdle, session: { events } };
  return {
    create: vi.fn(async (opts: { setup?: (c: never) => void }) => { opts.setup?.({} as never); return { agent }; }),
    resume: vi.fn(async () => ({ agent })),
  };
}

async function freshChain() {
  const dir = mkdtempSync(join(tmpdir(), 'vorch-'));
  const svc = new KanbanService(new FileEventStore(dir));
  const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
  const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
  return { svc, dir, chain, card };
}

/** 交付契约元数据：completeBy 按 assignee+mode 产出对应阶段关键交付物，
 *  供 completeTask 交付契约闸校验（w/file=ref、w/kb=kb_url+page_path、p=artifacts_path）。 */
function deliveryMeta(assignee: string, mode: string): Record<string, unknown> {
  if (assignee === 'w') {
    if (mode === 'file') return { ref: '/ws/' + mode };
    if (mode === 'kb') return { kb_url: 'http://x/' + mode, page_path: '/kb/' + mode };
    return {};
  }
  if (assignee === 'p') return { artifacts_path: '/ws/plan.md' };
  return { changed_files: ['a.ts'], commit_hash: 'abc123' };
}

/** 完成看板中指定 assignee+mode 且未终态的任务（模拟角色 agent 执行完成）。
 *  D(execute) 额外带 git 产物证据（changed_files + commit_hash）——D 链完成门禁要求（C1/C2）。 */
async function completeBy(svc: KanbanService, assignee: string, mode: string) {
  const t = [...(await svc.snapshot()).tasks.values()].find((x) => x.assignee === assignee && x.mode === mode && x.status !== 'done')!;
  await svc.claimTask(t.id, 'system');
  await svc.completeTask(t.id, { summary: 'done', metadata: deliveryMeta(assignee, mode), completedAt: 0 }, assignee as never, { boundTaskId: t.id });
  return t;
}

/** 完成 P(openspec) 卡并注入指定 review_complexity metadata（Task 6：PT 判定输入）。 */
async function completePWithComplexity(svc: KanbanService, complexity: Record<string, unknown> | undefined) {
  const t = [...(await svc.snapshot()).tasks.values()].find((x) => x.assignee === 'p' && x.mode === 'openspec' && x.status !== 'done')!;
  await svc.claimTask(t.id, 'system');
  const meta: Record<string, unknown> = { artifacts_path: '/ws/plan.md' };
  if (complexity !== undefined) meta['review_complexity'] = complexity;
  await svc.completeTask(t.id, { summary: 'plan', metadata: meta, completedAt: 0 }, 'p', { boundTaskId: t.id });
  return t;
}

describe('VOrchestrator (R20 phase sequence)', () => {
  it('gates phase p on spec approval: w1-pre → draft wait → approved → p → (pt skip) → w2 → d → dt → w3', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      // w1-pre（阶段 0，planning 态允许建卡）
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated).toEqual({ assignee: 'w', mode: 'file', taskId: expect.any(String) });
      await completeBy(svc, 'w', 'file');
      // P1-2：w1-pre 完成后，wakeV 幂等挂载 file-prefetch 附件到规格卡（draft 态）
      await orch.wakeV(chain.id);
      const st1 = await svc.snapshot();
      const sc = st1.specCards.get(card.id)!;
      expect(sc.attachments.some((a) => a.kind === 'file-prefetch')).toBe(true);
      // B4：规格卡仍 draft → V 待命，不建 p 卡、phase 不推进（等 spec-card/approved 事件唤醒）
      expect(fakeV.lastCreated).toEqual({ assignee: 'w', mode: 'file', taskId: expect.any(String) });
      expect(orchMap.get(chain.id)!.phase).toBe('w1-supp');
      const stDraft = await svc.snapshot();
      expect([...stDraft.tasks.values()].filter((t) => t.assignee === 'p')).toHaveLength(0);
      // 规格卡 approved（链 executing）→ V 唤醒：跳过 w1-supp → 建 p/openspec
      await svc.approveSpecCard(card.id, 'human');
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated.assignee).toBe('p');
      expect(fakeV.lastCreated.mode).toBe('openspec');
      expect(orchMap.get(chain.id)!.phase).toBe('pt');
      // 后续阶段：V 每轮建卡后即推进 phase（生产上由 task/completed 事件串行唤醒，测试直接唤醒验证建卡序列）
      await completeBy(svc, 'p', 'openspec'); // p 先行完成（串行语义：下游阶段在其后）
      await orch.wakeV(chain.id);       // P 无 review_complexity（legacy）→ pt 跳过 → w2（w/kb）
      expect(fakeV.lastCreated.assignee).toBe('w');
      expect(fakeV.lastCreated.mode).toBe('kb');
      await completeBy(svc, 'w', 'kb'); // w2 完成
      await orch.wakeV(chain.id);       // → d/execute（执行者）
      expect(fakeV.lastCreated.assignee).toBe('d');
      expect(fakeV.lastCreated.mode).toBe('execute');
      await completeBy(svc, 'd', 'execute');
      await orch.wakeV(chain.id);       // → dt/review-impl（固定评审卡）
      expect(fakeV.lastCreated.assignee).toBe('dt');
      expect(fakeV.lastCreated.mode).toBe('review-impl');
      // DT 完成必须带机械校验合法的 review_evidence（评审证据闸）
      const dtTask = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'dt' && t.mode === 'review-impl')!;
      await svc.claimTask(dtTask.id, 'system');
      await svc.completeTask(dtTask.id, {
        summary: 'reviewed', metadata: { review_evidence: {
          verdict: 'pass', issues: [],
          test: { exit: 0 }, build: { exit: 0 }, lint: { exit: 0 }, diff: { files: ['a.ts'] },
          git: { branch: 'x' }, openCodeReview: { conclusion: 'pass' },
        } }, completedAt: 0,
      }, 'dt', { boundTaskId: dtTask.id });
      await orch.wakeV(chain.id);       // → w3（w/kb）
      expect(fakeV.lastCreated.assignee).toBe('w');
      expect(fakeV.lastCreated.mode).toBe('kb');
      await completeBy(svc, 'w', 'kb'); // w3 最后完成 → 链 executing 且无未终态任务 → completed
      const state = await svc.snapshot();
      expect(state.chains.get(chain.id)!.status).toBe('completed');
      await orch.wakeV(chain.id); // summary 阶段应无副作用
      expect(fakeV.lastCreated.mode).toBe('kb'); // 未再建卡（保持最后一次）
      // B3：create 与 resume 均传 setup 装配角色工具面
      expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({ setup: expect.any(Function) }));
      expect(agents.resume).toHaveBeenCalledWith(expect.objectContaining({ setup: expect.any(Function) }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('detects wrong-assignee creation and does not advance phase', async () => {
    const { svc, dir, chain } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'wrong-assignee');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      // V 建了错误 assignee（d/file 而非 w/file）→ 驱动校验失败，phase 不推进
      expect(orchMap.get(chain.id)!.phase).toBe('w1-pre');
      expect(fakeV.lastCreated.assignee).toBe('d');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('B6 idempotency: wakeV does not duplicate the expected in-flight card (restart recovery)', async () => {
    const { svc, dir, chain } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated.assignee).toBe('w');
      // 模拟重启恢复：phase 回到 w1-pre（建卡后未持久化），期望卡已存在且在途
      orchMap.set(chain.id, { chainId: chain.id, phase: 'w1-pre', sessionId: null, waitingOn: null });
      await orch.wakeV(chain.id);
      const state = await svc.snapshot();
      const w1pre = [...state.tasks.values()].filter((t) => t.assignee === 'w' && t.mode === 'file');
      expect(w1pre).toHaveLength(1); // 未重复建卡
      expect(agents.create).toHaveBeenCalledTimes(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('R4: only the first expected card advances phase; extra cards do not', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'double-create');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      // 连发 [w/file(匹配), p/openspec(多余)]：仅第一张匹配卡推进 phase 一次 → w1-supp
      expect(orchMap.get(chain.id)!.phase).toBe('w1-supp');
      // 完成 w/file 并挂附件（draft 态）
      await completeBy(svc, 'w', 'file');
      await orch.wakeV(chain.id);
      expect(orchMap.get(chain.id)!.phase).toBe('w1-supp');
      // 批准后：跳过 w1-supp → p；B6 见多余 p 卡在途 → 不重复建卡，待命
      await svc.approveSpecCard(card.id, 'human');
      await orch.wakeV(chain.id);
      const state = await svc.snapshot();
      const pCards = [...state.tasks.values()].filter((t) => t.assignee === 'p' && t.mode === 'openspec');
      expect(pCards).toHaveLength(1);
      expect(orchMap.get(chain.id)!.phase).toBe('p');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('wakeV on blocked task posts [blocked-review] guidance comment once (idempotent)', async () => {
    const { svc, dir, chain } = await freshChain();
    try {
      // 建 w1-pre 任务并协议违规阻塞
      const w1 = await svc.createTask({ chainId: chain.id, title: 'w1-pre', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1.id, 'system');
      await svc.blockTask(w1.id, 'protocol_violation: idle without complete/block', 'system');
      const agents = fakeReviewV(svc);
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      let state = await svc.snapshot();
      const reviews = state.events.filter((e) =>
        e.taskId === w1.id && e.kind === 'task/commented' && String(e.payload['body'] ?? '').startsWith('[blocked-review]'));
      expect(reviews).toHaveLength(1);
      expect(reviews[0]!.payload['body']).toContain('blocked');
      // 再次 wakeV → 幂等：仍 1 条 [blocked-review] 评论（不重复复核）
      await orch.wakeV(chain.id);
      state = await svc.snapshot();
      const reviews2 = state.events.filter((e) =>
        e.taskId === w1.id && e.kind === 'task/commented' && String(e.payload['body'] ?? '').startsWith('[blocked-review]'));
      expect(reviews2).toHaveLength(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('P deliverable hard_flags triggers PT card by V; soft_count<2 skips; missing defaults needsReview', async () => {
    // 场景辅助：跑通 w1-pre→p 并完成 P（带指定 review_complexity），再 wakeV 观察建卡
    const run = async (complexity: Record<string, unknown> | undefined, override?: string) => {
      const { svc, dir, chain, card } = await freshChain();
      try {
        await svc.approveSpecCard(card.id, 'human');
        const agents = fakeV(svc, chain.id, 'none');
        const orchMap = new Map<string, ChainOrchestration>();
        const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
        await orch.wakeV(chain.id);            // w1-pre
        await completeBy(svc, 'w', 'file');
        await orch.wakeV(chain.id);            // → p
        await completePWithComplexity(svc, complexity); // P 完成，带复杂度声明
        await orch.wakeV(chain.id);            // → pt?（判定）或跳过 → w2
        const state = await svc.snapshot();
        const ptCards = [...state.tasks.values()].filter((t) => t.assignee === 'pt' && t.mode === 'review-plan');
        const w2Cards = [...state.tasks.values()].filter((t) => t.assignee === 'w' && t.mode === 'kb');
        return { ptCount: ptCards.length, w2Count: w2Cards.length };
      } finally { rmSync(dir, { recursive: true, force: true }); }
    };
    // hard_flags=['db_migration'] → 需要 PT → V 建 pt/review-plan 卡
    expect((await run({ hard_flags: ['db_migration'], soft_flags: [], soft_count: 0 })).ptCount).toBe(1);
    // soft_flags=['spec_large'](count=1) → soft_count<2 → 跳过 PT 直接 w2
    const softSkip = await run({ hard_flags: [], soft_flags: ['spec_large'], soft_count: 1 });
    expect(softSkip.ptCount).toBe(0);
    expect(softSkip.w2Count).toBe(1);
    // 缺失 review_complexity（legacy）→ 默认跳过 PT（兼容既有链路）→ w2
    const missing = await run(undefined);
    expect(missing.ptCount).toBe(0);
    expect(missing.w2Count).toBe(1);
    // 非法（缺必需字段）→ 默认需要 PT
    expect((await run({})).ptCount).toBe(1);
    // review_override='required'（用户事件）优先 → 即使 soft_count<2 也要 PT
    expect((await run({ hard_flags: [], soft_flags: [], soft_count: 0, review_override: 'required' })).ptCount).toBe(1);
    // review_override='skip' 优先 → 即使 hard_flags 非空也跳过 PT
    const overrideSkip = await run({ hard_flags: ['db_migration'], soft_flags: [], soft_count: 0, review_override: 'skip' });
    expect(overrideSkip.ptCount).toBe(0);
    expect(overrideSkip.w2Count).toBe(1);
  });

  it('after D completes V creates fixed DT card (review-impl)', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);            // w1-pre
      await completeBy(svc, 'w', 'file');
      await orch.wakeV(chain.id);            // → p
      await completePWithComplexity(svc, undefined); // legacy：跳过 PT
      await orch.wakeV(chain.id);            // → w2（PT 跳过）
      await completeBy(svc, 'w', 'kb');
      await orch.wakeV(chain.id);            // → d
      await completeBy(svc, 'd', 'execute');
      await orch.wakeV(chain.id);            // → dt（固定）
      const state = await svc.snapshot();
      const dtCards = [...state.tasks.values()].filter((t) => t.assignee === 'dt' && t.mode === 'review-impl');
      expect(dtCards).toHaveLength(1);
      expect(orchMap.get(chain.id)!.phase).toBe('dt'); // dt 阶段保持，等 DT 评审通过才推进 w3
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('PT verdict=fail preserves done P and creates P-rework + new PT review task; pass advances', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);            // w1-pre
      await completeBy(svc, 'w', 'file');
      await orch.wakeV(chain.id);            // → p
      await completePWithComplexity(svc, { hard_flags: ['db_migration'], soft_flags: [], soft_count: 0 }); // 需要 PT
      await orch.wakeV(chain.id);            // → pt 卡建卡（phase 仍 pt）
      const pt1 = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'pt' && t.mode === 'review-plan')!;
      expect(pt1).toBeDefined();
      // PT 评审失败（verdict=fail）→ 不调用 blockTask(P)；recordReview(failed)；createReworkTask；新建 PT 复审卡
      await svc.claimTask(pt1.id, 'system');
      await svc.completeTask(pt1.id, {
        summary: 'rev', metadata: { artifacts_path: '/ws/plan.md', review_evidence: { verdict: 'fail', issues: [{ severity: 'high', title: 'missing details', detail: 'x', resolved: false }] } }, completedAt: Date.now(),
      }, 'pt', { boundTaskId: pt1.id });
      const pTask = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'p' && t.mode === 'openspec')!;
      const pBefore = (await svc.snapshot()).tasks.get(pTask.id)!;
      expect(pBefore.status).toBe('done'); // 原 P 保持 done
      await orch.wakeV(chain.id);
      const state2 = await svc.snapshot();
      // 返工卡（p/openspec [返工]）+ 新 PT 复审卡已建；原 P reviewStatus=failed
      const pRework = [...state2.tasks.values()].find((t) => t.reworkOfTaskId === pTask.id);
      expect(pRework).toBeDefined();
      expect(pRework!.reviewAttempt).toBe(1);
      expect(pRework!.resumeSessionId).toBe(pTask.sessionId);
      expect((await svc.snapshot()).tasks.get(pTask.id)!.reviewStatus).toBe('failed');
      const pt2 = [...state2.tasks.values()].filter((t) => t.assignee === 'pt' && t.mode === 'review-plan');
      expect(pt2.length).toBe(2); // 原 PT + 复审 PT
      // P 返工 done → 复审 PT pass → 推进 W2
      await completeBy(svc, 'p', 'openspec');
      await orch.wakeV(chain.id);            // → 复审 PT（已存在）不重复建卡，待命；完成复审 PT 后推进
      // 完成新 PT（pass）→ 推进 w2
      const pt2Done = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'pt' && t.mode === 'review-plan' && t.status !== 'done')!;
      await svc.claimTask(pt2Done.id, 'system');
      await svc.completeTask(pt2Done.id, {
        summary: 'rev', metadata: { artifacts_path: '/ws/plan.md', review_evidence: { verdict: 'pass', issues: [] } }, completedAt: Date.now(),
      }, 'pt', { boundTaskId: pt2Done.id });
      await orch.wakeV(chain.id);
      const state4 = await svc.snapshot();
      expect([...state4.tasks.values()].some((t) => t.assignee === 'w' && t.mode === 'kb')).toBe(true); // w2 已建
      expect((await svc.snapshot()).tasks.get(pTask.id)!.reviewStatus).toBe('passed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('review-failed guardrail: after maxReworksPerRole.dt rework tasks, next fail → review/gave-up + [review-final]', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(svc, agents as never, { dispatcher: { maxReworksPerRole: { dt: 1 } } } as never, orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);            // w1-pre
      await completeBy(svc, 'w', 'file');
      await orch.wakeV(chain.id);            // → p
      await completePWithComplexity(svc, undefined); // 跳过 PT
      await orch.wakeV(chain.id);            // → w2
      await completeBy(svc, 'w', 'kb');
      await orch.wakeV(chain.id);            // → d
      await completeBy(svc, 'd', 'execute');
      await orch.wakeV(chain.id);            // → dt
      // DT fail #1：返工（D-rework + 新 DT），maxReworksPerRole.dt=1
      const dt1 = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'dt' && t.mode === 'review-impl')!;
      await svc.claimTask(dt1.id, 'system');
      await svc.completeTask(dt1.id, {
        summary: 'rev', metadata: { review_evidence: {
          verdict: 'fail', issues: [{ severity: 'high', title: 'tests fail', detail: 'x', resolved: false }],
          test: { exit: 1 }, build: { exit: 1 }, lint: { exit: 1 }, diff: { files: ['a.ts'] }, git: { branch: 'x' }, openCodeReview: { conclusion: 'fail' },
        } }, completedAt: Date.now(),
      }, 'dt', { boundTaskId: dt1.id });
      await orch.wakeV(chain.id);
      let state = await svc.snapshot();
      const dTask = [...state.tasks.values()].find((t) => t.assignee === 'd' && t.mode === 'execute')!;
      const dRework = [...state.tasks.values()].find((t) => t.reworkOfTaskId === dTask.id);
      expect(dRework).toBeDefined();
      expect(state.tasks.get(dTask.id)!.reviewStatus).toBe('failed');
      // DT fail #2：已达 maxReworksPerRole.dt=1 → review/gave-up + [review-final] 证据链；链保持（不推进）
      const dt2 = [...(await svc.snapshot()).tasks.values()].filter((t) => t.assignee === 'dt' && t.mode === 'review-impl' && t.status !== 'done');
      const nextDt = dt2.find((t) => t.reviewAttempt === 1);
      await svc.claimTask(nextDt!.id, 'system');
      await svc.completeTask(nextDt!.id, {
        summary: 'rev', metadata: { review_evidence: {
          verdict: 'fail', issues: [{ severity: 'critical', title: 'still failing', detail: 'y', resolved: false }],
          test: { exit: 1 }, build: { exit: 1 }, lint: { exit: 1 }, diff: { files: ['a.ts'] }, git: { branch: 'x' }, openCodeReview: { conclusion: 'fail' },
        } }, completedAt: Date.now(),
      }, 'dt', { boundTaskId: nextDt!.id });
      await orch.wakeV(chain.id);
      state = await svc.snapshot();
      const gaveUpEv = state.events.find((e) => e.kind === 'review/gave-up');
      expect(gaveUpEv).toBeDefined();
      // gave-up 落在根源任务（原始 D，沿 reworkOfTaskId 链到顶）
      const rootD = [...state.tasks.values()].find((t) => t.assignee === 'd' && t.mode === 'execute' && !t.reworkOfTaskId)!;
      expect(state.tasks.get(rootD.id)!.reviewStatus).toBe('gave-up');
      const comments = state.events.filter((e) => e.kind === 'task/commented').map((e) => String(e.payload['body']));
      const finalComment = comments.find((c) => c.startsWith('[review-final]'));
      expect(finalComment).toBeDefined();
      expect(finalComment!).toContain('gave-up');
      // 不再推进 w3（评审失败护栏，链保持）
      expect([...state.tasks.values()].some((t) => t.assignee === 'w' && t.mode === 'kb' && t.status !== 'done')).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('pre-check: legacy parent W2 done-but-missing page_path → V does not create D card, posts [delivery-required]', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      // 构造上游到 d 阶段：w1-pre done、p done、w2 done（缺 page_path → done-but-missing legacy）
      const w1 = await svc.createTask({ chainId: chain.id, title: 'w1', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1.id, 'system');
      await svc.completeTask(w1.id, { summary: 'facts', metadata: { ref: '/ws' }, completedAt: 0 }, 'w', { boundTaskId: w1.id });
      const p = await svc.createTask({ chainId: chain.id, title: 'p', assignee: 'p', mode: 'openspec', parents: [w1.id] }, 'v');
      await svc.claimTask(p.id, 'system');
      await svc.completeTask(p.id, { summary: 'plan', metadata: { artifacts_path: '/ws/plan.md' }, completedAt: 0 }, 'p', { boundTaskId: p.id });
      const w2 = await svc.createTask({ chainId: chain.id, title: 'w2', assignee: 'w', mode: 'kb', parents: [p.id] }, 'v');
      await svc.claimTask(w2.id, 'system');
      // 模拟「交付契约闸改造前」已落盘的 legacy done-but-missing W2：直接向事件日志追加 raw task/completed
      // （缺 page_path）绕过 completeTask 闸，再重投影——构造 V 前置校验需拦截的历史/故障兜底数据。
      await new FileEventStore(dir).append({
        chainId: chain.id, taskId: w2.id, kind: 'task/completed', author: 'human', at: 0,
        payload: { summary: 'sync', metadata: { kb_url: 'http://x' }, completedAt: 0 },
      });
      await svc.snapshot(); // 重投影，使 in-memory state 看到 legacy done W2

      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      orchMap.set(chain.id, { chainId: chain.id, phase: 'd', sessionId: null, waitingOn: null });
      await orch.wakeV(chain.id);

      const state = await svc.snapshot();
      // 前置校验停住：不建 D 卡（避免拖到 D 执行读 page_path 时才报错）
      expect([...state.tasks.values()].filter((t) => t.assignee === 'd' && t.mode === 'execute')).toHaveLength(0);
      const comment = state.events.find((e) => e.taskId === w2.id && e.kind === 'task/commented');
      expect(String(comment!.payload['body'])).toContain('[delivery-required]');
      expect(String(comment!.payload['body'])).toContain('page_path');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('PHASE_INSTRUCTIONS (M5 阶段指令)', () => {
  it('w1-pre 指令说明可选 manifest 产出', () => {
    expect(PHASE_INSTRUCTIONS['w1-pre']).toContain('manifest');
  });
  it('P 指令含 kb-insufficient 显式阻断通道', () => {
    expect(PHASE_INSTRUCTIONS['p']).toContain('kb-insufficient');
    expect(PHASE_INSTRUCTIONS['p']).toContain('kanban_block');
  });
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
});
