import type { Task } from '../domain/types.js';
import type { KanbanService } from '../domain/kanban-service.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
/** W 角色的领域执行：预取（原汁原味只读）与 KB 同步。 */
export declare class WikiWorker {
    private readonly kanban;
    private readonly wiki;
    private readonly cfg;
    constructor(kanban: KanbanService, wiki: WikiVaultClient, cfg: {
        pagePrefix: string;
    });
    executePrefetch(task: Task, mode: 'file' | 'external' | 'kb', source: string): Promise<{
        ref: string;
    }>;
    syncToWiki(task: Task, sourceRef: string): Promise<{
        kb_url: string;
        page_path: string;
    }>;
    private wikiBase;
}
