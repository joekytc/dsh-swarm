import type { WikiVaultClient, WikiSearchResult } from './wiki-vault-client.js';
export declare function recallLearningIndex(wiki: WikiVaultClient, opts: {
    requirementName: string | null;
    workspaceDir: string | null;
}): Promise<WikiSearchResult[]>;
export declare function recallDocIndex(wiki: WikiVaultClient, opts: {
    requirementName: string | null;
    workspaceDir: string | null;
}): Promise<WikiSearchResult[]>;
export declare function recallMemoryIndex(wiki: WikiVaultClient, opts: {
    requirementName: string | null;
    workspaceDir: string | null;
    maxEntries: number;
}): Promise<string | null>;
/** /openspec: 恢复路径复用：搜【需求】候选清单页（projects/ 前缀 top5）。 */
export declare function searchChecklists(wiki: WikiVaultClient, pagePrefix?: string): Promise<string[]>;
