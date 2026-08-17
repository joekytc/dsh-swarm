// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KanbanBoard } from '../../client/KanbanBoard.js';
import type { BoardClientSnapshot } from '../../client/board-store.js';
import { workflowFixture } from './workflow-fixtures.js';

function snapshot(over: Partial<BoardClientSnapshot> = {}): BoardClientSnapshot {
  return { board: workflowFixture(), lastSeq: 9, connection: 'ready', lastSuccessAt: 1, error: null, actionError: null, ...over };
}

describe('KanbanBoard', () => {
  it('toggles chain expansion when the title is clicked again', () => {
    history.replaceState({}, '');
    render(<KanbanBoard snapshot={snapshot()} postAction={async () => ({})} />);
    const title = screen.getByRole('button', { name: /用户登录重构/ });
    expect(title.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(title);
    expect(title.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(title);
    expect(title.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the archived task detail read-only until returning to the list', () => {
    history.replaceState({ kanbanTaskId: 't_pre' }, '');
    const fixture = workflowFixture();
    for (const t of fixture.tasks.values()) if (t.chainId === 'ch_running') t.status = 'archived';
    const { unmount } = render(<KanbanBoard snapshot={snapshot({ board: fixture })} postAction={async () => ({})} />);
    expect(screen.getByRole('button', { name: '返回任务列表' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '概览' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '归档' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: '添加评论' })).toBeNull();
    unmount();
  });
});
