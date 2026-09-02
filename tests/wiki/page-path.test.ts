// tests/wiki/page-path.test.ts
import { describe, it, expect } from 'vitest';
import { isAllowedWikiPagePath, isLearningsPath, buildChecklistSlug, KB_PAGE_NAMESPACES_HINT } from '../../src/wiki/page-path.js';

describe('page-path whitelist (repoSlug dimension)', () => {
  it('accepts namespaces under projects/<repoSlug>/', () => {
    expect(isAllowedWikiPagePath('projects/repo/checklists/s-abc.md')).toBe(true);
    expect(isAllowedWikiPagePath('projects/repo/learnings/x-abc.md')).toBe(true);
    expect(isAllowedWikiPagePath('projects/repo/ch_1_abc/learnings/x-abc.md')).toBe(true);
    expect(isAllowedWikiPagePath('projects/repo/ch_1_abc/t_1_abc.md')).toBe(true);
    expect(isAllowedWikiPagePath('projects/repo/ch_1_abc/review/r.md')).toBe(true);
  });
  it('rejects legacy root-level namespaces (no backward compat)', () => {
    expect(isAllowedWikiPagePath('projects/checklists/s-abc.md')).toBe(false);
    expect(isAllowedWikiPagePath('projects/learnings/x-abc.md')).toBe(false);
    expect(isAllowedWikiPagePath('projects/ch_1_abc/t_1_abc.md')).toBe(false);
    expect(isAllowedWikiPagePath('projects/ch_1_abc/review/r.md')).toBe(false);
    expect(isAllowedWikiPagePath('projects/ch_1_abc/learnings/x.md')).toBe(false);
  });
  it('rejects paths outside allowed namespaces', () => {
    expect(isAllowedWikiPagePath('projects/evil/x.md')).toBe(false);
    expect(isAllowedWikiPagePath('evil/learnings/x.md')).toBe(false);
    expect(isAllowedWikiPagePath('projects/x/learnings.md')).toBe(false);
    expect(isAllowedWikiPagePath('projects/Repo/checklists/s.md')).toBe(false); // repoSlug 必须小写
    expect(isAllowedWikiPagePath('projects/repo/ch_1/other.md')).toBe(false);
  });
  it('isLearningsPath only matches learnings namespaces under repoSlug', () => {
    expect(isLearningsPath('projects/repo/learnings/a.md')).toBe(true);
    expect(isAllowedWikiPagePath('projects/repo/ch_1/learnings/a.md')).toBe(true);
    expect(isLearningsPath('projects/repo/ch_1/learnings/a.md')).toBe(true);
    expect(isLearningsPath('projects/learnings/a.md')).toBe(false);
    expect(isLearningsPath('projects/repo/checklists/a.md')).toBe(false);
    expect(isLearningsPath('projects/repo/ch_1/t_1.md')).toBe(false);
  });
  it('exports namespaces hint for error copy reuse', () => {
    expect(KB_PAGE_NAMESPACES_HINT).toContain('projects/<repoSlug>/checklists/');
  });
  it('buildChecklistSlug ASCII-folds and falls back', () => {
    expect(buildChecklistSlug('Vue Admin 登录')).toBe('vue-admin');
    expect(buildChecklistSlug('纯中文需求')).toBe('req');
    expect(buildChecklistSlug('')).toBe('req');
  });
});
