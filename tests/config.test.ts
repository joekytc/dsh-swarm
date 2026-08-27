import { describe, it, expect } from 'vitest';
import { Config, type KanbanConfig } from '../src/config.js';

describe('kanban config', () => {
  it('dispatcher defaults maxProtocolViolations=2 maxReworksPerRole pt=2 dt=3', () => {
    const cfg = Config({} as KanbanConfig);
    expect(cfg.dispatcher.maxProtocolViolations).toBe(2);
    expect(cfg.dispatcher.maxReworksPerRole).toEqual({ pt: 2, dt: 3 });
  });

  it('roles.models item defaults reasoningEffort high and empty fallbacks', () => {
    const cfg = Config({ roles: { models: { d: { provider: 'ark', model: 'deepseek-v4-flash' } } } } as KanbanConfig);
    expect(cfg.roles.models.d?.reasoningEffort).toBe('high');
    expect(cfg.roles.models.d?.fallbacks).toEqual([]);
  });

  it('memory defaults enabled=true maxIndexEntries=8; prefixRoutes.learning=/learning:', () => {
    const cfg = Config({} as KanbanConfig);
    expect(cfg.memory).toEqual({ enabled: true, maxIndexEntries: 8 });
    expect(cfg.prefixRoutes.learning).toBe('/learning:');
  });
});
