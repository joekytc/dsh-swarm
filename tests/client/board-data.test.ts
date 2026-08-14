import { describe, it, expect } from 'vitest';
import { foldBoard } from '../../client/board-fold.js';
import type { Task } from '../../src/domain/types.js';

const t = (id: string, status: Task['status'], assignee: Task['assignee']): Task => ({
  id, chainId: 'ch_1', title: id, body: '', assignee, status, mode: 'kb', priority: 1,
  parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [],
});

describe('foldBoard', () => {
  it('groups tasks into unified columns (P1-10)', () => {
    const board = foldBoard([
      t('a', 'running', 'p'), t('b', 'done', 'w'), t('c', 'blocked', 'd'),
      t('e', 'failed', 'd'), t('f', 'ready', 'w'), t('g', 'triage', 'w'), t('h', 'archived', 'w'),
    ]);
    expect(board.columns.running.map((x) => x.id)).toEqual(['a']);
    expect(board.columns.done.map((x) => x.id).sort()).toEqual(['b', 'h']); // archived 折叠进 done
    expect(board.columns.blocked.map((x) => x.id)).toEqual(['c']);
    expect(board.columns.failed.map((x) => x.id)).toEqual(['e']);
    expect(board.columns.todo.map((x) => x.id).sort()).toEqual(['f', 'g']); // ready/triage 折叠进 todo
  });
  it('orders running column by heartbeat time', () => {
    const a = t('a', 'running', 'w'); a.heartbeats = [1];
    const b = t('b', 'running', 'w'); b.heartbeats = [5];
    const board = foldBoard([a, b]);
    expect(board.columns.running.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
