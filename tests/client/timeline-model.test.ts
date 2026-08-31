// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { KanbanEvent } from '../../src/domain/types.js';
import {
  eventLabelOf, isExceptionEvent, eventSummary, foldTimeline, authorNameOf, timelineStatusOf,
  type TimelineItem, type TimelineStatus,
} from '../../client/timeline-model.js';

const base = (over: Partial<KanbanEvent>): KanbanEvent => ({
  seq: 0, chainId: 'ch_1', taskId: 't_1', kind: 'task/created', payload: {}, author: 'v', at: 0,
  ...over,
});

describe('eventLabelOf', () => {
  it('maps every kind to a Chinese label', () => {
    const kinds: KanbanEvent['kind'][] = [
      'task/created', 'task/claimed', 'task/heartbeat', 'task/commented',
      'task/completed', 'task/blocked', 'task/unblocked', 'task/archived',
      'task/failed', 'task/renamed',
      'chain/created', 'chain/executing', 'chain/completed', 'chain/aborted',
      'chain/root-task-set', 'chain/title-updated', 'chain/audit-warning', 'chain/audit-confirmed',
      'spec-card/created', 'spec-card/edited', 'spec-card/approved',
      'review/passed', 'review/failed', 'review/gave-up',
    ];
    for (const kind of kinds) {
      expect(eventLabelOf(kind)).toBeTruthy();
    }
  });

  it('falls back to the raw kind for unknown events', () => {
    expect(eventLabelOf('task/whatever' as never)).toBe('task/whatever');
  });
});

describe('isExceptionEvent', () => {
  const cases: Array<[KanbanEvent['kind'], boolean]> = [
    ['task/blocked', true],
    ['task/failed', true],
    ['review/failed', true],
    ['review/gave-up', true],
    ['chain/audit-warning', true],
    ['task/created', false],
    ['task/completed', false],
    ['task/claimed', false],
    ['review/passed', false],
    ['task/heartbeat', false],
  ];
  it.each(cases)('kind=%s -> %s', (kind, expected) => {
    expect(isExceptionEvent(base({ kind }))).toBe(expected);
  });
});

describe('eventSummary', () => {
  it('extracts summary from task/completed and drops noisy metadata', () => {
    const e = base({
      kind: 'task/completed',
      payload: {
        summary: 'KB 同步完成',
        metadata: { kb_url: 'http://x', branch: 'master', commit_hash: 'abc123', changed_files: ['a.md'] },
        completedAt: 2,
      },
    });
    expect(eventSummary(e)).toBe('KB 同步完成');
  });

  it('extracts reason from task/blocked and task/failed', () => {
    expect(eventSummary(base({ kind: 'task/blocked', payload: { reason: 'waiting on kb' } }))).toBe('waiting on kb');
    expect(eventSummary(base({ kind: 'task/failed', payload: { reason: 'build broke', infra: true } }))).toBe('build broke');
  });

  it('extracts body from task/commented', () => {
    expect(eventSummary(base({ kind: 'task/commented', payload: { body: '返工：修复 X' } }))).toBe('返工：修复 X');
  });

  it('shows rename as from → to', () => {
    expect(eventSummary(base({ kind: 'task/renamed', payload: { from: '旧', to: '新' } }))).toBe('旧 → 新');
    expect(eventSummary(base({ kind: 'chain/title-updated', payload: { from: 'A', to: 'B' } }))).toBe('A → B');
  });

  it('summarises review events with verdict and issue count', () => {
    const ev = base({
      kind: 'review/failed',
      payload: { reviewTaskId: 't_r', targetTaskId: 't_1', evidence: { verdict: 'fail', issues: [{ severity: 'high' }, { severity: 'low' }] } },
    });
    expect(eventSummary(ev)).toContain('fail');
    expect(eventSummary(ev)).toContain('2');
  });

  it('degrades gracefully when payload fields are missing', () => {
    expect(() => eventSummary(base({ kind: 'task/completed', payload: {} }))).not.toThrow();
    expect(eventSummary(base({ kind: 'task/completed', payload: {} }))).toBe('');
    expect(() => eventSummary(base({ kind: 'review/failed', payload: { evidence: { issues: 'oops' } } }))).not.toThrow();
    expect(eventSummary(base({ kind: 'task/claimed', payload: {} }))).toBe('');
  });

  it('returns empty for heartbeat/archived/etc with no payload', () => {
    expect(eventSummary(base({ kind: 'task/claimed', payload: {} }))).toBe('');
    expect(eventSummary(base({ kind: 'task/archived', payload: {} }))).toBe('');
  });
});

