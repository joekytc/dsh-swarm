import { KanbanService } from '../domain/kanban-service.js';
import { parsePrefix } from './prefix-router.js';
import type { SpecCard, SpecCardAttachment } from '../domain/types.js';
import { DEFAULT_PREFIX_ROUTES, type PrefixRoutes } from '../config.js';

/** 阶段 0 规划引导：命令串从 config 派生（决策12），/openspec: 改名时文案自动跟随。
 *  提问节奏与 skills/grill-me/SKILL.md 对齐：官方 frontier 分轮制（整批问 + 推荐答案 + 答复后解锁下一轮）；
 *  增强项：人话硬规则 + 过程风险登记；收敛产物仍为 planning_checklist_save（KB 清单是建链数据源）。 */
export function buildPlanningGuidance(routes: PrefixRoutes): string {
  return `
# 阶段 0 规划对话（v4：grill-me frontier 分轮，与 skills/grill-me 对齐）
1. 需求澄清（grill-me，frontier 分轮）：把计划映射为设计决策树——每轮只问当前前提已就绪的问题（frontier），整批问出：编号 + 每问附推荐答案；等用户全部答复后重算 frontier（已定决定向外推进、解锁依赖它的问题）再发下一轮，本轮答不了的依赖问题留到后续轮。先澄清目的、约束、成功标准，逐支拷问直至用户"没有任何疑问"。
2. 人话硬规则：问题正文与选项必须通俗；术语避不开时首次出现括号一句话解释；发问前自检「不懂本仓库的人能直接回答吗」，不能就重写。
3. 仓库事实（planning_prefetch）：事实自查是规划者的职责——调只读子代理采集目标仓库/资料/知识库事实（本地路径/分支/目标文件基线/既有实现），不凭空假设、不拿可自查的问题问用户；只把真正的决定留给用户。
4. 风险登记：每轮答复中若发现真实风险或非阻塞关注点，随手记一行（描述 + 来源决定 + 缓解思路），收敛时并入澄清清单；没有就不写，禁止硬凑。
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
