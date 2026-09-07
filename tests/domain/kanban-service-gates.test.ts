import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEventStore } from '../../src/domain/event-store.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import type { Handoff } from '../../src/domain/types.js';

// P1 实测闸（Task 4）：completeTask 内嵌 gateHook（装配层注入；**human 无豁免**，2026-09-02 决议）。
// hook ok=false → 拒绝完成（卡留 running）+ task/gate-failed；ok=true → task/gate-passed 后正常完成；
// hook 返回 null / 未注入 → 零感知（无 gate 事件，向后兼容行为不变）。

/** 构造 service + 一张 d/execute running 卡（构造方式与 kanban-service.test.ts 一致）。 */
async function freshWithDTask() {
  const dir = mkdtempSync(join(tmpdir(), 'kanban-gates-'));
  const svc = new KanbanService(new FileEventStore(dir));
  const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
  const d = await svc.createTask({ chainId: chain.id, title: 'd', assignee: 'd', mode: 'execute' }, 'v');
  await svc.claimTask(d.id, 'system');
  return { svc, dir, taskId: d.id };
}

/** D(execute) 非 human 完成所需完整证据（过 C2 产物证据闸 + TDD 声明闸）。 */
function handoffWithTdd(): Handoff {
  return {
    summary: 'impl',
    metadata: { changed_files: ['a.ts'], commit_hash: 'deadbeef', push: true, tdd: { test_files: ['a.test.ts'], test_first: true } },
    completedAt: Date.now(),
  };
}

const gateKindsOf = async (svc: KanbanService) =>
  (await svc.snapshot()).events.filter((e) => e.kind.startsWith('task/gate')).map((e) => e.kind);

describe('completeTask gateHook（实测闸）', () => {
  it('hook ok:false → throw + 卡留 running + task/gate-failed 事件（无 task/completed）', async () => {
    const { svc, dir, taskId } = await freshWithDTask();
    try {
      const seen: string[] = [];
      svc.setGateHook(async (task) => { seen.push(task.id); return { ok: false, detail: '退出码 1' }; });
      await expect(svc.completeTask(taskId, handoffWithTdd(), 'd', { boundTaskId: taskId }))
        .rejects.toThrow(/gate failed/);
      expect(seen).toEqual([taskId]); // hook 收到当前任务
      const state = await svc.snapshot();
      expect(state.tasks.get(taskId)!.status).toBe('running'); // 卡不被完成
      expect(state.events.filter((e) => e.kind === 'task/completed' && e.taskId === taskId)).toHaveLength(0);
      expect(await gateKindsOf(svc)).toEqual(['task/gate-failed']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('hook ok:true → task/gate-passed + task/completed 正常落，卡 done', async () => {
    const { svc, dir, taskId } = await freshWithDTask();
    try {
      svc.setGateHook(async () => ({ ok: true, detail: 'exit 0' }));
      const done = await svc.completeTask(taskId, handoffWithTdd(), 'd', { boundTaskId: taskId });
      expect(done.status).toBe('done');
      const kinds = (await svc.snapshot()).events.filter((e) => e.taskId === taskId).map((e) => e.kind);
      expect(kinds).toContain('task/gate-passed');
      expect(kinds).toContain('task/completed');
      expect(kinds.indexOf('task/gate-passed')).toBeLessThan(kinds.indexOf('task/completed')); // gate 先于 completed
      expect(await gateKindsOf(svc)).toEqual(['task/gate-passed']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('hook 返回 null → 无 gate 事件（向后兼容零感知）', async () => {
    const { svc, dir, taskId } = await freshWithDTask();
    try {
      let calls = 0;
      svc.setGateHook(async () => { calls += 1; return null; });
      const done = await svc.completeTask(taskId, handoffWithTdd(), 'd', { boundTaskId: taskId });
      expect(done.status).toBe('done');
      expect(calls).toBe(1);
      expect(await gateKindsOf(svc)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('hook 未注入（null）→ 行为不变、无 gate 事件', async () => {
    const { svc, dir, taskId } = await freshWithDTask();
    try {
      const done = await svc.completeTask(taskId, handoffWithTdd(), 'd', { boundTaskId: taskId });
      expect(done.status).toBe('done');
      expect(await gateKindsOf(svc)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('actor=human 同样触发 hook（无豁免，2026-09-02 决议）', async () => {
    const { svc, dir, taskId } = await freshWithDTask();
    try {
      let calls = 0;
      svc.setGateHook(async () => { calls += 1; return { ok: true, detail: 'exit 0' }; });
      // human 信任锚可豁免 C2/TDD 声明闸，但实测闸无豁免：hook 仍被调用
      const done = await svc.completeTask(taskId, { summary: 'impl', metadata: {}, completedAt: Date.now() }, 'human');
      expect(done.status).toBe('done');
      expect(calls).toBe(1);
      expect(await gateKindsOf(svc)).toEqual(['task/gate-passed']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
