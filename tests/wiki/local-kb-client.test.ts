// tests/wiki/local-kb-client.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalWikiClient } from '../../src/wiki/local-kb-client.js';

describe('LocalWikiClient', () => {
  let root: string; let client: LocalWikiClient;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'lkb-'));
    mkdirSync(join(root, 'wiki', 'sources'), { recursive: true });
    const old = new Date('2026-01-01'); const now = new Date();
    writeFileSync(join(root, 'wiki', 'sources', 'hit-new.md'), '# T\n包含 needle 关键词\n', 'utf8');
    utimesSync(join(root, 'wiki', 'sources', 'hit-new.md'), now, now);
    writeFileSync(join(root, 'wiki', 'sources', 'hit-old.md'), '# O\n包含 needle 关键词\n', 'utf8');
    utimesSync(join(root, 'wiki', 'sources', 'hit-old.md'), old, old);
    writeFileSync(join(root, 'wiki', 'sources', 'miss.md'), '# M\n无关内容\n', 'utf8');
    client = new LocalWikiClient(root);
  });
  it('write/read 往返', async () => {
    await client.write('wiki/queries/ch_c1/t_t1.md', '# 计划\n正文');
    const page = await client.read('wiki/queries/ch_c1/t_t1.md');
    expect(page.rawMd).toContain('正文');
  });
  it('read 不存在页抛 kb-rejected', async () => {
    await expect(client.read('wiki/sources/none.md')).rejects.toThrow(/kb-rejected/);
  });
  it('write 越界（.. 穿越 / 绝对路径）拒绝', async () => {
    await expect(client.write('wiki/../evil.md', 'x')).rejects.toThrow(/kb-rejected/);
    await expect(client.write('/tmp/evil.md', 'x')).rejects.toThrow(/kb-rejected/);
  });
  it('search 命中关键词并按 相关性0.7+新鲜度0.3 排序（新文件在前）', async () => {
    const r = await client.search('needle');
    expect(r.map((x) => x.path)).toEqual(['wiki/sources/hit-new.md', 'wiki/sources/hit-old.md']);
    expect(r[0].score).toBeGreaterThan(r[1].score);
    expect(r[0].mtime).toBeGreaterThan(r[1].mtime);
  });
  it('search 无命中返回空数组', async () => {
    expect(await client.search('zzz-no-hit')).toEqual([]);
  });
  it('write fs 失败归一为 kb-unreachable（§9 降级链依赖，审查 M5）', async () => {
    const dir = join(root, 'wiki', 'locked');
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o500);
    try {
      await expect(client.write('wiki/locked/x.md', 'x')).rejects.toThrow(/kb-unreachable/);
    } finally {
      chmodSync(dir, 0o755);
    }
  });
});
