// src/domain/planning-checklist.ts
import type { SpecCardSections } from './types.js';
import { validatePrefetchManifest, type PrefetchManifest } from './prefetch-manifest.js';
import { buildChainTitle } from './kanban-service.js';

export interface PlanningChecklist {
  requirementName?: string; // 可选：/plan: rest 首句（与任务卡 title 同源）；缺省回退 spec.problem 首句
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
  // requirementName（可选）：存在则须为非空 string
  if ('requirementName' in c && (typeof c['requirementName'] !== 'string' || !(c['requirementName'] as string).trim())) {
    errors.push('checklist.requirementName must be a non-empty string when present');
  }
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

/** 需求澄清清单页标题：与任务卡 title 同源同逻辑（buildChainTitle），保证 KB 可检索。 */
export function buildChecklistTitle(c: PlanningChecklist): string {
  return buildChainTitle(c.requirementName ?? null, '', c.spec.problem);
}

/** 需求澄清清单落库 body：标题【需求】+ 各段可读 markdown（非裸 JSON）。KB 与临时目录两分支共用。 */
export function formatChecklistBody(c: PlanningChecklist): string {
  const { spec, manifest, clarifications, doubts } = c;
  const lines: string[] = [`# ${buildChecklistTitle(c)}`, '## Spec', ''];
  lines.push('### 问题描述 (problem)', spec.problem, '');
  lines.push('### 解决方案 (solution)', spec.solution, '');
  lines.push('### 用户故事 (user_stories)', ...spec.user_stories.map((u) => `- ${u}`), '');
  lines.push('### 实现决策 (impl_decisions)', ...spec.impl_decisions.map((d) => `- ${d}`), '');
  lines.push('### 测试计划 (testing)', spec.testing, '');
  lines.push('### 范围外 (out_of_scope)', spec.out_of_scope, '');
  lines.push('## Repo 事实 (manifest)', '');
  const { repo, files } = manifest;
  lines.push('- 本地路径: ' + repo.localPath);
  if (repo.remoteUrl) lines.push('- 远端仓库: ' + repo.remoteUrl);
  if (repo.branch) lines.push('- 当前分支: ' + repo.branch);
  lines.push('- 未提交改动: ' + (repo.dirtyFiles.length ? repo.dirtyFiles.map((f) => `\`${f}\``).join(', ') : '无'));
  lines.push('', '### 文件基线', '', '| 路径 | 期望 | 备注 |', '| --- | --- | --- |');
  for (const f of files) lines.push(`| ${f.path} | ${f.expected} | ${f.note ?? '-'} |`);
  lines.push('', '## 澄清问答', '');
  clarifications.forEach((qa, i) => {
    lines.push(`### Q${i + 1}. ${qa.q}`, `- **A**: ${qa.a}`, '');
  });
  if (clarifications.length === 0) lines.push('（无）', '');
  lines.push('## 疑问点', '');
  for (const d of doubts) {
    lines.push(d.resolved ? `- [x] ${d.q}${d.answer ? ` — ${d.answer}` : ''}` : `- [ ] ${d.q}`);
  }
  if (doubts.length === 0) lines.push('（无）');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
