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
      review_evidence: { verdict: 'fail', issues: [{ severity: 'high', title: 'x', detail: 'y', resolved: false }], test: { exit: 1, runner: 'vitest' }, build: { exit: 1 }, lint: { exit: 1 }, diff: { files: ['a'] }, git: { branch: 'x' }, openCodeReview: { conclusion: 'fail' }, tdd: { test_files: ['a.test.ts'], test_first: false } },
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
        test: { exit: 0, total: 10, runner: 'vitest' },
        build: { exit: 0 },
        lint: { exit: 0 },
        diff: { files: ['a.ts'] },
        git: { branch: 'feature/x', commit: 'abc' },
        openCodeReview: { conclusion: 'pass', tool: 'ocr' },
        tdd: { test_files: ['a.ts'], test_first: true },
      },
    });
    expect(validateReviewEvidence('dt', dtOk)).toEqual([]);
  });

  it('DT: TDD 硬要求——代码变更缺 tdd / skipped 缺 reason / pass 但 test_first!=true → missing', () => {
    const base = {
      verdict: 'pass' as const, issues: [],
      test: { exit: 0, runner: 'vitest' }, build: { exit: 0 }, lint: { exit: 0 },
      diff: { files: ['a.ts', 'a.test.ts'] }, git: { branch: 'feature/x', commit: 'abc' },
      openCodeReview: { conclusion: 'pass', tool: 'ocr' },
    };
    // 缺 tdd 块
    expect(validateReviewEvidence('dt', handoff({ review_evidence: base }))).toContain('review_evidence.tdd');
    // skipped 缺 reason
    expect(validateReviewEvidence('dt', handoff({ review_evidence: { ...base, tdd: { skipped: {} } } }))).toContain('review_evidence.tdd (skipped.reason)');
    // 无 skipped 但 test_files 空
    expect(validateReviewEvidence('dt', handoff({ review_evidence: { ...base, tdd: { test_files: [], test_first: true } } }))).toContain('review_evidence.tdd (test_files)');
    // pass 但 test_first!=true
    expect(validateReviewEvidence('dt', handoff({ review_evidence: { ...base, tdd: { test_files: ['a.test.ts'], test_first: false } } }))).toContain('review_evidence.tdd (test_first=true)');
    // 合法
    expect(validateReviewEvidence('dt', handoff({ review_evidence: { ...base, tdd: { test_files: ['a.test.ts'], test_first: true } } }))).toEqual([]);
    // fail 评审允许 test_first=false（如实记录违规）
    expect(validateReviewEvidence('dt', handoff({ review_evidence: { ...base, verdict: 'fail', tdd: { test_files: ['a.test.ts'], test_first: false } } }))).toEqual([]);
  });
});
