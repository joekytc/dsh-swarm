import { KanbanService, buildChainTitle } from '../domain/kanban-service.js';
import { buildLearningBrief, resolveLearningChainId } from '../domain/memory.js';
export function parsePrefix(message, cfg) {
    const trimmed = message.trim();
    if (trimmed.startsWith(cfg.plan))
        return { kind: 'plan', rest: trimmed.slice(cfg.plan.length).trim() };
    if (trimmed.startsWith(cfg.openspec))
        return { kind: 'openspec', rest: trimmed.slice(cfg.openspec.length).trim() };
    if (trimmed.startsWith(cfg.learning))
        return { kind: 'learning', rest: trimmed.slice(cfg.learning.length).trim() };
    return { kind: 'none', rest: trimmed };
}
/** v2：/plan: 零副作用——不建链/规格卡/任务卡，仅返回路由结果（workspaceDir/sessionId 由 main-session-tools 捕获）。 */
export async function handlePlanRoute(message, _service, cfg, _ownerSessionId) {
    return parsePrefix(message, cfg);
}
/** v2：/openspec: 建链——从清单机械映射规格卡六段 → 挂 file-prefetch(仓库 localPath)+kb(清单页) → 批准 → executing。 */
export async function handleOpenspecRoute(message, service, cfg, planning, ownerSessionId) {
    const parsed = parsePrefix(message, cfg);
    if (parsed.kind !== 'openspec')
        return parsed;
    // 护栏前移（fail-fast）：无 workspaceDir 的链会让 V 在 getVAgent 抛 workspace-unknown
    // 且被 dispatcher 静默吞掉（链上零任务 → 无任何后续事件重试）→ 空壳链死锁。
    // 典型成因：主 agent 进程重启后 planningBySession 重建，仅重存清单未重走 /plan:，
    // workspaceDir 为 null。此处禁止建链建卡，引导用户先 /plan: 重新捕获工作区。
    if (!planning.workspaceDir || !planning.workspaceDir.trim()) {
        return {
            kind: 'openspec', approved: false, reason: 'workspace-unknown', rest: parsed.rest,
            guidance: [
                '## 建链被拦截：workspaceDir 缺失（workspace-unknown）',
                '当前规划上下文没有目标仓库工作区（多为主 agent 重启后清单内存重建所致）。',
                '处理步骤（严格顺序）：',
                '1. 重新发送 ' + cfg.plan + ' <需求描述> 让主 agent 捕获工作区（必要时按提示注册工作区）；',
                '2. 清单仍在时重发 ' + cfg.openspec + ' 确认即可建链；清单丢失则重新澄清后再确认。',
                '禁止：在无工作区时建链建卡；猜测工作区路径。',
            ].join('\n'),
        };
    }
    const chain = await service.createChain({
        title: buildChainTitle(planning.checklist.requirementName ?? planning.requirementName ?? null, parsed.rest, planning.checklist.spec.problem),
        ownerSessionId, workspaceDir: planning.workspaceDir,
    }, 'human');
    const card = await service.createSpecCard(chain.id, planning.checklist.spec, 'human');
    await service.addSpecCardAttachment(card.id, { name: '需求澄清清单(仓库事实)', kind: 'file-prefetch', ref: planning.checklist.manifest.repo.localPath }, 'v');
    await service.addSpecCardAttachment(card.id, { name: '需求澄清清单(完整资料)', kind: 'kb', ref: planning.checklistRef }, 'v');
    await service.approveSpecCard(card.id, 'human');
    return { kind: 'openspec', chainId: chain.id, specCardId: card.id, rest: parsed.rest };
}
/** /learning 零副作用引导文案：命令串从 config 派生（决策12），歧义/未找到时注入主 agent。 */
export function buildLearningGuidance(routes) {
    return [
        '## 经验蒸馏指令（' + routes.learning + '）',
        '消化上方「链上下文 + 机械信号证据包」，蒸馏 1-3 条可复用经验（返工根因 / 阻塞原因 / 审计教训）。',
        '每条约成 LearningEntry（title 一句话≤80 字符；lesson 教训；evidence 必须填本链 chain id 作机械证据；tags 自由标签）。',
        '调 planning_learning_save：scope=chain 存需求级 projects/<repoSlug>/<chainId>/learnings/；仓库通用经验用 scope=project（projects/<repoSlug>/learnings/，repoSlug 由链 workspaceDir 派生）。',
        '无值得沉淀的经验时，明确回复「无新经验」，不要硬凑。',
    ].join('\n');
}
/** v2：/learning 零副作用——不建链建卡，仅机械提取证据包供主 agent 蒸馏。歧义返回候选列表，链不存在返回错误文本（不 throw）。 */
export async function handleLearningRoute(message, service, cfg, _ownerSessionId) {
    const parsed = parsePrefix(message, cfg);
    if (parsed.kind !== 'learning')
        return parsed;
    const state = await service.snapshot();
    const resolved = resolveLearningChainId(state, parsed.rest);
    if (resolved === null) {
        return { kind: 'learning', rest: parsed.rest, error: 'chain-not-found', guidance: `未找到可蒸馏经验的链。可用 ${cfg.learning} <chainId> 指定，或先经 ${cfg.plan}${cfg.openspec} 建立链路。` };
    }
    if ('candidates' in resolved) {
        const list = resolved.candidates.map((c) => `- ${c.chainId} ${c.title}`).join('\n');
        return { kind: 'learning', rest: parsed.rest, error: 'chain-ambiguous', guidance: `匹配到多条链，请用 ${cfg.learning} <chainId> 精确指定：\n${list}` };
    }
    const brief = buildLearningBrief(state, resolved.chainId);
    return { kind: 'learning', chainId: resolved.chainId, rest: parsed.rest, brief, guidance: buildLearningGuidance(cfg) };
}
