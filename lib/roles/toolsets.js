import { resolve } from 'node:path';
import { KanbanService } from '../domain/kanban-service.js';
import { buildKanbanTools } from '../tools/kanban-tools.js';
import { buildSpecCardTools } from '../tools/spec-card-tools.js';
import { buildWikiTools } from '../tools/wiki-tools.js';
import { buildPrefetchTools } from '../tools/prefetch-tools.js';
import { WikiWorker } from './wiki-worker.js';
/** 直接写工具（无条件视为写能力；只读工具如 read/glob/grep 不算）。 */
const DIRECT_WRITE_TOOLS = new Set(['write', 'edit', 'rm', 'mv', 'cp', 'mkdir', 'mkfile']);
/** bash/run_code 命令中的写操作标记（写证据启发式；ls/cat/grep/git show 等只读不算）。
 *  与 chain-auditor 同源；重定向标记用 \s>>?（要求 > 前有空白），避免 2>/dev/null 只读重定向误判。 */
const BASH_WRITE_RE = /(?:\b(?:touch|mkdir|rm|rmdir|mv|cp|tee|truncate|install|ln|dd|chmod|chown|make|cmake)\b|\bgit\s+(?:-C\s+\S+\s+)*(?:add|commit|push|mv|rm|checkout\s+-b|switch\s+-c|worktree\s+add|merge|rebase|reset|clean|restore|tag|remote\s+add|apply)\b|\bpnpm\s+(?:add|install|remove|update|link)\b|\bnpm\s+(?:i|install|add|remove|uninstall|update)\b|\byarn\s+(?:add|remove)\b|\bbun\s+(?:add|install|remove)\b|\bsed\s+-i\b|\bperl\s+-i\b|\s>>?)/i;
/** run_code（JS/TS/Python 程序）中的写操作标记：文件写 API / 命令派发写工具。
 *  含 Python 写标记（F2，DT run_code 盲区闭环）：open() 写模式精确版（'w'/'a'/'w+'/'a+' 及
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
/** 剥去 shell 重定向目标 token 外壳的一层引号（' " `）（F3：引号包裹的 plan 路径被 I1 误拒修复）。
 *  仅剥对称外壳一层；剥完仍走 resolve+isPlanPath，.. / 绝对路径逃逸不被削弱。 */
function stripShellQuotes(tok) {
    const q = tok[0];
    if (tok.length >= 2 && (q === "'" || q === '"' || q === '`') && tok[tok.length - 1] === q) {
        return tok.slice(1, -1);
    }
    return tok;
}
/** I1：从 bash/run_code 写意图命令提取实际写目标路径。
 *  返回重定向（>/>> 后首个非重定向 token，fd2 以 lookbehind 豁免）与 writeFileSync(/appendFileSync(
 *  首个字符串实参；提取不到返回空数组（调用方据此 fail-closed 或放行）。 */
function extractWriteTargets(cmd) {
    const out = [];
    const redirectRe = /(?:(?<!2)>>|(?<!2)(?<!>)>)\s*([^\s;&|<>]+)/g;
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
    return out;
}
/** 判定 wiki 路径是否位于 DT 评审命名空间 projects/<chain>/review/（拒绝 ../、绝对路径、非 review 前缀）。 */
export function isReviewNamespacePath(pagePath, chainId) {
    const p = String(pagePath ?? '');
    if (!p || p.startsWith('/') || p.includes('..'))
        return false;
    const prefix = `projects/${chainId}/review/`;
    return p.startsWith(prefix);
}
/**
 * 评审引擎决策（DT）：ocr（open-code-review Delegation 模式）优先；
 * 不可用 fallback superpowers code-review；两者都不可用 → review-tool-unavailable（阻塞）。
 * 纯函数便于单测；真实可用性探测在 agent-runner 装配（探活 ocr 二进制/失败）。
 */
