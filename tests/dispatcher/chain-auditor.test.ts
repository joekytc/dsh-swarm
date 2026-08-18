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

  // ── 修复轮 7 回归：只读排查 run_code 不再被误判为越权写 ──

  it('REGRESSION: read-only run_code (dispatched bash ls + glob) referencing workspaces root → NO evidence', async () => {
    // 还原真实误报：run_code 代码里含 workspacesRoot 路径，但实际只派发只读 ls/glob/read
    const code = '// Inspect kanban storage and client structure\n' +
      'const s = await tools.bash({ command: "ls -la ' + wsRoot + '/ && ls ' + wsRoot + '/' + chainId + '/workspaces/ 2>/dev/null", description: "Inspect" });\n' +
      'const g = await tools.glob({ pattern: "client/**", path: "/other" });\n' +
      'return "ok";';
    const agents = [{
      id: 'session_other_project',
      session: {
        events: [
          { type: 'tool/call', data: { callId: 'call_ro', name: 'run_code', arguments: JSON.stringify({ code }) } },
          { type: 'tool/code-dispatch-start', data: { rootCallId: 'call_ro', parentCallId: 'call_ro', subCallId: 'call_ro:code:1', name: 'bash', arguments: { command: 'ls -la ' + wsRoot + '/ && ls ' + wsRoot + '/' + chainId + '/workspaces/ 2>/dev/null' } } },
          { type: 'tool/code-dispatch-start', data: { rootCallId: 'call_ro', parentCallId: 'call_ro', subCallId: 'call_ro:code:2', name: 'glob', arguments: { pattern: 'client/**', path: '/other' } } },
        ],
      },
    }];
    const auditor = new ChainAuditor({ kanban: svc, workspacesRoot: wsRoot, listLiveAgents: () => agents as never });
    expect(await auditor.check(chainId)).toEqual([]);
  });

  it('run_code dispatching a write bash sub-call (echo > path under workspaces) → evidence', async () => {
    const cmd = 'echo done > ' + join(wsRoot, chainId, 'x.md');
    const agents = [{
      id: 'session_main_real',
      session: {
        events: [
          { type: 'tool/call', data: { callId: 'call_w', name: 'run_code', arguments: JSON.stringify({ code: 'await tools.bash({ command: ' + JSON.stringify(cmd) + ' })' }) } },
          { type: 'tool/code-dispatch', data: { rootCallId: 'call_w', parentCallId: 'call_w', subCallId: 'call_w:code:1', name: 'bash', arguments: { command: cmd }, isError: false, content: [{ type: 'text', text: '' }] } },
        ],
      },
    }];
    const auditor = new ChainAuditor({ kanban: svc, workspacesRoot: wsRoot, listLiveAgents: () => agents as never });
    const evidence = await auditor.check(chainId);
    expect(evidence.length).toBe(1);
    expect(evidence[0].source).toContain('main-session');
    expect(evidence[0].paths[0]).toContain(cmd);
  });

  it('run_code without dispatch records falling back to a write-marker code string → evidence; read-only code string → NO evidence', async () => {
    const writeCode = 'await tools.bash({ command: "echo x > ' + join(wsRoot, chainId, 'y.md') + '" })';
    const readCode = 'const p = "' + wsRoot + '/" + x; return p;'; // 只提及路径，无写标记
    const agents = [
      { id: 's1', session: { events: [{ type: 'tool/call', data: { callId: 'c1', name: 'run_code', arguments: JSON.stringify({ code: writeCode }) } }] } },
      { id: 's2', session: { events: [{ type: 'tool/call', data: { callId: 'c2', name: 'run_code', arguments: JSON.stringify({ code: readCode }) } }] } },
    ];
    const auditor = new ChainAuditor({ kanban: svc, workspacesRoot: wsRoot, listLiveAgents: () => agents as never });
    const evidence = await auditor.check(chainId);
    expect(evidence.length).toBe(1);
    expect(evidence[0].paths[0]).toContain(wsRoot);
  });

  it('direct bash with write marker + workspaces path → evidence; read-only bash (ls) → NO evidence', async () => {
    const writeCmd = 'mkdir -p ' + join(wsRoot, chainId, 'sub');
    const readCmd = 'ls -la ' + wsRoot + '/ && cat ' + join(wsRoot, chainId, 'plan.md');
    const agents = [
      { id: 's1', session: { events: [{ type: 'tool/call', data: { callId: 'b1', name: 'bash', arguments: { command: writeCmd } } }] } },
      { id: 's2', session: { events: [{ type: 'tool/call', data: { callId: 'b2', name: 'bash', arguments: { command: readCmd } } }] } },
    ];
    const auditor = new ChainAuditor({ kanban: svc, workspacesRoot: wsRoot, listLiveAgents: () => agents as never });
    const evidence = await auditor.check(chainId);
    expect(evidence.length).toBe(1);
    expect(evidence[0].paths[0]).toContain(writeCmd);
  });

  // ── 修复轮 7：作用域收窄 ──

  it('scope: session whose header.cwd is OUTSIDE chain workspaceDir is skipped even with write evidence', async () => {
    const leak = join(wsRoot, chainId, 'x.md');
    const agents = [{
      id: 'session_other_project',
      session: { header: { cwd: '/Users/x/OtherProject' }, events: [{ type: 'tool-call', name: 'write', arguments: { path: leak } }] },
    }];
    const auditor = new ChainAuditor({ kanban: svc, workspacesRoot: wsRoot, listLiveAgents: () => agents as never });
    expect(await auditor.check(chainId, '/Users/x/MainWorkspace')).toEqual([]);
  });

  it('scope: session whose header.cwd is INSIDE chain workspaceDir is scanned', async () => {
    const leak = join(wsRoot, chainId, 'x.md');
    const agents = [{
      id: 'session_main_real',
      session: { header: { cwd: '/Users/x/MainWorkspace' }, events: [{ type: 'tool-call', name: 'write', arguments: { path: leak } }] },
    }];
    const auditor = new ChainAuditor({ kanban: svc, workspacesRoot: wsRoot, listLiveAgents: () => agents as never });
    const evidence = await auditor.check(chainId, '/Users/x/MainWorkspace');
    expect(evidence.length).toBe(1);
    expect(evidence[0].source).toContain('main-session');
  });

  it('scope: session without header.cwd is conservatively scanned (kept) when workspaceDir provided', async () => {
    const leak = join(wsRoot, chainId, 'x.md');
    const agents = [{
      id: 'session_no_header',
      session: { events: [{ type: 'tool-call', name: 'write', arguments: { path: leak } }] },
    }];
    const auditor = new ChainAuditor({ kanban: svc, workspacesRoot: wsRoot, listLiveAgents: () => agents as never });
    const evidence = await auditor.check(chainId, '/Users/x/MainWorkspace');
    expect(evidence.length).toBe(1);
  });
});
