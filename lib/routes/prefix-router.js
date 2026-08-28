import { KanbanService, buildChainTitle } from '../domain/kanban-service.js';
import { buildLearningBrief, resolveLearningChainId } from '../domain/memory.js';
export function parsePrefix(message, cfg) {
    const trimmed = message.trim();
    if (trimmed.startsWith(cfg.plan))
        return { kind: 'plan', rest: trimmed.slice(cfg.plan.length).trim() };
    if (trimmed.startsWith(cfg.openspec))
        return { kind: 'openspec', rest: trimmed.slice(cfg.openspec.length).trim() };
    const learning = cfg.learning ?? '/learning:';
    if (trimmed.startsWith(learning))
        return { kind: 'learning', rest: trimmed.slice(learning.length).trim() };
    return { kind: 'none', rest: trimmed };
}
/** v2：/plan: 零副作用——不建链/规格卡/任务卡，仅返回路由结果（workspaceDir/sessionId 由 main-session-tools 捕获）。 */
export async function handlePlanRoute(message, _service, cfg, _ownerSessionId) {
    return parsePrefix(message, cfg);
}
/** v2：/openspec: 建链——从清单机械映射规格卡六段 → 挂 file-prefetch(仓库 localPath)+kb(清单页) → 批准 → executing。 */
export async function handleOpenspecRoute(message, service, cfg, planning, ownerSessionId) {
    const parsed = parsePrefix(message, cfg);
    if (parsed.kind !== 'openspec')
        return parsed;
    const chain = await service.createChain({
        title: buildChainTitle(planning.checklist.requirementName ?? planning.requirementName ?? null, parsed.rest, planning.checklist.spec.problem),
        ownerSessionId, workspaceDir: planning.workspaceDir,
    }, 'human');
    const card = await service.createSpecCard(chain.id, planning.checklist.spec, 'human');
    await service.addSpecCardAttachment(card.id, { name: '需求澄清清单(仓库事实)', kind: 'file-prefetch', ref: planning.checklist.manifest.repo.localPath }, 'v');
    await service.addSpecCardAttachment(card.id, { name: '需求澄清清单(完整资料)', kind: 'kb', ref: planning.checklistRef }, 'v');
    await service.approveSpecCard(card.id, 'human');
    return { kind: 'openspec', chainId: chain.id, specCardId: card.id, rest: parsed.rest };
}
/** v2：/learning: 零副作用——不建链建卡，仅机械提取证据包供主 agent 蒸馏。歧义返回候选列表，链不存在返回错误文本（不 throw）。 */
export async function handleLearningRoute(message, service, cfg, _ownerSessionId) {
    const parsed = parsePrefix(message, cfg);
    if (parsed.kind !== 'learning')
        return parsed;
    const state = await service.snapshot();
    const resolved = resolveLearningChainId(state, parsed.rest);
    if (resolved === null) {
        return { kind: 'learning', rest: parsed.rest, error: 'chain-not-found', guidance: '未找到可蒸馏经验的链。可用 /learning: <chainId> 指定，或先经 /plan:/openspec: 建立链路。' };
    }
    if ('candidates' in resolved) {
        const list = resolved.candidates.map((c) => `- ${c.chainId} ${c.title}`).join('\n');
        return { kind: 'learning', rest: parsed.rest, error: 'chain-ambiguous', guidance: `匹配到多条链，请用 /learning: <chainId> 精确指定：\n${list}` };
    }
    const brief = buildLearningBrief(state, resolved.chainId);
    const guidance = [
        '## 经验蒸馏指令（/learning:）',
        '消化上方「链上下文 + 机械信号证据包」，蒸馏 1-3 条可复用经验（返工根因 / 阻塞原因 / 审计教训）。',
        '每条约成 LearningEntry（title 一句话≤80 字符；lesson 教训；evidence 必须填本链 chain id 作机械证据；tags 自由标签）。',
        '调 planning_learning_save：scope=chain 存需求级 projects/<chainId>/learnings/；仓库通用经验用 scope=project（自动归入目标仓库项目级）。',
        '无值得沉淀的经验时，明确回复「无新经验」，不要硬凑。',
    ].join('\n');
    return { kind: 'learning', chainId: resolved.chainId, rest: parsed.rest, brief, guidance };
}
