/**
 * 每阶段任务卡的语义输入来源（R20 依赖)：第 1 项为主来源。
 * key = `${assignee}:${mode}`；w:kb 特判（w2→P、w3→D）见 resolveTaskParents。
 * 未列出的 mode（如旧兼容 align）不设语义 parents（返回空）。
 */
const PARENT_DEPS = {
    'w:file': [], // w1-pre 首卡：输入=规格卡，无父任务
    'w:external': [{ assignee: 'w', mode: 'file' }], // w1-supp → w1-pre
    'p:openspec': [
        { assignee: 'w', mode: 'file' }, // 主来源：W1-pre 仓库事实
        { assignee: 'w', mode: 'external' }, // 可选：W1-supp 补充预取（存在才并入）
    ],
    'pt:review-plan': [{ assignee: 'p', mode: 'openspec' }], // PT 评审 P 计划
    'd:execute': [{ assignee: 'w', mode: 'kb' }], // D 接 W2（P 计划同步 KB 后的 page_path/kb_url，wiki_read 读实施计划执行）
    'dt:review-impl': [{ assignee: 'd', mode: 'execute' }], // DT 评审 D 交付
};
/**
 * 解析某角色任务的语义父任务 id（终态 done/archived）。供 createTask 兜底与 V 建卡指令共用，
 * 消除「V 建卡漏设 parents → 父交接注入断裂」的软约定风险（P 依赖父交接注入 W1-pre 事实）。
 * w:kb 特判：链上 d/execute 已交付 → w3（父=D）；否则 w2（父=P）。
 */
export function resolveTaskParents(tasks, chainId, assignee, mode) {
    const done = [...tasks].filter((t) => t.chainId === chainId && (t.status === 'done' || t.status === 'archived'));
    const ids = (a, m) => done.filter((t) => t.assignee === a && t.mode === m).map((t) => t.id);
    if (assignee === 'w' && mode === 'kb') {
        const d = ids('d', 'execute');
        return d.length > 0 ? d : ids('p', 'openspec'); // w3 → D；w2 → P
    }
    const deps = PARENT_DEPS[`${assignee}:${mode}`] ?? [];
    return deps.flatMap((d) => ids(d.assignee, d.mode));
}
