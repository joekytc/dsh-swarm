import { KanbanService } from '../domain/kanban-service.js';
import { parsePrefix } from './prefix-router.js';
export const MATTPOCOCK_PLANNING_GUIDANCE = `
# 阶段 0 规划对话（mattpocock 方法论）
1. ask-matt：一次只问一个问题，先澄清目的、约束、成功标准；基于规格卡附件的仓库事实提问，不凭空假设。
2. grill-me：对每个假设逐项拷问（苏格拉底式），直至用户明确表示"没有任何疑问"。
3. 收敛：把结论写入规格卡六段（problem/solution/user_stories/impl_decisions/testing/out_of_scope）。
4. 收尾：提醒用户以 /openspec: 确认执行结束规划阶段。
`;
export function validateSpecCardForApproval(card) {
    const missing = [];
    if (!card.sections.problem.trim())
        missing.push('problem');
    if (!card.sections.solution.trim())
        missing.push('solution');
    if (card.sections.user_stories.length === 0)
        missing.push('user_stories');
    if (card.sections.testing.trim() === '')
        missing.push('testing');
    if (card.sections.out_of_scope.trim() === '')
        missing.push('out_of_scope');
    if (!card.attachments.some((a) => a.kind === 'file-prefetch'))
        missing.push('attachments:file-prefetch');
    return missing;
}
export function buildPlanningContext(chainId, card, attachments) {
    return [
        `# 规划上下文 chain=${chainId} specCard=${card.id}`,
        MATTPOCOCK_PLANNING_GUIDANCE,
        `## 当前规格卡\n${JSON.stringify(card.sections, null, 2)}`,
        `## 仓库事实附件\n${attachments.map((a) => `${a.name}: ${a.ref}`).join('\n') || '(无)'}`,
    ].join('\n\n');
}
export async function approveIfReady(message, service, cfg, chainId, specCardId) {
    const parsed = parsePrefix(message, cfg);
    if (parsed.kind !== 'openspec')
        return { ok: false, missing: ['prefix'], guidance: MATTPOCOCK_PLANNING_GUIDANCE };
    const state = await service.snapshot();
    const card = state.specCards.get(specCardId);
    if (!card)
        return { ok: false, missing: ['spec-card'], guidance: MATTPOCOCK_PLANNING_GUIDANCE };
    if (card.status === 'approved')
        return { ok: true, card };
    const missing = validateSpecCardForApproval(card);
    if (missing.length > 0) {
        return { ok: false, missing, guidance: MATTPOCOCK_PLANNING_GUIDANCE };
    }
    const approved = await service.approveSpecCard(specCardId, 'human');
    return { ok: true, card: approved };
}
