import { project, applyTo } from './projection.js';
import { can } from './permissions.js';
import { hasDeliveryEvidence } from './delivery-evidence.js';
import { missingDeliveryKeys } from './delivery-contract.js';
import { validateManifestIfPresent } from './prefetch-manifest.js';
import { validateReviewEvidence } from './review-evidence.js';
import { resolveTaskParents } from './task-parents.js';
let seqCounter = 0;
const nid = (p) => `${p}_${(++seqCounter).toString(36)}_${Date.now().toString(36)}`;
/** 看板领域门面：三界面（工具/CLI/UI）统一路由的唯一入口。 */
export class KanbanService {
    state;
    store;
    emitQueue = Promise.resolve();
    listeners = new Set();
    // D23：链完成验收核对钩子（dispatcher 注入：读主会话事件/产物归属核对 → auditWarning）
    onChainCompletedHook = null;
    constructor(store) {
        this.store = store;
        // P0-3：同步重投影，消除"构造后立即调用基于空状态"的竞态
        this.state = project(store.readAllSync());
    }
    async emit(ev) {
        let emitted;
        const pending = this.emitQueue.then(async () => {
            const candidate = applyTo(this.state, { ...ev, seq: -1 });
            const full = await this.store.append(ev);
            this.state = { ...candidate, events: [...candidate.events.slice(0, -1), full] };
            emitted = full;
            this.publish(full);
        });
        this.emitQueue = pending.catch(() => { });
        await pending;
        return emitted;
    }
    /** D23：注入链完成核对钩子（由调度层设置；仅一个消费者）。 */
    setOnChainCompleted(hook) {
        this.onChainCompletedHook = hook;
    }
    /** T22：订阅持久化后的看板事件；返回解除订阅函数。listener 异常不影响已落盘状态。 */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    /** T22：返回 seq >= 入参 的事件（与 EventStore.readSince 同为 inclusive 语义）。 */
    async eventsSince(seq) {
        return this.store.readSince(seq);
    }
    publish(event) {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            }
            catch (error) {
                console.error('[dsh-swarm] event listener failed', error);
            }
        }
    }
    async chainOf(chainId) {
        const c = this.state.chains.get(chainId);
        if (!c)
            throw new Error('unknown chain: ' + chainId);
        return c;
    }
    async createChain(input, actor) {
        if (!can('create-chain', actor, null))
            throw new Error('permission denied');
        const chain = { id: nid('ch'), title: input.title, status: 'planning', rootTaskId: null, specCardId: null, ownerSessionId: input.ownerSessionId, workspaceDir: input.workspaceDir ?? null, createdAt: Date.now() };
        await this.emit({ chainId: chain.id, taskId: null, kind: 'chain/created', payload: { ...chain }, author: actor, at: Date.now() });
        return chain;
    }
    async createSpecCard(chainId, sections, actor) {
        if (!can('spec-edit', actor, null))
            throw new Error('permission denied');
        const card = { id: nid('sc'), chainId, status: 'draft', sections, attachments: [], rawDialogueRef: null, approvedAt: null, approvedBy: null };
        await this.emit({ chainId, taskId: null, kind: 'spec-card/created', payload: { ...card }, author: actor, at: Date.now() });
        return card;
    }
    async editSpecCard(cardId, sections, actor) {
        if (!can('spec-edit', actor, null))
            throw new Error('permission denied');
        const card = this.state.specCards.get(cardId);
        if (!card || card.status !== 'draft')
            throw new Error('spec card not editable');
        const updated = { ...card, sections };
        await this.emit({ chainId: card.chainId, taskId: null, kind: 'spec-card/edited', payload: { ...updated }, author: actor, at: Date.now() });
        return updated;
    }
    async approveSpecCard(cardId, actor) {
        if (!can('spec-approve', actor, null))
            throw new Error('permission denied');
        const card = this.state.specCards.get(cardId);
        if (!card)
            throw new Error('unknown spec card: ' + cardId);
        await this.emit({ chainId: card.chainId, taskId: null, kind: 'spec-card/approved', payload: { id: cardId }, author: actor, at: Date.now() });
        const updated = this.state.specCards.get(cardId);
        // 规格卡批准 → 链路进入 executing（语义正确的事件：chain/executing）
        await this.emit({ chainId: card.chainId, taskId: null, kind: 'chain/executing', payload: {}, author: actor, at: Date.now() });
        return updated;
    }
    async createTask(input, actor) {
        if (!can('create-task', actor, null))
            throw new Error('permission denied');
        const chain = await this.chainOf(input.chainId);
        // 语义 parents 兜底：调用方（V 建卡）未显式指定 parents 时，按 R20 依赖自动接链上终态父任务，
        // 保证「父交接注入」通道闭合（如 P 卡自动接 W1-pre，评审卡自动接被评审任务）。兜底对已显式传 parents 的
        // 调用（复审卡 parents=[rework.id]、createReworkTask）不生效。
        const parents = input.parents && input.parents.length > 0
            ? input.parents
            : resolveTaskParents(this.state.tasks.values(), input.chainId, input.assignee, input.mode);
        const task = { id: nid('t'), chainId: input.chainId, title: input.title, body: input.body ?? '', assignee: input.assignee, status: 'todo', mode: input.mode, priority: 1, parents, children: [], createdBy: actor === 'human' ? 'human' : 'v', attempts: 0, heartbeats: [], sessionId: '', reworkOfTaskId: null, resumeSessionId: null, reviewAttempt: input.reviewAttempt ?? 0, reviewStatus: 'not-required' };
        task.sessionId = 'kbn-' + task.id; // 确定性会话 id：与角色会话 id 一致，供追踪定位与 resume
        await this.emit({ chainId: input.chainId, taskId: task.id, kind: 'task/created', payload: { ...task }, author: actor, at: Date.now() });
        if (chain.rootTaskId === null) {
            await this.emit({ chainId: input.chainId, taskId: task.id, kind: 'chain/root-task-set', payload: { rootTaskId: task.id }, author: actor, at: Date.now() });
        }
        return task;
    }
    async claimTask(taskId, actor) {
        if (!can('claim', actor, null))
            throw new Error('permission denied');
        const t = this.state.tasks.get(taskId);
        if (!t)
            throw new Error('unknown task: ' + taskId);
        await this.emit({ chainId: t.chainId, taskId, kind: 'task/claimed', payload: {}, author: actor, at: Date.now() });
        return this.state.tasks.get(taskId);
    }
    async completeTask(taskId, handoff, actor, opts = {}) {
        const t = this.state.tasks.get(taskId);
        if (!t)
            throw new Error('unknown task: ' + taskId);
        if (!can('complete', actor, t, opts))
            throw new Error('permission denied');
        if (!handoff.summary.trim())
            throw new Error('handoff summary required');
        // C2：D(execute) 完成必须带 git 产物证据（changed_files + commit/push 至少其一）——
        // 执行者语义硬校验；human 为信任锚（GUI 强制收尾）可豁免，但 C1 链完成门禁仍会拦截无证据链。
        if (t.assignee === 'd' && t.mode === 'execute' && actor !== 'human' && !hasDeliveryEvidence(handoff)) {
            throw new Error('delivery evidence required: D(execute) complete must carry changed_files + (commit_hash|push)');
        }
        // 评审证据闸：PT/DT 完成必须带机械校验合法的 review_evidence（缺证据拒绝 pass）。
        // human 为信任锚（GUI 强制收尾）可豁免。
        if ((t.assignee === 'pt' || t.assignee === 'dt') && actor !== 'human') {
            const missing = validateReviewEvidence(t.assignee === 'pt' ? 'pt' : 'dt', handoff);
            if (missing.length > 0) {
                throw new Error('review evidence required: ' + missing.join(', '));
            }
        }
        // 交付契约闸（上游对下游负责）：W/P 完成必须带其阶段交付物（W1-pre ref / W2-W3 kb_url+page_path /
        // P artifacts_path）。缺失交付物 → 直接 kanban_block（running→blocked 标在缺交付的「当前角色」卡上），
        // 而非仅报错留 running 等下游（如 D 读 W2 的 page_path）执行时才暴露断裂。blocked ≠ done，V 的
        // resolveTaskParents 只取 done/archived 父卡，故 V 永远不会拿该父卡推进建下游卡；task/blocked 事件
        // 同时唤醒 V 走其阻塞复核。与 D(execute)/PT/DT 证据闸不同：交付键是下游硬依赖的机械非空字符串，
        // 无「human 信任锚强制收尾」豁免——human 强制收尾同样必须补齐交付键，否则 W/P 卡直接 blocked，
        // 从源头杜绝 done-but-missing（上游未产出 page_path 就不会成为 done 父卡 → V 不会建 D 卡）。
        {
            const missing = missingDeliveryKeys(t.assignee, t.mode, handoff);
            if (missing.length > 0) {
                await this.emit({ chainId: t.chainId, taskId, kind: 'task/blocked', payload: { reason: 'delivery required: ' + missing.join(', ') }, author: 'system', at: Date.now() });
                throw new Error('delivery required: ' + missing.join(', '));
            }
        }
        // 轻档 manifest 校验（W1-pre）：交接带 manifest 则 schema 校验，非法即抛错拒绝完成（硬约束，源头掐断）。
        // 语义：manifest 为可选交付，但「提供了就必须合法」——kanban_complete 直接抛错（同 D 证据/PT·DT 证据闸），
        // agent 在会话内收到明确拒绝原因后修正、重新提交；任务保持 running，不 emit block/failed——
        // 不阻塞级联、不烧 attempts 重试预算、不触发 live 会话重跑死锁（比「failed 自动重派」更贴近源头约束）。
        // 由此保证不变式：「done 的 W1-pre 交接，其 manifest（若提供）必然合法」——上游给下游的交付物干净，
        // 下游 P 卡读取 manifest 无需再兜底校验；W1-pre 未 done → V 的 resolveTaskParents 不取它 → 下游 P 卡天然不建。
        // 缺 manifest 不拦（legacy 兼容，可选交付）。
        {
            const manifestErrors = validateManifestIfPresent(t.assignee, t.mode, handoff);
            if (manifestErrors.length > 0) {
                throw new Error(manifestErrors.join('; '));
            }
        }
        await this.emit({ chainId: t.chainId, taskId, kind: 'task/completed', payload: { ...handoff }, author: actor, at: Date.now() });
        // P0-3 链完成机械规则：仅当「最后完成的执行任务是 W3（w/kb）且链上 D(execute) 已 done 且
        // 交付物证据满足（changed_files + commit/push）」且无未终态任务时 → 链 completed（不靠 agent 自觉）。
        // 收紧判据：中间阶段（如 P done 后 W2 尚未创建）无未终态任务也不得误收链。
        // C1：D(execute) 无产物证据 → 不判链完成（human 强制 complete 的 D 卡同样被拦截，防漂移被掩盖）。
        // 'align' 为旧链路兼容（只读对齐/校验语义已废弃，R20 起新卡一律 'execute'）。
        const terminal = ['done', 'archived'];
        const chain = this.state.chains.get(t.chainId);
        const chainTasks = [...this.state.tasks.values()].filter((x) => x.chainId === t.chainId);
        const openTasks = chainTasks.filter((x) => !terminal.includes(x.status));
        const dTask = chainTasks.find((x) => (x.mode === 'execute' || x.mode === 'align') && x.status === 'done');
        const dDone = !!dTask;
        const dEvidenceOk = dTask ? (dTask.mode === 'align' ? true : hasDeliveryEvidence(this.state.handoffs.get(dTask.id))) : false;
        const completedEvents = this.state.events.filter((e) => e.chainId === t.chainId && e.kind === 'task/completed' && e.taskId);
        const lastTask = completedEvents.length ? this.state.tasks.get(completedEvents[completedEvents.length - 1].taskId) : undefined;
        const w3Done = !!lastTask && lastTask.assignee === 'w' && lastTask.mode === 'kb' && dDone && dEvidenceOk;
        if (chain && chain.status === 'executing' && openTasks.length === 0 && w3Done) {
            await this.emit({ chainId: t.chainId, taskId: null, kind: 'chain/completed', payload: {}, author: 'system', at: Date.now() });
            // D23：链完成 → 调度层验收核对（主会话越权写产物 → chain/audit-warning）。
            // 钩子内异常不阻断 completeTask 本身（核对失败仅记录，链路仍 completed）。
            if (this.onChainCompletedHook) {
                try {
                    await this.onChainCompletedHook(t.chainId);
                }
                catch (error) {
                    console.error('[dsh-swarm] chain completion audit hook failed: ' + String(error));
                }
            }
        }
        return this.state.tasks.get(taskId);
    }
    /** D23：链完成验收核对发警告（仅 system/dispatcher 可发）。Chain 状态保持 completed。 */
    async auditWarning(chainId, evidence, actor) {
        if (actor !== 'system')
            throw new Error('permission denied: only dispatcher may raise audit warnings');
        await this.chainOf(chainId);
        return this.emit({ chainId, taskId: null, kind: 'chain/audit-warning', payload: { evidence }, author: actor, at: Date.now() });
    }
    /** D23：用户确认产物归属（仅 human，GUI confirm-audit action）。放行最终汇报。 */
    async confirmAudit(chainId, actor) {
        if (!can('audit-confirm', actor, null))
            throw new Error('permission denied');
        await this.chainOf(chainId);
        const audit = this.state.auditWarnings.get(chainId);
        if (!audit)
            throw new Error('no audit warning for chain: ' + chainId);
        return this.emit({ chainId, taskId: null, kind: 'chain/audit-confirmed', payload: {}, author: actor, at: Date.now() });
    }
    async blockTask(taskId, reason, actor, opts = {}) {
        const t = this.state.tasks.get(taskId);
        if (!t)
            throw new Error('unknown task: ' + taskId);
        if (!can('block', actor, t, opts))
            throw new Error('permission denied');
        if (!reason.trim())
            throw new Error('block reason required');
        await this.emit({ chainId: t.chainId, taskId, kind: 'task/blocked', payload: { reason }, author: actor, at: Date.now() });
        return this.state.tasks.get(taskId);
    }
    async unblockTask(taskId, actor) {
        const t = this.state.tasks.get(taskId);
        if (!t)
            throw new Error('unknown task: ' + taskId);
        if (!can('unblock', actor, t))
            throw new Error('permission denied');
        await this.emit({ chainId: t.chainId, taskId, kind: 'task/unblocked', payload: {}, author: actor, at: Date.now() });
        return this.state.tasks.get(taskId);
    }
    async heartbeat(taskId, actor, opts = {}) {
        const t = this.state.tasks.get(taskId);
        if (!t)
            throw new Error('unknown task: ' + taskId);
        if (!can('heartbeat', actor, t, opts))
            throw new Error('permission denied');
        await this.emit({ chainId: t.chainId, taskId, kind: 'task/heartbeat', payload: {}, author: actor, at: Date.now() });
        return this.state.tasks.get(taskId);
    }
    /** 标记任务失败（runner 异常/心跳超时回收）；投影递增 attempts（infra 瞬时错误不计数）。重试由调度器重派。 */
    async failTask(taskId, reason, actor, opts = {}) {
        const t = this.state.tasks.get(taskId);
        if (!t)
            throw new Error('unknown task: ' + taskId);
        if (actor !== 'system')
            throw new Error('permission denied: only dispatcher may fail tasks');
        if (!reason.trim())
            throw new Error('fail reason required');
        await this.emit({ chainId: t.chainId, taskId, kind: 'task/failed', payload: { reason, infra: opts.infra ?? false }, author: actor, at: Date.now() });
        return this.state.tasks.get(taskId);
    }
    async comment(taskId, body, actor) {
        const t = this.state.tasks.get(taskId);
        if (!t)
            throw new Error('unknown task: ' + taskId);
        if (!can('comment', actor, t))
            throw new Error('permission denied');
        return this.emit({ chainId: t.chainId, taskId, kind: 'task/commented', payload: { body }, author: actor, at: Date.now() });
    }
    async archiveTask(taskId, actor) {
        const t = this.state.tasks.get(taskId);
        if (!t)
            throw new Error('unknown task: ' + taskId);
        if (!can('archive', actor, t))
            throw new Error('permission denied');
        await this.emit({ chainId: t.chainId, taskId, kind: 'task/archived', payload: {}, author: actor, at: Date.now() });
        return this.state.tasks.get(taskId);
    }
    /** T10.5：仅 draft 规格卡可挂附件（V 挂 W1-pre 预取产物 / human GUI 上传）。 */
    async addSpecCardAttachment(cardId, attachment, actor) {
        const card = this.state.specCards.get(cardId);
        if (!card)
            throw new Error('unknown spec card: ' + cardId);
        if (!can('spec-attach', actor, null))
            throw new Error('permission denied');
        if (card.status !== 'draft')
            throw new Error('spec card not editable');
        const updated = { ...card, attachments: [...card.attachments, attachment] };
        await this.emit({ chainId: card.chainId, taskId: null, kind: 'spec-card/edited', payload: { ...updated }, author: actor, at: Date.now() });
        return updated;
    }
    /** 评审事件（交付质量链）：recordReview 记录评审卡结论并更新被评审任务 reviewStatus。
     *  actor 必须 system（V/角色不可伪造评审结论）；verdict=pass → review/passed，否则 review/failed。
     *  投影（projection.ts）据事件更新 target.reviewStatus（passed/failed）。 */
    async recordReview(reviewTaskId, targetTaskId, evidence, actor) {
        if (actor !== 'system')
            throw new Error('permission denied: only dispatcher may record review');
        const t = this.state.tasks.get(targetTaskId);
        if (!t)
            throw new Error('unknown target task: ' + targetTaskId);
        const kind = evidence.verdict === 'pass' ? 'review/passed' : 'review/failed';
        return this.emit({ chainId: t.chainId, taskId: reviewTaskId, kind, payload: { reviewTaskId, targetTaskId, evidence }, author: actor, at: Date.now() });
    }
    /** 评审超限放弃：review/gave-up（含证据链信息）。仅 system。 */
    async reviewGaveUp(reviewTaskId, targetTaskId, reason, actor) {
        if (actor !== 'system')
            throw new Error('permission denied: only dispatcher may give up review');
        const t = this.state.tasks.get(targetTaskId);
        if (!t)
            throw new Error('unknown target task: ' + targetTaskId);
        return this.emit({ chainId: t.chainId, taskId: reviewTaskId, kind: 'review/gave-up', payload: { reviewTaskId, targetTaskId, reason }, author: actor, at: Date.now() });
    }
    /** 评审失败返工卡创建（评审失败闭环）：原任务保持 done（不可变），新建返工卡继承 rework 字段。
     *  仅 system（can('create-rework-task')=system）；V 建执行卡、system 建返工卡。 */
    async createReworkTask(input, actor) {
        if (!can('create-rework-task', actor, null))
            throw new Error('permission denied');
        const source = this.state.tasks.get(input.sourceTaskId);
        if (!source)
            throw new Error('unknown source task: ' + input.sourceTaskId);
        if (source.status !== 'done')
            throw new Error('rework source must be done: ' + source.status);
        const task = {
            id: nid('t'), chainId: source.chainId, title: `[返工] ${source.title}`, body: '',
            assignee: source.assignee, status: 'todo', mode: source.mode, priority: 1,
            parents: [...source.parents], children: [], createdBy: 'auto', // system 自动创建（返工卡）
            attempts: 0, heartbeats: [],
            sessionId: '', reworkOfTaskId: source.id, resumeSessionId: source.sessionId,
            reviewAttempt: source.reviewAttempt + 1, reviewStatus: 'pending',
        };
        task.sessionId = 'kbn-' + task.id;
        await this.emit({ chainId: source.chainId, taskId: task.id, kind: 'task/created', payload: { ...task }, author: actor, at: Date.now() });
        return task;
    }
    async snapshot() {
        // P0-3：重投影为权威（事件日志是唯一事实源；非法转换在此抛错）
        this.state = project(await this.store.readAll());
        return this.state;
    }
    async listTasks(opts = {}) {
        return [...this.state.tasks.values()].filter((t) => (opts.assignee === undefined || t.assignee === opts.assignee) &&
            (opts.status === undefined || t.status === opts.status));
    }
}
