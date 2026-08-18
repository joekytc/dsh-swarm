import { describe, it, expect } from 'vitest';
import { hasDeliveryEvidence } from '../../src/domain/delivery-evidence.js';
import type { Handoff } from '../../src/domain/types.js';

const h = (metadata: Record<string, unknown>): Handoff => ({ summary: 's', metadata, completedAt: 1 });

describe('hasDeliveryEvidence (C1/C2 交付物证据判定)', () => {
  it('requires changed_files + (commit_hash | push)', () => {
    expect(hasDeliveryEvidence(h({ changed_files: ['a.ts'], commit_hash: 'abc', push: true }))).toBe(true);
    expect(hasDeliveryEvidence(h({ changed_files: ['a.ts'], commit_hash: 'abc' }))).toBe(true);
    expect(hasDeliveryEvidence(h({ changed_files: ['a.ts'], push: true }))).toBe(true);
    expect(hasDeliveryEvidence(h({ changed_files: 'README.md', commit_hash: 'abc' }))).toBe(true);
    expect(hasDeliveryEvidence(h({ changed_files: [] }))).toBe(false);
    expect(hasDeliveryEvidence(h({ changed_files: '' }))).toBe(false);
    expect(hasDeliveryEvidence(h({ changed_files: ['a.ts'] }))).toBe(false); // 无 commit/push
    expect(hasDeliveryEvidence(h({ commit_hash: 'abc', push: true }))).toBe(false); // 无 changed_files
    expect(hasDeliveryEvidence(h({}))).toBe(false);
    expect(hasDeliveryEvidence(undefined)).toBe(false);
  });
});
