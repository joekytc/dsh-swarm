import { SessionId } from '@deepseek-ai/dsh-session';
import { installRoleTools, buildReadOnlyWriteGuard, buildDTWriteGuard, registerDtTaskChain, unregisterDtTaskChain } from '../roles/toolsets.js';
import { buildModelCandidates, isModelUnavailableError } from './model-candidates.js';
import { toolName } from './session-events.js';
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
/** 每任务一次性角色 agent：创建/resume、上下文组装、协议违规检测。 */
export class AgentRunner {
    ctx;
    kanban;
    config;
    wiki;
    defaultModel;
    constructor(ctx, kanban, config, wiki, defaultModel) { this.ctx = ctx; this.kanban = kanban; this.config = config; this.wiki = wiki; this.defaultModel = defaultModel; }
    buildContext(task, state, resume) {
        const parts = [`# Task ${task.id}: ${task.title}`, `assignee=${task.assignee} mode=${task.mode}`];
        if (task.assignee !== 'v' && !(task.assignee === 'd' && task.mode === 'execute')) {
            parts.push('权限提示：你的权限范围固定在会话工作区（workspace-write），越权操作（如 sandbox_permissions 升级写工作区外）会被自动拒绝且不可重试。遇到拒绝不要重试被拒操作，改用工作区内可行方式记录结果，然后调用 kanban_complete。');
        }
        // A3/B5：D(execute) = 唯一执行者（danger-full-access，无权限提示）——目标仓库内实际写代码 + git 提交推送
        if (task.assignee === 'd' && task.mode === 'execute') {
            parts.push('## 执行者职责\n你是链路唯一执行者（不是只读对齐/校验）：在目标仓库（见 Body 的 TARGET_REPO）内 git worktree/branch → 按规格卡 solution/testing 改代码/README → git commit → git push → 自检（跑测试/构建）。本会话为 full-access（可写目标仓库与 git 凭据已注入），不要做只读对齐/校验交差。调用 kanban_complete 时 metadata 必须带 git 产物证据：changed_files（数组）+ commit_hash 与 push 至少其一，否则完成会被拒绝、链路不会收尾。');
        }
        if (task.body)
            parts.push(`## Body
${task.body}`);
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
            // M2(Q5)：角色会话统一创建在发起 /plan: 的主 agent 工作空间（Chain.workspaceDir），回退 kanban 存储。
            const chain = state.chains.get(task.chainId);
            const sessionCwd = chain?.workspaceDir ?? this.workspaceDir();
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
                // 角色 agent 等同委派子 agent：固定 approval=never（避免后台会话悬挂等审批）。
                // M3(Q4)：D(execute)=唯一执行者 → sandbox=danger-full-access（可写任意目标仓库，无需提示）；
                // P/W/V → workspace-write（写边界=会话工作空间）。
                const session = agentCtx.agent?.session;
                session?.append?.('approval/policy', { policy: 'never', source: 'delegation' });
                session?.append?.('sandbox/mode', isDExecute ? { mode: 'danger-full-access', source: 'delegation' } : { mode: 'workspace-write', source: 'delegation' });
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
                await installRoleTools(agentCtx, task.assignee, { kanban: this.kanban, wiki: this.wiki, taskId: task.id });
                // 只读评审角色（PT/DT）注册 ToolGuard：拦截 tracked source 写入 / git mutation / 含写标记 bash。
                // 以 dsh-tools 类型为准：tools.guard(execution => reason|undefined)，execution.name/arguments 为实际字段。
                if (task.assignee === 'pt' || task.assignee === 'dt') {
                    const repoRoot = dRepo ?? sessionCwd; // DT 评审目标仓库；PT 以会话工作区为只读边界
                    const toolsSvc = agentCtx.tools;
                    // DT 额外叠加 wiki review namespace 收窄（projects/<chain>/review/）
                    const guardFn = task.assignee === 'dt'
                        ? buildDTWriteGuard(repoRoot, task.chainId)
                        : buildReadOnlyWriteGuard(repoRoot);
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
                const candidates = buildModelCandidates(this.config, task.assignee, this.defaultModel);
                if (candidates.length === 0) {
                    // 无任何候选配置：不传 agentOptions（用部署默认），单次尝试
                    agent = hasRunHistory
                        ? await this.resumeOrReuse(this.ctx.get('agents'), task.resumeSessionId ?? `kbn-${taskId}`, { setup })
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
                                ? await this.resumeOrReuse(agents, task.resumeSessionId ?? `kbn-${taskId}`, { agentOptions: candidate, setup })
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
            try {
                agent.followup({ content: [{ type: 'text', text: context }], source: { kind: 'user' } });
                console.error('[dsh-swarm][debug] runner followup sent ' + taskId);
                await agent.whenIdle();
                console.error('[dsh-swarm][debug] runner whenIdle resolved ' + taskId);
                // 修复轮 6：session.events 条目形态为 {type, data:{name}}，name 在 data 下，需经 toolName 读取
                const used = agent.session.events.some((e) => {
                    const n = toolName(e);
                    return n === 'kanban_complete' || n === 'kanban_block';
                });
                if (!used) {
                    // 防御：任务可能已被其他路径完成/归档（终态），此时 blockTask 会抛非法转换（done --task/blocked-->）
                    const fresh = await this.kanban.snapshot();
                    const cur = fresh.tasks.get(taskId);
                    const terminal = cur && (cur.status === 'done' || cur.status === 'archived');
                    if (terminal) {
                        console.error('[dsh-swarm][debug] runner skip block ' + taskId + ' status=' + (cur ? cur.status : 'gone'));
                    }
                    else {
                        // 协议违规护栏：连续 protocol_violation 阻塞 ≥ maxProtocolViolations（默认 2）后，
                        // 下一次违规直接 gave_up（不再恢复，走 [blocked-final] 证据链抛给主 agent）。任意角色（含 pt/dt）统一。
                        const maxPV = this.config.dispatcher?.maxProtocolViolations ?? 2;
                        const priorViolations = fresh.events.filter((e) => e.taskId === taskId && e.kind === 'task/blocked' &&
                            String(e.payload['reason'] ?? '').startsWith('protocol_violation')).length;
                        const finalBlock = priorViolations >= maxPV;
                        const reason = finalBlock
                            ? 'gave_up: protocol_violation after ' + maxPV + ' review cycles without complete/block'
                            : 'protocol_violation: idle without complete/block';
                        await this.kanban.blockTask(taskId, reason, 'system');
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
    /** RC2：resume 前先查 agents registry 同名会话是否仍 live——live 则直接复用（后续 followup 续用），
     *  避免 block→unblock→重跑同一会话时 resume 抛 "cannot prepare session while it is live"
     *  （对齐 VOrchestrator.getVAgent 的 live 复用逻辑）。agents.get 未实现 → 防御回退 resume。 */
    async resumeOrReuse(agents, sessionId, opts) {
        const live = agents.get?.(sessionId);
        if (live)
            return live;
        const h = await agents.resume({ resumeSessionId: SessionId(sessionId), ...opts });
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
    workspaceDir() {
        return (this.config.storageDir ?? '').replace('$DSH_HOME', process.env.DSH_HOME ?? process.cwd());
    }
}
