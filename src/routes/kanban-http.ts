import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { KanbanConfig } from '../config.js';
import type { KanbanProvider } from '../services/kanban-provider.js';
import { serveKanbanEvents } from './kanban-sse.js';

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
export function registerKanbanHttp(ctx: Context, provider: KanbanProvider, config?: Pick<KanbanConfig, 'ui'>): void {
  // 可选服务：经 ctx.get 读取（cordis 4 直接属性读取需 inject；get 不需要）
  const webServer = ctx.get('webServer') as WebServerLike | undefined;
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
            lastSeq: state.events.at(-1)?.seq ?? -1,
          });
          return;
        }
        if (req.method === 'GET' && req.url?.startsWith('/kanban/events')) {
          const heartbeatMs = (config?.ui.sseHeartbeatSeconds ?? 20) * 1000;
          await serveKanbanEvents(req, res, provider.service, { heartbeatMs });
          return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/kanban/action')) {
          const body = JSON.parse((await readBody(req)) || '{}') as {
            type?: string; taskId?: string; reason?: string; summary?: string; metadata?: Record<string, unknown>; body?: string;
          };
          const t = body.taskId;
          if (!t) { json(res, 400, { error: 'taskId required' }); return; }
          switch (body.type) {
            case 'block': {
              const reason = String(body.reason ?? '').trim();
              if (!reason) { json(res, 400, { error: 'reason required' }); return; }
              await provider.service.blockTask(t, reason, 'human');
              break;
            }
            case 'unblock': await provider.service.unblockTask(t, 'human'); break;
            case 'retry': {
              // T32 fix：retry 走 runner（failed→claim→spawn/resume），而非只 claim 造成 running 悬挂
              const state = await provider.service.snapshot();
              const task = state.tasks.get(t);
              if (!task) { json(res, 404, { error: 'unknown task: ' + t }); return; }
              if (task.status !== 'failed') { json(res, 409, { error: 'invalid state: task ' + t + ' is ' + task.status + ', only failed tasks can be retried' }); return; }
              if (!provider.runner) { json(res, 503, { error: 'dispatcher not ready' }); return; }
              void provider.runner.runTask(t).catch((err) => { console.error('[dsh-kanban] retry dispatch failed: ' + String(err)); });
              break;
            }
            case 'complete': {
              const summary = String(body.summary ?? '').trim();
              if (!summary) { json(res, 400, { error: 'summary required' }); return; }
              await provider.service.completeTask(t, { summary, metadata: body.metadata ?? {}, completedAt: Date.now() }, 'human');
              break;
            }
            case 'archive': await provider.service.archiveTask(t, 'human'); break;
            case 'comment': {
              const bodyText = String(body.body ?? '').trim();
              if (!bodyText) { json(res, 400, { error: 'body required' }); return; }
              await provider.service.comment(t, bodyText, 'human');
              break;
            }
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
