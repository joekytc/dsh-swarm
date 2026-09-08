import type { KanbanConfig } from '../config.js';
import type { Role } from './types.js';

export const ROLES: readonly Role[] = ['v', 'p', 'w', 'd', 'pt', 'dt'];

export interface EditableModelInput { provider?: string; model?: string; reasoningEffort?: string; }
export interface EditableOverride {
  wikiVault?: { baseUrl?: string; pagePrefix?: string };
  roles?: { models?: Partial<Record<Role, EditableModelInput>> };
  reviewEngine?: { mode?: 'delegate' | 'managed'; managed?: { provider?: string; model?: string } };
}
export interface EditableModelSnapshot { provider: string; model: string; reasoningEffort: string; }
export interface EditableSnapshot {
  wikiVault: { baseUrl: string; pagePrefix: string };
  roles: { models: Partial<Record<Role, EditableModelSnapshot>> };
  reviewEngine: { mode: 'delegate' | 'managed'; managed: { provider: string; model: string } };
}
export type ConfigSource = 'override' | 'inherited';
export type SourceMap = Record<string, ConfigSource>;

const MODEL_FIELDS = ['provider', 'model', 'reasoningEffort'] as const;

export function mergeConfig(baseline: KanbanConfig, override: EditableOverride | undefined): KanbanConfig {
  const wiki = { ...baseline.wikiVault };
  if (override?.wikiVault?.baseUrl !== undefined) wiki.baseUrl = override.wikiVault.baseUrl;
  if (override?.wikiVault?.pagePrefix !== undefined) wiki.pagePrefix = override.wikiVault.pagePrefix;
  const reviewEngine: KanbanConfig['reviewEngine'] = {
    mode: baseline.reviewEngine?.mode ?? 'delegate',
    managed: { provider: baseline.reviewEngine?.managed?.provider ?? '', model: baseline.reviewEngine?.managed?.model ?? '' },
  };
  if (override?.reviewEngine?.mode !== undefined) reviewEngine.mode = override.reviewEngine.mode;
  if (override?.reviewEngine?.managed?.provider !== undefined) reviewEngine.managed.provider = override.reviewEngine.managed.provider;
  if (override?.reviewEngine?.managed?.model !== undefined) reviewEngine.managed.model = override.reviewEngine.managed.model;
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
  return { ...baseline, wikiVault: wiki, roles: { ...baseline.roles, models }, reviewEngine };
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
  src['reviewEngine.mode'] = override?.reviewEngine?.mode !== undefined ? 'override' : 'inherited';
  src['reviewEngine.managed.provider'] = override?.reviewEngine?.managed?.provider !== undefined ? 'override' : 'inherited';
  src['reviewEngine.managed.model'] = override?.reviewEngine?.managed?.model !== undefined ? 'override' : 'inherited';
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
    reviewEngine: {
      mode: effective.reviewEngine?.mode ?? 'delegate',
      managed: { provider: effective.reviewEngine?.managed?.provider ?? '', model: effective.reviewEngine?.managed?.model ?? '' },
    },
  };
}

export function validateConfig(snapshot: EditableSnapshot): string[] {
  const errs: string[] = [];
  const baseUrl = snapshot.wikiVault.baseUrl ?? '';
  // 空 baseUrl = 本地 llm-wiki 回退（合法）；仅非空时校验 ^https?://。
  if (baseUrl.trim() && !/^https?:\/\//.test(baseUrl)) errs.push('wikiVault.baseUrl');
  if (!(snapshot.wikiVault.pagePrefix ?? '').trim()) errs.push('wikiVault.pagePrefix');
  // 就绪性（managed provider/model 是否已配好）是运行时探测，不在此校验；仅 mode 枚举把关。
  const reMode = snapshot.reviewEngine?.mode;
  if (reMode !== 'delegate' && reMode !== 'managed') errs.push('reviewEngine.mode');
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
  const bre = baseline.reviewEngine ?? { mode: 'delegate' as const, managed: { provider: '', model: '' } };
  const snapMode = snapshot.reviewEngine?.mode ?? 'delegate';
  const snapProvider = snapshot.reviewEngine?.managed?.provider ?? '';
  const snapModel = snapshot.reviewEngine?.managed?.model ?? '';
  const re: EditableOverride['reviewEngine'] = {};
  if (snapMode !== bre.mode) re.mode = snapMode;
  const reManaged: { provider?: string; model?: string } = {};
  if (snapProvider !== bre.managed.provider) reManaged.provider = snapProvider;
  if (snapModel !== bre.managed.model) reManaged.model = snapModel;
  if (Object.keys(reManaged).length) re.managed = reManaged;
  if (Object.keys(re).length) out.reviewEngine = re;
  return out;
}
