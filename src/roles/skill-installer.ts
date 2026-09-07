// src/roles/skill-installer.ts
// llm-wiki skill 自动安装（设计 §7 / D6）：DSH 的 dsh-tool-skill 只从 ~/.agents/skills/ 发现 skill，
// 不扫插件包内 skills 目录（同 agent-presets 只认 $DSH_HOME/.agent-presets 的先例）。
// 完整复制（含 deps/assets/tests 全部子目录）；幂等（SKILL.md 已存在跳过）；尽力而为（失败仅告警）。
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function packageSkillDir(): string {
  return fileURLToPath(new URL('../../skills/llm-wiki-skill/', import.meta.url));
}

export function userSkillsRoot(): string {
  return join(homedir(), '.agents', 'skills');
}

export function installLlWikiSkill(opts?: { src?: string; dstRoot?: string }): 'installed' | 'exists' | 'skipped' {
  const src = opts?.src ?? packageSkillDir();
  const dst = join(opts?.dstRoot ?? userSkillsRoot(), 'llm-wiki-skill');
  if (!existsSync(src)) return 'skipped';
  if (existsSync(join(dst, 'SKILL.md'))) return 'exists';
  try {
    mkdirSync(dst, { recursive: true });
    cpSync(src, dst, { recursive: true });
    console.info('[dsh-swarm] llm-wiki-skill installed -> ' + dst);
    return 'installed';
  } catch (err) {
    console.warn('[dsh-swarm] llm-wiki-skill install skipped -> ' + dst + ': ' + String(err));
    return 'skipped';
  }
}
