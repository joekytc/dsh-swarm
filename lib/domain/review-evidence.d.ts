import type { Handoff } from './types.js';
/**
 * 评审证据机械校验（交付质量链 PT/DT 共用）：
 * PT/DT 完成交接 metadata.review_evidence 必须满足角色所需的证据结构，
 * 缺证据拒绝 pass（评审卡 complete 被拒 / orchestrator 不推进）。
 *
 * - PT（计划评审）：必需 verdict + issues + 计划结构字段（对齐需求/完整性/逻辑交互一致性的产物引用）。
 * - DT（实现评审）：必需 verdict + test(exit 0) + build/typecheck/lint + diff 非空 + git 证据 +
 *   ocr/fallback 结论 + issues 处置。
 *
 * @returns 缺失清单（空数组 = 证据完整）。
 */
export declare function validateReviewEvidence(role: 'pt' | 'dt', handoff: Handoff | undefined): string[];
