// tests/roles/skill-installer.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installLlWikiSkill } from '../../src/roles/skill-installer.js';

describe('installLlWikiSkill（D6：完整复制、幂等）', () => {
  let pkg: string; let dstRoot: string;
  beforeAll(() => {
    pkg = mkdtempSync(join(tmpdir(), 'pkg-'));
    dstRoot = mkdtempSync(join(tmpdir(), 'skills-'));
    mkdirSync(join(pkg, 'skills', 'llm-wiki-skill', 'deps'), { recursive: true });
    writeFileSync(join(pkg, 'skills', 'llm-wiki-skill', 'SKILL.md'), '# llm-wiki\n', 'utf8');
    writeFileSync(join(pkg, 'skills', 'llm-wiki-skill', 'deps', 'x.txt'), 'x', 'utf8');
  });
  it('缺失 → installed（含子目录完整复制）', () => {
    expect(installLlWikiSkill({ src: join(pkg, 'skills', 'llm-wiki-skill'), dstRoot })).toBe('installed');
  });
  it('二次调用 → exists（幂等）', () => {
    expect(installLlWikiSkill({ src: join(pkg, 'skills', 'llm-wiki-skill'), dstRoot })).toBe('exists');
  });
  it('包内无源 → skipped（不抛错）', () => {
    expect(installLlWikiSkill({ src: join(tmpdir(), 'no-such-src'), dstRoot })).toBe('skipped');
  });
});