describe('authorNameOf', () => {
  it('maps role ids to friendly names', () => {
    expect(authorNameOf('v')).toBe('orchestrator');
    expect(authorNameOf('p')).toBe('planner');
    expect(authorNameOf('w')).toBe('wiki-bridge');
    expect(authorNameOf('d')).toBe('fullstack-dev');
    expect(authorNameOf('pt')).toBe('plan-review');
    expect(authorNameOf('dt')).toBe('impl-review');
  });

  it('maps system and human', () => {
    expect(authorNameOf('system')).toBe('系统');
    expect(authorNameOf('human')).toBe('你');
  });

  it('falls back to the raw author for unknown ids', () => {
    expect(authorNameOf('agent-xyz')).toBe('agent-xyz');
  });
});

describe('timelineStatusOf', () => {
  const cases: Array<[KanbanEvent['kind'], TimelineStatus]> = [
    ['task/completed', 'success'],
    ['review/passed', 'success'],
    ['chain/completed', 'success'],
    ['spec-card/approved', 'success'],
    ['task/claimed', 'running'],
    ['task/heartbeat', 'running'],
    ['chain/executing', 'running'],
    ['task/blocked', 'exception'],
    ['task/failed', 'exception'],
    ['review/failed', 'exception'],
    ['review/gave-up', 'exception'],
    ['chain/aborted', 'exception'],
    ['task/created', 'neutral'],
    ['task/commented', 'neutral'],
    ['task/renamed', 'neutral'],
  ];
  it.each(cases)('kind=%s -> %s', (kind, expected) => {
    expect(timelineStatusOf(kind)).toBe(expected);
  });
});

describe('foldTimeline', () => {
  it('returns a descending (newest first) list of non-heartbeat events', () => {
    const events = [
      base({ seq: 2, kind: 'task/completed', payload: { summary: 'ok' } }),
      base({ seq: 1, kind: 'task/claimed', payload: {} }),
      base({ seq: 0, kind: 'task/created', payload: { title: 'T' } }),
    ];
    const items = foldTimeline(events);
    expect(items.map((i) => i.seq)).toEqual([2, 1, 0]);
    expect(items[0]).toMatchObject({ kind: 'task/completed', label: '任务完成', summary: 'ok', status: 'success' });
    expect(items[2]).toMatchObject({ kind: 'task/created', label: '任务创建', status: 'neutral' });
    expect(items[2].count).toBeUndefined();
  });

  it('folds consecutive heartbeats into a single counted item', () => {
    const events = [
      base({ seq: 10, kind: 'task/heartbeat', author: 'd', at: 1000 }),
      base({ seq: 11, kind: 'task/heartbeat', author: 'd', at: 2000 }),
      base({ seq: 12, kind: 'task/heartbeat', author: 'd', at: 3000 }),
    ];
    const items = foldTimeline(events);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'task/heartbeat', label: '任务心跳', count: 3, at: 3000, lastAt: 1000 });
  });

  it('keeps non-consecutive heartbeats as separate items', () => {
    const events = [
      base({ seq: 10, kind: 'task/heartbeat', author: 'd', at: 1000 }),
      base({ seq: 11, kind: 'task/commented', payload: { body: 'hi' }, at: 1500 }),
      base({ seq: 12, kind: 'task/heartbeat', author: 'd', at: 2000 }),
    ];
    const items = foldTimeline(events);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: 'task/heartbeat', count: 1 });
    expect(items[1]).toMatchObject({ kind: 'task/commented' });
    expect(items[2]).toMatchObject({ kind: 'task/heartbeat', count: 1 });
  });

  it('marks exception items', () => {
    const items = foldTimeline([
      base({ seq: 1, kind: 'task/blocked', payload: { reason: 'x' } }),
      base({ seq: 2, kind: 'task/completed', payload: { summary: 'y' } }),
    ]);
    // 倒序：completed(seq2) 在前，blocked(seq1) 在后
    expect(items[0]).toMatchObject({ exception: false, status: 'success' });
    expect(items[1]).toMatchObject({ exception: true, status: 'exception' });
  });

  it('does not throw on empty input', () => {
    expect(foldTimeline([])).toEqual([]);
  });
});
