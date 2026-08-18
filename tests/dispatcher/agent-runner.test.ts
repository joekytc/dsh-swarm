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

  it('resumes same session on rework (blocked→unblocked→ready) using run history (B2)', async () => {
    const { svc, dir, t } = await setupTask(false); // 假 agent 不调 complete → 协议违规 → blocked
    try {
      const calls: string[] = [];
      const agents = {
        create: async (o: unknown) => { calls.push('create'); return fakeCreate({ completes: false, svc, taskId: t.id })(o); },
        resume: async (o: unknown) => { calls.push('resume'); return fakeCreate({ completes: true, svc, taskId: t.id })(o); },
      };
      const runner = new AgentRunner(fakeCtx(agents) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id); // 首次：create 会话，idle 无 complete → blocked(protocol_violation)
      let state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('blocked');
      // 返工：blocked → unblocked → ready（attempts 不递增）
      await svc.unblockTask(t.id, 'human');
      state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('ready');
      expect(state.tasks.get(t.id)!.attempts).toBe(0);
      // 重新调度：存在 claimed 事件 → resume 同一会话（不再 create，避免 kbn-<taskId> 冲突）
      await runner.runTask(t.id);
      expect(calls).toEqual(['create', 'resume']);
      state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('done');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('fails task when agent spawn throws after claim (R1: no running without agent)', async () => {
    const { svc, dir, t } = await setupTask(true);
    try {
      const runner = new AgentRunner(fakeCtx({ create: async () => { throw new Error('spawn boom'); } }) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      const state = await svc.snapshot();
      const task = state.tasks.get(t.id)!;
      expect(task.status).toBe('failed'); // claim 后 spawn 失败 → failed（attempts+1），不留 running 悬挂
      expect(task.attempts).toBe(1);
      const failEv = state.events.find((e) => e.taskId === t.id && e.kind === 'task/failed');
      expect(failEv!.payload['reason']).toContain('runner-error');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('D(execute): session cwd = chain workspace + sandbox full-access + git creds injected (M2/M3/M4)', async () => {
    const { execFileSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'runner-d-'));
    const ws = mkdtempSync(join(tmpdir(), 'runner-d-ws-')); // 发起 /plan: 的主 agent 工作空间
    const repo = join(ws, 'repo'); // 目标仓库在链工作空间内
    try {
      execFileSync('mkdir', ['-p', repo]);
      execFileSync('git', ['init', '-q', repo]);
      execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/acme/x.git']);
      execFileSync('git', ['-C', repo, 'config', 'user.email', 'a@b.c']);
      execFileSync('git', ['-C', repo, 'config', 'user.name', 'a']);

      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: ws }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'execute', body: 'TARGET_REPO=' + repo + '\n执行规格卡 solution/testing' }, 'v');

      let capturedCreate: { meta?: { cwd?: string } } | null = null;
      const appends: Array<[string, unknown]> = [];
      const fakeAgentCtx = {
        get: (n: string) => (n === 'agentPresets' ? { mount: async () => {} } : undefined),
        agent: { session: { append: (k: string, v: unknown) => { appends.push([k, v]); } } },
        tools: undefined,
      };
      const agents = {
        create: async (o: { meta?: { cwd?: string }; setup?: (c: unknown) => Promise<void> }) => {
          capturedCreate = o;
          if (o.setup) await o.setup(fakeAgentCtx as never);
          return { agent: { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [{ type: 'tool-call', name: 'kanban_complete' }] } } };
        },
      };
      const prevPat = process.env.KANBAN_GIT_PAT;
      process.env.KANBAN_GIT_PAT = 'glpat-testtoken123';
      try {
        const runner = new AgentRunner(fakeCtx(agents) as never, svc, {} as never, {} as unknown as WikiVaultClient);
        await runner.runTask(t.id);
        // M2(Q5)：会话 cwd = 链工作空间（发起 /plan: 的主 agent 工作空间），不是仓库、不是 kanban 存储
        expect(capturedCreate!.meta!.cwd).toBe(ws);
        // M3(Q4)：D sandbox = danger-full-access
        expect(appends).toContainEqual(['sandbox/mode', { mode: 'danger-full-access', source: 'delegation' }]);
        // M4：git 凭据注入 repo-local（GitLab glpat-* → oauth2 basic）
        const out = execFileSync('git', ['-C', repo, 'config', '--local', '--get', 'http.https://github.com/acme/x.git.extraheader'], { encoding: 'utf8' }).trim();
        expect(out).toBe('AUTHORIZATION: basic ' + Buffer.from('oauth2:glpat-testtoken123').toString('base64'));
      } finally {
        if (prevPat === undefined) delete process.env.KANBAN_GIT_PAT; else process.env.KANBAN_GIT_PAT = prevPat;
      }
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(ws, { recursive: true, force: true }); }
  });

  it('M3(B): D repo outside chain workspace + no userQuestions → claim+block repo-outside-workspace (no session created)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-d2-'));
    const ws = mkdtempSync(join(tmpdir(), 'runner-d2-ws-'));
    const repo = mkdtempSync(join(tmpdir(), 'runner-d2-repo-')); // 仓库在工作空间外
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: ws }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'execute', body: 'TARGET_REPO=' + repo }, 'v');
      const createSpy = vi.fn();
      const runner = new AgentRunner(fakeCtx({ create: createSpy }) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      const state = await svc.snapshot();
      const task = state.tasks.get(t.id)!;
      expect(task.status).toBe('blocked'); // 无询问通道 → 视为未授权 → block 等人工放行
      const blockEv = state.events.find((e) => e.taskId === t.id && e.kind === 'task/blocked');
      expect(blockEv!.payload['reason']).toContain('repo-outside-workspace');
      expect(createSpy).not.toHaveBeenCalled(); // 未建会话
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(ws, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
  });

  it('M3(B): D repo outside workspace + user allows via userQuestions → session created with cwd = chain workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-d3-'));
    const ws = mkdtempSync(join(tmpdir(), 'runner-d3-ws-'));
    const repo = mkdtempSync(join(tmpdir(), 'runner-d3-repo-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: ws }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'execute', body: 'TARGET_REPO=' + repo }, 'v');
      const asked: string[] = [];
      let capturedCreate: { meta?: { cwd?: string } } | null = null;
      const agents = {
        create: async (o: { meta?: { cwd?: string } }) => { capturedCreate = o; return { agent: { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [{ type: 'tool-call', name: 'kanban_complete' }] } } }; },
      };
      const ctx = {
        get: (name: string) => {
          if (name === 'agents') return agents;
          if (name === 'userQuestions') return { ask: async (req: { questions: Array<{ question: string }> }) => { asked.push(req.questions[0].question); return { answers: [{ id: 'd-repo-permission', selected: ['允许'] }] }; } };
          return undefined;
        },
      };
      const runner = new AgentRunner(ctx as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain('会话工作空间外');
      expect(capturedCreate!.meta!.cwd).toBe(ws); // 会话仍在链工作空间
      const state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('running'); // 未 block，正常调度
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(ws, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
  });
});
