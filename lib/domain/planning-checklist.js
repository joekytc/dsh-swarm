import { validatePrefetchManifest } from './prefetch-manifest.js';
import { buildChainTitle } from './kanban-service.js';
const STR_FIELDS = [
    ['problem', 'problem'], ['solution', 'solution'], ['testing', 'testing'], ['out_of_scope', 'out_of_scope'],
];
const ARR_FIELDS = [['user_stories', 'user_stories'], ['impl_decisions', 'impl_decisions']];
/** 闸2 禁词表：澄清答案中指代不明的缩写；宁窄后扩，避免误伤正常表述。 */
export const FORBIDDEN_SHORTHANDS = ['按推荐', '同上', '见上', '同前', '如前所述', 'same as above', 'ditto', 'see above'];
/** 需求澄清清单 schema 硬校验：返回错误列表（空数组=合法）。清单缺段即拒绝保存（硬闸，主 agent 会话内修正）。 */
export function validatePlanningChecklist(raw) {
    const errors = [];
    if (typeof raw !== 'object' || raw === null)
        return ['checklist must be an object'];
    const c = raw;
    // requirementName（可选）：存在则须为非空 string
    if ('requirementName' in c && (typeof c['requirementName'] !== 'string' || !c['requirementName'].trim())) {
        errors.push('checklist.requirementName must be a non-empty string when present');
    }
    // spec 六段
    const spec = c['spec'];
    if (typeof spec !== 'object' || spec === null) {
        errors.push('checklist.spec required');
    }
    else {
        for (const [label, key] of STR_FIELDS) {
            if (typeof spec[key] !== 'string' || spec[key].trim().length === 0) {
                errors.push(`checklist.spec.${label} must be a non-empty string (got: ${JSON.stringify(spec[key])})`);
            }
        }
        for (const [label, key] of ARR_FIELDS) {
            const arr = spec[key];
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
    }
    else {
        // 硬闸非空（2026-09-04：[] 合法过闸 → KB 页渲染「（无）」→ 澄清问答静默丢失）。
        // 恢复场景（restoreRef 旧页无澄清）走逃生口文案，不加代码分支。
        if (clar.length === 0) {
            errors.push('checklist.clarifications must be a non-empty array — record every clarification Q&A from this planning round. If this checklist genuinely had no clarification round (e.g. rebuilt from a legacy KB page via restoreRef), add one entry {"q": "本轮无澄清（恢复重建）", "a": "<来源页或原因>"}');
        }
        clar.forEach((el, i) => {
            const o = el;
            const ok = typeof o === 'object' && o !== null &&
                typeof o['q'] === 'string' && o['q'].trim().length > 0 &&
                typeof o['a'] === 'string' && o['a'].trim().length > 0;
            if (!ok) {
                const got = typeof o === 'object' && o !== null ? Object.keys(o).join(',') : JSON.stringify(el);
                errors.push(`checklist.clarifications[${i}] must be {"q": string, "a": string} with both non-empty (got keys: ${got}) — use keys "q" and "a", not "question"/"answer"`);
            }
            if (ok) {
                const answer = o['a'].toLowerCase();
                const hit = FORBIDDEN_SHORTHANDS.find((w) => answer.includes(w.toLowerCase()));
                if (hit) {
                    errors.push(`checklist.clarifications[${i}].a contains forbidden shorthand "${hit}" — 每条问答必须含完整决策正文（字段名/接口路径/枚举值/组件名/位置规则），禁止指代不明缩写，展开写全`);
                }
            }
        });
    }
    const dbs = c['doubts'];
    if (!Array.isArray(dbs)) {
        errors.push('checklist.doubts must be an array');
    }
    else {
        dbs.forEach((el, i) => {
            const o = el;
            const ok = typeof o === 'object' && o !== null &&
                typeof o['q'] === 'string' && o['q'].trim().length > 0 &&
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
        }
        else {
            risks.forEach((el, i) => {
                const o = el;
                const ok = typeof o === 'object' && o !== null &&
                    typeof o['description'] === 'string' && o['description'].trim().length > 0 &&
                    typeof o['source'] === 'string' && o['source'].trim().length > 0 &&
                    typeof o['mitigation'] === 'string' && o['mitigation'].trim().length > 0;
                if (!ok) {
                    const got = typeof o === 'object' && o !== null ? Object.keys(o).join(',') : JSON.stringify(el);
                    errors.push(`checklist.risks[${i}] must be {"description": string, "source": string, "mitigation": string} with all non-empty (got keys: ${got}) — use keys "description", "source", "mitigation"`);
                }
            });
        }
    }
    // 闸1：需求来源必挂。恢复重建旧页无来源时按错误文案中的逃生口录「无来源+原因」条目
    const sources = c['sources'];
    if (!Array.isArray(sources) || sources.length === 0) {
        errors.push('checklist.sources must be a non-empty array — record requirement source links (TAPD/Jira/其他). If genuinely no source exists, record exactly [{type:"其他", url:"", note:"无来源+原因"}]');
    }
    else {
        sources.forEach((el, i) => {
            const o = el;
            const typeOk = o !== null && typeof o === 'object' && (o['type'] === 'TAPD' || o['type'] === 'Jira' || o['type'] === '其他');
            const urlOk = typeof o?.['url'] === 'string';
            const noteOk = typeof o?.['note'] === 'string';
            if (!typeOk || !urlOk || !noteOk) {
                const got = typeof o === 'object' && o !== null ? Object.keys(o).join(',') : JSON.stringify(el);
                errors.push(`checklist.sources[${i}] must be {"type": "TAPD"|"Jira"|"其他", "url": string, "note": string} (got keys: ${got})`);
                return;
            }
            if (o['url'].trim() === '' && o['note'].trim() === '') {
                errors.push(`checklist.sources[${i}] url 为空（无来源）时 note 必须写明无来源原因`);
            }
        });
    }
    // 闸3：PRD 采集凭证。登记链接必须落到 collected（含摘要/页路径）或 blocked（含原因）；
    // 其余状态（含漏填）= 登记了却没采 → 拒收
    const prd = c['prdCollection'];
    if (!Array.isArray(prd)) {
        errors.push('checklist.prdCollection must be an array — register every PRD link the user provided (empty [] only when the user gave no PRD link)');
    }
    else {
        prd.forEach((el, i) => {
            const o = el;
            const urlOk = typeof o?.['url'] === 'string' && o['url'].trim().length > 0;
            const status = o?.['status'];
            if (typeof o !== 'object' || o === null || !urlOk) {
                errors.push(`checklist.prdCollection[${i}] must be an object with non-empty "url"`);
                return;
            }
            if (status !== 'collected' && status !== 'blocked') {
                errors.push(`checklist.prdCollection[${i}].status must be "collected" or "blocked" (got: ${JSON.stringify(status)}) — 链接已登记就必须完成采集或记录阻塞原因，禁止悬空`);
                return;
            }
            if (typeof o['summary'] !== 'string' || o['summary'].trim() === '') {
                errors.push(`checklist.prdCollection[${i}].summary must be a non-empty string（采了什么+关键信息+缺口）`);
            }
            if (status === 'blocked' && (typeof o['blockedReason'] !== 'string' || o['blockedReason'].trim() === '')) {
                errors.push(`checklist.prdCollection[${i}].blockedReason required when status="blocked"（登录态 | 缺技能 | 404 | 其他）`);
            }
        });
    }
    // 占位策略（可选）：存在则三要素非空
    const phs = c['placeholders'];
    if (phs !== undefined) {
        if (!Array.isArray(phs)) {
            errors.push('checklist.placeholders must be an array when present');
        }
        else {
            phs.forEach((el, i) => {
                const o = el;
                const ok = typeof o === 'object' && o !== null &&
                    typeof o['target'] === 'string' && o['target'].trim() !== '' &&
                    typeof o['value'] === 'string' &&
                    typeof o['replace'] === 'string' && o['replace'].trim() !== '';
                if (!ok) {
                    const got = typeof o === 'object' && o !== null ? Object.keys(o).join(',') : JSON.stringify(el);
                    errors.push(`checklist.placeholders[${i}] must be {"target": string, "value": string, "replace": string} with target/replace non-empty (got keys: ${got})`);
                }
            });
        }
    }
    // greenfield（可选）：存在即须布尔。true=绿地（无 .git 全新项目），D 阶段建仓前置；false/缺省=既有仓库
    const gf = c['greenfield'];
    if (gf !== undefined && typeof gf !== 'boolean') {
        errors.push(`checklist.greenfield must be a boolean when present (got: ${JSON.stringify(gf)})`);
    }
    return errors;
}
/** 需求澄清清单页标题：与任务卡 title 同源同逻辑（buildChainTitle），保证 KB 可检索。 */
export function buildChecklistTitle(c) {
    return buildChainTitle(c.requirementName ?? null, '', c.spec.problem);
}
/** 需求澄清清单落库 body：标题【需求】+ 各段可读 markdown（非裸 JSON）。KB 与临时目录两分支共用。 */
export function formatChecklistBody(c) {
    const { spec, manifest, clarifications, doubts } = c;
    const risks = c.risks ?? [];
    const lines = [`# ${buildChecklistTitle(c)}`, '## Spec', ''];
    lines.push('### 问题描述 (problem)', spec.problem, '');
    lines.push('### 解决方案 (solution)', spec.solution, '');
    lines.push('### 用户故事 (user_stories)', ...spec.user_stories.map((u) => `- ${u}`), '');
    lines.push('### 实现决策 (impl_decisions)', ...spec.impl_decisions.map((d) => `- ${d}`), '');
    lines.push('### 测试计划 (testing)', spec.testing, '');
    lines.push('### 范围外 (out_of_scope)', spec.out_of_scope, '');
    lines.push('## Repo 事实 (manifest)', '');
    const { repo, files } = manifest;
    lines.push('- 本地路径: ' + repo.localPath);
    if (repo.remoteUrl)
        lines.push('- 远端仓库: ' + repo.remoteUrl);
    if (repo.branch)
        lines.push('- 当前分支: ' + repo.branch);
    lines.push('- 未提交改动: ' + (repo.dirtyFiles.length ? repo.dirtyFiles.map((f) => `\`${f}\``).join(', ') : '无'));
    if (c.greenfield === true)
        lines.push('- greenfield: true（全新项目，D 阶段 git init 建仓前置）');
    lines.push('', '### 文件基线', '', '| 路径 | 期望 | 备注 |', '| --- | --- | --- |');
    for (const f of files)
        lines.push(`| ${f.path} | ${f.expected} | ${f.note ?? '-'} |`);
    lines.push('## 需求来源', '');
    for (const s of c.sources) {
        lines.push(`- [${s.type}] ${s.url || '(无来源)'}${s.note ? ` — ${s.note}` : ''}`);
    }
    lines.push('');
    lines.push('', '## 澄清问答', '');
    clarifications.forEach((qa, i) => {
        lines.push(`### Q${i + 1}. ${qa.q}`, `- **A**: ${qa.a}`, '');
    });
    if (clarifications.length === 0)
        lines.push('（无）', '');
    lines.push('## 风险点', '');
    if (risks.length === 0) {
        lines.push('（无）', '');
    }
    else {
        for (const r of risks) {
            lines.push(`- ${r.description}（来源: ${r.source}；缓解: ${r.mitigation}）`);
        }
        lines.push('');
    }
    lines.push('## 疑问点', '');
    for (const d of doubts) {
        lines.push(d.resolved ? `- [x] ${d.q}${d.answer ? ` — ${d.answer}` : ''}` : `- [ ] ${d.q}`);
    }
    if (doubts.length === 0)
        lines.push('（无）');
    lines.push('', '## PRD 采集记录', '');
    const prd = c.prdCollection ?? [];
    if (prd.length === 0) {
        lines.push('（用户未提供 PRD 链接）');
    }
    else {
        for (const p of prd) {
            lines.push(`- ${p.url} — ${p.status}${p.platform ? `（${p.platform}）` : ''}${p.degraded ? ' — degraded（截图超限或写入失败，已降级为文字描述）' : ''}`);
            lines.push(`  - 摘要: ${p.summary}`);
            if (p.status === 'blocked' && p.blockedReason)
                lines.push(`  - 阻塞原因: ${p.blockedReason}`);
            for (const pg of p.pages ?? [])
                lines.push(`  - 原文页: ${pg}`);
        }
    }
    lines.push('', '## 占位策略', '');
    const phs = c.placeholders ?? [];
    if (phs.length === 0) {
        lines.push('（无后端未就绪项）');
    }
    else {
        lines.push('| 占位对象 | 占位值 | 替换方式 |', '| --- | --- | --- |');
        for (const p of phs)
            lines.push(`| ${p.target} | ${p.value} | ${p.replace} |`);
    }
    // 机读段（2026-09-21 恢复流程矫正）：页正文是人读 markdown（有损），重启恢复若让 LLM 读页重建
    // 再回存 = 有损再创作 + 双重编码风险（销服一体清单 7 轮失败即发生在恢复场景）。页尾内嵌无损
    // JSON 单行段，/openspec: 路由2 直接提取灌内存建链，LLM 零参与；HTML 注释对人读零干扰。
    const machine = JSON.stringify({ requirementName: c.requirementName ?? null, spec: c.spec, manifest: c.manifest, clarifications: c.clarifications, doubts: c.doubts, risks: c.risks ?? [], sources: c.sources, prdCollection: c.prdCollection ?? [], placeholders: c.placeholders ?? [], greenfield: c.greenfield ?? false });
    lines.push('', `<!-- dsh-swarm:checklist-json ${machine} -->`);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
const CHECKLIST_JSON_MARK = '<!-- dsh-swarm:checklist-json ';
/** 从清单页原文提取机读 PlanningChecklist（无损恢复路径）：无段/损坏/校验不过一律返回 null，
 *  由调用方回退 legacy LLM 重建流程。domain 纯函数，无副作用。 */
export function extractChecklistJson(pageMd) {
    const start = pageMd.indexOf(CHECKLIST_JSON_MARK);
    if (start < 0)
        return null;
    const jsonStart = start + CHECKLIST_JSON_MARK.length;
    const end = pageMd.indexOf('-->', jsonStart);
    if (end < 0)
        return null;
    let raw;
    try {
        raw = JSON.parse(pageMd.slice(jsonStart, end).trim());
    }
    catch {
        return null;
    }
    if (validatePlanningChecklist(raw).length > 0)
        return null;
    return raw;
}
/** PRD 链接域名路由：已知平台直接判定，其余返回 null 交 LLM 自判。 */
export function routePrdPlatform(url) {
    let host;
    try {
        host = new URL(url).hostname.toLowerCase();
    }
    catch {
        return null;
    }
    if (host === 'feishu.cn' || host.endsWith('.feishu.cn'))
        return 'feishu';
    if (host === 'doc.weixin.qq.com')
        return 'wecom';
    if (host === 'modao.cc' || host.endsWith('.modao.cc'))
        return 'modao';
    return null;
}
/** PRD 原文切片：优先按一级标题（# 开头）切章，单片超 maxBytes 按行硬切。
 *  默认 45KB/片（wiki 大文档拆页惯例，低于服务端 body 上限留余量）。 */
export function slicePrdMarkdown(md, maxBytes = 45_000) {
    const chapters = [];
    let cur = [];
    for (const line of md.split('\n')) {
        if (/^#\s/.test(line) && cur.length > 0) {
            chapters.push(cur.join('\n'));
            cur = [line];
        }
        else {
            cur.push(line);
        }
    }
    if (cur.length > 0)
        chapters.push(cur.join('\n'));
    const parts = [];
    for (const ch of chapters) {
        if (Buffer.byteLength(ch, 'utf8') <= maxBytes) {
            parts.push(ch);
            continue;
        }
        let buf = [];
        let size = 0;
        for (const line of ch.split('\n')) {
            const lb = Buffer.byteLength(line + '\n', 'utf8');
            if (size + lb > maxBytes && buf.length > 0) {
                parts.push(buf.join('\n'));
                buf = [];
                size = 0;
            }
            buf.push(line);
            size += lb;
        }
        if (buf.length > 0)
            parts.push(buf.join('\n'));
    }
    return parts.length > 0 ? parts : [''];
}
