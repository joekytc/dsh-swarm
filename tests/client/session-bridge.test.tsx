import { describe, it, expect, vi, afterEach } from 'vitest';
import { openSession, setSessionsService, setSessionNavigator } from '../../client/session-bridge.js';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';

afterEach(() => {
  setSessionsService(null);
  setSessionNavigator(null);
});

describe('session-bridge', () => {
  it('未注入宿主 sessions 服务时 openSession fail loud', () => {
    expect(() => openSession('kbn-x')).toThrow(/sessions service unavailable/);
  });

  it('注入后 openSession 转发宿主服务', () => {
    const open = vi.fn();
    setSessionsService({
      open,
      list: { getSnapshot: () => ({ ids: [] }), subscribe: () => () => {} },
    } as unknown as ISessions);
    openSession('kbn-x');
    expect(open).toHaveBeenCalledWith('kbn-x');
  });

  it('0.2.0+ 宿主：优先走 uiWorkspace 导航接缝', () => {
    const navOpen = vi.fn();
    setSessionNavigator(() => ({ openSession: navOpen }));
    const open = vi.fn();
    setSessionsService({
      open,
      list: { getSnapshot: () => ({ ids: [] }), subscribe: () => () => {} },
    } as unknown as ISessions);
    openSession('kbn-x');
    expect(navOpen).toHaveBeenCalledWith('kbn-x');
    expect(open).not.toHaveBeenCalled();
  });

  it('导航 getter 抛错（cordis 未就绪）视同缺席，回落旧宿主 open', () => {
    setSessionNavigator(() => {
      throw new Error('service not ready');
    });
    const open = vi.fn();
    setSessionsService({
      open,
      list: { getSnapshot: () => ({ ids: [] }), subscribe: () => () => {} },
    } as unknown as ISessions);
    openSession('kbn-x');
    expect(open).toHaveBeenCalledWith('kbn-x');
  });

  it('uiWorkspace 缺席时回落旧宿主 open 转发', () => {
    const open = vi.fn();
    setSessionsService({
      open,
      list: { getSnapshot: () => ({ ids: [] }), subscribe: () => () => {} },
    } as unknown as ISessions);
    openSession('kbn-y');
    expect(open).toHaveBeenCalledWith('kbn-y');
  });

  it('两接缝皆缺时 fail loud 且不静默', () => {
    setSessionsService({
      list: { getSnapshot: () => ({ ids: [] }), subscribe: () => () => {} },
    } as unknown as ISessions);
    expect(() => openSession('kbn-z')).toThrow(/neither uiWorkspace nor sessions\.open/);
  });
});
