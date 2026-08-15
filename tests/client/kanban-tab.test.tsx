// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KanbanTab } from '../../client/KanbanTab.js';
import type { BoardClientSnapshot, BoardStore } from '../../client/board-store.js';
import { workflowFixture } from './workflow-fixtures.js';

function fixtureStore(over: Partial<BoardClientSnapshot>): BoardStore {
  const snapshot: BoardClientSnapshot = {
    board: workflowFixture(), lastSeq: 8, connection: 'ready', lastSuccessAt: 100, error: null, actionError: null, ...over,
  };
  return {
    start: async () => {},
    stop: () => {},
    retry: async () => {},
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    postAction: async () => ({}),
  };
}

describe('KanbanTab', () => {
  it('renders full-height tab without resize handle', () => {
    render(<KanbanTab store={fixtureStore({ connection: 'ready' })} />);
    expect(document.querySelector('.dsh-kb-tab')).toBeTruthy();
    expect(document.querySelector('.dsh-kb-resize')).toBeNull();
    expect(screen.getByText('用户登录重构')).toBeTruthy();
  });

  it('renders reconnecting state without hiding the last board snapshot', () => {
    render(<KanbanTab store={fixtureStore({ connection: 'reconnecting' })} />);
    expect(screen.getByText('正在重连')).toBeTruthy();
    expect(screen.getByText('用户登录重构')).toBeTruthy();
  });

  it('shows a retry action on connection error', () => {
    let retried = 0;
    const store = fixtureStore({ connection: 'error', lastSuccessAt: 5 });
    store.retry = async () => { retried += 1; };
    render(<KanbanTab store={store} />);
    const btn = screen.getByRole('button', { name: '重试' });
    btn.click();
    expect(retried).toBe(1);
    expect(screen.getByText(/连接错误/)).toBeTruthy();
  });
});
