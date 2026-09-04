import { SessionId } from '@deepseek-ai/dsh-session';
import { installRoleTools, buildReadOnlyWriteGuard, buildDTWriteGuard, buildPlanWriteGuard, buildKbWriteGuard, registerDtTaskChain, unregisterDtTaskChain } from '../roles/toolsets.js';
import { ensureLocalKbRoot } from '../wiki/local-kb.js';
import { installCleanFsTools } from '../roles/clean-fs-tools.js';
import { buildModelCandidates, isModelUnavailableError } from './model-candidates.js';
import { toolName } from './session-events.js';
import { attachSessionToWorkspace, resolveOrCreateWorkspace } from './workspace-attach.js';
import { isPathInside, resolveTargetRepoDir } from './target-repo.js';
import { injectGitCredentials, resolveGitPatFromCtx } from './git-credentials.js';
/** M3(B)：目标仓库在会话工作空间外、已 claim+block 等待用户授权且尚未建会话的任务集合（key=taskId）。
 *  人工放行后再次调度会重新询问；已授权后从集合移除。仅进程内记忆，重启后从事件日志恢复（block 事件仍在）。 */
const permissionBlockedTasks = new Set();
/** D4 goal 条件启用（spec FR6）：spec 卡六段或父交接命中关键词 → 注入目标模式指令。 */
const GOAL_MODE_KEYWORDS = ['/goal', '目标模式', 'goal mode'];
/** RC4：瞬时基础设施错误（会话 live 锁/网络超时）与任务质量失败区分——infra 不计入 attempts 重试预算。 */
function isInfraError(err) {
    return /cannot prepare session|while it is live|timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|socket/i.test(String(err));
}
/** 组合标记存储：按 Agent 实例（incarnation）键控的进程内 WeakMap。
 *  机制取舍（探明宿主 lib 后确定，详见 task-2-report）：
 *  - 不用 session.append('kanban/role-composition')：自定义事件类型不在宿主 KNOWN_SESSION_EVENT_TYPES
 *    （dsh-session/lib/types/known-event-types.js），持久化读路径 assertEventsSupported
 *    （dsh-session-persistence/lib/index.js:1117）对未标 ignorable 的未知类型整份拒绝加载
 *    （SessionFormatUnsupportedError）→ 会话日志变成无法 resume 的毒日志；且 append 公共 API
 *    不暴露 ignorable 信封字段，无法规避。
 *  - 不用 agentCtx.provide：cordis 服务 store 的 isolate 键解析到根作用域
 *    （cordis/lib/index.js provide → ctx.root[symbols.isolate][name]），多 agent 同名 provide 冲突。
 *  - WeakMap 按 incarnation 键控：GUI 重开同名会话是新 Agent 实例 → 查不到标记 → 不盲用；
 *    实例被回收标记随 GC 消失，无泄漏。 */
