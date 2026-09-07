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
  risks?: Array<{ description: string; source: string; mitigation: string }>; // guidance 第4条风险登记的落库位；description=风险描述，source=来源决定，mitigation=缓解思路
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
      const arr: unknown = spec[key];
      if (!Array.isArray(arr)) {
        errors.push(`checklist.spec.${label} must be an array of plain strings (got: ${JSON.stringify(arr)})`);
        continue;
      }
      // 校验器错误文案是模型的 prompt（2026-09-04 二次复发：对象数组只回裸文案，模型零回显无法自纠）——
      // 必须带 got: 回显 + 拍平指引。判定逻辑不变：非数组或含非字符串元素即拒。
      const badIdx = arr.findIndex((v) => typeof v !== 'string');
      if (badIdx >= 0) {
        errors.push(`checklist.spec.${label} must be an array of plain strings; element ${badIdx} is not a string (got: ${JSON.stringify(arr[badIdx])}). Flatten objects into one sentence per element, e.g. "As a <role>, I want <capability>, so that <benefit>" for ${label}`);
      }
    }
  }
  // manifest 复用 PrefetchManifest schema
  errors.push(...validatePrefetchManifest(c['manifest']).map((e) => 'checklist.' + e));
  // 澄清问答/疑问点：数组 + 元素形状硬校验。渲染读 qa.q/qa.a——键名错会静默产出 undefined 页面
  //（2026-09-04 事故：模型传 {question,answer} 过闸，落库 9 条全 undefined），故必须锁确切键名。
  const clar = c['clarifications'];
  if (!Array.isArray(clar)) {
    errors.push('checklist.clarifications must be an array');
  } else {
    // 硬闸非空（2026-09-04：[] 合法过闸 → KB 页渲染「（无）」→ 澄清问答静默丢失）。
    // 恢复场景（restoreRef 旧页无澄清）走逃生口文案，不加代码分支。
    if (clar.length === 0) {
      errors.push('checklist.clarifications must be a non-empty array — record every clarification Q&A from this planning round. If this checklist genuinely had no clarification round (e.g. rebuilt from a legacy KB page via restoreRef), add one entry {"q": "本轮无澄清（恢复重建）", "a": "<来源页或原因>"}');
    }
    clar.forEach((el, i) => {
      const o = el as Record<string, unknown> | null;
      const ok =
        typeof o === 'object' && o !== null &&
        typeof o['q'] === 'string' && (o['q'] as string).trim().length > 0 &&
        typeof o['a'] === 'string' && (o['a'] as string).trim().length > 0;
      if (!ok) {
        const got = typeof o === 'object' && o !== null ? Object.keys(o).join(',') : JSON.stringify(el);
        errors.push(`checklist.clarifications[${i}] must be {"q": string, "a": string} with both non-empty (got keys: ${got}) — use keys "q" and "a", not "question"/"answer"`);
      }
    });
  }
  const dbs = c['doubts'];
  if (!Array.isArray(dbs)) {
    errors.push('checklist.doubts must be an array');
  } else {
    dbs.forEach((el, i) => {
      const o = el as Record<string, unknown> | null;
      const ok =
        typeof o === 'object' && o !== null &&
        typeof o['q'] === 'string' && (o['q'] as string).trim().length > 0 &&
        typeof o['resolved'] === 'boolean' &&
        (o['answer'] === undefined || typeof o['answer'] === 'string');
      if (!ok) {
        const got = typeof o === 'object' && o !== null ? Object.keys(o).join(',') : JSON.stringify(el);
        errors.push(`checklist.doubts[${i}] must be {"q": string, "resolved": boolean, "answer"?: string} (got keys: ${got}) — use keys "q", "resolved", "answer"`);
      }
    });
  }
  // 风险点（可选）：存在则硬校验三要素键名。渲染读 r.description/r.source/r.mitigation——键名错会静默产出 undefined 行
  const risks = c['risks'];
  if (risks !== undefined) {
    if (!Array.isArray(risks)) {
      errors.push('checklist.risks must be an array when present');
    } else {
      risks.forEach((el, i) => {
        const o = el as Record<string, unknown> | null;
        const ok =
          typeof o === 'object' && o !== null &&
          typeof o['description'] === 'string' && (o['description'] as string).trim().length > 0 &&
          typeof o['source'] === 'string' && (o['source'] as string).trim().length > 0 &&
          typeof o['mitigation'] === 'string' && (o['mitigation'] as string).trim().length > 0;
        if (!ok) {
          const got = typeof o === 'object' && o !== null ? Object.keys(o).join(',') : JSON.stringify(el);
          errors.push(`checklist.risks[${i}] must be {"description": string, "source": string, "mitigation": string} with all non-empty (got keys: ${got}) — use keys "description", "source", "mitigation"`);
        }
      });
    }
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
  const risks = c.risks ?? [];
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
  lines.push('## 风险点', '');
  if (risks.length === 0) {
    lines.push('（无）', '');
  } else {
    for (const r of risks) {
      lines.push(`- ${r.description}（来源: ${r.source}；缓解: ${r.mitigation}）`);
    }
    lines.push('');
  }
  lines.push('## 疑问点', '');
  for (const d of doubts) {
    lines.push(d.resolved ? `- [x] ${d.q}${d.answer ? ` — ${d.answer}` : ''}` : `- [ ] ${d.q}`);
  }
  if (doubts.length === 0) lines.push('（无）');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
