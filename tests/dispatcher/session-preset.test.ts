// tests/dispatcher/session-preset.test.ts
import { describe, it, expect } from 'vitest';
import { headerPresetOf, sessionPresetOf } from '../../src/dispatcher/session-preset.js';

/** ctx 替身：按服务名返回注入的假服务。 */
function ctxWith(services: Record<string, unknown>) {
  return { get: (name: string) => services[name] };
}
const agent = (headerPreset?: unknown, opts: { ctx?: unknown; session?: boolean } = {}) => ({
  ctx: 'ctx' in opts ? opts.ctx : { agentScope: true },
  session: opts.session === false ? undefined : { header: { agentPreset: headerPreset } },
});

describe('sessionPresetOf（四级官方链）', () => {
  it('① 引擎真相优先：composedPreset 覆盖投影与 header', () => {
    const ctx = ctxWith({
      agentPresets: { composedPreset: () => 'swarm', defaultId: 'ptc' },
      sessionProjections: { stateOf: () => 'ptc' },
    });
    expect(sessionPresetOf(ctx, agent('ptc'))).toBe('swarm');
  });

  it('② 引擎无答案（返回 undefined/空）→ 会话投影', () => {
    const ctx = ctxWith({
      agentPresets: { composedPreset: () => undefined, defaultId: 'ptc' },
      sessionProjections: { stateOf: () => 'kanban-dt' },
    });
    expect(sessionPresetOf(ctx, agent('ptc'))).toBe('kanban-dt');
    const blank = ctxWith({
      agentPresets: { composedPreset: () => '  ', defaultId: 'ptc' },
      sessionProjections: { stateOf: () => 'swarm' },
    });
    expect(sessionPresetOf(blank, agent('ptc'))).toBe('swarm');
  });

  it('③ 引擎与投影都不可用 → 创建事实 header', () => {
    expect(sessionPresetOf(ctxWith({}), agent('ptc'))).toBe('ptc');
    expect(sessionPresetOf(undefined, agent('swarm'))).toBe('swarm');
  });

  it('④ 全空 → defaultId；READ 服务也没有 → 空串（未知模式，不猜）', () => {
    expect(sessionPresetOf(ctxWith({ agentPresets: { defaultId: 'ptc' } }), agent(undefined))).toBe('ptc');
    expect(sessionPresetOf(ctxWith({}), agent(undefined))).toBe('');
    expect(sessionPresetOf(undefined, undefined)).toBe('');
  });

  it('读取异常不抛出：引擎抛错 → 降级投影；投影抛错 → 降级 header', () => {
    const engineThrows = ctxWith({
      agentPresets: { composedPreset: () => { throw new Error('scope-broken'); }, defaultId: 'ptc' },
      sessionProjections: { stateOf: () => 'swarm' },
    });
    expect(sessionPresetOf(engineThrows, agent('ptc'))).toBe('swarm');
    const projectionThrows = ctxWith({
      agentPresets: { composedPreset: () => undefined, defaultId: 'ptc' },
      sessionProjections: { stateOf: () => { throw new Error('no-cell'); } },
    });
    expect(sessionPresetOf(projectionThrows, agent('kanban-w'))).toBe('kanban-w');
  });

  it('agent 缺 session 时仍可经引擎真相得到答案（子代理未记录 preset 的场景）', () => {
    const ctx = ctxWith({ agentPresets: { composedPreset: () => 'kanban-dt' } });
    expect(sessionPresetOf(ctx, agent(undefined, { session: false }))).toBe('kanban-dt');
  });

  it('子代理继承父组合：header 是 kanban-dt 时引擎同样答 kanban-dt（守卫判定来源一致）', () => {
    const ctx = ctxWith({
      agentPresets: { composedPreset: (agentCtx: unknown) => (agentCtx === 'child-ctx' ? 'kanban-dt' : undefined) },
      sessionProjections: { stateOf: () => 'kanban-dt' },
    });
    expect(sessionPresetOf(ctx, agent('kanban-dt', { ctx: 'child-ctx' }))).toBe('kanban-dt');
  });
});

describe('headerPresetOf（创建事实）', () => {
  it('取 header.agentPreset 并 trim；非字符串/缺字段 → 空串', () => {
    expect(headerPresetOf(agent(' swarm '))).toBe('swarm');
    expect(headerPresetOf(agent(123))).toBe('');
    expect(headerPresetOf(agent(undefined))).toBe('');
    expect(headerPresetOf(agent(undefined, { session: false }))).toBe('');
    expect(headerPresetOf(null)).toBe('');
  });
});
