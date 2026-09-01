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
