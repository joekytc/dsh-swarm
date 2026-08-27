import { describe, it, expect, vi, afterEach } from 'vitest';
import { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })));
}

describe('WikiVaultClient', () => {
  afterEach(() => vi.unstubAllGlobals());
  const cfg = { baseUrl: 'http://192.168.122.111:3000', pagePrefix: 'projects/' };

  it('reads a page', async () => {
    mockFetch(200, { path: 'projects/x', rawMd: '# X' });
    const client = new WikiVaultClient(cfg);
    const page = await client.read('projects/x');
    expect(page.rawMd).toBe('# X');
  });
  it('searches', async () => {
    mockFetch(200, { query: 'q', results: [{ path: 'p', title: 't', score: 1 }] });
    const client = new WikiVaultClient(cfg);
    const r = await client.search('kb');
    expect(r[0].path).toBe('p');
  });
  it('writes a page with pagePrefix check', async () => {
    mockFetch(200, { path: 'projects/x' });
    const client = new WikiVaultClient(cfg);
    await expect(client.write('projects/x', 'content')).resolves.toEqual({ path: 'projects/x' });
  });
  it('throws WikiError on unreachable', async () => {
    mockFetch(503, {});
    const client = new WikiVaultClient(cfg);
    await expect(client.read('projects/x')).rejects.toMatchObject({ code: 'kb-unreachable' });
  });
  it('search surfaces mtime', async () => {
    mockFetch(200, { query: 'q', results: [{ path: 'p', title: 't', score: 1, mtime: 1700000000000 }] });
    const client = new WikiVaultClient(cfg);
    const r = await client.search('kb');
    expect(r[0].mtime).toBe(1700000000000);
  });
});
