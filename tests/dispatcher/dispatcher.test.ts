import { describe, it, expect } from 'vitest';
import { Dispatcher } from '../../src/dispatcher/dispatcher.js';
import { EventWaker } from '../../src/dispatcher/event-waker.js';
import { Watchdog } from '../../src/dispatcher/watchdog.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
});
