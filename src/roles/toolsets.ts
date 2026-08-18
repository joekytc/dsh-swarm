import type { Context } from '@deepseek-ai/cordis';
import { KanbanService } from '../domain/kanban-service.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import type { Role } from '../domain/types.js';
import { buildKanbanTools, type ToolCaller } from '../tools/kanban-tools.js';
import { buildSpecCardTools } from '../tools/spec-card-tools.js';
import { buildWikiTools } from '../tools/wiki-tools.js';
import { buildPrefetchTools } from '../tools/prefetch-tools.js';
import { WikiWorker } from './wiki-worker.js';

/** 直接写工具（无条件视为写能力；只读工具如 read/glob/grep 不算）。 */
const DIRECT_WRITE_TOOLS = new Set(['write', 'edit', 'rm', 'mv', 'cp', 'mkdir', 'mkfile']);

/** bash/run_code 命令中的写操作标记（写证据启发式；ls/cat/grep/git show 等只读不算）。
 *  与 chain-auditor 同源；重定向标记用 \s>>?（要求 > 前有空白），避免 2>/dev/null 只读重定向误判。 */
const BASH_WRITE_RE = /(?:\b(?:touch|mkdir|rm|rmdir|mv|cp|tee|truncate|install|ln|dd|chmod|chown|make|cmake)\b|\bgit\s+(?:-C\s+\S+\s+)*(?:add|commit|push|mv|rm|checkout\s+-b|switch\s+-c|worktree\s+add|merge|rebase|reset|clean|restore|tag|remote\s+add|apply)\b|\bpnpm\s+(?:add|install|remove|update|link)\b|\bnpm\s+(?:i|install|add|remove|uninstall|update)\b|\byarn\s+(?:add|remove)\b|\bbun\s+(?:add|install|remove)\b|\bsed\s+-i\b|\bperl\s+-i\b|\s>>?)/i;

/** run_code（JS/TS/Python 程序）中的写操作标记：文件写 API / 命令派发写工具。 */
const CODE_WRITE_RE = /(?:\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|unlinkSync|unlink|rmSync|rm|mkdirSync|mkdir|cpSync|renameSync)\b|\bwriteFile\(|\bfs\s*\.\s*(?:write|append|createWrite))/i;

/** 判定文件路径是否位于目标仓库内（含等于）。 */
function isPathInsideRepo(p: string, repoRoot: string): boolean {
  const c = p.replace(/\\/g, '/');
  const r = repoRoot.replace(/\\/g, '/');
  if (c === r) return true;
  return c.startsWith(r.endsWith('/') ? r : r + '/');
}

/** 递归收集参数中所有字符串值（含 JSON 字符串参数形态）。 */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out);
  }
}

/** 判定 wiki 路径是否位于 DT 评审命名空间 projects/<chain>/review/（拒绝 ../、绝对路径、非 review 前缀）。 */
export function isReviewNamespacePath(pagePath: string, chainId: string): boolean {
  const p = String(pagePath ?? '');
  if (!p || p.startsWith('/') || p.includes('..')) return false;
  const prefix = `projects/${chainId}/review/`;
  return p.startsWith(prefix);
}

/**
 * 评审引擎决策（DT）：ocr（open-code-review Delegation 模式）优先；
 * 不可用 fallback superpowers code-review；两者都不可用 → review-tool-unavailable（阻塞）。
 * 纯函数便于单测；真实可用性探测在 agent-runner 装配（探活 ocr 二进制/失败）。
 */
