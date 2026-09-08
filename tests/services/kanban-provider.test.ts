import { describe, it, expect } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config, type KanbanConfig } from '../../src/config.js';
import { apply, name } from '../../src/index.js';
import { ConfigProvider } from '../../src/services/config-provider.js';
import { KanbanProvider } from '../../src/services/kanban-provider.js';

const cfg = Config({} as KanbanConfig); // schema 校验 + 默认值

describe('kanban plugin', () => {
  it('has plugin name and config defaults', () => {
    expect(name).toBe('dsh-swarm');
    expect(cfg.dispatcher.maxRetries).toBe(3);
    expect(cfg.prefixRoutes.plan).toBe('/plan:');
    expect(cfg.wikiVault.baseUrl).toBe(''); // c5887a7：wikiVault.baseUrl 默认置空
  });
  it('apply mounts without throwing', async () => {
    const ctx = new Context();
    apply(ctx, cfg);
    expect(ctx.get('kanban')).toBeDefined();
  });
  it('KanbanProvider 构造 (ctx, config, configProvider)：kb_url base 经 getter 读 effective 配置', () => {
    const ctx = new Context();
    const dir = mkdtempSync(join(tmpdir(), 'kbp-'));
    try {
      const configProvider = new ConfigProvider(ctx, cfg, dir);
      const provider = new KanbanProvider(ctx, cfg, configProvider);
      expect(provider.service).toBeDefined();
      // 改 override 后 getter 读到新 effective 配置（热生效语义：值在调用时才取）
      const applyRes = configProvider.applyOverride({ wikiVault: { baseUrl: 'http://hot', pagePrefix: 'projects/' }, roles: { models: {} }, reviewEngine: { mode: 'delegate', managed: { provider: '', model: '' } } });
      expect(applyRes.ok).toBe(true);
      expect(configProvider.getEffective().wikiVault?.baseUrl).toBe('http://hot');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
