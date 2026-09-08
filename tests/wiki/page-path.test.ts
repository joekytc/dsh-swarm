// tests/wiki/page-path.test.ts
import { describe, it, expect } from 'vitest';
import { isAllowedWikiPagePath, isLearningsPath, buildChecklistSlug, KB_PAGE_NAMESPACES_HINT, assertAllowedWikiPagePath } from '../../src/wiki/page-path.js';

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

import { isLocalKbPagePath, assertLocalKbPagePath, LOCAL_CHECKLIST_PREFIX, LOCAL_LEARNING_BASE } from '../../src/wiki/page-path.js';

describe('standalone review namespace (projects/<repoSlug>/reviews/<topic>-<ymd>/)', () => {
  it('accepts review namespace pages (read + write gate)', () => {
    expect(isAllowedWikiPagePath('projects/repo/reviews/auth-flow-2026-09-08/report.md')).toBe(true);
    expect(isAllowedWikiPagePath('projects/repo/reviews/review-2026-09-08/')).toBe(true);
    expect(isAllowedWikiPagePath('projects/repo/reviews/t-2026-09-08/nested/deep/x.md')).toBe(true);
    expect(() => assertAllowedWikiPagePath('projects/repo/reviews/auth-flow-2026-09-08/report.md')).not.toThrow();
  });
  it('rejects malformed review namespace (missing date / bad topic / bad date)', () => {
    expect(isAllowedWikiPagePath('projects/repo/reviews/')).toBe(false);
    expect(isAllowedWikiPagePath('projects/repo/reviews/notes.md')).toBe(false);
    expect(isAllowedWikiPagePath('projects/repo/reviews/Bad!-2026-09-08/report.md')).toBe(false);
    expect(isAllowedWikiPagePath('projects/repo/reviews/topic-2026-9-8/report.md')).toBe(false);
    expect(isAllowedWikiPagePath('projects/repo/reviews/topic-20260908/report.md')).toBe(false);
  });
  it('rejects traversal and absolute paths inside review namespace', () => {
    expect(isAllowedWikiPagePath('projects/repo/reviews/t-2026-09-08/../secret.md')).toBe(false);
    expect(isAllowedWikiPagePath('/projects/repo/reviews/t-2026-09-08/x.md')).toBe(false);
  });
  it('existing namespaces and hint stay intact', () => {
    expect(isAllowedWikiPagePath('projects/repo/ch_1_abc/review/r.md')).toBe(true);
    expect(KB_PAGE_NAMESPACES_HINT).toContain('projects/<repoSlug>/checklists/');
  });
});

describe('local KB page path (双模式 D5)', () => {
  it('wiki/** 相对路径合法', () => {
    expect(isLocalKbPagePath('wiki/sources/ch_c1/t_t1.md')).toBe(true);
    expect(isLocalKbPagePath('wiki/queries/checklists/req-abc.md')).toBe(true);
    expect(isLocalKbPagePath('wiki/synthesis/learnings/ch_c1/x.md')).toBe(true);
    expect(isLocalKbPagePath('wiki/queries/ch_c1/review/dt_1.md')).toBe(true);
  });
  it('越界拒绝：绝对路径 / .. 穿越 / 非 wiki 前缀 / 空串', () => {
    expect(isLocalKbPagePath('/etc/passwd')).toBe(false);
    expect(isLocalKbPagePath('wiki/../secrets.md')).toBe(false);
    expect(isLocalKbPagePath('projects/checklists/x.md')).toBe(false);
    expect(isLocalKbPagePath('')).toBe(false);
  });
  it('assertLocalKbPagePath 越界抛 kb-rejected', () => {
    expect(() => assertLocalKbPagePath('projects/checklists/x.md')).toThrow(/kb-rejected/);
    expect(() => assertLocalKbPagePath('wiki/entities/X.md')).not.toThrow();
  });
  it('常量导出', () => {
    expect(LOCAL_CHECKLIST_PREFIX).toBe('wiki/queries/checklists/');
    expect(LOCAL_LEARNING_BASE).toBe('wiki/synthesis/learnings/');
  });
});
