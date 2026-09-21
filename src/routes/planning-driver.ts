import { KanbanService } from '../domain/kanban-service.js';
import { parsePrefix } from './prefix-router.js';
import type { SpecCard, SpecCardAttachment } from '../domain/types.js';
import { DEFAULT_PREFIX_ROUTES, type PrefixRoutes } from '../config.js';

/** 阶段 0 规划引导：命令串从 config 派生，/openspec: 改名时文案自动跟随。
 *  提问节奏与 skills/grill-me/SKILL.md 对齐：官方 frontier 分轮制（整批问 + 推荐答案 + 答复后解锁下一轮）；
 *  需求澄清十规则：来源必挂 + PRD 采集 + 范围边界 + 人话 + 仓库事实/缺口暂停 + 收敛录入铁律（含决策可追溯）；
 *  收敛产物仍为 planning_checklist_save（KB 清单是建链数据源）。 */
export function buildPlanningGuidance(routes: PrefixRoutes, opts?: { swarm?: boolean }): string {
  // 第 8 条按形态分叉：前缀 = 教学旧命令收尾（收尾句不变）；swarm = 确认闸语义（不提旧命令，与 KANBAN_HANDOFF_RULE swarm 确认闸对齐）。
  const finish = opts?.swarm
    ? `8. 收尾（确认闸）：清单落库后向用户征求确认；仅当用户回复含明确肯定语义（确认/开干/开跑/开始/go 等）才调 kanban_route{intent:'openspec'} 建链开跑；模糊回复视为未确认，继续澄清。`
    : `8. 收尾：提醒用户以 ${routes.openspec} 确认执行结束规划阶段——${routes.openspec} 会从清单建链并自动串行执行。`;
  return `
# 阶段 0 规划对话（v5：grill-me frontier 分轮 + 需求澄清十规则）
1. 需求来源必挂：起手记录需求来源（TAPD/Jira/其他链接）；确无来源也要显式记录「无来源+原因」，不许空。
2. PRD 链接必采集：用户给了 PRD/需求文档链接，必须先调 planning_prd_collect 逐条采集（一条链接一次调用，多条可并行），采集完成前不得进入 grill-me 提问。采集失败（blocked）立即停下，把工具返回的 guidance 按类转告用户：登录态→请用户自行登录后重采；缺技能→引导安装（带登录态浏览器 huashu-chrome / CDP 兜底 web-access / 企微 wecom-docs / 飞书 lark）；404→请用户提供有效链接。用户解决后继续未完成的采集。禁止盲猜页面内容、禁止跳过、禁止自行探索浪费时间。
3. 范围边界：起手明确「范围内/范围外」清单，尤其需求文档中标注多但用户未点名的部分，逐条确认纳入与否。
4. 需求澄清（grill-me，frontier 分轮）：把计划映射为设计决策树——每轮只问当前前提已就绪的问题（frontier），整批问出：编号 + 每问附推荐答案；等用户全部答复后重算 frontier 再发下一轮。先澄清目的、约束、成功标准，逐支拷问直至用户"没有任何疑问"。
5. 人话硬规则：问题正文与选项必须通俗；术语避不开时首次出现括号一句话解释；发问前自检「不懂本仓库的人能直接回答吗」，不能就重写。
6. 仓库事实（planning_prefetch）与缺口暂停：事实自查是规划者的职责——涉筛选字段/列表字段/取数 hook/组件选型，先调只读子代理查证仓库（存在/可复用/复用+转化），推荐答案言出有据，不拿可自查的问题问用户；澄清中发现信息缺口 → 停止提问 → 先调 planning_prefetch 补齐 → 再继续，不边猜边问。每功能点先查仓库同类实现，可复用优先复用。
7. 收敛（planning_checklist_save）：把结论写成结构化需求澄清清单存入 KB（KB 不可达自动兜底临时目录）。录入铁律：每条问答含完整决策正文（字段名/接口路径/枚举值/组件名/位置规则），禁止「按推荐」「同上」等指代不明缩写（代码硬闸会拒收）；sources（需求来源）/ prdCollection（每条 PRD 链接的采集状态）必填；后端未就绪项统一登记 placeholders（占位对象/占位值/替换方式），集中声明避免逐点重复讨论。每条决策可追溯（问答编号/仓库源码路径/接口文档位置至少其一）；原始文档值与确认决策冲突处必须标【已调整】/【已确认】，未确认值不录或显式标「待确认」——无来源记录的决策会被视为 agent 自行默认。
${finish}
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
