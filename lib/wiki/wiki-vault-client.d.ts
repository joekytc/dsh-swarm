export declare class WikiError extends Error {
    readonly code: 'kb-unreachable' | 'kb-rejected';
    readonly status?: number;
    constructor(code: 'kb-unreachable' | 'kb-rejected', status?: number, message?: string);
}
export interface WikiSearchResult {
    path: string;
    title: string;
    score: number;
    mtime: number;
}
export declare class WikiVaultClient {
    private readonly cfg;
    constructor(cfg: {
        baseUrl: string;
        pagePrefix: string;
    });
    /** P2：暴露 baseUrl getter（下游 WikiWorker 拼 kb_url 用），不挖私有字段。 */
    get baseUrl(): string;
    private request;
    search(q: string): Promise<WikiSearchResult[]>;
    read(pagePath: string): Promise<{
        path: string;
        rawMd: string;
    }>;
    write(pagePath: string, content: string): Promise<{
        path: string;
    }>;
}
