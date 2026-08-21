import type { Context } from '@deepseek-ai/cordis';
import { KanbanService } from '../domain/kanban-service.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import type { Role } from '../domain/types.js';
/** 判定 wiki 路径是否位于 DT 评审命名空间 projects/<chain>/review/（拒绝 ../、绝对路径、非 review 前缀）。 */
export declare function isReviewNamespacePath(pagePath: string, chainId: string): boolean;
/**
 * 评审引擎决策（DT）：ocr（open-code-review Delegation 模式）优先；
 * 不可用 fallback superpowers code-review；两者都不可用 → review-tool-unavailable（阻塞）。
 * 纯函数便于单测；真实可用性探测在 agent-runner 装配（探活 ocr 二进制/失败）。
 */
export declare function resolveReviewEngine(available: {
    ocr: boolean;
    codeReview: boolean;
}): 'ocr' | 'code-review' | 'review-tool-unavailable';
/**
 * DT 写护栏 = PT 只读护栏（源码/git/写标记 bash 拒绝）+ wiki_write 仅 review namespace 收窄。
 * repoRoot 为 D 目标仓库；chainId 用于 wiki 评审命名空间校验。
 */
export declare function buildDTWriteGuard(repoRoot: string, chainId: string): (execution: {
    name?: string;
    arguments?: unknown;
}) => string | undefined;
export declare function buildReadOnlyWriteGuard(repoRoot: string): (execution: {
    name?: string;
    arguments?: unknown;
}) => string | undefined;
/** 按角色在 agent scope 注册工具面（P1-3 统一注册策略）：
 *  所有 kanban 工具从 T9 工厂选取 + getCaller 闭包（actor=role、boundTaskId=taskId）。
 *  can() 权限兜底仍保留在工具 execute 内（纵深防御第二道）。 */
export declare function installRoleTools(agentCtx: Context, role: Role, deps: {
    kanban: KanbanService;
    wiki: WikiVaultClient;
    taskId?: string;
}): Promise<void>;
export declare function registerDtTaskChain(taskId: string, chainId: string): void;
export declare function unregisterDtTaskChain(taskId: string): void;
export interface SubagentGuardDeps {
    /** kbn-<taskId> → chainId 同步解析（缺省用 module 缓存；测试注入用）。 */
    getTaskChainId?(taskId: string): string | undefined;
}
/** 全局子代理写护栏：仅 DT 系（agentPreset === 'kanban-dt'）应用 buildDTWriteGuard。
 *  repoRoot 取子代理 header.cwd（继承 DT 会话 cwd=评审目标仓库）；缺省 '/'（写标记
 *  全拦的保守形态）。chainId 从 parentSession（kbn-<taskId>）解析；解析不到 → 空
 *  （wiki_write fail-closed 全拒，源码写拦截不受影响）。 */
export declare function buildSubagentTreeGuard(deps?: SubagentGuardDeps): (execution: {
    name?: string;
    arguments?: unknown;
    agent?: unknown;
}) => string | undefined;
