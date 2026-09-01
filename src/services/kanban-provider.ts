import { Service, type Context } from '@deepseek-ai/cordis';
import { homedir } from 'node:os';
import { KanbanService } from '../domain/kanban-service.js';
import { FileEventStore } from '../domain/event-store.js';
import type { KanbanConfig } from '../config.js';
import type { ConfigProvider } from './config-provider.js';

declare module '@deepseek-ai/cordis' {
  interface Context { kanban: KanbanProvider; }
}

export class KanbanProvider extends Service {
  readonly service: KanbanService;
  /** T32 fix：GUI retry 的任务执行器（由 startDispatcher 装配后注入；webServer 先于 agents 就绪时可为 null）。 */
  runner: { runTask(taskId: string): Promise<void> } | null = null;
  // Task 6：经 configProvider getter 读 effective 配置——配置面板改 wikiVault.baseUrl 后 kb_url 前缀校验热生效。
  constructor(ctx: Context, config: KanbanConfig, configProvider: ConfigProvider) {
    super(ctx, 'kanban');
    const dir = config.storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? homedir());
    this.service = new KanbanService(new FileEventStore(dir), () => configProvider.getEffective().wikiVault?.baseUrl);
  }
}
