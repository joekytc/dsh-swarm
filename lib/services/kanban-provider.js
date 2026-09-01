import { Service } from '@deepseek-ai/cordis';
import { homedir } from 'node:os';
import { KanbanService } from '../domain/kanban-service.js';
import { FileEventStore } from '../domain/event-store.js';
export class KanbanProvider extends Service {
    service;
    /** T32 fix：GUI retry 的任务执行器（由 startDispatcher 装配后注入；webServer 先于 agents 就绪时可为 null）。 */
    runner = null;
    // Task 6：经 configProvider getter 读 effective 配置——配置面板改 wikiVault.baseUrl 后 kb_url 前缀校验热生效。
    constructor(ctx, config, configProvider) {
        super(ctx, 'kanban');
        const dir = config.storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? homedir());
        this.service = new KanbanService(new FileEventStore(dir), () => configProvider.getEffective().wikiVault?.baseUrl);
    }
}
