import type { WikiSearchResult } from './wiki-vault-client.js';
/** KB 客户端最小检索面（WikiVaultClient / LocalWikiClient 均满足）。 */
type WikiSearchClient = {
    search(q: string): Promise<WikiSearchResult[]>;
};
export declare function recallLearningIndex(wiki: WikiSearchClient, opts: {
    requirementName: string | null;
    workspaceDir: string | null;
    kbMode?: 'remote' | 'local';
}): Promise<WikiSearchResult[]>;
export declare function recallDocIndex(wiki: WikiSearchClient, opts: {
    requirementName: string | null;
    workspaceDir: string | null;
    kbMode?: 'remote' | 'local';
}): Promise<WikiSearchResult[]>;
export declare function recallMemoryIndex(wiki: WikiSearchClient, opts: {
    requirementName: string | null;
    workspaceDir: string | null;
    maxEntries: number;
    kbMode?: 'remote' | 'local';
}): Promise<string | null>;
/** /openspec: 恢复路径复用：搜【需求】候选清单页（pagePrefix 前缀 top5；local 调用方传 wiki/queries/checklists/）。 */
export declare function searchChecklists(wiki: WikiSearchClient, pagePrefix?: string): Promise<string[]>;
export {};
