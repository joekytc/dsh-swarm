import { describe, it, expect } from 'vitest';
import { buildKanbanTools } from '../../src/tools/kanban-tools.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
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
});
