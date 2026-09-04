import { describe, it, expect } from 'vitest';
import { Dispatcher, makeWakeImpl, reconcileOrchestrations } from '../../src/dispatcher/dispatcher.js';
import { EventWaker } from '../../src/dispatcher/event-waker.js';
import { Watchdog } from '../../src/dispatcher/watchdog.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

function makeDispatcher(
  svc: KanbanService,
  opts: { runner?: { runTask(id: string): Promise<void> }; wakes?: string[]; maxRetries?: number; stateFile: string; agents?: unknown },
) {
  const waker = new EventWaker({} as never, {} as never);
  if (opts.wakes) waker.setWakeImpl(async (chainId: string) => { opts.wakes!.push(chainId); });
  return new Dispatcher({
    kanban: svc,
    runner: opts.runner ?? { runTask: async () => {} },
    waker,
    watchdog: new Watchdog(svc, { staleTimeoutSeconds: 60, maxRetries: opts.maxRetries ?? 3 }),
    maxRetries: opts.maxRetries ?? 3,
    stateFile: opts.stateFile,
    logFile: join(dirname(opts.stateFile), 'dispatcher.log'),
    agents: opts.agents,
  });
}

describe('Dispatcher', () => {
  it('re-dispatches failed task below maxRetries and circuit-breaks at the cap (B1)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disp-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't', assignee: 'p', mode: 'openspec' }, 'v');
      await svc.claimTask(t.id, 'system'); // 模拟首次运行
      await svc.failTask(t.id, 'boom', 'system'); // attempts=1
      const claimed: string[] = [];
      const d = makeDispatcher(svc, {
        runner: { runTask: async (id: string) => { claimed.push(id); await svc.claimTask(id, 'system'); } },
        maxRetries: 2,
        stateFile: join(dir, 'dispatcher-state.json'),
      });
      await d.tick(); // failed attempts=1 < 2 → 重派（claim→running）
      let state = await svc.snapshot();
      expect(claimed).toEqual([t.id]);
      expect(state.tasks.get(t.id)!.status).toBe('running');
      await svc.failTask(t.id, 'boom2', 'system'); // attempts=2
      await d.tick(); // attempts>=2 → 熔断 blocked(gave_up)
      state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('blocked');
      const blockEv = state.events.find((e) => e.taskId === t.id && e.kind === 'task/blocked');
      expect(blockEv!.payload['reason']).toContain('gave_up');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('persists lastSeq and only wakes events after it on restart (B6)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disp-'));
    try {
      const stateFile = join(dir, 'dispatcher-state.json');
      const svc1 = new KanbanService(new FileEventStore(dir));
      const wakes1: string[] = [];
      const d1 = makeDispatcher(svc1, { wakes: wakes1, stateFile });
      const chain = await svc1.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      // v2：chain/created 不再唤醒 V（V 仅在规格卡批准后行动，见 event-waker wakeable 过滤）。
      // 修复轮 6：首轮无状态文件 → 从 -1 起重放既有事件（chain/created 被过滤，不产生唤醒）；
      // 不重复建卡由 VOrchestrator 的 B6 幂等（期望卡未终态则跳过）保证。
      await d1.tick();
      expect(wakes1).toEqual([]);
      const approve = async (chId: string) => {
        const c = await svc1.createSpecCard(chId, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
        await svc1.approveSpecCard(c.id, 'human');
      };
      await approve(chain.id);
      await d1.tick(); // spec-card/approved → 唤醒 V（V 从 p 起跑）
      expect(wakes1).toEqual([chain.id]);
      const chain2 = await svc1.createChain({ title: 'c2', ownerSessionId: 's' }, 'human');
      await approve(chain2.id);
      await d1.tick(); // lastSeq 推进并持久化
      expect(wakes1).toEqual([chain.id, chain2.id]);
      // 模拟重启：同目录重建服务与调度器，旧事件不再唤醒 V
      const svc2 = new KanbanService(new FileEventStore(dir));
      const wakes2: string[] = [];
      const d2 = makeDispatcher(svc2, { wakes: wakes2, stateFile });
      await d2.tick();
      expect(wakes2).toEqual([]);
      const chain3 = await svc2.createChain({ title: 'c3', ownerSessionId: 's' }, 'human');
      const card3 = await svc2.createSpecCard(chain3.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc2.approveSpecCard(card3.id, 'human');
      await d2.tick();
      expect(wakes2).toEqual([chain3.id]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('skips concurrent tick while in flight (R5)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disp-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      await svc.createTask({ chainId: chain.id, title: 't', assignee: 'p', mode: 'openspec' }, 'v');
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => { release = r; });
      let calls = 0;
      const d = makeDispatcher(svc, {
        runner: { runTask: async () => { calls++; await gate; } },
        stateFile: join(dir, 'dispatcher-state.json'),
      });
      const p1 = d.tick();
      const p2 = d.tick();
      await new Promise((r) => setTimeout(r, 20));
      expect(calls).toBe(1); // 第二个 tick 因 inFlight 直接返回，未重复派发同一任务
      release();
      await Promise.all([p1, p2]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rewinds skewed lastSeq after purge renumbering and replays wakeable events (cursor skew self-heal)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disp-purge-'));
    try {
      const stateFile = join(dir, 'dispatcher-state.json');
      const store = new FileEventStore(dir);
      const svc1 = new KanbanService(store);
      const wakes1: string[] = [];
      const d1 = makeDispatcher(svc1, { wakes: wakes1, stateFile });
      // 产生高水位游标：链1 规格批准 → 唤醒 → lastSeq 持久化为较大值
      const chain1 = await svc1.createChain({ title: 'c1', ownerSessionId: 's' }, 'human');
      const card1 = await svc1.createSpecCard(chain1.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc1.approveSpecCard(card1.id, 'human');
      // 增加非唤醒事件抬高游标水位（模拟真实事故：历史链事件多，游标远高于 purge 后新事件 seq）
      for (let i = 0; i < 3; i++) await svc1.createTask({ chainId: chain1.id, title: 't' + i, assignee: 'p', mode: 'openspec' }, 'v');
      await d1.tick(); // task/created 不唤醒 V，但 lastSeq 推进至事件尾
      expect(wakes1).toEqual([chain1.id]);
      const highWater = JSON.parse(readFileSync(stateFile, 'utf8')).lastSeq as number;
      expect(highWater).toBeGreaterThanOrEqual(6);
      // 整链硬删除：purge 物理重排 events.jsonl（seq 全部变小）
      await store.purge((ev) => ev.chainId === chain1.id);
      // purge 后新建链+批准：新事件 seq 从低位重新分配（< 旧游标）
      const svc2 = new KanbanService(store);
      const wakes2: string[] = [];
      const d2 = makeDispatcher(svc2, { wakes: wakes2, stateFile });
      const chain2 = await svc2.createChain({ title: 'c2', ownerSessionId: 's' }, 'human');
      const card2 = await svc2.createSpecCard(chain2.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc2.approveSpecCard(card2.id, 'human');
      // 修前行为：lastSeq=高水位 > 新事件 seq → spec-card/approved 被永久跳过 → 零唤醒（空壳链死锁）
      // 修后行为：游标超前即钳回 -1 全量重放 → 新链被唤醒
      await d2.tick();
      expect(wakes2).toEqual([chain2.id]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('onPurge syncs running-instance cursor after deleteChain so later chains wake (E)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disp-purge2-'));
    try {
      const stateFile = join(dir, 'dispatcher-state.json');
      const store = new FileEventStore(dir);
      const svc = new KanbanService(store);
      const wakes: string[] = [];
      const d = makeDispatcher(svc, { wakes, stateFile });
      // 链1：批准唤醒 + 抬高内存游标（不重启，模拟运行中实例）
      const chain1 = await svc.createChain({ title: 'c1', ownerSessionId: 's' }, 'human');
      const card1 = await svc.createSpecCard(chain1.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card1.id, 'human');
      for (let i = 0; i < 3; i++) await svc.createTask({ chainId: chain1.id, title: 't' + i, assignee: 'p', mode: 'openspec' }, 'v');
      await d.tick();
      expect(wakes).toEqual([chain1.id]);
      // 运行中整链硬删除（deleteChain = purge + 重投影），随后不经重启直接 onPurge 同步游标
      await svc.deleteChain(chain1.id, 'human');
      await d.onPurge();
      // 删链后新建链+批准：seq 从低位重新分配；游标已同步 → 事件正常消费并唤醒
      const chain2 = await svc.createChain({ title: 'c2', ownerSessionId: 's' }, 'human');
      const card2 = await svc.createSpecCard(chain2.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card2.id, 'human');
      await d.tick();
      expect(wakes).toEqual([chain1.id, chain2.id]);
      const persisted = JSON.parse(readFileSync(stateFile, 'utf8')).lastSeq as number;
      expect(persisted).toBeGreaterThanOrEqual(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('startup reconcile converges orphan running tasks to blocked with system comment (G), idempotent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disp-orphan-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      // 孤儿 running：上次进程派发后会话中断遗留（状态机无独立 claimed 态，claim 事件即 running）
      const orphan = await svc.createTask({ chainId: chain.id, title: 'orphan', assignee: 'p', mode: 'openspec' }, 'v');
      await svc.claimTask(orphan.id, 'system');
      // 对照组：todo（从未派发）/ done / blocked（已有归属）——均不得被 reconcile 触碰
      const todo = await svc.createTask({ chainId: chain.id, title: 'todo', assignee: 'p', mode: 'openspec' }, 'v');
      const done = await svc.createTask({ chainId: chain.id, title: 'done', assignee: 'p', mode: 'openspec' }, 'v');
      await svc.claimTask(done.id, 'system');
      await svc.completeTask(done.id, { summary: 's', metadata: { artifacts_path: '/x', pt_decision: { needed: false } }, completedAt: Date.now() }, 'p', { boundTaskId: done.id });
      const blocked = await svc.createTask({ chainId: chain.id, title: 'blocked', assignee: 'p', mode: 'openspec' }, 'v');
      await svc.claimTask(blocked.id, 'system');
      await svc.blockTask(blocked.id, 'pre-existing block', 'system');

      const d = makeDispatcher(svc, { stateFile: join(dir, 'dispatcher-state.json') });
      await d.tick(); // 启动首轮：游标自愈之后、事件消费之前执行孤儿收敛
      let state = await svc.snapshot();
      expect(state.tasks.get(orphan.id)!.status).toBe('blocked');
      expect(state.tasks.get(todo.id)!.status).toBe('todo');
      expect(state.tasks.get(done.id)!.status).toBe('done');
      expect(state.tasks.get(blocked.id)!.status).toBe('blocked');
      const commentEv = state.events.find((e) => e.taskId === orphan.id && e.kind === 'task/commented');
      expect(String(commentEv!.payload['body'])).toContain('[runner-interrupted]');
      const blockEv = state.events.filter((e) => e.taskId === orphan.id && e.kind === 'task/blocked');
      expect(blockEv).toHaveLength(1);
      expect(blockEv[0]!.payload['reason']).toContain('runner-interrupted');
      expect(blockEv[0]!.author).toBe('system');

      // 幂等：再次 tick 不得对孤儿卡产生第二条 comment/block
      await d.tick();
      state = await svc.snapshot();
      const comments2 = state.events.filter((e) => e.taskId === orphan.id && e.kind === 'task/commented');
      expect(comments2).toHaveLength(1);
      expect(state.events.filter((e) => e.taskId === orphan.id && e.kind === 'task/blocked')).toHaveLength(1);
      expect(state.tasks.get(orphan.id)!.status).toBe('blocked');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('startup reconcile skips running task whose host agent session is still live (hot-reload exemption)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disp-orphan-live-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      // 热重载世界：dsh 插件重载重跑 startDispatcherInner → orphanReconciled 闸复位，
      // 但宿主 agents 注册表仍持有 kbn-<taskId> 的 live 会话（Task 2 同款探明）→ 卡不得被收敛
      const live = await svc.createTask({ chainId: chain.id, title: 'live', assignee: 'p', mode: 'openspec' }, 'v');
      await svc.claimTask(live.id, 'system');
      const registry = new Map([[`kbn-${live.id}`, { id: `kbn-${live.id}` }]]);
      const d = makeDispatcher(svc, { stateFile: join(dir, 'dispatcher-state.json'), agents: { get: (id: string) => registry.get(id) } });
      await d.tick();
      const state = await svc.snapshot();
      expect(state.tasks.get(live.id)!.status).toBe('running'); // 本进程真在跑，不是孤儿
      expect(state.events.filter((e) => e.taskId === live.id && e.kind === 'task/commented')).toHaveLength(0);
      expect(state.events.filter((e) => e.taskId === live.id && e.kind === 'task/blocked')).toHaveLength(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('startup reconcile converges running task when agents.get returns undefined (process restart: sessions dead)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disp-orphan-dead-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const orphan = await svc.createTask({ chainId: chain.id, title: 'orphan', assignee: 'p', mode: 'openspec' }, 'v');
      await svc.claimTask(orphan.id, 'system');
      // 进程重启世界：agents 注册表随宿主进程消亡 → kbn-<taskId> 查不到 → 会话已死 → 收敛
      const d = makeDispatcher(svc, { stateFile: join(dir, 'dispatcher-state.json'), agents: { get: () => undefined } });
      await d.tick();
      const state = await svc.snapshot();
      expect(state.tasks.get(orphan.id)!.status).toBe('blocked');
      const commentEv = state.events.find((e) => e.taskId === orphan.id && e.kind === 'task/commented');
      expect(String(commentEv!.payload['body'])).toContain('[runner-interrupted]');
      const blockEv = state.events.filter((e) => e.taskId === orphan.id && e.kind === 'task/blocked');
      expect(blockEv).toHaveLength(1);
      expect(blockEv[0]!.payload['reason']).toContain('runner-interrupted');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reconcileOrchestrations removes dead chain entries in place (F)', () => {
    const orch = new Map([['ch_alive1', { phase: 'p' }], ['ch_dead', { phase: 'pt' }], ['ch_alive2', { phase: 'summary' }]]);
    const removed = reconcileOrchestrations(orch, new Set(['ch_alive1', 'ch_alive2']));
    expect(removed).toEqual(['ch_dead']);
    expect([...orch.keys()].sort()).toEqual(['ch_alive1', 'ch_alive2']);
    // 全存活 → 无移除
    expect(reconcileOrchestrations(orch, new Set(['ch_alive1', 'ch_alive2']))).toEqual([]);
  });
});

describe('makeWakeImpl (防线② wakeV 异常落盘)', () => {
  it('wakeV 抛错时写 dispatcher.log 且不向上抛（防迟到 rejection 变 unhandled）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wakeimpl-'));
    try {
      const logFile = join(dir, 'dispatcher.log');
      let settled = 0;
      const impl = makeWakeImpl(async () => { throw new Error('boom-cache-hijack'); }, logFile, () => { settled++; });
      await impl('ch_1_x');
      const log = readFileSync(logFile, 'utf8');
      expect(log).toContain('[wakeV] error chain=ch_1_x');
      expect(log).toContain('boom-cache-hijack');
      expect(settled).toBe(1); // onSettled（saveOrchs）必须仍执行
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
