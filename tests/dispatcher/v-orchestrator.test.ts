import { describe, it, expect, vi } from 'vitest';
import { VOrchestrator, type ChainOrchestration } from '../../src/dispatcher/v-orchestrator.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

/** 假 V agent：从注入上下文解析"下一步期望"，真实调用 svc.createTask 建卡（模拟 V 经 kanban_create 工具派单），
 *  并在会话事件中记录调用（供驱动校验）。resume 返回同一会话（事件日志共享，符合 V 会话延续语义）。 */
function fakeV(svc: KanbanService, chainId: string, failMode: 'none' | 'wrong-assignee' | 'no-create' | 'double-create') {
  const events: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const pending: Promise<void>[] = [];
  const followup = vi.fn((msg: { content: { text: string }[] }) => {
    pending.push((async () => {
      const text = msg.content.map((b) => b.text).join('\n');
      const m = text.match(/NEXT_TASK_ASSIGNEE=(\w+) MODE=(\w+)/);
      if (failMode === 'no-create' || !m) return;
      const expectAssignee = m[1];
      const mode = m[2];
      const assignee = failMode === 'wrong-assignee' ? (expectAssignee === 'w' ? 'd' : 'w') : expectAssignee;
      const task = await svc.createTask(
        { chainId, title: `phase-${mode}`, assignee: assignee as never, mode: mode as never },
        'v',
      );
      events.push({ name: 'kanban_create', arguments: { assignee, mode } });
      fakeV.lastCreated = { assignee, mode, taskId: task.id };
      if (failMode === 'double-create') {
        // R4：V 连发第二张卡（p/openspec）——驱动只按第一张匹配卡推进 phase
        const extra = await svc.createTask({ chainId, title: 'phase-extra', assignee: 'p', mode: 'openspec' }, 'v');
        events.push({ name: 'kanban_create', arguments: { assignee: 'p', mode: 'openspec' } });
        fakeV.lastCreated = { assignee: 'p', mode: 'openspec', taskId: extra.id };
      }
    })());
  });
  const whenIdle = vi.fn(async () => { await Promise.all(pending); });
  const agent = { followup, whenIdle, session: { events } };
  return {
    create: vi.fn(async (opts: { setup?: (c: never) => void }) => {
      opts.setup?.({} as never);
      return { agent };
    }),
    resume: vi.fn(async () => ({ agent })), // 同一 V 会话延续
  };
}
fakeV.lastCreated = { assignee: '', mode: '', taskId: '' };

async function freshChain() {
  const dir = mkdtempSync(join(tmpdir(), 'vorch-'));
  const svc = new KanbanService(new FileEventStore(dir));
  const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
  const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
  return { svc, dir, chain, card };
}

/** 完成看板中指定 assignee+mode 且未终态的任务（模拟角色 agent 执行完成）。 */
async function completeBy(svc: KanbanService, assignee: string, mode: string) {
  const t = [...(await svc.snapshot()).tasks.values()].find((x) => x.assignee === assignee && x.mode === mode && x.status !== 'done')!;
  await svc.claimTask(t.id, 'system');
  await svc.completeTask(t.id, { summary: 'done', metadata: {}, completedAt: 0 }, assignee as never, { boundTaskId: t.id });
  return t;
}

