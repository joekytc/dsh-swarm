import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { KanbanService } from '../domain/kanban-service.js';
import type { KanbanConfig } from '../config.js';
import type { Role, Task } from '../domain/types.js';

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
  constructor(
    ctx: Context,
    kanban: KanbanService,
    config: KanbanConfig,
  ) { this.ctx = ctx; this.kanban = kanban; this.config = config; }

  private buildContext(task: Task, state: Awaited<ReturnType<KanbanService['snapshot']>>): string {
    const parts: string[] = [`# Task ${task.id}: ${task.title}`, `assignee=${task.assignee} mode=${task.mode}`];
    if (task.body) parts.push(`## Body\n${task.body}`);
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
    if (task.attempts > 0) parts.push(`## Prior attempts: ${task.attempts} (resume session)`);
    return parts.join('\n\n');
  }

  async runTask(taskId: string): Promise<void> {
    const state = await this.kanban.snapshot();
    const task = state.tasks.get(taskId);
    if (!task) throw new Error('unknown task: ' + taskId);
    // todo（V 建卡默认态，无父任务即就绪）/ ready / failed（重试）均可调度；其余状态拒
    if (task.status !== 'ready' && task.status !== 'todo' && task.status !== 'failed') throw new Error('task not schedulable: ' + task.status);

    await this.kanban.claimTask(taskId, 'system');
    const context = this.buildContext(task, state);

    const preset = this.config.roles?.personaPresets?.[task.assignee] ?? `dsh-kanban/persona-${task.assignee}`;
    let agent: AgentLike;
    if (task.attempts > 0) {
      // P2：resume 同样传 setup——恢复的会话重新装配角色工具面（agent scope 注册随会话重建）
      const h = await (this.ctx.agents as unknown as { resume(o: unknown): Promise<{ agent: AgentLike }> }).resume({
        resumeSessionId: SessionId(`kbn-${taskId}`),
        agentOptions: this.modelOptions(task.assignee),
        setup: (agentCtx: Context) => { this.installRoleTools(agentCtx, task.assignee); },
      });
      agent = h.agent;
    } else {
      const h = await (this.ctx.agents as unknown as { create(o: unknown): Promise<{ agent: AgentLike }> }).create({
        sessionId: SessionId(`kbn-${taskId}`),
        meta: { agentPreset: preset },
        agentOptions: this.modelOptions(task.assignee),
        setup: (agentCtx: Context) => { this.installRoleTools(agentCtx, task.assignee); },
      });
      agent = h.agent;
    }

    try {
      agent.followup({ content: [{ type: 'text', text: context }], source: { kind: 'user' } });
      await agent.whenIdle();
      const used = agent.session.events.some((e) => e.name === 'kanban_complete' || e.name === 'kanban_block');
      if (!used) {
        await this.kanban.blockTask(taskId, 'protocol_violation: idle without complete/block', 'system');
      }
    } catch (err) {
      // 失败语义（P0-5 统一）：发 failed 事件（attempts 递增），由调度器重派或看门狗熔断；不直接 block。
      await this.kanban.failTask(taskId, 'runner-error: ' + String(err), 'system');
    }
  }

  private modelOptions(role: Role) {
    const m = this.config.roles?.models?.[role];
    return m ? { provider: m.provider, model: m.model } : undefined;
  }

  private installRoleTools(agentCtx: Context, role: Role): void {
    // T15 实现：按角色注册工具面（wiki/prefetch/fs/terminal/openspec）。
    // P1-4：注册工具时闭包捕获本任务的 taskId，作为 ToolCaller.boundTaskId 注入每次执行——
    // 该 agent 会话只能 complete/block/heartbeat 它绑定的任务。
  }
}
