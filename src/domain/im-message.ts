// src/domain/im-message.ts
// IM 投递消息渲染（纯函数）：W3 收尾判据 + markdown 模板（企微保守语法子集）+ 阻塞建议映射。
import type { BoardState, Handoff, KanbanEvent, Task } from './types.js';
import { hasDeliveryEvidence } from './delivery-evidence.js';

/** W3 收尾判据（镜像 kanban-service.completeTask 机械规则，但不含 dEvidenceOk 与链状态要求）：
 *  完成卡为 w+kb、链上无未终态卡、它是最后完成的卡、且链上存在 done 的 D 卡（防 W2 中间态误投）。 */
export function isFinalW3Completion(state: BoardState, chainId: string, completedTaskId: string): boolean {
  const task = state.tasks.get(completedTaskId);
  if (!task || task.chainId !== chainId || task.assignee !== 'w' || task.mode !== 'kb') return false;
  const chainTasks = [...state.tasks.values()].filter((t) => t.chainId === chainId);
  if (chainTasks.some((t) => t.status !== 'done' && t.status !== 'archived')) return false;
  const completedEvents = state.events.filter((e) => e.chainId === chainId && e.kind === 'task/completed' && e.taskId);
  if (completedEvents.at(-1)?.taskId !== completedTaskId) return false;
  return chainTasks.some((t) => (t.mode === 'execute' || t.mode === 'align') && t.status === 'done');
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function strMeta(handoff: Handoff | undefined, key: string): string {
  const v = (handoff?.metadata ?? {})[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** 交付汇报结构化字段（W agent 收尾时写入 W3 交接 metadata.report；内容有出处=任务卡，渲染器只定骨架）。 */
export interface ChainReportFields {
  requirement: string;
  status: string;
  branch: string;
  /** 功能清单：openspec/changes/<id>/tasks.md 勾选态逐条映射（done=已勾）。 */
  tasks: Array<{ text: string; done: boolean }>;
  acceptance: string;
  verification: string;
  leftovers: string[];
  todos: string[];
}

function reportText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function reportLines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = reportText(item);
    if (s) out.push(s);
  }
  return out;
}

/** 校验并归一 metadata.report：任一必需字段缺失/形状不符 → null（渲染回退机械格式，绝不渲染半残骨架）。 */
export function parseChainReport(raw: unknown): ChainReportFields | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const requirement = reportText(r['requirement']);
  const status = reportText(r['status']);
  const branch = reportText(r['branch']);
  const acceptance = reportText(r['acceptance']);
  const verification = reportText(r['verification']);
  if (!requirement || !status || !branch || !acceptance || !verification) return null;
  if (!Array.isArray(r['tasks']) || r['tasks'].length === 0) return null;
  const tasks: Array<{ text: string; done: boolean }> = [];
  for (const entry of r['tasks']) {
    if (typeof entry !== 'object' || entry === null) return null;
    const text = reportText((entry as Record<string, unknown>)['text']);
    const done = (entry as Record<string, unknown>)['done'];
    if (!text || typeof done !== 'boolean') return null;
    tasks.push({ text, done });
  }
  return { requirement, status, branch, tasks, acceptance, verification, leftovers: reportLines(r['leftovers']), todos: reportLines(r['todos']) };
}

/** 人工关注点：TDD 跳过声明、D 证据缺失（链完成门禁拦截）、审计警告状态。 */
function completionAttention(state: BoardState, chainId: string, dHandoff: Handoff | undefined): string[] {
  const out: string[] = [];
  const tdd = (dHandoff?.metadata ?? {})['tdd'] as { skipped?: { reason?: unknown } } | undefined;
  const skipReason = tdd?.skipped && typeof tdd.skipped['reason'] === 'string' ? tdd.skipped['reason'].trim() : '';
  if (skipReason) out.push(`TDD 曾跳过：${skipReason}`);
  if (!hasDeliveryEvidence(dHandoff)) out.push('D 卡缺 git 产物证据，链未自动收链，请人工核对');
  const audit = state.auditWarnings.get(chainId);
  if (audit && !audit.confirmedAt) out.push(`审计警告待 GUI 确认（${audit.evidence.length} 条证据）`);
  else if (audit?.confirmedAt) out.push(`审计警告已于 ${fmtTime(audit.confirmedAt)} 确认`);
  return out;
}

