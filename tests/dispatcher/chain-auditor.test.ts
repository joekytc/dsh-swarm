import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChainAuditor } from '../../src/dispatcher/chain-auditor.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';

describe('ChainAuditor (D23 链完成验收核对)', () => {
  let dir: string;
  let wsRoot: string;
  let svc: KanbanService;
  let chainId: string;
  let taskIds: string[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'auditor-'));
    wsRoot = join(dir, 'workspaces');
    svc = new KanbanService(new FileEventStore(join(dir, 'events')));
    const chain = await svc.createChain({ title: 'audit', ownerSessionId: 's' }, 'human');
    chainId = chain.id;
    const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
    await svc.approveSpecCard(card.id, 'human');
    const d = await svc.createTask({ chainId, title: 'd', assignee: 'd', mode: 'align' }, 'v');
    await svc.claimTask(d.id, 'system');
    await svc.completeTask(d.id, { summary: 'impl', metadata: { changed_files: ['a.ts'] }, completedAt: Date.now() }, 'd', { boundTaskId: d.id });
    const w3 = await svc.createTask({ chainId, title: 'w3', assignee: 'w', mode: 'kb', parents: [d.id] }, 'v');
    await svc.claimTask(w3.id, 'system');
    await svc.completeTask(w3.id, { summary: 'synced', metadata: { kb_url: 'http://x' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
    taskIds = [d.id, w3.id];
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('no evidence when chain workspace is empty or only task-owned', async () => {
    const auditor = new ChainAuditor({ kanban: svc, workspacesRoot: wsRoot, listLiveAgents: () => [] });
    expect(await auditor.check(chainId)).toEqual([]);
    // 任务工作区内有文件也视为归属任务（不产生越权证据）
    mkdirSync(join(wsRoot, chainId, taskIds[0]), { recursive: true });
    writeFileSync(join(wsRoot, chainId, taskIds[0], 'plan.md'), 'x');
    expect(await auditor.check(chainId)).toEqual([]);
  });

  it('orphan file directly under chain workspace (not in any task dir) → artifact-reconciliation evidence', async () => {
    mkdirSync(join(wsRoot, chainId), { recursive: true });
    writeFileSync(join(wsRoot, chainId, 'leak.md'), 'main wrote this');
    const auditor = new ChainAuditor({ kanban: svc, workspacesRoot: wsRoot, listLiveAgents: () => [] });
    const evidence = await auditor.check(chainId);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].source).toContain('reconcil');
    expect(evidence[0].paths.join()).toContain('leak.md');
  });

  it('non-kbn live agent writing under workspaces → main-session-scan evidence; kbn- role agents ignored', async () => {
    const leak = join(wsRoot, chainId, 'x.md');
    const agents = [
      { id: 'session_main_real', session: { events: [{ type: 'tool-call', name: 'write', arguments: { path: leak, content: 'x' } }] } },
      { id: 'kbn-' + taskIds[0], session: { events: [{ type: 'tool-call', name: 'write', arguments: { path: leak, content: 'x' } }] } },
    ];
    const auditor = new ChainAuditor({ kanban: svc, workspacesRoot: wsRoot, listLiveAgents: () => agents as never });
    const evidence = await auditor.check(chainId);
    expect(evidence.length).toBe(1);
    expect(evidence[0].source).toContain('main-session');
    expect(evidence[0].paths.join()).toContain('x.md');
  });

  it('no evidence when only kbn- role agents wrote under workspaces', async () => {
    const leak = join(wsRoot, chainId, 'x.md');
    const agents = [
      { id: 'kbn-' + taskIds[0], session: { events: [{ type: 'tool-call', name: 'write', arguments: { path: leak } }] } },
      { id: 'kbn-v-' + chainId, session: { events: [{ type: 'tool-call', name: 'kanban_create', arguments: {} }] } },
    ];
    const auditor = new ChainAuditor({ kanban: svc, workspacesRoot: wsRoot, listLiveAgents: () => agents as never });
    expect(await auditor.check(chainId)).toEqual([]);
  });
});
