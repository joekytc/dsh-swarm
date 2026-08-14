import { describe, it, expect } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { Config, type KanbanConfig } from '../../src/config.js';
import { apply, name } from '../../src/index.js';

const cfg = Config({} as KanbanConfig); // schema 校验 + 默认值

describe('kanban plugin', () => {
  it('has plugin name and config defaults', () => {
    expect(name).toBe('dsh-kanban');
    expect(cfg.dispatcher.maxRetries).toBe(3);
    expect(cfg.prefixRoutes.plan).toBe('/plan:');
    expect(cfg.wikiVault.baseUrl).toBe('http://192.168.122.111:3000');
  });
  it('apply mounts without throwing', async () => {
    const ctx = new Context();
    apply(ctx, cfg);
    expect(ctx.get('kanban')).toBeDefined();
  });
});
