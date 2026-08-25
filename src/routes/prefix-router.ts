import { KanbanService } from '../domain/kanban-service.js';
import type { PlanningChecklist } from '../domain/planning-checklist.js';

export interface PrefixRouteResult {
  kind: 'plan' | 'openspec' | 'none';
  chainId?: string;
  specCardId?: string;
  rest: string;
}

export function parsePrefix(message: string, cfg: { plan: string; openspec: string }): PrefixRouteResult {
  const trimmed = message.trim();
  if (trimmed.startsWith(cfg.plan)) return { kind: 'plan', rest: trimmed.slice(cfg.plan.length).trim() };
  if (trimmed.startsWith(cfg.openspec)) return { kind: 'openspec', rest: trimmed.slice(cfg.openspec.length).trim() };
  return { kind: 'none', rest: trimmed };
}

/** v2：/plan: 零副作用——不建链/规格卡/任务卡，仅返回路由结果（workspaceDir/sessionId 由 main-session-tools 捕获）。 */
export async function handlePlanRoute(
  message: string,
  _service: KanbanService,
  cfg: { plan: string; openspec: string },
  _ownerSessionId: string,
): Promise<PrefixRouteResult> {
  return parsePrefix(message, cfg);
}

export interface OpenspecPlanningInput {
  workspaceDir: string | null;
  checklist: PlanningChecklist;
  checklistRef: string; // KB page path 或临时目录路径（checklist 完整资料落点）
}

/** v2：/openspec: 建链——从清单机械映射规格卡六段 → 挂 file-prefetch(仓库 localPath)+kb(清单页) → 批准 → executing。 */
export async function handleOpenspecRoute(
  message: string,
  service: KanbanService,
  cfg: { plan: string; openspec: string },
  planning: OpenspecPlanningInput,
  ownerSessionId: string,
): Promise<PrefixRouteResult> {
  const parsed = parsePrefix(message, cfg);
  if (parsed.kind !== 'openspec') return parsed;
  const chain = await service.createChain({ title: parsed.rest.slice(0, 60), ownerSessionId, workspaceDir: planning.workspaceDir }, 'human');
  const card = await service.createSpecCard(chain.id, planning.checklist.spec, 'human');
  await service.addSpecCardAttachment(card.id, { name: '需求澄清清单(仓库事实)', kind: 'file-prefetch', ref: planning.checklist.manifest.repo.localPath }, 'v');
  await service.addSpecCardAttachment(card.id, { name: '需求澄清清单(完整资料)', kind: 'kb', ref: planning.checklistRef }, 'v');
  await service.approveSpecCard(card.id, 'human');
  return { kind: 'openspec', chainId: chain.id, specCardId: card.id, rest: parsed.rest };
}
