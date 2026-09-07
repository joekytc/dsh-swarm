// tests/domain/im-message.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEventStore } from '../../src/domain/event-store.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import type { BoardState, KanbanEvent, Task } from '../../src/domain/types.js';
import { buildCompletionMessage, buildBlockMessage, latestBlockedTasks, suggestionsFor } from '../../src/domain/im-message.js';

async function freshChain() {
  const dir = mkdtempSync(join(tmpdir(), 'im-msg-'));
  const svc = new KanbanService(new FileEventStore(dir));
  // 全链跑通（镜像 kanban-service.test.ts 主流程）：w1 → p → w2 → d → w3
  const chain = await svc.createChain({ title: '【需求】测试链', ownerSessionId: 's' }, 'human');
  const w1 = await svc.createTask({ chainId: chain.id, title: 'w1 预取', assignee: 'w', mode: 'file' }, 'v');
  await svc.claimTask(w1.id, 'system');
  await svc.completeTask(w1.id, { summary: 'facts', metadata: { ref: '/ws' }, completedAt: Date.now() }, 'w', { boundTaskId: w1.id });
  const p = await svc.createTask({ chainId: chain.id, title: 'p 计划', assignee: 'p', mode: 'openspec', parents: [w1.id] }, 'v');
  await svc.claimTask(p.id, 'system');
  await svc.completeTask(p.id, { summary: 'plan', metadata: { artifacts_path: '/ws/plan.md', pt_decision: { needed: false } }, completedAt: Date.now() }, 'p', { boundTaskId: p.id });
  const w2 = await svc.createTask({ chainId: chain.id, title: 'w2 知识同步', assignee: 'w', mode: 'kb', parents: [p.id] }, 'v');
  await svc.claimTask(w2.id, 'system');
  await svc.completeTask(w2.id, { summary: 'sync', metadata: { kb_url: 'http://kb/1', page_path: 'projects/x/plan.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w2.id });
  const d = await svc.createTask({ chainId: chain.id, title: 'd 实施', assignee: 'd', mode: 'execute', parents: [w2.id] }, 'v');
  await svc.claimTask(d.id, 'system');
  await svc.completeTask(d.id, { summary: 'impl', metadata: { changed_files: ['a.ts'], commit_hash: 'deadbeef', push: true, tdd: { test_files: ['a.test.ts'], test_first: true } }, completedAt: Date.now() }, 'd', { boundTaskId: d.id });
  const w3 = await svc.createTask({ chainId: chain.id, title: 'w3 结果沉淀', assignee: 'w', mode: 'kb', parents: [d.id] }, 'v');
  await svc.claimTask(w3.id, 'system');
  return { svc, dir, chain, w3 };
}

describe('buildCompletionMessage', () => {
  it('W3 收尾 → 完成汇报（清单✅/产出/无关注点）', async () => {
    const { svc, dir, chain, w3 } = await freshChain();
    try {
      await svc.completeTask(w3.id, { summary: 'synced', metadata: { kb_url: 'http://kb/2', page_path: 'projects/x/result.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      const state: BoardState = await svc.snapshot();
      const msg = buildCompletionMessage(state, chain.id, w3.id, Date.now());
      expect(msg).toContain('【DSH 需求完成】【需求】测试链');
      expect(msg).toContain('- ✅ w1 预取');
      expect(msg).toContain('- ✅ d 实施');
      expect(msg).toContain('- ✅ w3 结果沉淀');
      expect(msg).toContain('- KB 文档：http://kb/2');
      expect(msg).toContain('- KB 页：projects/x/result.md');
      expect(msg).toContain('- 产出物：/ws/plan.md');
      expect(msg).not.toContain('人工关注点');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('W2 完成（中间态，链上无 done 的 D 卡）→ null 不投', async () => {
    const { svc, dir, chain } = await freshChain();
    try {
      // freshChain 已建 d/w3：w3 处 running（未完成）→ 链上存在非终态卡，中间态不得投递
      const state = await svc.snapshot();
      const w2 = [...state.tasks.values()].find((t) => t.title === 'w2 知识同步')!;
      expect(buildCompletionMessage(state, chain.id, w2.id, Date.now())).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('w:file 卡完成 → null（非 kb 模式）', async () => {
    const { svc, dir, chain } = await freshChain();
    try {
      const state = await svc.snapshot();
      const w1 = [...state.tasks.values()].find((t) => t.title === 'w1 预取')!;
      expect(buildCompletionMessage(state, chain.id, w1.id, Date.now())).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('D 卡 tdd 跳过 / D 证据缺失 / 审计警告 → 人工关注点', async () => {
    const { svc, dir } = await freshChain();
    try {
      // 新链场景（freshChain 的 D 卡证据齐全，无法在本链造缺证据）：
      // human 收尾 D 卡（信任锚豁免 C2，但 C1 拦链完成）——带 changed_files、无 commit_hash/push，tdd 声明为跳过
      const chain2 = await svc.createChain({ title: '【需求】关注链', ownerSessionId: 's' }, 'human');
      const d2 = await svc.createTask({ chainId: chain2.id, title: 'd2 实施', assignee: 'd', mode: 'execute' }, 'v');
      await svc.claimTask(d2.id, 'system');
      await svc.completeTask(d2.id, { summary: 'impl', metadata: { changed_files: ['a.ts'], tdd: { skipped: { reason: '纯文档改动' } } }, completedAt: Date.now() }, 'human');
      const w3b = await svc.createTask({ chainId: chain2.id, title: 'w3b 结果沉淀', assignee: 'w', mode: 'kb', parents: [d2.id] }, 'v');
      await svc.claimTask(w3b.id, 'system');
      await svc.completeTask(w3b.id, { summary: 's', metadata: { kb_url: 'http://kb/2', page_path: 'projects/x/r.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3b.id });
      await svc.auditWarning(chain2.id, [{ source: 'main-session-scan', detail: 'x', paths: ['/p'] }], 'system');
      const state = await svc.snapshot();
      const msg = buildCompletionMessage(state, chain2.id, w3b.id, Date.now());
      expect(msg).toContain('人工关注点');
      expect(msg).toContain('TDD 曾跳过：纯文档改动');
      expect(msg).toContain('D 卡缺 git 产物证据');
      expect(msg).toContain('审计警告待 GUI 确认（1 条证据）');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('local 模式（kb_url 空）→ 无「KB 文档」行，保留「KB 页」行', async () => {
    // local 交付契约（D5）：kb_url 空串合法仅在 strict local（kbUrlBase=''）下成立；
    // 无 base = 宽松校验会把空 kb_url 判为缺键 → 用独立服务实例模拟 local 模式
    const dir2 = mkdtempSync(join(tmpdir(), 'im-msg-local-'));
    try {
      const svc2 = new KanbanService(new FileEventStore(dir2), () => '');
      const chain2 = await svc2.createChain({ title: '【需求】本地链', ownerSessionId: 's' }, 'human');
      const d2 = await svc2.createTask({ chainId: chain2.id, title: 'd2', assignee: 'd', mode: 'execute' }, 'v');
      await svc2.claimTask(d2.id, 'system');
      await svc2.completeTask(d2.id, { summary: 'i', metadata: { changed_files: ['a'], push: true, tdd: { test_files: ['t'], test_first: true } }, completedAt: Date.now() }, 'd', { boundTaskId: d2.id });
      const w3b = await svc2.createTask({ chainId: chain2.id, title: 'w3b', assignee: 'w', mode: 'kb', parents: [d2.id] }, 'v');
      await svc2.claimTask(w3b.id, 'system');
      await svc2.completeTask(w3b.id, { summary: 's', metadata: { kb_url: '', page_path: 'wiki/local.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3b.id });
      const state = await svc2.snapshot();
      const msg = buildCompletionMessage(state, chain2.id, w3b.id, Date.now());
      expect(msg).not.toContain('KB 文档：');
      expect(msg).toContain('- KB 页：wiki/local.md');
    } finally { rmSync(dir2, { recursive: true, force: true }); }
  });
});

describe('buildBlockMessage / latestBlockedTasks / suggestionsFor', () => {
  it('阻塞消息：卡+原因+专用建议+取证路径', async () => {
    const { svc, dir } = await freshChain();
    try {
      const chain2 = await svc.createChain({ title: '【需求】阻塞链', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain2.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const t = await svc.createTask({ chainId: chain2.id, title: 'p 卡', assignee: 'p', mode: 'openspec' }, 'v');
      await svc.claimTask(t.id, 'system');
      await svc.blockTask(t.id, 'kb-insufficient: 知识不足', 'p', { boundTaskId: t.id });
      await svc.blockChain(chain2.id, '[create-failed] 阶段 p 连续 3 轮建卡未产生期望卡，已自动重试 3 次');
      const state = await svc.snapshot();
      const msg = buildBlockMessage(state, chain2.id, '[create-failed] 阶段 p 连续 3 轮建卡未产生期望卡，已自动重试 3 次', '/storages/kanban');
      expect(msg).toContain('【DSH 需求阻塞】【需求】阻塞链');
      expect(msg).toContain('- p 卡：kb-insufficient: 知识不足');
      expect(msg).toContain('> [create-failed]');
      expect(msg).toContain('roles.models.v');
      expect(msg).toContain('/storages/kanban/events.jsonl');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('无 blocked 卡（看门狗场景）→ 阻塞卡节写「无（链级停滞…）」', async () => {
    const { svc, dir } = await freshChain();
    try {
      const chain2 = await svc.createChain({ title: '【需求】停摆链', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain2.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      await svc.blockChain(chain2.id, '[stall-watchdog] phase=p 持续无进展，重唤醒 3 次未建卡');
      const state = await svc.snapshot();
      const msg = buildBlockMessage(state, chain2.id, '[stall-watchdog] phase=p 持续无进展', '/s');
      expect(msg).toContain('无（链级停滞，见阻塞原因）');
      expect(msg).toContain('orchestration.json 的 phase');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('latestBlockedTasks 取全部 blocked 卡 + 最近 task/blocked 原因', () => {
    const events: KanbanEvent[] = [
      { seq: 1, chainId: 'c9', taskId: 't1', kind: 'task/blocked', payload: { reason: '旧原因' }, author: 'system', at: 0 },
      { seq: 2, chainId: 'c9', taskId: 't1', kind: 'task/blocked', payload: { reason: '最新原因' }, author: 'system', at: 0 },
    ];
    const tasks = [
      { id: 't1', chainId: 'c9', title: '卡一', status: 'blocked' },
      { id: 't2', chainId: 'c9', title: '已办', status: 'done' },
      { id: 't3', chainId: 'cOther', title: '他链卡', status: 'blocked' },
    ] as unknown as Task[];
    expect(latestBlockedTasks(events, tasks, 'c9')).toEqual([{ id: 't1', title: '卡一', reason: '最新原因' }]);
    expect(suggestionsFor('未知原因 xyz')).toContain('GUI 打开该链逐卡核对状态；人工恢复 = 删链重跑');
    expect(suggestionsFor('... [stall-watchdog] ...').length).toBeGreaterThan(0);
  });
});
