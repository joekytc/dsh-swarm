import { describe, it, expect } from 'vitest';
import { can } from '../../src/domain/permissions.js';
import type { Task } from '../../src/domain/types.js';

const t: Task = { id: 't_1', chainId: 'ch_1', title: 'x', body: '', assignee: 'w', status: 'ready', mode: 'kb', priority: 1, parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [] };

describe('permission matrix', () => {
  it('create-task only for v or human', () => {
    expect(can('create-task', 'v', null)).toBe(true);
    expect(can('create-task', 'human', null)).toBe(true);
    expect(can('create-task', 'p', null)).toBe(false);
    expect(can('create-task', 'w', null)).toBe(false);
    expect(can('create-task', 'd', null)).toBe(false);
  });
  it('complete only for bound task session or system (P1-4)', () => {
    expect(can('complete', 'w', t, { boundTaskId: 't_1' })).toBe(true);
    expect(can('complete', 'system', t)).toBe(true);
    // 同角色但未绑定本任务（如链上另一 W 任务的会话）→ 拒
    expect(can('complete', 'w', t)).toBe(false);
    expect(can('complete', 'w', t, { boundTaskId: 't_other' })).toBe(false);
    expect(can('complete', 'p', t, { boundTaskId: 't_1' })).toBe(false);
  });
  it('spec-edit only human; spec-attach for v/human', () => {
    expect(can('spec-edit', 'human', null)).toBe(true);
    expect(can('spec-edit', 'p', null)).toBe(false);
    expect(can('spec-attach', 'v', null)).toBe(true);
    expect(can('spec-attach', 'human', null)).toBe(true);
    expect(can('spec-attach', 'p', null)).toBe(false);
  });
  it('unblock only human', () => {
    expect(can('unblock', 'human', t)).toBe(true);
    expect(can('unblock', 'v', t)).toBe(false);
    expect(can('unblock', 'w', t)).toBe(false);
  });
  it('wiki-write only w', () => {
    expect(can('wiki-write', 'w', t)).toBe(true);
    expect(can('wiki-write', 'd', t)).toBe(false);
  });
  it('spec-approve only human', () => {
    expect(can('spec-approve', 'human', null)).toBe(true);
    expect(can('spec-approve', 'v', null)).toBe(false);
  });
});
