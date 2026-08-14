import type { Task } from '../src/domain/types.js';

/** P1-10 统一列模型：任务列（triage 折叠进 todo、archived 折叠进 done）+ 链级 planning 由组件拼装。 */
export type BoardColumn = 'todo' | 'running' | 'blocked' | 'failed' | 'done';

export interface BoardFold {
  columns: Record<BoardColumn, Task[]>;
  chains: string[];
}

const FOLD: Record<Task['status'], BoardColumn> = {
  triage: 'todo',
  todo: 'todo',
  ready: 'todo',
  running: 'running',
  blocked: 'blocked',
  failed: 'failed',
  done: 'done',
  archived: 'done',
};

export function foldBoard(tasks: Task[]): BoardFold {
  const columns: Record<BoardColumn, Task[]> = { todo: [], running: [], blocked: [], failed: [], done: [] };
  for (const t of tasks) columns[FOLD[t.status]].push(t);
  columns.running.sort((a, b) => (b.heartbeats.at(-1) ?? 0) - (a.heartbeats.at(-1) ?? 0));
  columns.done.sort((a, b) => b.attempts - a.attempts);
  return { columns, chains: [...new Set(tasks.map((t) => t.chainId))] };
}
