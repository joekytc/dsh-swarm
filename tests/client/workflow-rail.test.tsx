// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkflowRail } from '../../client/WorkflowRail.js';
import { deriveWorkflowBoard } from '../../client/workflow-model.js';
import { workflowFixture } from './workflow-fixtures.js';

const views = () => deriveWorkflowBoard(workflowFixture(), { selectedTaskId: null, now: 10_000 });

describe('WorkflowRail', () => {
  it('expands the active chain and leaves a blocked warning visible when collapsed', () => {
    const fixture = workflowFixture();
    fixture.tasks.get('t_d')!.title = '实现认证中间件';
    render(<WorkflowRail chains={deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 })} expandedChainId="ch_running" query="" onExpand={() => {}} onOpenTask={() => {}} />);
    expect(screen.getByRole('button', { name: /用户登录重构/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('实现认证中间件')).toBeTruthy();
    expect(screen.getAllByText(/kb-unreachable/).length).toBeGreaterThan(0);
  });

  it('filters by task title without losing the blocked summary', () => {
    const fixture = workflowFixture();
    fixture.tasks.get('t_blocked')!.title = '补充外部 API 事实';
    fixture.tasks.get('t_d')!.title = '实现认证中间件';
    render(<WorkflowRail chains={deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 })} expandedChainId="ch_running" query="外部 API" onExpand={() => {}} onOpenTask={() => {}} />);
    expect(screen.getByText('补充外部 API 事实')).toBeTruthy();
    expect(screen.queryByText('实现认证中间件')).toBeNull();
    expect(screen.getAllByText(/kb-unreachable/).length).toBeGreaterThan(0);
  });
});
