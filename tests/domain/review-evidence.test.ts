import { describe, it, expect } from 'vitest';
import { validateReviewEvidence } from '../../src/domain/review-evidence.js';
import type { Handoff } from '../../src/domain/types.js';

function handoff(meta: Record<string, unknown>): Handoff {
  return { summary: 'review', metadata: meta, completedAt: 1 };
}

describe('validateReviewEvidence', () => {
  it('PT validator requires verdict+issues+plan structure; DT requires test/build/diff/git/ocr', () => {
    // 缺 evidence → 返回缺失清单
    expect(validateReviewEvidence('pt', handoff({}))).toEqual(['review_evidence missing']);
    expect(validateReviewEvidence('dt', handoff({}))).toEqual(['review_evidence missing']);
    // PT 缺 verdict/issues/plan 结构
    const ptPartial = validateReviewEvidence('pt', handoff({
      review_evidence: { verdict: 'pass', issues: [] },
    }));
    expect(ptPartial).toContain('review_evidence.plan (artifacts_path/reviewPage)');
    // DT 缺 test/diff/git/ocr
    const dtPartial = validateReviewEvidence('dt', handoff({
      review_evidence: { verdict: 'pass', issues: [] },
    }));
    expect(dtPartial).toContain('review_evidence.test');
    expect(dtPartial).toContain('review_evidence.diff (non-empty)');
    expect(dtPartial).toContain('review_evidence.git');
    expect(dtPartial).toContain('review_evidence.openCodeReview (ocr/fallback)');
    // DT test 缺失→报 test；有 test 但 exit!=0 且 verdict=pass → 报 test (exit 0)
    const dtBadTest = validateReviewEvidence('dt', handoff({
      review_evidence: { verdict: 'pass', issues: [], test: { exit: 1 }, diff: { files: ['a'] }, git: { branch: 'x' }, openCodeReview: { conclusion: 'pass' } },
    }));
    expect(dtBadTest).toContain('review_evidence.test (exit 0)');
    // fail 评审：test 字段存在即可（不必 exit 0）
    const dtFailOk = validateReviewEvidence('dt', handoff({
      review_evidence: { verdict: 'fail', issues: [{ severity: 'high', title: 'x', detail: 'y', resolved: false }], test: { exit: 1 }, build: { exit: 1 }, lint: { exit: 1 }, diff: { files: ['a'] }, git: { branch: 'x' }, openCodeReview: { conclusion: 'fail' } },
    }));
    expect(dtFailOk).toEqual([]);
  });

  it('complete valid evidence returns empty list', () => {
    const ptOk = handoff({
      artifacts_path: '/ws/plan.md',
      review_evidence: { verdict: 'pass', issues: [] },
    });
    expect(validateReviewEvidence('pt', ptOk)).toEqual([]);
    const dtOk = handoff({
      review_evidence: {
        verdict: 'pass',
        issues: [{ severity: 'low', title: 'nits', detail: 'minor', resolved: true }],
        test: { exit: 0, total: 10 },
        build: { exit: 0 },
        lint: { exit: 0 },
        diff: { files: ['a.ts'] },
        git: { branch: 'feature/x', commit: 'abc' },
        openCodeReview: { conclusion: 'pass', tool: 'ocr' },
      },
    });
    expect(validateReviewEvidence('dt', dtOk)).toEqual([]);
  });
});
