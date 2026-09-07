// tests/services/im-delivery.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEventStore } from '../../src/domain/event-store.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { wireImDelivery, resolveTarget, sendWithRetry, createSender, sendChainReport, resolveReportChainId, type DshImLike } from '../../src/services/im-delivery.js';
import type { BoardState, Chain, KanbanEvent, Task } from '../../src/domain/types.js';
import { DEFAULT_PREFIX_ROUTES } from '../../src/config.js';

function fakeCtx(dshIm: unknown) {
  return { get: (name: string) => (name === 'dshIm' ? dshIm : undefined) } as never;
}

function fakeIm(overrides: Partial<DshImLike> = {}) {
  const calls: Array<{ botId: string; targetId: string; text: string }> = [];
  const im: DshImLike & { calls: typeof calls } = {
    calls,
    async send(botId: string, targetId: string, text: string) { calls.push({ botId, targetId, text }); return { sent: true }; },
    async listBots() { return [{ botId: 'wecom_a', channel: 'wecom' }]; },
    async listTargets(botId: string) {
      void botId;
      return { botId, channel: 'wecom', targets: [{ targetId: 'tgt_g', kind: 'group', route: { chatId: 'wrX' } }] };
    },
    ...overrides,
  } as never;
  return im;
}

function stubConfigProvider(dir: string, imDelivery: { enabled: boolean; botId?: string; targetId?: string }) {
  return {
    getEffective: () => ({
      storageDir: dir,
      prefixRoutes: { ...DEFAULT_PREFIX_ROUTES },
      imDelivery: { enabled: imDelivery.enabled, botId: imDelivery.botId ?? '', targetId: imDelivery.targetId ?? '' },
    }),
  } as never;
}

async function setupW3Chain(dir: string) {
  const svc = new KanbanService(new FileEventStore(dir));
  const chain = await svc.createChain({ title: '【需求】投递链', ownerSessionId: 's' }, 'human');
  const d = await svc.createTask({ chainId: chain.id, title: 'd 实施', assignee: 'd', mode: 'execute' }, 'v');
  await svc.claimTask(d.id, 'system');
  await svc.completeTask(d.id, { summary: 'i', metadata: { changed_files: ['a.ts'], commit_hash: 'h', push: true, tdd: { test_files: ['t.ts'], test_first: true } }, completedAt: Date.now() }, 'd', { boundTaskId: d.id });
  const w3 = await svc.createTask({ chainId: chain.id, title: 'w3 沉淀', assignee: 'w', mode: 'kb', parents: [d.id] }, 'v');
  await svc.claimTask(w3.id, 'system');
  return { svc, chain, w3 };
}

function flush(): Promise<void> { return new Promise((r) => setTimeout(r, 20)); }

describe('resolveTarget', () => {
  it('配置显式指定 → 直接使用', async () => {
    const r = await resolveTarget(fakeIm(), { botId: 'b1', targetId: 't1' });
    expect(r).toEqual({ botId: 'b1', targetId: 't1' });
  });
  it('留空自动发现 → 唯一 wecom bot + 唯一群目标', async () => {
    const r = await resolveTarget(fakeIm(), { botId: '', targetId: '' });
    expect(r).toEqual({ botId: 'wecom_a', targetId: 'tgt_g' });
  });
  it('0 个或 2 个群目标 → error 留痕不投', async () => {
    const none = await resolveTarget(fakeIm({ async listTargets() { return []; } }), { botId: '', targetId: '' });
    expect('error' in none && none.error).toContain('群目标数量=0');
    const two = await resolveTarget(fakeIm({ async listTargets() { return [{ targetId: 'a', kind: 'group', route: {} }, { targetId: 'b', kind: 'group', route: {} }]; } }), { botId: '', targetId: '' });
    expect('error' in two && two.error).toContain('群目标数量=2');
  });
  it('容错：listTargets 返回 legacy RPC 信封 { botId, channel, targets } 仍解析唯一群目标', async () => {
    // 宿主同 Host 服务实际返回裸数组；此用例钉死对 Connection RPC `target.list` 信封形状的防御兼容分支。
    const r = await resolveTarget(fakeIm({
      async listTargets() {
        return { botId: 'wecom_a', channel: 'wecom', targets: [{ targetId: 'tgt_rpc', kind: 'group', route: {} }] };
      },
    } as unknown as Partial<DshImLike>), { botId: '', targetId: '' });
    expect(r).toEqual({ botId: 'wecom_a', targetId: 'tgt_rpc' });
  });
});

