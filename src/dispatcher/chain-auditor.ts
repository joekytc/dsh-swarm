// src/dispatcher/chain-auditor.ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { KanbanService } from '../domain/kanban-service.js';
import type { AuditEvidence, Task } from '../domain/types.js';

/**
 * D23 链完成验收核对：Chain(completed) 时核对主会话是否越权写工作区产物。
 *
 * 数据源（2026-08-15 取舍，以真实 DSH API 为准）：
 * 1. 主会话会话事件扫描（primary，尽力而为）：枚举活 agent 注册表（ctx.agents.list），
 *    对 id 非 kbn-*（角色会话确定性 id：kbn-<taskId> / kbn-v-<chainId>）的会话，
 *    扫描其 session.events 中的工具调用（bash/run_code/write/edit/rm/mv/cp 等写能力工具），
 *    命中参数含 workspacesRoot 路径 → 证据。插件无法解析主会话真实 session id（路由只用
 *    逻辑 id 'session_main'），故以"非角色会话写 kanban 工作区"为近似。
 * 2. 产物归属核对（fallback，机械可测）：枚举 workspaces/<chainId>/ 下条目；
 *    角色 agent 只写各自任务工作区（workspaces/<chainId>/<taskId>/），
 *    链工作区根下非任务 id 的条目 = 无主产物（疑似主 agent 越权写）→ 证据。
 */
export interface ChainAuditorDeps {
  kanban: KanbanService;
  workspacesRoot: string;
  /** 活 agent 注册表快照（dispatcher 注入 ctx.agents.list 的适配）；测试可伪造。 */
  listLiveAgents?: () => Array<{ id: string; session?: { events: unknown[] } }>;
}

/** 写能力工具名（写证据启发式；只读工具如 read/glob/grep 不算）。 */
const WRITE_TOOLS = new Set(['bash', 'run_code', 'write', 'edit', 'rm', 'mv', 'cp', 'mkdir', 'mkfile']);

/** 从工具调用参数中收集含 workspacesRoot 的字符串值（文件路径线索）。 */
function collectWorkspacePaths(args: unknown, root: string, out: Set<string>): void {
  if (typeof args === 'string') {
    if (args.includes(root)) out.add(args);
    return;
  }
  if (Array.isArray(args)) {
    for (const item of args) collectWorkspacePaths(item, root, out);
    return;
  }
  if (args && typeof args === 'object') {
    for (const value of Object.values(args as Record<string, unknown>)) {
      collectWorkspacePaths(value, root, out);
    }
  }
}

function sessionWriteEvidence(id: string, workspacesRoot: string, events: unknown[]): AuditEvidence | null {
  const paths = new Set<string>();
  for (const ev of events) {
    const e = ev as { type?: string; name?: string; arguments?: unknown };
    if (e.type !== 'tool-call') continue;
    if (!WRITE_TOOLS.has(String(e.name ?? ''))) continue;
    collectWorkspacePaths(e.arguments ?? {}, workspacesRoot, paths);
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
  private readonly listLiveAgents: () => Array<{ id: string; session?: { events: unknown[] } }>;

  constructor(deps: ChainAuditorDeps) {
    this.kanban = deps.kanban;
    this.workspacesRoot = deps.workspacesRoot;
    this.listLiveAgents = deps.listLiveAgents ?? (() => []);
  }

  /** 执行核对，返回越权证据（空=通过，不阻塞汇报）。 */
  async check(chainId: string): Promise<AuditEvidence[]> {
    const evidence: AuditEvidence[] = [];
    // 源 1：主会话（非 kbn- 角色会话）写能力工具事件扫描
    for (const agent of this.listLiveAgents()) {
      if (String(agent.id ?? '').startsWith('kbn-')) continue; // 角色会话（P/W/D/V）跳过
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
