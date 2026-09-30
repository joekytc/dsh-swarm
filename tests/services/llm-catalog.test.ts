import { describe, it, expect } from 'vitest';
import { buildLlmCatalog, filterCandidatesByCatalog, type LlmRuntimeLike } from '../../src/services/llm-catalog.js';

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

describe('filterCandidatesByCatalog（派发/保存前候选预校验）', () => {
  const runtime: LlmRuntimeLike = {
    listProviders: () => [{ id: 'jz', name: 'JZ' }, { id: 'ark', name: 'Ark' }],
    listModels: async (p) => (p === 'jz'
      ? [{ id: 'gpt-5.6-luna', name: 'Luna' }]
      : [{ id: 'deepseek-v4-flash', name: 'DS V4 Flash' }]),
    resolveModelInfo: async (p, m) => (p === 'jz' && m === 'gpt-5.6-luna'
      ? { reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }, { id: 'xhigh', name: 'XHigh' }] } }
      : {}),
  };

  it('provider 未配置 → rejected（跨层拼接死组合的拦截点）', async () => {
    const r = await filterCandidatesByCatalog(runtime, [{ provider: 'openai', model: 'gpt-5.6-sol' }]);
    expect(r.ok).toHaveLength(0);
    expect(r.rejected[0].reason).toContain('provider "openai" 未配置');
  });
  it('provider 存在但 model 不属于该 provider → rejected', async () => {
    const r = await filterCandidatesByCatalog(runtime, [{ provider: 'jz', model: 'deepseek-v4-flash' }]);
    expect(r.ok).toHaveLength(0);
    expect(r.rejected[0].reason).toContain('无模型 "deepseek-v4-flash"');
  });
  it('reasoningEffort 不在模型声明集 → rejected', async () => {
    const r = await filterCandidatesByCatalog(runtime, [{ provider: 'jz', model: 'gpt-5.6-luna', reasoningEffort: 'max' }]);
    expect(r.ok).toHaveLength(0);
    expect(r.rejected[0].reason).toContain('reasoningEffort "max"');
    expect(r.rejected[0].reason).toContain('off/high/xhigh');
  });
  it('合法组合 → ok；effort 缺省（undefined）→ 跳过 effort 把关', async () => {
    const r = await filterCandidatesByCatalog(runtime, [
      { provider: 'jz', model: 'gpt-5.6-luna', reasoningEffort: 'high' },
      { provider: 'ark', model: 'deepseek-v4-flash' },
    ]);
    expect(r.rejected).toHaveLength(0);
    expect(r.ok).toHaveLength(2);
  });
  it('effort 声明集为空（探测降级）→ 跳过 effort 把关不误杀', async () => {
    const r = await filterCandidatesByCatalog(runtime, [{ provider: 'ark', model: 'deepseek-v4-flash', reasoningEffort: 'ultra' }]);
    expect(r.rejected).toHaveLength(0);
    expect(r.ok).toHaveLength(1);
  });
  it('runtime 缺失 → 全部放行（fail-open）', async () => {
    const r = await filterCandidatesByCatalog(undefined, [{ provider: 'x', model: 'y' }]);
    expect(r.ok).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });
  it('listProviders 抛错（目录不可达）→ 全部放行（fail-open，网络抖动 ≠ 配置错误）', async () => {
    const broken: LlmRuntimeLike = { ...runtime, listProviders: () => { throw new Error('gateway down'); } };
    const r = await filterCandidatesByCatalog(broken, [{ provider: 'jz', model: 'gpt-5.6-luna' }]);
    expect(r.ok).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });
  it('单候选 listModels 抛错 → 该候选放行（fail-open），其余候选照常校验', async () => {
    const partial: LlmRuntimeLike = { ...runtime, listModels: async (p) => { if (p === 'jz') throw new Error('boom'); return [{ id: 'deepseek-v4-flash', name: 'DS' }]; } };
    const r = await filterCandidatesByCatalog(partial, [
      { provider: 'jz', model: 'gpt-5.6-luna' },
      { provider: 'ark', model: 'nope' },
    ]);
    expect(r.ok.map((c) => c.provider)).toEqual(['jz']);
    expect(r.rejected.map((c) => c.candidate.provider)).toEqual(['ark']);
  });
});
