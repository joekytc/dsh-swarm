import { installRoleTools } from '../roles/toolsets.js';
import { resolveTaskParents } from '../domain/task-parents.js';
import { missingParentDelivery } from '../domain/delivery-contract.js';
import { buildRepoSlug } from '../domain/memory.js';
import { toolArgs, toolName, replayModel } from './session-events.js';
import { buildModelCandidates, isModelUnavailableError } from './model-candidates.js';
import { attachSessionToWorkspace, resolveOrCreateWorkspace } from './workspace-attach.js';
export const R20_PHASE_ORDER = ['p', 'pt', 'w2', 'd', 'dt', 'w3', 'summary'];
/** 每 phase 的期望建卡（pt 由 P 交付 pt_decision.needed=true 触发；dt 固定）。 */
export const R20_PHASE_EXPECT = {
    p: { assignee: 'p', mode: 'openspec' },
    pt: { assignee: 'pt', mode: 'review-plan' }, // 由 P 交付 pt_decision.needed=true 触发（需计划评审才进入）
    w2: { assignee: 'w', mode: 'kb' },
    d: { assignee: 'd', mode: 'execute' }, // R20：D=执行者（实际写代码/git 提交推送），非只读对齐/校验
    dt: { assignee: 'dt', mode: 'review-impl' }, // 固定：D 之后必经实现校验+评审
    w3: { assignee: 'w', mode: 'kb' },
    summary: null,
};
/** M5：每阶段建卡的 body 生成指令（角色定位确定性模板，消除 V 自由发挥导致的角色漂移）。
 *  P=计划者（绝不执行）、D=唯一执行者（TARGET_REPO 必须取自规格卡 file-prefetch 附件 ref，禁止回退/猜测）、
 *  W=KB 同步（绝不执行代码）。V 把对应模板写入 kanban_create 的 body。 */
export const PHASE_INSTRUCTIONS = {
    p: [
        '## P 阶段任务体要求（计划者，非执行者）',
        'body 写入规划指令：读规格卡（含 file-prefetch/kb 附件=需求澄清清单）→ 产出 openspec 实施计划。仓库事实不足时先只读自查仓库代码实证（fs/search/grep 均可），再产出计划。',
        '产物路径（OpenSpec 规范）：写入目标仓库 `openspec/changes/<change_name>/` 下 proposal.md / design.md / tasks.md（change_name 依规格自拟 kebab-case，如 autoNote-tab）；complete 时 metadata.artifacts_path = 该目录绝对路径。',
        'tasks.md 拆分粒度（结构准备度，与 PT 同一判据）：每个任务条目必须有单一、可独立核对的完成判据；禁止一条任务/一条测试用例混 N≥2 个互不依赖的可观察结果——按可独立验证的行为逐条拆分。',
        'proposal.md 必须含「上游协议遵循说明」节：逐条列规格卡/澄清清单声明的工程协议引用（可定位出处：路径/明确协议名）+ 计划如何遵守；未声明任何协议则该节写「无」。禁止引用规格卡之外的协议标准。',
        '铁律：P 是计划者，绝不执行任何 git/worktree/commit/push、不改源码/README、不跑构建部署——执行是 D 的职责；只读自查仅限读仓库，写边界仅限 openspec/changes/ 目录（会话工具级硬护栏强制，其余一律只读）。',
        'complete 时 metadata 必须带 schema 合法的 pt_decision = { needed: boolean, reason?: string }（needed=true 时 reason 必填）。按下列复杂度清单判定（逐条勾选，禁止"感觉"）：',
        '  needed=true（需 PT 计划评审），满足任一条：① 跨 ≥2 模块/目录，或改动公共接口/共享类型/配置文件；② 破坏性变更（对外 API、数据格式、迁移、兼容性）；③ impl_decisions 含 ≥2 个互斥方案需仲裁；④ tasks ≥8 条，或含新增/重写核心模块；⑤ 涉安全/权限/并发/数据迁移等高风险面；⑥ OpenSpec change 中 specs/ 模块的 spec.md 文件数 ≥3。',
        '  needed=false（免评审），须全部满足：① 单文件/单模块小改动、无公共接口变更；② 无破坏性变更、无外部依赖变更；③ 方案唯一无仲裁点、tasks<8；④ 无安全/权限/并发/迁移风险；⑤ specs/ 模块 spec.md <3。',
        '仓库事实经只读自查后仍不足（关键目标文件缺失或仓库路径未实证）时，禁止编造计划——调用 kanban_block，reason 带 kb-insufficient，等主 agent 补清单后恢复。',
    ].join('\n'),
    pt: [
        '## PT 阶段任务体要求（计划评审，只读）',
        'body 写入计划评审指令：P 已判定需要计划评审（理由见上）。只读评审 P 的计划产物，按五要素核对：需求对齐（澄清清单条目↔任务双向映射，不遗漏不超纲）/完整性/逻辑交互一致性/结构准备度（每任务条目单一、可独立核对的完成判据；混 N≥2 个互不依赖的可观察结果=混行为须拆分）/工程协议一致性（只对账 proposal「上游协议遵循说明」节，未声明协议不得自行引入）。输出 verdict+issues 入交接 metadata.review_evidence。',
        'issues 四要素缺一无效：location（哪条任务/哪节）+ 依据（上游声明引用或计划内部矛盾点）+ 问题 + 可执行建议；pass 时 issues 只放非阻塞建议。',
        '返工复审：body 含「上一轮评审未通过 issues」节时必须先逐条三态对账（已修复/未修复/部分修复），未修复旧 issue 原样沿用，再提新问题。',
        '评审闸硬要求（必须写入 body）：complete 时 handoff metadata 顶层必须带 artifacts_path=<被评审计划的 openspec 目录绝对路径，直接继承被评审 P 卡 handoff 里的 artifacts_path 值>，或在 review_evidence 里给 reviewPage；review_evidence 形状不变（{ verdict, issues, ...reviewPage 可选 }）——两者都缺时评审闸拒绝 pass。',
        '铁律：PT 是只读评审角色，绝不修改任何产物/源码；不调用 kanban_create、不执行代码。',
    ].join('\n'),
    w2: [
        '## W2 阶段任务体要求（KB 同步）',
        'body 写入 KB 同步指令：读父任务交接（P 产物路径）→ wiki_write 同步为项目页（pagePath 必须逐字等于下方「KB 页路径规则」给出的路径）→ complete(kb_url, page_path)。禁止任何 git/代码操作。',
    ].join('\n'),
    d: [
        '## D 阶段任务体要求（执行者，唯一，非只读对齐/校验）',
        'body 写入执行指令：先读父任务交接（W2）里的 page_path/kb_url，用 wiki_read 读取 openspec 实施计划原文，再按计划执行规格卡 solution/testing —— git worktree/branch → 改代码/README → git commit → git push（仅 feature 分支，可选）→ 自检（跑测试/构建）并附产物证据（changed_files/commit_hash）。',
        'body 第一行以 TARGET_REPO=<真实仓库绝对路径> 声明目标仓库：必须取自规格卡 file-prefetch 附件 ref，禁止写 kanban 存储目录、禁止猜测回退。',
        'body 同时声明 TARGET_BRANCH=<目标分支名>（来自规格卡/用户声明）：D 在 worktree feature 分支完成实现并验证后即 complete，禁止合并回 TARGET_BRANCH、禁止推 TARGET_BRANCH——合入由 DT 通过后 system 统一执行。',
        'complete 时 metadata 必须带 branch=<feature 分支名>（DT 评审与 system 合入定位该分支用）；git 证据 changed_files + commit_hash 必须（push 可选，可推 feature 分支）。',
        'complete 时 metadata 建议携带 worktree_dir=<你的 feature worktree 绝对路径>：系统将在该目录实测 tdd.test_files（npx vitest run）；缺失则跳过实测（仅声明校验）。',
        '禁止把 D 任务体写成"只读对齐/校验/审核"类措辞——D 是唯一执行者，必须实际改代码并提交推送。',
        'TDD 硬要求：JS/TS/JSX/Vue 项目测试固定用 vitest（`npx vitest run`），先写测试（RED）再实现（GREEN），测试可与实现同提交但须不晚于实现进入 git 历史（DT 用 `git log --reverse` 核验）；complete 时 metadata 必须带 tdd = { test_files: [...], test_first: bool }；纯文档/配置变更则带 tdd = { skipped: { reason } }。',
        '上下文含「评审遗留建议」节时：把该节原文完整复制进 D 卡 body 末尾「评审遗留建议」节（不得删改、不得省略）；上下文无该节则 body 不含该节。',
    ].join('\n'),
    dt: [
        '## DT 阶段任务体要求（实现校验+评审，只读护栏）',
        'body 写入实现校验指令：对 D 产物实证校验（test/build/typecheck/diff/git 证据 + open-code-review 评审），输出 verdict+issues 入交接 metadata.review_evidence。评审目标为 D 交接 metadata.branch 指向的 feature 分支（ocr review --from <TARGET_BRANCH> --to <branch>），而非 TARGET_BRANCH。',
        '铁律：DT 是只读校验+评审角色，绝不修改源码/产物；校验经 ToolGuard 硬性只读护栏；不注入 git 凭据。',
    ].join('\n'),
    w3: [
        '## W3 阶段任务体要求（KB 收尾同步）',
        'body 写入 KB 收尾同步指令：读 D 交接 → wiki_write 同步（pagePath 必须逐字等于下方「KB 页路径规则」给出的路径）→ complete(kb_url)。禁止任何 git/代码操作。',
    ].join('\n'),
};
/** D9（W 角色知识库双模式）：按 kbMode 构建各阶段建卡 body 指令（phase 键控——W2/W3 同为
 *  assignee='w'+mode='kb'，assignee+mode 签名无法区分两相文案；系统状态本就按 phase 键控）。
 *  remote → PHASE_INSTRUCTIONS 原文（护栏测试零改动前提）；local → 覆盖 w2/w3/d/dt 四相
 *  （skill 工具加载 llm-wiki + 本地库 fs 读写，禁 wiki_write/wiki_read），p/pt/summary 原样回落。
 *  ctx.taskId 给出则插值确切页路径，缺省用占位符（建卡时 taskId 尚不存在，消费点传 undefined）。 */
