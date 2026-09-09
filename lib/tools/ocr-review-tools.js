// src/tools/ocr-review-tools.ts
/** ocr_review 工具：把 ocr CLI 三子命令（preview/rule/managed）封装为 cordis 工具，DT 评审角色工具面注册。
 * 依赖全注入可换 fake（tests），缺省用 ocr-cli 真实现。 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { INSTALL_GUIDANCE, managedProviderReady, probeOcr, runOcr } from '../services/ocr-cli.js';
import { buildOcrArgs, parseManagedJson, parsePreviewJson, shouldSuggestManaged, SUGGEST_MANAGED_FILES } from '../domain/ocr-review.js';
/** 托管未配置时的降级引导：不改道执行，交还调用方决策。 */
const MANAGED_FALLBACK_TEXT = '托管模式未配置 LLM——本次按委托模式执行：改调 sub=\'preview\' 获取评审范围后自行评审';
const SUBS = ['preview', 'rule', 'managed'];
/** 构造 ocr_review 工具定义（defineTool 返回形态，与 kanban-tools 一致）。 */
export function buildOcrReviewTool(deps) {
    const runOcrFn = deps.runOcrFn ?? runOcr;
    const probeFn = deps.probeFn ?? probeOcr;
    const managedReadyFn = deps.managedReadyFn ?? managedProviderReady;
    return defineTool({
        name: 'ocr_review',
        description: 'Review code changes via the ocr CLI. Three subcommands: '
            + "'preview' — first step of delegated review; lists reviewable files and branch metadata "
            + '(JSON output: mode/files/excluded/mergeBase) so you can review them yourself; '
            + "'rule' — batch-fetch review rule groups for the file paths returned by preview; "
            + "'managed' — full hosted review where ocr uses its own configured LLM and returns normalized findings JSON "
            + "(requires prior wiring: ocr config provider=dsh-managed). "
            + "Start with 'preview' to scope the review; prefer 'managed' for large change sets when the managed provider is configured.",
        parameters: {
            sub: { type: 'string', required: true, description: "'preview' | 'rule' | 'managed'" },
            repo: { type: 'string', description: '仓库根绝对路径；缺省用当前工作目录' },
            from: { type: 'string', description: 'base 分支/引用（range 模式）' },
            to: { type: 'string', description: '目标分支/引用（range 模式，默认 HEAD）' },
            commit: { type: 'string', description: '单次提交审查' },
            paths: { type: 'array', items: { type: 'string' }, description: 'rule 子命令的文件路径列表' },
            background: { type: 'string', description: '业务上下文，托管评审时提升评审质量' },
        },
        output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
        async execute(args) {
            const probe = await probeFn();
            if (!probe.installed)
                return INSTALL_GUIDANCE;
            if (args.sub === 'managed' && !managedReadyFn())
                return MANAGED_FALLBACK_TEXT;
            if (!SUBS.includes(args.sub))
                throw new Error(`ocr_review: invalid sub '${args.sub}' (expected 'preview' | 'rule' | 'managed')`);
            if (args.sub === 'rule' && (!args.paths || args.paths.length === 0))
                throw new Error("ocr_review: sub='rule' requires non-empty paths (file path list)");
            if (args.sub === 'managed' && !args.commit && !args.from)
                throw new Error("ocr_review: sub='managed' requires commit or from (base ref)");
            // 托管评审走 ocr 自带 LLM（官方预算 15min×2 rounds），超时须远大于 preview/rule 的本地 git 操作
            const timeoutMs = args.sub === 'managed' ? 2_400_000 : 600_000;
            const res = await runOcrFn(buildOcrArgs(args.sub, { repo: args.repo, from: args.from, to: args.to, commit: args.commit, paths: args.paths, background: args.background }), { cwd: deps.cwd?.() ?? process.cwd(), timeoutMs });
            // 失败不抛错：结果附 error 摘要（error + stderr 前 500 字符），模型拿得到部分结果与原因后自行降级/重试
            const errSummary = res.error ? `${res.error} ${res.stderr.slice(0, 500)}`.trim() : '';
            if (args.sub === 'preview') {
                const preview = parsePreviewJson(res.stdout);
                const errorPart = errSummary ? { error: errSummary } : {};
                if (shouldSuggestManaged(preview.files.length)) {
                    return JSON.stringify({ ...preview, ...errorPart, suggestion: `文件较多（N>${SUGGEST_MANAGED_FILES}），可在配置面板切换托管模式` });
                }
                return JSON.stringify({ ...preview, ...errorPart });
            }
            if (args.sub === 'rule') {
                if (errSummary)
                    return JSON.stringify({ error: errSummary });
                return res.stdout.slice(0, 8000);
            }
            const report = parseManagedJson(res.stdout);
            if (report.status !== 'completed' && res.error)
                return JSON.stringify({ ...report, message: res.error });
            return JSON.stringify(report);
        },
    });
}
