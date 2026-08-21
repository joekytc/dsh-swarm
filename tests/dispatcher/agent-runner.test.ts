import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../../src/dispatcher/agent-runner.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

type FakeAgent = { followup: ReturnType<typeof vi.fn>; whenIdle: ReturnType<typeof vi.fn>; session: { events: unknown[] } };

/** 假角色 agent（capturingFake）：在 fakeCreate 基础上捕获 followup 上下文文本（供 buildContext 断言）。
 *  completes=true 时真实调用 svc.completeTask（模拟经 kanban_complete 工具）。 */
function capturingFake(opts: { completes: boolean; svc: KanbanService; taskId: string; actor?: string; metadata?: Record<string, unknown>; capture: (text: string) => void }): (o: unknown) => Promise<{ agent: FakeAgent }> {
  return async () => {
    const events: unknown[] = [];
    const pending: Promise<void>[] = [];
    const followup = vi.fn((msg: unknown) => {
      const text = (msg as { content?: Array<{ type: string; text: string }> })?.content?.[0]?.text ?? '';
      opts.capture(text);
      pending.push((async () => {
        if (opts.completes) {
          events.push({ type: 'tool-call', name: 'kanban_complete' });
          await opts.svc.completeTask(opts.taskId, { summary: 'ok', metadata: opts.metadata ?? {}, completedAt: Date.now() }, (opts.actor ?? 'w') as never, { boundTaskId: opts.taskId });
        } else {
          events.push({ type: 'assistant', text: 'ok done' });
        }
      })());
    });
    const whenIdle = vi.fn(async () => { await Promise.all(pending); });
    return { agent: { followup, whenIdle, session: { events } } };
  };
}

/** D(execute) goal-mode 测试假 agent：仅捕获 followup 上下文文本；session.events 标记 kanban_complete
 *  以免协议违规护栏（runTask 仅判 used），不真实完成（不触发 D 交付证据闸）。 */
function dGoalFake(capture: (text: string) => void): (o: unknown) => Promise<{ agent: FakeAgent }> {
  return async () => {
    const followup = vi.fn((msg: unknown) => {
      const text = (msg as { content?: Array<{ type: string; text: string }> })?.content?.[0]?.text ?? '';
      capture(text);
    });
    const whenIdle = vi.fn(async () => {});
    return { agent: { followup, whenIdle, session: { events: [{ type: 'tool-call', name: 'kanban_complete' }] } } };
  };
}

/** 假角色 agent：completes=true 时真实调用 svc.completeTask（模拟经 kanban_complete 工具），
 *  并在会话事件中记录工具调用（供协议违规检测）。 */
