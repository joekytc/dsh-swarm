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
});
