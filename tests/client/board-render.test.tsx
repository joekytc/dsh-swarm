// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BoardCard } from '../../client/BoardCard.js';
import type { Task, Chain } from '../../src/domain/types.js';

const chain: Chain = { id: 'ch_1', title: 'c', status: 'executing', rootTaskId: 't_1', specCardId: null, ownerSessionId: 's', createdAt: 0 };
const task: Task = { id: 't_1', chainId: 'ch_1', title: 'prefetch repo', body: '', assignee: 'w', status: 'running', mode: 'file', priority: 1, parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [] };

describe('BoardCard', () => {
  it('shows role badge, mode label and title', () => {
    render(<BoardCard task={task} chain={chain} specCard={null} onOpen={() => {}} />);
    expect(screen.getByText('prefetch repo')).toBeTruthy();
    expect(screen.getByText('W')).toBeTruthy();
    expect(screen.getByText('file')).toBeTruthy();
  });
});
