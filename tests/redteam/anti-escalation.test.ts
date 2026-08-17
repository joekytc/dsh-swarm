import { describe, it, expect } from 'vitest';
import { can } from '../../src/domain/permissions.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '../../src/domain/types.js';

const task: Task = { id: 't_1', chainId: 'ch_1', title: 'x', body: '', assignee: 'w', status: 'running', mode: 'kb', priority: 1, parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [] };

describe('anti-escalation red team', () => {
  it('D cannot write wiki', () => expect(can('wiki-write', 'd', task)).toBe(false));
  it('P cannot create tasks', () => expect(can('create-task', 'p', null)).toBe(false));
  it('human create goes through route/GUI (domain permits, tool surface excludes)', () => {
    // P1-5 修正：领域权限 human=true（GUI/前缀路由建卡路径）；工具面不注册 kanban_create 由 T15 角色装配保证
    expect(can('create-task', 'human', null)).toBe(true);
  });
  it('agent cannot complete a task its session is not bound to (cross-task escalation)', () => {
    // P1-4：W agent 会话绑定 t_1，complete 链上另一 W 任务（assignee 同为 w）→ 拒
    const otherW: Task = { ...task, id: 't_2', assignee: 'w' };
    expect(can('complete', 'w', otherW, { boundTaskId: 't_1' })).toBe(false);
    expect(can('complete', 'w', task, { boundTaskId: 't_1' })).toBe(true);
  });
  it('human may force complete via GUI (trust anchor), agents still need binding', () => {
    // T27：human 为信任锚，GUI 强制收尾允许；角色 agent 无 boundTaskId 时仍拒
    expect(can('complete', 'human', task)).toBe(true);
    expect(can('complete', 'w', task)).toBe(false);
  });
  it('V cannot approve spec cards', () => expect(can('spec-approve', 'v', null)).toBe(false));
  it('store rejects seq regression', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-'));
    try {
      const store = new FileEventStore(dir);
      await store.append({ chainId: 'ch', taskId: null, kind: 'chain/created', payload: {}, author: 'v', at: 1 });
      await store.append({ chainId: 'ch', taskId: null, kind: 'chain/created', payload: {}, author: 'v', at: 2 });
      const evs = await store.readAll();
      expect(evs.map((e) => e.seq)).toEqual([0, 1]); // 单调，无回退
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('主 agent 越权写工作区产物 → 链完成后发 chain/audit-warning；用户确认后 chain/audit-confirmed 放行', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-audit-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'escalation', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const d = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'align' }, 'v');
      await svc.claimTask(d.id, 'system');
      await svc.completeTask(d.id, { summary: 'impl', metadata: { changed_files: ['a.ts'] }, completedAt: Date.now() }, 'd', { boundTaskId: d.id });
      const w3 = await svc.createTask({ chainId: chain.id, title: 'w3', assignee: 'w', mode: 'kb', parents: [d.id] }, 'v');
      await svc.claimTask(w3.id, 'system');
      await svc.completeTask(w3.id, { summary: 'synced', metadata: { kb_url: 'http://x' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      // 核对发现主会话（非 kbn- 会话）对 workspaces/ 的写
      await svc.auditWarning(chain.id, [{ source: 'main-session-scan', detail: 'main session wrote under workspaces', paths: ['/s/kanban/workspaces/' + chain.id + '/leak.md'] }], 'system');
      const state = await svc.snapshot();
      expect(state.events.some((e) => e.kind === 'chain/audit-warning')).toBe(true);
      // 未确认前：auditWarnings 无 confirmedAt（UI 据此阻塞最终汇报）
      expect(state.auditWarnings.get(chain.id)!.confirmedAt).toBeNull();
      // 用户 GUI 确认后放行
      await svc.confirmAudit(chain.id, 'human');
      const s2 = await svc.snapshot();
      expect(s2.auditWarnings.get(chain.id)!.confirmedAt).toBeTruthy();
      expect(s2.events.some((e) => e.kind === 'chain/audit-confirmed')).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('projection rejects illegal transition injection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt2-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const store = (svc as unknown as { store: FileEventStore }).store;
      // 直接注入 task/completed 而无 task/created：回放应抛错
      await store.append({ chainId: 'ch', taskId: 't_x', kind: 'task/completed', payload: { summary: 'x' }, author: 'w', at: 1 } as never);
      await expect(svc.snapshot()).rejects.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