describe('VOrchestrator (R20 phase sequence)', () => {
  it('gates phase p on spec approval: w1-pre → draft wait → approved → p → w2 → d → w3', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      // w1-pre（阶段 0，planning 态允许建卡）
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated).toEqual({ assignee: 'w', mode: 'file', taskId: expect.any(String) });
      await completeBy(svc, 'w', 'file');
      // P1-2：w1-pre 完成后，wakeV 幂等挂载 file-prefetch 附件到规格卡（draft 态）
      await orch.wakeV(chain.id);
      const st1 = await svc.snapshot();
      const sc = st1.specCards.get(card.id)!;
      expect(sc.attachments.some((a) => a.kind === 'file-prefetch')).toBe(true);
      // B4：规格卡仍 draft → V 待命，不建 p 卡、phase 不推进（等 spec-card/approved 事件唤醒）
      expect(fakeV.lastCreated).toEqual({ assignee: 'w', mode: 'file', taskId: expect.any(String) });
      expect(orchMap.get(chain.id)!.phase).toBe('w1-supp');
      const stDraft = await svc.snapshot();
      expect([...stDraft.tasks.values()].filter((t) => t.assignee === 'p')).toHaveLength(0);
      // 规格卡 approved（链 executing）→ V 唤醒：跳过 w1-supp → 建 p/openspec
      await svc.approveSpecCard(card.id, 'human');
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated.assignee).toBe('p');
      expect(fakeV.lastCreated.mode).toBe('openspec');
      expect(orchMap.get(chain.id)!.phase).toBe('w2');
      // 后续阶段：V 每轮建卡后即推进 phase（生产上由 task/completed 事件串行唤醒，测试直接唤醒验证建卡序列）
      await completeBy(svc, 'p', 'openspec'); // p 先行完成（串行语义：下游阶段在其后）
      await orch.wakeV(chain.id);       // → w2（w/kb）
      expect(fakeV.lastCreated.assignee).toBe('w');
      expect(fakeV.lastCreated.mode).toBe('kb');
      await completeBy(svc, 'w', 'kb'); // w2 完成
      await orch.wakeV(chain.id);       // → d/align
      expect(fakeV.lastCreated.assignee).toBe('d');
      expect(fakeV.lastCreated.mode).toBe('align');
      await completeBy(svc, 'd', 'align');
      await orch.wakeV(chain.id);       // → w3（w/kb）
      expect(fakeV.lastCreated.assignee).toBe('w');
      expect(fakeV.lastCreated.mode).toBe('kb');
      await completeBy(svc, 'w', 'kb'); // w3 最后完成 → 链 executing 且无未终态任务 → completed
      const state = await svc.snapshot();
      expect(state.chains.get(chain.id)!.status).toBe('completed');
      await orch.wakeV(chain.id); // summary 阶段应无副作用
      expect(fakeV.lastCreated.mode).toBe('kb'); // 未再建卡（保持最后一次）
      // B3：create 与 resume 均传 setup 装配角色工具面
      expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({ setup: expect.any(Function) }));
      expect(agents.resume).toHaveBeenCalledWith(expect.objectContaining({ setup: expect.any(Function) }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('detects wrong-assignee creation and does not advance phase', async () => {
    const { svc, dir, chain } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'wrong-assignee');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      // V 建了错误 assignee（d/file 而非 w/file）→ 驱动校验失败，phase 不推进
      expect(orchMap.get(chain.id)!.phase).toBe('w1-pre');
      expect(fakeV.lastCreated.assignee).toBe('d');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('B6 idempotency: wakeV does not duplicate the expected in-flight card (restart recovery)', async () => {
    const { svc, dir, chain } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated.assignee).toBe('w');
      // 模拟重启恢复：phase 回到 w1-pre（建卡后未持久化），期望卡已存在且在途
      orchMap.set(chain.id, { chainId: chain.id, phase: 'w1-pre', sessionId: null, waitingOn: null });
      await orch.wakeV(chain.id);
      const state = await svc.snapshot();
      const w1pre = [...state.tasks.values()].filter((t) => t.assignee === 'w' && t.mode === 'file');
      expect(w1pre).toHaveLength(1); // 未重复建卡
      expect(agents.create).toHaveBeenCalledTimes(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('R4: only the first expected card advances phase; extra cards do not', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'double-create');
      const orchMap = new Map<string, ChainOrchestration>();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      await orch.wakeV(chain.id);
      // 连发 [w/file(匹配), p/openspec(多余)]：仅第一张匹配卡推进 phase 一次 → w1-supp
      expect(orchMap.get(chain.id)!.phase).toBe('w1-supp');
      // 完成 w/file 并挂附件（draft 态）
      await completeBy(svc, 'w', 'file');
      await orch.wakeV(chain.id);
      expect(orchMap.get(chain.id)!.phase).toBe('w1-supp');
      // 批准后：跳过 w1-supp → p；B6 见多余 p 卡在途 → 不重复建卡，待命
      await svc.approveSpecCard(card.id, 'human');
      await orch.wakeV(chain.id);
      const state = await svc.snapshot();
      const pCards = [...state.tasks.values()].filter((t) => t.assignee === 'p' && t.mode === 'openspec');
      expect(pCards).toHaveLength(1);
      expect(orchMap.get(chain.id)!.phase).toBe('p');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
