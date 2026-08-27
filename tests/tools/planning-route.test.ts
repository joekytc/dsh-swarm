import { describe, it, expect } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { registerMainSessionTools } from '../../src/tools/main-session-tools.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseChecklist = {
  spec: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
  manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
  clarifications: [], doubts: [],
};

describe('main-session planning route (v2)', () => {
  it('/plan: 零建卡 + planning_checklist_save + /openspec: 建链→executing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const ctx = {
        get(key: string) {
          if (key === 'tools') return { register(def: { name?: string }): () => void { registry.push(def as never); return () => {}; } };
          if (key === 'kanban') return { service: svc };
          if (key === 'wiki') return new WikiVaultClient({ baseUrl: 'http://mock', pagePrefix: 'projects/' });
          return undefined;
        },
      } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' } } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      const plan = await route.execute({ message: '/plan: 优化登录' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string };
      expect(plan.kind).toBe('plan');
      let state = await svc.snapshot();
      expect(state.chains.size).toBe(0);
      // 保存清单
      const save = registry.find((t) => t.name === 'planning_checklist_save')!;
      await save.execute({ checklist: baseChecklist }, { agent: { session: { header: { cwd: '/ws' } } } });
      // /openspec: 建链
      const open = await route.execute({ message: '/openspec: 确认' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string; chainId?: string };
      expect(open.kind).toBe('openspec');
      state = await svc.snapshot();
      expect(state.chains.size).toBe(1);
      expect(state.chains.get(open.chainId!)!.status).toBe('executing');
      expect(state.chains.get(open.chainId!)!.workspaceDir).toBe('/ws');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('护栏：主 agent 工具面无 spec_card_edit/approve 与 kanban_create', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr2-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const names: string[] = [];
      const ctx = {
        get(key: string) {
          if (key === 'tools') return { register(def: { name?: string }): () => void { if (def.name) names.push(def.name); return () => {}; } };
          if (key === 'kanban') return { service: svc };
          if (key === 'wiki') return new WikiVaultClient({ baseUrl: 'http://mock', pagePrefix: 'projects/' });
          return undefined;
        },
      } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' } } as never);
      expect(names).not.toContain('spec_card_edit');
      expect(names).not.toContain('spec_card_approve');
      expect(names).not.toContain('kanban_create');
      expect(names).not.toContain('kanban_complete');
      expect(names).toContain('kanban_route');
      expect(names).toContain('planning_checklist_save');
      expect(names).toContain('planning_prefetch');
      expect(names).toContain('spec_card_view');
      expect(names).toContain('planning_learning_save');
      expect(names).toContain('planning_memory_recall');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('/openspec: 无清单 → 拒绝（ok:false, reason:no-checklist）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr3-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const ctx = { get: (k: string) => k === 'tools' ? { register: (d: never) => { registry.push(d as never); return () => {}; } } : k === 'kanban' ? { service: svc } : k === 'wiki' ? new WikiVaultClient({ baseUrl: 'http://mock', pagePrefix: 'projects/' }) : undefined } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' } } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      await route.execute({ message: '/plan: 优化登录' }, { agent: { session: { header: { cwd: '/ws' } } } });
      const open = await route.execute({ message: '/openspec: 确认' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string; approved?: boolean };
      expect(open.kind).toBe('openspec');
      expect(open.approved).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('非前缀消息 → kind:none（不落入 openspec 误判）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr4-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const ctx = { get: (k: string) => k === 'tools' ? { register: (d: never) => { registry.push(d as never); return () => {}; } } : k === 'kanban' ? { service: svc } : k === 'wiki' ? new WikiVaultClient({ baseUrl: 'http://mock', pagePrefix: 'projects/' }) : undefined } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' } } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      const res = await route.execute({ message: '普通消息，无前缀' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string };
      expect(res.kind).toBe('none');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('/openspec: 内存丢失 + KB 有候选页 → 硬拦，guidance 带候选列表（路由2：LLM 读页重建）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr5-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const wiki = {
        search: async () => [{ path: 'projects/checklists/session_main-a1.md', title: '【需求】优化登录', score: 1 }],
        write: async (p: string) => ({ path: p }),
      };
      const ctx = { get: (k: string) => k === 'tools' ? { register: (d: never) => { registry.push(d as never); return () => {}; } } : k === 'kanban' ? { service: svc } : k === 'wiki' ? wiki : undefined } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' } } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      await route.execute({ message: '/plan: 优化登录' }, { agent: { session: { header: { cwd: '/ws' } } } });
      const open = await route.execute({ message: '/openspec: 确认' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string; approved?: boolean; reason?: string; recovery?: string; checklistCandidates?: string[]; guidance?: string };
      expect(open.kind).toBe('openspec');
      expect(open.approved).toBe(false);
      expect(open.reason).toBe('no-checklist');
      expect(open.recovery).toBe('kb');
      expect(open.checklistCandidates).toContain('projects/checklists/session_main-a1.md');
      expect(open.guidance).toContain('restoreRef');
      expect((await svc.snapshot()).chains.size).toBe(0); // 硬拦：不建链
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('/openspec: 内存丢失 + KB 不可达 → 硬拦，两条路皆空指引（禁止编造进程诊断）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr6-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const wiki = { search: async () => { throw new Error('kb-unreachable'); }, write: async (p: string) => ({ path: p }) };
      const ctx = { get: (k: string) => k === 'tools' ? { register: (d: never) => { registry.push(d as never); return () => {}; } } : k === 'kanban' ? { service: svc } : k === 'wiki' ? wiki : undefined } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' } } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      await route.execute({ message: '/plan: 优化登录' }, { agent: { session: { header: { cwd: '/ws' } } } });
      const open = await route.execute({ message: '/openspec: 确认' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string; approved?: boolean; recovery?: string; guidance?: string };
      expect(open.kind).toBe('openspec');
      expect(open.approved).toBe(false);
      expect(open.recovery).toBe('none');
      expect(open.guidance).toContain('消化当前对话上下文');
      expect(open.guidance).toContain('planning_checklist_save');
      expect((await svc.snapshot()).chains.size).toBe(0); // 硬拦：不建链
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('/plan: 响应 guidance 含 KB 记忆索引块（mock wiki 命中）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr7-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const wiki = { search: async (q: string) => q === '【需求】' ? [] : [{ path: 'projects/learnings/a.md', title: 'A 经验', score: 5, mtime: 1000 }], write: async (p: string) => ({ path: p }) };
      const ctx = { get: (k: string) => k === 'tools' ? { register: (d: never) => { registry.push(d as never); return () => {}; } } : k === 'kanban' ? { service: svc } : k === 'wiki' ? wiki : undefined } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' }, memory: { enabled: true, maxIndexEntries: 8 } } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      const res = await route.execute({ message: '/plan: 优化登录' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string; guidance: string };
      expect(res.kind).toBe('plan');
      expect(res.guidance).toContain('KB 记忆索引');
      expect(res.guidance).toContain('A 经验');
      expect(res.guidance).toContain('planning_memory_recall');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('/plan: KB 不可达 → 无索引块但 guidance 照常（非阻塞）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr8-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const wiki = { search: async () => { throw new Error('kb-unreachable'); }, write: async (p: string) => ({ path: p }) };
      const ctx = { get: (k: string) => k === 'tools' ? { register: (d: never) => { registry.push(d as never); return () => {}; } } : k === 'kanban' ? { service: svc } : k === 'wiki' ? wiki : undefined } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' }, memory: { enabled: true, maxIndexEntries: 8 } } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      const res = await route.execute({ message: '/plan: 优化登录' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string; guidance: string };
      expect(res.kind).toBe('plan');
      expect(res.guidance).not.toContain('KB 记忆索引');
      expect(res.guidance).toContain('看板工作流 v2');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('/learning: 分支返回 brief + guidance（最近链）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mr9-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      await svc.createChain({ title: '【需求】优化登录', ownerSessionId: 'session_main' }, 'human');
      const registry: Array<{ name: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const ctx = { get: (k: string) => k === 'tools' ? { register: (d: never) => { registry.push(d as never); return () => {}; } } : k === 'kanban' ? { service: svc } : k === 'wiki' ? { search: async () => [], write: async (p: string) => ({ path: p }) } : undefined } as unknown as Context;
      registerMainSessionTools(ctx, { prefixRoutes: { plan: '/plan:', openspec: '/openspec:' }, memory: { enabled: true, maxIndexEntries: 8 } } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      const res = await route.execute({ message: '/learning:' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string; brief?: string; guidance?: string };
      expect(res.kind).toBe('learning');
      expect(res.brief).toContain('【需求】优化登录');
      expect(res.guidance).toContain('planning_learning_save');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