/** 交付汇报骨架（内容来自 W3 metadata.report，系统只定字段与顺序）。
 *  待办 = report.todos + 机械关注点（TDD 跳过/证据缺失/审计警告不因 W 遗忘而消失）；遗留为空则整节省略。 */
function renderDeliveryReport(
  chain: { title: string }, chainId: string, report: ChainReportFields,
  wHandoff: Handoff | undefined, attention: string[],
): string {
  const lines: string[] = [];
  lines.push(`**【交付汇报】${chain.title}（${chainId}）**`);
  lines.push(`需求：${report.requirement}`);
  lines.push(`状态：${report.status}`);
  lines.push(`分支：${report.branch}`);
  lines.push('功能清单：');
  for (const t of report.tasks) lines.push(`- ${t.done ? '✅' : '❌'} ${t.text}`);
  lines.push(`验收：${report.acceptance}`);
  lines.push(`验证：${report.verification}`);
  if (report.leftovers.length > 0) {
    lines.push('遗留（非阻塞）：');
    for (const l of report.leftovers) lines.push(`- ${l}`);
  }
  const todos = [...report.todos, ...attention];
  if (todos.length > 0) {
    lines.push('待办：');
    for (const t of todos) lines.push(`- ${t}`);
  }
  const kbUrl = strMeta(wHandoff, 'kb_url');
  if (kbUrl) lines.push(`KB：${kbUrl}`);
  return lines.join('\n');
}

/** 成功汇报（markdown）。判据不满足（W2 中间态/非 w:kb/非收尾）返回 null。
 *  W3 交接带合法 metadata.report → 交付汇报骨架；否则回退机械格式（旧链兼容）。 */
export function buildCompletionMessage(state: BoardState, chainId: string, completedTaskId: string, now: number): string | null {
  if (!isFinalW3Completion(state, chainId, completedTaskId)) return null;
  const chain = state.chains.get(chainId);
  if (!chain) return null;
  const chainTasks = [...state.tasks.values()].filter((t) => t.chainId === chainId);
  const wHandoff = state.handoffs.get(completedTaskId);
  const dTask = chainTasks.find((t) => (t.mode === 'execute' || t.mode === 'align') && t.status === 'done')!;
  const dHandoff = state.handoffs.get(dTask.id);
  const pTask = [...chainTasks].reverse().find((t) => t.assignee === 'p' && t.status === 'done');
  const artifacts = strMeta(pTask ? state.handoffs.get(pTask.id) : undefined, 'artifacts_path');
  const attention = completionAttention(state, chainId, dHandoff);
  const report = parseChainReport((wHandoff?.metadata ?? {})['report']);
  if (report) return renderDeliveryReport(chain, chainId, report, wHandoff, attention);
  const lines: string[] = [];
  lines.push(`**【DSH 需求完成】${chain.title}**`);
  lines.push('');
  lines.push(`**完成清单**（${fmtTime(now)}）`);
  for (const t of chainTasks) lines.push(`- ✅ ${t.title}`);
  lines.push('');
  lines.push('**产出**');
  const kbUrl = strMeta(wHandoff, 'kb_url');
  const pagePath = strMeta(wHandoff, 'page_path');
  if (kbUrl) lines.push(`- KB 文档：${kbUrl}`);
  if (pagePath) lines.push(`- KB 页：${pagePath}`);
  lines.push(`- 产出物：${artifacts || '（无）'}`);
  if (attention.length > 0) {
    lines.push('');
    lines.push('**人工关注点**');
    for (const a of attention) lines.push(`- ${a}`);
  }
  return lines.join('\n');
}

