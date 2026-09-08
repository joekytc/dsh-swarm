import type { Context } from '@deepseek-ai/cordis';
import { KanbanService } from '../domain/kanban-service.js';
import { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import type { Role } from '../domain/types.js';
import type { ConfigProvider } from '../services/config-provider.js';
import { isRoleComposed } from '../dispatcher/agent-runner.js';
export { isRoleComposed };
/** 判定 wiki 路径是否位于 DT 评审命名空间 projects/<repoSlug>/<chainId>/review/
 *  （repoSlug=[a-z0-9-]+ 通配，chainId 精确匹配；拒绝 ../、绝对路径、跨链、旧格式直挂根）。 */
export declare function isReviewNamespacePath(pagePath: string, chainId: string): boolean;
/**
 * DT 写护栏 = PT 只读护栏（源码/git/写标记 bash 拒绝）+ wiki_write 仅 review namespace 收窄。
 * repoRoot 为 D 目标仓库；chainId 用于 wiki 评审命名空间校验。
 */
export declare function buildDTWriteGuard(repoRoot: string, chainId: string): (execution: {
    name?: string;
    arguments?: unknown;
}) => string | undefined;
export declare function buildReadOnlyWriteGuard(_repoRoot: string): (execution: {
    name?: string;
    arguments?: unknown;
}) => string | undefined;
/** 本地模式 KB 写护栏：全名只读拦截（base）之上，仅对「实际写目标全部为
 *  库根内绝对路径」的写操作豁免。目标提取不到 / 相对路径 / 越界 → 维持 base 拒绝（fail-closed）。
 *  仅 local 模式对 W/DT 装配；remote 模式仍用 buildReadOnlyWriteGuard（库根写也被拒）。
 *  审查修订：extractWriteTargets 保持既有双参签名（cmd, redirectRe），按入口分流
 *  传 BASH_REDIRECT_TARGET_RE / CODE_REDIRECT_TARGET_RE（与 buildPlanWriteGuard 同款）——
 *  单参调用会在首个写意图命令上 TypeError。 */
export declare function buildKbWriteGuard(kbRoot: string): (execution: {
    name?: string;
    arguments?: unknown;
}) => string | undefined;
/** P 专用写护栏：读全放行；git mutation 一律拒绝；写仅允许目标仓库 openspec/changes 目录。
 *  直接 fs 写工具 → 路径经 resolve 归一化后须落在 <workspaceRoot>/openspec/changes/ 之下（相邻段对判定）；
 *  bash/run_code 写标记命令 → 命令文本须含 `openspec/changes` 子串，且提取出的实际写目标（重定向
 *  目标 / writeFileSync 实参）逐条经 resolve+isPlanPath 校验（杀 openspec/changes/../.. 穿越写源码）。
 *  源码/src/lib/tests 等写不入（不含该子串）——"禁止改动源码"为工具级硬约束，非 prompt 软约束。
 *  execution 以 dsh-tools 形态 { name, arguments } 传入（与 buildReadOnlyWriteGuard 一致）。 */
export declare function buildPlanWriteGuard(workspaceRoot: string): (execution: {
    name?: string;
    arguments?: unknown;
}) => string | undefined;
/** 按角色在 agent scope 注册工具面（统一注册策略）：
 *  所有 kanban 工具从工具工厂选取 + getCaller 闭包（actor=role、boundTaskId=taskId）。
 *  can() 权限兜底仍保留在工具 execute 内（纵深防御第二道）。 */
export declare function installRoleTools(agentCtx: Context, role: Role, deps: {
    kanban: KanbanService;
    wiki: WikiVaultClient;
    taskId?: string;
    kbMode?: 'remote' | 'local';
}): Promise<void>;
export declare function registerDtTaskChain(taskId: string, chainId: string): void;
export declare function unregisterDtTaskChain(taskId: string): void;
export interface SubagentGuardDeps {
    /** kbn-<taskId> → chainId 同步解析（缺省用 module 缓存；测试注入用）。 */
    getTaskChainId?(taskId: string): string | undefined;
}
/** 全局子代理写护栏：仅 DT 角色会话的"子代理"（agentPreset === 'kanban-dt' 且
 *  header.parentSession 为 kbn-<taskId> 前缀）应用 buildDTWriteGuard。判据：parentSession
 *  缺失或非 kbn- 前缀 → 放行（DT 父会话自身或无关会话；DT 父会话只读由 agent.ctx guard
 *  兜底，双保险）。repoRoot 取子代理 header.cwd（继承 DT 会话 cwd=评审目标仓库）；缺省
 *  '/'（写标记全拦的保守形态）。chainId 从 parentSession（kbn-<taskId>）解析；解析不到
 *  → 空（wiki_write fail-closed 全拒，源码写拦截不受影响）。 */
export declare function buildSubagentTreeGuard(deps?: SubagentGuardDeps): (execution: {
    name?: string;
    arguments?: unknown;
    agent?: unknown;
}) => string | undefined;
/** 蜂群模式主会话硬闸：全局 guard，按 header.agentPreset==='swarm'
 *  精准判定（先例 buildSubagentTreeGuard）。swarm 会话 = 扩权参数教学拦截（宿主 bash/write/edit
 *  schema 广播 sandbox_permissions/justification，模型带参重试会触发天花板会话 approveEscalation
 *  死循环——独立 DT 同款拦截）+ git 反选（与独立 DT 共用 GIT_MUTATION_VERBS/dualVerbGitDenyReason，
 *  buildPlanWriteGuard 同款分段提取判定，跳过 git 全局选项、提取不到动词 fail-closed，先行判定——
 *  git 变更动词多数同时命中只读基座的写标记，须以 swarm-guard 文案优先返回）+ 只读基座
 *  （buildReadOnlyWriteGuard：直接写工具全名拦截 + bash/run_code 写标记）。其余会话恒放行
 *  （角色会话自有 agent scope 护栏兜底，双保险不叠加）。 */
export declare function buildSwarmSessionGuard(): (execution: {
    name?: string;
    arguments?: unknown;
    agent?: unknown;
}) => string | undefined;
/** 独立评审（standalone DT）全局硬闸。独立会话判定（同时成立）：
 *  header.agentPreset === 'kanban-dt'、未经角色组合标记（!isRoleComposed）、parentSession
 *  非 kbn- 前缀（与 buildSubagentTreeGuard 判据对齐：有 kbn- parentSession 的是链上系
 *  DT 子代理，交由该 guard 管——其 incarnation 可能无组合标记、宿主 id 也可能非 kbn-
 *  前缀，漏判会把链评审写入误当独立模式拒掉）、且（能从 execution.agent 取到 session
 *  id 时）id 非 kbn- 前缀。不满足 → 不走独立规则。
 *  独立模式规则（按序）：
 *  1. kanban 写工具（complete/block/comment/heartbeat/create）→ 拒（独立评审不挂任务链）；
 *  2. bash/run_code/write/edit → 扩权参数教学拦截（sandbox_permissions/justification 任一
 *     出现即拒并教模型去参——只读会话无扩权场景，宿主沙箱校验报错文案晦涩）；bash/run_code
 *     再过 git 反选（swarm-guard 同款分段提取：&&/||/;/|/换行 分段、跳过全局选项、提取不到
 *     动词 fail-closed 拒）：仅禁变更动词与双态动词的变更子形态（见 GIT_STANDALONE_DENY_VERBS
 *     /standaloneGitDenyReason），查询、clone/fetch、裸 checkout/switch 放行；非 git 段不因
 *     git 规则拒绝；最后挂只读基座 buildReadOnlyWriteGuard（写动词/重定向照拒；clone/fetch
 *     落盘是 git 自身行为，BASH_WRITE_RE 无此二动词天然放行，无需特判）；
 *  3. wiki_write（独立模式）→ 仅放行 projects/<repo>/reviews/<主题>-<日期>/ 命名空间；
 *  4. wiki_write（非独立会话）→ 链上组合会话（isRoleComposed）放行（自有 agent-scope
 *     guard 管，链命名空间写入绝不被本 guard 误拦）；其余（main/swarm/未知 GUI）拒绝
 *     ——评审工具全局注册后 wiki_write 收紧到评审会话；
 *  5. 其余工具（read/glob/grep/ocr_review/wiki_read/wiki_search 等）→ 放行。 */
export declare function buildStandaloneDtGuard(): (execution: {
    name?: string;
    arguments?: unknown;
    agent?: unknown;
}) => string | undefined;
/** 独立评审工具全局注册：ocr_review + wiki 三原语（wiki_read/wiki_search/wiki_write）。
 *  独立评审不经 agent-runner 角色组合，角色工具面不存在，故在插件全局 ctx 注册；
 *  caller 固定 actor='dt'（can('wiki-write','dt')=true），wiki_write 的会话级收紧由
 *  buildStandaloneDtGuard 完成（链上组合会话放行，main/swarm/未知 GUI 拒绝）。
 *  wiki 客户端按 kbMode 构造（与 registerMainSessionTools 同源：remote 优先 ctx.get('wiki')
 *  注入（测试 mock），生产热读取 getEffective().wikiVault；local 走 LocalWikiClient）。
 *  local 模式不注册 wiki_write：LocalWikiClient.abs 只接受 wiki/** 形态，而 wiki_write
 *  工具边界只放行 projects/... 命名空间——双锁死（任何路径都写不进）。与链上 DT local
 *  行为一致（走 skill/fs 工具而非 wiki 原语）；wiki_read/wiki_search 不受写路径白名单
 *  约束，照常注册。
 *  registry 缺失（测试裸 Context）→ return，与 registerMainSessionTools 同款防御。 */
export declare function registerStandaloneReviewerTools(ctx: Context, configProvider: ConfigProvider): void;
