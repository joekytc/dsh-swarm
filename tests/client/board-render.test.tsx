// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BoardCard } from '../../client/BoardCard.js';
import { deriveWorkflowBoard } from '../../client/workflow-model.js';
import { workflowFixture } from './workflow-fixtures.js';

describe('BoardCard', () => {
  it('shows profile, phase and title without exposing internal ids', () => {
    const fixture = workflowFixture();
    fixture.tasks.get('t_pre')!.title = 'prefetch repo';
    const view = deriveWorkflowBoard(fixture, { selectedTaskId: null, now: 10_000 })
      .find((item) => item.chain.id === 'ch_running')!.tasks.find((item) => item.task.id === 't_pre')!;
    render(<BoardCard view={view} onOpen={() => {}} />);
    expect(screen.getByText('prefetch repo')).toBeTruthy();
    expect(screen.getByText('W')).toBeTruthy();
    expect(screen.getByText(/W1-pre/)).toBeTruthy();
    expect(screen.queryByText('t_pre')).toBeNull();
    expect(screen.queryByText('file')).toBeNull();
  });
});
