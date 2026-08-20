export function writeSseEvent(res, event) {
    res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
}
function lastSeen(req) {
    const url = new URL(req.url ?? '/kanban/events', 'http://localhost');
    const query = Number(url.searchParams.get('after') ?? -1);
    const headerValue = Array.isArray(req.headers['last-event-id'])
        ? req.headers['last-event-id'][0]
        : req.headers['last-event-id'];
    const header = Number(headerValue ?? -1);
    return Math.max(Number.isFinite(query) ? query : -1, Number.isFinite(header) ? header : -1);
}
/** T23：SSE 事件桥。先订阅并缓存 live 事件，再补发补偿事件，握手窗口不丢事件。 */
export async function serveKanbanEvents(req, res, service, options) {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();
    let cursor = lastSeen(req);
    let replaying = true;
    const buffered = [];
    let heartbeat;
    const stop = service.subscribe((event) => {
        if (replaying)
            buffered.push(event);
        else if (event.seq > cursor) {
            writeSseEvent(res, event);
            cursor = event.seq;
        }
    });
    let closed = false;
    const close = () => {
        if (closed)
            return;
        closed = true;
        stop();
        if (heartbeat)
            clearInterval(heartbeat);
    };
    req.once('close', close);
    req.once('aborted', close);
    res.once('close', close);
    heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); }, options.heartbeatMs);
    for (const event of await service.eventsSince(cursor + 1)) {
        if (event.seq > cursor) {
            writeSseEvent(res, event);
            cursor = event.seq;
        }
    }
    replaying = false;
    for (const event of buffered.sort((a, b) => a.seq - b.seq)) {
        if (event.seq > cursor) {
            writeSseEvent(res, event);
            cursor = event.seq;
        }
    }
}
