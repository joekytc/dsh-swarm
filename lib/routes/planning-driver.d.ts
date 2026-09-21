import { KanbanService } from '../domain/kanban-service.js';
import type { SpecCard, SpecCardAttachment } from '../domain/types.js';
import { type PrefixRoutes } from '../config.js';
/** 阶段 0 规划引导：命令串从 config 派生，/openspec: 改名时文案自动跟随。
 *  提问节奏与 skills/grill-me/SKILL.md 对齐：官方 frontier 分轮制（整批问 + 推荐答案 + 答复后解锁下一轮）；
 *  需求澄清十规则：来源必挂 + PRD 采集 + 范围边界 + 人话 + 仓库事实/缺口暂停 + 收敛录入铁律（含决策可追溯）；
 *  收敛产物仍为 planning_checklist_save（KB 清单是建链数据源）。 */
export declare function buildPlanningGuidance(routes: PrefixRoutes, opts?: {
    swarm?: boolean;
}): string;
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
