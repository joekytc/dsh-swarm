import { buildChecklistSlug } from '../wiki/page-path.js';
export function validateLearning(raw) {
    const errors = [];
    if (typeof raw !== 'object' || raw === null)
        return ['learning must be an object'];
    const l = raw;
    for (const [label, key] of [['title', 'title'], ['lesson', 'lesson'], ['evidence', 'evidence']]) {
        if (typeof l[key] !== 'string' || l[key].trim().length === 0)
            errors.push(`learning.${label} must be a non-empty string`);
    }
    if (typeof l['title'] === 'string' && l['title'].length > 80)
        errors.push('learning.title must be <= 80 chars');
    if (l['tags'] !== undefined && !Array.isArray(l['tags']))
        errors.push('learning.tags must be an array of strings');
    if (Array.isArray(l['tags']) && l['tags'].some((v) => typeof v !== 'string'))
        errors.push('learning.tags must be an array of strings');
    return errors;
}
export function formatLearningBody(entry, created = new Date()) {
    const date = created.toISOString().slice(0, 10);
    const lines = [
        '---',
        `title: "${entry.title}"`,
        'type: learning',
        entry.tags.length > 0 ? `tags: [${entry.tags.join(', ')}]` : 'tags: []',
        `created: ${date}`,
        '---',
        '',
        `# 【Learning】${entry.title}`,
        '',
        '## 教训',
        entry.lesson,
        '',
        '## 证据',
        entry.evidence,
    ];
    if (entry.tags.length > 0)
        lines.push('', '## 适用场景', ...entry.tags.map((t) => `- ${t}`));
    return lines.join('\n');
}
export function buildMemoryIndexBlock(entries) {
    if (entries.length === 0)
        return null;
    const lines = ['## KB 记忆索引（自动注入）'];
    for (const e of entries) {
        const title = e.title.length > 60 ? e.title.slice(0, 60) + '…' : e.title;
        lines.push(`- ${e.kind === 'learning' ? 'Learning' : '清单/计划/结果'}：[#/page/${e.path}](#/page/${e.path}) ${title}`);
    }
    lines.push('（需全文调 planning_memory_recall）');
    return lines.join('\n');
}
export function weightedRank(items, scoreOf, timeOf) {
    if (items.length === 0)
        return items;
    const scores = items.map(scoreOf);
    const times = items.map(timeOf);
    const sMin = Math.min(...scores), sMax = Math.max(...scores);
    const tMin = Math.min(...times), tMax = Math.max(...times);
    const sRange = sMax - sMin || 1;
    const tRange = tMax - tMin || 1;
    const rank = (x) => 0.7 * ((scoreOf(x) - sMin) / sRange) + 0.3 * ((timeOf(x) - tMin) / tRange);
    return [...items].sort((a, b) => rank(b) - rank(a));
}
export function buildRepoSlug(workspaceDir) {
    const base = workspaceDir.replace(/\/+$/, '').split('/').pop() ?? '';
    return buildChecklistSlug(base);
}
// ── Task 4：证据包 + 链解析 ──────────────────────────────────────────
const truncate = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
/** 链上下文头：链标题 + 规格卡 problem 首行。 */
function chainContext(state, chainId) {
    const chain = state.chains.get(chainId);
    if (!chain)
        return '';
    const spec = chain.specCardId ? state.specCards.get(chain.specCardId) : undefined;
    const problem = spec?.sections.problem ? spec.sections.problem.split('\n')[0].slice(0, 200) : '';
    return [chain.title, problem].filter(Boolean).join(' — ');
}
/** 机械提取四类信号（事件流/投影，禁 LLM 猜测），渲染紧凑 markdown。 */
export function buildLearningBrief(state, chainId) {
    const header = ['## 链上下文', chainContext(state, chainId), ''];
    const sections = [];
    const chainEvents = state.events.filter((e) => e.chainId === chainId);
    const reviewFailed = chainEvents.filter((e) => e.kind === 'review/failed');
    if (reviewFailed.length > 0) {
        const lines = ['### 评审失败'];
        for (const e of reviewFailed.slice(-5)) {
            const issues = e.payload.evidence?.issues ?? [];
            for (const i of issues.slice(0, 5))
                lines.push(`- [${i.severity}] ${i.title} — ${truncate(i.detail, 200)}`);
        }
        sections.push(lines.join('\n'));
    }
    const blocked = chainEvents.filter((e) => e.kind === 'task/blocked');
    if (blocked.length > 0) {
        const lines = ['### 任务阻塞'];
        for (const e of blocked.slice(-5)) {
            const task = e.taskId ? state.tasks.get(e.taskId) : undefined;
            const reason = typeof e.payload.reason === 'string' ? e.payload.reason : '';
            lines.push(`- ${task?.title ?? e.taskId} — ${truncate(reason, 200)}`);
        }
        sections.push(lines.join('\n'));
    }
    const reworks = [...state.tasks.values()].filter((t) => t.chainId === chainId && t.reworkOfTaskId !== null);
    if (reworks.length > 0) {
        const lines = ['### 返工卡'];
        for (const t of reworks.slice(-5))
            lines.push(`- [返工×${t.reviewAttempt}] ${t.title}（原卡 ${t.reworkOfTaskId}）`);
        sections.push(lines.join('\n'));
    }
    const audit = chainEvents.filter((e) => e.kind === 'chain/audit-warning');
    if (audit.length > 0) {
        const lines = ['### 审计警告'];
        for (const e of audit.slice(-5)) {
            const evidence = e.payload.evidence ?? [];
            for (const ev of evidence.slice(0, 5))
                lines.push(`- [${ev.source}] ${truncate(ev.detail, 200)}`);
        }
        sections.push(lines.join('\n'));
    }
    if (sections.length === 0)
        return [...header, '（无机械信号，可基于对话观察蒸馏）'].join('\n');
    return [...header, ...sections].join('\n');
}
/** /learning rest → 链解析：空→最近链；精确 id→命中；子串匹配→单命中或候选列表（≤3）；无→null。 */
export function resolveLearningChainId(state, rest) {
    const trimmed = rest.trim();
    if (!trimmed) {
        const latest = [...state.chains.values()].at(-1);
        return latest ? { chainId: latest.id } : null;
    }
    if (state.chains.has(trimmed))
        return { chainId: trimmed };
    const matches = [...state.chains.values()].filter((c) => {
        if (c.title.includes(trimmed))
            return true;
        const spec = c.specCardId ? state.specCards.get(c.specCardId) : undefined;
        return spec?.sections.problem.includes(trimmed) ?? false;
    }).slice(0, 3);
    if (matches.length === 1)
        return { chainId: matches[0].id };
    if (matches.length === 0)
        return null;
    return { candidates: matches.map((c) => ({ chainId: c.id, title: c.title })) };
}
