import { describe, it, expect } from 'vitest';
import { buildLlmCatalog, type LlmRuntimeLike } from '../../src/services/llm-catalog.js';

describe('buildLlmCatalog', () => {
  it('枚举 provider/model/efforts，模型无 reasoning 时 efforts 空', async () => {
    const llm: LlmRuntimeLike = {
      listProviders: () => [{ id: 'ark', name: 'Ark' }],
      listModels: async () => [
        { id: 'deepseek-v4-flash', name: 'DS V4 Flash' },
        { id: 'no-reason', name: 'NoReason' },
      ],
      resolveModelInfo: async (_p, m) => m === 'deepseek-v4-flash'
        ? ({ reasoning: { efforts: [{ id: 'high', name: 'High' }] } } as never)
        : ({} as never),
    };
    const c = await buildLlmCatalog(llm);
    expect(c.providers).toEqual([{ id: 'ark', name: 'Ark' }]);
    expect(c.models.ark).toHaveLength(2);
    expect(c.models.ark[0].efforts).toEqual([{ id: 'high', name: 'High' }]);
    expect(c.models.ark[1].efforts).toEqual([]);
  });
  it('resolveModelInfo 抛错 → 该 model efforts 空且不中断', async () => {
    const llm: LlmRuntimeLike = {
      listProviders: () => [{ id: 'ark', name: 'Ark' }],
      listModels: async () => [{ id: 'm', name: 'M' }],
      resolveModelInfo: async () => { throw new Error('boom'); },
    };
    const c = await buildLlmCatalog(llm);
    expect(c.models.ark[0].efforts).toEqual([]);
  });
});
