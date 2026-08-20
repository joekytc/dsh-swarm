import { KanbanService } from '../domain/kanban-service.js';
export interface PrefixRouteResult {
    kind: 'plan' | 'openspec' | 'none';
    chainId?: string;
    specCardId?: string;
    rest: string;
}
export declare function parsePrefix(message: string, cfg: {
    plan: string;
    openspec: string;
}): PrefixRouteResult;
/** plan 路由：建链 + 规格卡草稿 + 通知 V 派 W1-pre（V 唤醒由 dispatcher 订阅 chain/created）。 */
export declare function handlePlanRoute(message: string, service: KanbanService, cfg: {
    plan: string;
    openspec: string;
}, ownerSessionId: string, workspaceDir?: string | null): Promise<PrefixRouteResult>;
/** openspec 路由（T10 基础版）：识别前缀并批准 draft 规格卡 → 链路 executing。 */
export declare function handleOpenspecRoute(message: string, service: KanbanService, cfg: {
    plan: string;
    openspec: string;
}, chainId: string, specCardId: string): Promise<PrefixRouteResult>;
