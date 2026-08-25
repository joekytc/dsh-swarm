// src/tools/planning-tools.ts
import { defineTool } from '@deepseek-ai/dsh-tools';
import { validatePlanningChecklist } from '../domain/planning-checklist.js';
import { validatePrefetchManifest } from '../domain/prefetch-manifest.js';
const isWikiError = (e) => e instanceof Error && e.code === 'kb-unreachable';
/** 主 agent 规划期工具：需求澄清清单落库（KB 优先/临时目录兜底）+ 只读仓库预取（子代理）。 */
export function buildPlanningTools(deps) {
    const pagePrefix = deps.pagePrefix ?? 'projects/';
    const session = deps.ownerSessionId ?? 'session_main';
    return [
        defineTool({
            name: 'planning_checklist_save',
            description: 'Save the converged requirement-clarification checklist (structured schema) to KB, falling back to a temp dir if KB is unreachable. Returns ref/path + authoritative repo path.',
            parameters: { checklist: { type: 'json', required: true, description: 'Structured PlanningChecklist: spec six sections + manifest(repo.files) + clarifications + doubts' } },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
            async execute(args) {
                const caller = deps.getCaller();
                if (caller.actor !== 'human')
                    throw new Error('permission denied: planning_checklist_save');
                const errors = validatePlanningChecklist(args.checklist);
                if (errors.length > 0)
                    throw new Error('invalid planning checklist: ' + errors.join('; '));
                const checklist = args.checklist;
                const pagePath = `${pagePrefix}checklists/${session}-${Date.now().toString(36)}.md`;
                const body = [
                    '# 需求澄清清单',
                    '## Spec',
                    JSON.stringify(checklist.spec, null, 2),
                    '## Repo 事实 (manifest)',
                    JSON.stringify(checklist.manifest, null, 2),
                    '## 澄清问答',
                    JSON.stringify(checklist.clarifications, null, 2),
                    '## 疑问点',
                    JSON.stringify(checklist.doubts, null, 2),
                ].join('\n\n');
                try {
                    await deps.wiki.write(pagePath, body);
                    deps.onChecklistSaved?.({ ref: pagePath, source: 'kb', checklist });
                    return { ok: true, ref: pagePath, source: 'kb', repoPath: checklist.manifest.repo.localPath };
                }
                catch (err) {
                    if (!isWikiError(err))
                        throw err;
                    // KB 不可达 → 临时目录兜底
                    const local = `${deps.tempDir()}/${session}-${Date.now().toString(36)}.md`;
                    const { writeFileSync, mkdirSync } = await import('node:fs');
                    mkdirSync(deps.tempDir(), { recursive: true });
                    writeFileSync(local, body, 'utf8');
                    deps.onChecklistSaved?.({ ref: local, source: 'temp', checklist });
                    return { ok: true, ref: local, source: 'temp', repoPath: checklist.manifest.repo.localPath };
                }
            },
        }),
        defineTool({
            name: 'planning_prefetch',
            description: 'Dispatch a READ-ONLY sub-agent to gather repo/material/KB facts for requirement clarification. Returns a structured PrefetchManifest (repo.localPath + files baseline). Never modifies the repo.',
            parameters: {
                scope: { type: 'string', required: true, description: 'What to prefetch (e.g. the target feature area, existing tab implementation, enums)' },
                repoPath: { type: 'string', description: 'Target repo absolute path (if known); sub-agent confirms it' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
            async execute(args) {
                const caller = deps.getCaller();
                if (caller.actor !== 'human')
                    throw new Error('permission denied: planning_prefetch');
                const prompt = [
                    '# 只读仓库预取（planning_prefetch）',
                    `scope: ${args.scope}`,
                    `目标仓库路径: ${args.repoPath ?? '(未指定，需你确认绝对路径)'}`,
                    '规则：只读采集仓库事实（本地路径/远端 URL/当前分支/未提交改动/目标文件基线），禁止 git 写操作、禁止修改任何文件。',
                    '输出：仅输出一个 JSON 对象（无前后缀文字），形如 {"repo":{"localPath":"<绝对路径>","remoteUrl":"<可选>","branch":"<可选>","dirtyFiles":[]},"files":[{"path":"<相对路径>","expected":"exists|absent|content-hash","note":"<可选>"}]}',
                ].join('\n');
                const output = deps.spawnPrefetch
                    ? await deps.spawnPrefetch(prompt, args.repoPath ?? '')
                    : (() => { throw new Error('planning_prefetch: spawnPrefetch not wired — main-session-tools 必须注入只读预取子代理'); })();
                const manifest = parseManifestOutput(output);
                return { ok: true, manifest };
            },
        }),
    ];
}
function parseManifestOutput(output) {
    const text = output.trim();
    const jsonText = text.startsWith('{') ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    let raw;
    try {
        raw = JSON.parse(jsonText);
    }
    catch {
        throw new Error('planning_prefetch: sub-agent did not return valid JSON manifest');
    }
    const errors = validatePrefetchManifest(raw);
    if (errors.length > 0)
        throw new Error('planning_prefetch: invalid manifest from sub-agent: ' + errors.join('; '));
    return raw;
}