/** 阻塞建议映射表（静态工程知识，禁止模型现场生成——评审决议）。 */
const SUGGESTION_TABLE: ReadonlyArray<{ pattern: RegExp; lines: readonly string[] }> = [
  {
    pattern: /\[create-failed\]/,
    lines: [
      'V 连续多轮建卡失败：查 dispatcher.log 的 [wakeV] / [tick] error 行，确认编排会话报错原因',
      '核对 roles.models.v 模型路由配置；历史案例：网关回复缓存回放（from-cache）会致零工具调用，可更换 provider/model 后重试',
    ],
  },
  {
    pattern: /\[stall-watchdog\]/,
    lines: [
      '链持续无进展且重唤醒耗尽：查 dispatcher.log [stall-watchdog] 行与 orchestration.json 的 phase/stallCount',
      '检查最后一张卡会话（kbn-<taskId>）session.jsonl 是否空壳（仅 4 行骨架）——空壳需人工清理后删链重跑',
    ],
  },
];

export function suggestionsFor(reason: string): string[] {
  const out: string[] = [];
  for (const row of SUGGESTION_TABLE) {
    if (row.pattern.test(reason)) out.push(...row.lines);
  }
  if (out.length === 0) {
    out.push('查 events.jsonl 最近事件定位阻塞前最后一个动作');
    out.push('GUI 打开该链逐卡核对状态；人工恢复 = 删链重跑');
  }
  return out;
}

/** 链下全部 blocked 卡（title + 最近一次 task/blocked 原因）。 */
export function latestBlockedTasks(events: KanbanEvent[], tasks: Iterable<Task>, chainId: string): Array<{ id: string; title: string; reason: string }> {
  const reasons = new Map<string, string>();
  for (const e of events) {
    if (e.chainId !== chainId || e.kind !== 'task/blocked' || !e.taskId) continue;
    reasons.set(e.taskId, String(e.payload['reason'] ?? ''));
  }
  const out: Array<{ id: string; title: string; reason: string }> = [];
  for (const t of tasks) {
    if (t.chainId !== chainId || t.status !== 'blocked') continue;
    out.push({ id: t.id, title: t.title, reason: reasons.get(t.id) ?? '（原因见事件流）' });
  }
  return out;
}

/** 阻塞通知（markdown）。阻塞是系统性事件（看门狗/stall/人工），时刻 LLM 大多不在环：
 *  保持机械渲染（事实 + 静态建议，防编造），仅做视觉对齐（标题/链 id/已完成进度）。 */
export function buildBlockMessage(state: BoardState, chainId: string, chainReason: string, storageDir: string): string {
  const chain = state.chains.get(chainId);
  const blocked = latestBlockedTasks(state.events, state.tasks.values(), chainId);
  const chainTasks = [...state.tasks.values()].filter((t) => t.chainId === chainId);
  const doneCount = chainTasks.filter((t) => t.status === 'done' || t.status === 'archived').length;
  const lines: string[] = [];
  lines.push(`**【交付阻塞】${chain?.title ?? chainId}（${chainId}）**`);
  lines.push('');
  lines.push('**阻塞卡**');
  if (blocked.length === 0) lines.push('- 无（链级停滞，见阻塞原因）');
  else for (const b of blocked) lines.push(`- ${b.title}：${b.reason}`);
  lines.push('');
  lines.push('**阻塞原因**');
  lines.push(`> ${chainReason}`);
  if (chainTasks.length > 0) {
    lines.push('');
    lines.push(`**已完成**：${doneCount}/${chainTasks.length} 卡`);
  }
  lines.push('');
  lines.push('**排查建议**');
  for (const s of suggestionsFor(chainReason)) lines.push(`- ${s}`);
  lines.push('');
  lines.push('**取证路径**');
  lines.push(`- 事件：${storageDir}/events.jsonl`);
  lines.push(`- 编排：${storageDir}/orchestration.json`);
  lines.push(`- 调度：${storageDir}/dispatcher.log`);
  return lines.join('\n');
}
