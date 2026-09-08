import { defineTool } from '@deepseek-ai/dsh-tools';
import {} from '@deepseek-ai/dsh-util-values';
import { tmpdir } from 'node:os';
import { KanbanProvider } from '../services/kanban-provider.js';
import { buildKanbanTools } from './kanban-tools.js';
import { buildSpecCardTools } from './spec-card-tools.js';
import { buildPlanningTools } from './planning-tools.js';
import { handlePlanRoute, handleOpenspecRoute, handleLearningRoute } from '../routes/prefix-router.js';
import { sendChainReport } from '../services/im-delivery.js';
import { recallMemoryIndex, searchChecklists } from '../wiki/memory-recall.js';
import { buildPlanningGuidance } from '../routes/planning-driver.js';
import { attachSessionToWorkspace, resolveOrCreateWorkspace } from '../dispatcher/workspace-attach.js';
import { PREFETCH_MANIFEST_SCHEMA } from '../domain/prefetch-manifest.js';
import { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { LocalWikiClient } from '../wiki/local-kb-client.js';
import { ensureLocalKbRoot } from '../wiki/local-kb.js';
import { LOCAL_CHECKLIST_PREFIX } from '../wiki/page-path.js';
export const planningBySession = new Map();
export const KANBAN_HANDOFF_RULE = (routes, opts) => {
    const confirmLine = opts?.swarm
        ? `- 澄清期：调 planning_prefetch（只读子代理）采集仓库事实 → 逐问用户收敛 → 调 planning_checklist_save 存需求澄清清单。
- 确认闸：清单落库后向用户征求确认；仅当用户回复含明确肯定语义（确认/开干/开跑/开始/go 等）才调 kanban_route{intent:'openspec'} 建链；模糊、岔开话题、只提修改意见 = 未确认，继续澄清。禁止未确认建链。`
        : `- 澄清期：调 planning_prefetch（只读子代理）采集仓库事实 → 逐问用户收敛 → 调 planning_checklist_save 存需求澄清清单 → 提醒用户 ${routes.openspec} 确认。`;
    const nextLine = opts?.swarm
        ? `- 用户确认后你调 kanban_route{intent:'openspec'}；链路进入 executing，V 自动串行建卡 p→(pt)→w2→d→dt→w3；你不要自己执行。`
        : `- ${routes.openspec} 后链路进入 executing，V 自动串行建卡 p→(pt)→w2→d→dt→w3；你不要自己执行。`;
    return `
## 主 agent 铁律（看板工作流 v2）
- 你是计划者：只做需求澄清（grill-me）与最终收尾汇报；绝不执行任务本身。
- 最高护栏：只读仓库——禁止 git 操作、禁止 write/edit 任何仓库源码；只允许写 KB（planning_checklist_save）与临时目录兜底。
${confirmLine}
${nextLine}
- 用 kanban_show / kanban_list / spec_card_view 观察进度，链完成后向用户汇报产物链接与轨迹入口。
- 经验沉淀：链路完成后，用户可发 ${routes.learning}（或 ${routes.learning} <chainId>）沉淀本链经验；主 agent 消化机械证据包后调 planning_learning_save 入库。
- 叙述铁律：回复中的链号/卡号（ch_/sc_/t_ 编号）只能逐字复制自工具结果；建链成败以工具结果字段为准，禁止编造或沿用旧对话里的编号。
`;
};
/** 防线③：/openspec: 成功后的逐链确定性叙述规则（2026-09-04 mtmgp81q：模型口播 ch_1_mtjrhkrf
 *  与工具结果 ch_1_mtmgp81q 脱节）。逐字引用锚点 + firstCard 成败结论；整包缓存回放仍可能
 *  绕过 prompt 层——最终防线是链级看门狗（防线①）。 */
export function buildOpenspecNarrationRule(r) {
    const firstCardLine = !r.firstCard
        ? '- 首卡结果未采集（旧返回体）。汇报前先调 kanban_show 复核链状态，以 kanban_show 复核后再汇报，禁止臆断建卡成功。'
        : 'pending' in r.firstCard
            ? `- 首卡尚未创建（等待超时，看门狗接管）。回复必须写明「首卡尚未创建，看门狗接管」，禁止声称建卡成功。`
            : `- 首卡已创建：taskId=${r.firstCard.taskId}（status=${r.firstCard.status}）。回复必须写明「首卡已创建」。`;
    return [
        '## 本次建链结果（回复必须逐字引用，禁止改写编号）',
        `- chainId=${r.chainId}`,
        `- specCardId=${r.specCardId}`,
        firstCardLine,
        '- 铁律：回复中的 ch_/sc_/t_ 编号只能逐字复制自本结果；禁止出现本结果之外的任何编号；禁止声称与本结果矛盾的建卡状态。',
    ].join('\n');
}
// 清单获取只有两条路：内存（路由1）> KB 候选页（路由2，LLM 读页重建）。禁止编造其他原因
// （"先重试 / 查服务进程是否重启"类诊断是噪声：内存丢失唯一成因是插件重启，重启后按两条路恢复即可）。
const RECOVERY_KB_GUIDANCE = (routes, candidates) => `
插件内存中的需求澄清清单已丢失（插件进程重启所致，属预期情况，按两条获取路由恢复即可，勿猜测其他原因）。
知识库中检索到候选清单页：
${candidates.map((c) => '- ' + c).join('\n')}
恢复步骤（严格顺序）：
1. 读取候选页内容，对照当前需求判定哪一页是本次需求的需求澄清清单（页首行标题为「# 【需求】<需求名>」）；
2. 消化该页内容，重建结构化 PlanningChecklist（spec 六段 + manifest + clarifications + doubts + risks（风险点，若有），requirementName 取页标题中【需求】后的名称；恢复重建时 clarifications 允许登记单条无澄清说明，如 {"q": "本轮无澄清（恢复重建）", "a": "<来源页或原因>"}，其余场景 clarifications 禁止为空）；
3. 调 planning_checklist_save(checklist, restoreRef=<该候选页路径>) 回存（覆盖原页，勿产生重复页）；
4. 回存成功后提示用户重新发送 ${routes.openspec} 确认。
禁止：跳过恢复直接建链建卡；猜测清单内容；把恢复失败归因于"重试/进程检查"之外的任何原因。
`;
const RECOVERY_NONE_GUIDANCE = (routes) => `
两条获取路由均无本需求的需求澄清清单（内存为空，知识库亦无匹配页）。
处理步骤（严格顺序）：
1. 消化当前对话上下文，判断需求澄清（grill-me 逐问收敛 + planning_prefetch 仓库事实）是否已完成但漏了保存动作；
2. 若已完成澄清——立即调 planning_checklist_save 保存清单；若尚未完成——先完成澄清（缺仓库事实则先 planning_prefetch），再保存；
3. 保存成功后提示用户重新发送 ${routes.openspec} 确认。
禁止：在清单落库前建链建卡；编造"先重试 / 查服务进程是否重启"之类与清单无关的诊断。
`;
/** 预取子代理禁用的写能力工具（官方全局工具名；deny = 从 prompt 消失 + 拒绝执行，"one visibility"）。 */
const PREFETCH_DENIED_TOOLS = ['bash', 'edit', 'write'];
export function buildSpawnPrefetch(ctx) {
    const subagents = ctx.get('subagents');
    if (!subagents?.start)
        return undefined;
    return async (prompt, workspaceDir, parentAgent, signal) => {
        // 血缘源必须由 agent loop 经 ToolRunContext 透传（planning_prefetch exec.agent）；
        // 无 parent 说明工具面接线缺失，快速失败而非静默退化为无血缘会话。
        if (!parentAgent)
            throw new Error('planning_prefetch: missing parent agent — 工具运行时未注入 exec.agent');
        const cwd = workspaceDir || process.cwd();
        let run;
        try {
            run = await subagents.start('spawn', {
                label: 'prefetch',
                prompt: [{ type: 'text', text: prompt }],
                parent: parentAgent,
                signal: signal ?? new AbortController().signal,
                maxDepth: 1,
                toolFilter: { deny: [...PREFETCH_DENIED_TOOLS] },
                outputSchema: PREFETCH_MANIFEST_SCHEMA,
            });
        }
        catch (err) {
            throw new Error('planning_prefetch: subagent start failed: ' + String(err));
        }
        try {
            // 归组：缝生成的子会话（run.id = 子 session id）attach 到 cwd 对应工作区（失败不阻断只读采集）
            await attachSessionToWorkspace(ctx, run.id, cwd, 'prefetch');
            const result = await run.result;
            // fail-fast：非 completed 终止（error/cancelled/...）抛错带诊断，不做静默兜底
            if (result.stopReason !== 'completed') {
                throw new Error(`planning_prefetch: subagent ended with stopReason=${result.stopReason}${result.error ? ' — ' + result.error : ''}`);
            }
            // outputSchema 由 spawn provider 在子代理侧强制校验；structured 合法即用，文本兜底仅作能力缺失防御
            if (result.structured !== undefined)
                return JSON.stringify(result.structured);
            return (result.output ?? []).map((b) => b.text ?? '').join('');
        }
        finally {
            await run.dispose().catch(() => undefined);
        }
    };
}
/** v2 主会话工具面：/plan: 捕获规划上下文（零副作用）→ planning_checklist_save 回写 → /openspec: 用清单建链。
 *  工具面 = kanban_route + 只读 kanban 子集 + spec_card_view + planning 工具；
 *  无 spec_card_edit/approve、无 kanban_create/complete/block（主会话越权写由工具面裁剪 + prefetch 子代理只读护栏双保险）。 */
export function registerMainSessionTools(ctx, configProvider) {
    const registry = ctx.get('tools');
    if (!registry)
        return; // 测试裸 Context 无 tools 服务，跳过注册
    const provider = ctx.get('kanban');
    if (!provider)
        return;
    const service = provider.service;
    // 生产 wiring（src/index.ts）仅保证 tools+kanban 可用，无 wiki 服务 → 经 configProvider 自建
    //（与 dispatcher 构造同源，getEffective() 调用时热读取 baseUrl/pagePrefix）；测试经 ctx.get('wiki') 注入 mock 客户端。
    // 双模式：local 模式走 LocalWikiClient 本地检索（不发 HTTP），remote 用配置的 WikiVaultClient。
    const kbMode = configProvider.mode;
    const wiki = kbMode === 'local'
        ? new LocalWikiClient(ensureLocalKbRoot())
        : (ctx.get('wiki') ?? new WikiVaultClient(() => configProvider.getEffective().wikiVault));
    const caller = () => ({ actor: 'human' });
    // 只读 kanban 子集（无 create/complete/block）
    const readOnly = new Set(['kanban_show', 'kanban_chain', 'kanban_list', 'kanban_comment']);
    for (const tool of buildKanbanTools(service, caller)) {
        const name = tool.name;
        if (name && readOnly.has(name))
            registry.register(tool);
    }
    // spec_card_view 仅保留（主 agent 只读规格卡；编辑/批准经清单→/openspec: 建链，GUI 走 HTTP 桥）
    for (const tool of buildSpecCardTools(service, caller)) {
        if (tool.name === 'spec_card_view')
            registry.register(tool);
    }
    // planning 工具（清单落库 + 只读预取）——spawnPrefetch 由模块级 buildSpawnPrefetch 提供（可单测）
    for (const tool of buildPlanningTools({
        service, wiki: wiki, // local 模式为 LocalWikiClient（write/read/search 同面，双模式客户端）
        getCaller: caller,
        spawnPrefetch: buildSpawnPrefetch(ctx),
        tempDir: () => `${tmpdir()}/dsh-swarm-checklists`, // KB 不可达时的临时兜底，放系统临时目录（不落插件源码/核心存储目录）
        pagePrefix: configProvider.getEffective().wikiVault?.pagePrefix ?? 'projects/', // 生成的清单页路径保持在该客户端配置的命名空间内（避免 kb-rejected）
        kbMode: configProvider.mode, // 双模式：local 时 checklist/learning 落本地库命名空间（wiki/queries/checklists/、wiki/synthesis/learnings/）
        prefixRoutes: configProvider.getEffective().prefixRoutes,
        memoryEnabled: configProvider.getEffective().memory?.enabled ?? true,
        resolveWorkspaceDir: () => planningBySession.get('session_main')?.workspaceDir ?? null,
        flowMode: () => planningBySession.get('session_main')?.mode ?? null,
        ownerSessionId: 'session_main',
        onChecklistSaved({ ref, source, checklist }) {
            const cur = planningBySession.get('session_main') ?? { workspaceDir: null, sessionId: 'session_main', checklist: null, checklistRef: null, checklistSource: null, requirementName: null };
            planningBySession.set('session_main', { ...cur, checklist, checklistRef: ref, checklistSource: source });
        },
    }))
        registry.register(tool);
    // kanban_route：/plan: 捕获规划上下文；/openspec: 用清单建链；/sms 手动投递链报告（前缀路由注册时快照，用于工具描述）
    const { plan, openspec, learning, send } = configProvider.getEffective().prefixRoutes;
    registry.register(defineTool({
        name: 'kanban_route',
        description: `Route hub for dsh-swarm kanban workflow (NOT the built-in /plan plan mode). Two trigger forms. (1) PREFIX form — MUST be called when the human message starts with ${plan}, ${openspec}, ${learning}, or ${send}; omit intent. (2) INTENT form (swarm preset sessions) — MUST be called with intent when the human expresses: a hands-on development requirement → intent='plan'; explicit approval to start the workflow after the checklist was saved → intent='openspec'; distill/retrospect lessons from a chain → intent='learning' (message = chainId or title words, may be empty = latest chain); deliver a chain report to the WeCom group → intent='send' (block notice: prefix message with 'blocked '). When intent is set, message = the user's raw words (no prefix). Ambiguous intent → do NOT call, ask the user instead. Semantics: ${plan} = zero side-effect + start grill-me (+ auto KB memory index); ${openspec} = create chain from saved checklist; ${learning} = distill experience from a chain (evidence pack + planning_learning_save); ${send} = manually deliver a chain report to the WeCom group (bare = latest completed chain; '${send} blocked [chainId]' = resend block notice; bypasses imDelivery.enabled; the message body is composed by system code — never compose or repeat it, only relay the delivery status).`,
        parameters: { message: { type: 'string', required: true }, intent: { type: 'string', description: "swarm preset sessions: 'plan' | 'openspec' | 'learning' | 'send' — model-judged intent; omit for prefix-triggered calls" } },
        output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
        async execute(args, exec) {
            // intent 路径（蜂群模式）：handler 内部会重 parsePrefix(message)，无前缀 message
            // 会判成 none —— 因此 intent 命中时合成「前缀 + rest」消息再进 handler；handler 零改动、
            // 前缀路径零感知。intent 优先于 message 前缀；非法 intent 回退 parsePrefix（none 兜底）。
            // 简报矛盾修正：intent 命中时 message 若自带已知前缀（模型契约
            // 违例，description 明文 raw words no prefix），原样拼接会使 rest 带旧前缀 → handler 内必
            // chain-not-found → brief 断言不可能绿；故丢弃载荷只保留 intent 裸前缀
            //（learning 裸 = 最近链，与既有 '/learning' 语义一致）。raw words 正常路径与简报逐字节一致。
            const routes = configProvider.getEffective().prefixRoutes;
            const INTENTS = ['plan', 'openspec', 'learning', 'send'];
            const intent = INTENTS.includes(args.intent ?? '') ? args.intent : null;
            const trimmed = args.message.trim();
            const routeMessage = intent
                ? `${routes[intent]}${trimmed && !INTENTS.some((k) => trimmed.startsWith(routes[k])) ? ' ' + trimmed : ''}`
                : args.message;
            const plan = await handlePlanRoute(routeMessage, service, routes, 'session_main');
            if (plan.kind === 'plan') {
                const headerCwd = exec?.agent?.session?.header?.cwd ?? null;
                const workspaceDir = await resolveOrCreateWorkspace(ctx, headerCwd, '主 agent 会话');
                planningBySession.set('session_main', { workspaceDir, sessionId: 'session_main', checklist: null, checklistRef: null, checklistSource: null, requirementName: plan.rest, mode: intent ? 'swarm' : 'prefix' });
                let guidance = buildPlanningGuidance(configProvider.getEffective().prefixRoutes, { swarm: intent === 'plan' }) + KANBAN_HANDOFF_RULE(configProvider.getEffective().prefixRoutes, { swarm: intent === 'plan' });
                if ((configProvider.getEffective().memory?.enabled ?? true) && workspaceDir) {
                    const idx = await recallMemoryIndex(wiki, {
                        requirementName: plan.rest || null,
                        workspaceDir,
                        maxEntries: configProvider.getEffective().memory?.maxIndexEntries ?? 8,
                        kbMode,
                    });
                    if (idx)
                        guidance += '\n' + idx;
                }
                return { kind: 'plan', guidance };
            }
            if (plan.kind === 'learning') {
                const r = await handleLearningRoute(routeMessage, service, configProvider.getEffective().prefixRoutes, 'session_main');
                if (r.error)
                    return { kind: 'learning', error: r.error, guidance: r.guidance };
                return { kind: 'learning', chainId: r.chainId, brief: r.brief, guidance: r.guidance };
            }
            if (plan.kind === 'send') {
                // /sms 手动投递：rest 'blocked [chainId]' → 阻塞通知；其余 → 完成汇报（query = rest）。
                // 红线：消息正文由 sendChainReport 内的领域函数渲染并发送，本分支只返回投递状态（绝不含正文）。
                const rest = plan.rest;
                const variant = rest.startsWith('blocked') ? 'blocked' : 'completion';
                const query = variant === 'blocked' ? rest.slice('blocked'.length).trim() : rest;
                const r = await sendChainReport(ctx, service, configProvider, { retryDelaysMs: [] }, variant, query);
                if (r.ok) {
                    const noun = variant === 'blocked' ? '阻塞通知' : '完成汇报';
                    return {
                        kind: 'send', chainId: r.chainId, botId: r.botId, targetId: r.targetId,
                        guidance: `${noun}已投递企微群（/sms 手动触发）。请仅向用户确认投递成功与目标群，勿复述消息正文。`,
                    };
                }
                return { kind: 'send', error: r.error, guidance: r.guidance ?? '请将 error 字段原样转告用户，勿复述消息正文。' };
            }
            if (plan.kind === 'none')
                return { kind: 'none' };
            // 路由1（内存）：planningBySession 命中 → 直接建链
            const pctx = planningBySession.get('session_main');
            if (pctx?.checklist && pctx.checklistRef) {
                // 恢复补捕①：内存有清单但 workspaceDir=null（主 agent 重启后清单经 KB 恢复、异常态）→
                // 从 exec.agent.session.header.cwd 捡回工作区，路由1 继续正常建链。已有值绝不重解析
                // （不重复弹 ask，对齐下方 /plan: 分支注释顾虑）；解析 null（无 cwd/无通道/用户跳过）保持
                // 现状 → 走 handleOpenspecRoute 的 workspace-unknown fail-fast（不吞错、不猜测路径）。
                if (!pctx.workspaceDir) {
                    const headerCwd = exec?.agent?.session?.header?.cwd ?? null;
                    const workspaceDir = await resolveOrCreateWorkspace(ctx, headerCwd, '主 agent 会话（/openspec: 恢复）');
                    if (workspaceDir) {
                        pctx.workspaceDir = workspaceDir;
                        planningBySession.set('session_main', pctx);
                    }
                }
                // 闸2：清单落库的仓库与当前工作区不一致 → 硬拦不建链（KB 页路径带 repoSlug 维度的前提是链与工作区同源）
                const localPath = pctx.checklist.manifest.repo.localPath;
                if (pctx.workspaceDir && localPath !== pctx.workspaceDir) {
                    return {
                        kind: 'openspec', approved: false, reason: 'workspace-mismatch',
                        error: `[workspace-mismatch] 清单 manifest.repo.localPath (${localPath}) 与当前工作区 (${pctx.workspaceDir}) 不一致。请在目标仓库工作区内重新执行 ${configProvider.getEffective().prefixRoutes.plan} 重新澄清落库后再 ${configProvider.getEffective().prefixRoutes.openspec}（不可跳过）。`,
                    };
                }
                const input = { workspaceDir: pctx.workspaceDir, checklist: pctx.checklist, checklistRef: pctx.checklistRef, requirementName: pctx.requirementName };
                const r = await handleOpenspecRoute(routeMessage, service, configProvider.getEffective().prefixRoutes, input, 'session_main');
                // 护栏拦截（如 workspace-unknown）：透传失败原因与恢复指引，不得伪装成建链成功
                if (r.approved === false || !r.chainId || !r.specCardId) {
                    return { kind: 'openspec', approved: false, reason: r.reason ?? 'unknown', guidance: r.guidance };
                }
                return {
                    kind: 'openspec', chainId: r.chainId, specCardId: r.specCardId, approved: true, firstCard: r.firstCard,
                    guidance: KANBAN_HANDOFF_RULE(configProvider.getEffective().prefixRoutes, { swarm: planningBySession.get('session_main')?.mode === 'swarm' }) + '\n\n' + buildOpenspecNarrationRule({ chainId: r.chainId, specCardId: r.specCardId, firstCard: r.firstCard }),
                };
            }
            // 路由2（知识库）：内存丢失（插件重启）→ 搜 KB 候选清单页供 LLM 读页重建；搜不到/不可达 → 两条路皆空
            // 恢复补捕②：无内存条目或工作区未捕获 → 从 header.cwd 捡回，写入 planningBySession（checklist 等
            // 字段保持 cur 或空缺省），后续 planning_checklist_save 触发 onChecklistSaved 的 { ...cur } 展开自然
            // 带上 workspaceDir。解析失败不阻塞恢复 guidance 返回（行为同现状，只是少捕一次）。
            if (!planningBySession.get('session_main')?.workspaceDir) {
                const headerCwd = exec?.agent?.session?.header?.cwd ?? null;
                const workspaceDir = await resolveOrCreateWorkspace(ctx, headerCwd, '主 agent 会话（/openspec: 恢复）');
                if (workspaceDir) {
                    const cur = planningBySession.get('session_main') ?? { workspaceDir: null, sessionId: 'session_main', checklist: null, checklistRef: null, checklistSource: null, requirementName: null };
                    planningBySession.set('session_main', { ...cur, workspaceDir });
                }
            }
            let candidates = [];
            try {
                candidates = await searchChecklists(wiki, kbMode === 'local' ? LOCAL_CHECKLIST_PREFIX : (configProvider.getEffective().wikiVault?.pagePrefix ?? 'projects/'));
            }
            catch { /* KB 不可达/搜索失败 → 候选为空，走两条路皆空分支 */ }
            return {
                kind: 'openspec', approved: false, reason: 'no-checklist',
                recovery: candidates.length > 0 ? 'kb' : 'none',
                checklistCandidates: candidates,
                guidance: candidates.length > 0 ? RECOVERY_KB_GUIDANCE(configProvider.getEffective().prefixRoutes, candidates) : RECOVERY_NONE_GUIDANCE(configProvider.getEffective().prefixRoutes),
            };
        },
    }));
    console.info('[dsh-swarm] main-session tools registered (v2: kanban_route + planning + spec view + read-only kanban)');
}
