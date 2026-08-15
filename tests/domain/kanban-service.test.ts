import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEventStore } from '../../src/domain/event-store.js';
import { KanbanService } from '../../src/domain/kanban-service.js';

async function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'kanban-svc-'));
  const svc = new KanbanService(new FileEventStore(dir));
  return { svc, dir };
}

describe('KanbanService', () => {
  it('creates chain and approves spec card then executes task flow', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's_1' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'w1', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(t.id, 'system');
      const done = await svc.completeTask(t.id, { summary: 'ok', metadata: { kb_url: 'http://x' }, completedAt: Date.now() }, 'w', { boundTaskId: t.id });
      expect(done.status).toBe('done');
      const state = await svc.snapshot();
      // P0-3：唯一任务完成后，链完成机械规则自动推进 chain/completed
      expect(state.chains.get(chain.id)!.status).toBe('completed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects unauthorized create', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's_1' }, 'human');
      await expect(svc.createTask({ chainId: chain.id, title: 'x', assignee: 'd', mode: 'align' }, 'p')).rejects.toThrow(/denied/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects complete without summary', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's_1' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'w', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(t.id, 'system');
      await expect(svc.completeTask(t.id, { summary: '', metadata: {}, completedAt: 0 }, 'w', { boundTaskId: t.id })).rejects.toThrow(/summary/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not persist an illegal transition', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's_1' }, 'human');
      const task = await svc.createTask({ chainId: chain.id, title: 'w', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(task.id, 'system');
      await svc.completeTask(task.id, { summary: 'done', metadata: {}, completedAt: Date.now() }, 'w', { boundTaskId: task.id });

      await expect(svc.unblockTask(task.id, 'human')).rejects.toThrow(/illegal transition/);

      const events = new FileEventStore(dir).readAllSync();
      expect(events.at(-1)?.kind).toBe('task/completed');
      expect(() => new KanbanService(new FileEventStore(dir))).not.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('publishes persisted events in seq order and disposes subscriptions', async () => {
    const { svc, dir } = await fresh();
    try {
      const seen: number[] = [];
      const stop = svc.subscribe((event) => seen.push(event.seq));
      const chain = await svc.createChain({ title: 'ui', ownerSessionId: 's' }, 'human');
      await svc.createTask({ chainId: chain.id, title: 'prefetch', assignee: 'w', mode: 'file' }, 'v');
      expect(seen).toEqual([0, 1, 2]);
      stop();
      await svc.createSpecCard(chain.id, {
        problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: ['d'], testing: 't', out_of_scope: 'o',
      }, 'human');
      expect(seen).toEqual([0, 1, 2]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('keeps the committed transition when one listener throws', async () => {
    const { svc, dir } = await fresh();
    try {
      svc.subscribe(() => { throw new Error('listener failed'); });
      const chain = await svc.createChain({ title: 'safe', ownerSessionId: 's' }, 'human');
      expect((await svc.snapshot()).chains.has(chain.id)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reads catch-up events from an inclusive seq', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'catch-up', ownerSessionId: 's' }, 'human');
      await svc.createTask({ chainId: chain.id, title: 't', assignee: 'w', mode: 'file' }, 'v');
      expect((await svc.eventsSince(1)).map((event) => event.seq)).toEqual([1, 2]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
