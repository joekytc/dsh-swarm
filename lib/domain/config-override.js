export const ROLES = ['v', 'p', 'w', 'd', 'pt', 'dt'];
const MODEL_FIELDS = ['provider', 'model', 'reasoningEffort'];
export function mergeConfig(baseline, override) {
    const wiki = { ...baseline.wikiVault };
    if (override?.wikiVault?.baseUrl !== undefined)
        wiki.baseUrl = override.wikiVault.baseUrl;
    if (override?.wikiVault?.pagePrefix !== undefined)
        wiki.pagePrefix = override.wikiVault.pagePrefix;
    const reviewEngine = {
        mode: baseline.reviewEngine?.mode ?? 'delegate',
        managed: { provider: baseline.reviewEngine?.managed?.provider ?? '', model: baseline.reviewEngine?.managed?.model ?? '' },
    };
    if (override?.reviewEngine?.mode !== undefined)
        reviewEngine.mode = override.reviewEngine.mode;
    if (override?.reviewEngine?.managed?.provider !== undefined)
        reviewEngine.managed.provider = override.reviewEngine.managed.provider;
    if (override?.reviewEngine?.managed?.model !== undefined)
        reviewEngine.managed.model = override.reviewEngine.managed.model;
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
    return { ...baseline, wikiVault: wiki, roles: { ...baseline.roles, models }, reviewEngine };
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
    src['reviewEngine.mode'] = override?.reviewEngine?.mode !== undefined ? 'override' : 'inherited';
    src['reviewEngine.managed.provider'] = override?.reviewEngine?.managed?.provider !== undefined ? 'override' : 'inherited';
    src['reviewEngine.managed.model'] = override?.reviewEngine?.managed?.model !== undefined ? 'override' : 'inherited';
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
        reviewEngine: {
            mode: effective.reviewEngine?.mode ?? 'delegate',
            managed: { provider: effective.reviewEngine?.managed?.provider ?? '', model: effective.reviewEngine?.managed?.model ?? '' },
        },
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
    // 就绪性（managed provider/model 是否已配好）是运行时探测，不在此校验；仅 mode 枚举把关。
    const reMode = snapshot.reviewEngine?.mode;
    if (reMode !== 'delegate' && reMode !== 'managed')
        errs.push('reviewEngine.mode');
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
    const bre = baseline.reviewEngine ?? { mode: 'delegate', managed: { provider: '', model: '' } };
    const snapMode = snapshot.reviewEngine?.mode ?? 'delegate';
    const snapProvider = snapshot.reviewEngine?.managed?.provider ?? '';
    const snapModel = snapshot.reviewEngine?.managed?.model ?? '';
    const re = {};
    if (snapMode !== bre.mode)
        re.mode = snapMode;
    const reManaged = {};
    if (snapProvider !== bre.managed.provider)
        reManaged.provider = snapProvider;
    if (snapModel !== bre.managed.model)
        reManaged.model = snapModel;
    if (Object.keys(reManaged).length)
        re.managed = reManaged;
    if (Object.keys(re).length)
        out.reviewEngine = re;
    return out;
}
