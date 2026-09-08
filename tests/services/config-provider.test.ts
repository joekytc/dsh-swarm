import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigProvider } from '../../src/services/config-provider.js';
import type { KanbanConfig } from '../../src/config.js';

function base(): KanbanConfig {
  return {
    storageDir: '/tmp/kb', wikiVault: { baseUrl: 'http://10.0.0.1:3000', pagePrefix: 'projects/' },
    roles: { models: {} }, dispatcher: { staleTimeoutSeconds: 1, maxRetries: 1, heartbeatIntervalSeconds: 1, maxProtocolViolations: 2, maxReworksPerRole: { pt: 2, dt: 3 } },
    prefixRoutes: { plan: '/plan:', openspec: '/openspec:', learning: '/learning', send: '/sms' },
    memory: { enabled: true, maxIndexEntries: 8 }, ui: { enabled: true, contentMinWidth: 715, contentMaxWidth: 780, sseHeartbeatSeconds: 20 },
    gates: { enabled: true, timeoutMs: 600000, forbidden: ['rm -rf /', 'git push'] },
    imDelivery: { enabled: false, botId: '', targetId: '' },
    reviewEngine: { mode: 'delegate', managed: { provider: '', model: '' } },
  };
}

const fakeCtx = { on: vi.fn(), off: vi.fn(), set: vi.fn(), get: vi.fn(() => undefined), reflect: { provide: vi.fn() } } as never;

describe('ConfigProvider', () => {
  it('mode 由 baseUrl 派生：非空 remote、空 local', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    try {
      const p = new ConfigProvider(fakeCtx, base(), dir);
      expect(p.mode).toBe('remote');
      p.applyOverride({ wikiVault: { baseUrl: '', pagePrefix: 'projects/' }, roles: { models: {} }, reviewEngine: { mode: 'delegate', managed: { provider: '', model: '' } } });
      expect(p.mode).toBe('local');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('applyOverride 校验不过返回 ok:false 且不落盘', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    try {
      const p = new ConfigProvider(fakeCtx, base(), dir);
      const snap = { wikiVault: { baseUrl: 'bad', pagePrefix: 'x/' }, roles: { models: {} }, reviewEngine: { mode: 'delegate' as const, managed: { provider: '', model: '' } } };
      const r = p.applyOverride(snap);
      expect(r.ok).toBe(false);
      expect(existsSync(join(dir, 'config-override.json'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('applyOverride 合法 → 落盘 + getEffective 热生效 + sources 标注', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    try {
      const p = new ConfigProvider(fakeCtx, base(), dir);
      const snap = { wikiVault: { baseUrl: 'http://9.9.9.9:1', pagePrefix: 'projects/' }, roles: { models: {} }, reviewEngine: { mode: 'delegate' as const, managed: { provider: '', model: '' } } };
      const r = p.applyOverride(snap);
      expect(r.ok).toBe(true);
      expect(p.getEffective().wikiVault.baseUrl).toBe('http://9.9.9.9:1');
      if (r.ok) expect(r.sources['wikiVault.baseUrl']).toBe('override');
      const raw = JSON.parse(readFileSync(join(dir, 'config-override.json'), 'utf8'));
      expect(raw.wikiVault.baseUrl).toBe('http://9.9.9.9:1');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('override 文件损坏 → 静默回退 baseline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(dir, 'config-override.json'), '{bad json');
      const p = new ConfigProvider(fakeCtx, base(), dir);
      expect(p.getEffective().wikiVault.baseUrl).toBe('http://10.0.0.1:3000');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('reviewEngine 变更经 diffKeys 报告 changed，重放无新增，落盘含 managed 值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    try {
      const p = new ConfigProvider(fakeCtx, base(), dir);
      const snap = { wikiVault: base().wikiVault, roles: { models: {} }, reviewEngine: { mode: 'managed' as const, managed: { provider: 'p1', model: 'm1' } } };
      const r = p.applyOverride(snap);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.changed).toEqual(expect.arrayContaining(['reviewEngine.mode', 'reviewEngine.managed.provider', 'reviewEngine.managed.model']));
      expect(p.getEffective().reviewEngine).toEqual({ mode: 'managed', managed: { provider: 'p1', model: 'm1' } });
      const r2 = p.applyOverride(snap);
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.changed).toEqual([]);
      const raw = JSON.parse(readFileSync(join(dir, 'config-override.json'), 'utf8'));
      expect(raw.reviewEngine).toEqual({ mode: 'managed', managed: { provider: 'p1', model: 'm1' } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
