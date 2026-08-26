// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BoardCard } from '../../client/BoardCard.js';
import { deriveWorkflowBoard } from '../../client/workflow-model.js';
import { workflowFixture } from './workflow-fixtures.js';

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

  it('rename: edit button opens modal, save triggers onRenameTask(taskId, title)', () => {
    const fixture = workflowFixture();
    const view = deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 })
      .find((item) => item.chain.id === 'ch_running')!.tasks.find((item) => item.task.id === 't_w2')!;
    const onRenameTask = vi.fn();
    render(<BoardCard view={view} onOpen={() => {}} onRenameTask={onRenameTask as never} />);
    fireEvent.click(document.querySelector('.dsh-kb-task__rename') as HTMLElement);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'p-新' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onRenameTask).toHaveBeenCalledWith('t_w2', 'p-新');
  });
});
