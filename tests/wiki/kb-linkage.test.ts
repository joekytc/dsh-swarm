import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEventStore } from '../../src/domain/event-store.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { syncKbLinks } from '../../src/wiki/kb-linkage.js';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

function makeState(chainId: string) {
  const store = new FileEventStore(mkdtempSync(join(tmpdir(), 'kbl-')));
  const svc = new KanbanService(store);
  return { store, svc };
}

describe('syncKbLinks (Q3&5 三份文档机械互链)', () => {
  it('W2(w:kb) 完成：清单页登记计划页链接 + 计划页写回清单链接', async () => {
    const { svc } = makeState('x');
    const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
    const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
    // 规格卡挂 kind:'kb' 附件 = 清单页（/openspec: 建链时机械挂载）
    await svc.addSpecCardAttachment(card.id, { name: '需求澄清清单(完整资料)', kind: 'kb', ref: 'projects/checklists/req.md' }, 'v');
    const w2 = await svc.createTask({ chainId: chain.id, title: 'w2', assignee: 'w', mode: 'kb', parents: [] }, 'v');
    await svc.claimTask(w2.id, 'system');
    await svc.completeTask(w2.id, {
      summary: 's',
      metadata: { kb_url: 'http://x/#/page/projects/ch_x/t_1.md', page_path: 'projects/ch_x/t_1.md' },
      completedAt: Date.now(),
    }, 'w', { boundTaskId: w2.id });

    const readFn = vi.fn(async (p: string) => {
      if (p === 'projects/checklists/req.md') return { path: p, rawMd: '# 需求清单\n## Spec\n' };
      if (p === 'projects/ch_x/t_1.md') return { path: p, rawMd: '# 计划\n' };
      throw new Error('404');
    });
    const writeFn = vi.fn(async (_p: string, _content: string) => ({ path: _p }));
    const wiki = { baseUrl: 'http://x', read: readFn, write: writeFn } as unknown as WikiVaultClient;

    const state = await svc.snapshot();
    await syncKbLinks(wiki, state, w2.id);

    // 清单页：追加「关联文档」含计划页链接
    const checklistWrite = writeFn.mock.calls.find((c) => c[0] === 'projects/checklists/req.md');
    expect(checklistWrite).toBeTruthy();
    const checklistContent = checklistWrite![1] as string;
    expect(checklistContent).toContain('## 关联文档');
    expect(checklistContent).toContain('[#/page/projects/ch_x/t_1.md](#/page/projects/ch_x/t_1.md)');
    expect(checklistContent).toContain('# 需求清单'); // 原内容保留
    // 计划页：写回清单链接
    const planWrite = writeFn.mock.calls.find((c) => c[0] === 'projects/ch_x/t_1.md');
    expect(planWrite).toBeTruthy();
    const planContent = planWrite![1] as string;
    expect(planContent).toContain('需求清单');
    expect(planContent).toContain('[#/page/projects/checklists/req.md](#/page/projects/checklists/req.md)');
    expect(planContent).toContain('# 计划');
  });

  it('幂等：重复调用不重复追加链接行', async () => {
    const { svc } = makeState('x');
    const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
    const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
    await svc.addSpecCardAttachment(card.id, { name: '清单', kind: 'kb', ref: 'projects/checklists/req.md' }, 'v');
    const w2 = await svc.createTask({ chainId: chain.id, title: 'w2', assignee: 'w', mode: 'kb', parents: [] }, 'v');
    await svc.claimTask(w2.id, 'system');
    await svc.completeTask(w2.id, { summary: 's', metadata: { kb_url: 'http://x/#/page/projects/ch_x/t_1.md', page_path: 'projects/ch_x/t_1.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w2.id });

    const readFn = vi.fn(async (p: string) => {
      if (p === 'projects/checklists/req.md') return { path: p, rawMd: '# 需求清单\n' };
      if (p === 'projects/ch_x/t_1.md') return { path: p, rawMd: '# 计划\n' };
      throw new Error('404');
    });
    const writeFn = vi.fn(async (_p: string, _content: string) => ({ path: _p }));
    const wiki = { baseUrl: 'http://x', read: readFn, write: writeFn } as unknown as WikiVaultClient;

    const state = await svc.snapshot();
    await syncKbLinks(wiki, state, w2.id);
    await syncKbLinks(wiki, state, w2.id);
    const checklistContent = writeFn.mock.calls
      .filter((c) => c[0] === 'projects/checklists/req.md')
      .map((c) => c[1] as string);
    const last = checklistContent[checklistContent.length - 1];
    const occurrences = last.split('\n').filter((l) => l.includes('projects/ch_x/t_1.md')).length;
    expect(occurrences).toBe(1); // 幂等：只出现一次
  });

  it('容错：wiki 读失败/页不存在 → 跳过不抛错（登记失败不阻塞完成）', async () => {
    const { svc } = makeState('x');
    const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
    const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
    await svc.addSpecCardAttachment(card.id, { name: '清单', kind: 'kb', ref: 'projects/checklists/req.md' }, 'v');
    const w2 = await svc.createTask({ chainId: chain.id, title: 'w2', assignee: 'w', mode: 'kb', parents: [] }, 'v');
    await svc.claimTask(w2.id, 'system');
    await svc.completeTask(w2.id, { summary: 's', metadata: { kb_url: 'http://x/#/page/projects/ch_x/t_1.md', page_path: 'projects/ch_x/t_1.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w2.id });

    // read 全部失败（KB 不可达），write 也失败
    const wiki = {
      baseUrl: 'http://x',
      read: vi.fn(async () => { throw new Error('unreachable'); }),
      write: vi.fn(async () => { throw new Error('boom'); }),
    } as unknown as WikiVaultClient;

    const state = await svc.snapshot();
    await expect(syncKbLinks(wiki, state, w2.id)).resolves.toBeUndefined();
  });

  it('非 w:kb 任务 / 无规格卡 kb 附件 → 直接跳过', async () => {
    const { svc } = makeState('x');
    const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
    const p = await svc.createTask({ chainId: chain.id, title: 'p', assignee: 'p', mode: 'openspec', parents: [] }, 'v');
    await svc.claimTask(p.id, 'system');
    await svc.completeTask(p.id, { summary: 's', metadata: { artifacts_path: '/x', pt_decision: { needed: false } }, completedAt: Date.now() }, 'p', { boundTaskId: p.id });
    const wiki = { baseUrl: 'http://x', read: vi.fn(), write: vi.fn() } as unknown as WikiVaultClient;
    const state = await svc.snapshot();
    await syncKbLinks(wiki, state, p.id);
    expect(wiki.read).not.toHaveBeenCalled();
    expect(wiki.write).not.toHaveBeenCalled();
  });
});
