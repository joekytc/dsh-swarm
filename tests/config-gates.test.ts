import { describe, it, expect } from 'vitest';
import { Config } from '../src/config.js';

describe('config gates 段', () => {
  it('缺省 → enabled=true, timeoutMs=600000, forbidden 默认黑名单', () => {
    const cfg = Config({ storageDir: '/tmp/kb-test' } as never) as Record<string, any>;
    expect(cfg.gates).toEqual({
      enabled: true, timeoutMs: 600000,
      forbidden: ['rm -rf /', 'git push'],
    });
  });
  it('显式 enabled=false 可部署级关闭', () => {
    const cfg = Config({ storageDir: '/tmp/kb-test', gates: { enabled: false } } as never) as Record<string, any>;
    expect(cfg.gates.enabled).toBe(false);
  });
});
