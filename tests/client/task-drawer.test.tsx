// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TaskDrawer } from '../../client/TaskDrawer.js';
import type { Chain, KanbanEvent, Task, Handoff, SpecCard } from '../../src/domain/types.js';

const events: KanbanEvent[] = [
  { seq: 0, chainId: 'ch_1', taskId: 't_1', kind: 'task/created', payload: {}, author: 'v', at: 0 },
  { seq: 1, chainId: 'ch_1', taskId: 't_1', kind: 'task/claimed', payload: {}, author: 'system', at: 1 },
  { seq: 2, chainId: 'ch_1', taskId: 't_1', kind: 'task/completed', payload: { summary: 'ok' }, author: 'w', at: 2 },
];
const handoff: Handoff = { summary: 'synced', metadata: { kb_url: 'http://x', changed_files: ['a.md'] }, completedAt: 2 };
const task: Task = { id: 't_1', chainId: 'ch_1', title: 'w2', body: '', assignee: 'w', status: 'done', mode: 'kb', priority: 1, parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [] };
const chain: Chain = { id: 'ch_1', title: '用户登录重构', status: 'executing', rootTaskId: task.id, specCardId: 'sc_1', ownerSessionId: 's', createdAt: 0 };
const specCard: SpecCard = {
  id: 'sc_1', chainId: chain.id, status: 'approved',
  sections: { problem: 'Problem text', solution: 'Solution text', user_stories: ['Story'], impl_decisions: ['Decision'], testing: 'Testing text', out_of_scope: 'Out text' },
  attachments: [], rawDialogueRef: null, approvedAt: 1, approvedBy: 'human',
};

function renderDetail() {
  return render(
    <TaskDrawer
      task={task} chain={chain} events={events} handoff={handoff} parentHandoffs={[]}
      specCard={specCard} upstream={[]} downstream={[]} onComment={() => {}} onAction={() => {}} onClose={() => {}}
    />,
  );
}

describe('TaskDrawer', () => {
  it('renders overview first and exposes all five tabs', () => {
    renderDetail();
    expect(screen.getByRole('tab', { name: '概览', selected: true })).toBeTruthy();
    for (const name of ['轨迹', '交接', '规格', '评论']) expect(screen.getByRole('tab', { name })).toBeTruthy();
    expect(screen.getByText('W / wiki-bridge')).toBeTruthy();
  });

  it('shows structured handoff evidence and approved spec as read-only', () => {
    renderDetail();
    fireEvent.click(screen.getByRole('tab', { name: '交接' }));
    expect(screen.getByText('synced')).toBeTruthy();
    expect(screen.getByText((content) => content.includes('a.md'))).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '规格' }));
    expect(screen.getAllByText(/Problem/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox', { name: /Problem/ })).toBeNull();
  });

  it('shows only actions legal for the current task status', () => {
    renderDetail();
    expect(screen.queryByRole('button', { name: '阻塞' })).toBeNull();
    expect(screen.queryByRole('button', { name: '解除阻塞' })).toBeNull();
    expect(screen.getByRole('button', { name: '归档' })).toBeTruthy();
  });
});
