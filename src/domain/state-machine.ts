import type { TaskStatus, ChainStatus, SpecCardStatus, EventKind } from './types.js';

const TASK_TRANSITIONS: Record<TaskStatus, Partial<Record<EventKind, TaskStatus>>> = {
  triage: { 'task/claimed': 'running' },
  todo: { 'task/claimed': 'running', 'task/archived': 'archived' },
  ready: { 'task/claimed': 'running', 'task/archived': 'archived' },
  running: { 'task/completed': 'done', 'task/blocked': 'blocked', 'task/failed': 'failed', 'task/heartbeat': 'running' },
  blocked: { 'task/unblocked': 'ready', 'task/archived': 'archived' },
  done: { 'task/archived': 'archived' },
  failed: { 'task/claimed': 'running', 'task/blocked': 'blocked', 'task/archived': 'archived' },
  archived: {},
};

const CHAIN_TRANSITIONS: Record<ChainStatus, Partial<Record<EventKind, ChainStatus>>> = {
  planning: { 'chain/executing': 'executing' },
  executing: { 'chain/completed': 'completed', 'chain/aborted': 'aborted' },
  completed: {},
  aborted: {},
};

const SPEC_TRANSITIONS: Record<SpecCardStatus, Partial<Record<EventKind, SpecCardStatus>>> = {
  draft: { 'spec-card/approved': 'approved' },
  approved: {},
};

function step<T extends string>(name: string, table: Record<T, Partial<Record<EventKind, T>>>, current: T, kind: EventKind): T {
  const next = table[current]?.[kind];
  if (next === undefined) throw new Error(`illegal transition: ${current} --${kind}--> (none)`);
  return next;
}

export const transitionTask = (c: TaskStatus, k: EventKind) => step('task', TASK_TRANSITIONS, c, k);
export const transitionChain = (c: ChainStatus, k: EventKind) => step('chain', CHAIN_TRANSITIONS, c, k);
export const transitionSpecCard = (c: SpecCardStatus, k: EventKind) => step('spec', SPEC_TRANSITIONS, c, k);