export function buildPhaseInstruction(phase, ctx, kbMode) {
    if (kbMode !== 'local')
        return PHASE_INSTRUCTIONS[phase] ?? '';
    const pagePath = `wiki/sources/${ctx.chainId}/${ctx.taskId ?? 't_<你的任务ID>'}.md`;
    switch (phase) {
        case 'w2':
            return `读父任务交接（P 产物路径）→ 经 skill 工具加载 llm-wiki，将实施计划写入本地库 ${pagePath} → complete(kb_url="", page_path=<库根下相对路径>)。禁止任何 git/代码操作。`;
        case 'w3':
            return `读 D 交接 → 经 skill 工具加载 llm-wiki，将执行结果同步至本地库 ${pagePath} → complete(kb_url="", page_path=...)。禁止任何 git/代码操作。`;
        case 'd':
            return '先读父任务交接（W2）里的 page_path（本地库 wiki/sources/ 下相对路径，库根见运行时上下文注入——Task 8 已注入 D），直接 fs 读实施计划原文；如需 KB 经验召回，经 skill 工具加载 llm-wiki query（本地库；kanban-d preset 已挂 tool-skill）——再按计划执行规格卡 solution/testing —— git worktree/branch → 改代码/README → git commit → git push（仅 feature 分支，可选）→ 自检并附产物证据（changed_files/commit_hash）。其余 TDD/TARGET_REPO/TARGET_BRANCH 等要求与 remote 版一致。';
        case 'dt':
            return `对 D 产物实证校验（test/build/typecheck/diff/git 证据 + open-code-review 评审），输出 verdict+issues 入交接 metadata.review_evidence。评审页经 fs 写本地库 <库根>/wiki/queries/${ctx.chainId}/review/<name>.md（库根见运行时上下文注入——Task 8 已注入 DT）；库根外一律只读，其余铁律与 remote 版一致。`;
        default:
            return PHASE_INSTRUCTIONS[phase] ?? '';
    }
}
/** 提取 P 交接里 pt_decision 的 reason（PT 阶段注入 V context，供 PT 卡 body 引用评审理由）。 */
function extractPtReason(state, chainId) {
    const pTask = [...state.tasks.values()].find((t) => t.chainId === chainId && t.assignee === 'p' && t.mode === 'openspec');
    const d = (pTask ? state.handoffs.get(pTask.id)?.metadata?.['pt_decision'] : undefined);
    return typeof d?.reason === 'string' ? d.reason : '';
}
/** 评审 issues 统一格式化（对账/遗留建议注入用）：`- [severity] title — detail（location）`。 */
function formatIssues(issues) {
    return issues
        .map((i) => `- [${i.severity ?? 'info'}] ${i.title ?? ''} — ${i.detail ?? ''}${i.location ? `（${i.location}）` : ''}`)
        .join('\n');
}
/** 最近一次 PT review/passed 的 issues（pass 时即非阻塞建议留档）：建 D 卡时注入「评审遗留建议」。
 *  取事件 payload.evidence（recordReview 落盘），按 reviewTaskId 回查任务确认 pt/review-plan 归属。 */