export function resolveReviewEngine(available) {
    if (available.ocr)
        return 'ocr';
    if (available.codeReview)
        return 'code-review';
    return 'review-tool-unavailable';
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
                return 'wiki-write-outside-review-namespace: DT may only write projects/<chain>/review/';
        }
        return base(execution);
    };
}
export function buildReadOnlyWriteGuard(_repoRoot) {
    return (execution) => {
        const name = String(execution?.name ?? '');
        const args = execution?.arguments ?? {};
        // I2：全名拦截——只读会话（W/PT/DT）fs 写无条件拒绝，不再依赖 repoRoot 子串 / hitsRepo。
        // W 是 danger-full-access（无 workspace-write sandbox 兜底），可写 repo 外任意路径（~/x、/tmp/x、
        // 其他项目源码），故必须工具级全名拦截封死。非写工具（read/glob/grep/wiki_* 等）照常放行。
        if (DIRECT_WRITE_TOOLS.has(name))
            return 'write-to-repo-source-denied: read-only reviewer must not modify repo sources';
        if (name === 'bash' || name === 'run_code') {
            const cmd = String(args && typeof args === 'object' ? (args['command'] ?? args['code'] ?? '') : '');
            // bash 用 BASH_WRITE_RE（写动词 + git mutation + 带空格重定向）∪ GUARD_WRITE_INTENT_RE
            // （无空格重定向 + 解释器 -c/-e）——全名拦截，写标记即拒，无论目标是否在 repo 内。
            // run_code 用 JS/Python 文件写 API 标记（CODE_WRITE_RE）。
            const writeRe = name === 'run_code' ? CODE_WRITE_RE : BASH_WRITE_RE;
            if (cmd && (writeRe.test(cmd) || GUARD_WRITE_INTENT_RE.test(cmd)))
                return 'write-to-repo-source-denied: ' + name + ' with write marker';
        }
        return undefined;
    };
}
/** P 专用写护栏（Q3）：读全放行；git mutation 一律拒绝；写仅允许目标仓库 openspec/changes 目录。
 *  直接 fs 写工具 → 路径经 resolve 归一化后须落在 <workspaceRoot>/openspec/changes/ 之下（相邻段对判定）；
 *  bash/run_code 写标记命令 → 命令文本须含 `openspec/changes` 子串，且提取出的实际写目标（重定向
 *  目标 / writeFileSync 实参）逐条经 resolve+isPlanPath 校验（I1：杀 openspec/changes/../.. 穿越写源码）。
 *  源码/src/lib/tests 等写不入（不含该子串）——"禁止改动源码"为工具级硬约束，非 prompt 软约束。
 *  execution 以 dsh-tools 形态 { name, arguments } 传入（与 buildReadOnlyWriteGuard 一致）。 */
