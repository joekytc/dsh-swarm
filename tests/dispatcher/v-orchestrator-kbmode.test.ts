// tests/dispatcher/v-orchestrator-kbmode.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildPhaseInstruction, PHASE_INSTRUCTIONS, VOrchestrator } from '../../src/dispatcher/v-orchestrator.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

describe('v-orchestrator 指令分模式（D9）', () => {
  const ctx = { chainId: 'ch_c1', taskId: 't_t1' };
  it('w2 local：含 skill/空 kb_url 指令，不含 wiki_write', () => {
    const body = buildPhaseInstruction('w2', ctx, 'local');
    expect(body).toContain('skill');
    expect(body).toContain('wiki/sources/ch_c1/t_t1.md');
    expect(body).toContain('kb_url=""');
    expect(body).not.toContain('wiki_write');
  });
  it('w2 remote：与 PHASE_INSTRUCTIONS 原文一致（护栏测试零改动前提）', () => {
    expect(buildPhaseInstruction('w2', ctx, 'remote')).toBe(PHASE_INSTRUCTIONS['w2'] ?? '');
  });
  it('w3 local：收尾同步指令含空 kb_url（taskId 缺省用占位符）', () => {
    const body = buildPhaseInstruction('w3', { chainId: 'ch_c1' }, 'local');
    expect(body).toContain('wiki/sources/ch_c1/t_<你的任务ID>.md');
    expect(body).toContain('kb_url=""');
  });
  it('d local：读 page_path 本地文件 + skill 召回，不含 wiki_read', () => {
    const body = buildPhaseInstruction('d', ctx, 'local');
    expect(body).toContain('page_path');
    expect(body).not.toContain('wiki_read');
  });
  it('dt local：评审页 fs 写 wiki/queries/（审查 M4）', () => {
    const body = buildPhaseInstruction('dt', ctx, 'local');
    expect(body).toContain('wiki/queries/ch_c1/review/');
  });
});

/** 修复轮接线证明（Critical-1/2）：buildPhaseInstruction 消费点 + missingParentDelivery baseUrl 透传。 */
describe('v-orchestrator 消费点接线（D9 修复轮）', () => {
  /** local 模式 stub：getEffective().wikiVault.baseUrl='' + mode getter（真实 ConfigProvider 形状的最小子集）。 */
  const localConfigProvider = {
    getEffective: () => ({ wikiVault: { baseUrl: '', pagePrefix: 'projects/' } }),
    mode: 'local',
  } as never;

  function fakeWsCtx() {
    const entity = () => ({ id: 'ws-1', attachSession: async () => {} });
    return {
      get: (name: string) => {
        if (name === 'workspaceRegistry') return {
          resolveByPath: async (p: string) => (p === '/ws/main' ? entity() : undefined),
          create: async () => entity(),
        };
        return undefined;
      },
    };
  }

  it('local 模式端到端：V 上下文产出 w2 local 指令（消费点接线）；kb_url="" 的 W2 交付经 baseUrl 透传不阻塞 D 建卡（透传接线）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vorch-kbwire-'));
    try {
      // getKbUrlBase=()=>'':completeTask 交付闸与 V 前置校验同走 strict local（否则 kb_url="" 在闸处即被拦，测不到下游透传）
      const svc = new KanbanService(new FileEventStore(dir), () => '');
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: '/ws/main' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');

      let lastContext = '';
      const lastCreated = { assignee: '', mode: '' };
      const events: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
      const pending: Promise<void>[] = [];
      const agent = {
        followup: vi.fn((msg: { content: { text: string }[] }) => {
          pending.push((async () => {
            const text = msg.content.map((b) => b.text).join('\n');
            lastContext = text;
            const m = text.match(/NEXT_TASK_ASSIGNEE=(\w+) MODE=([\w-]+)/);
            if (!m) return;
            await svc.createTask({ chainId: chain.id, title: `phase-${m[2]}`, assignee: m[1] as never, mode: m[2] as never }, 'v');
            events.push({ name: 'kanban_create', arguments: { assignee: m[1], mode: m[2] } });
            lastCreated.assignee = m[1];
            lastCreated.mode = m[2];
          })());
        }),
        whenIdle: async () => { await Promise.all(pending); },
        session: { events },
      };
      const agents = {
        create: vi.fn(async (opts: { setup?: (c: never) => void }) => { opts.setup?.({ on: () => () => {} } as never); return { agent }; }),
        resume: vi.fn(async () => ({ agent })),
      };
      const orch = new VOrchestrator(fakeWsCtx() as never, svc, agents as never, localConfigProvider, new Map(), {} as unknown as WikiVaultClient);

      // p 建卡（local 模式 p 回落 remote 原文）
      await orch.wakeV(chain.id);
      expect(lastCreated).toEqual({ assignee: 'p', mode: 'openspec' });

      // P 完成（needed=false）→ 跳过 PT → w2 建卡轮：V 上下文应含 w2 local 指令（Critical-1 消费点接线）
      const pTask = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'p' && t.mode === 'openspec')!;
      await svc.claimTask(pTask.id, 'system');
      await svc.completeTask(pTask.id, { summary: 'plan', metadata: { artifacts_path: '/ws/plan.md', pt_decision: { needed: false } }, completedAt: 0 }, 'p', { boundTaskId: pTask.id });
      await orch.wakeV(chain.id);
      expect(lastCreated).toEqual({ assignee: 'w', mode: 'kb' });
      expect(lastContext).toContain('wiki/sources/' + chain.id + '/t_<你的任务ID>.md');
      expect(lastContext).toContain('kb_url=""');
      expect(lastContext).not.toContain('## W2 阶段任务体要求'); // remote 模板不得出现

      // W2 以 local 交付物完成（kb_url='' + 本地库相对路径）
      const w2 = [...(await svc.snapshot()).tasks.values()].find((t) => t.assignee === 'w' && t.mode === 'kb')!;
      await svc.claimTask(w2.id, 'system');
      await svc.completeTask(w2.id, { summary: 'synced', metadata: { kb_url: '', page_path: `wiki/sources/${chain.id}/${w2.id}.md` }, completedAt: 0 }, 'w', { boundTaskId: w2.id });

      // D 建卡轮：missingParentDelivery 透传 baseUrl('') → strict local 认可 kb_url="" → D 卡正常创建（Critical-2 透传接线；
      // 若未透传则宽松校验判 kb_url 缺失 → [delivery-required] 且不建 D 卡）
      await orch.wakeV(chain.id);
      expect(lastCreated).toEqual({ assignee: 'd', mode: 'execute' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
