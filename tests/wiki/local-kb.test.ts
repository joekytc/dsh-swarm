// tests/wiki/local-kb.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isInsideKbRoot, ensureLocalKbRoot } from '../../src/wiki/local-kb.js';

describe('local-kb root utils', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-root-'));
  it('ensureLocalKbRoot 幂等创建', () => {
    const r = join(root, 'a', 'b');
    expect(ensureLocalKbRoot(r)).toBe(r);
    expect(ensureLocalKbRoot(r)).toBe(r); // 二次幂等
  });
  it('isInsideKbRoot：库根内绝对路径放行', () => {
    expect(isInsideKbRoot(root, join(root, 'wiki', 'x.md'))).toBe(true);
    expect(isInsideKbRoot(root, root)).toBe(true);
  });
  it('isInsideKbRoot：.. 穿越拒绝（M1）', () => {
    expect(isInsideKbRoot(root, join(root, '..', 'escape.md'))).toBe(false);
  });
  it('isInsideKbRoot：前缀相似目录拒绝（M2）', () => {
    expect(isInsideKbRoot(root, root + '2' + '/x.md')).toBe(false);
  });
  it('isInsideKbRoot：相对路径 fail-closed', () => {
    expect(isInsideKbRoot(root, 'wiki/x.md')).toBe(false);
    expect(isInsideKbRoot(root, '')).toBe(false);
  });
});