function extractPtPassSuggestions(state, chainId) {
    const passed = [...state.events]
        .filter((e) => e.kind === 'review/passed')
        .map((e) => ({ e, rt: state.tasks.get(String(e.payload['reviewTaskId'] ?? '')) }))
        .filter(({ rt }) => !!rt && rt.chainId === chainId && rt.assignee === 'pt' && rt.mode === 'review-plan')
        .at(-1);
    const ev = passed?.e.payload['evidence'];
    return Array.isArray(ev?.issues) ? ev.issues : [];
}
/** 仅评审卡：archived 且从未处理过 verdict = 作废（void）。human 归档评审卡即作废，编排器视其不存在。
 *  非评审卡（p/d/w…）一律返回 false——避免 B6 误判"该阶段无卡"而重复建卡。 */
const REVIEW_MODES = ['review-plan', 'review-impl'];
function isVoidReview(task, events) {
    if (task.status !== 'archived')
        return false;
    if (!REVIEW_MODES.includes(task.mode))
        return false; // 非评审卡不判 void
    return !events.some((e) => e.taskId === task.id && (e.kind === 'review/passed' || e.kind === 'review/failed' || e.kind === 'review/gave-up'));
}
/** Task 4（V 会话注入加固）：V 会话身份标记——setup 完整成功（kanban-v preset mount + 角色工具面）后
 *  写入，live 复用前校验。与 agent-runner.ts roleCompositions 同款机制（进程内 WeakMap 按 incarnation
 *  键控：GUI 重开同名会话/宿主自建 incarnation 查不到标记 → 拒绝盲复用；实例回收标记随 GC 消失）。
 *  不直接复用其 WeakMap：其 marker 结构 {role,taskId} 面向任务会话（V 无 taskId），读取端未导出，
 *  导出需改 agent-runner.ts（本任务硬约束禁止）。 */
