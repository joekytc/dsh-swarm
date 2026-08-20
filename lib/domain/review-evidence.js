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
export function validateReviewEvidence(role, handoff) {
    const missing = [];
    if (!handoff)
        return ['handoff missing'];
    const ev = (handoff.metadata ?? {})['review_evidence'];
    if (!ev || typeof ev !== 'object')
        return ['review_evidence missing'];
    if (ev.verdict !== 'pass' && ev.verdict !== 'fail')
        missing.push('review_evidence.verdict');
    if (!Array.isArray(ev.issues))
        missing.push('review_evidence.issues');
    if (role === 'pt') {
        // 计划结构字段：评审须给出被评审计划产物引用（如 artifacts_path/page 结构）——缺则视为证据不足
        const planRef = ev.reviewPage ?? (handoff.metadata ?? {})['artifacts_path'];
        if (!planRef)
            missing.push('review_evidence.plan (artifacts_path/reviewPage)');
    }
    else {
        // DT：实证校验证据（fail 评审同样必须已实证——test 字段必须存在；仅 pass 要求 exit 0）
        if (!ev.test || typeof ev.test !== 'object')
            missing.push('review_evidence.test');
        else if (ev.verdict === 'pass' && ev.test['exit'] !== 0)
            missing.push('review_evidence.test (exit 0)');
        const buildOk = ev.build && typeof ev.build === 'object';
        const tcOk = ev.typecheck && typeof ev.typecheck === 'object';
        if (!buildOk && !tcOk)
            missing.push('review_evidence.build/typecheck');
        if (ev.lint === undefined)
            missing.push('review_evidence.lint');
        const diffOk = ev.diff && typeof ev.diff === 'object' && Object.keys(ev.diff).length > 0;
        if (!diffOk)
            missing.push('review_evidence.diff (non-empty)');
        if (!ev.git || typeof ev.git !== 'object')
            missing.push('review_evidence.git');
        if (!ev.openCodeReview || typeof ev.openCodeReview !== 'object')
            missing.push('review_evidence.openCodeReview (ocr/fallback)');
    }
    return missing;
}
