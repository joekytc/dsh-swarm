import { describe, it, expect } from 'vitest';
import { buildModelCandidates, isModelUnavailableError } from '../../src/dispatcher/model-candidates.js';
import type { KanbanConfig } from '../../src/config.js';

describe('model candidate chain (Task 12)', () => {
  it('defaults reasoningEffort to high when unspecified', () => {
    const cfg = { roles: { models: { d: { provider: 'ark', model: 'deepseek-v4-flash' } } } } as KanbanConfig;
    const chain = buildModelCandidates(cfg, 'd');
    expect(chain).toHaveLength(1);
    expect(chain[0]!.reasoningEffort).toBe('high');
  });

  it('builds primary + fallbacks in order with high effort', () => {
    const cfg = {
      roles: {
        models: {
          d: {
            provider: 'ark', model: 'deepseek-v4-flash',
            fallbacks: [{ provider: 'openai', model: 'gpt-5.6-sol' }],
          },
        },
      },
    } as KanbanConfig;
    const chain = buildModelCandidates(cfg, 'd');
    expect(chain.map((c) => c.model)).toEqual(['deepseek-v4-flash', 'gpt-5.6-sol']);
    expect(chain.every((c) => c.reasoningEffort === 'high')).toBe(true);
  });

  it('falls back to defaultModel when role not configured', () => {
    const cfg = { roles: { models: {} } } as KanbanConfig;
    const chain = buildModelCandidates(cfg, 'p', { provider: 'openai', model: 'gpt-5.6-sol' });
    expect(chain.map((c) => c.model)).toEqual(['gpt-5.6-sol']);
    expect(chain[0]!.reasoningEffort).toBe('high');
  });

  it('returns empty when nothing configured', () => {
    expect(buildModelCandidates({ roles: { models: {} } } as KanbanConfig, 'v')).toEqual([]);
  });

  it('classifies model-unavailable errors for silent fallback', () => {
    expect(isModelUnavailableError(new Error('model unavailable: ark/deepseek-v4-flash'))).toBe(true);
    expect(isModelUnavailableError(new Error('no adapter registered for provider openai'))).toBe(true);
    expect(isModelUnavailableError(new Error('boom: bad request'))).toBe(false);
    expect(isModelUnavailableError(new Error('model not found'))).toBe(true);
  });
});
