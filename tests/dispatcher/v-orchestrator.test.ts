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
function fakeV(svc: KanbanService, chainId: string, failMode: 'none' | 'wrong-assignee' | 'no-create') {
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

/** 完成看板中最近创建的任务（模拟角色 agent 执行完成）。 */
async function completeLatest(svc: KanbanService, assignee: string) {
  const tasks = [...(await svc.snapshot()).tasks.values()];
  const last = tasks[tasks.length - 1];
  await svc.claimTask(last.id, 'system');
  await svc.completeTask(last.id, { summary: 'done', metadata: {}, completedAt: 0 }, assignee as never, { boundTaskId: last.id });
  return last;
}

describe('VOrchestrator (R20 phase sequence)', () => {
  it('drives w1-pre → (skip w1-supp) → p → w2 → d → w3 phases in order', async () => {
    const { svc, dir, chain, card } = await freshChain();
    try {
      const agents = fakeV(svc, chain.id, 'none');
      const orchMap = new Map();
      const orch = new VOrchestrator(svc, agents as never, {} as never, orchMap, {} as unknown as WikiVaultClient);
      // w1-pre
      await orch.wakeV(chain.id);
      expect(fakeV.lastCreated).toEqual({ assignee: 'w', mode: 'file', taskId: expect.any(String) });
      await completeLatest(svc, 'w');
      // P1-2：w1-pre 完成后，wakeV 幂等挂载 file-prefetch 附件到规格卡（draft 态）
      await orch.wakeV(chain.id);
      const st1 = await svc.snapshot();
      const sc = st1.specCards.get(card.id)!;
      expect(sc.attachments.some((a) => a.kind === 'file-prefetch')).toBe(true);
      // w1-supp（规格卡已覆盖 → 驱动跳过）→ p（假 V 本轮建 p/openspec）
      expect(fakeV.lastCreated.assignee).toBe('p');
      expect(fakeV.lastCreated.mode).toBe('openspec');
      await completeLatest(svc, 'p');
      // w2 → d（链 planning 态下机械规则不提前触发）
      for (const [assignee, mode] of [['w', 'kb'], ['d', 'align']] as Array<[string, string]>) {
        await orch.wakeV(chain.id);
        expect(fakeV.lastCreated.assignee).toBe(assignee);
        expect(fakeV.lastCreated.mode).toBe(mode);
        await completeLatest(svc, assignee);
      }
      // w3：先批准规格卡（链进入 executing），再创建并完成 W3 → 链完成机械规则触发（P0-3）
      await svc.approveSpecCard(card.id, 'human');
      await orch.wakeV(chain.id); // phase w3 → 建 w/kb
      expect(fakeV.lastCreated.assignee).toBe('w');
      expect(fakeV.lastCreated.mode).toBe('kb');
      await completeLatest(svc, 'w'); // W3 完成 → 链 executing + 无未终态任务 → completed
      const state = await svc.snapshot();
      expect(state.chains.get(chain.id)!.status).toBe('completed');
      await orch.wakeV(chain.id); // summary 阶段应无副作用
      expect(fakeV.lastCreated.mode).toBe('kb'); // 未再建卡（保持最后一次）
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
});
