// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkflowRail } from '../../client/WorkflowRail.js';
import { deriveWorkflowBoard } from '../../client/workflow-model.js';
import { workflowFixture } from './workflow-fixtures.js';

const views = () => deriveWorkflowBoard(workflowFixture(), { selectedTaskId: null, now: 10_000 });

function railProps(over: Partial<Parameters<typeof WorkflowRail>[0]> = {}) {
  return {
    chains: views(), expandedChainId: 'ch_running', query: '',
    archivedOnly: false, onToggleArchived: () => {}, onExpand: () => {}, onOpenTask: () => {}, ...over,
  };
}

describe('WorkflowRail', () => {
  it('expands the active chain and leaves a blocked warning visible when collapsed', () => {
    const fixture = workflowFixture();
    fixture.tasks.get('t_d')!.title = '实现认证中间件';
    render(<WorkflowRail {...railProps({ chains: deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 }) })} />);
    expect(screen.getByRole('button', { name: /用户登录重构/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('实现认证中间件')).toBeTruthy();
    expect(screen.getAllByText(/kb-unreachable/).length).toBeGreaterThan(0);
  });

  it('filters by task title without losing the blocked summary', () => {
    const fixture = workflowFixture();
    fixture.tasks.get('t_blocked')!.title = '补充外部 API 事实';
    fixture.tasks.get('t_d')!.title = '实现认证中间件';
    render(<WorkflowRail {...railProps({ chains: deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 }), query: '外部 API' })} />);
    expect(screen.getByText('补充外部 API 事实')).toBeTruthy();
    expect(screen.queryByText('实现认证中间件')).toBeNull();
    expect(screen.getAllByText(/kb-unreachable/).length).toBeGreaterThan(0);
  });

  it('hides archived chains unless the completed filter is active', () => {
    const fixture = workflowFixture();
    const { unmount } = render(<WorkflowRail {...railProps({ chains: deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 }) })} />);
    expect(screen.queryByText('归档演示链路')).toBeNull();
    unmount();
    render(<WorkflowRail {...railProps({ chains: deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000, archivedOnly: true }), expandedChainId: null, archivedOnly: true })} />);
    expect(screen.getByText('归档演示链路')).toBeTruthy();
  });

  it('emits the completed-filter toggle', () => {
    const onToggleArchived = vi.fn();
    render(<WorkflowRail {...railProps({ onToggleArchived })} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '显示已完成链路' }));
    expect(onToggleArchived).toHaveBeenCalledTimes(1);
  });

  it('renders an empty state with guidance when there are no chains', () => {
    render(<WorkflowRail {...railProps({ chains: [] })} />);
    expect(screen.getByText(/暂无看板任务，输入 \/plan:/)).toBeTruthy();
  });

  it('shows a no-match state while searching an empty board', () => {
    render(<WorkflowRail {...railProps({ chains: [], query: 'zzz' })} />);
    expect(screen.getByText('无匹配链路')).toBeTruthy();
  });


  it('shows audit warning line + confirm button for unconfirmed completed chain', () => {
    const fixture = workflowFixture();
    fixture.auditWarnings.set('ch_done', {
      evidence: [{ source: 'main-session-scan', detail: '主 agent 疑似越权写工作区产物', paths: ['/x/leak.md'] }],
      warnedAt: 900, warnedSeq: 10, confirmedAt: null, confirmedBy: null, confirmedSeq: null,
    });
    const onConfirmAudit = vi.fn();
    render(<WorkflowRail {...railProps({ chains: deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 }), onConfirmAudit: onConfirmAudit as never })} />);
    expect(screen.getByText(/越权写/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /确认产物归属/ }));
    expect(onConfirmAudit).toHaveBeenCalledWith('ch_done');
  });

  it('hides the audit warning once confirmed', () => {
    const fixture = workflowFixture();
    fixture.auditWarnings.set('ch_done', {
      evidence: [{ source: 'main-session-scan', detail: 'x', paths: ['/x'] }],
      warnedAt: 900, warnedSeq: 10, confirmedAt: 1000, confirmedBy: 'human', confirmedSeq: 11,
    });
    render(<WorkflowRail {...railProps({ chains: deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 }) })} />);
    expect(screen.queryByText(/越权写/)).toBeNull();
  });

  it('highlights the related path cards of the selected chain only', () => {
    const fixture = workflowFixture();
    const views = deriveWorkflowBoard(fixture, { selectedTaskId: 't_w2', now: 10_000 });
    render(<WorkflowRail {...railProps({ chains: views, expandedChainId: 'ch_running' })} />);
    const runningSection = screen.getByText('用户登录重构').closest('section')!;
    expect(runningSection.querySelectorAll('.dsh-kb-task--related').length).toBe(5);
    const blockedSection = screen.getByText('对话导出失败修复').closest('section')!;
    expect(blockedSection.querySelectorAll('.dsh-kb-task--related').length).toBe(0);
  });
});