const vSessionCompositions = new WeakMap();
const V_SESSION_PRESET_ID = 'kanban-v';
export class VOrchestrator {
    ctx;
    kanban;
    agents;
    configProvider;
    orchestrations;
    wiki;
    defaultModel;
    constructor(ctx, kanban, agents, configProvider, orchestrations, wiki, defaultModel) { this.ctx = ctx; this.kanban = kanban; this.agents = agents; this.configProvider = configProvider; this.orchestrations = orchestrations; this.wiki = wiki; this.defaultModel = defaultModel; }
    currentPhase(chainId) {
        let o = this.orchestrations.get(chainId);
        if (!o) {
            o = { chainId, phase: 'p', sessionId: null, waitingOn: null };
            this.orchestrations.set(chainId, o);
        }
        return o;
    }
    /** Fix D：stall 自动再唤醒上限（同一阶段连续零产出 → 自动重试 ≤3 次，间隔递增）后放弃并显形。 */
    static STALL_REWAKE_LIMIT = 3;
    /** Fix D：stall 再唤醒基础延迟（按 stallCount 倍增：5s/10s/15s），给瞬时故障/采样波动恢复窗口。 */
    static STALL_REWAKE_DELAY_MS = 5_000;
    rewakeTimers = new Map();
    /** 同链 wakeV 并发防护：在途时后续唤醒合并为 pending，完成后补跑一次（事件不丢）。 */
    waking = new Set();
    pendingWake = new Set();
    /** Fix D：orchestration 变更回调（dispatcher 注入 saveOrchs）——stall re-wake 路径绕过
     *  EventWaker，其 stallCount/phase 变化需自行落盘，防重启丢重试进度。 */
    onOrchChange;
    async wakeV(chainId) {
        if (this.waking.has(chainId)) {
            this.pendingWake.add(chainId);
            return;
        }
        this.waking.add(chainId);
        try {
            await this.wakeVInner(chainId);
        }
        finally {
            this.waking.delete(chainId);
            if (this.pendingWake.delete(chainId)) {
                queueMicrotask(() => { this.wakeV(chainId).catch(() => { }); });
            }
        }
    }
    /** Fix D：stall 自动再唤醒（≤3 次）。同链 pending 幂等；建卡成功（stallCount=0）后到期的
     *  re-wake 自动作废（回调内按 stallCount 判空跳过）。 */
    scheduleRewake(chainId, stallCount) {
        if (this.rewakeTimers.has(chainId))
            return;
        const delay = VOrchestrator.STALL_REWAKE_DELAY_MS * stallCount;
        const timer = setTimeout(() => {
            this.rewakeTimers.delete(chainId);
            const orch = this.orchestrations.get(chainId);
            if (!orch || (orch.stallCount ?? 0) === 0)
                return; // 已建卡成功 → 作废
            this.wakeV(chainId).catch((err) => console.error('[dsh-swarm][debug] stall re-wake failed chain=' + chainId + ': ' + String(err)));
        }, delay);
        this.rewakeTimers.set(chainId, timer);
    }
    /** Fix D：清理待触发的 re-wake 定时器（插件 dispose 时调用）。 */
    dispose() {
        for (const t of this.rewakeTimers.values())
            clearTimeout(t);
        this.rewakeTimers.clear();
    }
    /** 链级看门狗（Dispatcher，防线①）探针：编排 entry；无 entry 返回 null。 */
    orchestrationOf(chainId) {
        return this.orchestrations.get(chainId) ?? null;
    }
    /** 链级看门狗探针：该链是否有在途唤醒 / 待补跑唤醒 / 待触发再唤醒——任一为真视为「有人在管」。 */
    isWakeInFlight(chainId) {
        return this.waking.has(chainId) || this.pendingWake.has(chainId) || this.rewakeTimers.has(chainId);
    }
    /** 链级看门狗重唤醒入口（Dispatcher 防线①）：复用 wakeV（同链并发合并/补跑幂等内建）。 */
    wake(chainId) {
        return this.wakeV(chainId);
    }
    async wakeVInner(chainId) {
        const orch = this.currentPhase(chainId);
        if (orch.phase === 'summary')
            return; // 链完成由 completeTask 机械规则产生
        const state = await this.kanban.snapshot();
        const chain = state.chains.get(chainId);
        if (!chain)
            throw new Error('unknown chain: ' + chainId);
        const specCard = chain.specCardId ? state.specCards.get(chain.specCardId) : null;
        if (chain.status === 'completed' || chain.status === 'aborted' || chain.status === 'blocked')
            return;
        // 阻塞复核 pass（全量阻塞恢复）：链上有 status=blocked 且尚无 [blocked-review] 复核评论的任务
        // → 向 V 发一轮阻塞复核（本轮 V 唯一动作），V 用 kanban_comment 以 [blocked-review] 开头逐一
        // 评论给方向后待命；无此类任务则正常推进。扩展为所有 blocked（含 kb-insufficient 等），
        // 幂等由 hasBlockReview 保证（每次阻塞至多一轮复核评论，blocked→unblocked→再 blocked
        // 因新 block 事件 seq 更新才重新评论）。置于 B4 门控之前：即使规格卡未批准（planning/draft），
        // 阻塞也可复核（恢复不依赖批准）。
        const blockedReview = [...state.tasks.values()].filter((t) => {
            if (t.chainId !== chainId || t.status !== 'blocked')
                return false;
            return !this.hasBlockReview(state, t);
        });
        if (blockedReview.length > 0) {
            const agent = await this.getVAgent(orch);
            const taskList = blockedReview.map((t) => {
                const lastBlock = [...state.events].reverse().find((e) => e.taskId === t.id && e.kind === 'task/blocked');
                return `${t.id} ${t.assignee}/${t.mode} blocked (reason: ${String(lastBlock?.payload['reason'] ?? '')})`;
            }).join('\n');
            const context = [
                '# V 编排轮次（阻塞复核）',
                `chain=${chainId}`,
                '## 阻塞任务',
                taskList,
                '## 立即动作（本轮唯一任务）',
                '对上述每个阻塞任务调用 kanban_comment 评论，正文以 [blocked-review] 开头给出协调方向：阻塞原因 + 阶段应交付 + 建议修复方向。',
                'gave_up 任务说明链路已停止，建议查看对应 [blocked-final] 证据链（block 时间线 + 复核/评论时间线 + 最终原因），给出终态解释。',
                '规则：只评论、不建卡、不改任务状态；已有 [blocked-review] 评论的任务不要重复评论。',
            ].join('\n\n');
            agent.followup({ content: [{ type: 'text', text: context }], source: { kind: 'user' } });
            await agent.whenIdle();
            return; // 本轮 V 唯一动作是阻塞复核，不再推进阶段
        }
        // B4 阶段门控：V 仅规格卡 approved（链 executing）后才行动（从 p 起跑建执行链卡）；
        // draft/planning 时 V 待命，等 spec-card/approved 事件唤醒（event-waker 已订阅）。
        const approved = chain.status === 'executing' && specCard?.status === 'approved';
        if (!approved)
            return;
        // 阶段推进循环（修复轮 6，举一反三）：跳过已完成（终态卡）阶段，
        // 停在需要建卡的阶段建卡并推进；避免「推进 phase 后不建下一卡」造成的流水线停滞。
        for (;;) {
            // B4 阶段门控（每轮按当前 phase 重查）：V 仅 approved 后行动（chain/executing 已确认）。
            const approvedHere = chain.status === 'executing' && specCard?.status === 'approved';
            if (!approvedHere)
                return;
            // pt 按需跳过：P 交付 pt_decision.needed=false → 不进 PT，直接推进 w2；needed=true/缺失 → 建 PT 卡。
            // 判定输入 = P(openspec) 卡的完成交接 metadata.pt_decision（V 只执行建卡、不自行判断）。
            // 仅当链上尚无 PT 卡（首次进入）时判定；已有 PT 卡（在途/终态，含复审卡）不再判定，
            // 由下方评审卡 completed 分流处理（pass→推进 / fail→返工），避免复审被误跳过。
            if (orch.phase === 'pt') {
                const fresh = await this.kanban.snapshot();
                const hasPtCard = [...fresh.tasks.values()].some((t) => t.chainId === chainId && t.assignee === 'pt' && t.mode === 'review-plan' && !isVoidReview(t, fresh.events));
                if (!hasPtCard) {
                    // 取「最新」P(openspec) 卡判定（at(-1)）：原 P(done) + 返工 P(blocked) 并存时，
                    // 首卡 find 会误取已 done 的原 P → 闸漏拦。最新卡为准，防 P blocked 时仍建 PT。
                    const pTask = [...fresh.tasks.values()]
                        .filter((t) => t.chainId === chainId && t.assignee === 'p' && t.mode === 'openspec')
                        .at(-1);
                    // 阻塞闸（修复 P blocked 时仍建 PT）：P(openspec) 未 done（blocked/running/failed/todo）时，
                    // 无计划产物可评审，盲目建 PT 只会空转浪费 token。此时把阻塞/未完成状态提给主 agent
                    // （system 评论，含 kb-insufficient 等 reason），等 P 恢复 done 后再建 PT。
                    if (pTask && pTask.status !== 'done' && pTask.status !== 'archived') {
                        if (pTask.status === 'blocked') {
                            const lastBlock = [...fresh.events].reverse().find((e) => e.taskId === pTask.id && e.kind === 'task/blocked');
                            const reason = lastBlock ? String(lastBlock.payload['reason'] ?? '') : '';
                            await this.kanban.comment(pTask.id, `[blocked-p] P 任务 ${pTask.id} 处于 blocked，暂不创建 PT 卡（避免无产物空转）。阻塞原因：${reason || '(未知)'}。请主 agent 处理后 unblock，P 恢复 done 后再评审。`, 'system');
                        }
                        return; // 等 P 终态（不建 PT、不推进 phase）
                    }
                    const pHandoff = pTask ? fresh.handoffs.get(pTask.id) : null;
                    const decision = pHandoff?.metadata?.['pt_decision'];
                    if (decision && decision.needed === false) {
                        orch.phase = this.advance(orch.phase);
                        orch.waitingOn = 'task/completed';
                        continue;
                    }
                }
            }
            const expect = R20_PHASE_EXPECT[orch.phase];
            if (expect === null)
                return; // summary：不再建卡
            const chainTasks = [...state.tasks.values()].filter((t) => t.chainId === chainId);
            const terminal = ['done', 'archived'];
            // 评审阶段（pt/dt）：已完成评审卡按 verdict 分流——
            //   pass → recordReview(passed)+推进下一阶段；fail → recordReview(failed)+返工（新评审卡）或超限 gave-up。
            if (orch.phase === 'pt' || orch.phase === 'dt') {
                const reviewCards = chainTasks.filter((t) => t.assignee === expect.assignee && t.mode === expect.mode && !isVoidReview(t, state.events));
                const latest = reviewCards.at(-1);
                if (latest && !terminal.includes(latest.status))
                    return; // 有在途评审卡 → 待命
                if (latest && terminal.includes(latest.status)) {
                    const outcome = await this.handleReviewCompletion(chainId, orch, latest, state);
                    if (outcome === 'advanced') {
                        orch.phase = this.advance(orch.phase);
                        orch.waitingOn = 'task/completed';
                        continue; // pass：推进 phase 后继续循环建下一阶段卡
                    }
                    return; // rework/gave-up：phase 不变，等返工链（不推进）
                }
                // 无评审卡 → 建卡（走下方通用建卡路径，但建卡后不推进 phase）
            }
            // B6 幂等：当前 phase 期望卡（R20_PHASE_EXPECT 匹配 assignee+mode）已存在且未终态 → 不重复建卡直接待命
            // （防插件重启后重复建卡、V 一轮连发多卡）。
            const existing = chainTasks.find((t) => t.assignee === expect.assignee && t.mode === expect.mode && !isVoidReview(t, state.events));
            if (existing && !terminal.includes(existing.status))
                return;
            // 仅当当前 phase 的 (assignee,mode) 在整个 R20 序列唯一时，"已终态 existing 卡 = 本阶段自己的卡已完成"
            // 才成立；w2/w3 同为 (w,kb) 时 existing 可能是上一阶段（w2）的卡，不能据此推进（否则 w3 被误跳过）。
            const sameExpectCount = R20_PHASE_ORDER.filter((p) => {
                const e = R20_PHASE_EXPECT[p];
                return e !== null && e.assignee === expect.assignee && e.mode === expect.mode;
            }).length;
            if (existing && terminal.includes(existing.status) && sameExpectCount === 1) {
                // 该阶段工作已完成但 phase 未推进（firstMatch 历史缺陷等）→ 直接推进并继续循环建下一阶段卡
                orch.phase = this.advance(orch.phase);
                orch.waitingOn = 'task/completed';
                continue;
            }
            // 语义父任务：从链上已终态任务推断当前阶段的输入来源（如 pt→p、w2→p、d→w2、dt→d），
            // 使 V 建卡显式携带 parents；即便 V 漏填，createTask 兜底也会自动补上（双保险）。
            const parents = resolveTaskParents(state.tasks.values(), chainId, expect.assignee, expect.mode);
            // 前置校验（上游对下游负责，举一反三）：建下游卡前确认各语义父卡已交付其阶段关键交付物
            // （如 D 依赖 W2 的 kb_url+page_path）。父卡能到此步必然终态（done/archived）——completeTask
            // 交付契约闸已对所有 actor（含 human 强制收尾）在完成时拦截（缺交付物会先被标 blocked，
            // 不会被 resolve 成父卡），故此处仅剩 legacy（改闸前已落盘的 done-but-missing）。done 不可变、
            // 不能重标 blocked，发 system 评论记录断裂并停住：不建下游卡、不推进 phase，避免拖到下游执行时才报错。
            // D9：透传当前 baseUrl（local 模式为 '' → strict local 分支认可 kb_url="" 交付）；
            // wikiVault?. 防护测试 stub（getEffective() 返回 {} 时回退 undefined=宽松，行为同旧）。
            const missingParents = missingParentDelivery(state, parents, this.configProvider.getEffective().wikiVault?.baseUrl);
            if (missingParents.length > 0) {
                for (const mp of missingParents) {
                    await this.kanban.comment(mp.taskId, `[delivery-required] 上游 ${mp.assignee}/${mp.mode} 缺关键交付物：${mp.missing.join(', ')}，下游 ${expect.assignee}/${expect.mode} 卡未创建，请补交交付物或人工处理。`, 'system');
                }
                return;
            }
            // PT 阶段注入 P 判定需要计划评审的理由（供 V 写入 PT 卡 body 引用评审上下文）
            const ptReason = orch.phase === 'pt' ? extractPtReason(state, chainId) : '';
            // 2026-09-03 P/PT 定位决议：D 卡创建上下文注入 PT pass 留档的非阻塞建议（评审遗留建议随卡传递）。
            const ptSuggestions = orch.phase === 'd' ? extractPtPassSuggestions(state, chainId) : [];
            // Task 7：KB 页路径规则（W2/W3 wiki_write pagePath 确定性下发）——repoSlug 由链 workspaceDir 派生，
            // V 不需计算，直接把路径模板写入建卡 context；链无 workspaceDir 时注入空串（不拦截建卡）。
            const kbPageRoot = chain?.workspaceDir ? `projects/${buildRepoSlug(chain.workspaceDir)}` : null;
            const context = [
                '# V 编排轮次（R20 逐阶段创建）',
                `chain=${chainId} phase=${orch.phase}`,
                `NEXT_TASK_ASSIGNEE=${expect.assignee} MODE=${expect.mode}`,
                `PARENT_DEPS=${parents.length > 0 ? parents.join(',') : '(无)'}`,
                // M5：D 阶段额外注入 testing 段（执行指令依赖 solution/testing）；附件 ref 供 V 取真实仓库路径写 TARGET_REPO
                specCard ? `## 规格卡\n${specCard.sections.problem}\n${specCard.sections.solution}${orch.phase === 'd' ? '\n' + specCard.sections.testing : ''}\n附件：${specCard.attachments.map((a) => `${a.kind}:${a.ref}`).join(' | ') || '(无)'}` : '',
                '## 当前任务\n' + [...state.tasks.values()].filter((t) => t.chainId === chainId)
                    .map((t) => {
                    const lastBlock = [...state.events].reverse().find((e) => e.taskId === t.id && e.kind === 'task/blocked');
                    const reason = t.status === 'blocked' && lastBlock ? ` (${String(lastBlock.payload['reason'] ?? '')})` : '';
                    return `${t.id} ${t.assignee}/${t.mode} ${t.status}${reason}`;
                }).join('\n'),
                ((orch.stallCount ?? 0) > 0
                    ? `(rewake-nonce: ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}——系统再唤醒标记，与任务无关，忽略本行)`
                    : ''),
                '## 立即动作（本轮唯一任务）',
                `调用 kanban_create 创建本阶段唯一任务卡：chainId=${chainId}，assignee=${expect.assignee}，mode=${expect.mode}，parents=${JSON.stringify(parents)}，title 自拟（按本阶段语义命名），body 按下述阶段要求撰写。`,
                (kbPageRoot
                    ? `## KB 页路径规则（W2/W3 wiki_write pagePath 固定格式）\n${kbPageRoot}/ch_${chainId}/t_<新建卡id>.md（repoSlug=${kbPageRoot.slice('projects/'.length)}，系统由链 workspaceDir 派生；W2/W3 均用本链此规则，禁止自造路径）`
                    : ''),
                buildPhaseInstruction(orch.phase, { chainId: orch.chainId }, this.configProvider.mode),
                (ptReason ? '## P 判定需要计划评审的理由\n' + ptReason : ''),
                (ptSuggestions.length > 0
                    ? '## 评审遗留建议（PT 评审 pass 留档，非阻塞；原文完整复制进 D 卡 body 末尾「评审遗留建议」节，不得删改省略）\n' + formatIssues(ptSuggestions)
                    : ''),
                '规则：只创建一张卡（上一阶段完成事件后才进入下一阶段）；禁止跨阶段并行；禁止自己实现任务；不要调用 kanban_heartbeat/kanban_list 探测（看板状态已在上文给出）。',
            ].join('\n\n');
            let agent = null;
            let turnError = null;
            try {
                agent = await this.getVAgent(orch);
                agent.followup({ content: [{ type: 'text', text: context }], source: { kind: 'user' } });
                await agent.whenIdle();
            }
            catch (err) {
                // 防线④：异常收场 = 本轮零产出的一种形态（2026-09-04 mtmgp81q：异常逃出本函数
                // 被 dispatcher 吞掉，Fix D stall 计数整段被跳过 → 链静默死锁）。在此并入 stall 计数。
                // Task 4：getVAgent 也纳入——preset mount fail-fast / resume live 冲突等「获取会话失败」
                // 与 turn 执行异常同收场（计 stall → scheduleRewake → 超限 [create-failed] + blockChain）。
                turnError = err;
                console.error('[dsh-swarm][debug] V turn error (treated as zero-output) chain=' + chainId + ' phase=' + orch.phase + ': ' + String(err));
            }
            // R4 建卡数量硬闸：本轮只允许一张期望匹配卡推进 phase——取第一张匹配卡，其余建卡不推进
            // （提取 kanban_create 调用；假实现从会话事件取，真实实现同名）。
            // 修复轮 6：session.events 条目形态为 {type, data:{name, arguments}}，name 在 data 下且
            // arguments 是 JSON 字符串——统一经 toolName/toolArgs（src/dispatcher/session-events.ts）读取。
            const creates = turnError || !agent
                ? []
                : agent.session.events.filter((e) => toolName(e) === 'kanban_create');
            const firstMatch = creates.find((e) => {
                const a = toolArgs(e);
                return a.assignee === expect.assignee && a.mode === expect.mode;
            });
            // 建卡失败防护（Fix D）：V 本轮未产生期望卡（assignee+mode 不匹配）→ 记 stall 轮次并自动再唤醒
            // 重试（≤3 次，间隔 5s/10s/15s 递增——覆盖采样波动/瞬时故障，2026-09-02 倒计时链实测：V 首轮
            // 只出文本不调工具、第二轮重放即正常建卡）；超过上限 → 放弃：在链上锚点卡（最近终态卡，无则
            // 最新卡）发 [create-failed] system 评论显形（幂等：已有该评论则不再发）+ blockChain 链级终态
            // blocked（防线A：零任务链也有数据侧终态，人工恢复=删链重跑）。零任务无锚点可评论 →
            // 落 console.error（无任务卡载体，auditWarning 语义不符不用），orchestration.json 已留 stallCount。
            if (!firstMatch) {
                const fromCache = !turnError && agent !== null && agent.session.events.some((e) => replayModel(e) === 'from-cache');
                if (fromCache) {
                    console.error('[dsh-swarm][debug] V turn replayed from gateway cache (from-cache, usage=0) chain=' + chainId + ' phase=' + orch.phase + ' — 缓存污染嫌疑，按零产出计 stall');
                }
                orch.stallCount = (orch.stallCount ?? 0) + 1;
                if (orch.stallCount > VOrchestrator.STALL_REWAKE_LIMIT) {
                    const anchor = chainTasks.filter((t) => terminal.includes(t.status)).at(-1) ?? chainTasks.at(-1);
                    if (anchor) {
                        if (!state.events.some((e) => e.taskId === anchor.id && e.kind === 'task/commented' && String(e.payload['body'] ?? '').startsWith('[create-failed]'))) {
                            await this.kanban.comment(anchor.id, `[create-failed] 阶段 ${orch.phase} 连续 ${orch.stallCount} 轮建卡未产生期望卡（assignee=${expect.assignee}, mode=${expect.mode}，已自动重试 ${VOrchestrator.STALL_REWAKE_LIMIT} 次）。请检查工具 schema/模型输出后人工处理。`, 'system');
                        }
                    }
                    else {
                        console.error(`[dsh-swarm][debug] V create-failed (zero tasks, no anchor card to comment): chain=${chainId} phase=${orch.phase} stallCount=${orch.stallCount} — 已置链级 blocked（防线A）`);
                    }
                    // 防线A：超限不再只显形评论——零任务链从此有数据侧终态（人工恢复=删链重跑）
                    try {
                        await this.kanban.blockChain(chainId, `[create-failed] 阶段 ${orch.phase} 连续 ${orch.stallCount} 轮建卡未产生期望卡（assignee=${expect.assignee}, mode=${expect.mode}），已自动重试 ${VOrchestrator.STALL_REWAKE_LIMIT} 次`);
                    }
                    catch (err) {
                        console.error('[dsh-swarm][debug] blockChain failed chain=' + chainId + ': ' + String(err));
                    }
                    this.onOrchChange?.();
                    return;
                }
                this.scheduleRewake(chainId, orch.stallCount);
                this.onOrchChange?.();
                return;
            }
            orch.stallCount = 0;
            this.onOrchChange?.();
            if (firstMatch) {
                // 评审阶段（pt/dt）：建卡后不推进 phase（等评审 verdict 分流，pass 才推进）；
                // 普通阶段：建卡后推进 phase（生产上由 task/completed 事件串行唤醒下一阶段）。
                if (orch.phase !== 'pt' && orch.phase !== 'dt') {
                    orch.phase = this.advance(orch.phase);
                }
                orch.waitingOn = 'task/completed';
            }
            // 建卡后停止本轮，等本阶段完成事件推进下一阶段（不跨阶段并行建卡）
            return;
        }
    }
    /** 阻塞复核幂等判定：任务最近一次 task/blocked 之后已存在 [blocked-review] 开头的评论。
     *  注：at 为 Date.now() 毫秒精度，block 与评论可能同毫秒（测试/快路径实测碰撞）→ 用 seq 比较（确定性）。 */
    hasBlockReview(state, t) {
        const lastBlockSeq = [...state.events].reverse().find((e) => e.taskId === t.id && e.kind === 'task/blocked')?.seq ?? -1;
        return state.events.some((e) => e.taskId === t.id && e.kind === 'task/commented' && e.seq > lastBlockSeq &&
            String(e.payload['body'] ?? '').startsWith('[blocked-review]'));
    }
    /** 评审卡 completed 处理（交付质量链）：读 handoff 的 review_evidence verdict 分流。
     *  pass → recordReview(passed) + 推进；fail → recordReview(failed) + createReworkTask + 新建复审卡；
     *  reviewAttempt ≥ maxReworksPerRole → review/gave-up + [review-final] 证据链（链保持）。
     *  严禁对已完成的上游 P/D 调 blockTask（done 不可变；返工走新 rework 卡）。 */
    async handleReviewCompletion(chainId, orch, reviewTask, state) {
        if (isVoidReview(reviewTask, state.events))
            return 'gave-up'; // 作废评审卡不处理（编排层已过滤，此处双保险）
        const role = orch.phase === 'pt' ? 'pt' : 'dt';
        const handoff = state.handoffs.get(reviewTask.id);
        const evidence = (handoff?.metadata?.['review_evidence']);
        if (!evidence)
            return 'gave-up'; // 无证据（异常路径；完成闸已拦）
        // 幂等：该评审卡已有 review 事件（重启恢复）→ 按 passed 判定推进，否则保持
        const hasReviewEvent = (kind) => state.events.some((e) => e.taskId === reviewTask.id && e.kind === kind);
        if (hasReviewEvent('review/passed') || hasReviewEvent('review/failed') || hasReviewEvent('review/gave-up')) {
            return hasReviewEvent('review/passed') ? 'advanced' : 'rework';
        }
        // 被评审任务：复审卡经 reworkOfTaskId/parents 指向 rework 任务；首次评审回退到阶段源任务（done）
        const srcAssignee = role === 'pt' ? 'p' : 'd';
        const srcMode = role === 'pt' ? 'openspec' : 'execute';
        let currentTarget = reviewTask.reworkOfTaskId
            ? state.tasks.get(reviewTask.reworkOfTaskId)
            : reviewTask.parents[0]
                ? state.tasks.get(reviewTask.parents[0])
                : undefined;
        if (!currentTarget) {
            currentTarget = [...state.tasks.values()].find((t) => t.chainId === chainId && t.assignee === srcAssignee && t.mode === srcMode && t.status === 'done');
        }
        if (!currentTarget)
            return 'gave-up';
        // root = 沿 reworkOfTaskId 链到顶（原任务），reviewStatus 落在原任务上
        let root = currentTarget;
        while (root.reworkOfTaskId && state.tasks.get(root.reworkOfTaskId))
            root = state.tasks.get(root.reworkOfTaskId);
        if (evidence.verdict === 'pass') {
            await this.kanban.recordReview(reviewTask.id, root.id, evidence, 'system');
            return 'advanced';
        }
        // fail
        await this.kanban.recordReview(reviewTask.id, root.id, evidence, 'system');
        const maxR = this.configProvider.getEffective().dispatcher?.maxReworksPerRole?.[role] ?? 3;
        if ((currentTarget.reviewAttempt ?? 0) >= maxR) {
            await this.kanban.reviewGaveUp(reviewTask.id, root.id, 'exceeded max reworks (' + maxR + ')', 'system');
            // [review-final] 证据链：评审时间线 + 最终原因（system 确定性写入）
            const timeline = state.events
                .filter((e) => e.taskId === root.id || e.taskId === currentTarget.id)
                .map((e) => `  - seq=${e.seq} ${e.kind} at=${e.at}`)
                .join('\n') || '  - (无)';
            await this.kanban.comment(reviewTask.id, [
                '[review-final] 评审超限（' + role + ' gave-up after ' + maxR + ' reworks），不再返工。',
                '## 评审时间线',
                timeline,
                '最终原因: exceeded max reworks (' + maxR + ')',
            ].join('\n'), 'system');
            return 'gave-up';
        }
        // 未超限：createReworkTask（原任务保持 done）+ 新建复审卡（parents=rework，reviewAttempt=rework.reviewAttempt）。
        // 2026-09-03 P/PT 定位决议铁律3：复审卡 body 确定性注入上一轮 issues 对账输入——复审卡原为空 body，
        // 对账纯靠模型自觉（ch_1_mtjuukv2 三轮空转的结构根因之一）；输入直接取作用域内 evidence，不查事件。
        const reconcileBody = [
            role === 'pt' ? '## PT 复审任务体要求（计划评审，只读）' : '## DT 复审任务体要求（实现校验+评审，只读护栏）',
            role === 'pt'
                ? 'P 已按上一轮 issues 返工。按 persona 五要素只读评审返工后的计划产物，输出 verdict+issues 入交接 metadata.review_evidence（评审闸要求不变：artifacts_path 或 reviewPage）。'
                : 'D 已按上一轮 issues 返工。按 persona 对返工产物实证校验+评审，输出 verdict+issues 入交接 metadata.review_evidence。',
            '## 上一轮评审未通过 issues（必须先逐条对账，再提新问题）',
            formatIssues(evidence.issues) || '  -（无）',
            '对账规则：每条旧 issue 给出三态结论——已修复（resolved=true）/未修复（resolved=false，detail 原样沿用）/部分修复（resolved=false，detail 注明剩余部分）；未修复旧 issue 必须原样保留在 issues 中，禁止跳过对账只提新问题。',
        ].join('\n');
        const rework = await this.kanban.createReworkTask({ sourceTaskId: currentTarget.id, reviewTaskId: reviewTask.id, reason: 'review failed' }, 'system');
        await this.kanban.createTask({
            chainId,
            title: role === 'pt' ? '计划复审' : '实现复审',
            assignee: role,
            mode: role === 'pt' ? 'review-plan' : 'review-impl',
            parents: [rework.id],
            reviewAttempt: rework.reviewAttempt,
            body: reconcileBody,
        }, 'v');
        return 'rework';
    }
    advance(phase) {
        const i = R20_PHASE_ORDER.indexOf(phase);
        return R20_PHASE_ORDER[Math.min(i + 1, R20_PHASE_ORDER.length - 1)];
    }
    async getVAgent(orch) {
        // B3：resume 与 create 都传 setup——恢复的 V 会话同样装配角色工具面（agent scope 注册随会话重建），
        // 与 agent-runner.ts 的 installRoleTools 用法一致。
        // 修复轮 6：V 后台编排会话与 P/W/D 一致，显式设置 approval=never + sandbox=workspace-write，
        // 避免在无 preset 装配时因默认审批策略在后台无应答者而挂起（卡死调度器首轮 tick）。
        const setup = async (agentCtx) => {
            // 思考等级强制（waterfall）：与 agent-runner 同缺陷——宿主 selection 无 create-options 覆盖层，
            // agentOptions.reasoningEffort 不被消费，V 编排会话思考等级会落回宿主默认。走 DSH agent/request
            // waterfall 逐请求强制 'high'（宿主 installModelSelection 同机制），作用域仅本 V 会话。
            const scoped = agentCtx;
            scoped.on('agent/request', async (_payload, next) => {
                // 异常不吞：await next() 失败原样向上抛
                const resolved = await next();
                return { ...resolved, reasoningEffort: 'high' };
            });
            const session = agentCtx.agent?.session;
            session?.append?.('approval/policy', { policy: 'never', source: 'delegation' });
            session?.append?.('sandbox/mode', { mode: 'workspace-write', source: 'delegation' });
            // R21 对齐（2026-08-17）：V=butler·orchestrator 零执行能力——先挂 kanban-v 裁剪 preset
            // （组合仅 persona + agent-instructions，无 bash/fs/run_code/web/skill/delegation 等执行/探索工具），
            // 再注入 kanban/spec 工具面；从基座层面落实「V 只路由、不执行」。
            const presets = agentCtx.get?.('agentPresets');
            if (presets) {
                // Task 4 加固：preset mount 失败即抛（fail-fast），不再 console.error 静默放行——V 会话
                // 无 persona 基座不得裸奔。抛错 → create/resume 失败 → getVAgent 抛 → 主推进路径并入
                // 异常收场（Fix D stall 计数，超限 [create-failed] + blockChain）；候选循环对非 model
                // 错误立即失败（isModelUnavailableError=false → throw），不会被候选切换吞掉。
                const vSessionId = orch.sessionId ?? 'kbn-v-' + orch.chainId;
                try {
                    await presets.mount(agentCtx, V_SESSION_PRESET_ID);
                }
                catch (err) {
                    throw new Error(V_SESSION_PRESET_ID + ' preset mount failed for ' + vSessionId + ': ' + String(err));
                }
            }
            await installRoleTools(agentCtx, 'v', { kanban: this.kanban, wiki: this.wiki });
            // Task 4：setup 完整成功（mount + 工具面）后写身份标记——live 复用校验依据（同 agent-runner 组合标记机制）。
            const vAgent = agentCtx.agent;
            if (vAgent && typeof vAgent === 'object')
                vSessionCompositions.set(vAgent, V_SESSION_PRESET_ID);
        };
        // 模型候选链（Task 12）：V 会话 create/resume 按 primary→fallbacks 静默切换；
        // V 无任务卡可 block——全候选不可用抛最后错误（wakeV 调用方按既有错误路径处理）。
        const candidates = buildModelCandidates(this.configProvider.getEffective(), 'v', this.defaultModel);
        const spawnWith = async (opts) => {
            if (orch.sessionId) {
                // 修复轮 6：V 会话首轮创建后保持 live，resume 会抛 "cannot prepare session while it is live"。
                // 优先复用 agents registry 中仍 live 的会话（followup 续用），仅当会话已下线时才 resume。
                // Task 4 加固：live 复用前校验身份标记（参照 agent-runner resumeOrReuse 同款）——标记匹配
                // 才复用；缺失/不匹配（GUI 重开同名会话/宿主自建 incarnation/历史会话）拒绝盲复用，改走
                // resume 重跑 setup 重新 mount（身份自愈）；resume 撞 live 冲突则抛错走防线——绝不静默
                // 把错误身份的会话交给调用方。
                const live = this.agents.get?.(orch.sessionId);
                if (live) {
                    const marker = typeof live === 'object' && live !== null ? vSessionCompositions.get(live) : undefined;
                    if (marker === V_SESSION_PRESET_ID)
                        return live;
                    console.error('[dsh-swarm][debug] V live session identity unverifiable (session ' + orch.sessionId + ', marker=' + String(marker) + ') — refusing blind reuse, falling back to resume (re-setup re-mounts ' + V_SESSION_PRESET_ID + ')');
                    const h = await this.agents.resume({ resumeSessionId: orch.sessionId, ...opts, setup });
                    return h.agent;
                }
                const h = await this.agents.resume({ resumeSessionId: orch.sessionId, ...opts, setup });
                return h.agent;
            }
            // M2(Q5)+归组：V 编排会话创建在主 agent 工作空间；缺失时询问用户注册工作区，仍不可得 → 抛错（dispatcher 捕获日志，V 待命）。
            let ws = await this.chainWorkspace(orch.chainId);
            if (!ws) {
                ws = await resolveOrCreateWorkspace(this.ctx, null, 'chain ' + orch.chainId + ' V');
            }
            if (!ws)
                throw new Error('workspace-unknown: chain ' + orch.chainId + ` 无 workspaceDir，需重新 ${this.configProvider.getEffective().prefixRoutes.plan}`);
            const h = await this.agents.create({ sessionId: `kbn-v-${orch.chainId}`, meta: { cwd: ws }, ...opts, setup });
            orch.sessionId = `kbn-v-${orch.chainId}`;
            await attachSessionToWorkspace(this.ctx, `kbn-v-${orch.chainId}`, ws, 'chain ' + orch.chainId + ' V');
            return h.agent;
        };
        if (candidates.length === 0)
            return spawnWith({});
        let lastErr = null;
        for (const candidate of candidates) {
            try {
                return await spawnWith({ agentOptions: candidate });
            }
            catch (err) {
                lastErr = err;
                if (!isModelUnavailableError(err))
                    throw err; // 非 model 错误立即失败
                console.error('[dsh-swarm][debug] V model candidate unavailable ' + String(candidate.provider) + '/' + String(candidate.model) + ': ' + String(err));
            }
        }
        throw lastErr;
    }
    /** M2(Q5)+归组：链的 workspaceDir（发起 /plan: 的主 agent 工作空间）；缺失返回 null（调用方询问/报错，不落 kanban 存储）。 */
    async chainWorkspace(chainId) {
        const state = await this.kanban.snapshot();
        return state.chains.get(chainId)?.workspaceDir ?? null;
    }
}
