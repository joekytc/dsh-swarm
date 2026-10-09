import { describe, it, expect, vi } from 'vitest';
import { installModelChainHooks, isSwitchableModelFailure, registerModelChain, type ModelChainState } from '../../src/dispatcher/model-chain.js';
import type { KanbanConfig } from '../../src/config.js';

type Listener = (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>;

function fakeScope() {
  const listeners = new Map<string, Listener>();
  return {
    on(event: string, listener: Listener) {
      listeners.set(event, listener);
      return () => { listeners.delete(event); };
    },
    listeners,
  };
}

const configWithW = {
  roles: {
    models: {
      w: {
        provider: 'deepseek-account',
        model: 'deepseek-flash',
        fallbacks: [{ provider: 'jz', model: 'gpt-5.6-luna', reasoningEffort: 'high' }],
      },
    },
  },
} as unknown as KanbanConfig;

const configNoChain = { roles: { models: {} } } as unknown as KanbanConfig;

function manualAgent(preset: string | null) {
  return {
    session: {
      seq: 1,
      snapshotEvents: () => (preset === null ? [] : [{ type: 'agent-preset/selected', seq: 1, data: { agentPreset: preset } }]),
    },
  };
}

function runHooks(cfg: () => KanbanConfig) {
  const scope = fakeScope();
  const dispose = installModelChainHooks(scope, { getConfig: cfg });
  return { scope, dispose };
}

describe('isSwitchableModelFailure', () => {
  it('配额类（ACCOUNT_QUOTA / 余额不足 / 402 / 429）可切换', () => {
    expect(isSwitchableModelFailure({ code: 'ACCOUNT_QUOTA', message: 'Insufficient Balance', status: 402 })).toBe(true);
    expect(isSwitchableModelFailure({ code: 'QUOTA', message: 'quota exceeded' })).toBe(true);
    expect(isSwitchableModelFailure({ message: 'Insufficient Balance (request_id: x)' })).toBe(true);
    expect(isSwitchableModelFailure({ status: 429 })).toBe(true);
    expect(isSwitchableModelFailure({ status: 402 })).toBe(true);
  });
  it('模型/凭据不可用类可切换', () => {
    expect(isSwitchableModelFailure({ code: 'UNKNOWN_MODEL', message: 'pi-ai provider "jz" has no configured model "x"' })).toBe(true);
    expect(isSwitchableModelFailure({ message: 'no adapter registered for provider jz' })).toBe(true);
    expect(isSwitchableModelFailure({ code: 'MISSING_CREDENTIAL', message: 'not logged in' })).toBe(true);
    expect(isSwitchableModelFailure({ message: '请先登录' })).toBe(true);
  });
  it('无关错误不可切换', () => {
    expect(isSwitchableModelFailure({ code: 'INTERNAL', message: 'internal error' })).toBe(false);
    expect(isSwitchableModelFailure({ status: 500, message: 'boom' })).toBe(false);
    expect(isSwitchableModelFailure({ message: 'context length exceeded' })).toBe(false);
    expect(isSwitchableModelFailure({})).toBe(false);
  });
});

describe('agent/request 逐请求强制当前候选', () => {
  it('已注册状态：provider/model/effort 覆盖为当前候选', async () => {
    const agent = manualAgent(null);
    registerModelChain(agent as unknown as object, {
      candidates: [
        { provider: 'jz', model: 'a', reasoningEffort: 'high' },
        { provider: 'jz', model: 'b' },
      ],
      index: 1,
    });
    const { scope } = runHooks(() => configWithW);
    const out = await scope.listeners.get('agent/request')!(
      { agent },
      async () => ({ provider: 'x', model: 'y', reasoningEffort: 'off' }),
    ) as Record<string, unknown>;
    expect(out['provider']).toBe('jz');
    expect(out['model']).toBe('b');
    expect(out['reasoningEffort']).toBe('high');
  });
  it('手动 kanban-w 会话：按 W 链主模型强制', async () => {
    const agent = manualAgent('kanban-w');
    const { scope } = runHooks(() => configWithW);
    const out = await scope.listeners.get('agent/request')!(
      { agent },
      async () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    ) as Record<string, unknown>;
    expect(out['provider']).toBe('deepseek-account');
    expect(out['model']).toBe('deepseek-flash');
    expect(out['reasoningEffort']).toBe('high');
  });
  it('非 kanban preset / 未配角色链：原样放行不覆盖', async () => {
    const plain = manualAgent('ptc');
    const noChain = manualAgent('kanban-w');
    const { scope } = runHooks(() => configNoChain);
    for (const agent of [plain, noChain]) {
      const out = await scope.listeners.get('agent/request')!(
        { agent },
        async () => ({ provider: 'x', model: 'y' }),
      ) as Record<string, unknown>;
      expect(out['provider']).toBe('x');
      expect(out['model']).toBe('y');
    }
  });
  it('已注册状态优先于 preset 探测', async () => {
    const agent = manualAgent('kanban-w');
    registerModelChain(agent as unknown as object, {
      candidates: [{ provider: 'jz', model: 'registered-primary', reasoningEffort: 'high' }],
      index: 0,
    });
    const { scope } = runHooks(() => configWithW);
    const out = await scope.listeners.get('agent/request')!(
      { agent },
      async () => ({ provider: 'x', model: 'y' }),
    ) as Record<string, unknown>;
    expect(out['model']).toBe('registered-primary');
  });
});

describe('agent/request-error 主→降级静默切换', () => {
  it('配额类失败：推进到下一候选并 retry，卡片留 [model-fallback] 审计', async () => {
    const agent = manualAgent(null);
    const comment = vi.fn(async () => {});
    const state: ModelChainState = {
      candidates: [
        { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
        { provider: 'jz', model: 'gpt-5.6-luna', reasoningEffort: 'high' },
      ],
      index: 0,
      taskId: 't1',
      comment,
    };
    registerModelChain(agent as unknown as object, state);
    const { scope } = runHooks(() => configWithW);
    const next = vi.fn(async () => undefined);
    const action = await scope.listeners.get('agent/request-error')!(
      { agent, failure: { code: 'ACCOUNT_QUOTA', message: 'Insufficient Balance', status: 402 } },
      next,
    );
    expect(action).toEqual({ kind: 'retry' });
    expect(next).not.toHaveBeenCalled();
    expect(state.index).toBe(1);
    expect(comment).toHaveBeenCalledWith(expect.stringContaining('jz/gpt-5.6-luna'));
  });
  it('链尾失败：交还默认处理（不无限 retry）', async () => {
    const agent = manualAgent(null);
    const state: ModelChainState = {
      candidates: [{ provider: 'jz', model: 'only', reasoningEffort: 'high' }],
      index: 0,
    };
    registerModelChain(agent as unknown as object, state);
    const { scope } = runHooks(() => configWithW);
    const next = vi.fn(async () => undefined);
    const action = await scope.listeners.get('agent/request-error')!(
      { agent, failure: { code: 'ACCOUNT_QUOTA', message: 'Insufficient Balance' } },
      next,
    );
    expect(action).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
  it('无关失败：不切换，交还默认处理', async () => {
    const agent = manualAgent(null);
    const state: ModelChainState = {
      candidates: [
        { provider: 'a', model: 'x' },
        { provider: 'a', model: 'y' },
      ],
      index: 0,
    };
    registerModelChain(agent as unknown as object, state);
    const { scope } = runHooks(() => configWithW);
    const next = vi.fn(async () => undefined);
    const action = await scope.listeners.get('agent/request-error')!(
      { agent, failure: { code: 'INTERNAL', message: 'internal error' } },
      next,
    );
    expect(action).toBeUndefined();
    expect(state.index).toBe(0);
    expect(next).toHaveBeenCalled();
  });
  it('手动 kanban-w 会话（未注册）：402 也按 W 链降级切换', async () => {
    const agent = manualAgent('kanban-w');
    const { scope } = runHooks(() => configWithW);
    const next = vi.fn(async () => undefined);
    const action = await scope.listeners.get('agent/request-error')!(
      { agent, failure: { code: 'ACCOUNT_QUOTA', message: 'Insufficient Balance', status: 402 } },
      next,
    );
    expect(action).toEqual({ kind: 'retry' });
    const out = await scope.listeners.get('agent/request')!(
      { agent },
      async () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }),
    ) as Record<string, unknown>;
    expect(out['model']).toBe('gpt-5.6-luna');
    expect(out['provider']).toBe('jz');
  });
});
