import { describe, it, expect } from 'vitest';
import {
  mergeConfig, computeSources, projectEditable, validateConfig, diffOverride, ROLES,
} from '../../src/domain/config-override.js';
import type { KanbanConfig } from '../../src/config.js';

function base(): KanbanConfig {
  return {
    storageDir: '/tmp/kb',
    wikiVault: { baseUrl: 'http://10.0.0.1:3000', pagePrefix: 'projects/' },
    roles: { models: { v: { provider: 'ark', model: 'deepseek-v4-flash', reasoningEffort: 'high' } } },
    dispatcher: { staleTimeoutSeconds: 14400, maxRetries: 3, heartbeatIntervalSeconds: 300, maxProtocolViolations: 2, maxReworksPerRole: { pt: 2, dt: 3 } },
    prefixRoutes: { plan: '/plan:', openspec: '/openspec:', learning: '/learning' },
    memory: { enabled: true, maxIndexEntries: 8 },
    ui: { enabled: true, contentMinWidth: 715, contentMaxWidth: 780, sseHeartbeatSeconds: 20 },
    gates: { enabled: true, timeoutMs: 600000, forbidden: ['rm -rf /', 'git push'] },
    imDelivery: { enabled: false, botId: '', targetId: '' },
  };
}

describe('mergeConfig', () => {
  it('override 覆盖 baseline 可编辑字段，其余保持', () => {
    const out = mergeConfig(base(), { wikiVault: { baseUrl: 'http://9.9.9.9:1' } });
    expect(out.wikiVault.baseUrl).toBe('http://9.9.9.9:1');
    expect(out.wikiVault.pagePrefix).toBe('projects/');
    expect(out.roles.models.v).toEqual({ provider: 'ark', model: 'deepseek-v4-flash', reasoningEffort: 'high' });
    expect(out.storageDir).toBe('/tmp/kb');
  });
  it('roles.models 某角色 override 后 baseline 其他角色保留', () => {
    const out = mergeConfig(base(), { roles: { models: { d: { provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'medium' } } } });
    expect(out.roles.models.d).toEqual({ provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'medium' });
    expect(out.roles.models.v).toEqual({ provider: 'ark', model: 'deepseek-v4-flash', reasoningEffort: 'high' });
  });
  it('undefined override 返回 baseline 等价（且不修改入参对象）', () => {
    const b = base();
    const out = mergeConfig(b, undefined);
    expect(out).toEqual(b);
    expect(out).not.toBe(b);
    out.wikiVault.baseUrl = 'MUTATED';
    expect(b.wikiVault.baseUrl).toBe('http://10.0.0.1:3000');
  });
  it('mergeConfig 忽略空字符串 reasoningEffort（永不覆盖 baseline/默认）', () => {
    const out = mergeConfig(base(), { roles: { models: { v: { reasoningEffort: '' } } } });
    expect(out.roles.models.v).toEqual({ provider: 'ark', model: 'deepseek-v4-flash', reasoningEffort: 'high' });
  });
});

describe('computeSources', () => {
  it('未 override 的叶子全 inherited，命中 override 的叶子标 override', () => {
    const src = computeSources({ wikiVault: { baseUrl: 'http://x' }, roles: { models: { v: { model: 'm2' } } } });
    expect(src['wikiVault.baseUrl']).toBe('override');
    expect(src['wikiVault.pagePrefix']).toBe('inherited');
    expect(src['roles.models.v.model']).toBe('override');
    expect(src['roles.models.v.provider']).toBe('inherited');
    expect(src['roles.models.d.provider']).toBe('inherited');
  });
  it('undefined override → 全 inherited', () => {
    expect(Object.values(computeSources(undefined)).every((s) => s === 'inherited')).toBe(true);
  });
});

