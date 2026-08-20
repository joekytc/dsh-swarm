import type { Role, Task } from './types.js';
export type KanbanAction = 'create-task' | 'create-chain' | 'claim' | 'complete' | 'block' | 'unblock' | 'comment' | 'heartbeat' | 'archive' | 'force-edit' | 'spec-approve' | 'spec-edit' | 'spec-attach' | 'wiki-write' | 'wiki-read' | 'prefetch' | 'audit-confirm' | 'create-rework-task';
export type Actor = Role | 'human' | 'system';
export declare function can(action: KanbanAction, actor: Actor, task: Task | null, opts?: {
    isOwnTask?: boolean;
    boundTaskId?: string;
}): boolean;
