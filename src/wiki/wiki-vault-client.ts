// src/wiki/wiki-vault-client.ts

export class WikiError extends Error {
  readonly code: 'kb-unreachable' | 'kb-rejected';
  readonly status?: number;
  constructor(code: 'kb-unreachable' | 'kb-rejected', status?: number, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = status;
  }
}

export interface WikiSearchResult { path: string; title: string; score: number; }

export class WikiVaultClient {
  private readonly cfg: { baseUrl: string; pagePrefix: string };
  constructor(cfg: { baseUrl: string; pagePrefix: string }) { this.cfg = cfg; }

  /** P2：暴露 baseUrl getter（下游 WikiWorker 拼 kb_url 用），不挖私有字段。 */
  get baseUrl(): string { return this.cfg.baseUrl; }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.cfg.baseUrl.replace(/\/$/, '') + path;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new WikiError('kb-unreachable', undefined, 'wiki-vault unreachable: ' + url);
    }
    if (!res.ok) throw new WikiError('kb-unreachable', res.status, 'wiki-vault HTTP ' + res.status);
    return (await res.json()) as T;
  }

  async search(q: string): Promise<WikiSearchResult[]> {
    const d = await this.request<{ results: WikiSearchResult[] }>('GET', '/api/search?q=' + encodeURIComponent(q));
    return d.results;
  }

  async read(pagePath: string): Promise<{ path: string; rawMd: string }> {
    return this.request('GET', '/api/pages/' + encodeURIComponent(pagePath));
  }

  async write(pagePath: string, content: string): Promise<{ path: string }> {
    if (!pagePath.startsWith(this.cfg.pagePrefix)) {
      throw new WikiError('kb-rejected', undefined, 'page path outside prefix: ' + pagePath);
    }
    await this.request('PUT', '/api/pages/' + encodeURIComponent(pagePath), { content });
    return { path: pagePath };
  }
}
