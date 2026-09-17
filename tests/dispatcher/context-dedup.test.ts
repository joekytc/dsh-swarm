// tests/dispatcher/context-dedup.test.ts
import { describe, expect, it } from 'vitest';
import { slimParentMetadata } from '../../src/dispatcher/context-dedup.js';

describe('slimParentMetadata', () => {
  it('剥离 review_evidence 键（issues 单一信息源=body 清单）', () => {
    const out = slimParentMetadata({ branch: 'f/x', review_evidence: { verdict: 'fail', issues: [{ title: 'x' }] } });
    expect(out).toEqual({ branch: 'f/x' });
  });
  it('超长数组截断至 20 条并留计数', () => {
    const files = Array.from({ length: 35 }, (_, i) => `f${i}.ts`);
    const out = slimParentMetadata({ changed_files: files }) as { changed_files: unknown[] };
    expect(out.changed_files.length).toBe(21);
    expect(out.changed_files[20]).toBe('…(+15 more)');
  });
  it('短数组原样透传', () => {
    expect(slimParentMetadata({ changed_files: ['a.ts'] })).toEqual({ changed_files: ['a.ts'] });
  });
  it('超长字符串截断至 2000 字符', () => {
    const out = slimParentMetadata({ diff: 'x'.repeat(3000) }) as { diff: string };
    expect(out.diff.length).toBe(2000 + '…(truncated)'.length);
  });
  it('常规小键原样透传', () => {
    expect(slimParentMetadata({ branch: 'f/x', worktree_dir: '/wt/x' })).toEqual({ branch: 'f/x', worktree_dir: '/wt/x' });
  });
});
