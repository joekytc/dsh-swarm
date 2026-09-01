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
    await store.save({ wikiVault: { baseUrl: 'http://b', pagePrefix: 'p/' }, roles: { models: {} } });
    expect(store.get().effective.wikiVault.baseUrl).toBe('http://b');
  });
});
