import { resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { KanbanService } from '../domain/kanban-service.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import type { Role } from '../domain/types.js';
import { isInsideKbRoot } from '../wiki/local-kb.js';
import { buildKanbanTools, type ToolCaller } from '../tools/kanban-tools.js';
import { buildSpecCardTools } from '../tools/spec-card-tools.js';
import { buildWikiTools } from '../tools/wiki-tools.js';
import { buildPrefetchTools } from '../tools/prefetch-tools.js';
import { buildOcrReviewTool } from '../tools/ocr-review-tools.js';
import { WikiWorker } from './wiki-worker.js';

/** 直接写工具（无条件视为写能力；只读工具如 read/glob/grep 不算）。 */
const DIRECT_WRITE_TOOLS = new Set(['write', 'edit', 'rm', 'mv', 'cp', 'mkdir', 'mkfile']);

/** bash/run_code 命令中的写操作标记（写证据启发式；ls/cat/grep/git show 等只读不算）。
 *  与 chain-auditor 同源；重定向标记用 \s>>?（要求 > 前有空白），避免 2>/dev/null 只读重定向误判。 */
const BASH_WRITE_RE = /(?:\b(?:touch|mkdir|rm|rmdir|mv|cp|tee|truncate|install|ln|dd|chmod|chown|make|cmake)\b|\bgit\s+(?:-C\s+\S+\s+)*(?:add|commit|push|mv|rm|checkout\s+-b|switch\s+-c|worktree\s+add|merge|rebase|reset|clean|restore|tag|remote\s+add|apply)\b|\bpnpm\s+(?:add|install|remove|update|link)\b|\bnpm\s+(?:i|install|add|remove|uninstall|update)\b|\byarn\s+(?:add|remove)\b|\bbun\s+(?:add|install|remove)\b|\bsed\s+-i\b|\bperl\s+-i\b|\s>>?)/i;

/** run_code（JS/TS/Python 程序）中的写操作标记：文件写 API / 命令派发写工具。
 *  含 Python 写标记（DT run_code 盲区闭环）：open() 写模式精确版（'w'/'a'/'w+'/'a+' 及
 *  wb/ab 等变体，读模式 'r' 不命中）、os. 模块写、pathlib Path 写、shutil 复制/移动/删除。 */
const CODE_WRITE_RE = /(?:\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|unlinkSync|unlink|rmSync|rm|mkdirSync|mkdir|cpSync|renameSync)\b|\bwriteFile\(|\bfs\s*\.\s*(?:write|append|createWrite)|\bopen\(\s*['"][^'"\n]*['"]\s*,\s*(?:(?:mode|encoding|errors|buffering|newline|closefd|opener|text)\s*=\s*)?['"][wa][^'"\n]*['"]|\bos\s*\.\s*(?:remove|unlink|write|rmdir|makedirs|rename)\b|\.(?:write_text|write_bytes|unlink|mkdir|rename)\(|shutil\s*\.\s*(?:copy|move|rmtree))/i;

/** git 只读动词白名单：命中则 git 命令放行；其余 git 动词（含 checkout/branch/stash/merge/commit/push 等）一律拒绝。
 *  反选比枚举 mutation 更全：新增 mutation 动词无需维护。config/remote 兼具读写语义但仅改 .git 元数据不改源码，
 *  故不列入白名单（拒绝）；纯读子命令（status/log/show/diff/rev-parse/ls-files/ls-tree/grep/blame/describe/
 *  shortlog/help/version/count-objects/fsck）放行。 */
const GIT_READ_VERBS = new Set(['status','log','show','diff','rev-parse','ls-files','ls-tree','grep','blame','describe','shortlog','help','version','count-objects','fsck']);

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
function stripShellQuotes(tok: string): string {
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
function extractWriteTargets(cmd: string, redirectRe: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = redirectRe.exec(cmd)) !== null) {
    if (m[1]) out.push(stripShellQuotes(m[1]));
  }
  const apiRe = /\b(?:writeFileSync|appendFileSync)\s*\(\s*(['"`])(.*?)\1/g;
  while ((m = apiRe.exec(cmd)) !== null) {
    if (m[2]) out.push(m[2]);
  }
  // 双模式：动词目标提取——必须捕获动词后【全部】路径实参（只取首个会让
  // `mkdir -p <kb>/x /repo/y` 漏检第二个目标 → 护栏越权放行）。
  // cp/mv/rm 的源+目标全部入列：任一在库根外即整体拒绝（fail-closed，accepted-risk：
  // 库根内合法 cp/mv 改用 write 工具完成）。
  const verbRe = /\b(?:touch|mkdir|tee|cp|mv|rm|install)\b([^;&|<>]*)/g;
  while ((m = verbRe.exec(cmd)) !== null) {
    for (const tok of m[1].split(/\s+/)) {
      if (!tok || tok.startsWith('-')) continue;
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
export function isReviewNamespacePath(pagePath: string, chainId: string): boolean {
  const p = String(pagePath ?? '');
  if (!p || p.startsWith('/') || p.includes('..')) return false;
  const chain = chainId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^projects\\/[a-z0-9-]+\\/${chain}\\/review\\/`).test(p);
}

/**
 * DT 写护栏 = PT 只读护栏（源码/git/写标记 bash 拒绝）+ wiki_write 仅 review namespace 收窄。
 * repoRoot 为 D 目标仓库；chainId 用于 wiki 评审命名空间校验。
 */
export function buildDTWriteGuard(repoRoot: string, chainId: string): (execution: { name?: string; arguments?: unknown }) => string | undefined {
  const base = buildReadOnlyWriteGuard(repoRoot);
  return (execution) => {
    const name = String(execution?.name ?? '');
    if (name === 'wiki_write') {
      const args = execution?.arguments ?? {};
      const pagePath = String(args && typeof args === 'object' ? (args as Record<string, unknown>)['pagePath'] ?? '' : '');
      if (!isReviewNamespacePath(pagePath, chainId)) return 'wiki-write-outside-review-namespace: DT may only write projects/<repoSlug>/<chain>/review/';
    }
    return base(execution);
  };
}
export function buildReadOnlyWriteGuard(_repoRoot: string): (execution: { name?: string; arguments?: unknown }) => string | undefined {
  return (execution) => {
    const name = String(execution?.name ?? '');
    const args = execution?.arguments ?? {};
    // 全名拦截——只读会话（W/PT/DT）fs 写无条件拒绝，不再依赖 repoRoot 子串 / hitsRepo。
    // W 是 danger-full-access（无 workspace-write sandbox 兜底），可写 repo 外任意路径（~/x、/tmp/x、
    // 其他项目源码），故必须工具级全名拦截封死。非写工具（read/glob/grep/wiki_* 等）照常放行。
    if (DIRECT_WRITE_TOOLS.has(name)) return 'write-to-repo-source-denied: read-only reviewer must not modify repo sources';
    if (name === 'bash' || name === 'run_code') {
      const cmd = String(args && typeof args === 'object' ? ((args as Record<string, unknown>)['command'] ?? (args as Record<string, unknown>)['code'] ?? '') : '');
      // bash 用 BASH_WRITE_RE（写动词 + git mutation + 带空格重定向）∪ GUARD_WRITE_INTENT_RE
      // （无空格重定向 + 解释器 -c/-e）——全名拦截，写标记即拒，无论目标是否在 repo 内。
      // run_code 与 bash 分离（planguard-falsepositive 根治）：CODE_WRITE_RE（文件写 API）
      // ∪ CODE_SHELL_VERB_RE（内嵌 shell 裸动词，exec cp/mv 不再绕过）∪
      // CODE_REDIRECT_WRITE_RE（带空格重定向）——无空格 > 在 JS 里是运算符（=>、比较），
      // 不能复用 GUARD_WRITE_INTENT_RE（P 会话 15 次误报实证）。
      const isWrite = name === 'run_code'
        ? CODE_WRITE_RE.test(cmd) || CODE_SHELL_VERB_RE.test(cmd) || CODE_REDIRECT_WRITE_RE.test(cmd)
        : BASH_WRITE_RE.test(cmd) || GUARD_WRITE_INTENT_RE.test(cmd);
      if (cmd && isWrite) return 'write-to-repo-source-denied: ' + name + ' with write marker';
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
export function buildKbWriteGuard(kbRoot: string): (execution: { name?: string; arguments?: unknown }) => string | undefined {
  const base = buildReadOnlyWriteGuard(kbRoot);
  const isKbTarget = (t: string): boolean => isInsideKbRoot(kbRoot, t);
  return (execution) => {
    const baseReason = base(execution);
    if (!baseReason) return undefined;
    const name = String(execution?.name ?? '');
    const args = execution?.arguments ?? {};
    const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    if (DIRECT_WRITE_TOOLS.has(name)) {
      const target = String(a['path'] ?? a['file_path'] ?? '');
      if (target && isKbTarget(target)) return undefined;
      return baseReason;
    }
    if (name === 'bash' || name === 'run_code') {
      const cmd = String(a['command'] ?? a['code'] ?? '');
      if (!cmd) return baseReason;
      // 双参签名 + 按入口分流 redirect 正则（审查修订）；targets 为空 = 写意图但提取不到目标 → fail-closed 拒绝
      const targets = extractWriteTargets(cmd, name === 'bash' ? BASH_REDIRECT_TARGET_RE : CODE_REDIRECT_TARGET_RE);
      if (targets.length > 0 && targets.every(isKbTarget)) return undefined;
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
export function buildPlanWriteGuard(workspaceRoot: string): (execution: { name?: string; arguments?: unknown }) => string | undefined {
  const wsRoot = workspaceRoot.replace(/\/+$/, '');
  /** 目标路径须解析后落在 wsRoot 之下、且含相邻 openspec→changes 段对。
   *  resolve 折叠 ../ 与重复斜杠（杀 .. 穿越）；wsRoot + '/' 边界前缀（杀 /ws/main2 前缀逃逸）；
   *  相对路径（openspec/changes/x.md）经 resolve 归到 wsRoot 之下 → 允许。 */
  const isPlanPath = (p: string): boolean => {
    if (!p) return false;
    const resolved = resolve(wsRoot, p);
    // POSIX 上 \ 是合法文件名字符（如目录名 openspec\changes），反斜杠归一化仅 win32 需要，
    // 否则会把它折叠成相邻 openspec→changes 段对而被误放行。
    const norm = process.platform === 'win32' ? resolved.replace(/\\/g, '/') : resolved;
    if (!norm.startsWith(wsRoot + '/')) return false;
    const segs = norm.split('/');
    const i = segs.indexOf('openspec');
    return i >= 0 && segs[i + 1] === 'changes';
  };
  const isPlanCmd = (cmd: string) => cmd.includes('openspec/changes');
  return (execution) => {
    const name = String(execution?.name ?? '');
    const args = execution?.arguments ?? {};
    const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
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
      if (isPlanPath(target)) return undefined;
      return 'plan-guard: P 写仅允许 openspec/changes/ 目录（禁止改动源码）';
    }
    if (name === 'bash' || name === 'run_code') {
      const cmd = String(a['command'] ?? a['code'] ?? '');
      if (!cmd) return undefined;
      // FIRST git 判定（仅命令文本，不扫写入内容——修复内容误拒）：
      // 按 && / || / ; / | / 换行 分段，逐段提取首个 git 动词（先跳过 git 全局选项
      // --no-pager/-p/-v/--bare/--literal-pathspecs/--no-replace-objects/-C <path>/-c <kv>/
      // --git-dir=/--work-tree=/--namespace=）。任何一段含 git 却提取不到动词（如 git --version
      // 或裸 git）→ fail-closed 拒绝；动词非只读白名单 → 拒绝。修复链式绕过与全局选项前缀 fall-through。
      const segments = cmd.split(/\s*(?:&&|\|\||;|\||\n)\s*/);
      for (const seg of segments) {
        if (!/\bgit\b/.test(seg)) continue;
        const verbMatch = seg.match(/\bgit(?:\s+(?:--no-pager|-p|-v|--bare|--literal-pathspecs|--no-replace-objects|-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+|--namespace=\S+))*\s+([a-zA-Z][\w-]*)/);
        const verb = verbMatch ? verbMatch[1] : undefined;
        if (!verb || !GIT_READ_VERBS.has(verb)) return 'plan-guard: P 禁止 git 操作';
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
        if (!isPlanCmd(cmd)) return 'plan-guard: P 写仅允许 openspec/changes/ 目录（禁止改动源码）';
        // 含 plan 标记仍须验证实际写目标——重定向 >/>> 目标与 writeFileSync(/appendFileSync(
        // 首个字符串实参，逐条 resolve + isPlanPath（与 write/edit 入口同款判定，杀同款
        // openspec/changes/../.. 穿越写源码，补齐 bash/run_code 入口）。任一条目标不通过 → 拒绝。
        // 重定向形态按入口分流：bash 无空格（>f 合法写），run_code 带空格（无空格 > 是运算符）。
        const targets = extractWriteTargets(cmd, name === 'run_code' ? CODE_REDIRECT_TARGET_RE : BASH_REDIRECT_TARGET_RE);
        if (targets.length === 0) {
          // 快速防线：命令同时含 openspec/changes 与 .. 但目标解析不出（无法提取）→ fail-closed 拒绝
          if (cmd.includes('..')) return 'plan-guard: P 写仅允许 openspec/changes/ 目录（禁止改动源码）';
          return undefined; // 无重定向/写 API 目标（如 touch openspec/changes/x）→ 放行（保留 allow 标记语义）
        }
        for (const t of targets) {
          if (!isPlanPath(t)) return 'plan-guard: P 写仅允许 openspec/changes/ 目录（禁止改动源码）';
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
function resolveToolRegistry(agentCtx: unknown): { register(def: unknown): () => void } | undefined {
  const direct = (agentCtx as { tools?: { register(def: unknown): () => void } }).tools;
  if (direct && typeof direct.register === 'function') return direct;
  const fallback = (agentCtx as { get?(name: string): unknown }).get?.('tools');
  if (fallback && typeof (fallback as { register?: unknown }).register === 'function') {
    console.error('[dsh-swarm][debug] tool registry via ctx.get fallback (direct .tools missing)');
    return fallback as { register(def: unknown): () => void };
  }
  return undefined;
}

function safeKeys(ctx: unknown): string {
  try { return Object.keys(ctx as object).slice(0, 12).join(','); } catch { return '<unkeyed>'; }
}

/** 按角色在 agent scope 注册工具面（统一注册策略）：
 *  所有 kanban 工具从工具工厂选取 + getCaller 闭包（actor=role、boundTaskId=taskId）。
 *  can() 权限兜底仍保留在工具 execute 内（纵深防御第二道）。 */
export async function installRoleTools(agentCtx: Context, role: Role, deps: { kanban: KanbanService; wiki: WikiVaultClient; taskId?: string; kbMode?: 'remote' | 'local' }): Promise<void> {
  const kbMode = deps.kbMode ?? 'remote';
  console.error('[dsh-swarm][debug] installRoleTools role=' + role + ' task=' + deps.taskId);
  const caller = (): ToolCaller => ({ actor: role, boundTaskId: deps.taskId });
  const allKanban = buildKanbanTools(deps.kanban, caller);

  // 每角色可用的 kanban 工具名（V 额外编排、P/W/D 任务工具）
  // 设计表另有 V 专属 kanban_link/chain_show，src/tools/kanban-tools.ts 未实现这两项，
  // 故保持不注册（不为实现而实现多余工具），与设计表的差异以此注释声明。
  const namesFor: Record<Role, string[]> = {
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
    const name = (tool as { name?: string }).name;
    if (name && want.has(name)) registry.register(tool);
  }
  if (role === 'w') {
    if (kbMode === 'remote') {
      for (const tool of buildWikiTools(deps.wiki, caller)) registry.register(tool);
    }
    // local：wiki 三原语不注册，W 经 skill 工具（preset 提供）自治查写；prefetch/spec 视图保留
    // 设计表：W 对规格卡只读（spec_card_view）
    for (const tool of buildSpecCardTools(deps.kanban, caller)) {
      if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
    }
    const worker = new WikiWorker(deps.kanban, deps.wiki, { pagePrefix: 'projects/', kbMode: deps.kbMode });
    const getTask = async (taskId: string) => {
      const state = await deps.kanban.snapshot();
      const t = state.tasks.get(taskId);
      if (!t) throw new Error('unknown task: ' + taskId);
      return t;
    };
    for (const tool of buildPrefetchTools(worker, getTask, caller)) registry.register(tool);
  } else if (role === 'd') {
    // D：只读 KB——注册 wiki_read + wiki_search（均走 can('wiki-read')=w/d 只读兜底）；规格卡只读
    if (kbMode === 'remote') {
      for (const tool of buildWikiTools(deps.wiki, caller)) {
        const name = (tool as { name?: string }).name;
        if (name === 'wiki_read' || name === 'wiki_search') registry.register(tool);
      }
    }
    for (const tool of buildSpecCardTools(deps.kanban, caller)) {
      if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
    }
  } else if (role === 'p') {
    // P：spec_card_view（只读）+ openspec 写工具由 base 提供
    for (const tool of buildSpecCardTools(deps.kanban, caller)) {
      if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
    }
  } else if (role === 'pt') {
    // PT：只读评审——spec_card_view + 任务工具（无 create/wiki/执行）；写护栏在 agent-runner 装配
    for (const tool of buildSpecCardTools(deps.kanban, caller)) {
      if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
    }
  } else if (role === 'dt') {
    // DT：只读评审——spec_card_view + wiki 只读（评审区写由 ToolGuard 收窄）
    for (const tool of buildSpecCardTools(deps.kanban, caller)) {
      if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
    }
    if (kbMode === 'remote') {
      for (const tool of buildWikiTools(deps.wiki, caller)) {
        const n = (tool as { name?: string }).name;
        if (n === 'wiki_read' || n === 'wiki_search' || n === 'wiki_write') registry.register(tool);
      }
    }
    // ocr_review：ocr CLI 三子命令（preview/rule/managed）；未安装/托管未配置在 execute 内降级引导，注册无条件
    registry.register(buildOcrReviewTool({ cwd: () => process.cwd() }));
  } else if (role === 'v') {
    for (const tool of buildSpecCardTools(deps.kanban, caller)) {
      if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
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
const dtTaskChainIds = new Map<string, string>();

export function registerDtTaskChain(taskId: string, chainId: string): void {
  dtTaskChainIds.set(taskId, chainId);
}

export function unregisterDtTaskChain(taskId: string): void {
  dtTaskChainIds.delete(taskId);
}

/** 从 execution.agent 提取 session header（真实形态 agent.session.header，dsh-agent
 *  Session.header；取不到返回 undefined → 放行，DT 父会话 agent.ctx guard 兜底）。 */
function extractSessionHeader(agent: unknown): { cwd?: string; parentSession?: string; agentPreset?: string } | undefined {
  const a = agent as { session?: { header?: unknown } } | undefined;
  const h = a?.session?.header;
  return h && typeof h === 'object' ? (h as { cwd?: string; parentSession?: string; agentPreset?: string }) : undefined;
}

export interface SubagentGuardDeps {
  /** kbn-<taskId> → chainId 同步解析（缺省用 module 缓存；测试注入用）。 */
  getTaskChainId?(taskId: string): string | undefined;
}

/** 全局子代理写护栏：仅 DT 角色会话的"子代理"（agentPreset === 'kanban-dt' 且
 *  header.parentSession 为 kbn-<taskId> 前缀）应用 buildDTWriteGuard。判据：parentSession
 *  缺失或非 kbn- 前缀 → 放行（DT 父会话自身或无关会话；DT 父会话只读由 agent.ctx guard
 *  兜底，双保险）。repoRoot 取子代理 header.cwd（继承 DT 会话 cwd=评审目标仓库）；缺省
 *  '/'（写标记全拦的保守形态）。chainId 从 parentSession（kbn-<taskId>）解析；解析不到
 *  → 空（wiki_write fail-closed 全拒，源码写拦截不受影响）。 */
export function buildSubagentTreeGuard(deps: SubagentGuardDeps = {}): (execution: { name?: string; arguments?: unknown; agent?: unknown }) => string | undefined {
  return (execution) => {
    const header = extractSessionHeader(execution?.agent);
    if (!header || header.agentPreset !== 'kanban-dt') return undefined;
    // 仅真实子代理（parentSession 为 kbn- 前缀）受全局护栏约束；DT 父会话自身
    // parentSession 是主会话或缺失（非 kbn- 前缀），chainId 解析不到 → 空，若误拦
    // 会把 DT 评审写入（wiki_write projects/<repoSlug>/<chain>/review/...）拒掉 → 直接放行。
    const parent = header.parentSession;
    if (typeof parent !== 'string' || !parent.startsWith('kbn-')) return undefined;
    const repoRoot = header.cwd || '/';
    let chainId = '';
    const taskId = parent.slice('kbn-'.length);
    chainId = deps.getTaskChainId?.(taskId) ?? dtTaskChainIds.get(taskId) ?? '';
    return buildDTWriteGuard(repoRoot, chainId)(execution);
  };
}

/** 蜂群模式主会话硬闸：全局 guard，按 header.agentPreset==='swarm'
 *  精准判定（先例 buildSubagentTreeGuard）。swarm 会话 = git 反选白名单（GIT_READ_VERBS +
 *  buildPlanWriteGuard 同款分段提取判定，跳过 git 全局选项、提取不到动词 fail-closed，先行判定——
 *  git 变更动词多数同时命中只读基座的写标记，须以 swarm-guard 文案优先返回）+ 只读基座
 *  （buildReadOnlyWriteGuard：直接写工具全名拦截 + bash/run_code 写标记）。其余会话恒放行
 *  （角色会话自有 agent scope 护栏兜底，双保险不叠加）。 */
export function buildSwarmSessionGuard(): (execution: { name?: string; arguments?: unknown; agent?: unknown }) => string | undefined {
  return (execution) => {
    const header = extractSessionHeader(execution?.agent);
    if (!header || header.agentPreset !== 'swarm') return undefined;
    const name = String(execution?.name ?? '');
    const args = execution?.arguments ?? {};
    if (name === 'bash' || name === 'run_code') {
      const cmd = String(args && typeof args === 'object' ? ((args as Record<string, unknown>)['command'] ?? (args as Record<string, unknown>)['code'] ?? '') : '');
      if (cmd) {
        const segments = cmd.split(/\s*(?:&&|\|\||;|\||\n)\s*/);
        for (const seg of segments) {
          if (!/\bgit\b/.test(seg)) continue;
          const verbMatch = seg.match(/\bgit(?:\s+(?:--no-pager|-p|-v|--bare|--literal-pathspecs|--no-replace-objects|-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+|--namespace=\S+))*\s+([a-zA-Z][\w-]*)/);
          const verb = verbMatch ? verbMatch[1] : undefined;
          if (!verb || !GIT_READ_VERBS.has(verb)) return 'swarm-guard: 蜂群会话禁止 git 变更操作（执行由工作流 D 角色完成）';
        }
      }
    }
    const baseReason = buildReadOnlyWriteGuard(header.cwd || '/')(execution);
    if (baseReason) return baseReason;
    return undefined;
  };
}
