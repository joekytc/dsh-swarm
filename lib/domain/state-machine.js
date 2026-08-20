const TASK_TRANSITIONS = {
    triage: { 'task/claimed': 'running' },
    todo: { 'task/claimed': 'running', 'task/archived': 'archived' },
    ready: { 'task/claimed': 'running', 'task/archived': 'archived' },
    running: { 'task/completed': 'done', 'task/blocked': 'blocked', 'task/failed': 'failed', 'task/heartbeat': 'running' },
    blocked: { 'task/unblocked': 'ready', 'task/archived': 'archived' },
    done: { 'task/archived': 'archived' },
    failed: { 'task/claimed': 'running', 'task/blocked': 'blocked', 'task/archived': 'archived' },
    archived: {},
};
const CHAIN_TRANSITIONS = {
    planning: { 'chain/executing': 'executing' },
    executing: { 'chain/completed': 'completed', 'chain/aborted': 'aborted' },
    completed: {},
    aborted: {},
};
// D23：'chain/audit-warning' / 'chain/audit-confirmed' 不是状态转换——
// Chain 保持 completed，只向投影写入验收核对视图（auditWarnings）。
// projection.ts 对这两类事件专门处理、不调用 transitionChain，故此处不注册。
const SPEC_TRANSITIONS = {
    draft: { 'spec-card/approved': 'approved' },
    approved: {},
};
function step(name, table, current, kind) {
    const next = table[current]?.[kind];
    if (next === undefined)
        throw new Error(`illegal transition: ${current} --${kind}--> (none)`);
    return next;
}
export const transitionTask = (c, k) => step('task', TASK_TRANSITIONS, c, k);
export const transitionChain = (c, k) => step('chain', CHAIN_TRANSITIONS, c, k);
export const transitionSpecCard = (c, k) => step('spec', SPEC_TRANSITIONS, c, k);
