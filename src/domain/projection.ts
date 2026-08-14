import type { BoardState, Chain, Handoff, KanbanEvent, SpecCard, Task } from './types.js';
import { transitionChain, transitionSpecCard, transitionTask } from './state-machine.js';

function empty(): BoardState {
  return { chains: new Map(), tasks: new Map(), specCards: new Map(), handoffs: new Map(), events: [] };
}

export function applyTo(state: BoardState, ev: KanbanEvent): BoardState {
  const next = { ...state, events: [...state.events, ev] };
  switch (ev.kind) {
    case 'chain/created': {
      const p = ev.payload as unknown as Chain;
      next.chains = new Map(state.chains).set(p.id, { ...p, status: 'planning' });
      break;
    }
    case 'chain/executing':
    case 'chain/completed':
    case 'chain/aborted': {
      const c = state.chains.get(ev.chainId);
      if (!c) throw new Error('projection: unknown chain ' + ev.chainId);
      next.chains = new Map(state.chains).set(ev.chainId, { ...c, status: transitionChain(c.status, ev.kind) });
      break;
    }
    case 'chain/root-task-set': {
      const c = state.chains.get(ev.chainId);
      if (!c) throw new Error('projection: unknown chain ' + ev.chainId);
      next.chains = new Map(state.chains).set(ev.chainId, { ...c, rootTaskId: String(ev.payload['rootTaskId'] ?? '') });
      break;
    }
    case 'task/created': {
      const p = ev.payload as unknown as Task;
      if (!p.id || !p.assignee) throw new Error('projection: malformed task/created');
      // 归一化缺省字段，使最小 payload 的事件日志可回放（P0-3 回放为权威）
      const normalized: Task = {
        ...p,
        status: p.status ?? 'todo',
        parents: p.parents ?? [],
        children: p.children ?? [],
        attempts: p.attempts ?? 0,
        heartbeats: p.heartbeats ?? [],
      };
      next.tasks = new Map(state.tasks).set(p.id, normalized);
      break;
    }
    case 'task/claimed':
    case 'task/heartbeat':
    case 'task/completed':
    case 'task/blocked':
    case 'task/unblocked':
    case 'task/failed':
    case 'task/archived': {
      if (!ev.taskId) throw new Error('projection: event without taskId');
      const t = state.tasks.get(ev.taskId);
      if (!t) throw new Error('projection: unknown task ' + ev.taskId);
      const updated: Task = { ...t, status: transitionTask(t.status, ev.kind) };
      if (ev.kind === 'task/heartbeat') updated.heartbeats = [...t.heartbeats, ev.at];
      if (ev.kind === 'task/failed') updated.attempts = t.attempts + 1; // attempts=失败次数（熔断判据）
      if (ev.kind === 'task/completed') {
        const p = ev.payload as unknown as Handoff;
        next.handoffs = new Map(state.handoffs).set(ev.taskId, p);
      }
      next.tasks = new Map(state.tasks).set(ev.taskId, updated);
      break;
    }
    case 'spec-card/created':
    case 'spec-card/edited': {
      const p = ev.payload as unknown as SpecCard;
      next.specCards = new Map(state.specCards).set(p.id, p);
      // 规格卡创建时把链路的 specCardId 一并接线（事件溯源派生，无需额外事件）
      if (ev.kind === 'spec-card/created') {
        const c = state.chains.get(p.chainId);
        if (c && !c.specCardId) {
          next.chains = new Map(state.chains).set(p.chainId, { ...c, specCardId: p.id });
        }
      }
      break;
    }
    case 'spec-card/approved': {
      const id = String(ev.payload['id'] ?? '');
      const s = state.specCards.get(id);
      if (!s) throw new Error('projection: unknown spec card ' + id);
      next.specCards = new Map(state.specCards).set(id, { ...s, status: transitionSpecCard(s.status, ev.kind), approvedAt: ev.at, approvedBy: ev.author });
      break;
    }
  }
  return next;
}

export function project(events: KanbanEvent[]): BoardState {
  return events.reduce(applyTo, empty());
}
