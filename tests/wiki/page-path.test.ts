// tests/wiki/page-path.test.ts
import { describe, it, expect } from 'vitest';
import { isAllowedWikiPagePath, isLearningsPath, buildChecklistSlug, LEARNINGS_PAGE_PREFIX } from '../../src/wiki/page-path.js';

describe('page-path whitelist', () => {
  it('accepts three-tier learnings paths', () => {
    expect(isAllowedWikiPagePath('projects/learnings/x-abc.md')).toBe(true);
    expect(isAllowedWikiPagePath('projects/vueadmin/learnings/x-abc.md')).toBe(true);
    expect(isAllowedWikiPagePath('projects/ch_1_abc/learnings/x-abc.md')).toBe(true);
  });
  it('still accepts checklist/plan/review namespaces', () => {
    expect(isAllowedWikiPagePath('projects/checklists/s-abc.md')).toBe(true);
    expect(isAllowedWikiPagePath('projects/ch_1_abc/t_1_abc.md')).toBe(true);
    expect(isAllowedWikiPagePath('projects/ch_1_abc/review/r.md')).toBe(true);
  });
  it('rejects paths outside allowed namespaces', () => {
    expect(isAllowedWikiPagePath('projects/evil/x.md')).toBe(false);
    expect(isAllowedWikiPagePath('evil/learnings/x.md')).toBe(false);
    expect(isAllowedWikiPagePath('projects/x/learnings.md')).toBe(false);
  });
  it('isLearningsPath only matches learnings namespaces', () => {
    expect(isLearningsPath('projects/learnings/a.md')).toBe(true);
    expect(isLearningsPath('projects/vueadmin/learnings/a.md')).toBe(true);
    expect(isLearningsPath('projects/ch_1/learnings/a.md')).toBe(true);
    expect(isLearningsPath('projects/checklists/a.md')).toBe(false);
    expect(isLearningsPath('projects/ch_1/t_1.md')).toBe(false);
  });
  it('buildChecklistSlug ASCII-folds and falls back', () => {
    expect(buildChecklistSlug('Vue Admin 登录')).toBe('vue-admin');
    expect(buildChecklistSlug('纯中文需求')).toBe('req');
    expect(buildChecklistSlug('')).toBe('req');
  });
});
