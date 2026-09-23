/** prefetch 子代理结构化输出的 JSON Schema（经 ctx.subagents.start 的 outputSchema 传入，
 *  由 spawn provider 在子代理侧强制校验；assertObjectJsonSchema 强制子集内：
 *  type/properties/required/items/enum/additionalProperties）。与 validatePrefetchManifest 同源同语义。 */
export const PREFETCH_MANIFEST_SCHEMA = {
    type: 'object',
    properties: {
        repo: {
            type: 'object',
            properties: {
                localPath: { type: 'string' },
                remoteUrl: { type: 'string' },
                branch: { type: 'string' },
                dirtyFiles: { type: 'array', items: { type: 'string' } },
            },
            required: ['localPath', 'dirtyFiles'],
        },
        files: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    expected: { type: 'string', enum: ['exists', 'absent', 'content-hash'] },
                    note: { type: 'string' },
                },
                required: ['path', 'expected'],
            },
        },
    },
    required: ['repo', 'files'],
};
const EXPECTED_VALUES = new Set(['exists', 'absent', 'content-hash']);
/** 需求澄清清单 manifest schema 校验（planning-checklist 复用本 schema）：返回错误列表（空数组 = 合法）。 */
export function validatePrefetchManifest(raw) {
    const errors = [];
    if (typeof raw !== 'object' || raw === null)
        return ['manifest must be an object'];
    const m = raw;
    const repo = m['repo'];
    if (typeof repo !== 'object' || repo === null) {
        errors.push('manifest.repo required');
    }
    else {
        const r = repo;
        if (typeof r['localPath'] !== 'string' || r['localPath'].trim().length === 0) {
            errors.push(`manifest.repo.localPath required (got: ${JSON.stringify(r['localPath'])})`);
        }
        if (!Array.isArray(r['dirtyFiles']))
            errors.push('manifest.repo.dirtyFiles must be an array');
    }
    if (!Array.isArray(m['files'])) {
        errors.push('manifest.files must be an array');
    }
    else {
        // files[] 逐条错误先收集再聚合（2026-09-21：26 条同文错误墙稀释有效信息，模型只见截断前几条）。
        // 完全相同的消息合并为 "<msg> ×N"，不同消息保持原样与原序。
        const fileErrors = [];
        for (const f of m['files']) {
            if (typeof f !== 'object' || f === null) {
                fileErrors.push('manifest.files entry must be an object');
                continue;
            }
            const e = f;
            if (typeof e['path'] !== 'string' || e['path'].trim().length === 0) {
                fileErrors.push(`manifest.files[].path (got: ${JSON.stringify(e['path'])})`);
            }
            if (typeof e['expected'] !== 'string' || !EXPECTED_VALUES.has(e['expected'])) {
                fileErrors.push(`manifest.files[].expected (got: ${JSON.stringify(e['expected'])})`);
            }
            if (e['expected'] === 'content-hash' && (typeof e['note'] !== 'string' || e['note'].trim().length === 0)) {
                fileErrors.push(`manifest.files[].note required for content-hash (got: ${JSON.stringify(e['note'])})`);
            }
        }
        errors.push(...tallyIdentical(fileErrors));
    }
    return errors;
}
/** 相同消息聚合计数：["a","a","b"] → ["a ×2","b"]。domain 纯函数，无副作用。 */
function tallyIdentical(messages) {
    const counts = new Map();
    for (const msg of messages)
        counts.set(msg, (counts.get(msg) ?? 0) + 1);
    return [...counts.entries()].map(([msg, n]) => (n > 1 ? `${msg} ×${n}` : msg));
}
