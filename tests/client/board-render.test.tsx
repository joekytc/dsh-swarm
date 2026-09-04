// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoardCard } from '../../client/BoardCard.js';
import { deriveWorkflowBoard } from '../../client/workflow-model.js';
import { workflowFixture } from './workflow-fixtures.js';
import { setSessionsService } from '../../client/session-bridge.js';
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client';

describe('BoardCard', () => {
  it('shows profile, phase and title without exposing internal ids', () => {
    const fixture = workflowFixture();
    fixture.tasks.get('t_w2')!.title = 'kb 知识库同步';
    const view = deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 })
      .find((item) => item.chain.id === 'ch_running')!.tasks.find((item) => item.task.id === 't_w2')!;
    render(<BoardCard view={view} onOpen={() => {}} />);
    expect(screen.getByText('kb 知识库同步')).toBeTruthy();
    expect(screen.getByText('W')).toBeTruthy();
    expect(screen.getByText(/W2/)).toBeTruthy();
    expect(screen.queryByText('t_w2')).toBeNull();
    expect(screen.queryByText('kb')).toBeNull();
  });

  it('shows a warning icon and reason for blocked tasks', () => {
    const fixture = workflowFixture();
    const view = deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 })
      .find((item) => item.chain.id === 'ch_blocked')!.tasks.find((item) => item.task.id === 't_blocked')!;
    render(<BoardCard view={view} onOpen={() => {}} />);
    expect(document.querySelector('.dsh-kb-task__warn svg')).toBeTruthy();
    expect(screen.getByText('kb-unreachable')).toBeTruthy();
  });

  it('marks the card with the related-path class while a task is selected', () => {
    const fixture = workflowFixture();
    const view = deriveWorkflowBoard(fixture, { selectedTaskId: 't_w2', now: 10_000 })
      .find((item) => item.chain.id === 'ch_running')!.tasks.find((item) => item.task.id === 't_w2')!;
    render(<BoardCard view={view} onOpen={() => {}} />);
    expect(document.querySelector('.dsh-kb-task--related')).toBeTruthy();
  });

  it('角色卡无改名铅笔（仅需求链标题可改）', () => {
    const fixture = workflowFixture();
    const view = deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 })
      .find((item) => item.chain.id === 'ch_running')!.tasks.find((item) => item.task.id === 't_w2')!;
    render(<BoardCard view={view} onOpen={() => {}} />);
    expect(document.querySelector('.dsh-kb-task__rename')).toBeNull();
  });

  function fakeSessions(ids: string[], open: ReturnType<typeof vi.fn> = vi.fn()): ISessions {
    return { open, list: { getSnapshot: () => ({ ids }), subscribe: () => () => {} } } as unknown as ISessions;
  }

  afterEach(() => setSessionsService(null));

  it('会话 id 在宿主列表时卡行出现「会话」按钮，点击跳会话且不冒泡开详情', () => {
    const open = vi.fn();
    setSessionsService(fakeSessions(['kbn-t_w2'], open));
    const onOpen = vi.fn();
    const onOpenView = vi.fn();
    const fixture = workflowFixture();
    const view = deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 })
      .find((item) => item.chain.id === 'ch_running')!.tasks.find((item) => item.task.id === 't_w2')!;
    render(<BoardCard view={view} onOpen={onOpen} onOpenView={onOpenView} />);
    fireEvent.click(screen.getByRole('button', { name: '会话' }));
    expect(open).toHaveBeenCalledWith('kbn-t_w2');
    expect(onOpenView).toHaveBeenCalledWith('chat', 'kbn-t_w2');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('返工卡优先跳 resumeSessionId', () => {
    const open = vi.fn();
    setSessionsService(fakeSessions(['kbn-t_src'], open));
    const fixture = workflowFixture();
    fixture.tasks.get('t_w2')!.resumeSessionId = 'kbn-t_src';
    const view = deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 })
      .find((item) => item.chain.id === 'ch_running')!.tasks.find((item) => item.task.id === 't_w2')!;
    render(<BoardCard view={view} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '会话' }));
    expect(open).toHaveBeenCalledWith('kbn-t_src');
  });

  it('会话 id 不在宿主列表时不显示「会话」按钮（未派发/重启后历史会话）', () => {
    setSessionsService(fakeSessions(['kbn-other']));
    const fixture = workflowFixture();
    const view = deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 })
      .find((item) => item.chain.id === 'ch_running')!.tasks.find((item) => item.task.id === 't_w2')!;
    render(<BoardCard view={view} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: '会话' })).toBeNull();
  });
});
