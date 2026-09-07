import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { name } from '../src/index.js';

describe('plugin entry', () => {
  it('exports a plugin name', () => {
    expect(name).toBe('dsh-swarm');
  });

  it('package.json files 含 skills（npm 打包安装态必须随包发布 skill-installer 源目录）', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { files: string[] };
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain('skills');
  });
});
