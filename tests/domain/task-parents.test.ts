import { describe, it, expect } from 'vitest';
import type { Role, Task, TaskMode } from '../../src/domain/types.js';
import { resolveTaskParents } from '../../src/domain/task-parents.js';

let seq = 0;
const nid = () => 't_' + (++seq);
const task = (assignee: Role, mode: TaskMode, status: Task['status'] = 'done', chainId = 'c_1'): Task => ({
  id: nid(), chainId, title: `${assignee}/${mode}`, body: '', assignee, status, mode, priority: 1,
  parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [], sessionId: 'kbn-x',
  reworkOfTaskId: null, resumeSessionId: null, reviewAttempt: 0, reviewStatus: 'not-required',
});

describe('resolveTaskParents（语义父交接推断）', () => {
  it('w/file（w1-pre 首卡）无父', () => {
    expect(resolveTaskParents([], 'c_1', 'w', 'file')).toEqual([]);
  });

  it('p/openspec 自动接已 done 的 w/file（w1-pre）', () => {
    const w1 = task('w', 'file', 'done');
    expect(resolveTaskParents([w1], 'c_1', 'p', 'openspec')).toEqual([w1.id]);
  });

  it('p/openspec 合并 w1-pre + w1-supp', () => {
    const w1 = task('w', 'file', 'done');
    const supp = task('w', 'external', 'done');
    expect(resolveTaskParents([w1, supp], 'c_1', 'p', 'openspec')).toEqual([w1.id, supp.id]);
  });

  it('pt/review-plan 接 p/openspec', () => {
    const p = task('p', 'openspec', 'done');
    expect(resolveTaskParents([p], 'c_1', 'pt', 'review-plan')).toEqual([p.id]);
  });

  it('w/kb 在 d 未交付时接 p（w2）', () => {
    const p = task('p', 'openspec', 'done');
    expect(resolveTaskParents([p], 'c_1', 'w', 'kb')).toEqual([p.id]);
  });

  it('w/kb 在 d 已交付时接 d（w3）', () => {
    const p = task('p', 'openspec', 'done');
    const d = task('d', 'execute', 'done');
    expect(resolveTaskParents([p, d], 'c_1', 'w', 'kb')).toEqual([d.id]);
  });

  it('d/execute 接 w/kb（W2，读 KB 实施计划）', () => {
    const w2 = task('w', 'kb', 'done');
    expect(resolveTaskParents([w2], 'c_1', 'd', 'execute')).toEqual([w2.id]);
  });

  it('dt/review-impl 接 d/execute', () => {
    const d = task('d', 'execute', 'done');
    expect(resolveTaskParents([d], 'c_1', 'dt', 'review-impl')).toEqual([d.id]);
  });

  it('忽略非终态（running/todo）与其它链任务', () => {
    const w1running = task('w', 'file', 'running', 'c_1');
    const otherChain = task('w', 'file', 'done', 'c_2');
    expect(resolveTaskParents([w1running, otherChain], 'c_1', 'p', 'openspec')).toEqual([]);
  });

  it('未知 mode（align）不设语义父', () => {
    expect(resolveTaskParents([], 'c_1', 'd', 'align')).toEqual([]);
  });
});