// tests/domain/evidence-check.test.ts
import { describe, expect, it } from 'vitest';
import { isAllowedCommand, paperCheck, parseIssueEvidence } from '../../src/domain/evidence-check.js';

describe('parseIssueEvidence（schema 单点封装）', () => {
  it('合法三字段 → 解析', () => {
    expect(parseIssueEvidence({ file: '/tmp/x.log', command: 'npm test', exit: 0 }))
      .toEqual({ file: '/tmp/x.log', command: 'npm test', exit: 0 });
  });
  it('缺字段/类型错/null → null', () => {
    expect(parseIssueEvidence(null)).toBeNull();
    expect(parseIssueEvidence({ file: 1, command: 'x', exit: 0 })).toBeNull();
    expect(parseIssueEvidence({ file: '/f', command: 'x' })).toBeNull();
  });
});

describe('paperCheck（零执行纸面核对）', () => {
  it('存档缺失 → unreadable', () => {
    expect(paperCheck(null, 0)).toBe('unreadable');
  });
  it('首行 [exit code: N] 与声明一致 → matches', () => {
    expect(paperCheck('[exit code: 0]\nPASS src/a.ts', 0)).toBe('matches');
  });
  it('首行不一致 → mismatch', () => {
    expect(paperCheck('[exit code: 1]\nFAIL', 0)).toBe('mismatch');
  });
  it('首行非规范格式 → unreadable（宁纵勿枉，转人工）', () => {
    expect(paperCheck('没有首行标记', 0)).toBe('unreadable');
  });
});

describe('isAllowedCommand（词边界前缀 + npm run 固定脚本）', () => {
  const prefixes = ['npx --no-install vitest', 'npm test', 'npm run build', 'npm run typecheck', 'tsc', 'eslint'];
  it('白名单内 → true', () => {
    expect(isAllowedCommand('npx --no-install vitest run tests/a.test.ts', prefixes)).toBe(true);
    expect(isAllowedCommand('npm test', prefixes)).toBe(true);
    expect(isAllowedCommand('npm run build -- --mode=dev', prefixes)).toBe(true);
  });
  it('前缀子串陷阱 → false（词边界）', () => {
    expect(isAllowedCommand('npm testify', prefixes)).toBe(false);
  });
  it('npm run 任意脚本 → false（package.json 脚本是 agent 自己写的）', () => {
    expect(isAllowedCommand('npm run preinstall', prefixes)).toBe(false);
  });
  it('白名单外 → false', () => {
    expect(isAllowedCommand('curl http://evil', prefixes)).toBe(false);
    expect(isAllowedCommand('rm -rf /', prefixes)).toBe(false);
  });
});
