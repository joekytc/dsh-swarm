export function can(action, actor, task, opts = {}) {
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
            return actor === 'system' || actor === 'human' || (bound && actor === task.assignee);
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
        case 'spec-approve':
            return actor === 'human';
        case 'spec-edit':
            // P1-4：规格卡编辑仅 human（主会话前台）；P 对规格卡只读
            return actor === 'human';
        case 'spec-attach':
            // V 挂清单附件到规格卡（/openspec: 建链）；human 亦可（GUI 上传）
            return actor === 'v' || actor === 'human';
        case 'wiki-write':
            // 交付质量链：w 写 KB 正文；dt 仅写 projects/<chain>/review/ 评审命名空间（ToolGuard 层再收窄路径）
            return actor === 'w' || actor === 'dt';
        case 'wiki-read':
            // w/d 读 KB 正文；dt 需读 KB 校验（评审只读）；pt 无 wiki 工具面
            return actor === 'w' || actor === 'd' || actor === 'dt';
        case 'prefetch':
            return actor === 'w';
        case 'audit-confirm':
            // D23：仅人类在 GUI 确认产物归属；system/角色均不可
            return actor === 'human';
        case 'create-rework-task':
            // 评审失败返工卡创建：仅系统（V 建执行卡、system 建返工卡，防角色伪造返工链）
            return actor === 'system';
    }
}
