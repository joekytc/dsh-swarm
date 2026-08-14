import { Service, type Context } from '@deepseek-ai/cordis';
import { homedir } from 'node:os';
import { KanbanService } from '../domain/kanban-service.js';
import { FileEventStore } from '../domain/event-store.js';
import type { KanbanConfig } from '../config.js';

declare module '@deepseek-ai/cordis' {
  interface Context { kanban: KanbanProvider; }
}

export class KanbanProvider extends Service {
  readonly service: KanbanService;
  constructor(ctx: Context, config: KanbanConfig) {
    super(ctx, 'kanban');
    const dir = config.storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? homedir());
    this.service = new KanbanService(new FileEventStore(dir));
  }
}
