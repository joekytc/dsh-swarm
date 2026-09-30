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
/** 派发/保存前候选预校验：provider 已配置、model 属该 provider、reasoningEffort ∈ 模型声明集。
 *  fail-open 原则：运行时缺失、provider 枚举失败、单候选探测异常一律放行——只拦「确实查到
 *  不匹配」的组合，目录不可达（网络抖动）≠ 配置错误，不应阻断派发/保存。
 *  effort 声明集为空（resolveModelInfo 降级）时跳过 effort 把关。 */
export async function filterCandidatesByCatalog(runtime, candidates) {
    if (!runtime || candidates.length === 0)
        return { ok: [...candidates], rejected: [] };
    let providerIds;
    try {
        providerIds = new Set(runtime.listProviders().map((p) => p.id));
    }
    catch {
        return { ok: [...candidates], rejected: [] };
    }
    const ok = [];
    const rejected = [];
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
        }
        catch {
            ok.push(c); // 单候选探测异常 fail-open
        }
    }
    return { ok, rejected };
}
