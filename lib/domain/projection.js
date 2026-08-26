import { transitionChain, transitionSpecCard, transitionTask } from './state-machine.js';
function empty() {
    return { chains: new Map(), tasks: new Map(), specCards: new Map(), handoffs: new Map(), auditWarnings: new Map(), events: [] };
}
export function applyTo(state, ev) {
    const next = { ...state, events: [...state.events, ev] };
    switch (ev.kind) {
        case 'chain/created': {
            const p = ev.payload;
            next.chains = new Map(state.chains).set(p.id, { ...p, status: 'planning', workspaceDir: p.workspaceDir ?? null });
            break;
        }
        case 'chain/executing':
        case 'chain/completed':
        case 'chain/aborted': {
            const c = state.chains.get(ev.chainId);
            if (!c)
                throw new Error('projection: unknown chain ' + ev.chainId);
            next.chains = new Map(state.chains).set(ev.chainId, { ...c, status: transitionChain(c.status, ev.kind) });
            break;
        }
        case 'chain/root-task-set': {
            const c = state.chains.get(ev.chainId);
            if (!c)
                throw new Error('projection: unknown chain ' + ev.chainId);
            next.chains = new Map(state.chains).set(ev.chainId, { ...c, rootTaskId: String(ev.payload['rootTaskId'] ?? '') });
            break;
        }
        // D23：audit 事件不改 Chain 状态，只写验收核对视图（auditWarnings）
        case 'chain/audit-warning': {
            const c = state.chains.get(ev.chainId);
            if (!c)
                throw new Error('projection: unknown chain ' + ev.chainId);
            const evidence = (ev.payload['evidence'] ?? []);
            const audit = {
                evidence,
                warnedAt: ev.at,
                warnedSeq: ev.seq,
                confirmedAt: null,
                confirmedBy: null,
                confirmedSeq: null,
            };
            next.auditWarnings = new Map(state.auditWarnings).set(ev.chainId, audit);
            break;
        }
        case 'chain/audit-confirmed': {
            const c = state.chains.get(ev.chainId);
            if (!c)
                throw new Error('projection: unknown chain ' + ev.chainId);
            const existing = state.auditWarnings.get(ev.chainId);
            if (!existing)
                throw new Error('projection: audit-confirmed without audit-warning: ' + ev.chainId);
            next.auditWarnings = new Map(state.auditWarnings).set(ev.chainId, {
                ...existing,
                confirmedAt: ev.at,
                confirmedBy: ev.author,
                confirmedSeq: ev.seq,
            });
            break;
        }
        // T7：链标题改名（非状态转换，只更新 title；快照重放可见）
        case 'chain/title-updated': {
            const c = state.chains.get(ev.chainId);
            if (!c)
                throw new Error('projection: unknown chain ' + ev.chainId);
            next.chains = new Map(state.chains).set(ev.chainId, { ...c, title: String(ev.payload['to'] ?? '') });
            break;
        }
        // T7：任务标题改名（非状态转换，只更新 title）
        case 'task/renamed': {
            if (!ev.taskId)
                throw new Error('projection: event without taskId');
            const t = state.tasks.get(ev.taskId);
            if (!t)
                throw new Error('projection: unknown task ' + ev.taskId);
            next.tasks = new Map(state.tasks).set(ev.taskId, { ...t, title: String(ev.payload['to'] ?? '') });
            break;
        }
        case 'task/created': {
            const p = ev.payload;
            if (!p.id || !p.assignee)
                throw new Error('projection: malformed task/created');
            // 归一化缺省字段，使最小 payload 的事件日志可回放（P0-3 回放为权威）
            const normalized = {
                ...p,
                status: p.status ?? 'todo',
                parents: p.parents ?? [],
                children: p.children ?? [],
                attempts: p.attempts ?? 0,
                heartbeats: p.heartbeats ?? [],
                sessionId: p.sessionId ?? 'kbn-' + p.id,
                reworkOfTaskId: p.reworkOfTaskId ?? null,
                resumeSessionId: p.resumeSessionId ?? null,
                reviewAttempt: p.reviewAttempt ?? 0,
                reviewStatus: p.reviewStatus ?? 'not-required',
            };
            next.tasks = new Map(state.tasks).set(p.id, normalized);
            break;
        }
        case 'task/claimed':
        case 'task/heartbeat':
        case 'task/completed':
        case 'task/blocked':
        case 'task/unblocked':
        case 'task/failed':
        case 'task/archived': {
            if (!ev.taskId)
                throw new Error('projection: event without taskId');
            const t = state.tasks.get(ev.taskId);
            if (!t)
                throw new Error('projection: unknown task ' + ev.taskId);
            const updated = { ...t, status: transitionTask(t.status, ev.kind) };
            if (ev.kind === 'task/heartbeat')
                updated.heartbeats = [...t.heartbeats, ev.at];
            // RC4：infra 失败不计入 attempts（瞬时基础设施错误不烧重试预算）；任务质量失败正常 +1
            if (ev.kind === 'task/failed' && !ev.payload['infra'])
                updated.attempts = t.attempts + 1;
            if (ev.kind === 'task/unblocked')
                updated.attempts = 0; // RC4：人工解除阻塞 → 重试预算重置
            if (ev.kind === 'task/completed') {
                const p = ev.payload;
                next.handoffs = new Map(state.handoffs).set(ev.taskId, p);
            }
            next.tasks = new Map(state.tasks).set(ev.taskId, updated);
            break;
        }
        // 评审事件（交付质量链）：非状态转换——按 payload.targetTaskId 更新被评审任务 reviewStatus
        case 'review/passed':
        case 'review/failed':
        case 'review/gave-up': {
            const targetId = String(ev.payload['targetTaskId'] ?? '');
            const t = state.tasks.get(targetId);
            if (!t)
                throw new Error('projection: unknown review target ' + targetId);
            const status = ev.kind === 'review/passed' ? 'passed' : ev.kind === 'review/failed' ? 'failed' : 'gave-up';
            next.tasks = new Map(state.tasks).set(targetId, { ...t, reviewStatus: status });
            break;
        }
        case 'spec-card/created':
        case 'spec-card/edited': {
            const p = ev.payload;
            next.specCards = new Map(state.specCards).set(p.id, p);
            // 规格卡创建时把链路的 specCardId 一并接线（事件溯源派生，无需额外事件）
            if (ev.kind === 'spec-card/created') {
                const c = state.chains.get(p.chainId);
                if (c && !c.specCardId) {
                    next.chains = new Map(state.chains).set(p.chainId, { ...c, specCardId: p.id });
                }
            }
            break;
        }
        case 'spec-card/approved': {
            const id = String(ev.payload['id'] ?? '');
            const s = state.specCards.get(id);
            if (!s)
                throw new Error('projection: unknown spec card ' + id);
            next.specCards = new Map(state.specCards).set(id, { ...s, status: transitionSpecCard(s.status, ev.kind), approvedAt: ev.at, approvedBy: ev.author });
            break;
        }
    }
    return next;
}
export function project(events) {
    return events.reduce(applyTo, empty());
}
