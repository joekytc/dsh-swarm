// src/dispatcher/chain-auditor.ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { KanbanService } from '../domain/kanban-service.js';
import type { AuditEvidence, Task } from '../domain/types.js';
import { eventType, toolArgs, toolName } from './session-events.js';
import { isPathInside } from './target-repo.js';

/**
 * D23 链完成验收核对：Chain(completed) 时核对主会话是否越权写工作区产物。
 *
 * 数据源（修复轮 7，修复「评估项目只读排查 run_code 被误判为越权写产物」）：
 * 1. 主会话会话事件扫描（primary，尽力而为）：枚举活 agent 注册表（ctx.agents.list），
 *    对 id 非 kbn-*（角色会话确定性 id：kbn-<taskId> / kbn-v-<chainId>）的会话，
 *    扫描其 session.events 中的工具调用。插件无法解析主会话真实 session id（路由只用
 *    逻辑 id 'session_main'），故以"非角色会话写 kanban 工作区"为近似。修复轮 7 收紧三点：
 *    a. 作用域收窄：仅扫描会话工作区（session.header.cwd）位于本链发起工作区
 *       （Chain.workspaceDir = /plan: 主 agent 所在工作空间）内的会话，
 *       排除其他项目的主会话（如 评估 项目里调试 dsh-swarm 的会话）；
 *    b. 行为判定：run_code 按实际派发子调用（tool/code-dispatch-start / tool/code-dispatch，
 *       经 rootCallId 关联外层调用）判定是否真的发生写，而非把 run_code 一律视为写；
 *    c. 只读排除：bash 命令 / 兜底 code 字符串仅当含写操作标记（BASH_WRITE_RE）且
 *       含 workspacesRoot 路径时才计为写证据；纯只读排查（ls/cat/glob/read/grep）不产生证据。
 * 2. 产物归属核对（fallback，机械可测）：枚举 workspaces/<chainId>/ 下条目；
 *    角色 agent 只写各自任务工作区（workspaces/<chainId>/<taskId>/），
 *    链工作区根下非任务 id 的条目 = 无主产物（疑似主 agent 越权写）→ 证据。
 */
export interface ChainAuditorDeps {
  kanban: KanbanService;
  workspacesRoot: string;
  /** 活 agent 注册表快照（dispatcher 注入 ctx.agents.list 的适配）；测试可伪造。 */
  listLiveAgents?: () => Array<{
    id: string;
    session?: { events: unknown[]; header?: { cwd?: string; agentPreset?: string } };
  }>;
}

/** 直接写工具（无条件视为写能力；只读工具如 read/glob/grep 不算）。 */
const DIRECT_WRITE_TOOLS = new Set(['write', 'edit', 'rm', 'mv', 'cp', 'mkdir', 'mkfile']);

/** run_code：写能力载体，需结合派发子调用判定（修复轮 7）。 */
const CODE_RUN_TOOLS = new Set(['run_code']);

/** bash 命令中的写操作标记（写证据启发式；ls/cat/grep/git status 等只读不算）。
 *  重定向标记用 \s>>?（要求 > 前有空白），避免把 2>/dev/null、2>&1 等只读 stderr 重定向误判为写。 */
const BASH_WRITE_RE = /(?:\b(?:touch|mkdir|rm|rmdir|mv|cp|tee|truncate|install|ln|dd|chmod|chown|make|cmake)\b|\bgit\s+(?:add|commit|push|mv|rm|checkout\s+-b|switch\s+-c|worktree\s+add|merge|rebase|reset|clean|restore|tag|remote\s+add)\b|\bpnpm\s+(?:add|install|remove|update|link)\b|\bnpm\s+(?:i|install|add|remove|uninstall|update)\b|\byarn\s+(?:add|remove)\b|\bbun\s+(?:add|install|remove)\b|\bsed\s+-i\b|\bperl\s+-i\b|\s>>?)/i;

/** run_code/兜底 code 字符串中的 Python 写 API 标记（Fix round 2 F2 同源：audit 补 open( 兜底）。
 *  open() 写模式精确版（读模式 'r' 不命中）、os. 模块写、pathlib Path 写、shutil 复制/移动/删除。 */
