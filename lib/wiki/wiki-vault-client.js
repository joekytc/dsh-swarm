// src/wiki/wiki-vault-client.ts
export class WikiError extends Error {
    code;
    status;
    constructor(code, status, message) {
        super(message ?? code);
        this.code = code;
        this.status = status;
    }
}
export class WikiVaultClient {
    getCfg;
    constructor(getCfg) { this.getCfg = getCfg; }
    /** 暴露 baseUrl getter（下游 WikiWorker 拼 kb_url 用），不挖私有字段；经 getCfg 每次取最新配置（热生效）。 */
    get baseUrl() { return this.getCfg().baseUrl; }
    async request(method, path, body) {
        const url = this.getCfg().baseUrl.replace(/\/$/, '') + path;
        let res;
        try {
            res = await fetch(url, {
                method,
                headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(15_000),
            });
        }
        catch {
            throw new WikiError('kb-unreachable', undefined, 'wiki-vault unreachable: ' + url);
        }
        if (!res.ok)
            throw new WikiError('kb-unreachable', res.status, 'wiki-vault HTTP ' + res.status);
        return (await res.json());
    }
    async search(q) {
        const d = await this.request('GET', '/api/search?q=' + encodeURIComponent(q));
        return d.results;
    }
    async read(pagePath) {
        return this.request('GET', '/api/pages/' + encodeURIComponent(pagePath));
    }
    async write(pagePath, content) {
        if (!pagePath.startsWith(this.getCfg().pagePrefix)) {
            throw new WikiError('kb-rejected', undefined, 'page path outside prefix: ' + pagePath);
        }
        await this.request('PUT', '/api/pages/' + encodeURIComponent(pagePath), { content });
        return { path: pagePath };
    }
}
