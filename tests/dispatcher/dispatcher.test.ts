import { describe, it, expect } from 'vitest';
import { Dispatcher } from '../../src/dispatcher/dispatcher.js';
import { EventWaker } from '../../src/dispatcher/event-waker.js';
import { Watchdog } from '../../src/dispatcher/watchdog.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

function makeDispatcher(
  svc: KanbanService,
  opts: { runner?: { runTask(id: string): Promise<void> }; wakes?: string[]; maxRetries?: number; stateFile: string },
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

  it('regression: W1-pre invalid manifest → kanban_complete rejects in-session (hard gate, not block/failed) → fixed manifest completes → P can be created (t_6_mt84zn3e)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disp-r-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const w1 = await svc.createTask({ chainId: chain.id, title: 'w1-pre', assignee: 'w', mode: 'file' }, 'v');
      // W 提交非法 manifest（expected:'sha256' 反例）→ kanban_complete 拒绝（抛错，硬约束），任务保持 running
      await svc.claimTask(w1.id, 'system');
      await expect(svc.completeTask(w1.id, { summary: 'facts', metadata: { ref: '/ws', manifest: { repo: { localPath: '/ws', dirtyFiles: [] }, files: [{ path: 'README.md', expected: 'sha256' }] } }, completedAt: Date.now() }, 'w', { boundTaskId: w1.id })).rejects.toThrow('invalid prefetch manifest');
      let state = await svc.snapshot();
      expect(state.tasks.get(w1.id)!.status).toBe('running'); // 绝不 block/failed
      expect(state.events.some((e) => e.taskId === w1.id && e.kind === 'task/blocked')).toBe(false);
      expect(state.tasks.get(w1.id)!.attempts).toBe(0);
      // W 会话内修正为合法 manifest → done（无需调度器重派）
      await svc.completeTask(w1.id, { summary: 'facts', metadata: { ref: '/ws', manifest: { repo: { localPath: '/ws', dirtyFiles: [] }, files: [{ path: 'README.md', expected: 'exists' }] } }, completedAt: Date.now() }, 'w', { boundTaskId: w1.id });
      state = await svc.snapshot();
      expect(state.tasks.get(w1.id)!.status).toBe('done');
      // 拦下游 P：W1-pre 已 done → V 可正常 resolve 并建 P 卡（不再卡 w1-pre 阶段）
      const p = await svc.createTask({ chainId: chain.id, title: 'p', assignee: 'p', mode: 'openspec', parents: [w1.id] }, 'v');
      expect(p.status).toBe('todo');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
