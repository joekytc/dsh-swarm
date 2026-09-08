import type { Context } from '@deepseek-ai/cordis';
import type { KanbanService } from '../domain/kanban-service.js';
import type { ConfigProvider } from '../services/config-provider.js';
import type { Role } from '../domain/types.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { probeOcr } from '../services/ocr-cli.js';
import type { AgentModelOptions } from './dispatcher.js';
/** 角色组合标记（会话10事故根因A）：setup 成功组合角色工具面后写入，live 复用前校验。 */
interface RoleCompositionMarker {
    role: Role;
    taskId: string;
}
/** 写入角色组合标记（setup 在 installRoleTools 成功后调用；导出仅供测试直接构造标记场景）。 */
export declare function markRoleComposition(agent: unknown, marker: RoleCompositionMarker): void;
/** 只读判定：该 agent incarnation 是否带角色组合标记（全局 guard 消费；不读 marker 内容）。
 *  与 markRoleComposition 同一 WeakMap 单一事实源；未标记 incarnation（GUI 新开/子代理）
 *  返回 false。 */
export declare function isRoleComposed(agent: unknown): boolean;
/** 每任务一次性角色 agent：创建/resume、上下文组装、协议违规检测。 */
export declare class AgentRunner {
    private readonly ctx;
    private readonly kanban;
    private readonly configProvider;
    private readonly wiki;
    private readonly defaultModel;
    private readonly probeOcrFn;
    constructor(ctx: Context, kanban: KanbanService, configProvider: ConfigProvider, wiki: WikiVaultClient, defaultModel?: AgentModelOptions, deps?: {
        probeOcrFn?: typeof probeOcr;
    });
    private buildContext;
    runTask(taskId: string): Promise<void>;
    /** resume 前先查 agents registry 同名会话是否仍 live——live 且组合标记匹配（role+taskId 一致）才复用。
     *  会话10事故根因A：此前对 live agent 盲复用——GUI 打开同名会话产生的默认组合 incarnation
     *  没有角色 preset/kanban_complete 工具面（setup 被跳过），模型只能把交付塞 kanban_comment。
     *  现在标记缺失/不匹配时按宿主能力降级（探明结论）：
     *  - (i) dispose 不可行：AgentHandle.dispose 仅创建者持有（dsh-agent types/index.d.ts:155-158，
     *    "ctx.agents.get(id) still returns a bare Agent"），无从释放他人 incarnation。
     *  - (ii) 修复可行（生产主路径）：Agent.ctx 公开（runtime-types.d.ts:72）且经它访问的 tools 注册表
     *    可枚举/可注册（ToolRuntime.get(name, scope) 返回该 scope 可见定义；register 经 traced ctx 落到
     *    该 agent 的 scope 层）→ 重跑 setup 幂等补挂（effort/approval/sandbox/preset/角色工具/护栏），
     *    补挂后必须验证 kanban_complete 可见才算修复成功。kanban_complete 是所有 runner 角色
     *    （p/w/d/pt/dt）都注册的任务工具，且全局面只读子集不含它（main-session-tools.ts:134），
     *    故「scope 内可见 kanban_complete」⟺「该 incarnation 经我方角色 setup 组合过」。
     *  - (iii) 兜底：工具注册表不可达（异常宿主/测试桩）→ 抛错走 failTask。错误信息刻意不含
     *    isInfraError 关键词 → attempts+1 计入重试预算：每次重派都会撞同一个 live 错误 incarnation
     *    直至重试预算耗尽——有界，不会形成无限重派循环（若误标 infra 则 attempts 不递增才会无限）。
     *  agents.get 未实现 → 回退 resume（原行为不回归）。 */
    private resumeOrReuse;
    /** D(execute) 目标仓库在会话工作空间外时，跑 D 前询问用户是否允许。
     *  经 ctx.userQuestions（GUI 弹窗）单次询问；无询问通道或拒绝 → 返回 false（由调用方 claim+block 等待人工放行）。 */
    private requestRepoPermission;
}
export {};