const PY_CODE_WRITE_RE = /(?:\bopen\(\s*['"][^'"\n]*['"]\s*,\s*(?:(?:mode|encoding|errors|buffering|newline|closefd|opener|text)\s*=\s*)?['"][wa][^'"\n]*['"]|\bos\s*\.\s*(?:remove|unlink|write|rmdir|makedirs|rename)\b|\.(?:write_text|write_bytes|unlink|mkdir|rename)\(|shutil\s*\.\s*(?:copy|move|rmtree))/i;

interface SubDispatch { name: string; arguments: Record<string, unknown> }

/** 从工具调用参数中收集含 workspacesRoot 的字符串值（文件路径线索）。 */
function collectWorkspacePaths(value: unknown, root: string, out: Set<string>): void {
  if (typeof value === 'string') {
    if (value.includes(root)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectWorkspacePaths(item, root, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectWorkspacePaths(v, root, out);
    }
  }
}

/** 从会话事件读取任意字段（兼容顶层 / data 嵌套两种落盘形态）。 */
function dataField(e: unknown, key: string): unknown {
  const obj = (e ?? {}) as Record<string, unknown>;
  if (obj[key] !== undefined) return obj[key];
  const d = obj['data'] as Record<string, unknown> | undefined;
  return d?.[key];
}

/** 文本是否含写操作标记（bash 命令 / 兜底 code 字符串共用；含 Python 写 API 标记）。 */
function hasWriteMarker(text: string): boolean {
  return BASH_WRITE_RE.test(text) || PY_CODE_WRITE_RE.test(text);
}

/** 判定单个工具调用是否构成写证据（修复轮 7：行为判定 + 只读排除）。
 *  @param subs 该调用的 run_code 派发子调用（无则 null，走兜底/直接判定）。 */
function handleCallEvidence(
  name: string,
  args: Record<string, unknown>,
  subs: SubDispatch[] | null,
  root: string,
  paths: Set<string>,
): void {
  if (DIRECT_WRITE_TOOLS.has(name)) {
    collectWorkspacePaths(args, root, paths);
    return;
  }
  if (subs && subs.length > 0) {
    // run_code 有派发记录：按实际子调用判定；只读子调用（read/glob/grep/bash 只读命令…）不产生证据
    for (const sub of subs) {
      if (DIRECT_WRITE_TOOLS.has(sub.name)) {
        collectWorkspacePaths(sub.arguments, root, paths);
      } else if (sub.name === 'bash') {
        const cmd = String(sub.arguments?.command ?? '');
        if (hasWriteMarker(cmd) && cmd.includes(root)) paths.add(cmd);
      } else if (sub.name === 'run_code') {
        const code = String(sub.arguments?.code ?? '');
        if (hasWriteMarker(code) && code.includes(root)) paths.add(code);
      }
    }
    return;
  }
  if (name === 'run_code') {
    // 兜底：无派发记录（旧会话/未落盘）——仅当 code 含写标记且含工作区路径时才计为写证据
    const code = String(args?.code ?? '');
    if (hasWriteMarker(code) && code.includes(root)) paths.add(code);
    return;
  }
  if (name === 'bash') {
    const cmd = String(args?.command ?? '');
    if (hasWriteMarker(cmd) && cmd.includes(root)) paths.add(cmd);
    return;
  }
}

function sessionWriteEvidence(id: string, workspacesRoot: string, events: unknown[]): AuditEvidence | null {
  // 外层工具调用索引：callId → {name, arguments}
  const calls = new Map<string, { name: string; arguments: Record<string, unknown> }>();
  // run_code 派发子调用索引：rootCallId → [{name, arguments}]
  const dispatchByRoot = new Map<string, SubDispatch[]>();
  for (const ev of events) {
    const t = eventType(ev as never);
    if (t === 'tool/call' || t === 'tool-call') {
      const callId = String(dataField(ev, 'callId') ?? '');
      const name = String(toolName(ev as never) ?? '');
      const args = toolArgs(ev as never);
      if (callId) {
        calls.set(callId, { name, arguments: args });
      } else {
        // 兼容无 callId 的扁平事件（旧形态/测试夹具）：按写标记直接判定
        const flat = new Set<string>();
        handleCallEvidence(name, args, null, workspacesRoot, flat);
        if (flat.size > 0) {
          return {
            source: 'main-session-scan',
            detail: '非角色会话（id=' + id + '）对 kanban 工作区路径发起写能力工具调用，疑似主 agent 越权写产物',
            paths: [...flat],
          };
        }
      }
    } else if (t === 'tool/code-dispatch-start' || t === 'tool/code-dispatch') {
      const rootCallId = String(dataField(ev, 'rootCallId') ?? '');
      const name = String(dataField(ev, 'name') ?? '');
      if (!rootCallId || !name) continue;
      const arr = dispatchByRoot.get(rootCallId) ?? [];
      arr.push({ name, arguments: toolArgs(ev as never) });
      dispatchByRoot.set(rootCallId, arr);
    }
  }

  const paths = new Set<string>();
  for (const [callId, call] of calls) {
    handleCallEvidence(call.name, call.arguments, dispatchByRoot.get(callId) ?? null, workspacesRoot, paths);
  }
  if (paths.size === 0) return null;
  return {
    source: 'main-session-scan',
    detail: '非角色会话（id=' + id + '）对 kanban 工作区路径发起写能力工具调用，疑似主 agent 越权写产物',
    paths: [...paths],
  };
}

export class ChainAuditor {
  private readonly kanban: KanbanService;
  private readonly workspacesRoot: string;
  private readonly listLiveAgents: () => Array<{
    id: string;
    session?: { events: unknown[]; header?: { cwd?: string; agentPreset?: string } };
  }>;

  constructor(deps: ChainAuditorDeps) {
    this.kanban = deps.kanban;
    this.workspacesRoot = deps.workspacesRoot;
    this.listLiveAgents = deps.listLiveAgents ?? (() => []);
  }

  /** 执行核对，返回越权证据（空=通过，不阻塞汇报）。
   *  @param workspaceDir 本链发起工作区（Chain.workspaceDir）；提供时仅扫描工作区内的会话（修复轮 7）。 */
  async check(chainId: string, workspaceDir: string | null = null): Promise<AuditEvidence[]> {
    const evidence: AuditEvidence[] = [];
    // 源 1：主会话（非 kbn- 角色会话）写能力工具事件扫描
    for (const agent of this.listLiveAgents()) {
      if (String(agent.id ?? '').startsWith('kbn-')) continue; // 角色会话（P/W/D/V）跳过
      // 0.1.0 delegation 豁免（spec FR5）：header.agentPreset 以 kanban- 开头 → 角色会话
      // 的子代理（childSessionMeta 记录所 join 的 preset id），产物归属 git 证据链，
      // 不按"主会话越权"判定；源2（无主产物核对）仍兜底其误写链工作区根。
      const joinedPreset = (agent.session?.header as { agentPreset?: string } | undefined)?.agentPreset;
      if (typeof joinedPreset === 'string' && joinedPreset.startsWith('kanban-')) continue;
      // 修复轮 7：作用域收窄——仅扫本链发起工作区内的会话；会话无 cwd（测试伪造）时保守保留扫描
      if (workspaceDir && agent.session?.header?.cwd && !isPathInside(agent.session.header.cwd, workspaceDir)) {
        continue;
      }
      const hit = sessionWriteEvidence(String(agent.id), this.workspacesRoot, agent.session?.events ?? []);
      if (hit) evidence.push(hit);
    }
    // 源 2：产物归属核对——链工作区根下非任务 id 的无主条目
    const orphan = await this.reconcileArtifacts(chainId);
    if (orphan.length > 0) {
      evidence.push({
        source: 'artifact-reconciliation',
        detail: '链工作区存在不属于任何任务工作区的无主条目，疑似主 agent 越权写入',
        paths: orphan,
      });
    }
    return evidence;
  }

  private async reconcileArtifacts(chainId: string): Promise<string[]> {
    const chainDir = join(this.workspacesRoot, chainId);
    let entries: string[];
    try {
      entries = readdirSync(chainDir);
    } catch {
      return []; // 无工作区目录 = 无产物，无越权线索
    }
    // 链任务 id 集合（角色 agent 只写各自任务工作区）
    const state = await this.kanban.snapshot();
    const taskIds = new Set<string>();
    for (const t of state.tasks.values()) if (t.chainId === chainId) taskIds.add(t.id);
    return entries.filter((name) => !taskIds.has(name)).map((name) => join(chainDir, name));
  }
}

export type { AuditEvidence, Task };
