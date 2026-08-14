import { describe, it, expect } from 'vitest';
import { transitionTask, transitionChain, transitionSpecCard } from '../../src/domain/state-machine.js';

describe('task state machine', () => {
  it('todo → running → done', () => {
    expect(transitionTask('todo', 'task/claimed')).toBe('running');
    expect(transitionTask('running', 'task/completed')).toBe('done');
  });
  it('running → blocked → ready', () => {
    expect(transitionTask('running', 'task/blocked')).toBe('blocked');
    expect(transitionTask('blocked', 'task/unblocked')).toBe('ready');
  });
  it('failed → running (retry) or blocked (circuit)', () => {
    expect(transitionTask('failed', 'task/claimed')).toBe('running');
    expect(transitionTask('failed', 'task/blocked')).toBe('blocked');
  });
  it('rejects illegal transition', () => {
    expect(() => transitionTask('done', 'task/claimed')).toThrow(/illegal transition/);
  });
});

describe('chain and spec card machines', () => {
  it('chain planning → executing → completed', () => {
    expect(transitionChain('planning', 'chain/executing')).toBe('executing');
    expect(transitionChain('executing', 'chain/completed')).toBe('completed');
    expect(() => transitionChain('planning', 'chain/completed')).toThrow(/illegal transition/);
  });
  it('spec card draft → approved', () => {
    expect(transitionSpecCard('draft', 'spec-card/approved')).toBe('approved');
    expect(() => transitionSpecCard('approved', 'spec-card/approved')).toThrow();
  });
});
