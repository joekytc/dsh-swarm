import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../../src/dispatcher/agent-runner.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

type FakeAgent = { followup: ReturnType<typeof vi.fn>; whenIdle: ReturnType<typeof vi.fn>; session: { events: unknown[] } };

/** 假角色 agent：completes=true 时真实调用 svc.completeTask（模拟经 kanban_complete 工具），
 *  并在会话事件中记录工具调用（供协议违规检测）。 */
function fakeCreate(opts: { completes: boolean; svc: KanbanService; taskId: string }): (o: unknown) => Promise<{ agent: FakeAgent }> {
  return async () => {
    const events: unknown[] = [];
    const pending: Promise<void>[] = [];
    const followup = vi.fn(() => {
      pending.push((async () => {
        if (opts.completes) {
          events.push({ type: 'tool-call', name: 'kanban_complete' });
          await opts.svc.completeTask(opts.taskId, { summary: 'ok', metadata: {}, completedAt: Date.now() }, 'w', { boundTaskId: opts.taskId });
        } else {
          events.push({ type: 'assistant', text: 'ok done' });
        }
      })());
    });
    const whenIdle = vi.fn(async () => { await Promise.all(pending); });
    return { agent: { followup, whenIdle, session: { events } } };
  };
}

async function setupTask(completes: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'runner-'));
  const svc = new KanbanService(new FileEventStore(dir));
  const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
  const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: '', out_of_scope: '' }, 'human');
  await svc.approveSpecCard(card.id, 'human');
  const t = await svc.createTask({ chainId: chain.id, title: 'w1', assignee: 'w', mode: 'file' }, 'v');
  return { svc, dir, t, card };
}

/** 假 ctx：经 get('agents') 提供 agents（cordis 4 可选服务读取路径）。 */
function fakeCtx(agents: unknown) {
  return { get: (name: string) => (name === 'agents' ? agents : undefined) };
}

describe('AgentRunner', () => {
  it('runs a task to completion', async () => {
    const { svc, dir, t } = await setupTask(true);
    try {
      const runner = new AgentRunner(fakeCtx({ create: fakeCreate({ completes: true, svc, taskId: t.id }) }) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      const state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('done');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('flags protocol violation when idle without complete/block', async () => {
    const { svc, dir, t } = await setupTask(false);
    try {
      const runner = new AgentRunner(fakeCtx({ create: fakeCreate({ completes: false, svc, taskId: t.id }) }) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      const state = await svc.snapshot();
      const task = state.tasks.get(t.id)!;
      expect(task.status).toBe('blocked');
      const blockEv = state.events.find((e) => e.taskId === t.id && e.kind === 'task/blocked');
      expect(blockEv!.payload['reason']).toContain('protocol_violation');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('marks failed (not blocked) on runner exception, attempts incremented', async () => {
    const { svc, dir, t } = await setupTask(true);
    try {
      const crashing = async () => ({
        agent: {
          followup: vi.fn(),
          whenIdle: vi.fn(async () => { throw new Error('boom'); }),
          session: { events: [] },
        },
      });
      const runner = new AgentRunner(fakeCtx({ create: crashing }) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      const state = await svc.snapshot();
      const task = state.tasks.get(t.id)!;
      expect(task.status).toBe('failed'); // P0-5：异常发 failed，不直接 block
      expect(task.attempts).toBe(1);
      const failEv = state.events.find((e) => e.taskId === t.id && e.kind === 'task/failed');
      expect(failEv!.payload['reason']).toContain('runner-error');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
