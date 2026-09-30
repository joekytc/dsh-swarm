export interface CatalogProvider { id: string; name: string; }
export interface CatalogModel { id: string; name: string; efforts: Array<{ id: string; name: string }>; }
export interface LlmCatalog { providers: CatalogProvider[]; models: Record<string, CatalogModel[]>; }

export interface LlmRuntimeLike {
  listProviders(): Array<{ id: string; name: string }>;
  listModels(provider: string): Promise<Array<{ id: string; name: string }>>;
  resolveModelInfo(provider: string, model: string): Promise<{ reasoning?: { efforts?: Array<{ id: string; name: string }> } }>;
}

export async function buildLlmCatalog(llm: LlmRuntimeLike): Promise<LlmCatalog> {
  const providers: CatalogProvider[] = llm.listProviders().map((p) => ({ id: p.id, name: p.name }));
  const models: Record<string, CatalogModel[]> = {};
  for (const p of providers) {
    const list = await llm.listModels(p.id);
    const entries: CatalogModel[] = [];
    for (const m of list) {
      let efforts: Array<{ id: string; name: string }> = [];
      try {
        const info = await llm.resolveModelInfo(p.id, m.id);
        efforts = (info.reasoning?.efforts ?? []).map((e) => ({ id: e.id, name: e.name }));
      } catch { /* effort 解析失败 → 空 */ }
      entries.push({ id: m.id, name: m.name, efforts });
    }
    models[p.id] = entries;
  }
  return { providers, models };
}

/** 候选模型（与 dispatcher AgentModelOptions 结构同形；不 import 防环）。 */
export interface ModelCandidateLike { provider: string; model: string; reasoningEffort?: string }

export interface CandidateReject { candidate: ModelCandidateLike; reason: string }

/** 派发/保存前候选预校验：provider 已配置、model 属该 provider、reasoningEffort ∈ 模型声明集。
 *  fail-open 原则：运行时缺失、provider 枚举失败、单候选探测异常一律放行——只拦「确实查到
 *  不匹配」的组合，目录不可达（网络抖动）≠ 配置错误，不应阻断派发/保存。
 *  effort 声明集为空（resolveModelInfo 降级）时跳过 effort 把关。 */
export async function filterCandidatesByCatalog(
  runtime: LlmRuntimeLike | undefined,
  candidates: readonly ModelCandidateLike[],
): Promise<{ ok: ModelCandidateLike[]; rejected: CandidateReject[] }> {
  if (!runtime || candidates.length === 0) return { ok: [...candidates], rejected: [] };
  let providerIds: Set<string>;
  try {
    providerIds = new Set(runtime.listProviders().map((p) => p.id));
  } catch {
    return { ok: [...candidates], rejected: [] };
  }
  const ok: ModelCandidateLike[] = [];
  const rejected: CandidateReject[] = [];
  for (const c of candidates) {
    try {
      if (!providerIds.has(c.provider)) {
        rejected.push({ candidate: c, reason: `provider "${c.provider}" 未配置` });
        continue;
      }
      const models = await runtime.listModels(c.provider);
      if (!models.some((m) => m.id === c.model)) {
        rejected.push({ candidate: c, reason: `provider "${c.provider}" 无模型 "${c.model}"` });
        continue;
      }
      const info = await runtime.resolveModelInfo(c.provider, c.model).catch(() => undefined);
      const efforts = (info?.reasoning?.efforts ?? []).map((e) => e.id);
      if (efforts.length > 0 && c.reasoningEffort && !efforts.includes(c.reasoningEffort)) {
        rejected.push({ candidate: c, reason: `模型 "${c.model}" 不支持 reasoningEffort "${c.reasoningEffort}"（声明：${efforts.join('/')}）` });
        continue;
      }
      ok.push(c);
    } catch {
      ok.push(c); // 单候选探测异常 fail-open
    }
  }
  return { ok, rejected };
}
