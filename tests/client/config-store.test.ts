import { describe, it, expect, vi } from 'vitest';
import { createConfigStore } from '../../client/config-store.js';

describe('config-store', () => {
  it('load 拉取 config + catalog；save 调用 PUT 并刷新', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ effective: { wikiVault: { baseUrl: 'http://a', pagePrefix: 'p/' }, roles: { models: {} } }, sources: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ providers: [], models: {} }) });
    const store = createConfigStore(fetchMock as unknown as typeof fetch);
    await store.load();
    expect(store.get().effective.wikiVault.baseUrl).toBe('http://a');

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, effective: { wikiVault: { baseUrl: 'http://b', pagePrefix: 'p/' }, roles: { models: {} } }, sources: {} }) });
    await store.save({ wikiVault: { baseUrl: 'http://b', pagePrefix: 'p/' }, roles: { models: {} }, reviewEngine: { mode: 'delegate', managed: { provider: '', model: '' } } });
    expect(store.get().effective.wikiVault.baseUrl).toBe('http://b');
  });
  it('初始 effective 含 reviewEngine 全量默认（镜像类型）', () => {
    const store = createConfigStore(vi.fn() as unknown as typeof fetch);
    expect(store.get().effective.reviewEngine).toEqual({ mode: 'delegate', managed: { provider: '', model: '' } });
  });

  it('初始 ocrStatus=null、install=idle（未知态）', () => {
    const store = createConfigStore(vi.fn() as unknown as typeof fetch);
    expect(store.get().ocrStatus).toBeNull();
    expect(store.get().install).toEqual({ phase: 'idle', log: '' });
  });

  it('loadOcrStatus 拉取 status；请求失败静默置 null', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ installed: true, version: 'ocr 1.0.0', mode: 'delegate', managedReady: false }),
    });
    const store = createConfigStore(fetchMock as unknown as typeof fetch);
    await store.loadOcrStatus();
    expect(fetchMock).toHaveBeenCalledWith('/kanban/ocr/status');
    expect(store.get().ocrStatus).toEqual({ installed: true, version: 'ocr 1.0.0', mode: 'delegate', managedReady: false });

    const failing = createConfigStore((() => { throw new Error('network down'); }) as unknown as typeof fetch);
    await failing.loadOcrStatus();
    expect(failing.get().ocrStatus).toBeNull();
  });

  it('startInstall POST install 转 running；409（已有任务进行中）也转轮询', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, id: 'i1' }) });
    const store = createConfigStore(fetchMock as unknown as typeof fetch);
    await store.startInstall();
    expect(fetchMock).toHaveBeenCalledWith('/kanban/ocr/install', { method: 'POST' });
    expect(store.get().install.phase).toBe('running');

    const m409 = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'install-in-progress' }) });
    const s2 = createConfigStore(m409 as unknown as typeof fetch);
    await s2.startInstall();
    expect(s2.get().install.phase).toBe('running');
  });

  it('cancelInstall POST cancel 并返回响应体', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const store = createConfigStore(fetchMock as unknown as typeof fetch);
    const r = await store.cancelInstall();
    expect(fetchMock).toHaveBeenCalledWith('/kanban/ocr/install/cancel', { method: 'POST' });
    expect(r).toEqual({ ok: true });
  });

  it('loadInstallState 映射三态；终态 ok 时联动刷新 ocrStatus', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ running: true, log: '' }) });
    const store = createConfigStore(fetchMock as unknown as typeof fetch);
    await store.loadInstallState();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/kanban/ocr/install/state');
    expect(store.get().install).toEqual({ phase: 'running', log: '' });

    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ running: false, result: 'ok', version: 'ocr 2.0.0', log: 'added 1 package' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ installed: true, version: 'ocr 2.0.0', mode: 'delegate', managedReady: false }) });
    await store.loadInstallState();
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/kanban/ocr/install/state');
    expect(store.get().install).toEqual({ phase: 'done', log: 'added 1 package' });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/kanban/ocr/status');
    expect(store.get().ocrStatus).toEqual({ installed: true, version: 'ocr 2.0.0', mode: 'delegate', managedReady: false });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ running: false, result: 'cancelled', log: '已取消' }) });
    await store.loadInstallState();
    expect(store.get().install.phase).toBe('cancelled');
  });

  it('wireOcr POST wire 并返回 {ok, log}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: false, log: '未能从 dsh 解析该提供方的接入信息' }) });
    const store = createConfigStore(fetchMock as unknown as typeof fetch);
    const r = await store.wireOcr('gpt', 'm1');
    expect(fetchMock).toHaveBeenCalledWith('/kanban/ocr/wire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gpt', model: 'm1' }),
    });
    expect(r).toEqual({ ok: false, log: '未能从 dsh 解析该提供方的接入信息' });
  });
});
