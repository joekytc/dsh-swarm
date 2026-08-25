import { KanbanService } from '../../src/domain/kanban-service.js';
import { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';
import { handlePlanRoute, handleOpenspecRoute } from '../../src/routes/prefix-router.js';
import { validatePlanningChecklist, type PlanningChecklist } from '../../src/domain/planning-checklist.js';
import type { Task } from '../../src/domain/types.js';

// v2 阶段序：p → (pt, 按需) → w2 → d → dt → w3（旧 W1 预取/补充阶段已断代）。
const STEPS: Array<{ assignee: Task['assignee']; mode: Task['mode'] }> = [
  { assignee: 'p', mode: 'openspec' },
  { assignee: 'w', mode: 'kb' }, { assignee: 'd', mode: 'execute' },
  { assignee: 'dt', mode: 'review-impl' }, { assignee: 'w', mode: 'kb' },
];

const CHECKLIST: PlanningChecklist = {
  spec: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
  manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
  clarifications: [], doubts: [],
};

/** 模拟：主会话触发规划/批准 + 领域层按 v2 逐阶段创建与执行。
 *  V 编排逻辑（phase 序列/建卡校验/事件唤醒）由 VOrchestrator 专项测试覆盖；
 *  本驱动聚焦领域服务全链路集成（v2 串行顺序、交付契约、KB 中转、链完成规则）。 */
export async function runFullChain(
  svc: KanbanService,
  opts: { planMsg: string; openspecMsg: string; failWiki?: boolean; ptNeeded?: boolean },
): Promise<{ chainId: string; tasks: Task[]; wiki: { setOk(v: boolean): void } }> {
  const cfg = { plan: '/plan:', openspec: '/openspec:' };
  const wiki = { ok: !opts.failWiki, setOk(v: boolean) { this.ok = v; } };
  const wc = { write: async () => { if (!wiki.ok) throw Object.assign(new Error('unreachable'), { code: 'kb-unreachable' }); return { path: 'projects/x' }; }, baseUrl: 'http://mock' } as unknown as WikiVaultClient;

  // 阶段 0：/plan: 零副作用（v2）——不建链/规格卡/任务卡，仅返回路由结果
  const plan = await handlePlanRoute(opts.planMsg, svc, cfg, 'session_main');
  expectPlan(plan.kind === 'plan');
  // 清单保存（schema 硬校验通过）+ /openspec: 建链（挂 file-prefetch + kb 附件）→ 批准 → executing
  const checklistErrors = validatePlanningChecklist(CHECKLIST);
  if (checklistErrors.length > 0) throw new Error('checklist invalid: ' + checklistErrors.join(', '));
  const open = await handleOpenspecRoute(opts.openspecMsg, svc, cfg, { workspaceDir: '/ws', checklist: CHECKLIST, checklistRef: 'projects/checklists/session_main.md' }, 'session_main');
  const chainId = open.chainId!;

  // pt 按需分流：P 交付 pt_decision.needed=true 时在 p 之后插入 pt:review-plan 卡
  const steps = [...STEPS];
  if (opts.ptNeeded) steps.splice(1, 0, { assignee: 'pt', mode: 'review-plan' });

  // 阶段 1：串行执行（v2：p→(pt)→w2→d→dt→w3）
  const tasks: Task[] = [];
  for (const step of steps) {
    const t = await svc.createTask({ chainId, title: step.mode, assignee: step.assignee, mode: step.mode, parents: tasks.map((x) => x.id) }, 'v');
    await svc.claimTask(t.id, 'system');
    if (step.assignee === 'w' && step.mode === 'kb') {
      const res = await wc.write('projects/x', 'content').catch((e) => e);
      if (res && res.code === 'kb-unreachable') {
        await svc.blockTask(t.id, 'kb-unreachable', 'w', { boundTaskId: t.id });
        tasks.push(t);
        return { chainId, tasks, wiki };
      }
      await svc.completeTask(t.id, { summary: 'synced', metadata: { kb_url: 'http://mock/#/page/projects/x', page_path: 'projects/x' }, completedAt: Date.now() }, 'w', { boundTaskId: t.id });
    } else if (step.assignee === 'p') {
      const ptDecision = opts.ptNeeded ? { needed: true, reason: '涉及多模块接口改动' } : { needed: false };
      await svc.completeTask(t.id, { summary: 'plan', metadata: { artifacts_path: '/ws/plan.md', pt_decision: ptDecision }, completedAt: Date.now() }, 'p', { boundTaskId: t.id });
    } else if (step.assignee === 'd') {
      // v2 D=执行者：complete 必须带 git 产物证据（changed_files + commit_hash/push）
      await svc.completeTask(t.id, { summary: 'impl', metadata: { changed_files: ['auth.ts'], verification: ['pytest'], commit_hash: 'deadbeef', push: true }, completedAt: Date.now() }, 'd', { boundTaskId: t.id });
    } else if (step.assignee === 'pt') {
      await svc.completeTask(t.id, { summary: 'reviewed', metadata: { artifacts_path: '/ws/plan.md', review_evidence: { verdict: 'pass', issues: [] } }, completedAt: Date.now() }, 'pt', { boundTaskId: t.id });
    } else if (step.assignee === 'dt') {
      await svc.completeTask(t.id, { summary: 'reviewed', metadata: { review_evidence: { verdict: 'pass', issues: [], test: { exit: 0 }, build: { exit: 0 }, lint: { exit: 0 }, diff: { files: ['auth.ts'] }, git: { branch: 'feat/x' }, openCodeReview: { conclusion: 'pass' } } }, completedAt: Date.now() }, 'dt', { boundTaskId: t.id });
    }
    tasks.push(t);
  }
  // 链路完成无需显式调用：W3 complete 后，completeTask 内的链完成机械规则（P0-3）
  // 检测到链上无未终态任务且链 executing → 自动 emit chain/completed。
  return { chainId, tasks, wiki };
}

function expectPlan(v: boolean): asserts v { if (!v) throw new Error('expected /plan: route'); }
