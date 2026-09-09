import { describe, it, expect } from 'vitest';
import {
  buildOcrArgs,
  parsePreviewJson,
  parseManagedJson,
  SUGGEST_MANAGED_FILES,
  shouldSuggestManaged,
  reviewPagePath,
  isStandaloneReviewNamespacePath,
} from '../../src/domain/ocr-review.js';

describe('buildOcrArgs', () => {
  it('preview 恒带 --format json（CLI 默认输出 text，不传则无法解析）', () => {
    expect(buildOcrArgs('preview', {})).toEqual(['delegate', 'preview', '--format', 'json']);
  });

  it('preview commit 优先于 from/to（对齐 managed 分支语义）', () => {
    expect(buildOcrArgs('preview', { commit: 'c1', from: 'a', to: 'b' })).toEqual([
      'delegate', 'preview', '--format', 'json', '--commit', 'c1',
    ]);
  });

  it('preview 有 from/to 时在 --format json 之后按序追加', () => {
    expect(buildOcrArgs('preview', { from: 'a', to: 'b' })).toEqual([
      'delegate', 'preview', '--format', 'json', '--from', 'a', '--to', 'b',
    ]);
  });

  it('preview from/to/repo 齐全时顺序为 delegate preview --format json --from --to --repo', () => {
    expect(buildOcrArgs('preview', { from: 'a', to: 'b', repo: 'r' })).toEqual([
      'delegate', 'preview', '--format', 'json', '--from', 'a', '--to', 'b', '--repo', 'r',
    ]);
  });

  it('preview 仅有 repo 时追加 --repo', () => {
    expect(buildOcrArgs('preview', { repo: 'r' })).toEqual(['delegate', 'preview', '--format', 'json', '--repo', 'r']);
  });

  it('rule 逐个展开 paths', () => {
    expect(buildOcrArgs('rule', { paths: ['p1', 'p2'] })).toEqual(['delegate', 'rule', 'p1', 'p2']);
    expect(buildOcrArgs('rule', {})).toEqual(['delegate', 'rule']);
  });

  it('managed 以 commit 为优先并恒追加 --format json 与 --audience agent', () => {
    expect(buildOcrArgs('managed', { commit: 'c1', from: 'a', to: 'b' })).toEqual([
      'review', '--commit', 'c1', '--format', 'json', '--audience', 'agent',
    ]);
  });

  it('managed 无 commit 时回退 from/to', () => {
    expect(buildOcrArgs('managed', { from: 'f', to: 't' })).toEqual([
      'review', '--from', 'f', '--to', 't', '--format', 'json', '--audience', 'agent',
    ]);
  });

  it('managed 无 commit 且无 from/to 时仅追加 --format json 与 --audience agent', () => {
    expect(buildOcrArgs('managed', {})).toEqual(['review', '--format', 'json', '--audience', 'agent']);
  });

  it('managed 透传 background 为 --background；preview/rule 不透传', () => {
    expect(buildOcrArgs('managed', { commit: 'c1', background: '业务上下文' })).toEqual([
      'review', '--commit', 'c1', '--format', 'json', '--audience', 'agent', '--background', '业务上下文',
    ]);
    expect(buildOcrArgs('preview', { from: 'a', background: '业务上下文' })).toEqual([
      'delegate', 'preview', '--format', 'json', '--from', 'a',
    ]);
    expect(buildOcrArgs('rule', { paths: ['p'], background: '业务上下文' })).toEqual(['delegate', 'rule', 'p']);
  });
});

