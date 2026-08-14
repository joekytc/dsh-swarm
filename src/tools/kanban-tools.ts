import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import { KanbanService } from '../domain/kanban-service.js';
import { can, type Actor } from '../domain/permissions.js';
import type { TaskMode, Role } from '../domain/types.js';

/** 工具执行上下文：由角色 agent scope 注入；主会话=human；调度器=system。
 *  boundTaskId：角色 agent 会话绑定的任务（AgentSessionRef.task_id，P1-4 会话绑定）。 */
export interface ToolCaller { actor: Actor; boundTaskId?: string; }

function guard(action: Parameters<typeof can>[0], caller: ToolCaller, task = null) {
  if (!can(action, caller.actor, task)) throw new Error('permission denied: ' + action);
}

/** 工具定义工厂（P1-3）：不直接注册；由 T15 toolsets 按角色 agent-scope 装配，或由主会话注册其专属子集。
 *  getCaller：装配方提供的闭包（捕获 actor/boundTaskId），execute 内取用——不依赖 execute 第二参数（DSH ToolRunContext 真实形状以官方为准）。 */
export function buildKanbanTools(service: KanbanService, getCaller: () => ToolCaller) {
  return [
    defineTool({
      name: 'kanban_show',
      description: 'Show a kanban task with its handoffs and comments.',
      parameters: {
        taskId: { type: 'string', required: true, description: 'Task id (t_xxx)' },
      },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { taskId: string }) {
        const caller = getCaller();
        guard('comment', caller);
        const state = await service.snapshot();
        const task = state.tasks.get(args.taskId);
        if (!task) throw new Error('unknown task: ' + args.taskId);
        const handoff = state.handoffs.get(args.taskId) ?? null;
        const comments = state.events.filter((e) => e.taskId === args.taskId && e.kind === 'task/commented').map((e) => e.payload['body']);
        return { task, handoff, comments } as unknown as JsonValue;
      },
    }),
    defineTool({
      name: 'kanban_create',
      description: 'Create a kanban task (orchestrator V or human only).',
      parameters: {
        chainId: { type: 'string', required: true, description: 'Chain id (ch_xxx)' },
        title: { type: 'string', required: true },
        body: { type: 'string', description: 'Task body; handoffs are injected via parents, not body' },
        assignee: { type: 'string', enum: ['v', 'p', 'w', 'd'], required: true },
        mode: { type: 'string', enum: ['file', 'external', 'kb', 'openspec', 'mattpocock', 'align'], required: true },
        parents: { type: 'array', items: { type: 'string' } },
      },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { chainId: string; title: string; body?: string; assignee: Role; mode: TaskMode; parents?: string[] }) {
        const caller = getCaller();
        guard('create-task', caller);
        return (await service.createTask(args, caller.actor)) as unknown as JsonValue;
      },
    }),
    defineTool({
      name: 'kanban_complete',
      description: 'Complete a task with handoff summary and metadata.',
      parameters: {
        taskId: { type: 'string', required: true },
        summary: { type: 'string', required: true, description: 'Human-readable completion summary' },
        metadata: { type: 'json', description: 'Machine-readable handoff: changed_files/verification/kb_url...' },
      },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { taskId: string; summary: string; metadata?: JsonValue }) {
        const caller = getCaller();
        const done = await service.completeTask(args.taskId, { summary: args.summary, metadata: (args.metadata as Record<string, unknown> | undefined) ?? {}, completedAt: Date.now() }, caller.actor, { boundTaskId: caller.boundTaskId });
        return done as unknown as JsonValue;
      },
    }),
    defineTool({
      name: 'kanban_block',
      description: 'Block a task with a reason (needs human input).',
      parameters: {
        taskId: { type: 'string', required: true },
        reason: { type: 'string', required: true },
      },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { taskId: string; reason: string }) {
        const caller = getCaller();
        const blocked = await service.blockTask(args.taskId, args.reason, caller.actor, { boundTaskId: caller.boundTaskId });
        return blocked as unknown as JsonValue;
      },
    }),
    defineTool({
      name: 'kanban_heartbeat',
      description: 'Signal liveness during a long task.',
      parameters: { taskId: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { taskId: string }) {
        const caller = getCaller();
        const beat = await service.heartbeat(args.taskId, caller.actor, { boundTaskId: caller.boundTaskId });
        return beat as unknown as JsonValue;
      },
    }),
    defineTool({
      name: 'kanban_comment',
      description: 'Append a persistent comment to a task thread.',
      parameters: {
        taskId: { type: 'string', required: true },
        body: { type: 'string', required: true },
      },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { taskId: string; body: string }) {
        const caller = getCaller();
        const ev = await service.comment(args.taskId, args.body, caller.actor);
        return ev as unknown as JsonValue;
      },
    }),
    defineTool({
      name: 'kanban_list',
      description: 'List tasks filtered by assignee/status.',
      parameters: {
        assignee: { type: 'string', enum: ['v', 'p', 'w', 'd'] },
        status: { type: 'string' },
      },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { assignee?: Role; status?: string }) {
        const caller = getCaller();
        guard('comment', caller);
        const list = await service.listTasks(args as never);
        return list as unknown as JsonValue;
      },
    }),
    defineTool({
      name: 'kanban_unblock',
      description: 'Unblock a task (human only).',
      parameters: { taskId: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { taskId: string }) {
        const caller = getCaller();
        const task = await service.unblockTask(args.taskId, caller.actor);
        return task as unknown as JsonValue;
      },
    }),
  ];
}
