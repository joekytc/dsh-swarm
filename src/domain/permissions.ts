import type { Role, Task } from './types.js';

export type KanbanAction =
  | 'create-task' | 'create-chain' | 'claim' | 'complete' | 'block' | 'unblock'
  | 'comment' | 'heartbeat' | 'archive' | 'force-edit'
  | 'spec-approve' | 'spec-edit' | 'spec-attach' | 'wiki-write' | 'wiki-read' | 'prefetch'
  | 'audit-confirm'; // D23：链完成验收核对确认（仅 human）

export type Actor = Role | 'human' | 'system';

export function can(action: KanbanAction, actor: Actor, task: Task | null, opts: { isOwnTask?: boolean; boundTaskId?: string } = {}): boolean {
  // P1-4：会话绑定——角色 agent 只能操作其被 spawn 绑定的任务（boundTaskId=AgentSessionRef.task_id）；
  // 旧 own（仅查 assignee）允许"链上任意同角色任务"，属跨任务越权，已废弃。
  const bound = opts.boundTaskId !== undefined && task !== null && opts.boundTaskId === task.id;
  switch (action) {
    case 'create-task':
    case 'create-chain':
      return actor === 'v' || actor === 'human';
    case 'claim':
      return actor === 'system';
    case 'complete':
      // 仅绑定该任务的 agent 会话（boundTaskId 匹配且角色=任务 assignee）、系统收尾，
      // 或 human（GUI 强制收尾，T27：human 为信任锚，不算越权）；跨角色 bound 拒。
      return actor === 'system' || actor === 'human' || (bound && actor === task!.assignee);
    case 'block':
      return actor === 'system' || actor === 'human' || bound;
    case 'heartbeat':
      return bound;
    case 'comment':
      return true;
    case 'unblock':
      return actor === 'human';
    case 'archive':
      return actor === 'human' || actor === 'v';
    case 'force-edit':
      return actor === 'human';
    case 'spec-approve':
      return actor === 'human';
    case 'spec-edit':
      // P1-4：规格卡编辑仅 human（主会话前台）；P 对规格卡只读
      return actor === 'human';
    case 'spec-attach':
      // V 挂 W1-pre 预取产物到规格卡附件；human 亦可（GUI 上传）
      return actor === 'v' || actor === 'human';
    case 'wiki-write':
      return actor === 'w';
    case 'wiki-read':
      return actor === 'w' || actor === 'd';
    case 'prefetch':
      return actor === 'w';
    case 'audit-confirm':
      // D23：仅人类在 GUI 确认产物归属；system/角色均不可
      return actor === 'human';
  }
}
