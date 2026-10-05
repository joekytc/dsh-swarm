export const ROLES = ['v', 'p', 'w', 'd', 'pt', 'dt'];
/** botId 形态（与 dsh-im 的 id 校验同口径）：非空时只允许 id 安全字符。 */
const BOT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MODEL_FIELDS = ['provider', 'model', 'reasoningEffort'];
/** 单角色降级候选上限（与 config schema .max(2)、GUI 上限同口径）。 */
export const MAX_FALLBACKS = 2;
/** 降级候选归一化：全空行丢弃（GUI 占位行）、effort 空白补 'high'、部分填写行保留（交校验报错）。 */
function normalizeFallbacks(list) {
    return (list ?? [])
        .filter((f) => (f?.provider ?? '').trim() || (f?.model ?? '').trim())
        .map((f) => ({
        provider: (f.provider ?? '').trim(),
        model: (f.model ?? '').trim(),
        reasoningEffort: f.reasoningEffort?.trim() ? f.reasoningEffort : 'high',
    }));
}
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
        if (over.fallbacks !== undefined)
            cur.fallbacks = normalizeFallbacks(over.fallbacks);
        if (cur.provider && cur.model)
            models[role] = cur;
    }
    const imDelivery = { ...baseline.imDelivery };
    if (override?.imDelivery?.fallbackBotId !== undefined)
        imDelivery.fallbackBotId = override.imDelivery.fallbackBotId;
    // chainFallback 只属 baseline（部署配置），override 不触碰。
    return { ...baseline, wikiVault: wiki, roles: { ...baseline.roles, models }, reviewEngine, imDelivery };
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
        src[`roles.models.${role}.fallbacks`] = override?.roles?.models?.[role]?.fallbacks !== undefined ? 'override' : 'inherited';
    }
    src['reviewEngine.mode'] = override?.reviewEngine?.mode !== undefined ? 'override' : 'inherited';
    src['reviewEngine.managed.provider'] = override?.reviewEngine?.managed?.provider !== undefined ? 'override' : 'inherited';
    src['reviewEngine.managed.model'] = override?.reviewEngine?.managed?.model !== undefined ? 'override' : 'inherited';
    src['imDelivery.fallbackBotId'] = override?.imDelivery?.fallbackBotId !== undefined ? 'override' : 'inherited';
    return src;
}
export function projectEditable(effective) {
    const models = {};
    for (const role of ROLES) {
        const m = effective.roles.models?.[role];
        if (m?.provider && m?.model) {
            models[role] = {
                provider: m.provider, model: m.model, reasoningEffort: m.reasoningEffort ?? 'high',
                fallbacks: normalizeFallbacks(m.fallbacks),
            };
        }
    }
    const cf = effective.roles.chainFallback;
    return {
        wikiVault: { baseUrl: effective.wikiVault.baseUrl, pagePrefix: effective.wikiVault.pagePrefix },
        roles: { models },
        chainFallback: {
            provider: cf?.provider ?? '', model: cf?.model ?? '',
            reasoningEffort: cf?.reasoningEffort?.trim() ? cf.reasoningEffort : 'high',
        },
        reviewEngine: {
            mode: effective.reviewEngine?.mode ?? 'delegate',
            managed: { provider: effective.reviewEngine?.managed?.provider ?? '', model: effective.reviewEngine?.managed?.model ?? '' },
        },
        imDelivery: { fallbackBotId: effective.imDelivery?.fallbackBotId ?? '' },
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
        const fbs = m.fallbacks ?? [];
        if (fbs.length > MAX_FALLBACKS)
            errs.push(`roles.models.${role}.fallbacks`);
        fbs.forEach((f, i) => {
            const p = (f?.provider ?? '').trim();
            const mm = (f?.model ?? '').trim();
            // 全空行 = GUI 占位（合法）；部分填写 = 未完成编辑，报错阻断。
            if (!p && !mm)
                return;
            if (!p || !mm)
                errs.push(`roles.models.${role}.fallbacks.${i}`);
        });
    }
    // 默认机器人：留空=未设默认（合法，语义为「未命中就交互」）；非空必须形如 dsh-im 的 botId。
    const fb = (snapshot.imDelivery?.fallbackBotId ?? '').trim();
    if (fb && !BOT_ID_RE.test(fb))
        errs.push('imDelivery.fallbackBotId');
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
        // 降级链按归一化后整体比较：变化才整组写入。缺字段=显式空链（清空语义）；
        // 旧客户端兼容由 HTTP 保存口回填 effective 链，不在此特判。
        if (snap) {
            const snapFbs = normalizeFallbacks(snap.fallbacks);
            if (JSON.stringify(snapFbs) !== JSON.stringify(normalizeFallbacks(base?.fallbacks)))
                cur.fallbacks = snapFbs;
        }
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
    const bFb = (baseline.imDelivery?.fallbackBotId ?? '').trim();
    const sFb = (snapshot.imDelivery?.fallbackBotId ?? '').trim();
    if (sFb !== bFb)
        out.imDelivery = { fallbackBotId: sFb };
    return out;
}
