import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { KanbanProvider } from '../services/kanban-provider.js';

interface WebRouteLike {
  kind: 'exact' | 'prefix';
  path: string;
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
}

interface WebServerLike {
  register(route: WebRouteLike): () => void;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 看板 HTTP 桥（Web GUI 浏览器半消费）：GET /kanban/board 读快照；POST /kanban/action 执行状态操作。
 *  仅在 webServer 服务存在时挂载（CLI/headless/测试裸 Context 不挂）。 */
export function registerKanbanHttp(ctx: Context, provider: KanbanProvider): void {
  const webServer = (ctx as { webServer?: WebServerLike }).webServer;
  if (!webServer) return;
  webServer.register({
    kind: 'prefix',
    path: '/kanban',
    async handler(req, res) {
      try {
        if (req.method === 'GET' && req.url?.startsWith('/kanban/board')) {
          const state = await provider.service.snapshot();
          json(res, 200, {
            chains: [...state.chains.values()],
            tasks: [...state.tasks.values()],
            specCards: [...state.specCards.values()],
            handoffs: [...state.handoffs.entries()].map(([k, v]) => ({ id: k, ...v })),
            events: state.events,
          });
          return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/kanban/action')) {
          const body = JSON.parse((await readBody(req)) || '{}') as { type?: string; taskId?: string };
          const t = body.taskId;
          if (!t) { json(res, 400, { error: 'taskId required' }); return; }
          switch (body.type) {
            case 'block': await provider.service.blockTask(t, 'human: GUI block', 'human'); break;
            case 'unblock': await provider.service.unblockTask(t, 'human'); break;
            case 'archive': await provider.service.archiveTask(t, 'human'); break;
            default: json(res, 400, { error: 'unknown action: ' + String(body.type) }); return;
          }
          json(res, 200, { ok: true });
          return;
        }
        json(res, 404, { error: 'not found' });
      } catch (err) {
        json(res, 500, { error: String(err) });
      }
    },
  });
}
