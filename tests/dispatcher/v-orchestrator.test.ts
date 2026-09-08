import { describe, it, expect, vi } from 'vitest';
import { VOrchestrator, PHASE_INSTRUCTIONS, type ChainOrchestration } from '../../src/dispatcher/v-orchestrator.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

/** Task 7：stub ConfigProvider——getEffective() 返回传入基线配置（机械适配 VOrchestrator 构造签名）。 */
const stubConfigProvider = (cfg: unknown = {}) => ({ getEffective: () => cfg }) as never;

/** 共享假 ctx（既有 V 测试迁移用）：freshChain 的链已带 workspaceDir=/ws/main，
 *  resolveByPath 恒命中 → 归组走既有工作区直接 attach，不弹 ask。
 *  attachSession 在实体上（resolveByPath/create 返回物），registry 无 attachSession（Task 1 最终接口）。 */
function fakeWsCtx() {
  const entity = () => ({ id: 'ws-1', attachSession: async () => {} });
  return {
    get: (name: string) => {
      if (name === 'workspaceRegistry') return {
        resolveByPath: async (p: string) => (p === '/ws/main' ? entity() : undefined),
        create: async () => entity(),
      };
      return undefined;
    },
  };
}

/** 假 V agent：从注入上下文解析"下一步期望"，真实调用 svc.createTask 建卡（模拟 V 经 kanban_create 工具派单），
 *  并在会话事件中记录调用（供驱动校验）。resume 返回同一会话（事件日志共享，符合 V 会话延续语义）。 */
