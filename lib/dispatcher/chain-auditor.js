// src/dispatcher/chain-auditor.ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { eventType, toolArgs, toolName } from './session-events.js';
import { isPathInside } from './target-repo.js';
/** 直接写工具（无条件视为写能力；只读工具如 read/glob/grep 不算）。 */
const DIRECT_WRITE_TOOLS = new Set(['write', 'edit', 'rm', 'mv', 'cp', 'mkdir', 'mkfile']);
/** run_code：写能力载体，需结合派发子调用判定（修复轮 7）。 */
const CODE_RUN_TOOLS = new Set(['run_code']);
/** bash 命令中的写操作标记（写证据启发式；ls/cat/grep/git status 等只读不算）。
 *  重定向标记用 \s>>?（要求 > 前有空白），避免把 2>/dev/null、2>&1 等只读 stderr 重定向误判为写。 */
const BASH_WRITE_RE = /(?:\b(?:touch|mkdir|rm|rmdir|mv|cp|tee|truncate|install|ln|dd|chmod|chown|make|cmake)\b|\bgit\s+(?:add|commit|push|mv|rm|checkout\s+-b|switch\s+-c|worktree\s+add|merge|rebase|reset|clean|restore|tag|remote\s+add)\b|\bpnpm\s+(?:add|install|remove|update|link)\b|\bnpm\s+(?:i|install|add|remove|uninstall|update)\b|\byarn\s+(?:add|remove)\b|\bbun\s+(?:add|install|remove)\b|\bsed\s+-i\b|\bperl\s+-i\b|\s>>?)/i;
/** 从工具调用参数中收集含 workspacesRoot 的字符串值（文件路径线索）。 */
function collectWorkspacePaths(value, root, out) {
    if (typeof value === 'string') {
        if (value.includes(root))
            out.add(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            collectWorkspacePaths(item, root, out);
        return;
    }
    if (value && typeof value === 'object') {
        for (const v of Object.values(value)) {
            collectWorkspacePaths(v, root, out);
        }
    }
}
/** 从会话事件读取任意字段（兼容顶层 / data 嵌套两种落盘形态）。 */
function dataField(e, key) {
    const obj = (e ?? {});
    if (obj[key] !== undefined)
        return obj[key];
    const d = obj['data'];
    return d?.[key];
}
/** 文本是否含写操作标记（bash 命令 / 兜底 code 字符串共用）。 */
function hasWriteMarker(text) {
    return BASH_WRITE_RE.test(text);
}
/** 判定单个工具调用是否构成写证据（修复轮 7：行为判定 + 只读排除）。
 *  @param subs 该调用的 run_code 派发子调用（无则 null，走兜底/直接判定）。 */
function handleCallEvidence(name, args, subs, root, paths) {
    if (DIRECT_WRITE_TOOLS.has(name)) {
        collectWorkspacePaths(args, root, paths);
        return;
    }
    if (subs && subs.length > 0) {
        // run_code 有派发记录：按实际子调用判定；只读子调用（read/glob/grep/bash 只读命令…）不产生证据
        for (const sub of subs) {
            if (DIRECT_WRITE_TOOLS.has(sub.name)) {
                collectWorkspacePaths(sub.arguments, root, paths);
            }
            else if (sub.name === 'bash') {
                const cmd = String(sub.arguments?.command ?? '');
                if (hasWriteMarker(cmd) && cmd.includes(root))
                    paths.add(cmd);
            }
            else if (sub.name === 'run_code') {
                const code = String(sub.arguments?.code ?? '');
                if (hasWriteMarker(code) && code.includes(root))
                    paths.add(code);
            }
        }
        return;
    }
    if (name === 'run_code') {
        // 兜底：无派发记录（旧会话/未落盘）——仅当 code 含写标记且含工作区路径时才计为写证据
        const code = String(args?.code ?? '');
        if (hasWriteMarker(code) && code.includes(root))
            paths.add(code);
        return;
    }
    if (name === 'bash') {
        const cmd = String(args?.command ?? '');
        if (hasWriteMarker(cmd) && cmd.includes(root))
            paths.add(cmd);
        return;
    }
}
function sessionWriteEvidence(id, workspacesRoot, events) {
    // 外层工具调用索引：callId → {name, arguments}
    const calls = new Map();
    // run_code 派发子调用索引：rootCallId → [{name, arguments}]
    const dispatchByRoot = new Map();
    for (const ev of events) {
        const t = eventType(ev);
        if (t === 'tool/call' || t === 'tool-call') {
            const callId = String(dataField(ev, 'callId') ?? '');
            const name = String(toolName(ev) ?? '');
            const args = toolArgs(ev);
            if (callId) {
                calls.set(callId, { name, arguments: args });
            }
            else {
                // 兼容无 callId 的扁平事件（旧形态/测试夹具）：按写标记直接判定
                const flat = new Set();
                handleCallEvidence(name, args, null, workspacesRoot, flat);
                if (flat.size > 0) {
                    return {
                        source: 'main-session-scan',
                        detail: '非角色会话（id=' + id + '）对 kanban 工作区路径发起写能力工具调用，疑似主 agent 越权写产物',
                        paths: [...flat],
                    };
                }
            }
        }
        else if (t === 'tool/code-dispatch-start' || t === 'tool/code-dispatch') {
            const rootCallId = String(dataField(ev, 'rootCallId') ?? '');
            const name = String(dataField(ev, 'name') ?? '');
            if (!rootCallId || !name)
                continue;
            const arr = dispatchByRoot.get(rootCallId) ?? [];
            arr.push({ name, arguments: toolArgs(ev) });
            dispatchByRoot.set(rootCallId, arr);
        }
    }
    const paths = new Set();
    for (const [callId, call] of calls) {
        handleCallEvidence(call.name, call.arguments, dispatchByRoot.get(callId) ?? null, workspacesRoot, paths);
    }
    if (paths.size === 0)
        return null;
    return {
        source: 'main-session-scan',
        detail: '非角色会话（id=' + id + '）对 kanban 工作区路径发起写能力工具调用，疑似主 agent 越权写产物',
        paths: [...paths],
    };
}
export class ChainAuditor {
    kanban;
    workspacesRoot;
    listLiveAgents;
    constructor(deps) {
        this.kanban = deps.kanban;
        this.workspacesRoot = deps.workspacesRoot;
        this.listLiveAgents = deps.listLiveAgents ?? (() => []);
    }
    /** 执行核对，返回越权证据（空=通过，不阻塞汇报）。
     *  @param workspaceDir 本链发起工作区（Chain.workspaceDir）；提供时仅扫描工作区内的会话（修复轮 7）。 */
    async check(chainId, workspaceDir = null) {
        const evidence = [];
        // 源 1：主会话（非 kbn- 角色会话）写能力工具事件扫描
        for (const agent of this.listLiveAgents()) {
            if (String(agent.id ?? '').startsWith('kbn-'))
                continue; // 角色会话（P/W/D/V）跳过
            // 修复轮 7：作用域收窄——仅扫本链发起工作区内的会话；会话无 cwd（测试伪造）时保守保留扫描
            if (workspaceDir && agent.session?.header?.cwd && !isPathInside(agent.session.header.cwd, workspaceDir)) {
                continue;
            }
            const hit = sessionWriteEvidence(String(agent.id), this.workspacesRoot, agent.session?.events ?? []);
            if (hit)
                evidence.push(hit);
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
    async reconcileArtifacts(chainId) {
        const chainDir = join(this.workspacesRoot, chainId);
        let entries;
        try {
            entries = readdirSync(chainDir);
        }
        catch {
            return []; // 无工作区目录 = 无产物，无越权线索
        }
        // 链任务 id 集合（角色 agent 只写各自任务工作区）
        const state = await this.kanban.snapshot();
        const taskIds = new Set();
        for (const t of state.tasks.values())
            if (t.chainId === chainId)
                taskIds.add(t.id);
        return entries.filter((name) => !taskIds.has(name)).map((name) => join(chainDir, name));
    }
}
