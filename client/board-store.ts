import { applyTo } from '../src/domain/projection.js';
import type { BoardState, Chain, Handoff, KanbanEvent, SpecCard, Task } from '../src/domain/types.js';

export interface BoardWire {
  chains: Chain[];
  tasks: Task[];
  specCards: SpecCard[];
  handoffs: Array<{ id: string } & Handoff>;
  events: KanbanEvent[];
  lastSeq: number;
}

export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type BoardConnectionState = 'loading' | 'ready' | 'reconnecting' | 'error';

export interface ActionError {
  taskId: string;
  message: string;
}

export interface BoardClientSnapshot {
  board: BoardState | null;
  lastSeq: number;
  connection: BoardConnectionState;
  lastSuccessAt: number | null;
  error: string | null;
  actionError: ActionError | null;
}

export interface BoardStore {
  start(): Promise<void>;
  stop(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): BoardClientSnapshot;
  postAction(action: unknown): Promise<unknown>;
}

function hydrate(wire: BoardWire): BoardState {
  return {
    chains: new Map(wire.chains.map((value) => [value.id, value])),
    tasks: new Map(wire.tasks.map((value) => [value.id, value])),
    specCards: new Map(wire.specCards.map((value) => [value.id, value])),
    handoffs: new Map(wire.handoffs.map(({ id, ...value }) => [id, value])),
    events: wire.events,
  };
}

export interface BoardStoreDeps {
  fetchImpl?: typeof fetch;
  eventSourceFactory?: (url: string) => EventSourceLike;
}

/** T32：乐观更新仅作用于状态类操作；comment 等无状态操作直接等待服务端事件收敛。 */
const OPTIMISTIC_STATUS: Partial<Record<string, Task['status']>> = {
  block: 'blocked',
  unblock: 'ready',
  complete: 'done',
  archive: 'archived',
  retry: 'running',
};

function applyOptimistic(board: BoardState, taskId: string, status: Task['status']): BoardState {
  const task = board.tasks.get(taskId);
  if (!task || task.status === status) return board;
  return { ...board, tasks: new Map(board.tasks).set(taskId, { ...task, status }) };
}

/** T24：浏览器外部 store。初始快照 + SSE 增量 + seq 去重/缺口重拉，无业务轮询。 */
export function createBoardStore(deps: BoardStoreDeps = {}): BoardStore {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const eventSourceFactory = deps.eventSourceFactory ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);

  let snapshot: BoardClientSnapshot = { board: null, lastSeq: -1, connection: 'loading', lastSuccessAt: null, error: null, actionError: null };
  const listeners = new Set<() => void>();
  let generation = 0;
  let source: EventSourceLike | null = null;
  let started = false;

  const commit = (patch: Partial<BoardClientSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const resync = async (): Promise<void> => {
    const gen = ++generation;
    source?.close();
    source = null;
    commit({ connection: 'loading' });
    try {
      const res = await fetchImpl('/kanban/board');
      if (!res.ok) throw new Error(`board snapshot failed: ${res.status}`);
      const wire = (await res.json()) as BoardWire;
      if (gen !== generation) return;
      commit({
        board: hydrate(wire),
        lastSeq: wire.lastSeq,
        connection: 'ready',
        lastSuccessAt: Date.now(),
        error: null,
      });
      installSource(gen, wire.lastSeq);
    } catch (err) {
      if (gen !== generation) return;
      commit({ connection: 'error', error: String(err) });
    }
  };

  const installSource = (gen: number, lastSeq: number): void => {
    const next = eventSourceFactory(`/kanban/events?after=${lastSeq}`);
    if (gen !== generation) {
      next.close();
      return;
    }
    source = next;
    next.onopen = () => {
      if (gen !== generation) return;
      commit({ connection: 'ready' });
    };
    next.onerror = () => {
      if (gen !== generation) return;
      commit({ connection: 'reconnecting' });
    };
    next.onmessage = (message) => {
      if (gen !== generation) return;
      const event = JSON.parse(message.data) as KanbanEvent;
      if (event.seq <= snapshot.lastSeq) return; // 去重
      if (event.seq === snapshot.lastSeq + 1) {
        const board = snapshot.board ? applyTo(snapshot.board, event) : snapshot.board;
        if (board) commit({ board, lastSeq: event.seq });
        return;
      }
      void resync(); // seq 缺口：关闭旧流并重拉完整快照
    };
  };

  return {
    async start() {
      if (started) return;
      started = true;
      await resync();
    },
    stop() {
      generation += 1;
      source?.close();
      source = null;
      started = false;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot() {
      return snapshot;
    },
    async postAction(action: unknown) {
      const a = action as { type?: string; taskId?: string };
      const type = a.type ?? '';
      const taskId = a.taskId ?? '';
      const optimistic = taskId ? OPTIMISTIC_STATUS[type] : undefined;
      const before = optimistic ? snapshot.board : undefined;
      const beforeSeq = snapshot.lastSeq;
      if (before && optimistic) commit({ actionError: null, board: applyOptimistic(before, taskId, optimistic) });
      try {
        const res = await fetchImpl('/kanban/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) throw new Error(data.error ?? 'action failed');
        commit({ actionError: null });
        return data;
      } catch (err) {
        const patch: Partial<BoardClientSnapshot> = { actionError: { taskId, message: String(err) } };
        if (before) patch.board = before; // T32：回滚到操作前快照切片
        commit(patch);
        // 操作在途期间到达的 SSE 事件不能因回滚丢失：seq 有推进则重拉权威快照
        if (snapshot.lastSeq !== beforeSeq) void resync();
        throw err;
      }
    },
  };
}
