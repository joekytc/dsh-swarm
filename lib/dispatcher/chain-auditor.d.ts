import type { KanbanService } from '../domain/kanban-service.js';
import type { AuditEvidence, Task } from '../domain/types.js';
/**
 * D23 链完成验收核对：Chain(completed) 时核对主会话是否越权写工作区产物。
 *
 * 数据源（修复轮 7，修复「评估项目只读排查 run_code 被误判为越权写产物」）：
 * 1. 主会话会话事件扫描（primary，尽力而为）：枚举活 agent 注册表（ctx.agents.list），
 *    对 id 非 kbn-*（角色会话确定性 id：kbn-<taskId> / kbn-v-<chainId>）的会话，
 *    扫描其 session.events 中的工具调用。插件无法解析主会话真实 session id（路由只用
 *    逻辑 id 'session_main'），故以"非角色会话写 kanban 工作区"为近似。修复轮 7 收紧三点：
 *    a. 作用域收窄：仅扫描会话工作区（session.header.cwd）位于本链发起工作区
 *       （Chain.workspaceDir = /plan: 主 agent 所在工作空间）内的会话，
 *       排除其他项目的主会话（如 评估 项目里调试 dsh-swarm 的会话）；
 *    b. 行为判定：run_code 按实际派发子调用（tool/code-dispatch-start / tool/code-dispatch，
 *       经 rootCallId 关联外层调用）判定是否真的发生写，而非把 run_code 一律视为写；
 *    c. 只读排除：bash 命令 / 兜底 code 字符串仅当含写操作标记（BASH_WRITE_RE）且
 *       含 workspacesRoot 路径时才计为写证据；纯只读排查（ls/cat/glob/read/grep）不产生证据。
 * 2. 产物归属核对（fallback，机械可测）：枚举 workspaces/<chainId>/ 下条目；
 *    角色 agent 只写各自任务工作区（workspaces/<chainId>/<taskId>/），
 *    链工作区根下非任务 id 的条目 = 无主产物（疑似主 agent 越权写）→ 证据。
 */
export interface ChainAuditorDeps {
    kanban: KanbanService;
    workspacesRoot: string;
    /** 活 agent 注册表快照（dispatcher 注入 ctx.agents.list 的适配）；测试可伪造。 */
    listLiveAgents?: () => Array<{
        id: string;
        session?: {
            events: unknown[];
            header?: {
                cwd?: string;
                agentPreset?: string;
            };
        };
    }>;
}
export declare class ChainAuditor {
    private readonly kanban;
    private readonly workspacesRoot;
    private readonly listLiveAgents;
    constructor(deps: ChainAuditorDeps);
    /** 执行核对，返回越权证据（空=通过，不阻塞汇报）。
     *  @param workspaceDir 本链发起工作区（Chain.workspaceDir）；提供时仅扫描工作区内的会话（修复轮 7）。 */
    check(chainId: string, workspaceDir?: string | null): Promise<AuditEvidence[]>;
    private reconcileArtifacts;
}
export type { AuditEvidence, Task };
