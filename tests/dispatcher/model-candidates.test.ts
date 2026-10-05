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

  it('appends global official fallback as chain tail after primary + fallbacks', () => {
    const cfg = {
      roles: {
        models: {
          d: {
            provider: 'ark', model: 'deepseek-v4-flash',
            fallbacks: [{ provider: 'openai', model: 'gpt-5.6-sol' }],
          },
        },
        chainFallback: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
      },
    } as KanbanConfig;
    const chain = buildModelCandidates(cfg, 'd');
    expect(chain.map((c) => `${c.provider}/${c.model}`)).toEqual([
      'ark/deepseek-v4-flash', 'openai/gpt-5.6-sol', 'deepseek-account/deepseek-flash',
    ]);
  });

  it('role chain empty → official fallback as single candidate; official also empty → host default model', () => {
    const withOfficial = { roles: { models: {}, chainFallback: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' } } } as KanbanConfig;
    expect(buildModelCandidates(withOfficial, 'v').map((c) => `${c.provider}/${c.model}`))
      .toEqual(['deepseek-account/deepseek-flash']);
    expect(buildModelCandidates(withOfficial, 'v')[0]!.reasoningEffort).toBe('high');

    const noOfficial = { roles: { models: {}, chainFallback: { provider: '', model: '', reasoningEffort: 'high' } } } as KanbanConfig;
    expect(buildModelCandidates(noOfficial, 'p', { provider: 'jz', model: 'gpt-5.6-luna' }).map((c) => `${c.provider}/${c.model}`))
      .toEqual(['jz/gpt-5.6-luna']);
    expect(buildModelCandidates(noOfficial, 'p')).toEqual([]);
  });

  it('caps fallbacks at 2 (defensive against hand-edited override/config)', () => {
    const cfg = {
      roles: {
        models: {
          d: {
            provider: 'ark', model: 'deepseek-v4-flash',
            fallbacks: [
              { provider: 'a', model: 'm1' }, { provider: 'b', model: 'm2' }, { provider: 'c', model: 'm3' },
            ],
          },
        },
        chainFallback: { provider: 'deepseek-account', model: 'deepseek-flash' },
      },
    } as KanbanConfig;
    const chain = buildModelCandidates(cfg, 'd');
    expect(chain).toHaveLength(4); // primary + 2 降级 + 官方兜底
    expect(chain.map((c) => c.model)).toEqual(['deepseek-v4-flash', 'm1', 'm2', 'deepseek-flash']);
  });

  it('classifies credential-missing errors (official account not logged in) as candidate-unavailable', () => {
    expect(isModelUnavailableError(new Error('MISSING_CREDENTIAL: official account not logged in'))).toBe(true);
    expect(isModelUnavailableError(new Error('please login to deepseek-account first'))).toBe(true);
    expect(isModelUnavailableError(new Error('invalid credentials for provider openai'))).toBe(true);
    expect(isModelUnavailableError(new Error('未登录：请先完成官方账号登录'))).toBe(true);
    expect(isModelUnavailableError(new Error('quota exceeded'))).toBe(false);
  });
});