export function resolveReviewEngine(available: { ocr: boolean; codeReview: boolean }): 'ocr' | 'code-review' | 'review-tool-unavailable' {
  if (available.ocr) return 'ocr';
  if (available.codeReview) return 'code-review';
  return 'review-tool-unavailable';
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
      if (!isReviewNamespacePath(pagePath, chainId)) return 'wiki-write-outside-review-namespace: DT may only write projects/<chain>/review/';
    }
    return base(execution);
  };
}
export function buildReadOnlyWriteGuard(repoRoot: string): (execution: { name?: string; arguments?: unknown }) => string | undefined {
  return (execution) => {
    const name = String(execution?.name ?? '');
    const args = execution?.arguments ?? {};
    const strings: string[] = [];
    collectStrings(args, strings);
    const hitsRepo = strings.some((s) => isPathInsideRepo(s, repoRoot));
    if (DIRECT_WRITE_TOOLS.has(name) && hitsRepo) return 'write-to-repo-source-denied: read-only reviewer must not modify repo sources';
    if (name === 'bash' || name === 'run_code') {
      const cmd = String(args && typeof args === 'object' ? ((args as Record<string, unknown>)['command'] ?? (args as Record<string, unknown>)['code'] ?? '') : '');
      // bash 用命令文本包含 repoRoot 判定（cd <repo>/…、git -C <repo> … 均为子串命中），
      // 不必路径前缀；直接写工具才用严格路径（isPathInsideRepo）。
      // run_code 用 JS/Python 文件写 API 标记（CODE_WRITE_RE）判定实际写意图。
      const writeRe = name === 'run_code' ? CODE_WRITE_RE : BASH_WRITE_RE;
      if (cmd && writeRe.test(cmd) && cmd.includes(repoRoot)) return 'write-to-repo-source-denied: ' + name + ' with write marker targeting repo';
    }
    return undefined;
  };
}

/** 按角色在 agent scope 注册工具面（P1-3 统一注册策略）：
 *  所有 kanban 工具从 T9 工厂选取 + getCaller 闭包（actor=role、boundTaskId=taskId）。
 *  can() 权限兜底仍保留在工具 execute 内（纵深防御第二道）。 */
export async function installRoleTools(agentCtx: Context, role: Role, deps: { kanban: KanbanService; wiki: WikiVaultClient; taskId?: string }): Promise<void> {
  console.error('[dsh-kanban][debug] installRoleTools role=' + role + ' task=' + deps.taskId);
  const caller = (): ToolCaller => ({ actor: role, boundTaskId: deps.taskId });
  const allKanban = buildKanbanTools(deps.kanban, caller);

  // 每角色可用的 kanban 工具名（V 额外编排、P/W/D 任务工具）
  // 设计表（§3）另有 V 专属 kanban_link/chain_show，src/tools/kanban-tools.ts 未实现这两项，
  // 故保持不注册（不为实现而实现多余工具），与设计表的差异以此注释声明。
  const namesFor: Record<Role, string[]> = {
    v: ['kanban_create', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment', 'kanban_show', 'kanban_list'],
    p: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
    w: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
    d: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
    // 评审角色（Task 8/9 正式装配工具面）：PT/DT 任务工具 + 只读（spec 视图等）
    pt: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
    dt: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
  };
  const want = new Set(namesFor[role]);
  const registry = agentCtx.tools as { register(def: unknown): () => void } | undefined;
  if (!registry) return; // 无工具服务（测试桩）跳过

  for (const tool of allKanban) {
    const name = (tool as { name?: string }).name;
    if (name && want.has(name)) registry.register(tool);
  }
  if (role === 'w') {
    for (const tool of buildWikiTools(deps.wiki, caller)) registry.register(tool);
    // 设计表 §3：W 对规格卡只读（spec_card_view）
    for (const tool of buildSpecCardTools(deps.kanban, caller)) {
      if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
    }
    const worker = new WikiWorker(deps.kanban, deps.wiki, { pagePrefix: 'projects/' });
    const getTask = async (taskId: string) => {
      const state = await deps.kanban.snapshot();
      const t = state.tasks.get(taskId);
      if (!t) throw new Error('unknown task: ' + taskId);
      return t;
    };
    for (const tool of buildPrefetchTools(worker, getTask, caller)) registry.register(tool);
  } else if (role === 'd') {
    // D：只读 KB——注册 wiki_read + wiki_search（均走 can('wiki-read')=w/d 只读兜底）；规格卡只读
    for (const tool of buildWikiTools(deps.wiki, caller)) {
      const name = (tool as { name?: string }).name;
      if (name === 'wiki_read' || name === 'wiki_search') registry.register(tool);
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
    // DT：只读评审——spec_card_view + wiki 只读（评审区写由 ToolGuard 收窄）；Task 9 完整实现
    for (const tool of buildSpecCardTools(deps.kanban, caller)) {
      if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
    }
    for (const tool of buildWikiTools(deps.wiki, caller)) {
      const n = (tool as { name?: string }).name;
      if (n === 'wiki_read' || n === 'wiki_search' || n === 'wiki_write') registry.register(tool);
    }
  } else if (role === 'v') {
    for (const tool of buildSpecCardTools(deps.kanban, caller)) {
      if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
    }
  }
}
