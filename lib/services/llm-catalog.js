export async function buildLlmCatalog(llm) {
    const providers = llm.listProviders().map((p) => ({ id: p.id, name: p.name }));
    const models = {};
    for (const p of providers) {
        const list = await llm.listModels(p.id);
        const entries = [];
        for (const m of list) {
            let efforts = [];
            try {
                const info = await llm.resolveModelInfo(p.id, m.id);
                efforts = (info.reasoning?.efforts ?? []).map((e) => ({ id: e.id, name: e.name }));
            }
            catch { /* effort 解析失败 → 空 */ }
            entries.push({ id: m.id, name: m.name, efforts });
        }
        models[p.id] = entries;
    }
    return { providers, models };
}
