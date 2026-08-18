import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { KanbanService } from '../domain/kanban-service.js';
import type { KanbanConfig } from '../config.js';
import type { Role, Task } from '../domain/types.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { installRoleTools, buildReadOnlyWriteGuard } from '../roles/toolsets.js';
import { toolName } from './session-events.js';
import { isPathInside, resolveTargetRepoDir } from './target-repo.js';
import { injectGitCredentials, resolveGitPatFromCtx } from './git-credentials.js';
import type { AgentModelOptions } from './dispatcher.js';

interface AgentLike {
  followup(msg: unknown): void;
  whenIdle(): Promise<void>;
  session: { events: Array<{ type?: string; name?: string }> };
}

/** M3(B)：目标仓库在会话工作空间外、已 claim+block 等待用户授权且尚未建会话的任务集合（key=taskId）。
 *  人工放行后再次调度会重新询问；已授权后从集合移除。仅进程内记忆，重启后从事件日志恢复（block 事件仍在）。 */
const permissionBlockedTasks = new Set<string>();

/** 每任务一次性角色 agent：创建/resume、上下文组装、协议违规检测。 */
export class AgentRunner {
  private readonly ctx: Context;
  private readonly kanban: KanbanService;
  private readonly config: KanbanConfig;
  private readonly wiki: WikiVaultClient;
  private readonly defaultModel: AgentModelOptions | undefined;
  constructor(
    ctx: Context,
    kanban: KanbanService,
    config: KanbanConfig,
    wiki: WikiVaultClient,
    defaultModel?: AgentModelOptions,
  ) { this.ctx = ctx; this.kanban = kanban; this.config = config; this.wiki = wiki; this.defaultModel = defaultModel; }

  private buildContext(task: Task, state: Awaited<ReturnType<KanbanService['snapshot']>>, resume: boolean): string {
    const parts: string[] = [`# Task ${task.id}: ${task.title}`, `assignee=${task.assignee} mode=${task.mode}`];
    if (task.assignee !== 'v' && !(task.assignee === 'd' && task.mode === 'execute')) {
      parts.push('权限提示：你的权限范围固定在会话工作区（workspace-write），越权操作（如 sandbox_permissions 升级写工作区外）会被自动拒绝且不可重试。遇到拒绝不要重试被拒操作，改用工作区内可行方式记录结果，然后调用 kanban_complete。');
    }
    // A3/B5：D(execute) = 唯一执行者（danger-full-access，无权限提示）——目标仓库内实际写代码 + git 提交推送
    if (task.assignee === 'd' && task.mode === 'execute') {
      parts.push('## 执行者职责\n你是链路唯一执行者（不是只读对齐/校验）：在目标仓库（见 Body 的 TARGET_REPO）内 git worktree/branch → 按规格卡 solution/testing 改代码/README → git commit → git push → 自检（跑测试/构建）。本会话为 full-access（可写目标仓库与 git 凭据已注入），不要做只读对齐/校验交差。调用 kanban_complete 时 metadata 必须带 git 产物证据：changed_files（数组）+ commit_hash 与 push 至少其一，否则完成会被拒绝、链路不会收尾。');
    }
    if (task.body) parts.push(`## Body
${task.body}`);
    // P1-1：规格卡六段 + 附件注入（经 Chain.specCardId），角色 agent 的输入契约，原汁原味
    const chain = state.chains.get(task.chainId);
    const specCard = chain?.specCardId ? state.specCards.get(chain.specCardId) : null;
    if (specCard) {
      parts.push(
        '## Spec card (approved)\n' +
        `problem: ${specCard.sections.problem}\n` +
        `solution: ${specCard.sections.solution}\n` +
        `user_stories: ${specCard.sections.user_stories.join(' | ')}\n` +
        `impl_decisions: ${specCard.sections.impl_decisions.join(' | ')}\n` +
        `testing: ${specCard.sections.testing}\n` +
        `out_of_scope: ${specCard.sections.out_of_scope}\n` +
        `attachments: ${specCard.attachments.map((a) => `${a.kind}:${a.ref}`).join(' | ')}`,
      );
    }
    const parents = task.parents.map((pid) => state.handoffs.get(pid)).filter(Boolean);
    if (parents.length > 0) {
      parts.push('## Parent task results');
      for (const h of parents) {
        parts.push(`- summary: ${h!.summary}`);
        parts.push(`- metadata: ${JSON.stringify(h!.metadata)}`);
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
      } else {
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
        const evidence = reviewFailed.payload['evidence'] as { issues?: Array<{ severity: string; title: string; resolved: boolean }> } | undefined;
        const issues = evidence?.issues ?? [];
        parts.push('- review issues:');
        for (const issue of issues) {
          parts.push(`  - [${issue.severity}] ${issue.title}${issue.resolved ? ' (resolved)' : ''}`);
        }
        if (issues.length === 0) parts.push('  - (no issues recorded in review evidence)');
      } else {
        parts.push('- no review/failed evidence found; re-verify the upstream deliverable before completing');
      }
    }
    return parts.join('\n\n');
  }

