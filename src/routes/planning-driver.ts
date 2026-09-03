import { KanbanService } from '../domain/kanban-service.js';
import { parsePrefix } from './prefix-router.js';
import type { SpecCard, SpecCardAttachment } from '../domain/types.js';
import { DEFAULT_PREFIX_ROUTES, type PrefixRoutes } from '../config.js';

/** 阶段 0 规划引导：命令串从 config 派生（决策12），/openspec: 改名时文案自动跟随。
 *  节奏对齐 skills/grill-me/SKILL.md 增强版：frontier 分轮 + 人话硬规则 + 风险登记。 */
export function buildPlanningGuidance(routes: PrefixRoutes): string {
  return `
# 阶段 0 规划对话（v3：grill-me frontier 分轮）
1. 需求澄清（grill-me）：分轮拷问——每轮把当前可问的问题整批问出（编号 + 每问附推荐答案），等用户全部答复后再根据答案解锁下一轮；一次发一轮，不发单个问题。先澄清目的、约束、成功标准，再逐支拷问假设直至用户"没有任何疑问"。
2. 人话硬规则：问题正文与选项必须通俗；术语避不开时首次出现括号一句话解释；发问前自检「不懂本仓库的人能直接回答吗」，不能就重写。
3. 仓库事实（planning_prefetch）：问题需要的事实（本地路径/分支/目标文件基线/既有实现）用只读子代理自己查，不问用户；只把真正的决定留给用户。
4. 风险登记：过程中发现真实风险或非阻塞关注点随手记一行（描述 + 来源决定 + 缓解思路），收敛时并入澄清清单；没有就不写，禁止硬凑。
5. 收敛（planning_checklist_save）：把结论写成结构化需求澄清清单（spec 六段 + manifest repo.files + 澄清问答 + 疑问点）存入 KB（KB 不可达自动兜底临时目录）。
6. 收尾：提醒用户以 ${routes.openspec} 确认执行结束规划阶段——${routes.openspec} 会从清单建链并自动串行执行。
护栏：规划期只读仓库，禁止任何 git/源码写入；只写 KB 与临时目录。
`;
}

export function validateSpecCardForApproval(card: SpecCard): string[] {
  const missing: string[] = [];
  const s = card.sections;
  if (typeof s.problem !== 'string' || !s.problem.trim()) missing.push('problem');
  if (typeof s.solution !== 'string' || !s.solution.trim()) missing.push('solution');
  if (!Array.isArray(s.user_stories) || s.user_stories.length === 0) missing.push('user_stories');
  if (typeof s.testing !== 'string' || !s.testing.trim()) missing.push('testing');
  if (typeof s.out_of_scope !== 'string' || !s.out_of_scope.trim()) missing.push('out_of_scope');
  if (!card.attachments.some((a) => a.kind === 'file-prefetch')) missing.push('attachments:file-prefetch');
  return missing;
}

export function buildPlanningContext(chainId: string, card: SpecCard, attachments: SpecCardAttachment[], routes: PrefixRoutes = DEFAULT_PREFIX_ROUTES): string {
  return [
    `# 规划上下文 chain=${chainId} specCard=${card.id}`,
    buildPlanningGuidance(routes),
    `## 当前规格卡\n${JSON.stringify(card.sections, null, 2)}`,
    `## 仓库事实附件\n${attachments.map((a) => `${a.name}: ${a.ref}`).join('\n') || '(无)'}`,
  ].join('\n\n');
}

export async function approveIfReady(
  message: string,
  service: KanbanService,
  cfg: PrefixRoutes,
  chainId: string,
  specCardId: string,
): Promise<{ ok: true; card: SpecCard } | { ok: false; missing: string[]; guidance: string }> {
  const parsed = parsePrefix(message, cfg);
  if (parsed.kind !== 'openspec') return { ok: false, missing: ['prefix'], guidance: buildPlanningGuidance(cfg) };
  const state = await service.snapshot();
  const card = state.specCards.get(specCardId);
  if (!card) return { ok: false, missing: ['spec-card'], guidance: buildPlanningGuidance(cfg) };
  if (card.status === 'approved') return { ok: true, card };
  const missing = validateSpecCardForApproval(card);
  if (missing.length > 0) {
    return { ok: false, missing, guidance: buildPlanningGuidance(cfg) };
  }
  const approved = await service.approveSpecCard(specCardId, 'human');
  return { ok: true, card: approved };
}
