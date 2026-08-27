import { describe, it, expect } from 'vitest';
import { buildKanbanTools } from '../../src/tools/kanban-tools.js';
import { buildSpecCardTools } from '../../src/tools/spec-card-tools.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import type { Actor } from '../../src/domain/permissions.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function svc() { return new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'kb-tool-')))); }

async function fresh() {
  const service = svc();
  const chain = await service.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
  return { service, chainId: chain.id };
}

describe('kanban tools', () => {
  it('defines kanban_show with parameters', () => {
    const tools = buildKanbanTools(svc(), () => ({ actor: 'human' }));
    const show = tools.find((t) => (t as { name?: string }).name === 'kanban_show');
    expect(show).toBeDefined();
  });
  it('create tool rejects planner actor (caller via closure, P1-3)', async () => {
    const { service, chainId } = await fresh();
    // getCaller 闭包返回 planner 调用方（模拟 P agent scope 装配）
    const tools = buildKanbanTools(service, () => ({ actor: 'p' }));
    const create = tools.find((t) => (t as { name?: string }).name === 'kanban_create')!;
    const def = create as unknown as { execute(args: unknown): Promise<unknown> };
    await expect(def.execute({ chainId, title: 'x', assignee: 'd', mode: 'align' })).rejects.toThrow(/denied/);
  });
  it('bound complete works via closure', async () => {
    const { service, chainId } = await fresh();
    const t = await service.createTask({ chainId, title: 'x', assignee: 'w', mode: 'kb' }, 'v');
    await service.claimTask(t.id, 'system');
    const tools = buildKanbanTools(service, () => ({ actor: 'w', boundTaskId: t.id }));
    const complete = tools.find((x) => (x as { name?: string }).name === 'kanban_complete')!;
    const def = complete as unknown as { execute(args: unknown): Promise<unknown> };
    await expect(def.execute({ taskId: t.id, summary: 'ok', metadata: { kb_url: 'http://x', page_path: '/kb/x' } })).resolves.toMatchObject({ status: 'done' });
  });
  it('PT/DT 卡可通过 kanban_create schema（v2 schema 漂移修复）', async () => {
    // 走真实 buildKanbanTools 参数校验：模拟 dsh-tools 的 schema 校验行为
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'kt-'))));
    const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
    // kanban_create 工具 execute 内部直接调 service.createTask（服务层无 enum 校验），
    // schema 校验由 dsh-tools 参数层完成；此处断言工具 schema 的 enum 值已扩展。
    const tools = buildKanbanTools(svc, () => ({ actor: 'v' as Actor }));
    // defineTool 会把参数编译成 JSON Schema：parameters.properties.<key>
    const create = tools.find((t) => (t as { name?: string }).name === 'kanban_create') as unknown as {
      parameters: { properties: { assignee: { enum?: string[] }; mode: { enum?: string[] } } };
    };
    expect(create.parameters.properties.assignee.enum).toEqual(expect.arrayContaining(['pt', 'dt']));
    expect(create.parameters.properties.mode.enum).toEqual(expect.arrayContaining(['review-plan', 'review-impl']));
    const list = tools.find((t) => (t as { name?: string }).name === 'kanban_list') as unknown as {
      parameters: { properties: { assignee: { enum?: string[] } } };
    };
    expect(list.parameters.properties.assignee.enum).toEqual(expect.arrayContaining(['pt', 'dt']));
  });

  it('spec_card_edit 拒绝数组进 string 段（type bug 回归：testing.trim is not a function）', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'kt2-'))));
    const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
    const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
    const tools = buildSpecCardTools(svc, () => ({ actor: 'human' as Actor }));
    const edit = tools.find((t) => (t as { name?: string }).name === 'spec_card_edit') as unknown as {
      execute(args: { cardId: string; sections: unknown }): Promise<unknown>;
    };
    await expect(edit.execute({
      cardId: card.id,
      sections: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: ['array'], out_of_scope: 'o' },
    })).rejects.toThrow(/testing|must be a string/i);
  });

  it('Q2: kanban_chain 链级只读——链+规格卡+全卡(handoff/评论/blocked原因)+审计告警', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'kch-'))));
    const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
    await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
    const t1 = await svc.createTask({ chainId: chain.id, title: 'p', assignee: 'p', mode: 'openspec' }, 'v');
    const t2 = await svc.createTask({ chainId: chain.id, title: 'w2', assignee: 'w', mode: 'kb', parents: [t1.id] }, 'v');
    await svc.claimTask(t2.id, 'system'); // blocked 仅从 running/failed 合法转换
    await svc.blockTask(t2.id, 'delivery required: x', 'system');
    await svc.comment(t1.id, 'note', 'v');
    const tools = buildKanbanTools(svc, () => ({ actor: 'human' }));
    const chainTool = tools.find((t) => (t as { name?: string }).name === 'kanban_chain')!;
    const out = await (chainTool as unknown as { execute(args: { chainId: string }): Promise<Record<string, unknown>> }).execute({ chainId: chain.id }) as {
      chain: { id: string }; specCard: { chainId: string } | null;
      tasks: Array<{ id: string; status: string; blockedReason: string | null; comments: string[] }>;
    };
    expect(out.chain.id).toBe(chain.id);
    expect(out.specCard?.chainId).toBe(chain.id);
    expect(out.tasks).toHaveLength(2);
    expect(out.tasks.find((t) => t.id === t2.id)?.blockedReason).toBe('delivery required: x');
    expect(out.tasks.find((t) => t.id === t1.id)?.comments).toEqual(['note']);
    // 未知链报错
    await expect((chainTool as unknown as { execute(args: { chainId: string }): Promise<unknown> }).execute({ chainId: 'ch_nope' })).rejects.toThrow(/unknown chain/);
  });
});
