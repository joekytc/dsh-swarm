// client/timeline-model.ts — 轨迹 tab 纯投影（TDD）：事件 → 人类可读时间线条目。
// 只做展示层派生，不触碰领域事件结构。
import type { EventKind, KanbanEvent } from '../src/domain/types.js';

/** 轨迹单条目：心跳折叠后的事件 + 展示派生字段。 */
export interface TimelineItem {
  seq: number;
  kind: EventKind;
  label: string;
  author: string;
  at: number;
  /** 心跳折叠：连续心跳数量（非心跳条目为 undefined）。 */
  count?: number;
  /** 心跳折叠：末条心跳时间。 */
  lastAt?: number;
  /** 摘要（payload 关键字段），无可展示则为空串。 */
  summary: string;
  /** 异常事件（阻塞/失败/评审驳回/超限放弃/越权警告）醒目标红。 */
  exception: boolean;
  /** 状态语义（物流式四态配色）。 */
  status: TimelineStatus;
}

/** 节点状态语义：neutral 常规 / running 进行中 / success 成功 / exception 异常。 */
export type TimelineStatus = 'neutral' | 'running' | 'success' | 'exception';

/** 异常事件全集（红系高亮）。 */
const EXCEPTION_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'task/blocked', 'task/failed', 'review/failed', 'review/gave-up', 'chain/audit-warning', 'chain/aborted',
]);

/** 四态状态映射：异常集优先，其余按成功/进行中/中性归类。 */
const STATUS_OF: Record<EventKind, TimelineStatus> = {
  'chain/created': 'neutral',
  'chain/executing': 'running',
  'chain/completed': 'success',
  'chain/aborted': 'exception',
  'chain/root-task-set': 'neutral',
  'chain/audit-warning': 'exception',
  'chain/audit-confirmed': 'neutral',
  'chain/title-updated': 'neutral',
  'spec-card/created': 'neutral',
  'spec-card/edited': 'neutral',
  'spec-card/approved': 'success',
  'task/created': 'neutral',
  'task/claimed': 'running',
  'task/heartbeat': 'running',
  'task/commented': 'neutral',
  'task/completed': 'success',
  'task/blocked': 'exception',
  'task/unblocked': 'neutral',
  'task/archived': 'neutral',
  'task/failed': 'exception',
  'task/renamed': 'neutral',
  'review/passed': 'success',
  'review/failed': 'exception',
  'review/gave-up': 'exception',
};

export function timelineStatusOf(kind: EventKind): TimelineStatus {
  return STATUS_OF[kind] ?? 'neutral';
}

/** kind → 中文动作标签（缺省回退裸 kind）。 */
const KIND_LABEL: Record<EventKind, string> = {
  'chain/created': '链路创建',
  'chain/executing': '链路开始执行',
  'chain/completed': '链路完成',
  'chain/aborted': '链路中止',
  'chain/root-task-set': '设为根任务',
  'chain/audit-warning': '越权警告',
  'chain/audit-confirmed': '越权已确认',
  'chain/title-updated': '链路改名',
  'spec-card/created': '规格卡创建',
  'spec-card/edited': '规格卡编辑',
  'spec-card/approved': '规格卡批准',
  'task/created': '任务创建',
  'task/claimed': '任务认领',
  'task/heartbeat': '任务心跳',
  'task/commented': '评论',
  'task/completed': '任务完成',
  'task/blocked': '任务阻塞',
  'task/unblocked': '解除阻塞',
  'task/archived': '任务归档',
  'task/failed': '任务失败',
  'task/renamed': '任务改名',
  'review/passed': '评审通过',
  'review/failed': '评审驳回',
  'review/gave-up': '评审超限放弃',
};

/** author id → 友好名（复用 ROLE_NAME 语义，system/human 另映射）。 */
const AUTHOR_NAME: Record<string, string> = {
  v: 'orchestrator', p: 'planner', w: 'wiki-bridge', d: 'fullstack-dev',
  pt: 'plan-review', dt: 'impl-review', system: '系统', human: '你',
};

export function eventLabelOf(kind: EventKind): string {
  return KIND_LABEL[kind] ?? kind;
}

export function isExceptionEvent(e: KanbanEvent): boolean {
  return EXCEPTION_KINDS.has(e.kind);
}

export function authorNameOf(author: string): string {
  return AUTHOR_NAME[author] ?? author;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** 取字符串字段，缺失/非字符串返回 ''（优雅降级）。 */
function strField(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

/** 截断长文本（>120 字），不截断短文本。 */
function truncate(text: string, max = 120): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** 提取事件 payload 的展示摘要（按 kind 分支，缺失字段降级为空）。 */
export function eventSummary(e: KanbanEvent): string {
  const payload = asRecord(e.payload);
  switch (e.kind) {
    case 'task/completed': {
      const summary = truncate(strField(payload, 'summary'));
      return summary;
    }
    case 'task/blocked':
    case 'task/failed':
      return truncate(strField(payload, 'reason'));
    case 'task/commented':
      return truncate(strField(payload, 'body'));
    case 'task/renamed':
    case 'chain/title-updated': {
      const from = strField(payload, 'from');
      const to = strField(payload, 'to');
      return from || to ? `${from} → ${to}` : '';
    }
    case 'review/passed':
    case 'review/failed':
    case 'review/gave-up': {
      const evidence = asRecord(payload['evidence']);
      const verdict = strField(evidence, 'verdict') || strField(payload, 'verdict');
      const issues = Array.isArray(evidence['issues']) ? (evidence['issues'] as unknown[]).length : undefined;
      const parts: string[] = [];
      if (verdict) parts.push(`verdict: ${verdict}`);
      if (issues !== undefined) parts.push(`issues: ${issues}`);
      const reason = strField(payload, 'reason');
      if (reason) parts.push(reason);
      return truncate(parts.join(' · '));
    }
    default:
      return '';
  }
}

/** 相邻连续心跳折叠为一条（count + lastAt），其余事件原样透传；最新在上（seq 降序）。 */
export function foldTimeline(events: KanbanEvent[]): TimelineItem[] {
  const sorted = [...events].sort((a, b) => b.seq - a.seq);
  const items: TimelineItem[] = [];
  for (const e of sorted) {
    if (e.kind !== 'task/heartbeat') {
      items.push({
        seq: e.seq,
        kind: e.kind,
        label: eventLabelOf(e.kind),
        author: authorNameOf(e.author),
        at: e.at,
        summary: eventSummary(e),
        exception: isExceptionEvent(e),
        status: timelineStatusOf(e.kind),
      });
      continue;
    }
    // 与上一条（seq 更大、更晚）同为心跳 → 折叠计数
    const prev = items[items.length - 1];
    if (prev && prev.kind === 'task/heartbeat') {
      prev.count = (prev.count ?? 1) + 1;
      prev.lastAt = e.at;
    } else {
      items.push({
        seq: e.seq,
        kind: e.kind,
        label: eventLabelOf(e.kind),
        author: authorNameOf(e.author),
        at: e.at,
        lastAt: e.at,
        count: 1,
        summary: '',
        exception: false,
        status: timelineStatusOf(e.kind),
      });
    }
  }
  return items;
}
