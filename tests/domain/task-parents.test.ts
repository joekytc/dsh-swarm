import { describe, it, expect } from 'vitest';
import type { Role, Task, TaskMode } from '../../src/domain/types.js';
import { resolveTaskParents, semanticParentDeps, nonTerminalSemanticParents } from '../../src/domain/task-parents.js';

let seq = 0;
const nid = () => 't_' + (++seq);
const task = (assignee: Role, mode: TaskMode, status: Task['status'] = 'done', chainId = 'c_1'): Task => ({
  id: nid(), chainId, title: `${assignee}/${mode}`, body: '', assignee, status, mode, priority: 1,
  parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [], sessionId: 'kbn-x',
  reworkOfTaskId: null, resumeSessionId: null, reviewAttempt: 0, reviewStatus: 'not-required',
});

describe('resolveTaskParents（语义父交接推断）', () => {
  it('w/file 不再是语义父来源（v2：未列 mode 返回空）', () => {
    expect(resolveTaskParents([], 'c_1', 'w', 'file')).toEqual([]);
  });

  it('p/openspec 无语义父（v2：读规格卡，无 w1 预取父卡）', () => {
    const w1 = task('w', 'file', 'done');
    expect(resolveTaskParents([w1], 'c_1', 'p', 'openspec')).toEqual([]);
  });

  it('w/file、w/external 不再作为 p 的语义父（v2 移除 w1 预取）', () => {
    const w1 = task('w', 'file', 'done');
    const supp = task('w', 'external', 'done');
    expect(resolveTaskParents([w1, supp], 'c_1', 'p', 'openspec')).toEqual([]);
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

describe('semanticParentDeps / nonTerminalSemanticParents', () => {
  it('pt 语义父 = p/openspec（无论状态）', () => {
    const p = task('p', 'openspec', 'blocked');
    expect(semanticParentDeps([p], 'c_1', 'pt', 'review-plan')).toEqual([{ assignee: 'p', mode: 'openspec' }]);
  });

  it('w/kb 在 d 已交付时语义父 = d（w3），否则 = p（w2）', () => {
    const p = task('p', 'openspec', 'done');
    expect(semanticParentDeps([p], 'c_1', 'w', 'kb')).toEqual([{ assignee: 'p', mode: 'openspec' }]);
    const d = task('d', 'execute', 'done');
    expect(semanticParentDeps([p, d], 'c_1', 'w', 'kb')).toEqual([{ assignee: 'd', mode: 'execute' }]);
  });

  it('d 语义父 = w/kb；dt 语义父 = d/execute', () => {
    expect(semanticParentDeps([], 'c_1', 'd', 'execute')).toEqual([{ assignee: 'w', mode: 'kb' }]);
    expect(semanticParentDeps([], 'c_1', 'dt', 'review-impl')).toEqual([{ assignee: 'd', mode: 'execute' }]);
  });

  it('p/openspec 无语义父；未知 mode 无语义父', () => {
    expect(semanticParentDeps([], 'c_1', 'p', 'openspec')).toEqual([]);
    expect(semanticParentDeps([], 'c_1', 'd', 'align')).toEqual([]);
  });

  it('nonTerminalSemanticParents：blocked 上游被捕获，done 上游不捕获', () => {
    const pBlocked = task('p', 'openspec', 'blocked');
    const pDone = task('p', 'openspec', 'done');
    expect(nonTerminalSemanticParents([pBlocked], 'c_1', 'pt', 'review-plan').map((t) => t.id)).toEqual([pBlocked.id]);
    expect(nonTerminalSemanticParents([pDone], 'c_1', 'pt', 'review-plan')).toEqual([]);
  });

  it('nonTerminalSemanticParents：w/kb 只按当前语义父捕获（w2→p blocked 捕获；w3→d 不理会旧 p blocked）', () => {
    const pBlocked = task('p', 'openspec', 'blocked');
    const dDone = task('d', 'execute', 'done');
    // w3 语义父 = d（done）→ 不拦截，即便有旧 p blocked
    expect(nonTerminalSemanticParents([pBlocked, dDone], 'c_1', 'w', 'kb')).toEqual([]);
    // w2 语义父 = p（blocked）→ 拦截
    expect(nonTerminalSemanticParents([pBlocked], 'c_1', 'w', 'kb').map((t) => t.id)).toEqual([pBlocked.id]);
  });
});