import { Service, type Context } from '@deepseek-ai/cordis';
import { readFileSync, writeFileSync, renameSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  mergeConfig, computeSources, projectEditable, validateConfig, diffOverride,
} from '../domain/config-override.js';
import type { EditableOverride, EditableSnapshot, SourceMap } from '../domain/config-override.js';
import type { KanbanConfig } from '../config.js';

declare module '@deepseek-ai/cordis' {
  interface Context { swarmConfig: ConfigProvider; }
}

export type ApplyResult =
  | { ok: true; effective: EditableSnapshot; sources: SourceMap; changed: string[] }
  | { ok: false; errors: string[] };

export class ConfigProvider extends Service {
  private readonly baseline: KanbanConfig;
  private readonly overrideFile: string;
  private readonly auditFile: string;
  private override: EditableOverride;
  private effective: KanbanConfig;
  private sources: SourceMap;

  constructor(ctx: Context, baseline: KanbanConfig, storageDir: string) {
    super(ctx, 'swarmConfig');
    this.baseline = baseline;
    this.overrideFile = join(storageDir, 'config-override.json');
    this.auditFile = join(storageDir, 'config-audit.log');
    this.override = this.readOverride();
    this.effective = mergeConfig(baseline, this.override);
    this.sources = computeSources(this.override);
  }

  getEffective(): KanbanConfig { return this.effective; }
  getSources(): SourceMap { return this.sources; }
  get mode(): 'remote' | 'local' { return (this.effective.wikiVault?.baseUrl ?? '').trim() ? 'remote' : 'local'; }
  snapshot(): { effective: EditableSnapshot; sources: SourceMap } {
    return { effective: projectEditable(this.effective), sources: this.sources };
  }

  applyOverride(snapshot: EditableSnapshot): ApplyResult {
    const errors = validateConfig(snapshot);
    if (errors.length) return { ok: false, errors };
    const next = diffOverride(this.baseline, snapshot);
    const changed = this.diffKeys(this.override, next);
    this.writeOverride(next);
    if (changed.length) this.appendAudit(changed);
    this.override = next;
    this.effective = mergeConfig(this.baseline, next);
    this.sources = computeSources(next);
    return { ok: true, effective: projectEditable(this.effective), sources: this.sources, changed };
  }

  reset(): { effective: EditableSnapshot; sources: SourceMap } {
    const next: EditableOverride = {};
    this.writeOverride(next);
    this.override = next;
    this.effective = mergeConfig(this.baseline, next);
    this.sources = computeSources(next);
    return { effective: projectEditable(this.effective), sources: this.sources };
  }

  private readOverride(): EditableOverride {
    try {
      if (!existsSync(this.overrideFile)) return {};
      const raw = JSON.parse(readFileSync(this.overrideFile, 'utf8')) as EditableOverride;
      return raw ?? {};
    } catch (err) {
      console.warn('[dsh-swarm] config-override.json 损坏，回退基线: ' + String(err));
      return {};
    }
  }

  private writeOverride(next: EditableOverride): void {
    mkdirSync(dirname(this.overrideFile), { recursive: true });
    const tmp = this.overrideFile + '.tmp-' + Date.now();
    writeFileSync(tmp, JSON.stringify(next, null, 2));
    renameSync(tmp, this.overrideFile);
  }

  private appendAudit(changed: string[]): void {
    const line = new Date().toISOString() + ' | ' + changed.join(', ') + '\n';
    try {
      mkdirSync(dirname(this.auditFile), { recursive: true });
      appendFileSync(this.auditFile, line);
    } catch { /* 审计失败不阻断 */ }
  }

  private diffKeys(prev: EditableOverride, next: EditableOverride): string[] {
    const keys = new Set<string>();
    for (const k of ['baseUrl', 'pagePrefix'] as const) {
      if (prev.wikiVault?.[k] !== next.wikiVault?.[k]) keys.add('wikiVault.' + k);
    }
    for (const role of ['v', 'p', 'w', 'd', 'pt', 'dt'] as const) {
      for (const f of ['provider', 'model', 'reasoningEffort'] as const) {
        const a = (prev.roles?.models?.[role] as Record<string, unknown> | undefined)?.[f];
        const b = (next.roles?.models?.[role] as Record<string, unknown> | undefined)?.[f];
        if (a !== b) keys.add(`roles.models.${role}.${f}`);
      }
    }
    return [...keys];
  }
}
