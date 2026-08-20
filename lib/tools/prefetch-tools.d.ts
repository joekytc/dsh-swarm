import type { WikiWorker } from '../roles/wiki-worker.js';
import type { Task } from '../domain/types.js';
import type { ToolCaller } from './kanban-tools.js';
/** 预取工具工厂（W 角色 agent scope）：file/external/kb 三模式，产物引用登记（原汁原味，禁压缩）。 */
export declare function buildPrefetchTools(worker: WikiWorker, getTask: (taskId: string) => Promise<Task>, getCaller: () => ToolCaller): import("@deepseek-ai/dsh-tools").ToolDefinition[];