describe('parsePreviewJson', () => {
  it('映射官方 JSON 字段 reviewable_files/excluded_files/exclude_reason', () => {
    const out = parsePreviewJson(JSON.stringify({
      schema_version: '1',
      mode: 'range',
      repository: '/repo',
      from: 'a',
      to: 'b',
      merge_base: '952a',
      total_files: 26,
      reviewable_count: 16,
      excluded_count: 10,
      total_insertions: 1432,
      total_deletions: 137,
      reviewable_files: [{ path: '.gitignore', status: 'modified', insertions: 2, deletions: 1 }],
      excluded_files: [{ path: 'logo.png', status: 'added', insertions: 141, deletions: 0, exclude_reason: 'unsupported_ext' }],
    }));
    expect(out).toEqual({
      mode: 'range',
      files: [{ path: '.gitignore', status: 'modified' }],
      excluded: [{ path: 'logo.png', reason: 'unsupported_ext' }],
      mergeBase: '952a',
    });
  });

  it('兼容 filePath 元素别名', () => {
    const out = parsePreviewJson(JSON.stringify({
      reviewable_files: [{ filePath: 'a.ts', status: 'added' }],
      excluded_files: [{ filePath: 'b.ts', exclude_reason: 'ignored' }],
    }));
    expect(out.files).toEqual([{ path: 'a.ts', status: 'added' }]);
    expect(out.excluded).toEqual([{ path: 'b.ts', reason: 'ignored' }]);
  });

  it('mergeBase 读取 merge_base，缺失时为 null', () => {
    expect(parsePreviewJson('{"mode":"diff","merge_base":"def"}').mergeBase).toBe('def');
    expect(parsePreviewJson('{"mode":"diff"}').mergeBase).toBeNull();
  });

  it('非 JSON 输入不抛错并回退 unknown', () => {
    expect(parsePreviewJson('not-json')).toEqual({
      mode: 'unknown', files: [], excluded: [], mergeBase: null,
    });
  });

  it('text 输出（CLI 未带 --format json 的默认形态）同样回退', () => {
    expect(parsePreviewJson('Reviewable files:\n  a.ts    modified\n')).toEqual({
      mode: 'unknown', files: [], excluded: [], mergeBase: null,
    });
  });

  it('非对象 JSON（数组/数字/null）同样回退', () => {
    const fallback = { mode: 'unknown', files: [], excluded: [], mergeBase: null };
    expect(parsePreviewJson('[1,2]')).toEqual(fallback);
    expect(parsePreviewJson('42')).toEqual(fallback);
    expect(parsePreviewJson('null')).toEqual(fallback);
  });

  it('reviewable_files/excluded_files 缺失或非数组时为空数组', () => {
    const out = parsePreviewJson('{"mode":"diff","reviewable_files":"x","excluded_files":3}');
    expect(out.files).toEqual([]);
    expect(out.excluded).toEqual([]);
  });
});

describe('parseManagedJson', () => {
  it('解析 status 并归一化 comments', () => {
    const out = parseManagedJson(JSON.stringify({
      status: 'done',
      comments: [{ path: 'a.ts', line: 3, severity: 'high', message: '问题' }],
    }));
    expect(out.status).toBe('done');
    expect(out.comments).toEqual([{ path: 'a.ts', line: 3, severity: 'high', message: '问题' }]);
  });

  it('官方字段 start_line 映射为 line，content 优先映射为 message', () => {
    const out = parseManagedJson(JSON.stringify({
      status: 'success',
      comments: [
        { path: 'a.ts', content: '存在硬编码密钥', start_line: 12, end_line: 15, severity: 'high', existing_code: 'k=1', suggestion_code: 'k=env' },
        { path: 'b.ts', content: '命名不规范' },
      ],
    }));
    expect(out.status).toBe('success');
    expect(out.comments[0]).toEqual({ path: 'a.ts', line: 12, severity: 'high', message: '存在硬编码密钥' });
    expect(out.comments[1]).toEqual({ path: 'b.ts', line: null, severity: null, message: '命名不规范' });
  });

  it('兼容 filePath/startLine/level 别名，line 数值化且 NaN 归 null', () => {
    const out = parseManagedJson(JSON.stringify({
      status: 'ok',
      comments: [
        { filePath: 'a.ts', startLine: '12', level: 'low', message: 'm' },
        { path: 'b.ts', line: 'oops', severity: 'mid', message: 'm' },
        { path: null, line: null, severity: null, message: 'm' },
      ],
    }));
    expect(out.comments[0]).toEqual({ path: 'a.ts', line: 12, severity: 'low', message: 'm' });
    expect(out.comments[1]).toEqual({ path: 'b.ts', line: null, severity: 'mid', message: 'm' });
    expect(out.comments[2]).toEqual({ path: null, line: null, severity: null, message: 'm' });
  });

  it('message 依次回退 content/message/body 并截断 2000 字符', () => {
    const long = 'x'.repeat(2500);
    const out = parseManagedJson(JSON.stringify({
      status: 'ok',
      comments: [
        { content: '来自content' },
        { body: '来自body' },
        { message: long },
      ],
    }));
    expect(out.comments[0].message).toBe('来自content');
    expect(out.comments[1].message).toBe('来自body');
    expect(out.comments[2].message).toBe('x'.repeat(2000));
    expect(out.comments[2].message.length).toBe(2000);
  });

  it('message 缺失时为空串', () => {
    const out = parseManagedJson(JSON.stringify({ status: 'ok', comments: [{}] }));
    expect(out.comments[0].message).toBe('');
  });

  it('非 JSON 输入不抛错并回退 unknown', () => {
    expect(parseManagedJson('broken')).toEqual({ status: 'unknown', comments: [] });
  });
});

