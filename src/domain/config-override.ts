import type { KanbanConfig } from '../config.js';
import type { Role } from './types.js';

export const ROLES: readonly Role[] = ['v', 'p', 'w', 'd', 'pt', 'dt'];

export interface EditableModelInput { provider?: string; model?: string; reasoningEffort?: string; }
export interface EditableOverride {
  wikiVault?: { baseUrl?: string; pagePrefix?: string };
  roles?: { models?: Partial<Record<Role, EditableModelInput>> };
}
export interface EditableModelSnapshot { provider: string; model: string; reasoningEffort: string; }
export interface EditableSnapshot {
  wikiVault: { baseUrl: string; pagePrefix: string };
  roles: { models: Partial<Record<Role, EditableModelSnapshot>> };
}
export type ConfigSource = 'override' | 'inherited';
export type SourceMap = Record<string, ConfigSource>;

const MODEL_FIELDS = ['provider', 'model', 'reasoningEffort'] as const;

export function mergeConfig(baseline: KanbanConfig, override: EditableOverride | undefined): KanbanConfig {
  const wiki = { ...baseline.wikiVault };
  if (override?.wikiVault?.baseUrl !== undefined) wiki.baseUrl = override.wikiVault.baseUrl;
  if (override?.wikiVault?.pagePrefix !== undefined) wiki.pagePrefix = override.wikiVault.pagePrefix;
  const models: KanbanConfig['roles']['models'] = { ...baseline.roles.models };
  for (const role of ROLES) {
    const base = baseline.roles.models?.[role];
    const over = override?.roles?.models?.[role];
    if (!over) continue;
    const cur: { provider?: string; model?: string; reasoningEffort?: string } = { ...base };
    if (over.provider !== undefined) cur.provider = over.provider;
    if (over.model !== undefined) cur.model = over.model;
    // 防御：空字符串 reasoningEffort 视为"未设置"，永不覆盖 baseline/默认（读点回退 'high'）。
    if (over.reasoningEffort !== undefined && over.reasoningEffort.trim() !== '') cur.reasoningEffort = over.reasoningEffort;
    if (cur.provider && cur.model) models[role] = cur as KanbanConfig['roles']['models'][Role];
  }
  return { ...baseline, wikiVault: wiki, roles: { ...baseline.roles, models } };
}

export function computeSources(override: EditableOverride | undefined): SourceMap {
  const src: SourceMap = {};
  for (const k of ['wikiVault.baseUrl', 'wikiVault.pagePrefix'] as const) {
    const hit = k === 'wikiVault.baseUrl' ? override?.wikiVault?.baseUrl !== undefined : override?.wikiVault?.pagePrefix !== undefined;
    src[k] = hit ? 'override' : 'inherited';
  }
  for (const role of ROLES) {
    for (const f of MODEL_FIELDS) {
      const hit = (override?.roles?.models?.[role] as Record<string, unknown> | undefined)?.[f] !== undefined;
      src[`roles.models.${role}.${f}`] = hit ? 'override' : 'inherited';
    }
  }
  return src;
}

export function projectEditable(effective: KanbanConfig): EditableSnapshot {
  const models: EditableSnapshot['roles']['models'] = {};
  for (const role of ROLES) {
    const m = effective.roles.models?.[role];
    if (m?.provider && m?.model) models[role] = { provider: m.provider, model: m.model, reasoningEffort: m.reasoningEffort ?? 'high' };
  }
  return {
    wikiVault: { baseUrl: effective.wikiVault.baseUrl, pagePrefix: effective.wikiVault.pagePrefix },
    roles: { models },
  };
}

export function validateConfig(snapshot: EditableSnapshot): string[] {
  const errs: string[] = [];
  const baseUrl = snapshot.wikiVault.baseUrl ?? '';
  // 空 baseUrl = 本地 llm-wiki 回退（合法）；仅非空时校验 ^https?://。
  if (baseUrl.trim() && !/^https?:\/\//.test(baseUrl)) errs.push('wikiVault.baseUrl');
  if (!(snapshot.wikiVault.pagePrefix ?? '').trim()) errs.push('wikiVault.pagePrefix');
  for (const role of ROLES) {
    const m = snapshot.roles.models[role];
    if (!m) continue;
    if (!m.provider?.trim()) errs.push(`roles.models.${role}.provider`);
    if (!m.model?.trim()) errs.push(`roles.models.${role}.model`);
  }
  return errs;
}

export function diffOverride(baseline: KanbanConfig, snapshot: EditableSnapshot): EditableOverride {
  const out: EditableOverride = {};
  const w: { baseUrl?: string; pagePrefix?: string } = {};
  if (snapshot.wikiVault.baseUrl !== baseline.wikiVault.baseUrl) w.baseUrl = snapshot.wikiVault.baseUrl;
  if (snapshot.wikiVault.pagePrefix !== baseline.wikiVault.pagePrefix) w.pagePrefix = snapshot.wikiVault.pagePrefix;
  if (Object.keys(w).length) out.wikiVault = w;
  const models: Partial<Record<Role, EditableModelInput>> = {};
  for (const role of ROLES) {
    const snap = snapshot.roles.models[role];
    const base = baseline.roles.models?.[role];
    const cur: EditableModelInput = {};
    if (snap && snap.provider !== base?.provider) cur.provider = snap.provider;
    if (snap && snap.model !== base?.model) cur.model = snap.model;
    // 空/空白 reasoningEffort 视为"跟随默认"：不写入 override，effective 保持 baseline/默认。
    const snapEffort = snap?.reasoningEffort?.trim() ? snap.reasoningEffort : undefined;
    if (snapEffort !== undefined && snapEffort !== (base?.reasoningEffort ?? 'high')) cur.reasoningEffort = snapEffort;
    if (Object.keys(cur).length) (models as Record<string, EditableModelInput>)[role] = cur;
  }
  if (Object.keys(models as object).length) out.roles = { models: models as never };
  return out;
}