const roleCompositions = new WeakMap();
/** 写入角色组合标记（setup 在 installRoleTools 成功后调用；导出仅供测试直接构造标记场景）。 */
export function markRoleComposition(agent, marker) {
    if (agent && typeof agent === 'object')
        roleCompositions.set(agent, marker);
}
/** 每任务一次性角色 agent：创建/resume、上下文组装、协议违规检测。 */
export class AgentRunner {
    ctx;
    kanban;
    configProvider;
    wiki;
    defaultModel;
    constructor(ctx, kanban, configProvider, wiki, defaultModel) { this.ctx = ctx; this.kanban = kanban; this.configProvider = configProvider; this.wiki = wiki; this.defaultModel = defaultModel; }
    buildContext(task, state, resume) {
        const parts = [`# Task ${task.id}: ${task.title}`, `assignee=${task.assignee} mode=${task.mode}`];
        // Q3：权限提示仅对受限角色显示（v 无写、d/execute 全权、p/w 全权但受工具级写护栏约束——写边界不靠 prompt 软约束）
        if (task.assignee !== 'v' && !(task.assignee === 'd' && task.mode === 'execute') && task.assignee !== 'p' && task.assignee !== 'w') {
            parts.push('权限提示：你的权限范围固定在会话工作区（workspace-write），越权操作（如 sandbox_permissions 升级写工作区外）会被自动拒绝且不可重试。遇到拒绝不要重试被拒操作，改用工作区内可行方式记录结果，然后调用 kanban_complete。');
        }
        // A3/B5：D(execute) = 唯一执行者（danger-full-access，无权限提示）——目标仓库内实际写代码 + git 提交推送
        if (task.assignee === 'd' && task.mode === 'execute') {
            parts.push('## 执行者职责\n你是链路唯一执行者（不是只读对齐/校验）：在目标仓库（见 Body 的 TARGET_REPO）内 git worktree/branch → 按规格卡 solution/testing 改代码/README → git commit → git push → 自检（跑测试/构建）。本会话为 full-access（可写目标仓库与 git 凭据已注入），不要做只读对齐/校验交差。调用 kanban_complete 时 metadata 必须带 git 产物证据：changed_files（数组）+ commit_hash 与 push 至少其一，否则完成会被拒绝、链路不会收尾。');
        }
        if (task.body)
            parts.push(`## Body
${task.body}`);
        // W local KB 模式（D7/D8）：注入本地库根 + llm-wiki 用法 + 排序原则 + 交付约定（remote 模式不注入）。
        // 库内复制/移动补句（Task 6 评审）：DIRECT cp/mv/mkdir 工具永远匹配不到 KB 目标（无 path/file_path
        // 实参）会被护栏拒绝——必须显式指引 W 用 write 工具做库内复制/移动。
        if (task.assignee === 'w' && this.configProvider.mode === 'local') {
            const kbRoot = ensureLocalKbRoot();
            parts.push('## 知识库（本地模式）', `- 本地库根：${kbRoot}（llm-wiki 原生结构；只读仓库源码，唯一可写区域为该库根）；库内复制/移动一律用 write 工具（cp/mv 会被护栏拒绝）`, '- 经 skill 工具加载 llm-wiki 完成查写（query/ingest/crystallize）；库未初始化时先按其 init 工作流初始化（幂等）', '- 检索排序原则：相关性优先 7 : 新鲜度 3', '- 交付：page_path = 库根下 wiki/** 相对路径（如 wiki/sources/ch_<chainId>/t_<taskId>.md）；kb_url = 空串', '- 本地模式不 ingest 外部 URL；wiki_search/wiki_read/wiki_write 不可用（未注册）');
        }
        // D/DT local 库根注入（审查修订 M3/M4）：Task 9 d:execute local 文案称「库根见运行时上下文」，
        // 此处必须真的注入，否则 D 不知道去哪读计划；DT fs 写评审页同理。
        if ((task.assignee === 'd' || task.assignee === 'dt') && this.configProvider.mode === 'local') {
            parts.push('## 本地知识库（local KB mode）', `- 本地库根：${ensureLocalKbRoot()}`, task.assignee === 'd'
                ? '- 实施计划原文 = 父任务交接 page_path（库根下 wiki/** 相对路径）→ 直接 fs 读 <库根>/<page_path>；KB 经验召回经 skill 工具加载 llm-wiki（本地库）'
                : '- 评审页经 fs 写 <库根>/wiki/queries/ch_<chainId>/review/<name>.md（库根外一律只读）');
        }
        // P1-1：规格卡六段 + 附件注入（经 Chain.specCardId），角色 agent 的输入契约，原汁原味
        const chain = state.chains.get(task.chainId);
        const specCard = chain?.specCardId ? state.specCards.get(chain.specCardId) : null;
        if (specCard) {
            parts.push('## Spec card (approved)\n' +
                `problem: ${specCard.sections.problem}\n` +
                `solution: ${specCard.sections.solution}\n` +
                `user_stories: ${specCard.sections.user_stories.join(' | ')}\n` +
                `impl_decisions: ${specCard.sections.impl_decisions.join(' | ')}\n` +
                `testing: ${specCard.sections.testing}\n` +
                `out_of_scope: ${specCard.sections.out_of_scope}\n` +
                `attachments: ${specCard.attachments.map((a) => `${a.kind}:${a.ref}`).join(' | ')}`);
        }
        const parents = task.parents.map((pid) => state.handoffs.get(pid)).filter(Boolean);
        if (parents.length > 0) {
            parts.push('## Parent task results');
            for (const h of parents) {
                parts.push(`- summary: ${h.summary}`);
                parts.push(`- metadata: ${JSON.stringify(h.metadata)}`);
            }
        }
        // 0.1.0 delegation（spec FR6）：D(execute) 目标模式条件注入——spec 卡/父交接命中
        // GOAL_MODE_KEYWORDS 才注入；否则默认执行（行为不变）。
        if (task.assignee === 'd' && task.mode === 'execute') {
            const specText = specCard
                ? [specCard.sections.problem, specCard.sections.solution, specCard.sections.user_stories.join(' '),
                    specCard.sections.impl_decisions.join(' '), specCard.sections.testing, specCard.sections.out_of_scope].join(' ')
                : '';
            const parentText = parents.map((h) => (h?.summary ?? '') + ' ' + JSON.stringify(h?.metadata ?? {})).join(' ');
            const hay = (specText + ' ' + parentText).toLowerCase();
            if (GOAL_MODE_KEYWORDS.some((k) => hay.includes(k.toLowerCase()))) {
                parts.push('## Goal mode\nThe plan requests /goal goal-mode execution: before starting, use the goal tool to register your execution goal; update it as you progress; mark it complete (or blocked) when the task finishes, then kanban_complete as usual.');
            }
        }
        if (resume) {
            // B2：resume 注入运行历史与上次失败原因（不只次数），返工/重试同会话可参考前因
            const lastFail = state.events.filter((e) => e.taskId === task.id && e.kind === 'task/failed').at(-1);
            const reason = lastFail ? String(lastFail.payload['reason'] ?? '') : '';
            parts.push(`## Prior attempts: ${task.attempts} (resume session)` + (reason ? `\nlast failure: ${reason}` : ''));
        }
        // 阻塞 resume 场景：注入最近阻塞原因 + 阻塞后评论（[blocked-review]/主 agent 方向）
        const blocks = state.events.filter((e) => e.taskId === task.id && e.kind === 'task/blocked');
        const lastBlock = blocks.at(-1);
        if (lastBlock) {
            const sinceBlock = state.events
                .filter((e) => e.taskId === task.id && e.kind === 'task/commented' && e.at >= lastBlock.at)
                .slice(-5);
            parts.push('## Review guidance (blocked task resume)');
            parts.push('- last block reason: ' + String(lastBlock.payload['reason'] ?? ''));
            if (sinceBlock.length > 0) {
                parts.push('- guidance comments:');
                for (const c of sinceBlock) {
                    parts.push(`  - ${c.author}: ${String(c.payload['body'] ?? '')}`);
                }
            }
            else {
                parts.push('- no guidance comments yet: coordinate the fix direction with the orchestrator/human, then call kanban_complete');
            }
        }
        // 返工场景（task.reworkOfTaskId 非空且 reviewStatus='pending'）：
        // 注入 review/failed 的 issues 清单与建议方向（评审卡 verdict=fail 后的返工卡上下文）
        if (task.reworkOfTaskId && task.reviewStatus === 'pending') {
            const reviewFailed = [...state.events]
                .reverse()
                .find((e) => e.kind === 'review/failed' && e.payload['targetTaskId'] === task.reworkOfTaskId);
            parts.push('## Review guidance (rework task)');
            parts.push('- 上游任务: ' + task.reworkOfTaskId);
            if (reviewFailed) {
                const evidence = reviewFailed.payload['evidence'];
                const issues = evidence?.issues ?? [];
                parts.push('- review issues:');
                for (const issue of issues) {
                    parts.push(`  - [${issue.severity}] ${issue.title}${issue.resolved ? ' (resolved)' : ''}`);
                }
                if (issues.length === 0)
                    parts.push('  - (no issues recorded in review evidence)');
            }
            else {
                parts.push('- no review/failed evidence found; re-verify the upstream deliverable before completing');
            }
        }
        return parts.join('\n\n');
    }
    async runTask(taskId) {
        const state = await this.kanban.snapshot();
        const task = state.tasks.get(taskId);
        if (!task)
            throw new Error('unknown task: ' + taskId);
        // todo（V 建卡默认态，无父任务即就绪）/ ready / failed（重试）均可调度；其余状态拒
        if (task.status !== 'ready' && task.status !== 'todo' && task.status !== 'failed')
            throw new Error('task not schedulable: ' + task.status);
        // 0.1.0 delegation（spec FR2）：DT 任务运行期注册 chainId（全局子代理 guard 的
        // wiki review namespace 同步解析源）；runTask 结束注销。
        if (task.assignee === 'dt')
            registerDtTaskChain(task.id, task.chainId);
        try {
            // M2(Q5)+归组：角色会话 cwd 恒为主 agent 工作空间（Chain.workspaceDir）。
            // 缺失时询问用户注册工作区；仍不可得 → block('workspace-unknown')，绝不静默落 kanban 存储目录。
            const chain = state.chains.get(task.chainId);
            let sessionCwd = chain?.workspaceDir ?? null;
            if (!sessionCwd) {
                sessionCwd = await resolveOrCreateWorkspace(this.ctx, null, 'task ' + task.id + ' ' + task.assignee + '/' + task.mode);
            }
            if (!sessionCwd) {
                await this.kanban.comment(taskId, `链未绑定工作区（Chain.workspaceDir 缺失且用户未提供工作区路径）。请重新 ${this.configProvider.getEffective().prefixRoutes.plan} 绑定主 agent 工作空间后重试。`, 'system');
                await this.kanban.claimTask(taskId, 'system');
                await this.kanban.blockTask(taskId, 'workspace-unknown: 链未绑定工作区（Chain.workspaceDir 缺失）', 'system');
                return;
            }
            // R20 D(execute)：目标仓库解析（供 M3 前置授权判定 + B4 git 凭据注入目标 + 上下文）；
            // 会话 cwd 不再指向仓库（会话必须在主 agent 工作空间，见 Q5）。
            const isDExecute = task.assignee === 'd' && task.mode === 'execute';
            const dRepo = isDExecute ? resolveTargetRepoDir(task, state, sessionCwd) : null;
            // M3(B)：D 目标仓库在会话工作空间外 → 跑 D 前先询问用户是否允许（一次授权，D 以 full-access 执行不再逐次提示）。
            // 不允许/无询问通道 → claim+block 等待人工放行（状态机要求 running 才能 block）；
            // 放行后再次调度会重新询问。授权前不创建会话，permissionBlockedTasks 避免误走 resume。
            if (isDExecute && dRepo && !isPathInside(dRepo, sessionCwd)) {
                const allowed = await this.requestRepoPermission(task, dRepo, sessionCwd);
                if (!allowed) {
                    await this.kanban.comment(taskId, 'D 执行需要访问会话工作空间外的目标仓库 ' + dRepo + '（会话工作空间：' + sessionCwd + '）。请在 GUI 解除阻塞以允许（再次调度会重新询问），或中止该链路。', 'system');
                    await this.kanban.claimTask(taskId, 'system');
                    await this.kanban.blockTask(taskId, 'repo-outside-workspace: 目标仓库 ' + dRepo + ' 在会话工作空间外，需用户授权', 'system');
                    permissionBlockedTasks.add(taskId);
                    return;
                }
                permissionBlockedTasks.delete(taskId);
            }
            // B2：resume 判定 = 有运行历史（attempts>0 或存在 claimed 事件）且不是「无会话授权阻塞」的任务；
            // 后者虽有 claimed 事件但从未创建会话，必须走 create 而非 resume（否则 resume 不存在会话抛错）。
            const hasRunHistory = !permissionBlockedTasks.has(taskId) &&
                (task.attempts > 0 || state.events.some((e) => e.taskId === taskId && e.kind === 'task/claimed'));
            let agent;
            let context = '';
            const setup = async (agentCtx) => {
                // 思考等级强制（waterfall）：宿主 selection 无 create-options 覆盖层（dsh-host-apiproxy 的
                // selectionFor 不消费 agentOptions），AgentOptions 也仅有 provider/model/maxTokens——agentOptions
                // 里的 reasoningEffort 不被宿主消费，新建角色会话思考等级会落回宿主默认。改走 DSH agent/request
                // waterfall 逐请求强制（宿主 installModelSelection 同机制），作用域仅本角色会话；
                // effort 可由 per-role config 覆盖，默认 'high'（与 model-candidates.ts 默认一致）。
                const effort = this.configProvider.getEffective().roles?.models?.[task.assignee]?.reasoningEffort ?? 'high';
                const scoped = agentCtx;
                scoped.on('agent/request', async (_payload, next) => {
                    // 异常不吞：await next() 失败原样向上抛
                    const resolved = await next();
                    return { ...resolved, reasoningEffort: effort };
                });
                // 角色 agent 等同委派子 agent：固定 approval=never（避免后台会话悬挂等审批）。
                // Q3：P/W/D = full access（跨目录读：P 读仓库/外部实证、W 读计划、D 执行）；
                // 但 P 挂 plan 写护栏、W 挂只读护栏（写边界由工具级强制，防"改动源码"，不靠 prompt 软约束）；
                // PT/DT/V → workspace-write（评审/编排最小权限，PT/DT 只读护栏由 ToolGuard 独立保证）。
                const session = agentCtx.agent?.session;
                session?.append?.('approval/policy', { policy: 'never', source: 'delegation' });
                const fullAccess = isDExecute || task.assignee === 'p' || task.assignee === 'w';
                session?.append?.('sandbox/mode', fullAccess ? { mode: 'danger-full-access', source: 'delegation' } : { mode: 'workspace-write', source: 'delegation' });
                // 执行角色（P/W/D）先挂载 D22 裁剪 preset（kanban-p/w/d），把 shell/approval 等服务注入 agent scope；
                // 不再整包继承官方 code preset：bash/fs/fs-search 由裁剪组合装配，run_code/jobs/skill/goal/
                // plan-mode/compaction/delegation/web/todo 按角色裁剪（组合文件随包分发 + 运行时安装到
                // $DSH_HOME/.agent-presets/，见 preset-installer.ts）。否则官方 apply 会抛
                // "cannot get property shell without inject"。
                if (task.assignee === 'p' || task.assignee === 'w' || task.assignee === 'd' || task.assignee === 'pt' || task.assignee === 'dt') {
                    const presets = agentCtx.get('agentPresets');
                    if (presets) {
                        const presetId = 'kanban-' + task.assignee;
                        try {
                            await presets.mount(agentCtx, presetId);
                            console.error('[dsh-swarm][debug] preset mounted ' + presetId + ' role=' + task.assignee + ' task=' + taskId);
                        }
                        catch (err) {
                            // preset 挂载失败不阻断：角色工具面仍注册，仅缺基座工具
                            console.error('[dsh-swarm][debug] preset mount failed ' + presetId + ' role=' + task.assignee + ' task=' + taskId + ': ' + String(err));
                        }
                    }
                }
                await installRoleTools(agentCtx, task.assignee, { kanban: this.kanban, wiki: this.wiki, taskId: task.id, kbMode: this.configProvider.mode });
                // sandbox-menu-align Task 1：danger-full-access 会话（P、D(execute)）write/edit/bash 菜单去毒
                // （agent scope shadow 注册干净版盖住宿主带毒版本 + execute 剥参转发，详见 src/roles/clean-fs-tools.ts）。
                // 挂载点选在 setup 内、preset.mount 之后：shadow 需经 get(name, agent) 取 preset standing
                // 祖先层里的宿主原定义（kanban-p/d 的 fs/bash 由 preset 提供），且必须在会话开始前完成注册。
                // 仅 P 与 D(execute)：两者是 danger-full-access 天花板，escalation 参数无更宽可升（必被拒）；
                // PT/DT 是 workspace-write（sandbox_permissions 扩权到天花板是合法功能，剥了破坏官方能力）；
                // W 虽 fullAccess 但 I2 只读护栏全拒 write，shadow 无意义（最小挂载面，V 无执行工具不涉及）。
                if (task.assignee === 'p' || isDExecute) {
                    installCleanFsTools(agentCtx, agentCtx.agent);
                }
                // Task 2：组合标记——角色工具面成功组合后，把 { role, taskId } 记到进程内 WeakMap（键=Agent 实例）。
                // 宿主探明：setup 收到的 agentCtx.agent 与发布后 agents.get(id) 返回的是同一 Agent 实例
                // （dsh-agent types/index.d.ts:38 `agent?: Agent` 安装为 Agent.ctx own property），
                // 故此处键入的实例即 resumeOrReuse 里 agents.get 命中的实例。agentCtx.agent 缺失（宿主变体）时
                // 不写标记 → live 复用走工具面校验路径（kanban_complete 可见性），能力无损。
                const liveAgent = agentCtx.agent;
                if (liveAgent)
                    markRoleComposition(liveAgent, { role: task.assignee, taskId: task.id });
                // 只读评审角色（PT/DT）注册 ToolGuard：拦截 tracked source 写入 / git mutation / 含写标记 bash。
                // 以 dsh-tools 类型为准：tools.guard(execution => reason|undefined)，execution.name/arguments 为实际字段。
                if (task.assignee === 'pt' || task.assignee === 'dt') {
                    const repoRoot = dRepo ?? sessionCwd; // DT 评审目标仓库；PT 以会话工作区为只读边界
                    const toolsSvc = agentCtx.tools;
                    // DT 额外叠加 wiki review namespace 收窄（projects/<chain>/review/）；
                    // local KB 模式（D7）：DT 改用 KB 写护栏（唯一可写区域=本地库根，评审页经 fs 写库根），
                    // remote 模式仍用 DT 收窄护栏（库根外全只读 + review namespace）。
                    const kbMode = this.configProvider.mode;
                    const guardFn = task.assignee === 'dt'
                        ? (kbMode === 'local' ? buildKbWriteGuard(ensureLocalKbRoot()) : buildDTWriteGuard(repoRoot, task.chainId))
                        : buildReadOnlyWriteGuard(repoRoot);
                    toolsSvc?.guard?.((e) => guardFn(e));
                }
                // Q3：P/W 挂写护栏（wsRoot = 链 workspaceDir = sessionCwd，同 PT/DT 解析方式）。
                // P = plan 写护栏（openspec/changes/** 内可写，禁改源码）；W = 只读护栏（交付=读计划→wiki API，
                // fs 零写——I2 起全名拦截，repo 外/workspace 内任意路径 fs 写一律拒，不再依赖 repoRoot 边界）。
                // 挂载方式同 PT/DT：tools.guard 是注册方法（dsh-tools 类型），execution 以 { name, arguments } 传入。
                if (task.assignee === 'p' || task.assignee === 'w') {
                    const toolsSvc = agentCtx.tools;
                    // local KB 模式（D7）：W 改用 KB 写护栏（唯一可写区域=本地库根，交付页经 write 写库根），
                    // remote 模式 W 仍只读护栏（fs 零写）；P 恒为 plan 写护栏（与 KB 模式无关）。
                    const kbMode = this.configProvider.mode;
                    const guardFn = task.assignee === 'p'
                        ? buildPlanWriteGuard(sessionCwd)
                        : (kbMode === 'local' && task.assignee === 'w')
                            ? buildKbWriteGuard(ensureLocalKbRoot())
                            : buildReadOnlyWriteGuard(sessionCwd);
                    toolsSvc?.guard?.((e) => guardFn(e));
                }
                // M4：D(execute) 注入 git 凭据（repo-local http extraheader，GitLab glpat-* 用 oauth2 basic）。
                // 由插件进程（不受 D 会话沙箱限制）写入 <repo>/.git/config；PAT 经 DSH 凭据服务/env 解析；
                // 注入失败仅告警（用户自带凭据/SSH 的仓库不受影响），未配置 PAT 不注入。
                if (isDExecute && dRepo) {
                    const pat = await resolveGitPatFromCtx(this.ctx, process.env);
                    if (pat) {
                        const cred = injectGitCredentials(dRepo, pat);
                        if (cred.ok)
                            console.error('[dsh-swarm][debug] git credential injected task=' + taskId + ' targets=' + cred.detail);
                        else
                            console.error('[dsh-swarm][debug] git credential inject skipped task=' + taskId + ' repo=' + dRepo + ': ' + cred.detail);
                    }
                }
            };
            try {
                // R1：claim 后任何异常（buildContext/spawn）→ failTask（attempts+1）→ 调度器重派/看门狗熔断；
                // 不留 "running 无 agent" 悬挂。
                await this.kanban.claimTask(taskId, 'system');
                console.error('[dsh-swarm][debug] runner claimed ' + taskId + ' attempts=' + task.attempts);
                context = this.buildContext(task, state, hasRunHistory);
                // 模型候选链（Task 12）：primary + fallbacks，model/provider 不可用时静默切换下一候选；
                // 全部候选不可用 → block(model-unavailable) 抛给用户；非 model 错误 → failTask（原逻辑）。
                const candidates = buildModelCandidates(this.configProvider.getEffective(), task.assignee, this.defaultModel);
                if (candidates.length === 0) {
                    // 无任何候选配置：不传 agentOptions（用部署默认），单次尝试
                    agent = hasRunHistory
                        ? await this.resumeOrReuse(this.ctx.get('agents'), task.resumeSessionId ?? `kbn-${taskId}`, { setup, role: task.assignee, taskId: task.id })
                        : (await this.ctx.get('agents').create({
                            sessionId: SessionId(`kbn-${taskId}`),
                            meta: { cwd: sessionCwd },
                            setup,
                        })).agent;
                }
                else {
                    const agents = this.ctx.get('agents');
                    let spawnError = null;
                    for (const candidate of candidates) {
                        try {
                            // hasRunHistory → resumeOrReuse 直接返回 AgentLike（内部已解包 .agent）；create 返回 { agent } 需解包。
                            // 统一归一化为 AgentLike，避免二次解包（h.agent=undefined → if(!agent) 误标 failed）。
                            const h = hasRunHistory
                                ? await this.resumeOrReuse(agents, task.resumeSessionId ?? `kbn-${taskId}`, { agentOptions: candidate, setup, role: task.assignee, taskId: task.id })
                                : (await agents.create({ sessionId: SessionId(`kbn-${taskId}`), meta: { cwd: sessionCwd }, agentOptions: candidate, setup })).agent;
                            agent = h;
                            // 切换成功且非首选 → 发可审计 model/fallback 评论（记录证据，不弹用户）
                            if (candidate !== candidates[0]) {
                                try {
                                    await this.kanban.comment(taskId, '[model-fallback] 主模型不可用，静默切换 ' + candidate.provider + '/' + candidate.model + '（reasoningEffort=' + (candidate.reasoningEffort ?? 'high') + '）', 'system');
                                }
                                catch { /* 证据记录失败不影响执行 */ }
                            }
                            break;
                        }
                        catch (err) {
                            spawnError = err;
                            if (!isModelUnavailableError(err))
                                throw err; // 非 model 错误立即失败
                            console.error('[dsh-swarm][debug] model candidate unavailable ' + String(candidate.provider) + '/' + String(candidate.model) + ': ' + String(err));
                        }
                    }
                    if (!agent) {
                        // 全部候选不可用 → block(model-unavailable)（不是 failed 重试；抛给用户处理）
                        if (isModelUnavailableError(spawnError)) {
                            await this.kanban.blockTask(taskId, 'model-unavailable: all configured candidates failed', 'system');
                            return;
                        }
                        throw spawnError;
                    }
                }
            }
            catch (err) {
                // P0-5/R1：claim/buildContext/spawn 失败也走 failed（attempts 递增）→ 调度器重派/看门狗熔断；不再让任务永久 claimed
                console.error('[dsh-swarm][debug] runner spawn error ' + taskId + ': ' + String(err));
                try {
                    await this.kanban.failTask(taskId, 'runner-error: ' + String(err), 'system', { infra: isInfraError(err) });
                }
                catch (failErr) {
                    // 防御：任务可能已被其他路径完成/归档（终态），failTask 会抛非法转换；记录并继续
                    console.error('[dsh-swarm][debug] runner spawn failTask skipped: ' + String(failErr));
                }
                return;
            }
            if (!agent)
                return; // 防御：候选链耗尽已在上方 block(model-unavailable)/throw 处理
            // Task 4（Bug C 告警）：本轮增量事件基线——agent 拿到之后、followup 之前记录。
            // create/resume/live 复用两条路径都在此汇合，agent.session.events.slice(eventsBase)
            // 即「本轮新增事件」（排除旧 incarnation 持久化事件），供 protocol_violation 时识别
            // comment-only 收尾（交付滞留 comments，会话10事故形态）。
            const eventsBase = agent.session.events.length;
            // 归组：角色会话 attach 到 cwd 对应工作区（无则询问创建；失败不阻断）
            const attachId = task.resumeSessionId ?? `kbn-${task.id}`;
            await attachSessionToWorkspace(this.ctx, attachId, sessionCwd, 'task ' + task.id + ' ' + task.assignee + '/' + task.mode);
            try {
                agent.followup({ content: [{ type: 'text', text: context }], source: { kind: 'user' } });
                console.error('[dsh-swarm][debug] runner followup sent ' + taskId);
                await agent.whenIdle();
                console.error('[dsh-swarm][debug] runner whenIdle resolved ' + taskId);
                // 终态判据（session 10 事故修复）：whenIdle resolve 后一次 snapshot，只看任务真实状态——
                // 不再扫 session.events 全历史工具名（旧 incarnation 的 kanban_* 事件会污染判据，
                // 「历史上调过工具名」≠「本轮成功提交」，骗过检查后卡永驻 running）。
                // 确定态（done/archived/blocked/failed，TaskStatus 全集见 src/domain/types.ts）→ 防御日志 skip：
                // blocked 上再 block 抛非法转换；failed 交调度器重派，不做 violation block。
                // 非确定态（running/ready/todo/triage）→ protocol_violation 流程（证据链保留）。
                const fresh = await this.kanban.snapshot();
                const cur = fresh.tasks.get(taskId);
                const settled = !!cur &&
                    (cur.status === 'done' || cur.status === 'archived' || cur.status === 'blocked' || cur.status === 'failed');
                if (settled) {
                    console.error('[dsh-swarm][debug] runner skip block ' + taskId + ' status=' + (cur ? cur.status : 'gone'));
                }
                else {
                    // 协议违规护栏：连续 protocol_violation 阻塞 ≥ maxProtocolViolations（默认 2）后，
                    // 下一次违规直接 gave_up（不再恢复，走 [blocked-final] 证据链抛给主 agent）。任意角色（含 pt/dt）统一。
                    const maxPV = this.configProvider.getEffective().dispatcher?.maxProtocolViolations ?? 2;
                    const priorViolations = fresh.events.filter((e) => e.taskId === taskId && e.kind === 'task/blocked' &&
                        String(e.payload['reason'] ?? '').startsWith('protocol_violation')).length;
                    const finalBlock = priorViolations >= maxPV;
                    const reason = finalBlock
                        ? 'gave_up: protocol_violation after ' + maxPV + ' review cycles without complete/block'
                        : 'protocol_violation: idle without complete/block';
                    await this.kanban.blockTask(taskId, reason, 'system');
                    // Task 4（Bug C 告警）：comment-only 收尾显形——放 block 之后（保证 block 一定先发生，
                    // 告警只追加在已阻塞卡上，不影响终态判据与 [blocked-final] 证据链快照）。
                    // 本轮增量事件命中 kanban_comment（经 toolName 兼容读取落盘/live 两形态）且未成功提交
                    // （能走到这里即终态判据已确认非确定态）→ 交付内容很可能滞留 comments，显形告警。
                    const commentOnly = agent.session.events.slice(eventsBase).some((e) => toolName(e) === 'kanban_comment');
                    if (commentOnly) {
                        await this.kanban.comment(taskId, '[comment-only-closeout] 本轮仅用 kanban_comment 交付（无 complete/block）。交付内容可能滞留 comments（如角色工具缺失/会话被错误复用）；请人工核对 comments 与产物后解除阻塞重派。', 'system');
                    }
                    if (finalBlock) {
                        // [blocked-final] 证据链：block 时间线 + 复核/评论时间线 + 最终 reason（system 确定性写入）
                        const evs = fresh.events.filter((e) => e.taskId === taskId);
                        const blockTimeline = evs
                            .filter((e) => e.kind === 'task/blocked')
                            .map((e) => `  - seq=${e.seq} at=${e.at} author=${e.author} reason=${String(e.payload['reason'] ?? '')}`)
                            .join('\n');
                        const reviewTimeline = evs
                            .filter((e) => e.kind === 'task/commented')
                            .map((e) => `  - seq=${e.seq} at=${e.at} author=${e.author}: ${String(e.payload['body'] ?? '')}`)
                            .join('\n');
                        await this.kanban.comment(taskId, [
                            '[blocked-final] 协议违规超护栏，任务不再自动恢复（人工解除后仍按 gave_up 终态处理）。',
                            '## block 时间线',
                            blockTimeline,
                            '## 复核/评论时间线',
                            reviewTimeline || '  - (无复核评论)',
                            '最终原因: ' + reason,
                        ].join('\n'), 'system');
                    }
                }
            }
            catch (err) {
                console.error('[dsh-swarm][debug] runner error ' + taskId + ': ' + String(err));
                // 失败语义（P0-5 统一）：发 failed 事件（attempts 递增），由调度器重派或看门狗熔断；不直接 block。
                // 防御：任务可能已被完成/归档（终态），failTask 会抛非法转换（done --task/failed-->）
                try {
                    await this.kanban.failTask(taskId, 'runner-error: ' + String(err), 'system', { infra: isInfraError(err) });
                }
                catch (failErr) {
                    console.error('[dsh-swarm][debug] runner failTask skipped: ' + String(failErr));
                }
            }
        }
        finally {
            if (task.assignee === 'dt')
                unregisterDtTaskChain(task.id);
        }
    }
    /** RC2：resume 前先查 agents registry 同名会话是否仍 live——live 且组合标记匹配（role+taskId 一致）才复用。
     *  Task 2（会话10事故根因A）：此前对 live agent 盲复用——GUI 打开同名会话产生的默认组合 incarnation
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
    async resumeOrReuse(agents, sessionId, opts) {
        const live = agents.get?.(sessionId);
        if (live) {
            // 标记匹配（同 incarnation、同角色、同卡）→ 与 setup 组合完全一致 → 安全复用（原行为收窄版）
            const marker = typeof live === 'object' && live !== null ? roleCompositions.get(live) : undefined;
            if (marker && marker.role === opts.role && marker.taskId === opts.taskId)
                return live;
            // 标记缺失/不匹配 → 绝不盲用。工具注册表（live.ctx.tools，与 installRoleTools 同一访问路径）：
            const liveCtx = live.ctx;
            const toolsSvc = liveCtx ? liveCtx.tools : undefined;
            if (toolsSvc?.get) {
                if (toolsSvc.get('kanban_complete', live)) {
                    // 工具面完备但标记缺失/不匹配：同角色返工跨卡复用（createReworkTask 设
                    // resumeSessionId=源卡 sessionId）或标记写入失败的历史 incarnation——验证过工具面后复用，
                    // 不重复补挂（重复 register 同名工具会被 dsh-tools 拒绝："already registered in this scope"）。
                    return live;
                }
                // GUI 默认组合 incarnation：缺 kanban_complete → 重跑 setup 幂等补挂后复用。
                // setup 对 live ctx 的各步均可加：effort waterfall/approval+sandbox append（known 事件类型、
                // latest-wins）/preset mount（bindings 覆盖）/角色工具（此前为默认组合，无同名冲突）/护栏。
                await opts.setup(liveCtx);
                if (toolsSvc.get('kanban_complete', live))
                    return live; // 修复后必须验证到位，防静默半修复
                throw new Error('live session composition repair failed: kanban_complete still missing after re-setup (session ' + sessionId + ')');
            }
            // (iii)：既无标记又无法访问工具注册表 → 拒绝盲复用（会复现事故），failTask 有界重试（见上）。
            throw new Error('live session composition mismatch and unverifiable (no marker, no tool registry): ' + sessionId + ' — refusing blind reuse (incident root cause A)');
        }
        const { agentOptions, setup } = opts;
        const resumeOpts = { resumeSessionId: SessionId(sessionId), setup };
        if (agentOptions)
            resumeOpts['agentOptions'] = agentOptions;
        const h = await agents.resume(resumeOpts);
        return h.agent;
    }
    /** M3(B)：D(execute) 目标仓库在会话工作空间外时，跑 D 前询问用户是否允许。
     *  经 ctx.userQuestions（GUI 弹窗）单次询问；无询问通道或拒绝 → 返回 false（由调用方 claim+block 等待人工放行）。 */
    async requestRepoPermission(task, repo, sessionCwd) {
        const uq = this.ctx.get?.('userQuestions');
        if (!uq?.ask)
            return false;
        try {
            // 超时护栏：用户长时间不答（无 UI 应答者）不得卡死调度器 tick → 超时按未授权处理（claim+block 等人工放行）
            const ans = await Promise.race([
                uq.ask({
                    questions: [{
                            id: 'd-repo-permission',
                            header: 'D 执行授权',
                            question: 'D（唯一执行者）需要在会话工作空间外的目标仓库 ' + repo + ' 执行 git 写操作（worktree/commit/push）。是否允许？',
                            detail: '会话工作空间：' + sessionCwd + '。允许后 D 以 full-access 执行且本次不再逐次询问；不允许则阻塞 D 任务等待你在 GUI 放行。',
                            options: [
                                { label: '允许', description: '授权 D 在该仓库执行（本次任务内不再询问）' },
                                { label: '不允许', description: '阻塞 D 任务，等待人工处理' },
                            ],
                        }],
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('repo-permission-ask timeout')), 120_000)),
            ]);
            return ans.answers?.[0]?.selected?.[0] === '允许';
        }
        catch {
            return false; // 询问失败（无 UI/超时）→ 视为未授权，走 block 等人工放行
        }
    }
}