export function buildPlanWriteGuard(workspaceRoot) {
    const wsRoot = workspaceRoot.replace(/\/+$/, '');
    /** 目标路径须解析后落在 wsRoot 之下、且含相邻 openspec→changes 段对。
     *  resolve 折叠 ../ 与重复斜杠（杀 M1 .. 穿越）；wsRoot + '/' 边界前缀（杀 M2 /ws/main2 前缀逃逸）；
     *  相对路径（openspec/changes/x.md）经 resolve 归到 wsRoot 之下 → 允许（m2 回归）。 */
    const isPlanPath = (p) => {
        if (!p)
            return false;
        const resolved = resolve(wsRoot, p);
        // POSIX 上 \ 是合法文件名字符（如目录名 openspec\changes），反斜杠归一化仅 win32 需要，
        // 否则会把它折叠成相邻 openspec→changes 段对而被误放行（R2-F7）。
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
            const target = String(a['path'] ?? a['file_path'] ?? '');
            if (isPlanPath(target))
                return undefined;
            return 'plan-guard: P 写仅允许 openspec/changes/ 目录（禁止改动源码）';
        }
        if (name === 'bash' || name === 'run_code') {
            const cmd = String(a['command'] ?? a['code'] ?? '');
            if (!cmd)
                return undefined;
            // FIRST git 判定（仅命令文本，不扫写入内容——修 m1 内容误拒）：
            // 按 && / || / ; / | / 换行 分段，逐段提取首个 git 动词（先跳过 git 全局选项
            // --no-pager/-p/-v/--bare/--literal-pathspecs/--no-replace-objects/-C <path>/-c <kv>/
            // --git-dir=/--work-tree=/--namespace=）。任何一段含 git 却提取不到动词（如 git --version
            // 或裸 git）→ fail-closed 拒绝；动词非只读白名单 → 拒绝。修 R2 链式绕过与全局选项前缀 fall-through。
            const segments = cmd.split(/\s*(?:&&|\|\||;|\||\n)\s*/);
            for (const seg of segments) {
                if (!/\bgit\b/.test(seg))
                    continue;
                const verbMatch = seg.match(/\bgit(?:\s+(?:--no-pager|-p|-v|--bare|--literal-pathspecs|--no-replace-objects|-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+|--namespace=\S+))*\s+([a-zA-Z][\w-]*)/);
                const verb = verbMatch ? verbMatch[1] : undefined;
                if (!verb || !GIT_READ_VERBS.has(verb))
                    return 'plan-guard: P 禁止 git 操作';
            }
            // THEN 写意图：增强写标记（含无空格重定向与解释器 -c/-e 单行）且不含 plan 路径 → 拒绝。
            // run_code 额外用文件写 API 标记（CODE_WRITE_RE，fs.writeFileSync 等）；保留 GUARD 动词/解释器
            // 覆盖（touch/mkdir/rm/… 与 python -c 内联单行）不回归。
            const isWrite = name === 'run_code'
                ? CODE_WRITE_RE.test(cmd) || GUARD_WRITE_INTENT_RE.test(cmd)
                : GUARD_WRITE_INTENT_RE.test(cmd);
            if (isWrite) {
                if (!isPlanCmd(cmd))
                    return 'plan-guard: P 写仅允许 openspec/changes/ 目录（禁止改动源码）';
                // I1：含 plan 标记仍须验证实际写目标——重定向 >/>> 目标与 writeFileSync(/appendFileSync(
                // 首个字符串实参，逐条 resolve + isPlanPath（与 write/edit 入口同款判定，杀 M1 同款
                // openspec/changes/../.. 穿越写源码，补齐 bash/run_code 入口）。任一条目标不通过 → 拒绝。
                const targets = extractWriteTargets(cmd);
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
/** 按角色在 agent scope 注册工具面（P1-3 统一注册策略）：
 *  所有 kanban 工具从 T9 工厂选取 + getCaller 闭包（actor=role、boundTaskId=taskId）。
 *  can() 权限兜底仍保留在工具 execute 内（纵深防御第二道）。 */
export async function installRoleTools(agentCtx, role, deps) {
    console.error('[dsh-swarm][debug] installRoleTools role=' + role + ' task=' + deps.taskId);
    const caller = () => ({ actor: role, boundTaskId: deps.taskId });
    const allKanban = buildKanbanTools(deps.kanban, caller);
    // 每角色可用的 kanban 工具名（V 额外编排、P/W/D 任务工具）
    // 设计表（§3）另有 V 专属 kanban_link/chain_show，src/tools/kanban-tools.ts 未实现这两项，
    // 故保持不注册（不为实现而实现多余工具），与设计表的差异以此注释声明。
    const namesFor = {
        v: ['kanban_create', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment', 'kanban_show', 'kanban_list'],
        p: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
        w: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
        d: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
        // 评审角色（Task 8/9 正式装配工具面）：PT/DT 任务工具 + 只读（spec 视图等）
        pt: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
        dt: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
    };
    const want = new Set(namesFor[role]);
    const registry = agentCtx.tools;
    if (!registry)
        return; // 无工具服务（测试桩）跳过
    for (const tool of allKanban) {
        const name = tool.name;
        if (name && want.has(name))
            registry.register(tool);
    }
    if (role === 'w') {
        for (const tool of buildWikiTools(deps.wiki, caller))
            registry.register(tool);
        // 设计表 §3：W 对规格卡只读（spec_card_view）
        for (const tool of buildSpecCardTools(deps.kanban, caller)) {
            if (tool.name === 'spec_card_view')
                registry.register(tool);
        }
        const worker = new WikiWorker(deps.kanban, deps.wiki, { pagePrefix: 'projects/' });
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
        for (const tool of buildWikiTools(deps.wiki, caller)) {
            const name = tool.name;
            if (name === 'wiki_read' || name === 'wiki_search')
                registry.register(tool);
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
        // DT：只读评审——spec_card_view + wiki 只读（评审区写由 ToolGuard 收窄）；Task 9 完整实现
        for (const tool of buildSpecCardTools(deps.kanban, caller)) {
            if (tool.name === 'spec_card_view')
                registry.register(tool);
        }
        for (const tool of buildWikiTools(deps.wiki, caller)) {
            const n = tool.name;
            if (n === 'wiki_read' || n === 'wiki_search' || n === 'wiki_write')
                registry.register(tool);
        }
    }
    else if (role === 'v') {
        for (const tool of buildSpecCardTools(deps.kanban, caller)) {
            if (tool.name === 'spec_card_view')
                registry.register(tool);
        }
    }
}
// ── 0.1.0 delegation：全局子代理写护栏（spec FR2）────────────────────────────
// 框架事实（spec §3）：agent.ctx guard 不被子代理继承（F1）；toolFilter 对 preset
// scoped 工具零作用（F2）。故 DT 子代理只读防线只能在插件全局 ctx 注册 guard（全局
// 生效），按发起 agent 会话 header 的 agentPreset 精准判定（childSessionMeta 在子代理
// join 父组合时记录 preset id，F4）：仅 kanban-dt 系收紧，其余（kanban-d 系、主会话
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
        // 会把 DT 评审写入（wiki_write projects/<chain>/review/...）拒掉 → 直接放行。
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
