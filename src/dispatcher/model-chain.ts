// src/dispatcher/model-chain.ts
import type { KanbanConfig } from '../config.js';
import type { Role } from '../domain/types.js';
import type { AgentModelOptions } from './dispatcher.js';
import { buildModelCandidates } from './model-candidates.js';
import { agentPresetSelected } from './session-events.js';

export interface ModelChainState {
  candidates: AgentModelOptions[];
  index: number;
  taskId?: string;
  comment?: (body: string) => Promise<void>;
}

const chainStates = new WeakMap<object, ModelChainState | null>();

export function registerModelChain(agent: object, state: ModelChainState): void {
  chainStates.set(agent, state);
  const session = (agent as { session?: unknown }).session;
  if (session && typeof session === 'object') chainStates.set(session, state);
}

export function isSwitchableModelFailure(failure: { code?: string; message?: string; status?: number }): boolean {
  const code = String(failure.code ?? '').toLowerCase();
  const msg = String(failure.message ?? '').toLowerCase();
  if (code.includes('quota')) return true;
  if (failure.status === 402 || failure.status === 429) return true;
  if (/insufficient balance|quota|rate.?limit|\b429\b/.test(msg)) return true;
  if (code === 'unknown_model' || code === 'unsupported_reasoning_effort') return true;
  if (code.includes('credential') || code.includes('login')) return true;
  if (msg.includes('adapter')) return true;
  if (msg.includes('missing_credential') || msg.includes('credentials') || msg.includes('login') || msg.includes('登录')) return true;
  if (msg.includes('provider') && (msg.includes('unavailable') || msg.includes('not') || msg.includes('fail'))) return true;
  return msg.includes('model') && (msg.includes('unavailable') || msg.includes('not found') || msg.includes('no adapter'));
}

const ROLE_IDS: ReadonlySet<string> = new Set(['v', 'p', 'w', 'd', 'pt', 'dt']);

function sessionEventsOf(session: unknown): unknown[] {
  const s = session as { snapshotEvents?: (from?: number) => unknown[]; events?: unknown[] } | null;
  if (typeof s?.snapshotEvents === 'function') return s.snapshotEvents();
  return s?.events ?? [];
}

function detectManualChain(agent: object, config: KanbanConfig): ModelChainState | null {
  const session = (agent as { session?: unknown }).session;
  const preset = agentPresetSelected(sessionEventsOf(session))
    ?? ((session as { header?: { agentPreset?: unknown } } | null)?.header?.agentPreset ?? null);
  const role = typeof preset === 'string' && preset.startsWith('kanban-') ? preset.slice('kanban-'.length) : '';
  let state: ModelChainState | null = null;
  if (ROLE_IDS.has(role)) {
    const m = config.roles?.models?.[role as Role];
    if (m?.provider && m?.model) {
      const candidates = buildModelCandidates(config, role as Role);
      if (candidates.length > 0) state = { candidates, index: 0 };
    }
  }
  chainStates.set(agent, state);
  return state;
}

function resolveState(agent: object, config: KanbanConfig): ModelChainState | null {
  const session = (agent as { session?: unknown }).session;
  for (const key of [agent, session]) {
    if (key && typeof key === 'object' && chainStates.has(key)) return chainStates.get(key) ?? null;
  }
  return detectManualChain(agent, config);
}

export interface ModelChainHookDeps {
  getConfig: () => KanbanConfig;
  log?: (line: string) => void;
}

type WaterfallScope = {
  on(event: string, listener: (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>): () => void;
};

export function installModelChainHooks(scope: unknown, deps: ModelChainHookDeps): () => void {
  const scoped = scope as WaterfallScope;
  const disposeRequest = scoped.on('agent/request', async (payload, next) => {
    const resolved = (await next()) as Record<string, unknown>;
    const agent = (payload as { agent?: unknown }).agent;
    if (!agent || typeof agent !== 'object') return resolved;
    const state = resolveState(agent, deps.getConfig());
    const cur = state?.candidates[state.index];
    if (!cur) return resolved;
    return { ...resolved, provider: cur.provider, model: cur.model, reasoningEffort: cur.reasoningEffort ?? 'high' };
  });
  const disposeError = scoped.on('agent/request-error', async (payload, next) => {
    const p = payload as { agent?: unknown; failure?: { code?: string; message?: string; status?: number } };
    const agent = p.agent;
    if (!agent || typeof agent !== 'object') return next();
    const state = resolveState(agent, deps.getConfig());
    if (!state) return next();
    if (!isSwitchableModelFailure(p.failure ?? {})) return next();
    const nextIndex = state.index + 1;
    if (nextIndex >= state.candidates.length) return next();
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
      } catch { /* 证据记录失败不影响切换 */ }
    }
    return { kind: 'retry' };
  });
  return () => {
    disposeRequest();
    disposeError();
  };
}