  async runTask(taskId: string): Promise<void> {
    const state = await this.kanban.snapshot();
    const task = state.tasks.get(taskId);
    if (!task) throw new Error('unknown task: ' + taskId);
    // todo（V 建卡默认态，无父任务即就绪）/ ready / failed（重试）均可调度；其余状态拒
    if (task.status !== 'ready' && task.status !== 'todo' && task.status !== 'failed') throw new Error('task not schedulable: ' + task.status);

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

    let agent: AgentLike;
    let context = '';
    const setup = async (agentCtx: Context): Promise<void> => {
      // 角色 agent 等同委派子 agent：固定 approval=never（避免后台会话悬挂等审批）。
      // M3(Q4)：D(execute)=唯一执行者 → sandbox=danger-full-access（可写任意目标仓库，无需提示）；
      // P/W/V → workspace-write（写边界=会话工作空间）。
      const session = (agentCtx as unknown as { agent?: { session?: { append?(k: string, v: unknown): void } } }).agent?.session;
      session?.append?.('approval/policy', { policy: 'never', source: 'delegation' });
      session?.append?.('sandbox/mode', isDExecute ? { mode: 'danger-full-access', source: 'delegation' } : { mode: 'workspace-write', source: 'delegation' });
      // 执行角色（P/W/D）先挂载 D22 裁剪 preset（kanban-p/w/d），把 shell/approval 等服务注入 agent scope；
      // 不再整包继承官方 code preset：bash/fs/fs-search 由裁剪组合装配，run_code/jobs/skill/goal/
      // plan-mode/compaction/delegation/web/todo 按角色裁剪（组合文件随包分发 + 运行时安装到
      // $DSH_HOME/.agent-presets/，见 preset-installer.ts）。否则官方 apply 会抛
      // "cannot get property shell without inject"。
      if (task.assignee === 'p' || task.assignee === 'w' || task.assignee === 'd') {
        const presets = (agentCtx as unknown as { get(n: string): unknown }).get('agentPresets') as
          | { mount(ctx: Context, id?: string): Promise<unknown> }
          | undefined;
        if (presets) {
          const presetId = 'kanban-' + task.assignee;
          try {
            await presets.mount(agentCtx, presetId);
            console.error('[dsh-kanban][debug] preset mounted ' + presetId + ' role=' + task.assignee + ' task=' + taskId);
          } catch (err) {
            // preset 挂载失败不阻断：角色工具面仍注册，仅缺基座工具
            console.error('[dsh-kanban][debug] preset mount failed ' + presetId + ' role=' + task.assignee + ' task=' + taskId + ': ' + String(err));
          }
        }
      }
      await installRoleTools(agentCtx, task.assignee, { kanban: this.kanban, wiki: this.wiki, taskId: task.id });
      // 只读评审角色（PT/DT）注册 ToolGuard：拦截 tracked source 写入 / git mutation / 含写标记 bash。
      // 以 dsh-tools 类型为准：tools.guard(execution => reason|undefined)，execution.name/arguments 为实际字段。
      if (task.assignee === 'pt' || task.assignee === 'dt') {
        const repoRoot = dRepo ?? sessionCwd; // DT 评审目标仓库；PT 以会话工作区为只读边界
        const toolsSvc = (agentCtx as { tools?: { guard?: (g: (e: unknown) => string | undefined) => unknown } }).tools;
        toolsSvc?.guard?.((e: unknown) => buildReadOnlyWriteGuard(repoRoot)(e as { name?: string; arguments?: unknown }));
      }
      // M4：D(execute) 注入 git 凭据（repo-local http extraheader，GitLab glpat-* 用 oauth2 basic）。
      // 由插件进程（不受 D 会话沙箱限制）写入 <repo>/.git/config；PAT 经 DSH 凭据服务/env 解析；
      // 注入失败仅告警（用户自带凭据/SSH 的仓库不受影响），未配置 PAT 不注入。
      if (isDExecute && dRepo) {
        const pat = await resolveGitPatFromCtx(this.ctx, process.env);
        if (pat) {
          const cred = injectGitCredentials(dRepo, pat);
          if (cred.ok) console.error('[dsh-kanban][debug] git credential injected task=' + taskId + ' targets=' + cred.detail);
          else console.error('[dsh-kanban][debug] git credential inject skipped task=' + taskId + ' repo=' + dRepo + ': ' + cred.detail);
        }
      }
    };
    try {
      // R1：claim 后任何异常（buildContext/spawn）→ failTask（attempts+1）→ 调度器重派/看门狗熔断；
      // 不留 "running 无 agent" 悬挂。
      await this.kanban.claimTask(taskId, 'system');
      console.error('[dsh-kanban][debug] runner claimed ' + taskId + ' attempts=' + task.attempts);
      context = this.buildContext(task, state, hasRunHistory);
      if (hasRunHistory) {
        // P2/B2：resume 同样传 setup——恢复的会话重新装配角色工具面（agent scope 注册随会话重建）
        // 返工卡复用被返工任务会话（task.resumeSessionId，避免重头），普通任务用确定性 kbn-<taskId>
        const h = await (this.ctx.get('agents') as unknown as { resume(o: unknown): Promise<{ agent: AgentLike }> }).resume({
          resumeSessionId: SessionId(task.resumeSessionId ?? `kbn-${taskId}`),
          agentOptions: this.modelOptions(task.assignee),
          setup,
        });
        agent = h.agent;
      } else {
        console.error('[dsh-kanban][debug] runner create start ' + taskId);
        const h = await (this.ctx.get('agents') as unknown as { create(o: unknown): Promise<{ agent: AgentLike }> }).create({
          sessionId: SessionId(`kbn-${taskId}`),
          // M2(Q5)：会话统一创建在发起 /plan: 的主 agent 工作空间（Chain.workspaceDir），回退 kanban 存储
          meta: { cwd: sessionCwd },
          agentOptions: this.modelOptions(task.assignee),
          setup,
        });
        console.error('[dsh-kanban][debug] runner create done ' + taskId);
        agent = h.agent;
      }
    } catch (err) {
      // P0-5/R1：claim/buildContext/spawn 失败也走 failed（attempts 递增）→ 调度器重派/看门狗熔断；不再让任务永久 claimed
      console.error('[dsh-kanban][debug] runner spawn error ' + taskId + ': ' + String(err));
      try {
        await this.kanban.failTask(taskId, 'runner-error: ' + String(err), 'system');
      } catch (failErr) {
        // 防御：任务可能已被其他路径完成/归档（终态），failTask 会抛非法转换；记录并继续
        console.error('[dsh-kanban][debug] runner spawn failTask skipped: ' + String(failErr));
      }
      return;
    }

    try {
      agent.followup({ content: [{ type: 'text', text: context }], source: { kind: 'user' } });
      console.error('[dsh-kanban][debug] runner followup sent ' + taskId);
      await agent.whenIdle();
      console.error('[dsh-kanban][debug] runner whenIdle resolved ' + taskId);
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
          console.error('[dsh-kanban][debug] runner skip block ' + taskId + ' status=' + (cur ? cur.status : 'gone'));
        } else {
          // 协议违规护栏：连续 protocol_violation 阻塞 ≥ maxProtocolViolations（默认 2）后，
          // 下一次违规直接 gave_up（不再恢复，走 [blocked-final] 证据链抛给主 agent）。任意角色（含 pt/dt）统一。
          const maxPV = this.config.dispatcher?.maxProtocolViolations ?? 2;
          const priorViolations = fresh.events.filter((e) =>
            e.taskId === taskId && e.kind === 'task/blocked' &&
            String(e.payload['reason'] ?? '').startsWith('protocol_violation'),
          ).length;
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
    } catch (err) {
      console.error('[dsh-kanban][debug] runner error ' + taskId + ': ' + String(err));
      // 失败语义（P0-5 统一）：发 failed 事件（attempts 递增），由调度器重派或看门狗熔断；不直接 block。
      // 防御：任务可能已被完成/归档（终态），failTask 会抛非法转换（done --task/failed-->）
      try {
        await this.kanban.failTask(taskId, 'runner-error: ' + String(err), 'system');
      } catch (failErr) {
        console.error('[dsh-kanban][debug] runner failTask skipped: ' + String(failErr));
      }
    }
  }

