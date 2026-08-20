import type { IncomingMessage, ServerResponse } from 'node:http';
import type { KanbanService } from '../domain/kanban-service.js';
import type { KanbanEvent } from '../domain/types.js';
export declare function writeSseEvent(res: ServerResponse, event: KanbanEvent): void;
/** T23：SSE 事件桥。先订阅并缓存 live 事件，再补发补偿事件，握手窗口不丢事件。 */
export declare function serveKanbanEvents(req: IncomingMessage, res: ServerResponse, service: Pick<KanbanService, 'subscribe' | 'eventsSince'>, options: {
    heartbeatMs: number;
}): Promise<void>;
