import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { KanbanService } from '../domain/kanban-service.js';
import type { KanbanConfig } from '../config.js';
import type { Role, Task } from '../domain/types.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { installRoleTools } from '../roles/toolsets.js';
import type { AgentModelOptions } from './dispatcher.js';

interface AgentLike {
  followup(msg: unknown): void;
  whenIdle(): Promise<void>;
  session: { events: Array<{ type?: string; name?: string }> };
}

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
    if (task.assignee !== 'v') {
      parts.push('权限提示：你的权限范围固定在会话工作区（workspace-write），越权操作（如 sandbox_permissions 升级写工作区外）会被自动拒绝且不可重试。遇到拒绝不要重试被拒操作，改用工作区内可行方式记录结果，然后调用 kanban_complete。');
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
    return parts.join('\n\n');
  }

  async runTask(taskId: string): Promise<void> {
    const state = await this.kanban.snapshot();
    const task = state.tasks.get(taskId);
    if (!task) throw new Error('unknown task: ' + taskId);
    // todo（V 建卡默认态，无父任务即就绪）/ ready / failed（重试）均可调度；其余状态拒
    if (task.status !== 'ready' && task.status !== 'todo' && task.status !== 'failed') throw new Error('task not schedulable: ' + task.status);

    // B2：resume 判定 = 任务有运行历史（attempts>0 或存在 claimed 事件）。
    // blocked→unblocked→ready 返工不递增 attempts，但已有 claimed 事件证明会话已存在 → resume 同一会话，
    // 避免与 kbn-<taskId> 确定性 sessionId 冲突（create 会因会话已存在而报错/重复建会话）。
    const hasRunHistory = task.attempts > 0 || state.events.some((e) => e.taskId === taskId && e.kind === 'task/claimed');

    let agent: AgentLike;
    let context = '';
    const setup = async (agentCtx: Context): Promise<void> => {
      // 角色 agent 等同委派子 agent：固定 approval=never（越权自动拒绝，避免后台会话悬挂等审批），
      // 与 dsh-subagent 的 delegated policy 语义一致；sandbox 保持 workspace-write。
      const session = (agentCtx as unknown as { agent?: { session?: { append?(k: string, v: unknown): void } } }).agent?.session;
      session?.append?.('approval/policy', { policy: 'never', source: 'delegation' });
      session?.append?.('sandbox/mode', { mode: 'workspace-write', source: 'delegation' });
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
    };
    try {
      // R1：claim 后任何异常（buildContext/spawn）→ failTask（attempts+1）→ 调度器重派/看门狗熔断；
      // 不留 "running 无 agent" 悬挂。
      await this.kanban.claimTask(taskId, 'system');
      console.error('[dsh-kanban][debug] runner claimed ' + taskId + ' attempts=' + task.attempts);
      context = this.buildContext(task, state, hasRunHistory);
      if (hasRunHistory) {
        // P2/B2：resume 同样传 setup——恢复的会话重新装配角色工具面（agent scope 注册随会话重建）
        const h = await (this.ctx.get('agents') as unknown as { resume(o: unknown): Promise<{ agent: AgentLike }> }).resume({
          resumeSessionId: SessionId(`kbn-${taskId}`),
          agentOptions: this.modelOptions(task.assignee),
          setup,
        });
        agent = h.agent;
      } else {
        console.error('[dsh-kanban][debug] runner create start ' + taskId);
        const h = await (this.ctx.get('agents') as unknown as { create(o: unknown): Promise<{ agent: AgentLike }> }).create({
          sessionId: SessionId(`kbn-${taskId}`),
          meta: { cwd: this.workspaceDir() },
          agentOptions: this.modelOptions(task.assignee),
          setup,
        });
        console.error('[dsh-kanban][debug] runner create done ' + taskId);
        agent = h.agent;
      }
    } catch (err) {
      // P0-5/R1：claim/buildContext/spawn 失败也走 failed（attempts 递增）→ 调度器重派/看门狗熔断；不再让任务永久 claimed
      console.error('[dsh-kanban][debug] runner spawn error ' + taskId + ': ' + String(err));
      await this.kanban.failTask(taskId, 'runner-error: ' + String(err), 'system');
      return;
    }

    try {
      agent.followup({ content: [{ type: 'text', text: context }], source: { kind: 'user' } });
      console.error('[dsh-kanban][debug] runner followup sent ' + taskId);
      await agent.whenIdle();
      console.error('[dsh-kanban][debug] runner whenIdle resolved ' + taskId);
      const used = agent.session.events.some((e) => e.name === 'kanban_complete' || e.name === 'kanban_block');
      if (!used) {
        await this.kanban.blockTask(taskId, 'protocol_violation: idle without complete/block', 'system');
      }
    } catch (err) {
      console.error('[dsh-kanban][debug] runner error ' + taskId + ': ' + String(err));
      // 失败语义（P0-5 统一）：发 failed 事件（attempts 递增），由调度器重派或看门狗熔断；不直接 block。
      await this.kanban.failTask(taskId, 'runner-error: ' + String(err), 'system');
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
