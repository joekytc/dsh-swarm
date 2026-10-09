import { buildModelCandidates } from './model-candidates.js';
import { agentPresetSelected } from './session-events.js';
const chainStates = new WeakMap();
export function registerModelChain(agent, state) {
    chainStates.set(agent, state);
    const session = agent.session;
    if (session && typeof session === 'object')
        chainStates.set(session, state);
}
export function isSwitchableModelFailure(failure) {
    const code = String(failure.code ?? '').toLowerCase();
    const msg = String(failure.message ?? '').toLowerCase();
    if (code.includes('quota'))
        return true;
    if (failure.status === 402 || failure.status === 429)
        return true;
    if (/insufficient balance|quota|rate.?limit|\b429\b/.test(msg))
        return true;
    if (code === 'unknown_model' || code === 'unsupported_reasoning_effort')
        return true;
    if (code.includes('credential') || code.includes('login'))
        return true;
    if (msg.includes('adapter'))
        return true;
    if (msg.includes('missing_credential') || msg.includes('credentials') || msg.includes('login') || msg.includes('登录'))
        return true;
    if (msg.includes('provider') && (msg.includes('unavailable') || msg.includes('not') || msg.includes('fail')))
        return true;
    return msg.includes('model') && (msg.includes('unavailable') || msg.includes('not found') || msg.includes('no adapter'));
}
const ROLE_IDS = new Set(['v', 'p', 'w', 'd', 'pt', 'dt']);
function sessionEventsOf(session) {
    const s = session;
    if (typeof s?.snapshotEvents === 'function')
        return s.snapshotEvents();
    return s?.events ?? [];
}
function detectManualChain(agent, config) {
    const session = agent.session;
    const preset = agentPresetSelected(sessionEventsOf(session))
        ?? (session?.header?.agentPreset ?? null);
    const role = typeof preset === 'string' && preset.startsWith('kanban-') ? preset.slice('kanban-'.length) : '';
    let state = null;
    if (ROLE_IDS.has(role)) {
        const m = config.roles?.models?.[role];
        if (m?.provider && m?.model) {
            const candidates = buildModelCandidates(config, role);
            if (candidates.length > 0)
                state = { candidates, index: 0 };
        }
    }
    chainStates.set(agent, state);
    return state;
}
function resolveState(agent, config) {
    const session = agent.session;
    for (const key of [agent, session]) {
        if (key && typeof key === 'object' && chainStates.has(key))
            return chainStates.get(key) ?? null;
    }
    return detectManualChain(agent, config);
}
export function installModelChainHooks(scope, deps) {
    const scoped = scope;
    const disposeRequest = scoped.on('agent/request', async (payload, next) => {
        const resolved = (await next());
        const agent = payload.agent;
        if (!agent || typeof agent !== 'object')
            return resolved;
        const state = resolveState(agent, deps.getConfig());
        const cur = state?.candidates[state.index];
        if (!cur)
            return resolved;
        return { ...resolved, provider: cur.provider, model: cur.model, reasoningEffort: cur.reasoningEffort ?? 'high' };
    });
    const disposeError = scoped.on('agent/request-error', async (payload, next) => {
        const p = payload;
        const agent = p.agent;
        if (!agent || typeof agent !== 'object')
            return next();
        const state = resolveState(agent, deps.getConfig());
        if (!state)
            return next();
        if (!isSwitchableModelFailure(p.failure ?? {}))
            return next();
        const nextIndex = state.index + 1;
        if (nextIndex >= state.candidates.length)
            return next();
        const prev = state.candidates[state.index];
        state.index = nextIndex;
        const cur = state.candidates[nextIndex];
        const detail = String(p.failure?.code ?? '') + ' ' + String(p.failure?.message ?? '');
        const line = '[model-fallback] ' + prev.provider + '/' + prev.model + ' → ' + cur.provider + '/' + cur.model
            + '（reasoningEffort=' + (cur.reasoningEffort ?? 'high') + '）: ' + detail;
        console.error('[dsh-swarm][debug] ' + line);
        deps.log?.(line);
        if (state.taskId && state.comment) {
            try {
                await state.comment('[model-fallback] 主模型不可用，静默切换 ' + cur.provider + '/' + cur.model
                    + '（reasoningEffort=' + (cur.reasoningEffort ?? 'high') + '）');
            }
            catch { /* 证据记录失败不影响切换 */ }
        }
        return { kind: 'retry' };
    });
    return () => {
        disposeRequest();
        disposeError();
    };
}
