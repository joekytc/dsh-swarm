// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkflowRail } from '../../client/WorkflowRail.js';
import { deriveWorkflowBoard, type ChainFilter } from '../../client/workflow-model.js';
import { workflowFixture } from './workflow-fixtures.js';

const views = () => deriveWorkflowBoard(workflowFixture(), { selectedTaskId: null, now: 10_000 });

function railProps(over: Partial<Parameters<typeof WorkflowRail>[0]> = {}) {
  return {
    chains: views(), collapsedChainIds: new Set<string>(), query: '',
    statusFilter: new Set<ChainFilter>(), onToggleFilter: () => {}, onToggleChain: () => {}, onOpenTask: () => {}, ...over,
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
    render(<WorkflowRail {...railProps({ chains: deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000, statusFilter: new Set(['completed']) }), collapsedChainIds: new Set(), statusFilter: new Set(['completed']) })} />);
    expect(screen.getByText('归档演示链路')).toBeTruthy();
  });

  it('collapsed 面板默认全打开：所有链路展开 + 每条链路标题前有折叠箭头', () => {
    const fixture = workflowFixture();
    fixture.tasks.get('t_d')!.title = '实现认证中间件';
    // 受控组件需有状态驱动 onToggleChain 才生效——用有状态包装（默认 collapsed=空 → 全打开）
    const Wrapper = () => {
      const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
      return (
        <WorkflowRail
          chains={deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 })}
          collapsedChainIds={collapsed}
          query="" statusFilter={new Set<ChainFilter>()}
          onToggleFilter={() => {}}
          onToggleChain={(id) => setCollapsed((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          onOpenTask={() => {}}
        />
      );
    };
    render(<Wrapper />);
    // 默认全打开：ch_running 与 ch_blocked 都展开
    expect(screen.getByRole('button', { name: /用户登录重构/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /对话导出失败修复/ }).getAttribute('aria-expanded')).toBe('true');
    // 每条链路标题前有折叠箭头
    const chevrons = document.querySelectorAll('.dsh-kb-chain__chevron');
    expect(chevrons.length).toBeGreaterThanOrEqual(2);
    // 手动折叠 ch_running → 其任务隐藏、箭头状态旋转
    const runningTitle = screen.getByRole('button', { name: /用户登录重构/ });
    fireEvent.click(runningTitle);
    expect(runningTitle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('实现认证中间件')).toBeNull();
    fireEvent.click(runningTitle); // 再点恢复展开
    expect(runningTitle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('实现认证中间件')).toBeTruthy();
  });

  it('emits the status-filter toggle', () => {
    const onToggleFilter = vi.fn();
    render(<WorkflowRail {...railProps({ onToggleFilter })} />);
    fireEvent.click(screen.getByRole('button', { name: '执行中' }));
    expect(onToggleFilter).toHaveBeenCalledWith('executing');
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
    render(<WorkflowRail {...railProps({ chains: views, collapsedChainIds: new Set() })} />);
    const runningSection = screen.getByText('用户登录重构').closest('section')!;
    expect(runningSection.querySelectorAll('.dsh-kb-task--related').length).toBe(5);
    const blockedSection = screen.getByText('对话导出失败修复').closest('section')!;
    expect(blockedSection.querySelectorAll('.dsh-kb-task--related').length).toBe(0);
  });

  it('状态筛选 chips：多选并集过滤链路（执行中/阻塞/失败/已完成）', () => {
    const fixture = workflowFixture();
    const Wrapper = () => {
      const [filter, setFilter] = useState<Set<ChainFilter>>(new Set());
      return (
        <WorkflowRail
          chains={deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000, statusFilter: filter })}
          collapsedChainIds={new Set()}
          query=""
          statusFilter={filter}
          onToggleFilter={(f) => setFilter((prev) => { const n = new Set(prev); if (n.has(f)) n.delete(f); else n.add(f); return n; })}
          onToggleChain={() => {}}
          onOpenTask={() => {}}
        />
      );
    };
    render(<Wrapper />);
    // 四个筛选 chip 都在
    for (const label of ['执行中', '阻塞', '失败', '已完成']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    // 默认全部显示（ch_running + ch_blocked + ch_done 均可见，ch_archived 隐藏）
    expect(screen.getByText('用户登录重构')).toBeTruthy();
    expect(screen.getByText('对话导出失败修复')).toBeTruthy();
    expect(screen.queryByText('归档演示链路')).toBeNull();
    // 点「阻塞」→ 只剩 ch_blocked；再点「执行中」→ 并集（ch_blocked + ch_running）
    fireEvent.click(screen.getByRole('button', { name: '阻塞' }));
    expect(screen.queryByText('用户登录重构')).toBeNull();
    expect(screen.getByText('对话导出失败修复')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '执行中' }));
    expect(screen.getByText('用户登录重构')).toBeTruthy();
    expect(screen.getByText('对话导出失败修复')).toBeTruthy();
    // 再点「阻塞」取消 → 只剩执行中
    fireEvent.click(screen.getByRole('button', { name: '阻塞' }));
    expect(screen.queryByText('对话导出失败修复')).toBeNull();
    expect(screen.getByText('用户登录重构')).toBeTruthy();
    // 点「已完成」→ 显示 ch_done / ch_archived（归档）
    fireEvent.click(screen.getByRole('button', { name: '已完成' }));
    expect(screen.getByText('归档演示链路')).toBeTruthy();
  });
});
