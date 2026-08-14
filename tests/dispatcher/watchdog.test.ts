import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Watchdog } from '../../src/dispatcher/watchdog.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function runningTask(lastBeat: number) {
  const dir = mkdtempSync(join(tmpdir(), 'wd-'));
  const svc = new KanbanService(new FileEventStore(dir));
  const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
  const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: '', out_of_scope: '' }, 'human');
  await svc.approveSpecCard(card.id, 'human');
  const t = await svc.createTask({ chainId: chain.id, title: 'w', assignee: 'w', mode: 'kb' }, 'v');
  await svc.claimTask(t.id, 'system');
  // 伪造心跳时间：直接写事件
  const evStore = (svc as unknown as { store: FileEventStore }).store;
  await evStore.append({ chainId: chain.id, taskId: t.id, kind: 'task/heartbeat', payload: {}, author: 'w', at: lastBeat } as never);
  return { svc, dir, t };
}

describe('Watchdog', () => {
  it('reclaims stale running task', async () => {
    const now = 10_000_000;
    const { svc, dir, t } = await runningTask(now - 200_000); // 200s 前最后心跳
    try {
      const wd = new Watchdog(svc, { staleTimeoutSeconds: 60, maxRetries: 3 });
      await wd.tick(now);
      const state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('failed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('circuit-breaks after max retries (P0-5 semantics)', async () => {
    const now = 10_000_000;
    const { svc, dir, t } = await runningTask(now - 200_000);
    try {
      const wd = new Watchdog(svc, { staleTimeoutSeconds: 60, maxRetries: 2 });
      // 第 1 次：stale → failed（attempts=1，未达上限，不熔断）
      await wd.tick(now);
      let state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('failed');
      expect(state.tasks.get(t.id)!.attempts).toBe(1);
      // 调度器重派：failed → claim → running
      await svc.claimTask(t.id, 'system');
      state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('running');
      // 第 2 次：stale → failed（attempts=2）→ 达上限熔断 blocked(gave_up)
      await wd.tick(now + 100_000);
      state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('failed');
      await wd.tick(now + 200_000);
      state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('blocked');
      const blockEv = state.events.find((e) => e.taskId === t.id && e.kind === 'task/blocked');
      expect(blockEv!.payload['reason']).toContain('gave_up');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
