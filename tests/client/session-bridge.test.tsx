import { describe, it, expect, vi, afterEach } from 'vitest';
import { openSession, setSessionsService } from '../../client/session-bridge.js';
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client';

afterEach(() => setSessionsService(null));

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
});