  /** M3(B)：D(execute) 目标仓库在会话工作空间外时，跑 D 前询问用户是否允许。
   *  经 ctx.userQuestions（GUI 弹窗）单次询问；无询问通道或拒绝 → 返回 false（由调用方 claim+block 等待人工放行）。 */
  private async requestRepoPermission(task: Task, repo: string, sessionCwd: string): Promise<boolean> {
    const uq = (this.ctx as unknown as { get?(n: string): unknown }).get?.('userQuestions') as
      | { ask(req: { questions: unknown[] }): Promise<{ answers: Array<{ id: string; selected: string[] }> }> }
      | undefined;
    if (!uq?.ask) return false;
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
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('repo-permission-ask timeout')), 120_000)),
      ]);
      return ans.answers?.[0]?.selected?.[0] === '允许';
    } catch {
      return false; // 询问失败（无 UI/超时）→ 视为未授权，走 block 等人工放行
    }
  }

  private modelOptions(role: Role) {
    const m = this.config.roles?.models?.[role];
    if (m?.provider && m?.model) return { provider: m.provider, model: m.model };
    if (this.defaultModel?.provider && this.defaultModel?.model) {
      return this.defaultModel.reasoningEffort
        ? { provider: this.defaultModel.provider, model: this.defaultModel.model, reasoningEffort: this.defaultModel.reasoningEffort }
        : { provider: this.defaultModel.provider, model: this.defaultModel.model };
    }
    return undefined;
  }

  private workspaceDir(): string {
    return (this.config.storageDir ?? '').replace('$DSH_HOME', process.env.DSH_HOME ?? process.cwd());
  }

}
