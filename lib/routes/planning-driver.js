import { KanbanService } from '../domain/kanban-service.js';
import { parsePrefix } from './prefix-router.js';
import { DEFAULT_PREFIX_ROUTES } from '../config.js';
/** 阶段 0 规划引导：命令串从 config 派生（决策12），/openspec: 改名时文案自动跟随。 */
export function buildPlanningGuidance(routes) {
    return `
# 阶段 0 规划对话（v2：需求澄清前置化）
1. 需求澄清（grill-me）：一次只问一个问题，先澄清目的、约束、成功标准；逐项拷问假设直至用户"没有任何疑问"。
2. 仓库事实（planning_prefetch）：调只读子代理采集目标仓库/资料/知识库事实（本地路径/分支/目标文件基线/既有实现），不凭空假设。
3. 收敛（planning_checklist_save）：把结论写成结构化需求澄清清单（spec 六段 + manifest repo.files + 澄清问答 + 疑问点）存入 KB（KB 不可达自动兜底临时目录）。
4. 收尾：提醒用户以 ${routes.openspec} 确认执行结束规划阶段——${routes.openspec} 会从清单建链并自动串行执行。
护栏：规划期只读仓库，禁止任何 git/源码写入；只写 KB 与临时目录。
`;
}
export function validateSpecCardForApproval(card) {
    const missing = [];
    const s = card.sections;
    if (typeof s.problem !== 'string' || !s.problem.trim())
        missing.push('problem');
    if (typeof s.solution !== 'string' || !s.solution.trim())
        missing.push('solution');
    if (!Array.isArray(s.user_stories) || s.user_stories.length === 0)
        missing.push('user_stories');
    if (typeof s.testing !== 'string' || !s.testing.trim())
        missing.push('testing');
    if (typeof s.out_of_scope !== 'string' || !s.out_of_scope.trim())
        missing.push('out_of_scope');
    if (!card.attachments.some((a) => a.kind === 'file-prefetch'))
        missing.push('attachments:file-prefetch');
    return missing;
}
export function buildPlanningContext(chainId, card, attachments, routes = DEFAULT_PREFIX_ROUTES) {
    return [
        `# 规划上下文 chain=${chainId} specCard=${card.id}`,
        buildPlanningGuidance(routes),
        `## 当前规格卡\n${JSON.stringify(card.sections, null, 2)}`,
        `## 仓库事实附件\n${attachments.map((a) => `${a.name}: ${a.ref}`).join('\n') || '(无)'}`,
    ].join('\n\n');
}
export async function approveIfReady(message, service, cfg, chainId, specCardId) {
    const parsed = parsePrefix(message, cfg);
    if (parsed.kind !== 'openspec')
        return { ok: false, missing: ['prefix'], guidance: buildPlanningGuidance(cfg) };
    const state = await service.snapshot();
    const card = state.specCards.get(specCardId);
    if (!card)
        return { ok: false, missing: ['spec-card'], guidance: buildPlanningGuidance(cfg) };
    if (card.status === 'approved')
        return { ok: true, card };
    const missing = validateSpecCardForApproval(card);
    if (missing.length > 0) {
        return { ok: false, missing, guidance: buildPlanningGuidance(cfg) };
    }
    const approved = await service.approveSpecCard(specCardId, 'human');
    return { ok: true, card: approved };
}