describe('validateConfig', () => {
  const ok = (): { wikiVault: { baseUrl: string; pagePrefix: string }; roles: { models: {} } } =>
    ({ wikiVault: { baseUrl: 'http://a', pagePrefix: 'x/' }, roles: { models: {} } });
  it('合法 → 空数组', () => {
    expect(validateConfig(ok() as never)).toEqual([]);
  });
  it('baseUrl 非法 → 报错路径；空 baseUrl = 本地 llm-wiki 回退，合法', () => {
    expect(validateConfig({ ...ok(), wikiVault: { baseUrl: 'not-a-url', pagePrefix: 'x/' } } as never))
      .toContain('wikiVault.baseUrl');
    expect(validateConfig({ ...ok(), wikiVault: { baseUrl: '', pagePrefix: 'x/' } } as never))
      .toEqual([]);
  });
  it('pagePrefix 空 → 报错路径', () => {
    expect(validateConfig({ ...ok(), wikiVault: { baseUrl: 'http://a', pagePrefix: '' } } as never))
      .toContain('wikiVault.pagePrefix');
  });
  it('provider/model 空 → 报错路径', () => {
    expect(validateConfig({ ...ok(), roles: { models: { v: { provider: '', model: 'm', reasoningEffort: 'high' } } } } as never))
      .toContain('roles.models.v.provider');
  });
  it('model 空 → 报错路径（roles.models.v.model 为空串）', () => {
    expect(validateConfig({ ...ok(), roles: { models: { v: { provider: 'p', model: '', reasoningEffort: 'high' } } } } as never))
      .toContain('roles.models.v.model');
  });
});

describe('projectEditable / diffOverride', () => {
  it('projectEditable 只取可编辑字段', () => {
    const s = projectEditable(mergeConfig(base(), undefined));
    expect(s.wikiVault).toEqual({ baseUrl: 'http://10.0.0.1:3000', pagePrefix: 'projects/' });
    expect(s.roles.models.v!.model).toBe('deepseek-v4-flash');
  });
  it('diffOverride 只保留与 baseline 不同的叶子', () => {
    const snap = projectEditable(base());
    const diff = diffOverride(base(), { ...snap, wikiVault: { ...snap.wikiVault, baseUrl: 'http://new' } });
    expect(diff.wikiVault!.baseUrl).toBe('http://new');
    expect(diff.wikiVault!.pagePrefix).toBeUndefined();
  });
  it('projectEditable 缺失 reasoningEffort 默认 high', () => {
    const b = base();
    b.roles.models = { v: { provider: 'ark', model: 'deepseek-v4-flash' } };
    const s = projectEditable(b);
    expect(s.roles.models.v!.reasoningEffort).toBe('high');
  });
  it('diffOverride 快照 reasoningEffort 为空串 → 不写入 override（唯一 diff 时不产生 roles）', () => {
    const snap = projectEditable(base());
    const diff = diffOverride(base(), {
      ...snap,
      roles: { models: { v: { provider: snap.roles.models.v!.provider, model: snap.roles.models.v!.model, reasoningEffort: '' } } },
    });
    expect(diff.roles?.models?.v?.reasoningEffort).toBeUndefined();
    expect(diff.roles).toBeUndefined();
  });
  it('diffOverride baseline reasoningEffort undefined 时空值不得胜出', () => {
    const b = base();
    b.roles.models = { v: { provider: 'ark', model: 'deepseek-v4-flash' } };
    const diff = diffOverride(b, {
      wikiVault: b.wikiVault,
      roles: { models: { v: { provider: 'ark', model: 'deepseek-v4-flash', reasoningEffort: '  ' } } },
    });
    expect(diff.roles).toBeUndefined();
  });
  it('ROLES 含 6 角色', () => {
    expect(ROLES).toEqual(['v', 'p', 'w', 'd', 'pt', 'dt']);
  });
});

describe('imDelivery config pass-through', () => {
  it('mergeConfig 透传 imDelivery（override 不含该段时保留 baseline 值）', () => {
    const baseline = {
      storageDir: '/s',
      wikiVault: { baseUrl: '', pagePrefix: 'projects/' },
      roles: { models: {} },
      dispatcher: { staleTimeoutSeconds: 1, maxRetries: 1, heartbeatIntervalSeconds: 1, maxProtocolViolations: 2, maxReworksPerRole: { pt: 3, dt: 3 } },
      prefixRoutes: { plan: '/plan:', openspec: '/openspec:', learning: '/learning' },
      memory: { enabled: true, maxIndexEntries: 8 },
      ui: { enabled: true, contentMinWidth: 715, contentMaxWidth: 780, sseHeartbeatSeconds: 20 },
      gates: { enabled: true, timeoutMs: 600000, forbidden: [] },
      imDelivery: { enabled: true, botId: 'b', targetId: 't' },
    } as KanbanConfig;
    const merged = mergeConfig(baseline, {});
    expect(merged.imDelivery).toEqual({ enabled: true, botId: 'b', targetId: 't' });
  });
});
