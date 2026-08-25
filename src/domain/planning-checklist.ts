// src/domain/planning-checklist.ts
import type { SpecCardSections } from './types.js';
import { validatePrefetchManifest, type PrefetchManifest } from './prefetch-manifest.js';

export interface PlanningChecklist {
  spec: SpecCardSections;
  manifest: PrefetchManifest; // 复用 PrefetchManifest schema（repo.files 为预取基线）
  clarifications: Array<{ q: string; a: string }>;
  doubts: Array<{ q: string; resolved: boolean; answer?: string }>;
}

const STR_FIELDS: Array<[string, keyof SpecCardSections]> = [
  ['problem', 'problem'], ['solution', 'solution'], ['testing', 'testing'], ['out_of_scope', 'out_of_scope'],
];
const ARR_FIELDS: Array<[string, keyof SpecCardSections]> = [['user_stories', 'user_stories'], ['impl_decisions', 'impl_decisions']];

/** 需求澄清清单 schema 硬校验：返回错误列表（空数组=合法）。清单缺段即拒绝保存（硬闸，主 agent 会话内修正）。 */
export function validatePlanningChecklist(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['checklist must be an object'];
  const c = raw as Record<string, unknown>;
  // spec 六段
  const spec = c['spec'] as Record<string, unknown> | undefined;
  if (typeof spec !== 'object' || spec === null) {
    errors.push('checklist.spec required');
  } else {
    for (const [label, key] of STR_FIELDS) {
      if (typeof spec[key] !== 'string' || (spec[key] as string).trim().length === 0) {
        errors.push(`checklist.spec.${label} must be a non-empty string (got: ${JSON.stringify(spec[key])})`);
      }
    }
    for (const [label, key] of ARR_FIELDS) {
      if (!Array.isArray(spec[key]) || (spec[key] as unknown[]).some((v) => typeof v !== 'string')) {
        errors.push(`checklist.spec.${label} must be string[]`);
      }
    }
  }
  // manifest 复用 PrefetchManifest schema
  errors.push(...validatePrefetchManifest(c['manifest']).map((e) => 'checklist.' + e));
  // 澄清问答/疑问点
  for (const key of ['clarifications', 'doubts'] as const) {
    if (!Array.isArray(c[key])) errors.push(`checklist.${key} must be an array`);
  }
  return errors;
}
