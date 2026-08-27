import { describe, it, expect, vi } from 'vitest';
import { buildPlanningTools } from '../../src/tools/planning-tools.js';
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

function deps(over: Partial<Parameters<typeof buildPlanningTools>[0]> = {}) {
  const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'pt-'))));
  const wiki = { write: vi.fn(async () => ({ path: 'projects/checklists/s.md' })) } as unknown as WikiVaultClient;
  return {
    service: svc, wiki, getCaller: () => ({ actor: 'human' as const }),
    tempDir: () => '/tmp/checklists', ...over,
  };
}

describe('planning tools', () => {
  it('planning_checklist_save: 合法清单写 KB 返回 ref', async () => {
    const tools = buildPlanningTools(deps());
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ checklist: baseChecklist }) as { ok: true; source: string; repoPath: string; ref: string };
    expect(res.ok).toBe(true);
    expect(res.source).toBe('kb');
    expect(res.repoPath).toBe('/ws/repo');
    expect(res.ref).toContain('projects/checklists/');
  });
  it('planning_checklist_save: KB 不可达 → 兜底临时目录', async () => {
    const wiki = { write: vi.fn(async () => { const e = new Error('kb-unreachable'); (e as { code?: string }).code = 'kb-unreachable'; throw e; }) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ wiki }));
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ checklist: baseChecklist }) as { ok: true; source: 'temp'; ref: string };
    expect(res.source).toBe('temp');
    expect(res.ref).toContain('/tmp/checklists/');
  });
  it('planning_checklist_save: schema 非法 → 抛错拒绝', async () => {
    const tools = buildPlanningTools(deps());
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const bad = { ...baseChecklist, spec: { ...baseChecklist.spec, testing: '' } };
    await expect(t.execute({ checklist: bad })).rejects.toThrow(/spec.testing/);
  });
  it('planning_checklist_save: 落库 body 已格式化（标题【需求】+ 各段 markdown，非裸 JSON）', async () => {
    const wiki = { write: vi.fn(async () => ({ path: 'projects/checklists/s.md' })) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ wiki }));
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    await t.execute({ checklist: baseChecklist });
    const body = String((wiki.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? '');
    expect(body.startsWith('# 【需求】p')).toBe(true);
    expect(body).toContain('## Spec');
    expect(body).toContain('## 澄清问答');
    expect(body).not.toContain('"problem"');
  });
  it('planning_prefetch: 派只读子代理并返回 manifest', async () => {
    const spawnPrefetch = vi.fn(async (_prompt: string, _ws?: string, _parent?: unknown, _signal?: unknown) => JSON.stringify(baseChecklist.manifest));
    const tools = buildPlanningTools(deps({ spawnPrefetch }));
    const t = tools.find((x) => x.name === 'planning_prefetch')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ scope: '登录模块', repoPath: '/ws/repo' }) as { ok: true; manifest: unknown };
    expect(spawnPrefetch).toHaveBeenCalled();
    expect((res.manifest as { repo: { localPath: string } }).repo.localPath).toBe('/ws/repo');
  });
  it('planning_prefetch: exec.agent/signal 经 ToolRunContext 透传给 spawnPrefetch（子代理缝血缘+取消通道）', async () => {
    const spawnPrefetch = vi.fn(async (_prompt: string, _ws?: string, _parent?: unknown, _signal?: unknown) => JSON.stringify(baseChecklist.manifest));
    const tools = buildPlanningTools(deps({ spawnPrefetch }));
    const t = tools.find((x) => x.name === 'planning_prefetch')! as unknown as { execute(args: unknown, exec?: unknown): Promise<unknown> };
    const parentAgent = { id: 'agent-main' };
    const signal = new AbortController().signal;
    await t.execute({ scope: 's', repoPath: '/ws/repo' }, { agent: parentAgent, signal });
    // 位置参数：(prompt, workspaceDir, parentAgent, signal)
    const call = spawnPrefetch.mock.calls[0]!;
    expect(call[1]).toBe('/ws/repo');
    expect(call[2]).toBe(parentAgent);
    expect(call[3]).toBe(signal);
  });
  it('planning_checklist_save: restoreRef（前缀内）覆盖原页，不产生重复页', async () => {
    const wiki = { write: vi.fn(async (p: string) => ({ path: p })) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ wiki }));
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ checklist: baseChecklist, restoreRef: 'projects/checklists/session_main-old.md' }) as { ok: true; ref: string; source: string };
    expect(res.ref).toBe('projects/checklists/session_main-old.md'); // 覆盖原页
    expect(res.source).toBe('kb');
    expect((wiki.write as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1); // 仅一次写入（无重复页）
    expect((wiki.write as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('projects/checklists/session_main-old.md');
  });
  it('planning_checklist_save: restoreRef 在前缀外 → 忽略（新建页）', async () => {
    const wiki = { write: vi.fn(async (p: string) => ({ path: p })) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ wiki }));
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ checklist: baseChecklist, restoreRef: 'evil/outside.md' }) as { ok: true; ref: string };
    expect(res.ref).toContain('projects/checklists/session_main-');
    expect(res.ref).not.toBe('evil/outside.md');
  });
  it('planning_checklist_save: restoreRef + KB 不可达 → 兜底临时目录', async () => {
    const wiki = { write: vi.fn(async () => { const e = new Error('kb-unreachable'); (e as { code?: string }).code = 'kb-unreachable'; throw e; }) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ wiki }));
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ checklist: baseChecklist, restoreRef: 'projects/checklists/session_main-old.md' }) as { ok: true; ref: string; source: string };
    expect(res.source).toBe('temp');
    expect(res.ref).toContain('/tmp/checklists/');
  });
});
