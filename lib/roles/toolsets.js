import { resolve } from 'node:path';
import { KanbanService } from '../domain/kanban-service.js';
import { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { isInsideKbRoot, ensureLocalKbRoot } from '../wiki/local-kb.js';
import { LocalWikiClient } from '../wiki/local-kb-client.js';
import { isStandaloneReviewNamespacePath } from '../domain/ocr-review.js';
import { isRoleComposed } from '../dispatcher/agent-runner.js';
import { ESCALATION_PARAM_KEYS } from './clean-fs-tools.js';
export { isRoleComposed };
import { buildKanbanTools } from '../tools/kanban-tools.js';
import { buildSpecCardTools } from '../tools/spec-card-tools.js';
import { buildWikiTools } from '../tools/wiki-tools.js';
import { buildPrefetchTools } from '../tools/prefetch-tools.js';
import { buildOcrReviewTool } from '../tools/ocr-review-tools.js';
import { WikiWorker } from './wiki-worker.js';
/** 直接写工具（无条件视为写能力；只读工具如 read/glob/grep 不算）。 */
const DIRECT_WRITE_TOOLS = new Set(['write', 'edit', 'rm', 'mv', 'cp', 'mkdir', 'mkfile']);
/** bash/run_code 命令中的写操作标记（写证据启发式；ls/cat/grep/git show 等只读不算）。
 *  与 chain-auditor 同源；重定向标记用 \s>>?（要求 > 前有空白），避免 2>/dev/null 只读重定向误判。
 *  git 细化（2026-09-08）：merge(?!-base) 防 merge-base 查询被误判；tag 只认带非 -l/-n 参数的
 *  变更形态（tag -l/-n/裸 为列表查询），两份正则（toolsets/chain-auditor）改动须同步。 */
const BASH_WRITE_RE = /(?:\b(?:touch|mkdir|rm|rmdir|mv|cp|tee|truncate|install|ln|dd|chmod|chown|make|cmake)\b|\bgit\s+(?:-C\s+\S+\s+)*(?:add|commit|push|mv|rm|checkout\s+-b|switch\s+-c|worktree\s+add|merge(?!-base)|rebase|reset|clean|restore|tag\s+(?!-l\b|-n\b)\S+|remote\s+add|apply)\b|\bpnpm\s+(?:add|install|remove|update|link)\b|\bnpm\s+(?:i|install|add|remove|uninstall|update)\b|\byarn\s+(?:add|remove)\b|\bbun\s+(?:add|install|remove)\b|\bsed\s+-i\b|\bperl\s+-i\b|\s>>?)/i;
/** run_code（JS/TS/Python 程序）中的写操作标记：文件写 API / 命令派发写工具。
 *  含 Python 写标记（DT run_code 盲区闭环）：open() 写模式精确版（'w'/'a'/'w+'/'a+' 及
 *  wb/ab 等变体，读模式 'r' 不命中）、os. 模块写、pathlib Path 写、shutil 复制/移动/删除。 */
const CODE_WRITE_RE = /(?:\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|unlinkSync|unlink|rmSync|rm|mkdirSync|mkdir|cpSync|renameSync)\b|\bwriteFile\(|\bfs\s*\.\s*(?:write|append|createWrite)|\bopen\(\s*['"][^'"\n]*['"]\s*,\s*(?:(?:mode|encoding|errors|buffering|newline|closefd|opener|text)\s*=\s*)?['"][wa][^'"\n]*['"]|\bos\s*\.\s*(?:remove|unlink|write|rmdir|makedirs|rename)\b|\.(?:write_text|write_bytes|unlink|mkdir|rename)\(|shutil\s*\.\s*(?:copy|move|rmtree))/i;
/** git 只读动词白名单：命中则 git 命令放行；其余 git 动词（含 checkout/branch/stash/merge/commit/push 等）一律拒绝。
 *  反选比枚举 mutation 更全：新增 mutation 动词无需维护。config/remote 兼具读写语义但仅改 .git 元数据不改源码，
 *  故不列入白名单（拒绝）；纯读子命令（status/log/show/diff/rev-parse/ls-files/ls-tree/grep/blame/describe/
 *  shortlog/help/version/count-objects/fsck）放行。 */
const GIT_READ_VERBS = new Set(['status', 'log', 'show', 'diff', 'rev-parse', 'ls-files', 'ls-tree', 'grep', 'blame', 'describe', 'shortlog', 'help', 'version', 'count-objects', 'fsck']);
/** 护栏用增强写意图：BASH_WRITE_RE（写动词 + 带空格重定向）∪ 无空格重定向（fd2 stderr 豁免用 lookbehind：
 *  重定向符前（首个 > 前）字符非 '2' 才算写意图，且禁止从 >> 的第二个 > 起匹配；2>/dev/null、2>&1、
 *  2>>err.log 放行，1>/0>/>file/x> 一律命中）∪ 解释器 -c/-e 单行（node/python3/perl/ruby/sh/bash 等
 *  可直接执行任意文件写 API）∪ 原地编辑器 -i（sed -i / perl -i / awk -i inplace：可越过重定向直达
 *  源码原地改写，P 写护栏硬约束须识别，与 BASH_WRITE_RE 同源）。 */
const GUARD_WRITE_INTENT_RE = /(?:\b(?:touch|mkdir|rm|rmdir|mv|cp|tee|truncate|install|ln|dd|chmod|chown|make|cmake)\b|\b(?:sed|perl|awk)\s+-i\b|\b(?:node|python|python3|perl|ruby|php|sh|bash)\s+-[ec]\b|(?<!2)>>|(?<!2)(?<!>)>)/i;
/** run_code（JS/TS/Python 程序）重定向写意图：仅带空格形态 \s>>?（run_code 内嵌 shell 字符串的
 *  `echo x > f` 重定向，与 BASH_WRITE_RE 的带空格形态同源）。对 run_code 必须与 bash 的
 *  GUARD_WRITE_INTENT_RE 分离（planguard-falsepositive 根治）：
 *  1) 无空格 `>` 规则移除——JS 里 `=>`（箭头函数）、`remaining>0`（比较）是运算符而非重定向，
 *     误判致 P 会话 openspec 裸 edit 随机被拒（15 次误报实证，2026-09-03）；
 *  2) GUARD 写动词（touch/mkdir/rm/…）与解释器 -c/-e、原地编辑器 -i 移除——真文件写由
 *     CODE_WRITE_RE 补回覆盖（writeFile/mkdir/unlink/open 写模式/os./pathlib/shutil），
 *     内嵌 shell 裸动词由 CODE_SHELL_VERB_RE 补回覆盖，内嵌 shell 重定向由
 *     本正则覆盖。三层分工与 accepted-risk 见 CODE_SHELL_VERB_RE 注释。 */
const CODE_REDIRECT_WRITE_RE = /\s>>?/;
/** run_code 内嵌 shell 裸动词写意图：CODE_WRITE_RE 只含文件写
 *  API，不含裸 shell 动词——run_code 字符串派发的 shell 命令（`child_process.exec('cp /tmp/x
 *  src/foo.ts')`）会绕过写护栏。词表对齐 GUARD_WRITE_INTENT_RE 动词清单中 CODE_WRITE_RE 未覆盖
 *  的部分（rm/mkdir 已由 CODE_WRITE_RE 覆盖不重复；touch/rmdir/make/cmake 按评审定版不纳入）。
 *  word boundary 形态：JS 里作为独立词出现即拦（copy/cpSync/mkdirSync 等复合词不误伤），
 *  误伤率与 GUARD 复用旧版一致可接受。三层分工：内嵌 shell 动词由本词表覆盖；重定向由
 *  CODE_REDIRECT_WRITE_RE（带空格 \s>>?）覆盖；JS/Python 文件写 API 由 CODE_WRITE_RE 覆盖。
 *  accepted-risk：内嵌 shell 无空格重定向（`exec('cat t>src/y')`）与 JS 运算符（=>、比较）
 *  在正则上不可分辨——无空格 `>` 规则一旦保留即复活 planguard-falsepositive 运算符误报
 *  （15 次实证），GUARD 复用旧版拦得住它但误报面更大，取舍为放行（accepted-risk）；
 *  run_code 带空格比较 `a > b` 且同 code 含 openspec/changes 路径时仍可能误拒（残余面小，
 *  失败可恢复——模型改用 write 工具重试即可）。 */
const CODE_SHELL_VERB_RE = /\b(?:cp|mv|tee|dd|chmod|chown|ln|install|truncate)\b/i;
/** 剥去 shell 重定向目标 token 外壳的一层引号（' " `）（修复引号包裹 plan 路径的误拒）。
 *  仅剥对称外壳一层；剥完仍走 resolve+isPlanPath，.. / 绝对路径逃逸不被削弱。 */
function stripShellQuotes(tok) {
    const q = tok[0];
    if (tok.length >= 2 && (q === "'" || q === '"' || q === '`') && tok[tok.length - 1] === q) {
        return tok.slice(1, -1);
    }
    return tok;
}
/** 从 bash/run_code 写意图命令提取实际写目标路径。
 *  redirectRe 按入口分流：bash 传 BASH_REDIRECT_TARGET_RE（无空格形态），run_code 传
 *  CODE_REDIRECT_TARGET_RE（带空格形态）——两形态各自命名，禁止共享开关参数。
 *  另提取 writeFileSync(/appendFileSync( 首个字符串实参；提取不到返回空数组（调用方据此
 *  fail-closed 或放行）。 */
function extractWriteTargets(cmd, redirectRe) {
    const out = [];
    let m;
    while ((m = redirectRe.exec(cmd)) !== null) {
        if (m[1])
            out.push(stripShellQuotes(m[1]));
    }
    const apiRe = /\b(?:writeFileSync|appendFileSync)\s*\(\s*(['"`])(.*?)\1/g;
    while ((m = apiRe.exec(cmd)) !== null) {
        if (m[2])
            out.push(m[2]);
    }
    // 双模式：动词目标提取——必须捕获动词后【全部】路径实参（只取首个会让
    // `mkdir -p <kb>/x /repo/y` 漏检第二个目标 → 护栏越权放行）。
    // cp/mv/rm 的源+目标全部入列：任一在库根外即整体拒绝（fail-closed，accepted-risk：
    // 库根内合法 cp/mv 改用 write 工具完成）。
    const verbRe = /\b(?:touch|mkdir|tee|cp|mv|rm|install)\b([^;&|<>]*)/g;
    while ((m = verbRe.exec(cmd)) !== null) {
        for (const tok of m[1].split(/\s+/)) {
            if (!tok || tok.startsWith('-'))
                continue;
            out.push(stripShellQuotes(tok));
        }
    }
    return out;
}
/** bash 重定向目标提取（无空格形态）：`>file`/`>>file` 是 bash 合法写重定向，必须识别为写目标；
 *  fd2 stderr 豁免沿用 lookbehind（重定向符前（首个 > 前）字符非 '2' 才算，2>/dev/null、2>&1、
 *  2>>err.log 不命中），且禁止从 >> 的第二个 > 起匹配。仅用于 bash 入口。 */
const BASH_REDIRECT_TARGET_RE = /(?:(?<!2)>>|(?<!2)(?<!>)>)\s*([^\s;&|<>]+)/g;
/** run_code 重定向目标提取（带空格形态）：run_code 是 JS/TS/Python 程序代码，无空格 `>` 是
 *  运算符（箭头 =>、比较 remaining>0），旧版无空格形态会把 `>0` 的 "0" 提取成写目标 →
 *  isPlanPath("0")=false → openspec 裸 edit 随机误拒（15 次误报实证）。故只认带空格重定向
 *  （run_code 内嵌 shell 字符串 `echo x > /tmp/f`），与 CODE_REDIRECT_WRITE_RE 同源。 */
const CODE_REDIRECT_TARGET_RE = /\s>>?\s*([^\s;&|<>]+)/g;
/** 判定 wiki 路径是否位于 DT 评审命名空间 projects/<repoSlug>/<chainId>/review/
 *  （repoSlug=[a-z0-9-]+ 通配，chainId 精确匹配；拒绝 ../、绝对路径、跨链、旧格式直挂根）。 */
export function isReviewNamespacePath(pagePath, chainId) {
    const p = String(pagePath ?? '');
    if (!p || p.startsWith('/') || p.includes('..'))
        return false;
    const chain = chainId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^projects\\/[a-z0-9-]+\\/${chain}\\/review\\/`).test(p);
}
/**
 * DT 写护栏 = PT 只读护栏（源码/git/写标记 bash 拒绝）+ wiki_write 仅 review namespace 收窄。
 * repoRoot 为 D 目标仓库；chainId 用于 wiki 评审命名空间校验。
 */
export function buildDTWriteGuard(repoRoot, chainId) {
    const base = buildReadOnlyWriteGuard(repoRoot);
    return (execution) => {
        const name = String(execution?.name ?? '');
        if (name === 'wiki_write') {
            const args = execution?.arguments ?? {};
            const pagePath = String(args && typeof args === 'object' ? args['pagePath'] ?? '' : '');
            if (!isReviewNamespacePath(pagePath, chainId))
                return 'wiki-write-outside-review-namespace: DT may only write projects/<repoSlug>/<chain>/review/';
        }
        return base(execution);
    };
}
export function buildReadOnlyWriteGuard(_repoRoot) {
    return (execution) => {
        const name = String(execution?.name ?? '');
        const args = execution?.arguments ?? {};
        // 全名拦截——只读会话（W/PT/DT）fs 写无条件拒绝，不再依赖 repoRoot 子串 / hitsRepo。
        // W 是 danger-full-access（无 workspace-write sandbox 兜底），可写 repo 外任意路径（~/x、/tmp/x、
        // 其他项目源码），故必须工具级全名拦截封死。非写工具（read/glob/grep/wiki_* 等）照常放行。
        if (DIRECT_WRITE_TOOLS.has(name))
            return 'write-to-repo-source-denied: read-only reviewer must not modify repo sources';
        if (name === 'bash' || name === 'run_code') {
            const cmd = String(args && typeof args === 'object' ? (args['command'] ?? args['code'] ?? '') : '');
            // bash 用 BASH_WRITE_RE（写动词 + git mutation + 带空格重定向）∪ GUARD_WRITE_INTENT_RE
            // （无空格重定向 + 解释器 -c/-e）——全名拦截，写标记即拒，无论目标是否在 repo 内。
            // run_code 与 bash 分离（planguard-falsepositive 根治）：CODE_WRITE_RE（文件写 API）
            // ∪ CODE_SHELL_VERB_RE（内嵌 shell 裸动词，exec cp/mv 不再绕过）∪
            // CODE_REDIRECT_WRITE_RE（带空格重定向）——无空格 > 在 JS 里是运算符（=>、比较），
            // 不能复用 GUARD_WRITE_INTENT_RE（P 会话 15 次误报实证）。
            const isWrite = name === 'run_code'
                ? CODE_WRITE_RE.test(cmd) || CODE_SHELL_VERB_RE.test(cmd) || CODE_REDIRECT_WRITE_RE.test(cmd)
                : BASH_WRITE_RE.test(cmd) || GUARD_WRITE_INTENT_RE.test(cmd);
            if (cmd && isWrite)
                return 'write-to-repo-source-denied: ' + name + ' with write marker';
        }
        return undefined;
    };
}
/** 本地模式 KB 写护栏：全名只读拦截（base）之上，仅对「实际写目标全部为
 *  库根内绝对路径」的写操作豁免。目标提取不到 / 相对路径 / 越界 → 维持 base 拒绝（fail-closed）。
 *  仅 local 模式对 W/DT 装配；remote 模式仍用 buildReadOnlyWriteGuard（库根写也被拒）。
 *  审查修订：extractWriteTargets 保持既有双参签名（cmd, redirectRe），按入口分流
 *  传 BASH_REDIRECT_TARGET_RE / CODE_REDIRECT_TARGET_RE（与 buildPlanWriteGuard 同款）——
 *  单参调用会在首个写意图命令上 TypeError。 */
export function buildKbWriteGuard(kbRoot) {
    const base = buildReadOnlyWriteGuard(kbRoot);
    const isKbTarget = (t) => isInsideKbRoot(kbRoot, t);
    return (execution) => {
        const baseReason = base(execution);
        if (!baseReason)
            return undefined;
        const name = String(execution?.name ?? '');
        const args = execution?.arguments ?? {};
        const a = args && typeof args === 'object' ? args : {};
        if (DIRECT_WRITE_TOOLS.has(name)) {
            const target = String(a['path'] ?? a['file_path'] ?? '');
            if (target && isKbTarget(target))
                return undefined;
            return baseReason;
        }
        if (name === 'bash' || name === 'run_code') {
            const cmd = String(a['command'] ?? a['code'] ?? '');
            if (!cmd)
                return baseReason;
            // 双参签名 + 按入口分流 redirect 正则（审查修订）；targets 为空 = 写意图但提取不到目标 → fail-closed 拒绝
            const targets = extractWriteTargets(cmd, name === 'bash' ? BASH_REDIRECT_TARGET_RE : CODE_REDIRECT_TARGET_RE);
            if (targets.length > 0 && targets.every(isKbTarget))
                return undefined;
            return baseReason;
        }
        return baseReason;
    };
}
/** P 专用写护栏：读全放行；git mutation 一律拒绝；写仅允许目标仓库 openspec/changes 目录。
 *  直接 fs 写工具 → 路径经 resolve 归一化后须落在 <workspaceRoot>/openspec/changes/ 之下（相邻段对判定）；
 *  bash/run_code 写标记命令 → 命令文本须含 `openspec/changes` 子串，且提取出的实际写目标（重定向
 *  目标 / writeFileSync 实参）逐条经 resolve+isPlanPath 校验（杀 openspec/changes/../.. 穿越写源码）。
 *  源码/src/lib/tests 等写不入（不含该子串）——"禁止改动源码"为工具级硬约束，非 prompt 软约束。
 *  execution 以 dsh-tools 形态 { name, arguments } 传入（与 buildReadOnlyWriteGuard 一致）。 */
export function buildPlanWriteGuard(workspaceRoot) {
    const wsRoot = workspaceRoot.replace(/\/+$/, '');
    /** 目标路径须解析后落在 wsRoot 之下、且含相邻 openspec→changes 段对。
     *  resolve 折叠 ../ 与重复斜杠（杀 .. 穿越）；wsRoot + '/' 边界前缀（杀 /ws/main2 前缀逃逸）；
     *  相对路径（openspec/changes/x.md）经 resolve 归到 wsRoot 之下 → 允许。 */
    const isPlanPath = (p) => {
        if (!p)
            return false;
        const resolved = resolve(wsRoot, p);
        // POSIX 上 \ 是合法文件名字符（如目录名 openspec\changes），反斜杠归一化仅 win32 需要，
        // 否则会把它折叠成相邻 openspec→changes 段对而被误放行。
        const norm = process.platform === 'win32' ? resolved.replace(/\\/g, '/') : resolved;
        if (!norm.startsWith(wsRoot + '/'))
            return false;
        const segs = norm.split('/');
        const i = segs.indexOf('openspec');
        return i >= 0 && segs[i + 1] === 'changes';
    };
    const isPlanCmd = (cmd) => cmd.includes('openspec/changes');
    return (execution) => {
        const name = String(execution?.name ?? '');
        const args = execution?.arguments ?? {};
        const a = args && typeof args === 'object' ? args : {};
        if (DIRECT_WRITE_TOOLS.has(name)) {
            // Fix（2026-09-02 P 会话 30 连败事故）：P 会话为 danger-full-access（天花板），官方 write/edit
            // schema 仍广播可选参数 sandbox_permissions，模型误填后任何值都触发官方 approveEscalation
            // "not strictly wider" 拒绝（escalation 必须严格更宽，天花板无更宽可升）。此处工具级拦截：
            // 带该参数即拒并返回自解释文案（模型一轮纠偏改用裸 file_path+content），先于路径判定（参数
            // 本身即非法，与目标无关）。
            if (a['sandbox_permissions'] !== undefined) {
                return 'plan-guard: 本会话已是 danger-full-access（权限天花板），禁止附带 sandbox_permissions（任何值都会被拒绝，且无需升级）。请直接用 file_path + content 裸写 openspec/changes/ 下的目标文件，不要重试被拒的带参调用。';
            }
            const target = String(a['path'] ?? a['file_path'] ?? '');
            if (isPlanPath(target))
                return undefined;
            return 'plan-guard: P 写仅允许 openspec/changes/ 目录（禁止改动源码）';
        }
        if (name === 'bash' || name === 'run_code') {
            const cmd = String(a['command'] ?? a['code'] ?? '');
            if (!cmd)
                return undefined;
            // FIRST git 判定（仅命令文本，不扫写入内容——修复内容误拒）：
            // 按 && / || / ; / | / 换行 分段，逐段提取首个 git 动词（先跳过 git 全局选项
            // --no-pager/-p/-v/--bare/--literal-pathspecs/--no-replace-objects/-C <path>/-c <kv>/
            // --git-dir=/--work-tree=/--namespace=）。任何一段含 git 却提取不到动词（如 git --version
            // 或裸 git）→ fail-closed 拒绝；动词非只读白名单 → 拒绝。修复链式绕过与全局选项前缀 fall-through。
            const segments = cmd.split(/\s*(?:&&|\|\||;|\||\n)\s*/);
            for (const seg of segments) {
                if (!/\bgit\b/.test(seg))
                    continue;
                const verbMatch = seg.match(/\bgit(?:\s+(?:--no-pager|-p|-v|--bare|--literal-pathspecs|--no-replace-objects|-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+|--namespace=\S+))*\s+([a-zA-Z][\w-]*)/);
                const verb = verbMatch ? verbMatch[1] : undefined;
                if (!verb || !GIT_READ_VERBS.has(verb))
                    return 'plan-guard: P 禁止 git 操作';
            }
            // THEN 写意图：bash 用增强写标记（含无空格重定向与解释器 -c/-e）且不含 plan 路径 → 拒绝。
            // run_code 与 bash 分离（planguard-falsepositive 根治，2026-09-03）：CODE_WRITE_RE（文件
            // 写 API）∪ CODE_SHELL_VERB_RE（内嵌 shell 裸动词）∪ CODE_REDIRECT_WRITE_RE
            // （带空格重定向）——无空格 > 在 JS 里是运算符（=>、比较 remaining>0），
            // GUARD_WRITE_INTENT_RE 复用致 openspec 裸 edit 随机误拒（15 次实证）；GUARD 动词/
            // 解释器对 run_code 移除的论证见 CODE_REDIRECT_WRITE_RE / CODE_SHELL_VERB_RE 注释。
            const isWrite = name === 'run_code'
                ? CODE_WRITE_RE.test(cmd) || CODE_SHELL_VERB_RE.test(cmd) || CODE_REDIRECT_WRITE_RE.test(cmd)
                : GUARD_WRITE_INTENT_RE.test(cmd);
            if (isWrite) {
                if (!isPlanCmd(cmd))
                    return 'plan-guard: P 写仅允许 openspec/changes/ 目录（禁止改动源码）';
                // 含 plan 标记仍须验证实际写目标——重定向 >/>> 目标与 writeFileSync(/appendFileSync(
                // 首个字符串实参，逐条 resolve + isPlanPath（与 write/edit 入口同款判定，杀同款
                // openspec/changes/../.. 穿越写源码，补齐 bash/run_code 入口）。任一条目标不通过 → 拒绝。
                // 重定向形态按入口分流：bash 无空格（>f 合法写），run_code 带空格（无空格 > 是运算符）。
                const targets = extractWriteTargets(cmd, name === 'run_code' ? CODE_REDIRECT_TARGET_RE : BASH_REDIRECT_TARGET_RE);
                if (targets.length === 0) {
                    // 快速防线：命令同时含 openspec/changes 与 .. 但目标解析不出（无法提取）→ fail-closed 拒绝
                    if (cmd.includes('..'))
                        return 'plan-guard: P 写仅允许 openspec/changes/ 目录（禁止改动源码）';
                    return undefined; // 无重定向/写 API 目标（如 touch openspec/changes/x）→ 放行（保留 allow 标记语义）
                }
                for (const t of targets) {
                    if (!isPlanPath(t))
                        return 'plan-guard: P 写仅允许 openspec/changes/ 目录（禁止改动源码）';
                }
            }
        }
        return undefined;
    };
}
/** 工具注册表解析：直取 ctx.tools（官方语义），失败回退 ctx.get('tools')（cordis 服务路径，
 *  与 v-orchestrator setup 取 agentPresets 同款）。宿主/ cordis 版本混装（web profile 实证
 *  0.1.1-rc.2 包 + 4.0.1/4.0.2 peer 并存）下直取路径可能静默 undefined（旧语义），回退路径
 *  保证角色工具面仍能注册。两者皆空时必须告警——静默跳过=角色裸奔且无痕。 */
function resolveToolRegistry(agentCtx) {
    const direct = agentCtx.tools;
    if (direct && typeof direct.register === 'function')
        return direct;
    const fallback = agentCtx.get?.('tools');
    if (fallback && typeof fallback.register === 'function') {
        console.error('[dsh-swarm][debug] tool registry via ctx.get fallback (direct .tools missing)');
        return fallback;
    }
    return undefined;
}
function safeKeys(ctx) {
    try {
        return Object.keys(ctx).slice(0, 12).join(',');
    }
    catch {
        return '<unkeyed>';
    }
}
/** 按角色在 agent scope 注册工具面（统一注册策略）：
 *  所有 kanban 工具从工具工厂选取 + getCaller 闭包（actor=role、boundTaskId=taskId）。
 *  can() 权限兜底仍保留在工具 execute 内（纵深防御第二道）。 */
export async function installRoleTools(agentCtx, role, deps) {
    const kbMode = deps.kbMode ?? 'remote';
    console.error('[dsh-swarm][debug] installRoleTools role=' + role + ' task=' + deps.taskId);
    const caller = () => ({ actor: role, boundTaskId: deps.taskId });
    const allKanban = buildKanbanTools(deps.kanban, caller);
    // 每角色可用的 kanban 工具名（V 额外编排、P/W/D 任务工具）
    // 设计表另有 V 专属 kanban_link/chain_show，src/tools/kanban-tools.ts 未实现这两项，
    // 故保持不注册（不为实现而实现多余工具），与设计表的差异以此注释声明。
    const namesFor = {
        v: ['kanban_create', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment', 'kanban_show', 'kanban_chain', 'kanban_list'],
        p: ['kanban_show', 'kanban_chain', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
        w: ['kanban_show', 'kanban_chain', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
        d: ['kanban_show', 'kanban_chain', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
        // 评审角色（正式装配工具面）：PT/DT 任务工具 + 只读（spec 视图等）
        pt: ['kanban_show', 'kanban_chain', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
        dt: ['kanban_show', 'kanban_chain', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
    };
    const want = new Set(namesFor[role]);
    const registry = resolveToolRegistry(agentCtx);
    if (!registry) {
        console.error('[dsh-swarm][error] tool registry unavailable — role tools NOT registered (silent capability loss risk) role=' + role + ' task=' + (deps.taskId ?? '-') + ' ctxKeys=' + safeKeys(agentCtx));
        return; // 保持返回不抛：本轮先取证，全角色 fail-fast 另行决策
    }
    for (const tool of allKanban) {
        const name = tool.name;
        if (name && want.has(name))
            registry.register(tool);
    }
    if (role === 'w') {
        if (kbMode === 'remote') {
            for (const tool of buildWikiTools(deps.wiki, caller))
                registry.register(tool);
        }
        // local：wiki 三原语不注册，W 经 skill 工具（preset 提供）自治查写；prefetch/spec 视图保留
        // 设计表：W 对规格卡只读（spec_card_view）
        for (const tool of buildSpecCardTools(deps.kanban, caller)) {
            if (tool.name === 'spec_card_view')
                registry.register(tool);
        }
        const worker = new WikiWorker(deps.kanban, deps.wiki, { pagePrefix: 'projects/', kbMode: deps.kbMode });
        const getTask = async (taskId) => {
            const state = await deps.kanban.snapshot();
            const t = state.tasks.get(taskId);
            if (!t)
                throw new Error('unknown task: ' + taskId);
            return t;
        };
        for (const tool of buildPrefetchTools(worker, getTask, caller))
            registry.register(tool);
    }
    else if (role === 'd') {
        // D：只读 KB——注册 wiki_read + wiki_search（均走 can('wiki-read')=w/d 只读兜底）；规格卡只读
        if (kbMode === 'remote') {
            for (const tool of buildWikiTools(deps.wiki, caller)) {
                const name = tool.name;
                if (name === 'wiki_read' || name === 'wiki_search')
                    registry.register(tool);
            }
        }
        for (const tool of buildSpecCardTools(deps.kanban, caller)) {
            if (tool.name === 'spec_card_view')
                registry.register(tool);
        }
    }
    else if (role === 'p') {
        // P：spec_card_view（只读）+ openspec 写工具由 base 提供
        for (const tool of buildSpecCardTools(deps.kanban, caller)) {
            if (tool.name === 'spec_card_view')
                registry.register(tool);
        }
    }
    else if (role === 'pt') {
        // PT：只读评审——spec_card_view + 任务工具（无 create/wiki/执行）；写护栏在 agent-runner 装配
        for (const tool of buildSpecCardTools(deps.kanban, caller)) {
            if (tool.name === 'spec_card_view')
                registry.register(tool);
        }
    }
    else if (role === 'dt') {
        // DT：只读评审——spec_card_view + wiki 只读（评审区写由 ToolGuard 收窄）
        for (const tool of buildSpecCardTools(deps.kanban, caller)) {
            if (tool.name === 'spec_card_view')
                registry.register(tool);
        }
        if (kbMode === 'remote') {
            for (const tool of buildWikiTools(deps.wiki, caller)) {
                const n = tool.name;
                if (n === 'wiki_read' || n === 'wiki_search' || n === 'wiki_write')
                    registry.register(tool);
            }
        }
        // ocr_review：ocr CLI 三子命令（preview/rule/managed）；未安装/托管未配置在 execute 内降级引导，注册无条件
        registry.register(buildOcrReviewTool({ cwd: () => process.cwd() }));
    }
    else if (role === 'v') {
        for (const tool of buildSpecCardTools(deps.kanban, caller)) {
            if (tool.name === 'spec_card_view')
                registry.register(tool);
        }
    }
}
// ── 0.1.0 delegation：全局子代理写护栏────────────────────────────
// 框架事实：agent.ctx guard 不被子代理继承；toolFilter 对 preset
// scoped 工具零作用。故 DT 子代理只读防线只能在插件全局 ctx 注册 guard（全局
// 生效），按发起 agent 会话 header 的 agentPreset 精准判定（childSessionMeta 在子代理
// join 父组合时记录 preset id）：仅 kanban-dt 系收紧，其余（kanban-d 系、主会话
// 及其子代理）一律放行。
/** DT 任务运行期 taskId → chainId 同步缓存（guard 内 wiki review namespace 校验的
 *  解析源；AgentRunner 在 DT 任务 runTask 生命周期内维护，与 permissionBlockedTasks
 *  同为 module-level 进程内记忆）。 */
const dtTaskChainIds = new Map();
export function registerDtTaskChain(taskId, chainId) {
    dtTaskChainIds.set(taskId, chainId);
}
export function unregisterDtTaskChain(taskId) {
    dtTaskChainIds.delete(taskId);
}
/** 从 execution.agent 提取 session header（真实形态 agent.session.header，dsh-agent
 *  Session.header；取不到返回 undefined → 放行，DT 父会话 agent.ctx guard 兜底）。 */
function extractSessionHeader(agent) {
    const a = agent;
    const h = a?.session?.header;
    return h && typeof h === 'object' ? h : undefined;
}
/** 全局子代理写护栏：仅 DT 角色会话的"子代理"（agentPreset === 'kanban-dt' 且
 *  header.parentSession 为 kbn-<taskId> 前缀）应用 buildDTWriteGuard。判据：parentSession
 *  缺失或非 kbn- 前缀 → 放行（DT 父会话自身或无关会话；DT 父会话只读由 agent.ctx guard
 *  兜底，双保险）。repoRoot 取子代理 header.cwd（继承 DT 会话 cwd=评审目标仓库）；缺省
 *  '/'（写标记全拦的保守形态）。chainId 从 parentSession（kbn-<taskId>）解析；解析不到
 *  → 空（wiki_write fail-closed 全拒，源码写拦截不受影响）。 */
export function buildSubagentTreeGuard(deps = {}) {
    return (execution) => {
        const header = extractSessionHeader(execution?.agent);
        if (!header || header.agentPreset !== 'kanban-dt')
            return undefined;
        // 仅真实子代理（parentSession 为 kbn- 前缀）受全局护栏约束；DT 父会话自身
        // parentSession 是主会话或缺失（非 kbn- 前缀），chainId 解析不到 → 空，若误拦
        // 会把 DT 评审写入（wiki_write projects/<repoSlug>/<chain>/review/...）拒掉 → 直接放行。
        const parent = header.parentSession;
        if (typeof parent !== 'string' || !parent.startsWith('kbn-'))
            return undefined;
        const repoRoot = header.cwd || '/';
        let chainId = '';
        const taskId = parent.slice('kbn-'.length);
        chainId = deps.getTaskChainId?.(taskId) ?? dtTaskChainIds.get(taskId) ?? '';
        return buildDTWriteGuard(repoRoot, chainId)(execution);
    };
}
/** 蜂群模式主会话硬闸：全局 guard，按 header.agentPreset==='swarm'
 *  精准判定（先例 buildSubagentTreeGuard）。swarm 会话 = 扩权参数教学拦截（宿主 bash/write/edit
 *  schema 广播 sandbox_permissions/justification，模型带参重试会触发天花板会话 approveEscalation
 *  死循环——独立 DT 同款拦截）+ git 反选（与独立 DT 共用 GIT_MUTATION_VERBS/dualVerbGitDenyReason，
 *  buildPlanWriteGuard 同款分段提取判定，跳过 git 全局选项、提取不到动词 fail-closed，先行判定——
 *  git 变更动词多数同时命中只读基座的写标记，须以 swarm-guard 文案优先返回）+ 只读基座
 *  （buildReadOnlyWriteGuard：直接写工具全名拦截 + bash/run_code 写标记）。其余会话恒放行
 *  （角色会话自有 agent scope 护栏兜底，双保险不叠加）。 */
export function buildSwarmSessionGuard() {
    return (execution) => {
        const header = extractSessionHeader(execution?.agent);
        if (!header || header.agentPreset !== 'swarm')
            return undefined;
        const name = String(execution?.name ?? '');
        const args = execution?.arguments ?? {};
        if (name === 'bash' || name === 'run_code' || name === 'write' || name === 'edit') {
            // 扩权参数教学拦截：swarm 直聊会话是 danger-full-access 天花板（无更宽可升），
            // 模型带参会被宿主 approveEscalation 拒（2026-09-02 P 会话 30 连败同根；swarm 会话
            // 宿主直建、无 agent-runner setup 钩子装不了剥参 shadow，guard 拦截是唯一硬面）。
            if (args && typeof args === 'object' && ESCALATION_PARAM_KEYS.some((k) => args[k] !== undefined)) {
                return 'swarm-guard: 本会话为只读蜂群会话——不要传 sandbox_permissions/justification 扩权参数（天花板会话无可升级权限，带参必被宿主拒绝）；去掉该参数后重试';
            }
            if (name === 'bash' || name === 'run_code') {
                const cmd = String(args && typeof args === 'object' ? (args['command'] ?? args['code'] ?? '') : '');
                if (cmd) {
                    const segments = cmd.split(/\s*(?:&&|\|\||;|\||\n)\s*/);
                    for (const seg of segments) {
                        if (!/\bgit\b/.test(seg))
                            continue;
                        const m = seg.match(GIT_VERB_RE);
                        const verb = m?.[1];
                        // 反选：仅禁变更动词与双态动词的变更子形态；提取不到动词 fail-closed 拒
                        if (!verb || GIT_MUTATION_VERBS.has(verb))
                            return SWARM_GIT_DENY;
                        const sub = dualVerbGitDenyReason(verb, seg.slice((m.index ?? 0) + m[0].length), SWARM_GIT_DENY);
                        if (sub)
                            return sub;
                    }
                }
            }
        }
        const baseReason = buildReadOnlyWriteGuard(header.cwd || '/')(execution);
        if (baseReason)
            return baseReason;
        return undefined;
    };
}
// ── 独立评审（standalone DT）：全局 guard + 评审工具全局注册 ───────────────
// 独立评审 = 用户在 dsh web 以「交付评审官 (DT)」preset 直接对话：无绑定任务、不经
// agent-runner 角色组合（无角色工具面、无 agent-scope guard）。本节在插件全局 ctx
// 注册 buildStandaloneDtGuard（仅对独立 DT 会话收紧）与 registerStandaloneReviewerTools
// （ocr_review + wiki 三原语）；链上组合 DT 会话不受影响（自有 agent-scope guard 兜底）。
/** 只读评审类会话（独立 DT / 蜂群主会话共用）禁用的 git 变更动词（反选：只枚举变更面，其余动词放行）。
 *  决策（2026-09-08）：查询/clone/fetch/裸 checkout·switch 放开，仅禁改动代码与分支状态的
 *  git 操作；双态动词（checkout/switch/branch/tag/stash/remote/worktree/config/reflog/notes）
 *  的变更子形态由 dualVerbGitDenyReason 单独判定，此处只列整词禁用项。 */
const GIT_MUTATION_VERBS = new Set([
    'push', 'merge', 'rebase', 'revert', 'cherry-pick', 'filter-branch', 'filter-repo', 'replace',
    'reset', 'restore', 'clean', 'commit', 'add', 'am', 'apply', 'mv', 'rm',
    'gc', 'prune', 'repack', 'bisect',
]);
/** 独立评审 git 变更拒绝文案（错误文案即模型的 prompt：写明放开面，教模型改用合法形态）。 */
const STANDALONE_GIT_DENY = 'standalone-dt: 独立评审禁止 git 变更操作（push/merge/rebase/reset/commit 等）；查询、clone/fetch 与 checkout/switch 裸切换放行';
/** 蜂群会话 git 变更拒绝文案（同款反选语义；文案点名 swarm-guard 便于测试与日志归因）。 */
const SWARM_GIT_DENY = 'swarm-guard: 蜂群会话禁止 git 变更操作（push/merge/rebase/reset/commit 等，执行由工作流 D 角色完成）；查询与 clone/fetch 放行';
/** git 动词提取：跳过全局选项（与 swarm-guard 同款）；提取不到动词 fail-closed 拒。 */
const GIT_VERB_RE = /\bgit(?:\s+(?:--no-pager|-p|-v|--bare|--literal-pathspecs|--no-replace-objects|-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+|--namespace=\S+))*\s+([a-zA-Z][\w-]*)/;
/** 双态 git 动词的变更子形态判定（rest = 动词之后的命令原文，deny = 命中时的拒绝文案）。
 *  只认旗标语义不做路径解析；`checkout <path>` 与裸切分支同形（无 `--` 分隔）按放行处理
 *  （评审常在临时 clone 中进行，残留风险可接受）。undefined = 放行。 */
function dualVerbGitDenyReason(verb, rest, deny) {
    switch (verb) {
        case 'checkout': // 建分支（-b/-B/--orphan）与 `-- <path>` 丢弃工作区改动拒；裸切换放行
            if (/^\s+(?:-\S+\s+)*(?:-b|-B|--orphan)\b/.test(rest))
                return deny;
            if (/^\s+--(?:\s|$)/.test(rest))
                return deny;
            return undefined;
        case 'switch': // 建/替换分支拒；裸切换放行
            return /^\s+(?:-\S+\s+)*(?:-c|-C|--create|--orphan)\b/.test(rest) ? deny : undefined;
        case 'branch': { // 仅裸/任意非管理旗标放行；建删改（管理旗标 -m/-M/-c/-C/-d/-D 或位置参数命名）拒
            const flagsOnly = /^(?:\s+-\S+)*\s*$/.test(rest);
            const mgmt = /\s-(?:m|M|c|C|d|D)\b/.test(rest);
            return !mgmt && flagsOnly ? undefined : deny;
        }
        case 'tag': // 仅裸/-l/-n 列表放行
            return /^\s*$|^\s+(?:-l\b|-n\b)/.test(rest) ? undefined : deny;
        case 'stash': // 仅 list/show/find 放行（裸 = 打印帮助）
            return /^\s*$|^\s+(?:list|show|find)\b/.test(rest) ? undefined : deny;
        case 'remote': // 仅裸/-v/--verbose/get-url 放行
            return /^\s*$|^\s+(?:-v\b|--verbose\b)|^\s+get-url\b/.test(rest) ? undefined : deny;
        case 'worktree': // 仅裸/list 放行
            return /^\s*$|^\s+list\b/.test(rest) ? undefined : deny;
        case 'config': // 仅读旗标放行；单/双位置参数写入（含 --global）与 --unset 一律拒
            return /^\s*$|^\s+(?:--get\b|--get-all\b|--get-regexp\b|--list\b|-l\b)/.test(rest) ? undefined : deny;
        case 'reflog': // 仅 delete/expire 拒，其余（裸/show）放行
            return /^\s+(?:delete|expire)\b/.test(rest) ? deny : undefined;
        case 'notes': // 仅裸/list/show 放行
            return /^\s*$|^\s+(?:list|show)\b/.test(rest) ? undefined : deny;
        default:
            return undefined;
    }
}
/** 独立评审（standalone DT）全局硬闸。独立会话判定（同时成立）：
 *  header.agentPreset === 'kanban-dt'、未经角色组合标记（!isRoleComposed）、parentSession
 *  非 kbn- 前缀（与 buildSubagentTreeGuard 判据对齐：有 kbn- parentSession 的是链上系
 *  DT 子代理，交由该 guard 管——其 incarnation 可能无组合标记、宿主 id 也可能非 kbn-
 *  前缀，漏判会把链评审写入误当独立模式拒掉）、且（能从 execution.agent 取到 session
 *  id 时）id 非 kbn- 前缀。不满足 → 不走独立规则。
 *  独立模式规则（按序）：
 *  1. kanban 写工具（complete/block/comment/heartbeat/create）→ 拒（独立评审不挂任务链）；
 *  2. bash/run_code/write/edit → 扩权参数教学拦截（sandbox_permissions/justification 任一
 *     出现即拒并教模型去参——只读会话无扩权场景，宿主沙箱校验报错文案晦涩）；bash/run_code
 *     再过 git 反选（swarm-guard 同款分段提取：&&/||/;/|/换行 分段、跳过全局选项、提取不到
 *     动词 fail-closed 拒）：仅禁变更动词与双态动词的变更子形态（见 GIT_STANDALONE_DENY_VERBS
 *     /standaloneGitDenyReason），查询、clone/fetch、裸 checkout/switch 放行；非 git 段不因
 *     git 规则拒绝；最后挂只读基座 buildReadOnlyWriteGuard（写动词/重定向照拒；clone/fetch
 *     落盘是 git 自身行为，BASH_WRITE_RE 无此二动词天然放行，无需特判）；
 *  3. wiki_write（独立模式）→ 仅放行 projects/<repo>/reviews/<主题>-<日期>/ 命名空间；
 *  4. wiki_write（非独立会话）→ 链上组合会话（isRoleComposed）放行（自有 agent-scope
 *     guard 管，链命名空间写入绝不被本 guard 误拦）；其余（main/swarm/未知 GUI）拒绝
 *     ——评审工具全局注册后 wiki_write 收紧到评审会话；
 *  5. 其余工具（read/glob/grep/ocr_review/wiki_read/wiki_search 等）→ 放行。 */
export function buildStandaloneDtGuard() {
    return (execution) => {
        const header = extractSessionHeader(execution?.agent);
        const name = String(execution?.name ?? '');
        const agent = execution?.agent;
        const sessionId = typeof agent?.id === 'string' ? agent.id : undefined;
        // 链上系 DT 子代理（parentSession 为 kbn-<taskId> 前缀）：交由 buildSubagentTreeGuard 管，
        // 本 guard 不按独立模式收紧、也不在非独立分支拒其 wiki_write（链评审目录写入归该 guard 校验）。
        const isDtChainSubagent = !!header
            && header.agentPreset === 'kanban-dt'
            && typeof header.parentSession === 'string'
            && header.parentSession.startsWith('kbn-');
        const standalone = !!header
            && header.agentPreset === 'kanban-dt'
            && !isRoleComposed(execution?.agent)
            && !isDtChainSubagent
            && !(sessionId !== undefined && sessionId.startsWith('kbn-'));
        if (standalone) {
            if (name === 'kanban_complete' || name === 'kanban_block' || name === 'kanban_comment' || name === 'kanban_heartbeat' || name === 'kanban_create') {
                return 'standalone-dt: 独立评审模式不使用看板工具';
            }
            if (name === 'bash' || name === 'run_code' || name === 'write' || name === 'edit') {
                const args = execution?.arguments ?? {};
                // 扩权参数教学拦截：独立评审只读无扩权场景，宿主 bash/write/edit schema 仍广播
                // sandbox_permissions/justification（组合层行为，会话层改不掉），模型重试惯性带参
                // 会触发宿主沙箱校验错误（invalid justification）——在此拦下并教模型去参重试。
                if (args && typeof args === 'object' && ESCALATION_PARAM_KEYS.some((k) => args[k] !== undefined)) {
                    return 'standalone-dt: 独立评审为只读会话——不要传 sandbox_permissions/justification 扩权参数（会触发宿主沙箱校验错误）；去掉该参数后重试';
                }
                if (name === 'bash' || name === 'run_code') {
                    const cmd = String(args['command'] ?? args['code'] ?? '');
                    if (cmd) {
                        const segments = cmd.split(/\s*(?:&&|\|\||;|\||\n)\s*/);
                        for (const seg of segments) {
                            if (!/\bgit\b/.test(seg))
                                continue;
                            const m = seg.match(GIT_VERB_RE);
                            const verb = m?.[1];
                            // 反选：仅禁变更动词与双态动词的变更子形态；提取不到动词 fail-closed 拒
                            if (!verb || GIT_MUTATION_VERBS.has(verb))
                                return STANDALONE_GIT_DENY;
                            const sub = dualVerbGitDenyReason(verb, seg.slice((m.index ?? 0) + m[0].length), STANDALONE_GIT_DENY);
                            if (sub)
                                return sub;
                        }
                    }
                    const baseReason = buildReadOnlyWriteGuard(header.cwd || '/')(execution);
                    if (baseReason)
                        return baseReason;
                }
                return undefined;
            }
            if (name === 'wiki_write') {
                const args = execution?.arguments ?? {};
                const pagePath = String(args && typeof args === 'object' ? args['pagePath'] ?? '' : '');
                if (!isStandaloneReviewNamespacePath(pagePath))
                    return 'wiki-write-outside-reviews-namespace: 独立评审仅可写 projects/<repo>/reviews/<主题>-<日期>/';
                return undefined;
            }
            return undefined;
        }
        if (name === 'wiki_write') {
            if (isRoleComposed(execution?.agent) || isDtChainSubagent)
                return undefined;
            return 'wiki-write-restricted-to-reviewer-sessions: wiki_write 仅限交付评审官（DT）评审会话使用';
        }
        return undefined;
    };
}
/** 独立评审工具全局注册：ocr_review + wiki 三原语（wiki_read/wiki_search/wiki_write）。
 *  独立评审不经 agent-runner 角色组合，角色工具面不存在，故在插件全局 ctx 注册；
 *  caller 固定 actor='dt'（can('wiki-write','dt')=true），wiki_write 的会话级收紧由
 *  buildStandaloneDtGuard 完成（链上组合会话放行，main/swarm/未知 GUI 拒绝）。
 *  wiki 客户端按 kbMode 构造（与 registerMainSessionTools 同源：remote 优先 ctx.get('wiki')
 *  注入（测试 mock），生产热读取 getEffective().wikiVault；local 走 LocalWikiClient）。
 *  local 模式不注册 wiki_write：LocalWikiClient.abs 只接受 wiki/** 形态，而 wiki_write
 *  工具边界只放行 projects/... 命名空间——双锁死（任何路径都写不进）。与链上 DT local
 *  行为一致（走 skill/fs 工具而非 wiki 原语）；wiki_read/wiki_search 不受写路径白名单
 *  约束，照常注册。
 *  registry 缺失（测试裸 Context）→ return，与 registerMainSessionTools 同款防御。 */
export function registerStandaloneReviewerTools(ctx, configProvider) {
    const registry = ctx.get('tools');
    if (!registry)
        return; // 测试裸 Context 无 tools 服务，跳过注册
    registry.register(buildOcrReviewTool({ cwd: () => process.cwd() }));
    const kbMode = configProvider.mode;
    const wiki = (kbMode === 'local'
        ? new LocalWikiClient(ensureLocalKbRoot())
        : (ctx.get('wiki') ?? new WikiVaultClient(() => configProvider.getEffective().wikiVault)));
    const caller = () => ({ actor: 'dt' });
    for (const tool of buildWikiTools(wiki, caller)) {
        if (kbMode === 'local' && tool.name === 'wiki_write')
            continue;
        registry.register(tool);
    }
}
