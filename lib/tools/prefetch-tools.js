import { defineTool } from '@deepseek-ai/dsh-tools';
import { can } from '../domain/permissions.js';
function guard(action, caller) {
    if (!can(action, caller.actor, null))
        throw new Error('permission denied: ' + action);
}
/** 预取工具工厂（W 角色 agent scope）：file/external/kb 三模式，产物引用登记（原汁原味，禁压缩）。 */
export function buildPrefetchTools(worker, getTask, getCaller) {
    return [
        defineTool({
            name: 'prefetch_file',
            description: 'Register a read-only file-prefetch artifact reference under the task workspace.',
            parameters: {
                taskId: { type: 'string', required: true },
                source: { type: 'string', required: true, description: 'Absolute path under the task workspace' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
            async execute(args) {
                const caller = getCaller();
                guard('prefetch', caller);
                const task = await getTask(args.taskId);
                const out = await worker.executePrefetch(task, 'file', args.source);
                return out;
            },
        }),
        defineTool({
            name: 'prefetch_external',
            description: 'Register an external-research prefetch artifact (writes ws/prefetch-external.md).',
            parameters: {
                taskId: { type: 'string', required: true },
                source: { type: 'string', description: 'Optional path; defaults to the workspace prefetch-external.md' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
            async execute(args) {
                const caller = getCaller();
                guard('prefetch', caller);
                const task = await getTask(args.taskId);
                const out = await worker.executePrefetch(task, 'external', args.source ?? '');
                return out;
            },
        }),
        defineTool({
            name: 'prefetch_kb',
            description: 'Register a knowledge-base prefetch artifact (writes ws/prefetch-kb.md).',
            parameters: {
                taskId: { type: 'string', required: true },
                source: { type: 'string', description: 'Optional path; defaults to the workspace prefetch-kb.md' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
            async execute(args) {
                const caller = getCaller();
                guard('prefetch', caller);
                const task = await getTask(args.taskId);
                const out = await worker.executePrefetch(task, 'kb', args.source ?? '');
                return out;
            },
        }),
    ];
}
