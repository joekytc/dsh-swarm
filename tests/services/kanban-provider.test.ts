import { describe, it, expect } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { Config, type KanbanConfig } from '../../src/config.js';
import { apply, name } from '../../src/index.js';

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
});