describe('SUGGEST_MANAGED_FILES / shouldSuggestManaged', () => {
  it('阈值为 50', () => {
    expect(SUGGEST_MANAGED_FILES).toBe(50);
  });

  it('严格大于阈值才建议托管', () => {
    expect(shouldSuggestManaged(50)).toBe(false);
    expect(shouldSuggestManaged(51)).toBe(true);
    expect(shouldSuggestManaged(0)).toBe(false);
  });
});

describe('reviewPagePath', () => {
  it('输出 projects/<slug>/reviews/<topic>-<ymd>/ 结构', () => {
    expect(reviewPagePath('dsh-swarm', 'Login模块 Review!', '2026-09-08'))
      .toBe('projects/dsh-swarm/reviews/login-review-2026-09-08/');
  });

  it('连续非字母数字折叠为单个 - 并去除首尾 -', () => {
    expect(reviewPagePath('r', ' --Foo Bar!! ', '2026-01-02'))
      .toBe('projects/r/reviews/foo-bar-2026-01-02/');
  });

  it('清洗后为空（含纯中文）时回退 review', () => {
    expect(reviewPagePath('r', '登录模块 Review!', '2026-09-08'))
      .toBe('projects/r/reviews/review-2026-09-08/');
    expect(reviewPagePath('r', '', '2026-09-08'))
      .toBe('projects/r/reviews/review-2026-09-08/');
  });
});

describe('isStandaloneReviewNamespacePath', () => {
  it('合法评审页命名空间路径为 true', () => {
    expect(isStandaloneReviewNamespacePath('projects/foo/reviews/login-review-2026-09-08/')).toBe(true);
  });

  it('空串 / 以 / 开头 / 含 .. 一律拒绝', () => {
    expect(isStandaloneReviewNamespacePath('')).toBe(false);
    expect(isStandaloneReviewNamespacePath('/projects/foo/reviews/x-2026-09-08/')).toBe(false);
    expect(isStandaloneReviewNamespacePath('projects/../etc/reviews/x-2026-09-08/')).toBe(false);
    expect(isStandaloneReviewNamespacePath('projects/foo/reviews/../x-2026-09-08/')).toBe(false);
  });

  it('slug 含大写、日期缺失或缺尾斜杠均不匹配', () => {
    expect(isStandaloneReviewNamespacePath('projects/Foo/reviews/x-2026-09-08/')).toBe(false);
    expect(isStandaloneReviewNamespacePath('projects/foo/reviews/x-2026-9-8/')).toBe(false);
    expect(isStandaloneReviewNamespacePath('projects/foo/reviews/x-2026-09-08')).toBe(false);
  });
});
