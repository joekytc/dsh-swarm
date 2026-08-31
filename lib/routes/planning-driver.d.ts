import { KanbanService } from '../domain/kanban-service.js';
import type { SpecCard, SpecCardAttachment } from '../domain/types.js';
import { type PrefixRoutes } from '../config.js';
/** 阶段 0 规划引导：命令串从 config 派生（决策12），/openspec: 改名时文案自动跟随。 */
export declare function buildPlanningGuidance(routes: PrefixRoutes): string;
export declare function validateSpecCardForApproval(card: SpecCard): string[];
export declare function buildPlanningContext(chainId: string, card: SpecCard, attachments: SpecCardAttachment[], routes?: PrefixRoutes): string;
export declare function approveIfReady(message: string, service: KanbanService, cfg: PrefixRoutes, chainId: string, specCardId: string): Promise<{
    ok: true;
    card: SpecCard;
} | {
    ok: false;
    missing: string[];
    guidance: string;
}>;
