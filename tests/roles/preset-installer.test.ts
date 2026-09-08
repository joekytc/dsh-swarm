// tests/roles/preset-installer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installRolePresets, userPresetsRoot } from '../../src/roles/preset-installer.js';

describe('installRolePresets (swarm)', () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'presets-')); process.env.DSH_HOME = home; });
  afterEach(() => { delete process.env.DSH_HOME; rmSync(home, { recursive: true, force: true }); });

  it('安装 swarm preset：agent.cordis.yml + preset.yml 落用户根，幂等可重复', () => {
    const first = installRolePresets();
    expect(first).toContain('swarm');
    const dir = join(userPresetsRoot(), 'swarm');
    expect(existsSync(join(dir, 'agent.cordis.yml'))).toBe(true);
    expect(existsSync(join(dir, 'preset.yml'))).toBe(true);
    // 幂等：重复安装不抛错、仍成功
    expect(installRolePresets()).toContain('swarm');
  });

  it('preset.yml 声明显示名与描述（GUI 选择器文案）', () => {
    installRolePresets();
    const raw = readFileSync(join(userPresetsRoot(), 'swarm', 'preset.yml'), 'utf8');
    expect(raw).toContain('name: 蜂群模式（Swarm）');
    expect(raw).toContain('一句话需求直达交付');
  });
});