function fakeCreate(opts: { completes: boolean; svc: KanbanService; taskId: string; metadata?: Record<string, unknown> }): (o: unknown) => Promise<{ agent: FakeAgent }> {
  return async () => {
    const events: unknown[] = [];
    const pending: Promise<void>[] = [];
    const followup = vi.fn(() => {
      pending.push((async () => {
        if (opts.completes) {
          events.push({ type: 'tool-call', name: 'kanban_complete' });
          await opts.svc.completeTask(opts.taskId, { summary: 'ok', metadata: opts.metadata ?? {}, completedAt: Date.now() }, 'w', { boundTaskId: opts.taskId });
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
      const runner = new AgentRunner(fakeCtx({ create: fakeCreate({ completes: true, svc, taskId: t.id, metadata: { ref: '/ws' } }) }) as never, svc, {} as never, {} as unknown as WikiVaultClient);
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
        resume: async (o: unknown) => { calls.push('resume'); return fakeCreate({ completes: true, svc, taskId: t.id, metadata: { ref: '/ws' } })(o); },
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

  it('resume after protocol violation injects review guidance (block reason + recent comments)', async () => {
    const { svc, dir, t } = await setupTask(false); // 首次：idle 无 complete → blocked(protocol_violation)
    try {
      await new AgentRunner(fakeCtx({ create: fakeCreate({ completes: false, svc, taskId: t.id }) }) as never, svc, {} as never, {} as unknown as WikiVaultClient).runTask(t.id);
      let state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('blocked');
      // 阻塞后：V 发 [blocked-review] 指导评论 + human 评论给方向
      await svc.comment(t.id, '[blocked-review] 请补充 W1-pre 仓库事实并调用 kanban_complete', 'v');
      await svc.comment(t.id, 'human: 按 V 意见补充后 complete', 'human');
      await svc.unblockTask(t.id, 'human');
      state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('ready');
      // 第二次 resume：捕获上下文断言含 Review guidance
      const captured: string[] = [];
      const agents = {
        resume: capturingFake({ completes: true, svc, taskId: t.id, metadata: { ref: '/ws' }, capture: (text) => captured.push(text) }),
      };
      await new AgentRunner(fakeCtx(agents) as never, svc, {} as never, {} as unknown as WikiVaultClient).runTask(t.id);
      const ctxText = captured.join('\n');
      expect(ctxText).toContain('## Review guidance (blocked task resume)');
      expect(ctxText).toContain('protocol_violation'); // 最近阻塞原因
      expect(ctxText).toContain('[blocked-review] 请补充 W1-pre'); // 阻塞后 V 评论
      expect(ctxText).toContain('human: 按 V 意见补充'); // human 评论
      state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('done');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rework task context injects review-failed issues and direction', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-rework-'));
    try {
      const store = new FileEventStore(dir);
      const svc = new KanbanService(store);
      // 手工构造事件日志：done P 任务 → review/failed（issues）→ P 返工卡（reworkOfTaskId/resumeSessionId/reviewAttempt）
      await store.append({ chainId: 'ch_1', taskId: null, kind: 'chain/created', payload: { id: 'ch_1', title: 'c', status: 'planning', rootTaskId: null, specCardId: null, ownerSessionId: 's', workspaceDir: null, createdAt: 1 }, author: 'human', at: 1 });
      await store.append({ chainId: 'ch_1', taskId: 't_p', kind: 'task/created', payload: { id: 't_p', chainId: 'ch_1', title: 'p', body: '', assignee: 'p', status: 'ready', mode: 'openspec', priority: 1, parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [], sessionId: 'kbn-t_p', reworkOfTaskId: null, resumeSessionId: null, reviewAttempt: 0, reviewStatus: 'passed' }, author: 'v', at: 2 });
      await store.append({ chainId: 'ch_1', taskId: 't_p', kind: 'task/claimed', payload: {}, author: 'system', at: 3 });
      await store.append({ chainId: 'ch_1', taskId: 't_p', kind: 'task/completed', payload: { summary: 'plan', metadata: { artifacts_path: '/ws/plan.md' }, completedAt: 4 }, author: 'p', at: 4 });
      await store.append({ chainId: 'ch_1', taskId: 't_pt', kind: 'review/failed', payload: { targetTaskId: 't_p', evidence: { verdict: 'fail', issues: [{ severity: 'high', title: 'missing tests', detail: 'no test plan', resolved: false }, { severity: 'medium', title: 'vague solution', detail: 'steps unclear', resolved: false }] } }, author: 'system', at: 5 });
      await store.append({ chainId: 'ch_1', taskId: 't_p2', kind: 'task/created', payload: { id: 't_p2', chainId: 'ch_1', title: 'p-rework', body: '', assignee: 'p', status: 'todo', mode: 'openspec', priority: 1, parents: ['t_p'], children: [], createdBy: 'system', attempts: 0, heartbeats: [], sessionId: 'kbn-t_p2', reworkOfTaskId: 't_p', resumeSessionId: 'kbn-t_p', reviewAttempt: 1, reviewStatus: 'pending' }, author: 'system', at: 6 });
      const captured: string[] = [];
      const runner = new AgentRunner(fakeCtx({ create: capturingFake({ completes: true, svc, taskId: 't_p2', actor: 'p', metadata: { artifacts_path: '/ws/plan.md' }, capture: (text) => captured.push(text) }) }) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask('t_p2');
      const ctxText = captured.join('\n');
      expect(ctxText).toContain('## Review guidance (rework task)');
      expect(ctxText).toContain('t_p'); // 上游任务
      expect(ctxText).toContain('[high] missing tests'); // review/failed issues 摘要
      expect(ctxText).toContain('[medium] vague solution');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('protocol violation guardrail: blocks gave_up after maxProtocolViolations review cycles (no recovery)', async () => {
    const { svc, dir, t } = await setupTask(false); // 假 agent 不调 complete → 协议违规
    try {
      const cfg = { dispatcher: { maxProtocolViolations: 2 } };
      const idle = () => fakeCreate({ completes: false, svc, taskId: t.id });
      // 违规 1/2：可恢复（protocol_violation），解除后 resume 同会话
      let runner = new AgentRunner(fakeCtx({ create: idle() }) as never, svc, cfg as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      let state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('blocked');
      expect(state.events.filter((e) => e.taskId === t.id && e.kind === 'task/blocked').map((e) => String(e.payload['reason']))[0]).toContain('protocol_violation');
      await svc.unblockTask(t.id, 'human');
      // 违规 2/2：仍可恢复（protocol_violation）
      runner = new AgentRunner(fakeCtx({ resume: idle() }) as never, svc, cfg as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('blocked');
      const reasons = state.events.filter((e) => e.taskId === t.id && e.kind === 'task/blocked').map((e) => String(e.payload['reason']));
      expect(reasons[1]).toContain('protocol_violation');
      await svc.unblockTask(t.id, 'human');
      // 违规 3（≥ max=2 后的下一次）：不再恢复 → gave_up + [blocked-final] 证据链
      runner = new AgentRunner(fakeCtx({ resume: idle() }) as never, svc, cfg as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      state = await svc.snapshot();
      const finalReason = state.events.filter((e) => e.taskId === t.id && e.kind === 'task/blocked').map((e) => String(e.payload['reason'])).at(-1)!;
      expect(finalReason).toContain('gave_up');
      // attempts 不递增（协议违规不计入失败重试）
      expect(state.tasks.get(t.id)!.attempts).toBe(0);
      // [blocked-final] 证据链评论：block 时间线 + 复核/评论时间线 + 最终 reason
      const comments = state.events.filter((e) => e.taskId === t.id && e.kind === 'task/commented').map((e) => String(e.payload['body']));
      const finalComment = comments.find((c) => c.startsWith('[blocked-final]'));
      expect(finalComment).toBeDefined();
      expect(finalComment!).toContain('## block 时间线');
      expect(finalComment!).toContain('## 复核/评论时间线');
      expect(finalComment!).toContain('gave_up');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('protocol violation applies to pt/dt roles uniformly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-pvd-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const pt = await svc.createTask({ chainId: chain.id, title: 'pt', assignee: 'pt', mode: 'review-plan' }, 'v');
      const dt = await svc.createTask({ chainId: chain.id, title: 'dt', assignee: 'dt', mode: 'review-impl' }, 'v');
      const idlePt = () => fakeCreate({ completes: false, svc, taskId: pt.id });
      const idleDt = () => fakeCreate({ completes: false, svc, taskId: dt.id });
      const cfg = { dispatcher: { maxProtocolViolations: 2 } };
      // pt：idle 无 complete/block → blocked(protocol_violation)
      await new AgentRunner(fakeCtx({ create: idlePt() }) as never, svc, cfg as never, {} as unknown as WikiVaultClient).runTask(pt.id);
      // dt：同上
      await new AgentRunner(fakeCtx({ create: idleDt() }) as never, svc, cfg as never, {} as unknown as WikiVaultClient).runTask(dt.id);
      const state = await svc.snapshot();
      expect(state.tasks.get(pt.id)!.status).toBe('blocked');
      expect(state.tasks.get(dt.id)!.status).toBe('blocked');
      const ptBlock = state.events.find((e) => e.taskId === pt.id && e.kind === 'task/blocked');
      const dtBlock = state.events.find((e) => e.taskId === dt.id && e.kind === 'task/blocked');
      expect(String(ptBlock!.payload['reason'])).toContain('protocol_violation');
      expect(String(dtBlock!.payload['reason'])).toContain('protocol_violation');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('model fallback is silent to user but recorded in evidence', async () => {
    const { svc, dir, t } = await setupTask(true);
    try {
      // 主模型 ark/deepseek-v4-flash create 抛 model unavailable → 静默切 fallback openai/gpt-5.6-sol
      const calls: Array<{ provider?: string; model?: string }> = [];
      const agents = {
        create: async (o: { agentOptions?: { provider?: string; model?: string } }) => {
          calls.push({ provider: o.agentOptions?.provider, model: o.agentOptions?.model });
          if (calls.length === 1) throw new Error('model unavailable: ark/deepseek-v4-flash');
          return { agent: { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [{ type: 'tool-call', name: 'kanban_complete' }] } } };
        },
      };
      const cfg = { roles: { models: { w: { provider: 'ark', model: 'deepseek-v4-flash', fallbacks: [{ provider: 'openai', model: 'gpt-5.6-sol' }] } } }, dispatcher: {} };
      const runner = new AgentRunner(fakeCtx(agents) as never, svc, cfg as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      expect(calls).toEqual([
        { provider: 'ark', model: 'deepseek-v4-flash' },
        { provider: 'openai', model: 'gpt-5.6-sol' },
      ]);
      // 任务正常完成（fallback 切换不弹用户、不 block）
      const state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('running');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('all model candidates unavailable blocks model-unavailable', async () => {
    const { svc, dir, t } = await setupTask(true);
    try {
      const agents = {
        create: async () => { throw new Error('model unavailable: ark/deepseek-v4-flash'); },
      };
      const cfg = { roles: { models: { w: { provider: 'ark', model: 'deepseek-v4-flash', fallbacks: [{ provider: 'openai', model: 'gpt-5.6-sol' }] } } }, dispatcher: {} };
      const runner = new AgentRunner(fakeCtx(agents) as never, svc, cfg as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      const state = await svc.snapshot();
      // 全部候选不可用 → block(model-unavailable) 抛给用户（不是 failed 重试）
      expect(state.tasks.get(t.id)!.status).toBe('blocked');
      const blockEv = state.events.find((e) => e.taskId === t.id && e.kind === 'task/blocked');
      expect(String(blockEv!.payload['reason'])).toContain('model-unavailable');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('D(execute) goal mode: spec/testing contains /goal → context includes ## Goal mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-goal1-'));
    const ws = mkdtempSync(join(tmpdir(), 'runner-goal1-ws-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: ws }, 'human');
      // testing 段含 "/goal" 关键词（spec FR6 目标模式触发条件）
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: '按 /goal 目标模式执行', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'execute' }, 'v');
      const captured: string[] = [];
      const runner = new AgentRunner(fakeCtx({ create: dGoalFake((text) => captured.push(text)) }) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      expect(captured.join('\n')).toContain('## Goal mode');
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(ws, { recursive: true, force: true }); }
  });

  it('D(execute) goal mode: no keyword → context omits ## Goal mode (default path unchanged)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-goal2-'));
    const ws = mkdtempSync(join(tmpdir(), 'runner-goal2-ws-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: ws }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'execute' }, 'v');
      const captured: string[] = [];
      const runner = new AgentRunner(fakeCtx({ create: dGoalFake((text) => captured.push(text)) }) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      expect(captured.join('\n')).not.toContain('## Goal mode');
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(ws, { recursive: true, force: true }); }
  });

  it('D(execute) goal mode: parent handoff summary contains 目标模式 → context includes ## Goal mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-goal3-'));
    const ws = mkdtempSync(join(tmpdir(), 'runner-goal3-ws-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: ws }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      // 父任务（W1-pre）完成交接，summary 命中中文关键词「目标模式」
      const w1 = await svc.createTask({ chainId: chain.id, title: 'w1', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1.id, 'system');
      await svc.completeTask(w1.id, { summary: '仓库事实；父交接要求 目标模式 推进', metadata: { ref: '/ws' }, completedAt: Date.now() }, 'w', { boundTaskId: w1.id });
      const t = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'execute', parents: [w1.id] }, 'v');
      const captured: string[] = [];
      const runner = new AgentRunner(fakeCtx({ create: dGoalFake((text) => captured.push(text)) }) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      const ctxText = captured.join('\n');
      expect(ctxText).toContain('## Parent task results'); // 父交接注入仍在
      expect(ctxText).toContain('## Goal mode'); // 关键词命中 → 注入目标模式指令
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(ws, { recursive: true, force: true }); }
  });
});
