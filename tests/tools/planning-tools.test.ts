import { describe, it, expect, vi } from 'vitest';
import { buildPlanningTools } from '../../src/tools/planning-tools.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';
import { DEFAULT_PREFIX_ROUTES } from '../../src/config.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseChecklist = {
  spec: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
  manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
  clarifications: [{ q: '目的?', a: 'A' }], doubts: [],
};

function deps(over: Partial<Parameters<typeof buildPlanningTools>[0]> = {}) {
  const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'pt-'))));
  const wiki = { write: vi.fn(async () => ({ path: 'projects/repo/checklists/s.md' })) } as unknown as WikiVaultClient;
  return {
    service: svc, wiki, getCaller: () => ({ actor: 'human' as const }),
    tempDir: () => '/tmp/checklists', prefixRoutes: DEFAULT_PREFIX_ROUTES, ...over,
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
    expect(res.ref).toMatch(/^projects\/repo\/checklists\/.+\.md$/); // localPath='/ws/repo' → repoSlug='repo'
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
    const wiki = { write: vi.fn(async () => ({ path: 'projects/repo/checklists/s.md' })) } as unknown as WikiVaultClient;
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
    const res = await t.execute({ checklist: baseChecklist, restoreRef: 'projects/repo/checklists/session_main-old.md' }) as { ok: true; ref: string; source: string };
    expect(res.ref).toBe('projects/repo/checklists/session_main-old.md'); // 覆盖原页
    expect(res.source).toBe('kb');
    expect((wiki.write as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1); // 仅一次写入（无重复页）
    expect((wiki.write as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('projects/repo/checklists/session_main-old.md');
  });
  it('planning_checklist_save: restoreRef 在前缀外 → 忽略（新建页，slug 命名）', async () => {
    const wiki = { write: vi.fn(async (p: string) => ({ path: p })) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ wiki }));
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ checklist: baseChecklist, restoreRef: 'evil/outside.md' }) as { ok: true; ref: string };
    // Q3&5: 新建页按需求名 slug 命名（problem='p' → slug 'p'），不再用 session_main- 时间戳
    expect(res.ref).toMatch(/^projects\/repo\/checklists\/p-[0-9a-z]+\.md$/);
    expect(res.ref).not.toBe('evil/outside.md');
  });
  it('planning_checklist_save: restoreRef + KB 不可达 → 兜底临时目录', async () => {
    const wiki = { write: vi.fn(async () => { const e = new Error('kb-unreachable'); (e as { code?: string }).code = 'kb-unreachable'; throw e; }) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ wiki }));
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ checklist: baseChecklist, restoreRef: 'projects/repo/checklists/session_main-old.md' }) as { ok: true; ref: string; source: string };
    expect(res.source).toBe('temp');
    expect(res.ref).toContain('/tmp/checklists/');
  });
  it('planning_checklist_save: localPath 与 /plan: 工作区不一致 → [workspace-mismatch] 阻断（不可跳过）', async () => {
    const tools = buildPlanningTools(deps({ resolveWorkspaceDir: () => '/ws/other-repo' }));
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    await expect(t.execute({ checklist: baseChecklist })).rejects.toThrow(/\[workspace-mismatch\]/);
  });
  it('planning_checklist_save: resolveWorkspaceDir 为 null（未捕获）→ 不触发闸1，正常落库', async () => {
    const tools = buildPlanningTools(deps({ resolveWorkspaceDir: () => null }));
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ checklist: baseChecklist }) as { ok: boolean; source: string };
    expect(res.ok).toBe(true);
  });
  it('planning_learning_save: scope=chain → projects/<repoSlug>/<chainId>/learnings/ + ref', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'ptl-'))));
    const chain = await svc.createChain({ title: '【需求】A', ownerSessionId: 'session_main', workspaceDir: '/ws/repo' }, 'human');
    const wiki = { write: vi.fn(async (p: string) => ({ path: p })) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ service: svc, wiki }));
    const t = tools.find((x) => x.name === 'planning_learning_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ learning: { title: '调度器需显式启动', lesson: '教训', evidence: chain.id, tags: ['dispatcher'] }, scope: 'chain', chainId: chain.id }) as { ok: true; ref: string; scope: string };
    expect(res.ok).toBe(true);
    expect(res.ref).toMatch(new RegExp(`^projects/repo/${chain.id}/learnings/.+\\.md$`));
    const body = String((wiki.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? '');
    expect(body).toContain('type: learning');
  });
  it('planning_learning_save: scope=project → projects/<repoSlug>/learnings/', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'ptl2-'))));
    const chain = await svc.createChain({ title: '【需求】A', ownerSessionId: 'session_main', workspaceDir: '/ws/vueadmin' }, 'human');
    const wiki = { write: vi.fn(async (p: string) => ({ path: p })) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ service: svc, wiki }));
    const t = tools.find((x) => x.name === 'planning_learning_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ learning: { title: '经验', lesson: 'l', evidence: chain.id, tags: [] }, scope: 'project', chainId: chain.id }) as { ok: true; ref: string };
    expect(res.ref).toMatch(/^projects\/vueadmin\/learnings\//);
  });
  it('planning_learning_save: 硬校验——非法 schema / 未知链 / 无 workspaceDir 均 throw', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'ptl3-'))));
    const chain = await svc.createChain({ title: '【需求】A', ownerSessionId: 'session_main' }, 'human');
    const tools = buildPlanningTools(deps({ service: svc, wiki: { write: vi.fn(async () => ({ path: 'x' })) } as never }));
    const t = tools.find((x) => x.name === 'planning_learning_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    await expect(t.execute({ learning: { title: '', lesson: 'l', evidence: 'e', tags: [] }, scope: 'chain', chainId: chain.id })).rejects.toThrow(/learning.title/);
    await expect(t.execute({ learning: { title: 't', lesson: 'l', evidence: 'e', tags: [] }, scope: 'chain', chainId: 'ch_不存在' })).rejects.toThrow(/unknown chain/);
    await expect(t.execute({ learning: { title: 't', lesson: 'l', evidence: 'e', tags: [] }, scope: 'project', chainId: chain.id })).rejects.toThrow(/workspaceDir/); // 该链无 workspaceDir
    const chainNoWs = await svc.createChain({ title: '【需求】B', ownerSessionId: 'session_main' }, 'human');
    await expect(t.execute({ learning: { title: 't', lesson: 'l', evidence: 'e', tags: [] }, scope: 'chain', chainId: chainNoWs.id })).rejects.toThrow(/workspaceDir/);
    await expect(t.execute({ learning: { title: 't', lesson: 'l', evidence: 'e', tags: [] }, scope: 'project', chainId: chainNoWs.id })).rejects.toThrow(/workspaceDir/);
  });
  it('planning_learning_save: KB 不可达 → {ok:false, reason:kb-unreachable}（不 throw、无临时兜底）', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'ptl4-'))));
    const chain = await svc.createChain({ title: '【需求】A', ownerSessionId: 'session_main', workspaceDir: '/ws/repo' }, 'human');
    const wiki = { write: vi.fn(async () => { const e = new Error('kb-unreachable'); (e as { code?: string }).code = 'kb-unreachable'; throw e; }) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ service: svc, wiki }));
    const t = tools.find((x) => x.name === 'planning_learning_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ learning: { title: 't', lesson: 'l', evidence: chain.id, tags: [] }, scope: 'chain', chainId: chain.id }) as { ok: false; reason: string };
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('kb-unreachable');
  });
  it('planning_memory_recall: path 白名单硬校验 + 全文截断 8000', async () => {
    const wiki = { read: vi.fn(async () => ({ path: 'projects/repo/learnings/a.md', rawMd: '# A\n' + 'x'.repeat(9000) })) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ wiki }));
    const t = tools.find((x) => x.name === 'planning_memory_recall')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ path: 'projects/repo/learnings/a.md' }) as { ok: true; content: string };
    expect(res.ok).toBe(true);
    expect(res.content.length).toBe(8001); // 8000 + '…'
    await expect(t.execute({ path: 'evil/outside.md' })).rejects.toThrow(/kb-rejected|outside allowed/);
  });
  it('local 模式：checklist 落 wiki/queries/checklists/ 前缀', async () => {
    const wiki = { write: vi.fn(async (p: string) => ({ path: p })) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ kbMode: 'local', wiki }));
    const t = tools.find((x) => x.name === 'planning_checklist_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ checklist: baseChecklist }) as { ok: true; source: string; ref: string };
    expect(res.source).toBe('kb');
    const writes = (wiki.write as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(writes[0]![0]).startsWith('wiki/queries/checklists/')).toBe(true);
  });
  it('local 模式：learning scope=chain 落 wiki/synthesis/learnings/<chainId>/', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'ptl5-'))));
    const chain = await svc.createChain({ title: '【需求】A', ownerSessionId: 'session_main' }, 'human');
    const wiki = { write: vi.fn(async (p: string) => ({ path: p })) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ service: svc, wiki, kbMode: 'local' }));
    const t = tools.find((x) => x.name === 'planning_learning_save')! as unknown as { execute(args: unknown): Promise<unknown> };
    await t.execute({ learning: { title: 't', lesson: 'l', evidence: chain.id, tags: [] }, scope: 'chain', chainId: chain.id });
    const writes = (wiki.write as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(writes[0]![0]).startsWith(`wiki/synthesis/learnings/${chain.id}/`)).toBe(true);
  });
  it('planning_memory_recall: local 模式 path=wiki/** 读回成功（local 白名单分支）', async () => {
    const wiki = { read: vi.fn(async (p: string) => ({ path: p, rawMd: '# checklist\n- x' })) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ kbMode: 'local', wiki }));
    const t = tools.find((x) => x.name === 'planning_memory_recall')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t.execute({ path: 'wiki/queries/checklists/x.md' }) as { ok: true; path: string; content: string };
    expect(res.ok).toBe(true);
    expect(res.path).toBe('wiki/queries/checklists/x.md');
    expect(res.content).toContain('# checklist');
    expect((wiki.read as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('wiki/queries/checklists/x.md');
    // local 白名单外的 projects/ 页被拒
    await expect(t.execute({ path: 'projects/learnings/a.md' })).rejects.toThrow(/kb-rejected|outside wiki/);
  });
  it('planning_memory_recall: remote 模式 wiki/ path 仍拒（projects/ 白名单不因 local 修复而放宽）', async () => {
    const wiki = { read: vi.fn(async () => ({ path: 'x', rawMd: '' })) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ kbMode: 'remote', wiki }));
    const t = tools.find((x) => x.name === 'planning_memory_recall')! as unknown as { execute(args: unknown): Promise<unknown> };
    await expect(t.execute({ path: 'wiki/queries/checklists/x.md' })).rejects.toThrow(/kb-rejected|outside allowed/);
    expect((wiki.read as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
  it('planning_memory_recall: query 模式 top5 + 不可达软失败 + disabled', async () => {
    const wiki = { search: vi.fn(async () => [{ path: 'p', title: 't', score: 1, mtime: 1 }]) } as unknown as WikiVaultClient;
    const tools = buildPlanningTools(deps({ wiki, memoryEnabled: false }));
    const t = tools.find((x) => x.name === 'planning_memory_recall')! as unknown as { execute(args: unknown): Promise<unknown> };
    expect(await t.execute({ query: 'x' })).toEqual({ ok: false, reason: 'disabled' });
    const tools2 = buildPlanningTools(deps({ wiki }));
    const t2 = tools2.find((x) => x.name === 'planning_memory_recall')! as unknown as { execute(args: unknown): Promise<unknown> };
    const res = await t2.execute({ query: 'x' }) as { ok: true; results: unknown[] };
    expect(res.ok).toBe(true);
    expect(res.results).toHaveLength(1);
  });
});