describe('sendWithRetry', () => {
  it('可重试错误码退避重试至成功', async () => {
    const logs: string[] = [];
    let n = 0;
    const im = fakeIm({ async send() { n += 1; if (n < 3) { const e = new Error('offline'); (e as never as { code: string }).code = 'bot-not-connected'; throw e; } return { sent: true }; } });
    const r = await sendWithRetry(im, 'b', 't', 'x', [0, 0, 0], (m) => logs.push(m));
    expect(r).toEqual({ ok: true });
    expect(n).toBe(3);
    expect(logs.some((l) => l.includes('retry'))).toBe(true);
  });
  it('重试耗尽 → ok:false；非重试错误码立即失败只调一次', async () => {
    const boom = async (code: string) => { const e = new Error(code); (e as never as { code: string }).code = code; throw e; };
    const im1 = fakeIm({ async send() { return boom('bot-not-connected'); } });
    expect(await sendWithRetry(im1, 'b', 't', 'x', [0, 0, 0], () => {})).toEqual({ ok: false, error: expect.stringContaining('bot-not-connected') });
    const im2 = fakeIm({ async send() { return boom('unknown-target'); } });
    const r2 = await sendWithRetry(im2, 'b', 't', 'x', [0, 0, 0], () => {});
    expect(r2.ok).toBe(false);
    expect(im2.calls).toHaveLength(0); // send 一直抛，未记录成功调用
  });
});

