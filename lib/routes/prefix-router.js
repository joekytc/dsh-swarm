import { KanbanService } from '../domain/kanban-service.js';
export function parsePrefix(message, cfg) {
    const trimmed = message.trim();
    if (trimmed.startsWith(cfg.plan))
        return { kind: 'plan', rest: trimmed.slice(cfg.plan.length).trim() };
    if (trimmed.startsWith(cfg.openspec))
        return { kind: 'openspec', rest: trimmed.slice(cfg.openspec.length).trim() };
    return { kind: 'none', rest: trimmed };
}
/** plan 路由：建链 + 规格卡草稿 + 通知 V 派 W1-pre（V 唤醒由 dispatcher 订阅 chain/created）。 */
export async function handlePlanRoute(message, service, cfg, ownerSessionId, workspaceDir) {
    const parsed = parsePrefix(message, cfg);
    if (parsed.kind !== 'plan')
        return parsed;
    const chain = await service.createChain({ title: parsed.rest.slice(0, 60), ownerSessionId, workspaceDir }, 'human');
    const card = await service.createSpecCard(chain.id, {
        problem: parsed.rest, solution: '', user_stories: [], impl_decisions: [], testing: '', out_of_scope: '',
    }, 'human');
    return { kind: 'plan', chainId: chain.id, specCardId: card.id, rest: parsed.rest };
}
/** openspec 路由（T10 基础版）：识别前缀并批准 draft 规格卡 → 链路 executing。 */
export async function handleOpenspecRoute(message, service, cfg, chainId, specCardId) {
    const parsed = parsePrefix(message, cfg);
    if (parsed.kind !== 'openspec')
        return parsed;
    await service.approveSpecCard(specCardId, 'human');
    return { kind: 'openspec', chainId, specCardId, rest: parsed.rest };
}
