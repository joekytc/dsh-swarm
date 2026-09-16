import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { FileEventStore } from '../../src/domain/event-store.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { registerMainSessionTools } from '../../src/tools/main-session-tools.js';
import { DEFAULT_PREFIX_ROUTES } from '../../src/config.js';

/** 2026-09-15 恢复能力：主会话工具面须暴露 kanban_reopen_chain / kanban_waive_review（human actor）。 */
function ctx(svc: KanbanService, registry: Array<{ name?: string; execute(args: unknown, exec?: unknown): Promise<unknown> }>): Context {
  return {
    get(key: string) {
      if (key === 'tools') return { register(def: { name?: string }): () => void { registry.push(def as never); return () => {}; } };
      if (key === 'kanban') return { service: svc };
      if (key === 'wiki') return { search: async () => [], write: async (p: string) => ({ path: p }) };
      return undefined;
    },
  } as unknown as Context;
}
const configProvider = () => ({ getEffective: () => ({ prefixRoutes: { ...DEFAULT_PREFIX_ROUTES } }) }) as never;

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'main-recovery-'));
  const svc = new KanbanService(new FileEventStore(dir));
  const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
  const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
  await svc.approveSpecCard(card.id, 'human');
  const p = await svc.createTask({ chainId: chain.id, title: 'p', assignee: 'p', mode: 'openspec' }, 'v');
  await svc.claimTask(p.id, 'system');
  await svc.completeTask(p.id, { summary: 'plan', metadata: { artifacts_path: '/x/plan', pt_decision: { needed: true, reason: 'r' } }, completedAt: Date.now() }, 'p', { boundTaskId: p.id });
  return { dir, svc, chain, p };
}

describe('主会话恢复工具（2026-09-15）', () => {
  it('工具面暴露 kanban_reopen_chain / kanban_waive_review', async () => {
    const { dir, svc } = await setup();
    try {
      const registry: Array<{ name?: string }> = [];
      registerMainSessionTools(ctx(svc, registry as never), configProvider());
      const names = registry.map((t) => t.name);
      expect(names).toContain('kanban_reopen_chain');
      expect(names).toContain('kanban_waive_review');
      // 越权面不扩大：主会话不注册 create/complete/block
      expect(names).not.toContain('kanban_create');
      expect(names).not.toContain('kanban_complete');
      expect(names).not.toContain('kanban_block');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('kanban_reopen_chain：blocked 链恢复为 executing（human actor + [recovery] 留痕）', async () => {
    const { dir, svc, chain } = await setup();
    try {
      await svc.blockChain(chain.id, 'stall-watchdog');
      const registry: Array<{ name?: string; execute(args: unknown): Promise<unknown> }> = [];
      registerMainSessionTools(ctx(svc, registry as never), configProvider());
      const tool = registry.find((t) => t.name === 'kanban_reopen_chain')!;
      const ev = await tool.execute({ chainId: chain.id, reason: '人工裁决恢复原链' }) as { kind: string };
      expect(ev.kind).toBe('chain/reopened');
      const st = await svc.snapshot();
      expect(st.chains.get(chain.id)!.status).toBe('executing');
      expect(st.events.some((e) => e.kind === 'task/commented' && String(e.payload['body']).includes('[recovery]'))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('kanban_waive_review：评审 fail 后豁免目标根卡（工具内推导 target）', async () => {
    const { dir, svc, chain, p } = await setup();
    try {
      const pt = await svc.createTask({ chainId: chain.id, title: '计划复审', assignee: 'pt', mode: 'review-plan', parents: [p.id] }, 'v');
      await svc.recordReview(pt.id, p.id, { verdict: 'fail', issues: [{ severity: 'high', title: 'x', detail: 'y', resolved: false }] }, 'system');
      const registry: Array<{ name?: string; execute(args: unknown): Promise<unknown> }> = [];
      registerMainSessionTools(ctx(svc, registry as never), configProvider());
      const tool = registry.find((t) => t.name === 'kanban_waive_review')!;
      // 只传评审卡 id，root 由 resolveReviewTarget 推导
      const ev = await tool.execute({ taskId: pt.id, reason: 'PT 遗留问题非业务阻塞' }) as { kind: string };
      expect(ev.kind).toBe('review/waived');
      const st = await svc.snapshot();
      expect(st.tasks.get(p.id)!.reviewStatus).toBe('waived');
      expect(st.tasks.get(p.id)!.status).toBe('done');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