describe('wireImDelivery', () => {
  it('disabled（默认）→ 事件流过但不投递', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imw-'));
    try {
      const im = fakeIm();
      const { svc, w3 } = await setupW3Chain(dir);
      const logs: string[] = [];
      wireImDelivery(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: false }), { log: (m) => logs.push(m) });
      await svc.completeTask(w3.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      await flush();
      expect(im.calls).toHaveLength(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('dshIm 服务缺失 → 显式降级留痕不抛', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imw2-'));
    try {
      const { svc, w3 } = await setupW3Chain(dir);
      const logs: string[] = [];
      wireImDelivery(fakeCtx(undefined), svc, stubConfigProvider(dir, { enabled: true }), { log: (m) => logs.push(m), retryDelaysMs: [] });
      await svc.completeTask(w3.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      await flush();
      expect(logs.some((l) => l.includes('dshIm 服务缺失或形状不符'))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('W3 收尾 → 自动发现 + 投递完成汇报；W2 中间卡不投', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imw3-'));
    try {
      const im = fakeIm();
      const { svc, chain, w3 } = await setupW3Chain(dir);
      // 先补一张 w2 中间卡验证「不投」：w2 完成时链上无 done 的 D 卡之前不成立——本链 D 已 done，
      // 故 w2 用独立链验证（见下一用例）；本用例只验证 W3 投递。
      void chain;
      wireImDelivery(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: true }), { log: () => {}, retryDelaysMs: [] });
      await svc.completeTask(w3.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      await flush();
      expect(im.calls).toHaveLength(1);
      expect(im.calls[0]!.botId).toBe('wecom_a');
      expect(im.calls[0]!.targetId).toBe('tgt_g');
      expect(im.calls[0]!.text).toContain('【DSH 需求完成】');
      // 端到端正文断言：不跑真实 DSH 链即可验证企微群落地消息的完整内容
      expect(im.calls[0]!.text).toContain('**完成清单**');
      expect(im.calls[0]!.text).toContain('- ✅ d 实施');
      expect(im.calls[0]!.text).toContain('- ✅ w3 沉淀');
      expect(im.calls[0]!.text).toContain('- KB 文档：http://k');
      expect(im.calls[0]!.text).toContain('- KB 页：p.md');
      expect(im.calls[0]!.text).toContain('- 产出物：（无）'); // setupW3Chain 无 P 卡 → artifacts_path 缺省回退（无）
      expect(im.calls[0]!.text).not.toContain('人工关注点'); // fixture D 卡证据齐全且无审计警告
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('W3 收尾 + 审计警告 → 完成汇报含人工关注点', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imw9-'));
    try {
      const im = fakeIm();
      const { svc, chain, w3 } = await setupW3Chain(dir);
      await svc.auditWarning(chain.id, [{ source: 'main-session-scan', detail: 'x', paths: ['/p'] }], 'system');
      wireImDelivery(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: true }), { log: () => {}, retryDelaysMs: [] });
      await svc.completeTask(w3.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      await flush();
      expect(im.calls).toHaveLength(1);
      expect(im.calls[0]!.text).toContain('【DSH 需求完成】');
      expect(im.calls[0]!.text).toContain('**人工关注点**');
      expect(im.calls[0]!.text).toContain('审计警告待 GUI 确认（1 条证据）');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('W2 完成不投（无 done 的 D 卡）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imw4-'));
    try {
      const im = fakeIm();
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: '【需求】半程链', ownerSessionId: 's' }, 'human');
      const w2 = await svc.createTask({ chainId: chain.id, title: 'w2', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(w2.id, 'system');
      wireImDelivery(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: true }), { log: () => {}, retryDelaysMs: [] });
      await svc.completeTask(w2.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w2.id });
      await flush();
      expect(im.calls).toHaveLength(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('chain/blocked → 投递阻塞通知', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imw5-'));
    try {
      const im = fakeIm();
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: '【需求】阻塞链', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      wireImDelivery(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: true }), { log: () => {}, retryDelaysMs: [] });
      await svc.blockChain(chain.id, '[stall-watchdog] phase=p 持续无进展');
      await flush();
      expect(im.calls).toHaveLength(1);
      expect(im.calls[0]!.text).toContain('【DSH 需求阻塞】');
      expect(im.calls[0]!.text).toContain('无（链级停滞，见阻塞原因）'); // 无 blocked 卡 → 链级停滞兜底行
      expect(im.calls[0]!.text).toContain('**排查建议**');
      expect(im.calls[0]!.text).toContain('events.jsonl'); // 取证路径三件套
      expect(im.calls[0]!.text).toContain('orchestration.json');
      expect(im.calls[0]!.text).toContain('dispatcher.log');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('chain/blocked + blocked 卡 → 阻塞通知含阻塞卡行与排查建议', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imw10-'));
    try {
      const im = fakeIm();
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: '【需求】建卡失败链', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'p 卡', assignee: 'p', mode: 'openspec' }, 'v');
      await svc.claimTask(t.id, 'system');
      await svc.blockTask(t.id, 'kb-insufficient: 知识不足', 'p', { boundTaskId: t.id });
      wireImDelivery(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: true }), { log: () => {}, retryDelaysMs: [] });
      await svc.blockChain(chain.id, '[create-failed] 阶段 p 连续 3 轮建卡未产生期望卡');
      await flush();
      expect(im.calls).toHaveLength(1);
      expect(im.calls[0]!.text).toContain('【DSH 需求阻塞】');
      expect(im.calls[0]!.text).toContain('- p 卡：kb-insufficient: 知识不足'); // blocked 卡行：标题：原因
      expect(im.calls[0]!.text).toContain('**排查建议**');
      expect(im.calls[0]!.text).toContain('dispatcher.log 的 [wakeV]'); // [create-failed] 建议行片段
      expect(im.calls[0]!.text).toContain('events.jsonl'); // 取证路径三件套
      expect(im.calls[0]!.text).toContain('orchestration.json');
      expect(im.calls[0]!.text).toContain('dispatcher.log');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('投递重试耗尽 → noteImDeliveryFailed 落 events.jsonl + log 留痕，不影响链状态', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imw6-'));
    try {
      const im = fakeIm({ async send() { const e = new Error('down'); (e as never as { code: string }).code = 'delivery-failed'; throw e; } });
      const { svc, chain, w3 } = await setupW3Chain(dir);
      const logs: string[] = [];
      wireImDelivery(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: true }), { log: (m) => logs.push(m), retryDelaysMs: [0, 0] });
      await svc.completeTask(w3.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      await flush(); await flush();
      const st = await svc.snapshot();
      expect(st.events.some((e: KanbanEvent) => e.kind === 'chain/im-delivery-failed' && e.chainId === chain.id)).toBe(true);
      expect(logs.some((l) => l.includes('FAILED'))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('返回的解除订阅函数生效', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imw7-'));
    try {
      const im = fakeIm();
      const { svc, w3 } = await setupW3Chain(dir);
      const dispose = wireImDelivery(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: true }), { log: () => {}, retryDelaysMs: [] });
      dispose();
      await svc.completeTask(w3.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      await flush();
      expect(im.calls).toHaveLength(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('无关事件（task/created、task/heartbeat）→ 不触发 snapshot 全量重放', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imw8-'));
    try {
      const im = fakeIm();
      const { svc, w3 } = await setupW3Chain(dir);
      wireImDelivery(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: true }), { log: () => {}, retryDelaysMs: [] });
      const snap = vi.spyOn(svc, 'snapshot');
      const chain = await svc.createChain({ title: '【需求】噪声链', ownerSessionId: 's' }, 'human');
      await svc.createTask({ chainId: chain.id, title: '噪声卡', assignee: 'd', mode: 'execute' }, 'v');
      await svc.heartbeat(w3.id, 'system', { boundTaskId: w3.id });
      await flush();
      expect(snap).not.toHaveBeenCalled();
      expect(im.calls).toHaveLength(0);
      // 正向对照：关心事件仍走 snapshot 路径（证明 spy 有效，非订阅失效假阳性）
      await svc.completeTask(w3.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      await flush();
      expect(snap).toHaveBeenCalled();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── /sms 手动投递 ─────────────────────────────────────────────────────────────

/** 纯函数解析用的最小 BoardState 构造（链 id 可控，覆盖 精确/后缀/歧义/判据 分支）。 */
function t(id: string, chainId: string, assignee: 'd' | 'w', mode: 'execute' | 'kb', status: Task['status']): Task {
  return { id, chainId, title: id, assignee, mode, status } as unknown as Task;
}
function ch(id: string, title: string, status: Chain['status']): Chain {
  return { id, title, status, rootTaskId: null, specCardId: null, ownerSessionId: 's', workspaceDir: null, createdAt: 0 };
}
function ev(chainId: string, kind: KanbanEvent['kind'], taskId: string | null, at: number): KanbanEvent {
  return { seq: at, chainId, taskId, kind, payload: kind === 'chain/blocked' ? { reason: 'r' } : {}, author: 'system', at };
}
function st(chains: Chain[], tasks: Task[], events: KanbanEvent[]): BoardState {
  return {
    chains: new Map(chains.map((c) => [c.id, c])),
    tasks: new Map(tasks.map((x) => [x.id, x])),
    specCards: new Map(), handoffs: new Map(), auditWarnings: new Map(), events,
  };
}
/** 合法 W3 收尾链：d(execute,done) + w3(kb,done)，最后完成事件 at=lastAt。 */
function completedChain(id: string, title: string, lastAt: number): { chain: Chain; tasks: Task[]; events: KanbanEvent[] } {
  return {
    chain: ch(id, title, 'completed'),
    tasks: [t(`${id}_d`, id, 'd', 'execute', 'done'), t(`${id}_w3`, id, 'w', 'kb', 'done')],
    events: [ev(id, 'task/completed', `${id}_d`, lastAt - 10), ev(id, 'task/completed', `${id}_w3`, lastAt)],
  };
}
function flatten(parts: Array<{ chain: Chain; tasks: Task[]; events: KanbanEvent[] }>): BoardState {
  return st(parts.map((p) => p.chain), parts.flatMap((p) => p.tasks), parts.flatMap((p) => p.events));
}

describe('resolveReportChainId (/sms 链解析)', () => {
  it('completion 空 query → 最近满足 W3 判据的链（最后完成事件 at 最大）', () => {
    const state = flatten([completedChain('ch_a', '链A', 100), completedChain('ch_b', '链B', 200)]);
    expect(resolveReportChainId(state, 'completion', '')).toEqual({ ok: true, chainId: 'ch_b' });
  });
  it('completion 空 query 无候选（W2 中间态）→ chain-not-found', () => {
    const state = st(
      [ch('ch_c', '链C', 'executing')],
      [t('ch_c_d', 'ch_c', 'd', 'execute', 'done'), t('ch_c_w2', 'ch_c', 'w', 'kb', 'running')],
      [ev('ch_c', 'task/completed', 'ch_c_d', 10)],
    );
    expect(resolveReportChainId(state, 'completion', '')).toEqual({ ok: false, error: 'chain-not-found' });
  });
  it('completion 显式 id 满足判据 → ok（即使不是最近）', () => {
    const state = flatten([completedChain('ch_a', '链A', 100), completedChain('ch_b', '链B', 200)]);
    expect(resolveReportChainId(state, 'completion', 'ch_a')).toEqual({ ok: true, chainId: 'ch_a' });
  });
  it('completion 显式 id 存在但不满足判据 → completion-not-met', () => {
    const state = st(
      [ch('ch_c', '链C', 'executing')],
      [t('ch_c_d', 'ch_c', 'd', 'execute', 'done'), t('ch_c_w2', 'ch_c', 'w', 'kb', 'running')],
      [ev('ch_c', 'task/completed', 'ch_c_d', 10)],
    );
    expect(resolveReportChainId(state, 'completion', 'ch_c')).toEqual({ ok: false, error: 'completion-not-met' });
  });
  it('completion 唯一 id 后缀 → ok；多后缀命中 → chain-ambiguous 带候选', () => {
    const state = flatten([completedChain('ch_a', '链A', 100), completedChain('ch_b', '链B', 200)]);
    expect(resolveReportChainId(state, 'completion', 'a')).toEqual({ ok: true, chainId: 'ch_a' });
    const amb = st([ch('ch_x9', '链X', 'completed'), ch('ch_y9', '链Y', 'completed')], [], []);
    const r = resolveReportChainId(amb, 'completion', '9');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error === 'chain-ambiguous') {
      expect(r.candidates).toEqual([{ chainId: 'ch_x9', title: '链X' }, { chainId: 'ch_y9', title: '链Y' }]);
    } else expect.unreachable(r.ok ? '' : r.error);
  });
  it('completion 查询无匹配 → chain-not-found', () => {
    const state = flatten([completedChain('ch_a', '链A', 100)]);
    expect(resolveReportChainId(state, 'completion', 'zzz')).toEqual({ ok: false, error: 'chain-not-found' });
  });
  it('blocked 空 query → chain/blocked 事件 at 最大的阻塞链', () => {
    const a = completedChain('ch_a', '链A', 100);
    const b1 = ch('ch_b1', '阻塞1', 'blocked');
    const b2 = ch('ch_b2', '阻塞2', 'blocked');
    const state = st([a.chain, b1, b2], a.tasks, [...a.events, ev('ch_b1', 'chain/blocked', null, 100), ev('ch_b2', 'chain/blocked', null, 200)]);
    expect(resolveReportChainId(state, 'blocked', '')).toEqual({ ok: true, chainId: 'ch_b2' });
  });
  it('blocked 空 query 无阻塞链 → chain-not-found；显式非阻塞链 → not-blocked', () => {
    const a = completedChain('ch_a', '链A', 100);
    expect(resolveReportChainId(st([a.chain], a.tasks, a.events), 'blocked', '')).toEqual({ ok: false, error: 'chain-not-found' });
    expect(resolveReportChainId(st([a.chain], a.tasks, a.events), 'blocked', 'ch_a')).toEqual({ ok: false, error: 'not-blocked' });
  });
  it('blocked 显式 blocked 链 → ok', () => {
    const b = ch('ch_b1', '阻塞1', 'blocked');
    const state = st([b], [], [ev('ch_b1', 'chain/blocked', null, 100)]);
    expect(resolveReportChainId(state, 'blocked', 'ch_b1')).toEqual({ ok: true, chainId: 'ch_b1' });
  });
});

describe('sendChainReport (/sms 手动投递)', () => {
  it('completion 空 query → 投递完整渲染正文（红线：正文出自领域函数，imDelivery.enabled=false 不门控）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ims1-'));
    try {
      const im = fakeIm();
      const { svc, chain, w3 } = await setupW3Chain(dir);
      await svc.completeTask(w3.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      const r = await sendChainReport(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: false }), { log: () => {}, retryDelaysMs: [] }, 'completion', '');
      expect(r).toMatchObject({ ok: true, chainId: chain.id, botId: 'wecom_a', targetId: 'tgt_g' });
      expect(im.calls).toHaveLength(1);
      // 红线断言：发出的是领域函数渲染的完整 markdown，而非片段/占位文本
      expect(im.calls[0]!.text).toContain('【DSH 需求完成】');
      expect(im.calls[0]!.text).toContain('**完成清单**');
      expect(im.calls[0]!.text).toContain('- ✅ d 实施');
      expect(im.calls[0]!.text).toContain('- ✅ w3 沉淀');
      expect(im.calls[0]!.text).toContain('- KB 文档：http://k');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('blocked 空 query → 最近阻塞链 + 阻塞正文', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ims2-'));
    try {
      const im = fakeIm();
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: '【需求】阻塞链', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      await svc.blockChain(chain.id, '[stall-watchdog] phase=p 持续无进展');
      const r = await sendChainReport(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: false }), { log: () => {}, retryDelaysMs: [] }, 'blocked', '');
      expect(r).toMatchObject({ ok: true, chainId: chain.id, botId: 'wecom_a', targetId: 'tgt_g' });
      expect(im.calls[0]!.text).toContain('【DSH 需求阻塞】');
      expect(im.calls[0]!.text).toContain('[stall-watchdog] phase=p 持续无进展');
      expect(im.calls[0]!.text).toContain('**排查建议**');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('dshIm 服务缺失 → ok:false 显式错误（不抛、不静默）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ims3-'));
    try {
      const { svc, w3 } = await setupW3Chain(dir);
      await svc.completeTask(w3.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      const r = await sendChainReport(fakeCtx(undefined), svc, stubConfigProvider(dir, { enabled: false }), { log: () => {}, retryDelaysMs: [] }, 'completion', '');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('dshIm');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('发送失败（manual 路径）→ ok:false + dispatcher 留痕，但不写 chain/im-delivery-failed 链事件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ims4-'));
    try {
      let sendCalls = 0;
      const im = fakeIm({ async send() { sendCalls += 1; const e = new Error('down'); (e as never as { code: string }).code = 'delivery-failed'; throw e; } });
      const { svc, chain, w3 } = await setupW3Chain(dir);
      await svc.completeTask(w3.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w3.id });
      const logs: string[] = [];
      const r = await sendChainReport(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: true }), { log: (m) => logs.push(m), retryDelaysMs: [] }, 'completion', '');
      expect(r.ok).toBe(false);
      expect(sendCalls).toBe(1); // manual 路径：可重试错误码也在首次尝试即返回（无退避重试，同步等待用户）
      const st = await svc.snapshot();
      expect(st.events.some((e: KanbanEvent) => e.kind === 'chain/im-delivery-failed' && e.chainId === chain.id)).toBe(false);
      expect(logs.some((l) => l.includes('FAILED'))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('显式 query 不满足判据 → completion-not-met + guidance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ims5-'));
    try {
      const im = fakeIm();
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: '【需求】半程链', ownerSessionId: 's' }, 'human');
      const w2 = await svc.createTask({ chainId: chain.id, title: 'w2', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(w2.id, 'system');
      await svc.completeTask(w2.id, { summary: 's', metadata: { kb_url: 'http://k', page_path: 'p.md' }, completedAt: Date.now() }, 'w', { boundTaskId: w2.id });
      const r = await sendChainReport(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: false }), { log: () => {}, retryDelaysMs: [] }, 'completion', chain.id);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('completion-not-met');
        expect(r.guidance).toContain('W3 未收尾');
      }
      expect(im.calls).toHaveLength(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('createSender 工厂：成功返回 botId/targetId；auto 失败仍写链事件（回归钉死）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ims6-'));
    try {
      const im = fakeIm();
      const { svc, chain } = await setupW3Chain(dir);
      const send = createSender(fakeCtx(im), svc, stubConfigProvider(dir, { enabled: false }), { log: () => {}, retryDelaysMs: [] });
      await expect(send(chain.id, '正文')).resolves.toEqual({ ok: true, botId: 'wecom_a', targetId: 'tgt_g' });
      expect(im.calls[0]!.text).toBe('正文');
      const bad = fakeIm({ async send() { const e = new Error('down'); (e as never as { code: string }).code = 'delivery-failed'; throw e; } });
      const autoSend = createSender(fakeCtx(bad), svc, stubConfigProvider(dir, { enabled: true }), { log: () => {}, retryDelaysMs: [] });
      await expect(autoSend(chain.id, '正文')).resolves.toMatchObject({ ok: false });
      const st = await svc.snapshot();
      expect(st.events.some((e: KanbanEvent) => e.kind === 'chain/im-delivery-failed' && e.chainId === chain.id)).toBe(true); // auto 路径保留双留痕
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
