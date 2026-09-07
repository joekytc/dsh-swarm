import { type WikiSearchResult } from './wiki-vault-client.js';
export declare class LocalWikiClient {
    readonly baseUrl = "";
    readonly root: string;
    constructor(root: string);
    private abs;
    write(pagePath: string, content: string): Promise<{
        path: string;
    }>;
    read(pagePath: string): Promise<{
        rawMd: string;
    }>;
    search(q: string): Promise<WikiSearchResult[]>;
}