function fakeV(svc: KanbanService, chainId: string, failMode: 'none' | 'wrong-assignee' | 'no-create' | 'double-create' | 'throw' | 'from-cache') {
  const events: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const pending: Promise<void>[] = [];
  const followup = vi.fn((msg: { content: { text: string }[] }) => {
    pending.push((async () => {
      const text = msg.content.map((b) => b.text).join('\n');
      fakeV.lastContext = text;
      const m = text.match(/NEXT_TASK_ASSIGNEE=(\w+) MODE=([\w-]+)/);
      if (failMode === 'no-create' || failMode === 'from-cache' || !m) return; // from-cache：整包回放零工具调用
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
  const whenIdle = vi.fn(async () => {
    if (failMode === 'throw') throw new Error('whenIdle rejected (simulated host crash)');
    await Promise.all(pending);
    if (failMode === 'from-cache') {
      // 网关缓存整包回放：assistant/message 带 from-cache 标记、无任何工具调用（2026-09-04 实测形态）
      events.push({ type: 'assistant/message', data: { message: { source: { replayState: { response: { responseModel: 'from-cache' } } } } } } as never);
    }
  });
  const agent = { followup, whenIdle, session: { events } };
  return {
    create: vi.fn(async (opts: { setup?: (c: never) => void }) => {
      // agentCtx 需提供 on（V setup 注册 agent/request waterfall 强制思考等级）
      opts.setup?.({ on: () => () => {} } as never);
      return { agent };
    }),
    resume: vi.fn(async () => ({ agent })), // 同一 V 会话延续
  };
}
fakeV.lastCreated = { assignee: '', mode: '', taskId: '' };
fakeV.lastContext = '';

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
    create: vi.fn(async (opts: { setup?: (c: never) => void }) => { opts.setup?.({ on: () => () => {} } as never); return { agent }; }),
    resume: vi.fn(async () => ({ agent })),
  };
}

async function freshChain(workspaceDir = '/ws/main') {
  // 重置模块级 fakeV 状态（v2：未批准轮次 V 不建卡，不会覆盖 lastCreated，需每测试干净起步）
  fakeV.lastCreated = { assignee: '', mode: '', taskId: '' };
  fakeV.lastContext = '';
  const dir = mkdtempSync(join(tmpdir(), 'vorch-'));
  const svc = new KanbanService(new FileEventStore(dir));
  const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir }, 'human');
  const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
  return { svc, dir, chain, card };
}

/** 交付契约元数据：completeBy 按 assignee+mode 产出对应阶段关键交付物，
 *  供 completeTask 交付契约闸校验（w/kb=kb_url+page_path、p=artifacts_path+pt_decision）。 */
function deliveryMeta(assignee: string, mode: string): Record<string, unknown> {
  if (assignee === 'w') {
    if (mode === 'file') return { ref: '/ws/' + mode };
    if (mode === 'kb') return { kb_url: 'http://x/' + mode, page_path: '/kb/' + mode };
    return {};
  }
  if (assignee === 'p') return { artifacts_path: '/ws/plan.md', pt_decision: { needed: false } };
  return { changed_files: ['a.ts'], commit_hash: 'abc123', tdd: { test_files: ['x.test.ts'], test_first: true } };
}

/** 完成看板中指定 assignee+mode 且未终态的任务（模拟角色 agent 执行完成）。
 *  D(execute) 额外带 git 产物证据（changed_files + commit_hash）——D 链完成门禁要求（C1/C2）。 */
async function completeBy(svc: KanbanService, assignee: string, mode: string) {
  const t = [...(await svc.snapshot()).tasks.values()].find((x) => x.assignee === assignee && x.mode === mode && x.status !== 'done')!;
  await svc.claimTask(t.id, 'system');
  await svc.completeTask(t.id, { summary: 'done', metadata: deliveryMeta(assignee, mode), completedAt: 0 }, assignee as never, { boundTaskId: t.id });
  return t;
}

/** 完成 P(openspec) 卡并注入指定 pt_decision（Task 7 v2：PT 判定输入，needed=false → 跳过 PT）。 */
async function completePWithPtDecision(svc: KanbanService, needed: boolean, reason?: string) {
  const t = [...(await svc.snapshot()).tasks.values()].find((x) => x.assignee === 'p' && x.mode === 'openspec' && x.status !== 'done')!;
  await svc.claimTask(t.id, 'system');
  const meta: Record<string, unknown> = { artifacts_path: '/ws/plan.md', pt_decision: { needed } };
  if (needed) meta['pt_decision'] = { needed, reason: reason ?? '涉及多模块接口改动' };
  await svc.completeTask(t.id, { summary: 'plan', metadata: meta, completedAt: 0 }, 'p', { boundTaskId: t.id });
  return t;
}

describe('VOrchestrator (R20 v2 phase sequence)', () => {
  it('gates phase p on spec approval: draft wait → approved → p → (pt skip) → w2 → d → dt → w3', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      // B4：规格卡 draft（未批准）→ V 待命，不建卡（v2：V 仅 approved 后从 p 起跑）
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated).toEqual({ assignee: '', mode: '', taskId: '' });
      // 规格卡 approved（链 executing）→ V 唤醒 → 直接建 p/openspec（无旧预取阶段）
      await svc.approveSpecCard(card.id, 'human');
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated.assignee).toBe('p');
      expect(fakeV.lastCreated.mode).toBe('openspec');
      expect(orchMap.get(chain.id)!.phase).toBe('pt');
      // 后续阶段：V 每轮建卡后即推进 phase（生产上由 task/completed 事件串行唤醒，测试直接唤醒验证建卡序列）
      await completePWithPtDecision(svc, false); // P pt_decision.needed=false → pt 跳过 → w2
      await orch.wakeV(chain.id);
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
          test: { exit: 0, runner: 'vitest' }, build: { exit: 0 }, lint: { exit: 0 }, diff: { files: ['a.ts'] },
          git: { branch: 'x' }, openCodeReview: { conclusion: 'pass' },
          tdd: { test_files: ['x.test.ts'], test_first: true },
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

  it('v2: 规格卡批准后 V 直接建 p（无旧预取阶段）', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated).toEqual({ assignee: '', mode: '', taskId: '' }); // 未批准：不建卡
      await svc.approveSpecCard(card.id, 'human');
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated.assignee).toBe('p');
      expect(fakeV.lastCreated.mode).toBe('openspec');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('v2: P pt_decision.needed=false → 跳过 PT 直接 w2；needed=true → 建 PT 卡（reason 入 body）', async () => {
    const run = async (needed: boolean) => {
      const { svc, dir, chain, card } = await freshChain();
      try {
        await svc.approveSpecCard(card.id, 'human');
        const agents = fakeV(svc, chain.id, 'none');
        const orchMap = new Map();
        const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
        await orch.wakeV(chain.id); // → p
        await completePWithPtDecision(svc, needed); // P 完成带 pt_decision
        await orch.wakeV(chain.id); // → pt（needed=true）或 w2（needed=false）
        const state = await svc.snapshot();
        const ptCards = [...state.tasks.values()].filter((t) => t.assignee === 'pt' && t.mode === 'review-plan');
        const w2Cards = [...state.tasks.values()].filter((t) => t.assignee === 'w' && t.mode === 'kb');
        return { ptCount: ptCards.length, w2Count: w2Cards.length, lastCreated: fakeV.lastCreated, lastContext: fakeV.lastContext };
      } finally { rmSync(dir, { recursive: true, force: true }); }
    };
    // needed=false → 跳过 PT → 直接建 w2（w/kb）
    const skip = await run(false);
    expect(skip.ptCount).toBe(0);
    expect(skip.w2Count).toBe(1);
    expect(skip.lastCreated.assignee).toBe('w');
    expect(skip.lastCreated.mode).toBe('kb');
    // needed=true → 建 PT 卡（reason 注入 V context 供 PT 卡 body 引用）
    const need = await run(true);
    expect(need.ptCount).toBe(1);
    expect(need.w2Count).toBe(0);
    expect(need.lastContext).toContain('涉及多模块接口改动'); // helper 默认 reason
  });

  it('w2 建卡轮 context 注入 KB 页路径规则（projects/<repoSlug>/ch_<id>/t_<taskId>.md）', async () => {
    const { svc, dir, chain, card } = await freshChain('/ws/repo');
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id); // → p
      await completePWithPtDecision(svc, false); // pt_decision.needed=false → 跳过 PT
      await orch.wakeV(chain.id); // → w2 建卡轮
      expect(fakeV.lastCreated.assignee).toBe('w');
      expect(fakeV.lastCreated.mode).toBe('kb');
      // 断言三要素：① 规则段标题 ② projects/<repoSlug>/ch_<chainId> 前缀 ③ t_<新建卡id>.md 路径模板
      expect(fakeV.lastContext).toContain('KB 页路径规则');
      expect(fakeV.lastContext).toContain('projects/repo/ch_');
      expect(fakeV.lastContext).toContain(`projects/repo/ch_${chain.id}/t_<新建卡id>.md`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('detects wrong-assignee creation and does not advance phase', async () => {
    vi.useFakeTimers(); // stall=1 会调度 re-wake 定时器，测试结束前不真实触发
    const { svc, dir, chain, card } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'wrong-assignee');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await svc.approveSpecCard(card.id, 'human');
      await orch.wakeV(chain.id);
      // V 建了错误 assignee（w/openspec 而非 p/openspec）→ 驱动校验失败，phase 不推进
      expect(orchMap.get(chain.id)!.phase).toBe('p');
      expect(fakeV.lastCreated.assignee).toBe('w');
    } finally { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('B6 idempotency: wakeV does not duplicate the expected in-flight card (restart recovery)', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated.assignee).toBe('p');
      // 模拟重启恢复：phase 回到 p（建卡后未持久化），期望卡已存在且在途
      orchMap.set(chain.id, { chainId: chain.id, phase: 'p', sessionId: null, waitingOn: null });
      await orch.wakeV(chain.id);
      const state = await svc.snapshot();
      const pCards = [...state.tasks.values()].filter((t) => t.assignee === 'p' && t.mode === 'openspec');
      expect(pCards).toHaveLength(1); // 未重复建卡
      expect(agents.create).toHaveBeenCalledTimes(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('R4: only the first expected card advances phase; extra cards do not', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'double-create');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await svc.approveSpecCard(card.id, 'human');
      await orch.wakeV(chain.id);
      // 连发 [p/openspec(匹配), p/openspec(多余)]：仅第一张匹配卡推进 phase 一次 → pt
      expect(orchMap.get(chain.id)!.phase).toBe('pt');
      const state = await svc.snapshot();
      const pCards = [...state.tasks.values()].filter((t) => t.assignee === 'p' && t.mode === 'openspec');
      expect(pCards).toHaveLength(2); // 多余卡不推进 phase，但确实创建了
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('Fix D: stall auto re-wakes ≤3 times with backoff, then [create-failed] give-up (idempotent)', async () => {
    vi.useFakeTimers();
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      // 链上先有一张卡作锚点（模拟已有阶段产物，否则无锚点可评论）
      const seed = await svc.createTask({ chainId: chain.id, title: 'seed', assignee: 'w', mode: 'kb' }, 'v');
      const agents = fakeV(svc, chain.id, 'no-create');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      // 第 1 轮建卡失败：stallCount=1 → 调度 5s 后 re-wake（不立即评论、不推进 phase）
      await orch.wakeV(chain.id);
      expect(orchMap.get(chain.id)!.phase).toBe('p');
      expect((orchMap.get(chain.id)!.stallCount ?? 0)).toBe(1);
      expect(agents.create).toHaveBeenCalledTimes(1);
      // 自动重试 #1（stall=2 → 调度 10s）
      await vi.advanceTimersByTimeAsync(5_000);
      expect((orchMap.get(chain.id)!.stallCount ?? 0)).toBe(2);
      // 自动重试 #2（stall=3 → 调度 15s）
      await vi.advanceTimersByTimeAsync(10_000);
      expect((orchMap.get(chain.id)!.stallCount ?? 0)).toBe(3);
      // 自动重试 #3（stall=4 > 3 → 放弃）：锚点卡发 [create-failed]（幂等一次），不再调度
      await vi.advanceTimersByTimeAsync(15_000);
      expect((orchMap.get(chain.id)!.stallCount ?? 0)).toBe(4);
      const state = await svc.snapshot();
      const failed = state.events.filter((e) => e.kind === 'task/commented' && String(e.payload['body'] ?? '').startsWith('[create-failed]'));
      expect(failed).toHaveLength(1);
      expect(failed[0]!.taskId).toBe(seed.id);
      expect(String(failed[0]!.payload['body'])).toContain('自动重试 3 次');
      // 放弃后不再有 re-wake（followup 总轮数 = 首轮 + 3 次重试 = 4）
      const followups = agents.create.mock.calls.length + 0; // create 仅首轮
      void followups;
      await vi.advanceTimersByTimeAsync(60_000);
      expect((orchMap.get(chain.id)!.stallCount ?? 0)).toBe(4); // 无新增轮次
    } finally { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('Fix D: zero-task stall gives up after ≤3 re-wakes without comment (no anchor), logs console.error', async () => {
    vi.useFakeTimers();
    const { svc, dir, chain, card } = await freshChain();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'no-create');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);                    // stall=1 → re-wake
      await vi.advanceTimersByTimeAsync(5_000);      // stall=2
      await vi.advanceTimersByTimeAsync(10_000);     // stall=3
      await vi.advanceTimersByTimeAsync(15_000);     // stall=4 → 放弃（无锚点）
      const state = await svc.snapshot();
      expect(state.events.some((e) => e.kind === 'task/commented' && String(e.payload['body'] ?? '').startsWith('[create-failed]'))).toBe(false);
      expect(state.tasks.size).toBe(0); // 零任务：链上没有任何卡可承载评论
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('create-failed'))).toBe(true);
      // 超限升级（防线④/防线A）：console.error 文案改为注明「已置链级 blocked」，且链状态实测 blocked
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('chain=' + chain.id))).toBe(true);
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('已置链级 blocked'))).toBe(true);
      expect((await svc.snapshot()).chains.get(chain.id)!.status).toBe('blocked');
    } finally { errSpy.mockRestore(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('Fix D: successful card creation resets stallCount and cancels pending re-wake', async () => {
    vi.useFakeTimers();
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      // 可切换 failMode 的假 V：首轮 no-create（stall=1 调度 re-wake），随后恢复正常建卡
      const events: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
      let mode: 'no-create' | 'none' = 'no-create';
      const pending: Promise<void>[] = [];
      const followup = vi.fn((msg: { content: { text: string }[] }) => {
        pending.push((async () => {
          const text = msg.content.map((b) => b.text).join('\n');
          const m = text.match(/NEXT_TASK_ASSIGNEE=(\w+) MODE=([\w-]+)/);
          if (mode === 'no-create' || !m) return;
          await svc.createTask({ chainId: chain.id, title: `phase-${m[2]}`, assignee: m[1] as never, mode: m[2] as never }, 'v');
          events.push({ name: 'kanban_create', arguments: { assignee: m[1], mode: m[2] } });
        })());
      });
      const whenIdle = vi.fn(async () => { await Promise.all(pending); });
      const agent = { followup, whenIdle, session: { events } };
      const agents = {
        create: vi.fn(async (opts: { setup?: (c: never) => void }) => { opts.setup?.({ on: () => () => {} } as never); return { agent }; }),
        resume: vi.fn(async () => ({ agent })),
      };
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);               // stall=1 → 调度 5s re-wake
      expect((orchMap.get(chain.id)!.stallCount ?? 0)).toBe(1);
      mode = 'none';                            // 在 re-wake 触发前恢复（模拟采样波动自愈）
      await vi.advanceTimersByTimeAsync(5_000); // re-wake → 建卡成功
      expect((orchMap.get(chain.id)!.stallCount ?? 0)).toBe(0);
      expect(orchMap.get(chain.id)!.phase).toBe('pt'); // P 卡建成并推进
      const before = followup.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000); // 无残留定时器：不再多唤醒
      expect(followup.mock.calls.length).toBe(before);
    } finally { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('wakeV on blocked task posts [blocked-review] guidance comment once (idempotent)', async () => {
    const { svc, dir, chain } = await freshChain();
    try {
      // 建 P 阶段前置任务并协议违规阻塞（手工造卡，验证阻塞复核与 phase 解耦）
      const w1 = await svc.createTask({ chainId: chain.id, title: 'blocked task', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1.id, 'system');
      await svc.blockTask(w1.id, 'protocol_violation: idle without complete/block', 'system');
      const agents = fakeReviewV(svc);
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
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

  it('after D completes V creates fixed DT card (review-impl)', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);            // → p
      await completePWithPtDecision(svc, false); // pt_decision.needed=false → 跳过 PT
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
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);            // → p
      await completePWithPtDecision(svc, true); // pt_decision.needed=true → 需要 PT
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
      expect(pRework!.resumeSessionId).toBeNull(); // 2026-09-07：返工走自己 kbn-<id> 会话，不继承源
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
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider({ dispatcher: { maxReworksPerRole: { dt: 1 } } }), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);            // → p
      await completePWithPtDecision(svc, false); // pt_decision.needed=false → 跳过 PT
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
          test: { exit: 1, runner: 'vitest' }, build: { exit: 1 }, lint: { exit: 1 }, diff: { files: ['a.ts'] }, git: { branch: 'x' }, openCodeReview: { conclusion: 'fail' },
          tdd: { test_files: ['x.test.ts'], test_first: false },
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
          test: { exit: 1, runner: 'vitest' }, build: { exit: 1 }, lint: { exit: 1 }, diff: { files: ['a.ts'] }, git: { branch: 'x' }, openCodeReview: { conclusion: 'fail' },
          tdd: { test_files: ['x.test.ts'], test_first: false },
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

  it('pre-check: legacy parent W2 done-but-missing page_path → V does not create D card, posts [delivery-required]', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      // 构造上游到 d 阶段：p done、w2 done（缺 page_path → done-but-missing legacy）
      const p = await svc.createTask({ chainId: chain.id, title: 'p', assignee: 'p', mode: 'openspec' }, 'v');
      await svc.claimTask(p.id, 'system');
      await svc.completeTask(p.id, { summary: 'plan', metadata: { artifacts_path: '/ws/plan.md', pt_decision: { needed: false } }, completedAt: 0 }, 'p', { boundTaskId: p.id });
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
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
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

  it('V getVAgent setup registers agent/request waterfall forcing reasoningEffort=high (same defect as role agents)', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      // 仿宿主 installModelSelection：fake agentCtx.on('agent/request', ...) 捕获 waterfall 监听器
      const listeners: Array<(payload: unknown, next: () => Promise<Record<string, unknown>>) => Promise<Record<string, unknown>>> = [];
      const agent = { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [] } };
      const agents = {
        create: vi.fn(async (opts: { setup?: (c: unknown) => Promise<void> }) => {
          await opts.setup?.({ on: (_e: string, l: unknown) => { listeners.push(l as never); return () => {}; } } as never);
          return { agent };
        }),
        resume: vi.fn(async () => ({ agent })),
      };
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await svc.approveSpecCard(card.id, 'human');
      await orch.wakeV(chain.id); // p 阶段触发 getVAgent → create 带 setup
      // setup 被调用 → waterfall 已注册（fake agents 未调用 setup 时此断言失败）
      expect(listeners).toHaveLength(1);
      const resolved = await listeners[0]({}, async () => ({ provider: 'x', model: 'y' }));
      expect(resolved.reasoningEffort).toBe('high');
      expect(resolved.provider).toBe('x'); // 其余字段保留
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('attaches V session to chain workspace after create', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vorch-'));
    const svc = new KanbanService(new FileEventStore(dir));
    const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: '/ws/main' }, 'human');
    const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: '', out_of_scope: '' }, 'human');
    await svc.approveSpecCard(card.id, 'human');
    const attaches: string[] = [];
    const v = fakeV(svc, chain.id, 'none');
    // attachSession 在实体上（resolveByPath/create 返回物），registry 无 attachSession（Task 1 最终接口）
    const entity = () => ({ id: 'ws-1', attachSession: async (sid: unknown) => { attaches.push(String(sid)); } });
    const ctx = {
      get: (name: string) => {
        if (name === 'workspaceRegistry') return {
          resolveByPath: async (p: string) => (p === '/ws/main' ? entity() : undefined),
          create: async () => entity(),
        };
        return undefined;
      },
    };
    const orch: ChainOrchestration = { chainId: chain.id, phase: 'p', sessionId: '', waitingOn: null };
    const orchs = new Map([[chain.id, orch]]);
    const orchestrator = new VOrchestrator(ctx as never, svc, v as never, stubConfigProvider(), orchs, {} as unknown as WikiVaultClient, undefined);
    await orchestrator.wakeV(chain.id);
    expect(attaches).toContain('kbn-v-' + chain.id);
    rmSync(dir, { recursive: true, force: true });
  });

  it('archived 且未处理的旧评审卡视为作废：P done 后 V 重新建全新 PT 卡，不触发返工', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id); // → 建 P 卡
      const p = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'p' && t.mode === 'openspec')!;
      // 旧 PT 卡：P done + needed=true，但该 PT 卡被 human 归档且无 review 事件（作废）——直接构造
      await svc.claimTask(p.id, 'system');
      await svc.completeTask(p.id, { summary: 'plan', metadata: { artifacts_path: '/ws/plan.md', pt_decision: { needed: true, reason: 'r' } }, completedAt: 0 }, 'p', { boundTaskId: p.id });
      const stale = await svc.createTask({ chainId: chain.id, title: '旧PT', assignee: 'pt', mode: 'review-plan' }, 'v');
      await svc.archiveTask(stale.id, 'human');
      // V 唤醒 → 不应处理 archived 旧卡 verdict（无证据）→ 应重建全新 PT 卡
      fakeV.lastCreated = { assignee: '', mode: '', taskId: '' };
      await orch.wakeV(chain.id);
      const ptCards = [...(await svc.snapshot()).tasks.values()].filter((t) => t.assignee === 'pt' && t.mode === 'review-plan');
      const live = ptCards.filter((t) => t.status !== 'archived');
      expect(live.length).toBe(1); // 全新 PT 卡
      expect(live[0]!.id).not.toBe(stale.id);
      // 未触发 review/failed（作废不返工）
      const state = await svc.snapshot();
      expect(state.events.some((e) => e.kind === 'review/failed')).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('非 void 归档评审卡（带 verdict 事件）经幂等分支恢复：V 不卡在 pt，推进建 w2/kb 卡', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);            // → 建 P 卡（phase → pt）
      await completePWithPtDecision(svc, true); // P done，needed=true → 需要 PT
      await orch.wakeV(chain.id);            // → 建 PT 卡（phase 保持 pt）
      const pt1 = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'pt' && t.mode === 'review-plan')!;
      expect(pt1).toBeDefined();
      // 模拟「重启恢复」场景：PT 卡已完成（handoff 带 review_evidence）、recordReview 已记 verdict、随后被 human 归档。
      // 该归档卡非 void（有 review/passed 事件）→ 应经 handleReviewCompletion 幂等分支恢复推进，
      // 而非被 archived 守卫一律判 gave-up 卡死在 pt。
      await svc.claimTask(pt1.id, 'system');
      await svc.completeTask(pt1.id, {
        summary: 'rev', metadata: { artifacts_path: '/ws/plan.md', review_evidence: { verdict: 'pass', issues: [] } }, completedAt: Date.now(),
      }, 'pt', { boundTaskId: pt1.id });
      const pTask = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'p' && t.mode === 'openspec')!;
      await svc.recordReview(pt1.id, pTask.id, { verdict: 'pass', issues: [] }, 'system'); // 幂等分支依据的 review/passed 事件
      await svc.archiveTask(pt1.id, 'human');
      // V 唤醒 → 不应卡死（旧守卫对 archived 一律 gave-up）→ 应经幂等恢复推进出 pt → 建 w2/kb 卡
      fakeV.lastCreated = { assignee: '', mode: '', taskId: '' };
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated.mode).toBe('kb'); // 推进出 pt → 建 w2/kb 卡
      expect(fakeV.lastCreated.assignee).toBe('w');
      expect(orchMap.get(chain.id)!.phase).toBe('d'); // 已越过 w2（建卡后普通阶段推进 phase）
      // 未重建全新 PT 卡（走恢复路径而非作废重建路径）
      const state = await svc.snapshot();
      const livePt = [...state.tasks.values()].filter((t) => t.assignee === 'pt' && t.mode === 'review-plan' && t.status !== 'archived');
      expect(livePt).toHaveLength(0);
      expect(state.tasks.get(pTask.id)!.reviewStatus).toBe('passed'); // recordReview 已落 reviewStatus（落在被评审的 P 上）
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('P0: 原 P(done) + 返工 P(blocked) 并存时 [blocked-p] 闸取最新 P 卡，V 不建 PT（含 reason）', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const orchMap = new Map<string, ChainOrchestration>();
      const agents = fakeV(svc, chain.id, 'none');
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);              // → 建 P1（phase → pt）
      await completePWithPtDecision(svc, true); // P1 done（pt_decision.needed=true → 需 PT）
      // 返工 P2(blocked) 与原 P1(done) 并存——闸必须取「最新」P 卡而非首卡
      const p2 = await svc.createTask({ chainId: chain.id, title: '[返工] p', assignee: 'p', mode: 'openspec' }, 'v');
      await svc.claimTask(p2.id, 'system');
      await svc.blockTask(p2.id, 'kb-insufficient: 仓库事实与磁盘基线不一致', 'p', { boundTaskId: p2.id });
      // 复核轮已消费（[blocked-review] 已发）→ 本次 wakeV 直入 [blocked-p] 闸判定
      await svc.comment(p2.id, '[blocked-review] 请补充仓库事实后 unblock', 'system');
      fakeV.lastCreated = { assignee: '', mode: '', taskId: '' };
      await orch.wakeV(chain.id);              // 闸：最新 P=p2 blocked → 不建 PT + [blocked-p]
      expect(fakeV.lastCreated.mode).not.toBe('review-plan'); // 未建 PT
      const state = await svc.snapshot();
      const comments = state.events.filter((e) => e.taskId === p2.id && e.kind === 'task/commented' && String(e.payload['body'] ?? '').startsWith('[blocked-p]'));
      expect(comments.length).toBe(1);
      expect(String(comments[0]!.payload['body'])).toContain('kb-insufficient');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('P1: kb-insufficient 类 blocked 也触发 V [blocked-review] 复核评论', async () => {
    const { svc, dir, chain } = await freshChain();
    try {
      // 造一个协议无关的 blocked 任务（kb-insufficient）
      const w1 = await svc.createTask({ chainId: chain.id, title: 'w', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1.id, 'system');
      await svc.blockTask(w1.id, 'kb-insufficient: 缺关键文件', 'w', { boundTaskId: w1.id });
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, fakeReviewV(svc) as never, stubConfigProvider(), new Map(), {} as WikiVaultClient);
      await orch.wakeV(chain.id);
      const state = await svc.snapshot();
      const reviews = state.events.filter((e) => e.taskId === w1.id && e.kind === 'task/commented' && String(e.payload['body'] ?? '').startsWith('[blocked-review]'));
      expect(reviews.length).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('P1: 建卡轮 V 上下文「当前任务」带 blocked 卡的 reason（两段唤醒：先复核轮后建卡轮）', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      // 造一个协议无关的 blocked 任务（kb-insufficient），P 尚无卡（初始链）
      const w1 = await svc.createTask({ chainId: chain.id, title: 'w', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1.id, 'system');
      await svc.blockTask(w1.id, 'kb-insufficient: 缺关键文件', 'w', { boundTaskId: w1.id });
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, fakeV(svc, chain.id, 'no-create') as never, stubConfigProvider(), new Map(), {} as WikiVaultClient);
      // wake①：w1 无 [blocked-review] → 复核轮（lastContext = 复核轮 context，不在本用例断言范围）
      await orch.wakeV(chain.id);
      // 消费复核轮：规格卡批准（链 → executing，B4 放行）+ 补 [blocked-review] 评论（hasBlockReview=true → 复核轮空）
      await svc.approveSpecCard(card.id, 'human');
      await svc.comment(w1.id, '[blocked-review] 请补充交付后 unblock', 'system');
      // wake②：复核轮空 + B4 approved → 建卡轮（phase p）→ lastContext = 建卡轮「当前任务」清单
      await orch.wakeV(chain.id);
      // 建卡轮「当前任务」行应含 w1 的 blocked reason（前置复核轮 context 已排除在本断言外，防假绿）
      expect(fakeV.lastContext).toContain('kb-insufficient: 缺关键文件');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

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
      // 锚定注入节头（「## 评审遗留建议（PT 评审 pass 留档…」）而非裸短语——PHASE_INSTRUCTIONS.d
      // 指令文本本身含「评审遗留建议」字样（Task 4），裸短语断言恒假。
      expect(fakeV.lastContext).not.toContain('## 评审遗留建议');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('V stall 兜底强化（防线④，2026-09-04 mtmgp81q）', () => {
  it('whenIdle 异常收场 → 计 stall 并 scheduleRewake（不再逃出 wakeVInner）', async () => {
    const { svc, dir, chain, card } = await freshChain();
    vi.useFakeTimers(); // 适配：吞掉 stall 轮调度的 5s rewake 定时器（真实时钟下会在测试结束后误触发）
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'throw');
      const orchMap = new Map();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id); // 不抛 = 异常被并入 stall
      const o = orchMap.get(chain.id)!;
      expect(o.stallCount).toBe(1);
      expect(agents.create).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(0); // rewake 定时器由退避控制，此处仅验不崩
    } finally { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('from-cache 零产出 → 计 stall（缓存回放按零产出处理）', async () => {
    const { svc, dir, chain, card } = await freshChain();
    vi.useFakeTimers(); // 适配：同上，吞掉 stall 轮调度的 rewake 定时器
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'from-cache');
      const orchMap = new Map();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      expect(orchMap.get(chain.id)!.stallCount).toBe(1);
    } finally { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('stall 超限 → 链置 blocked（零任务链也有数据侧终态）', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'no-create');
      const orchMap = new Map();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      // STALL_REWAKE_LIMIT=3：第 1-3 轮计 stall 触发 rewake（Timer 用假时钟推进），第 4 轮超限 → blockChain
      vi.useFakeTimers();
      try {
        for (let i = 0; i < 3; i++) {
          await orch.wakeV(chain.id);
          await vi.advanceTimersByTimeAsync(20_000); // 5s*(i+1) 退避全部到期
        }
        await orch.wakeV(chain.id); // stallCount=4 > 3 → blocked
      } finally { vi.useRealTimers(); }
      expect((await svc.snapshot()).chains.get(chain.id)!.status).toBe('blocked');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('stall>0 的重唤醒上下文带 rewake-nonce（变请求指纹防缓存再命中）', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeV(svc, chain.id, 'no-create');
      const orchMap = new Map();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      vi.useFakeTimers();
      try {
        await orch.wakeV(chain.id);
        await vi.advanceTimersByTimeAsync(6_000); // 触发第 1 次 rewake
        await (orch.wakeV as unknown as { flush?: () => Promise<void> }).flush?.(); // 无此 API → no-op（brief 适配：fake timers 下不能换 setTimeout(0)）
      } finally { vi.useRealTimers(); }
      expect(fakeV.lastContext).toContain('rewake-nonce:');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('Task 4: V 会话 persona 注入加固（mount fail-fast + live 复用身份校验）', () => {
  it('① mount 抛错 → agents.create 路径抛错并入异常收场计 stall（错误消息含 preset id + sessionId，未把半裸会话交给 V 轮）', async () => {
    const { svc, dir, chain, card } = await freshChain();
    vi.useFakeTimers(); // 吞 stall 轮调度的 rewake 定时器
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agent = { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [] as Array<Record<string, unknown>> } };
      const agents = {
        create: vi.fn(async (opts: { setup?: (c: unknown) => Promise<void> }) => {
          // 宿主 agentPresets 服务存在但 mount 爆炸（模拟 preset 注册表损坏）
          await opts.setup?.({
            on: () => () => {},
            get: (n: string) => (n === 'agentPresets'
              ? { mount: async () => { throw new Error('host preset registry exploded'); } }
              : undefined),
          } as never);
          return { agent };
        }),
        resume: vi.fn(async () => ({ agent })),
      };
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id); // 不抛 = mount 失败被异常收场收住（进 stall 计数）
      expect(orchMap.get(chain.id)!.stallCount).toBe(1);
      expect(agents.create).toHaveBeenCalledTimes(1);
      expect(agent.followup).not.toHaveBeenCalled(); // 未把无 persona 基座的会话交给 V 轮
      // 抛错消息含 preset id 与 sessionId（kbn-v-<chainId>）+ 原因
      const logged = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toContain('kanban-v preset mount failed for kbn-v-' + chain.id);
      expect(logged).toContain('host preset registry exploded');
      await vi.advanceTimersByTimeAsync(0);
    } finally { vi.useRealTimers(); errSpy.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('② live 复用：带 kanban-v 身份标记的 live 会话直接复用（不重新 create/resume）', async () => {
    const { svc, dir, chain, card } = await freshChain();
    vi.useFakeTimers();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agent = { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [] as Array<Record<string, unknown>> } };
      const agents = {
        get: vi.fn((id: string) => (id === 'kbn-v-' + chain.id ? agent : undefined)),
        create: vi.fn(async (opts: { setup?: (c: unknown) => Promise<void> }) => {
          await opts.setup?.({ on: () => () => {}, agent } as never); // setup 完整成功 → 写身份标记
          return { agent };
        }),
        resume: vi.fn(async () => { throw new Error('resume must not be called when live marker matches'); }),
      };
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id); // 首轮 create + setup 标记
      expect(agents.create).toHaveBeenCalledTimes(1);
      await orch.wakeV(chain.id); // 第二轮 live 命中 + 标记匹配 → 复用（本 fake 不建卡，stall 路径无碍断言）
      expect(agents.create).toHaveBeenCalledTimes(1);   // 未重复 create
      expect(agents.resume).not.toHaveBeenCalled();      // 未走 resume
      expect(agent.followup).toHaveBeenCalledTimes(2);   // live 会话被续用
      await vi.advanceTimersByTimeAsync(0);
    } finally { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('③ live 复用：无标记（不可验证身份）→ 拒绝盲复用走 resume，不把错误身份会话交给调用方', async () => {
    const { svc, dir, chain, card } = await freshChain();
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await svc.approveSpecCard(card.id, 'human');
      const unmarkedAgent = { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [] as Array<Record<string, unknown>> } };
      const healedAgent = { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [] as Array<Record<string, unknown>> } };
      const agents = {
        get: vi.fn((id: string) => (id === 'kbn-v-' + chain.id ? unmarkedAgent : undefined)),
        create: vi.fn(async () => { throw new Error('create must not be called when sessionId exists'); }),
        resume: vi.fn(async (opts: { setup?: (c: unknown) => Promise<void> }) => {
          await opts.setup?.({ on: () => () => {}, agent: healedAgent } as never); // resume 重跑 setup → 身份自愈
          return { agent: healedAgent };
        }),
      };
      const orchMap = new Map<string, ChainOrchestration>();
      orchMap.set(chain.id, { chainId: chain.id, phase: 'p', sessionId: 'kbn-v-' + chain.id, waitingOn: null });
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      expect(unmarkedAgent.followup).not.toHaveBeenCalled(); // 错误身份会话未交给调用方
      expect(healedAgent.followup).toHaveBeenCalledTimes(1); // resume 会话接管本轮
      expect(agents.resume).toHaveBeenCalledTimes(1);
      // 拒绝复用留痕（含 sessionId 与原因），保持可排查性
      const logged = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toContain('refusing blind reuse');
      expect(logged).toContain('kbn-v-' + chain.id);
      await vi.advanceTimersByTimeAsync(0);
    } finally { vi.useRealTimers(); errSpy.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('④ resume 创建的会话经 setup 写标记 → 后续 live 命中可验通过（不再 resume）', async () => {
    const { svc, dir, chain, card } = await freshChain();
    vi.useFakeTimers();
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agent = { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [] as Array<Record<string, unknown>> } };
      let resumed = false;
      const agents = {
        get: vi.fn((id: string) => (resumed && id === 'kbn-v-' + chain.id ? agent : undefined)), // 首轮 live 不存在
        create: vi.fn(async () => { throw new Error('create must not be called when sessionId exists'); }),
        resume: vi.fn(async (opts: { setup?: (c: unknown) => Promise<void> }) => {
          resumed = true;
          await opts.setup?.({ on: () => () => {}, agent } as never);
          return { agent };
        }),
      };
      const orchMap = new Map<string, ChainOrchestration>();
      orchMap.set(chain.id, { chainId: chain.id, phase: 'p', sessionId: 'kbn-v-' + chain.id, waitingOn: null });
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id); // live 不存在 → resume（setup 标记）
      expect(agents.resume).toHaveBeenCalledTimes(1);
      await orch.wakeV(chain.id); // live 命中 + 标记匹配 → 复用，不再 resume
      expect(agents.resume).toHaveBeenCalledTimes(1);
      expect(agent.followup).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(0);
    } finally { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('Task 5: 宿主形态防御（session.events 可为 undefined，ch_4_mtn3g0kc 实证）', () => {
  /** 带定制 agent 形态的假 agents 容器：agent 字段由用例注入（正常/undefined 各形态）。 */
  function fakeAgentsWith(agent: unknown) {
    return {
      create: vi.fn(async (opts: { setup?: (c: never) => void }) => {
        opts.setup?.({ on: () => () => {} } as never);
        return { agent };
      }),
      resume: vi.fn(async () => ({ agent })),
    };
  }

  it('① agent.session.events=undefined（新宿主形态）→ wakeV 不抛 TypeError，按零产出计 stall，诊断日志留痕', async () => {
    const { svc, dir, chain, card } = await freshChain();
    vi.useFakeTimers(); // 吞 stall 轮调度的 5s rewake 定时器
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeAgentsWith({ followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: undefined } });
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id); // 不抛 = 防御生效（旧代码此处 TypeError）
      const o = orchMap.get(chain.id)!;
      expect(o.stallCount).toBe(1); // 零产出 → stall 计数
      expect(o.phase).toBe('p');    // phase 不推进
      expect(agents.create).toHaveBeenCalledTimes(1);
      // 诊断留痕：含 chainId / phase / sessionId 与形态异常标注
      const logged = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toContain('宿主会话事件缺失（形态异常），按零产出处理');
      expect(logged).toContain('chain=' + chain.id);
      expect(logged).toContain('phase=p');
      expect(logged).toContain('sessionId=kbn-v-' + chain.id);
      await vi.advanceTimersByTimeAsync(0);
    } finally { vi.useRealTimers(); errSpy.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('② agent.session=undefined（极端形态）→ 同样不抛、按零产出计 stall', async () => {
    const { svc, dir, chain, card } = await freshChain();
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await svc.approveSpecCard(card.id, 'human');
      const agents = fakeAgentsWith({ followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: undefined });
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id); // 不抛
      expect(orchMap.get(chain.id)!.stallCount).toBe(1);
      const logged = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toContain('宿主会话事件缺失');
      await vi.advanceTimersByTimeAsync(0);
    } finally { vi.useRealTimers(); errSpy.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('③ events 正常数组 → 行为与既有一致：零产出照常计 stall，且不打「宿主会话事件缺失」诊断（只在缺失时打）', async () => {
    const { svc, dir, chain, card } = await freshChain();
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await svc.approveSpecCard(card.id, 'human');
      // 正常空数组 + 不建卡（等价 no-create）→ 零产出计 stall，但属正常路径非形态异常
      const agents = fakeAgentsWith({ followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [] as Array<Record<string, unknown>> } });
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, stubConfigProvider(), orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      expect(orchMap.get(chain.id)!.stallCount).toBe(1);
      const logged = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toContain('宿主会话事件缺失'); // 诊断不打正常路径
      await vi.advanceTimersByTimeAsync(0);
    } finally { vi.useRealTimers(); errSpy.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('PHASE_INSTRUCTIONS (M5 阶段指令)', () => {
  it('P 指令含 pt_decision 硬键与 kb-insufficient 显式阻断通道', () => {
    expect(PHASE_INSTRUCTIONS['p']).toContain('pt_decision');
    expect(PHASE_INSTRUCTIONS['p']).toContain('kb-insufficient');
    expect(PHASE_INSTRUCTIONS['p']).toContain('kanban_block');
  });
  it('P1: PHASE_INSTRUCTIONS.p 明令写入仓库 openspec/changes/ 且允许只读自查', () => {
    const p = PHASE_INSTRUCTIONS['p']!;
    expect(p).toContain('openspec/changes/');
    expect(p).toContain('只读自查');
    expect(p).toContain('proposal.md');
  });
  it('P1: PHASE_INSTRUCTIONS.p 含 pt_decision 复杂度判定清单（spec.md≥3 等触发项）', () => {
    const p = PHASE_INSTRUCTIONS['p']!;
    expect(p).toContain('spec.md');
    expect(p).toContain('needed=true');
    expect(p).toContain('needed=false');
  });
  it('PT 指令为只读评审（理由见上）', () => {
    expect(PHASE_INSTRUCTIONS['pt']).toContain('只读');
    expect(PHASE_INSTRUCTIONS['pt']).toContain('review_evidence');
  });
  it('D 指令停止 merge-back，要求 branch metadata', () => {
    const d = PHASE_INSTRUCTIONS['d']!;
    expect(d).toContain('branch=<feature 分支名>');
    expect(d).toContain('禁止合并回 TARGET_BRANCH');
    expect(d).not.toContain('合并回 TARGET_BRANCH 再 push');
  });
  it('P1: PHASE_INSTRUCTIONS.d 含 TDD/vitest 硬要求', () => {
    const d = PHASE_INSTRUCTIONS['d']!;
    expect(d).toContain('TDD');
    expect(d).toContain('vitest');
    expect(d).toContain('tdd');
  });
  it('DT 指令评审目标为 feature 分支（非 TARGET_BRANCH）', () => {
    const dt = PHASE_INSTRUCTIONS['dt']!;
    expect(dt).toContain('metadata.branch');
    expect(dt).toContain('而非 TARGET_BRANCH');
    expect(dt).toContain('ocr_review');
  });
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
  it('w2/w3 指令 pagePath 逐字取「KB 页路径规则」下发路径', () => {
    expect(PHASE_INSTRUCTIONS['w2']).toContain('「KB 页路径规则」');
    expect(PHASE_INSTRUCTIONS['w2']).toContain('pagePath');
    expect(PHASE_INSTRUCTIONS['w3']).toContain('「KB 页路径规则」');
    expect(PHASE_INSTRUCTIONS['w3']).toContain('pagePath');
  });
});
