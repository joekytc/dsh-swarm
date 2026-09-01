export const ROLES = ['v', 'p', 'w', 'd', 'pt', 'dt'];
const MODEL_FIELDS = ['provider', 'model', 'reasoningEffort'];
export function mergeConfig(baseline, override) {
    const wiki = { ...baseline.wikiVault };
    if (override?.wikiVault?.baseUrl !== undefined)
        wiki.baseUrl = override.wikiVault.baseUrl;
    if (override?.wikiVault?.pagePrefix !== undefined)
        wiki.pagePrefix = override.wikiVault.pagePrefix;
    const models = { ...baseline.roles.models };
    for (const role of ROLES) {
        const base = baseline.roles.models?.[role];
        const over = override?.roles?.models?.[role];
        if (!over)
            continue;
        const cur = { ...base };
        if (over.provider !== undefined)
            cur.provider = over.provider;
        if (over.model !== undefined)
            cur.model = over.model;
        // 防御：空字符串 reasoningEffort 视为"未设置"，永不覆盖 baseline/默认（读点回退 'high'）。
        if (over.reasoningEffort !== undefined && over.reasoningEffort.trim() !== '')
            cur.reasoningEffort = over.reasoningEffort;
        if (cur.provider && cur.model)
            models[role] = cur;
    }
    return { ...baseline, wikiVault: wiki, roles: { ...baseline.roles, models } };
}
export function computeSources(override) {
    const src = {};
    for (const k of ['wikiVault.baseUrl', 'wikiVault.pagePrefix']) {
        const hit = k === 'wikiVault.baseUrl' ? override?.wikiVault?.baseUrl !== undefined : override?.wikiVault?.pagePrefix !== undefined;
        src[k] = hit ? 'override' : 'inherited';
    }
    for (const role of ROLES) {
        for (const f of MODEL_FIELDS) {
            const hit = override?.roles?.models?.[role]?.[f] !== undefined;
            src[`roles.models.${role}.${f}`] = hit ? 'override' : 'inherited';
        }
    }
    return src;
}
export function projectEditable(effective) {
    const models = {};
    for (const role of ROLES) {
        const m = effective.roles.models?.[role];
        if (m?.provider && m?.model)
            models[role] = { provider: m.provider, model: m.model, reasoningEffort: m.reasoningEffort ?? 'high' };
    }
    return {
        wikiVault: { baseUrl: effective.wikiVault.baseUrl, pagePrefix: effective.wikiVault.pagePrefix },
        roles: { models },
    };
}
export function validateConfig(snapshot) {
    const errs = [];
    const baseUrl = snapshot.wikiVault.baseUrl ?? '';
    // 空 baseUrl = 本地 llm-wiki 回退（合法）；仅非空时校验 ^https?://。
    if (baseUrl.trim() && !/^https?:\/\//.test(baseUrl))
        errs.push('wikiVault.baseUrl');
    if (!(snapshot.wikiVault.pagePrefix ?? '').trim())
        errs.push('wikiVault.pagePrefix');
    for (const role of ROLES) {
        const m = snapshot.roles.models[role];
        if (!m)
            continue;
        if (!m.provider?.trim())
            errs.push(`roles.models.${role}.provider`);
        if (!m.model?.trim())
            errs.push(`roles.models.${role}.model`);
    }
    return errs;
}
export function diffOverride(baseline, snapshot) {
    const out = {};
    const w = {};
    if (snapshot.wikiVault.baseUrl !== baseline.wikiVault.baseUrl)
        w.baseUrl = snapshot.wikiVault.baseUrl;
    if (snapshot.wikiVault.pagePrefix !== baseline.wikiVault.pagePrefix)
        w.pagePrefix = snapshot.wikiVault.pagePrefix;
    if (Object.keys(w).length)
        out.wikiVault = w;
    const models = {};
    for (const role of ROLES) {
        const snap = snapshot.roles.models[role];
        const base = baseline.roles.models?.[role];
        const cur = {};
        if (snap && snap.provider !== base?.provider)
            cur.provider = snap.provider;
        if (snap && snap.model !== base?.model)
            cur.model = snap.model;
        // 空/空白 reasoningEffort 视为"跟随默认"：不写入 override，effective 保持 baseline/默认。
        const snapEffort = snap?.reasoningEffort?.trim() ? snap.reasoningEffort : undefined;
        if (snapEffort !== undefined && snapEffort !== (base?.reasoningEffort ?? 'high'))
            cur.reasoningEffort = snapEffort;
        if (Object.keys(cur).length)
            models[role] = cur;
    }
    if (Object.keys(models).length)
        out.roles = { models: models };
    return out;
}
