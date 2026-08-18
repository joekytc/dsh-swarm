import type { BoardState, Chain, KanbanEvent, Task } from '../../src/domain/types.js';

const chain = (id: string, status: Chain['status']): Chain => ({
  id,
  title: id === 'ch_running' ? '用户登录重构' : id === 'ch_blocked' ? '对话导出失败修复' : id === 'ch_archived' ? '归档演示链路' : '插件发布说明',
  status, rootTaskId: null, specCardId: null, ownerSessionId: 's', workspaceDir: null, createdAt: 1,
});
const task = (id: string, chainId: string, assignee: Task['assignee'], mode: Task['mode'], status: Task['status'], parents: string[] = []): Task => ({
  id, chainId, title: id, body: '', assignee, status, mode, priority: 1, parents, children: [], createdBy: 'v', attempts: 0, heartbeats: status === 'running' ? [9_000] : [],
});
const created = (seq: number, value: Task): KanbanEvent => ({
  seq, chainId: value.chainId, taskId: value.id, kind: 'task/created', payload: { ...value }, author: 'v', at: seq * 100,
});

export function workflowFixture(): BoardState {
  const tasks = [
    task('t_pre', 'ch_running', 'w', 'file', 'done'),
    task('t_p', 'ch_running', 'p', 'openspec', 'done', ['t_pre']),
    task('t_w2', 'ch_running', 'w', 'kb', 'done', ['t_p']),
    task('t_d', 'ch_running', 'd', 'execute', 'running', ['t_w2']),
    task('t_w3', 'ch_running', 'w', 'kb', 'todo', ['t_d']),
    task('t_blocked', 'ch_blocked', 'w', 'external', 'blocked'),
    task('t_arch', 'ch_archived', 'w', 'kb', 'archived'),
  ];
  const events: KanbanEvent[] = [
    ...tasks.map((value, index) => created(index + 1, value)),
    { seq: 8, chainId: 'ch_blocked', taskId: 't_blocked', kind: 'task/blocked', payload: { reason: 'kb-unreachable' }, author: 'w', at: 800 },
    { seq: 9, chainId: 'ch_done', taskId: null, kind: 'chain/completed', payload: {}, author: 'system', at: 900 },
  ];
  return {
    chains: new Map([
      ['ch_running', chain('ch_running', 'executing')],
      ['ch_blocked', chain('ch_blocked', 'executing')],
      ['ch_done', chain('ch_done', 'completed')],
      ['ch_archived', chain('ch_archived', 'aborted')],
    ]),
    tasks: new Map(tasks.map((value) => [value.id, value])),
    specCards: new Map(),
    handoffs: new Map(),
    auditWarnings: new Map(),
    events,
  };
}
