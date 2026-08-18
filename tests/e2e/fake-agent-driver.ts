import { KanbanService } from '../../src/domain/kanban-service.js';
import { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';
import { handlePlanRoute, handleOpenspecRoute } from '../../src/routes/prefix-router.js';
import type { Task } from '../../src/domain/types.js';

// P2：W1-supplement 按需（规格卡已含 W1-pre 附件则跳过）——本驱动默认跳过，聚焦 R20 主链。
const R20_ORDER: Array<{ assignee: 'w' | 'p' | 'd'; mode: Task['mode'] }> = [
  { assignee: 'p', mode: 'openspec' },
  { assignee: 'w', mode: 'kb' }, { assignee: 'd', mode: 'execute' }, { assignee: 'w', mode: 'kb' },
];

/** 模拟：主会话触发规划/批准 + 领域层按 R20 逐阶段创建与执行。
 *  V 编排逻辑（phase 序列/建卡校验/事件唤醒）由 T11.5 VOrchestrator 专项测试覆盖；
 *  本任务聚焦领域服务全链路集成（R20 串行顺序、交接、KB 中转、链完成规则）。 */
export async function runFullChain(
  svc: KanbanService,
  opts: { planMsg: string; openspecMsg: string; failWiki?: boolean },
): Promise<{ chainId: string; tasks: Task[]; wiki: { setOk(v: boolean): void } }> {
  const cfg = { plan: '/plan:', openspec: '/openspec:' };
  const wiki = { ok: !opts.failWiki, setOk(v: boolean) { this.ok = v; } };
  const wc = { write: async () => { if (!wiki.ok) throw Object.assign(new Error('unreachable'), { code: 'kb-unreachable' }); return { path: 'projects/x' }; }, baseUrl: 'http://mock' } as unknown as WikiVaultClient;

  // 阶段 0：/plan: 起手 → 链 + 规格卡草稿 + W1-pre 预取
  const plan = await handlePlanRoute(opts.planMsg, svc, cfg, 'session_main');
  const chainId = plan.chainId!;
  const w1pre = await svc.createTask({ chainId, title: 'w1-pre', assignee: 'w', mode: 'file' }, 'v');
  await svc.claimTask(w1pre.id, 'system');
  await svc.completeTask(w1pre.id, { summary: 'repo facts', metadata: { ref: '/workspaces/w1pre' }, completedAt: Date.now() }, 'w', { boundTaskId: w1pre.id });

  // 阶段 0 收敛：编辑规格卡（主会话）→ 用户 /openspec: 批准（本链路自己的卡）
  const card = (await svc.snapshot()).specCards.get(plan.specCardId!)!;
  await svc.editSpecCard(card.id, { problem: opts.planMsg, solution: 's', user_stories: ['u1'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
  await handleOpenspecRoute(opts.openspecMsg, svc, cfg, chainId, card.id);

  // 阶段 1：V 事件驱动逐阶段创建 + 执行（R20 串行）
  const tasks: Task[] = [];
  for (const step of R20_ORDER) {
    const t = await svc.createTask({ chainId, title: step.mode, assignee: step.assignee, mode: step.mode, parents: tasks.map((x) => x.id) }, 'v');
    await svc.claimTask(t.id, 'system');
    if (step.assignee === 'w' && step.mode === 'kb') {
      const res = await wc.write('projects/x', 'content').catch((e) => e);
      if (res && res.code === 'kb-unreachable') {
        await svc.blockTask(t.id, 'kb-unreachable', 'w', { boundTaskId: t.id });
        tasks.push(t);
        return { chainId, tasks, wiki: wiki as never };
      }
      await svc.completeTask(t.id, { summary: 'synced', metadata: { kb_url: 'http://mock/#/page/projects/x', page_path: 'projects/x' }, completedAt: Date.now() }, 'w', { boundTaskId: t.id });
    } else if (step.assignee === 'p') {
      await svc.completeTask(t.id, { summary: 'plan', metadata: { artifacts_path: '/ws/plan.md' }, completedAt: Date.now() }, 'p', { boundTaskId: t.id });
    } else if (step.assignee === 'd') {
      // R20 D=执行者：complete 必须带 git 产物证据（changed_files + commit_hash/push）
      await svc.completeTask(t.id, { summary: 'impl', metadata: { changed_files: ['auth.ts'], verification: ['pytest'], commit_hash: 'deadbeef', push: true }, completedAt: Date.now() }, 'd', { boundTaskId: t.id });
    } else {
      await svc.completeTask(t.id, { summary: 'prefetch', metadata: { ref: '/ws/x' }, completedAt: Date.now() }, 'w', { boundTaskId: t.id });
    }
    tasks.push(t);
  }
  // 链路完成无需显式调用：W3 complete 后，completeTask 内的链完成机械规则（P0-3）
  // 检测到链上无未终态任务且链 executing → 自动 emit chain/completed。
  return { chainId, tasks, wiki: wiki as never };
}
