import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEventStore } from '../../src/domain/event-store.js';
import { KanbanService } from '../../src/domain/kanban-service.js';

async function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'kanban-svc-'));
  const svc = new KanbanService(new FileEventStore(dir));
  return { svc, dir };
}

describe('KanbanService', () => {
  it('creates chain and approves spec card then executes task flow', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's_1' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      // 阶段 0：w1-pre（file）
      const w1 = await svc.createTask({ chainId: chain.id, title: 'w1-pre', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1.id, 'system');
      await svc.completeTask(w1.id, { summary: 'repo facts', metadata: { ref: '/ws/w1' }, completedAt: Date.now() }, 'w', { boundTaskId: w1.id });
      // 中间阶段完成（P done，W2 尚未创建）不得误收链
      let state = await svc.snapshot();
      expect(state.chains.get(chain.id)!.status).toBe('executing');
      const p = await svc.createTask({ chainId: chain.id, title: 'p', assignee: 'p', mode: 'openspec', parents: [w1.id] }, 'v');
      await svc.claimTask(p.id, 'system');
      await svc.completeTask(p.id, { summary: 'plan', metadata: { artifacts_path: '/ws/plan.md' }, completedAt: Date.now() }, 'p', { boundTaskId: p.id });
      state = await svc.snapshot();
      expect(state.chains.get(chain.id)!.status).toBe('executing');
      const w2 = await svc.createTask({ chainId: chain.id, title: 'w2', assignee: 'w', mode: 'kb', parents: [p.id] }, 'v');
      await svc.claimTask(w2.id, 'system');
      await svc.completeTask(w2.id, { summary: 'synced', metadata: { kb_url: 'http://x/1' }, completedAt: Date.now() }, 'w', { boundTaskId: w2.id });
      const d = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'execute', parents: [w2.id] }, 'v');
      await svc.claimTask(d.id, 'system');
      // R20 D=执行者：完成必须带 git 产物证据（changed_files + commit_hash/push）
      await svc.completeTask(d.id, { summary: 'impl', metadata: { changed_files: ['a.ts'], commit_hash: 'deadbeef', push: true }, completedAt: Date.now() }, 'd', { boundTaskId: d.id });
      // W2 done（w/kb 无 D 父）不触发收链
      state = await svc.snapshot();
      expect(state.chains.get(chain.id)!.status).toBe('executing');
      const w3 = await svc.createTask({ chainId: chain.id, title: 'w3', assignee: 'w', mode: 'kb', parents: [d.id] }, 'v');
      await svc.claimTask(w3.id, 'system');
      const done = await svc.completeTask(w3.id, { summary: 'synced', metadata: { kb_url: 'http://x/2' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      expect(done.status).toBe('done');
      state = await svc.snapshot();
      // P0-3：W3 done 且无未终态任务 → 链完成机械规则自动推进 chain/completed
      expect(state.chains.get(chain.id)!.status).toBe('completed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('C2: D(execute) complete without delivery evidence is rejected (non-human)', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const d = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'execute' }, 'v');
      await svc.claimTask(d.id, 'system');
      // 无 changed_files / commit_hash / push → 拒绝完成
      await expect(svc.completeTask(d.id, { summary: 'impl', metadata: {}, completedAt: Date.now() }, 'd', { boundTaskId: d.id })).rejects.toThrow(/delivery evidence/);
      await expect(svc.completeTask(d.id, { summary: 'impl', metadata: { changed_files: ['a.ts'] }, completedAt: Date.now() }, 'd', { boundTaskId: d.id })).rejects.toThrow(/delivery evidence/);
      // 只有 commit 而无 changed_files 也拒
      await expect(svc.completeTask(d.id, { summary: 'impl', metadata: { commit_hash: 'x', push: true }, completedAt: Date.now() }, 'd', { boundTaskId: d.id })).rejects.toThrow(/delivery evidence/);
      // 证据齐全（changed_files + push）→ 通过
      const done = await svc.completeTask(d.id, { summary: 'impl', metadata: { changed_files: ['a.ts'], push: true }, completedAt: Date.now() }, 'd', { boundTaskId: d.id });
      expect(done.status).toBe('done');
      // human 信任锚可豁免 C2（GUI 强制收尾）
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('C1: chain does not complete when D(execute) lacks delivery evidence even after W3 done', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const w1 = await svc.createTask({ chainId: chain.id, title: 'w1', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1.id, 'system');
      await svc.completeTask(w1.id, { summary: 'facts', metadata: { ref: '/ws' }, completedAt: Date.now() }, 'w', { boundTaskId: w1.id });
      const p = await svc.createTask({ chainId: chain.id, title: 'p', assignee: 'p', mode: 'openspec', parents: [w1.id] }, 'v');
      await svc.claimTask(p.id, 'system');
      await svc.completeTask(p.id, { summary: 'plan', metadata: {}, completedAt: Date.now() }, 'p', { boundTaskId: p.id });
      const w2 = await svc.createTask({ chainId: chain.id, title: 'w2', assignee: 'w', mode: 'kb', parents: [p.id] }, 'v');
      await svc.claimTask(w2.id, 'system');
      await svc.completeTask(w2.id, { summary: 'sync', metadata: { kb_url: 'http://x' }, completedAt: Date.now() }, 'w', { boundTaskId: w2.id });
      // D(execute) 由 human 强制收尾且无 commit/push 证据（信任锚豁免 C2，但 C1 机械门禁必须拦截）
      const d = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'execute', parents: [w2.id] }, 'v');
      await svc.claimTask(d.id, 'system');
      await svc.completeTask(d.id, { summary: 'impl', metadata: { changed_files: ['a.ts'] }, completedAt: Date.now() }, 'human');
      const w3 = await svc.createTask({ chainId: chain.id, title: 'w3', assignee: 'w', mode: 'kb', parents: [d.id] }, 'v');
      await svc.claimTask(w3.id, 'system');
      await svc.completeTask(w3.id, { summary: 'sync', metadata: { kb_url: 'http://y' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      const state = await svc.snapshot();
      // 无 commit_hash/push 证据 → 链保持 executing，不判 completed（防漂移被掩盖）
      expect(state.chains.get(chain.id)!.status).toBe('executing');
      // 全链任务均已终态，但 D 证据缺失 → 仍不收链
      expect([...state.tasks.values()].filter((x) => x.status !== 'done' && x.status !== 'archived')).toHaveLength(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('M2(Q5): createChain persists workspaceDir and survives replay projection', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: '/Users/jc/Documents/dsh-dashboard' }, 'human');
      let state = await svc.snapshot();
      expect(state.chains.get(chain.id)!.workspaceDir).toBe('/Users/jc/Documents/dsh-dashboard');
      // 重放：旧事件无 workspaceDir → 归一化为 null，新事件保留
      const svc2 = new KanbanService(new FileEventStore(dir));
      state = await svc2.snapshot();
      expect(state.chains.get(chain.id)!.workspaceDir).toBe('/Users/jc/Documents/dsh-dashboard');
      const chainNoWs = await svc.createChain({ title: 'c2', ownerSessionId: 's' }, 'human');
      expect((await svc.snapshot()).chains.get(chainNoWs.id)!.workspaceDir).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects unauthorized create', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's_1' }, 'human');
      await expect(svc.createTask({ chainId: chain.id, title: 'x', assignee: 'd', mode: 'align' }, 'p')).rejects.toThrow(/denied/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects complete without summary', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's_1' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'w', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(t.id, 'system');
      await expect(svc.completeTask(t.id, { summary: '', metadata: {}, completedAt: 0 }, 'w', { boundTaskId: t.id })).rejects.toThrow(/summary/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not persist an illegal transition', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's_1' }, 'human');
      const task = await svc.createTask({ chainId: chain.id, title: 'w', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(task.id, 'system');
      await svc.completeTask(task.id, { summary: 'done', metadata: {}, completedAt: Date.now() }, 'w', { boundTaskId: task.id });

      await expect(svc.unblockTask(task.id, 'human')).rejects.toThrow(/illegal transition/);

      const events = new FileEventStore(dir).readAllSync();
      expect(events.at(-1)?.kind).toBe('task/completed');
      expect(() => new KanbanService(new FileEventStore(dir))).not.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('publishes persisted events in seq order and disposes subscriptions', async () => {
    const { svc, dir } = await fresh();
    try {
      const seen: number[] = [];
      const stop = svc.subscribe((event) => seen.push(event.seq));
      const chain = await svc.createChain({ title: 'ui', ownerSessionId: 's' }, 'human');
      await svc.createTask({ chainId: chain.id, title: 'prefetch', assignee: 'w', mode: 'file' }, 'v');
      expect(seen).toEqual([0, 1, 2]);
      stop();
      await svc.createSpecCard(chain.id, {
        problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: ['d'], testing: 't', out_of_scope: 'o',
      }, 'human');
      expect(seen).toEqual([0, 1, 2]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('keeps the committed transition when one listener throws', async () => {
    const { svc, dir } = await fresh();
    try {
      svc.subscribe(() => { throw new Error('listener failed'); });
      const chain = await svc.createChain({ title: 'safe', ownerSessionId: 's' }, 'human');
      expect((await svc.snapshot()).chains.has(chain.id)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });


  it('chain completion with audit hook: emits chain/audit-warning then chain/audit-confirmed, chain stays completed', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'audit', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const d = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'align' }, 'v');
      await svc.claimTask(d.id, 'system');
      await svc.completeTask(d.id, { summary: 'impl', metadata: { changed_files: ['a.ts'] }, completedAt: Date.now() }, 'd', { boundTaskId: d.id });
      const w3 = await svc.createTask({ chainId: chain.id, title: 'w3', assignee: 'w', mode: 'kb', parents: [d.id] }, 'v');
      await svc.claimTask(w3.id, 'system');
      // 链完成核对钩子：发现主会话越权写 → auditWarning
      svc.setOnChainCompleted(async (cid) => {
        if (cid === chain.id) {
          await svc.auditWarning(cid, [{ source: 'main-session-scan', detail: 'main wrote workspaces/x', paths: ['/storages/kanban/workspaces/x'] }], 'system');
        }
      });
      await svc.completeTask(w3.id, { summary: 'synced', metadata: { kb_url: 'http://x' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      let state = await svc.snapshot();
      expect(state.chains.get(chain.id)!.status).toBe('completed'); // audit 不改 Chain 状态
      const warn = state.events.find((e) => e.kind === 'chain/audit-warning');
      expect(warn).toBeTruthy();
      expect(state.auditWarnings.get(chain.id)!.confirmedAt).toBeNull();
      // 用户确认 → chain/audit-confirmed，放行
      await svc.confirmAudit(chain.id, 'human');
      state = await svc.snapshot();
      const conf = state.events.find((e) => e.kind === 'chain/audit-confirmed');
      expect(conf).toBeTruthy();
      expect(state.auditWarnings.get(chain.id)!.confirmedAt).toBeTruthy();
      expect(state.chains.get(chain.id)!.status).toBe('completed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('auditWarning only by system; confirmAudit only by human; confirm without warning rejected', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'audit2', ownerSessionId: 's' }, 'human');
      await expect(svc.auditWarning(chain.id, [{ source: 'x', detail: 'x', paths: [] }], 'human')).rejects.toThrow(/permission/);
      await expect(svc.confirmAudit(chain.id, 'v')).rejects.toThrow(/permission/);
      await expect(svc.confirmAudit(chain.id, 'human')).rejects.toThrow(/no audit warning|no warning/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('replay rebuilds auditWarnings projection (audit events do not touch chain status)', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'audit3', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const d = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'align' }, 'v');
      await svc.claimTask(d.id, 'system');
      await svc.completeTask(d.id, { summary: 'impl', metadata: {}, completedAt: Date.now() }, 'd', { boundTaskId: d.id });
      const w3 = await svc.createTask({ chainId: chain.id, title: 'w3', assignee: 'w', mode: 'kb', parents: [d.id] }, 'v');
      await svc.claimTask(w3.id, 'system');
      await svc.completeTask(w3.id, { summary: 'synced', metadata: { kb_url: 'http://x' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      await svc.auditWarning(chain.id, [{ source: 's', detail: 'd', paths: ['p'] }], 'system');
      // 重放：新服务实例从事件日志重建投影
      const svc2 = new KanbanService(new FileEventStore(dir));
      const state = await svc2.snapshot();
      expect(state.chains.get(chain.id)!.status).toBe('completed');
      expect(state.auditWarnings.get(chain.id)!.evidence[0].detail).toBe('d');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reads catch-up events from an inclusive seq', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'catch-up', ownerSessionId: 's' }, 'human');
      await svc.createTask({ chainId: chain.id, title: 't', assignee: 'w', mode: 'file' }, 'v');
      expect((await svc.eventsSince(1)).map((event) => event.seq)).toEqual([1, 2]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
