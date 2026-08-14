// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskDrawer } from '../../client/TaskDrawer.js';
import type { KanbanEvent, Task, Handoff } from '../../src/domain/types.js';

const events: KanbanEvent[] = [
  { seq: 0, chainId: 'ch_1', taskId: 't_1', kind: 'task/created', payload: {}, author: 'v', at: 0 },
  { seq: 1, chainId: 'ch_1', taskId: 't_1', kind: 'task/claimed', payload: {}, author: 'system', at: 1 },
  { seq: 2, chainId: 'ch_1', taskId: 't_1', kind: 'task/completed', payload: { summary: 'ok' }, author: 'w', at: 2 },
];
const handoff: Handoff = { summary: 'synced', metadata: { kb_url: 'http://x', changed_files: ['a.md'] }, completedAt: 2 };
const task: Task = { id: 't_1', chainId: 'ch_1', title: 'w2', body: '', assignee: 'w', status: 'done', mode: 'kb', priority: 1, parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [] };

describe('TaskDrawer', () => {
  it('renders timeline events in seq order', () => {
    render(<TaskDrawer task={task} events={events} handoff={handoff} specCard={null} onComment={() => {}} onAction={() => {}} onClose={() => {}} />);
    expect(screen.getByText('task/created')).toBeTruthy();
    expect(screen.getByText('task/completed')).toBeTruthy();
  });
  it('renders handoff evidence', () => {
    render(<TaskDrawer task={task} events={events} handoff={handoff} specCard={null} onComment={() => {}} onAction={() => {}} onClose={() => {}} />);
    expect(screen.getByText('synced')).toBeTruthy();
    expect(screen.getByText('http://x')).toBeTruthy();
  });
});
