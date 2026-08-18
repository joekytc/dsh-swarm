import { describe, it, expect } from 'vitest';
import { runFullChain } from './fake-agent-driver.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('full chain e2e (R20 semantics)', () => {
  it('runs /plan: → spec → /openspec: → W1→P→W2→D→W3 → V summary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const { chainId, tasks } = await runFullChain(svc, { planMsg: '/plan: 优化登录 / projA / auth', openspecMsg: '/openspec: 确认执行' });
      const state = await svc.snapshot();
      expect(state.chains.get(chainId)!.status).toBe('completed');
      const order = tasks.map((t) => `${t.assignee}:${t.mode}`);
      expect(order).toEqual(['p:openspec', 'w:kb', 'd:execute', 'w:kb']); // W1-supp 按需跳过（P2）；P→W2→D(execute)→W3 严格串行
      const w2 = tasks[1]; // W2 = 第一个 w:kb
      expect(state.handoffs.get(w2.id)!.metadata.kb_url).toContain('http');
      const d = tasks[2]; // D = d:execute（执行者）
      expect(state.handoffs.get(d.id)!.metadata.changed_files).toBeTruthy();
      expect(state.handoffs.get(d.id)!.metadata.commit_hash).toBeTruthy(); // 交付物证据（C1/C2）
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('blocks chain when wiki unreachable and resumes after unblock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e2-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const { chainId, tasks, wiki } = await runFullChain(svc, { planMsg: '/plan: x / p / a', openspecMsg: '/openspec: go', failWiki: true });
      const state = await svc.snapshot();
      const w2 = tasks.find((t) => t.mode === 'kb');
      expect(state.tasks.get(w2!.id)!.status).toBe('blocked');
      const blockEv = state.events.find((e) => e.taskId === w2!.id && e.kind === 'task/blocked');
      expect(blockEv!.payload['reason']).toContain('kb-unreachable');
      wiki.setOk(true);
      await svc.unblockTask(w2!.id, 'human');
      // 重新调度后链路可继续
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('runs two chains in parallel without interference (P2 multi-chain)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e3-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const [a, b] = await Promise.all([
        runFullChain(svc, { planMsg: '/plan: 链路A / pA / apiA', openspecMsg: '/openspec: go' }),
        runFullChain(svc, { planMsg: '/plan: 链路B / pB / apiB', openspecMsg: '/openspec: go' }),
      ]);
      const state = await svc.snapshot();
      expect(state.chains.get(a.chainId)!.status).toBe('completed');
      expect(state.chains.get(b.chainId)!.status).toBe('completed');
      // 任务不串链：A 链任务全属 A、B 链任务全属 B
      const aTasks = a.tasks.map((t) => t.id);
      const bTasks = b.tasks.map((t) => t.id);
      for (const t of state.tasks.values()) {
        if (aTasks.includes(t.id)) expect(t.chainId).toBe(a.chainId);
        if (bTasks.includes(t.id)) expect(t.chainId).toBe(b.chainId);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
