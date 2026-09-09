// src/tools/planning-tools.ts
import { defineTool } from '@deepseek-ai/dsh-tools';
import { type JsonValue } from '@deepseek-ai/dsh-util-values';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { KanbanService } from '../domain/kanban-service.js';
import type { WikiVaultClient, WikiError } from '../wiki/wiki-vault-client.js';
import { validatePlanningChecklist, formatChecklistBody, type PlanningChecklist } from '../domain/planning-checklist.js';
import { validatePrefetchManifest, type PrefetchManifest } from '../domain/prefetch-manifest.js';
import { buildChecklistSlug, KB_PAGE_NAMESPACES_HINT, LOCAL_CHECKLIST_PREFIX, LOCAL_LEARNING_BASE, assertAllowedWikiPagePath, assertLocalKbPagePath } from '../wiki/page-path.js';
import { validateLearning, formatLearningBody, buildRepoSlug, countLearningSignals, type LearningEntry } from '../domain/memory.js';
import type { ToolCaller } from './kanban-tools.js';
import type { AgentModelOptions } from '../dispatcher/dispatcher.js';
import type { PrefixRoutes } from '../config.js';

/** 工具运行时上下文（dsh-tools ToolRunContext 窄型）：agent loop 注入调用者 Agent 与取消信号，
 *  planning_prefetch 经官方子代理缝启动时需透传（parent + signal）。 */
export interface PrefetchExecContext {
  agent?: Agent;
  signal?: AbortSignal;
}

export interface PlanningToolDeps {
  service: KanbanService;
  wiki: WikiVaultClient;
  getCaller(): ToolCaller;
  /** 真实实现：经官方子代理缝（ctx.subagents.start）启动只读预取子代理并返回其文本输出；测试注入 stub。
   *  parentAgent = 发起调用的主 agent（血缘/模型继承源），由 planning_prefetch 的 exec.agent 透传。 */
  spawnPrefetch?(prompt: string, workspaceDir: string, parentAgent?: Agent, signal?: AbortSignal): Promise<string>;
  tempDir(): string; // 兜底目录（KB 不可达时）
  pagePrefix?: string; // KB 页面前缀（默认 projects/）
  /** KB 双模式：local 时 checklist/learning 落本地库命名空间（wiki/queries/checklists/、wiki/synthesis/learnings/），缺省 remote。 */
  kbMode?: 'remote' | 'local';
  ownerSessionId?: string;
  /** 斜杠命令前缀路由（单一事实源），用于 description 文案派生。 */
  prefixRoutes: PrefixRoutes;
  defaultModel?: AgentModelOptions;
  /** 清单落库成功回调（kb 与 temp 两分支各调一次），供 main-session-tools 回写 planningBySession。 */
  onChecklistSaved?(saved: { ref: string; source: 'kb' | 'temp'; checklist: PlanningChecklist }): void;
  /** memory.enabled；false 时 planning_memory_recall 返回 disabled 提示（planning_learning_save 不受影响）。 */
  memoryEnabled?: boolean;
  /** 闸1：/plan: 捕获的当前工作区（main-session-tools 注入）；非 null 且与清单 localPath 不一致 → 阻断落库。 */
  resolveWorkspaceDir?: () => string | null;
  /** 蜂群模式分叉：main-session-tools 注入 () => planningBySession.get('session_main')?.mode ?? null。
   *  'swarm' 时 checklist_save 成功返回体附 nextStep 确认闸指引；前缀模式返回体不变。 */
  flowMode?: () => 'swarm' | 'prefix' | null;
}

const isWikiError = (e: unknown): e is WikiError =>
  e instanceof Error && (e as { code?: string }).code === 'kb-unreachable';

/** 主 agent 规划期工具：需求澄清清单落库（KB 优先/临时目录兜底）+ 只读仓库预取（子代理）。 */
export function buildPlanningTools(deps: PlanningToolDeps) {
  const local = deps.kbMode === 'local';
  // checklist 前缀双模式：remote → projects/<repoSlug>/checklists/（repoSlug 段在 pagePath 拼接）；
  // local → wiki/queries/checklists/（local 时 LocalWikiClient.write 仅接受 wiki/** 相对路径，projects/ 会被 kb-rejected）
  const pagePrefix = deps.pagePrefix ?? 'projects/';
  const checklistPrefix = local ? LOCAL_CHECKLIST_PREFIX : pagePrefix;
  const session = deps.ownerSessionId ?? 'session_main';
  const SWARM_NEXT_STEP = '向用户征求确认；仅当用户回复含明确肯定语义（确认/开干/开跑/开始/go 等）才调 kanban_route{intent:\'openspec\'} 建链；模糊、岔开话题、只提修改意见 = 未确认，继续澄清。禁止未确认建链。';
  const swarmNext = () => (deps.flowMode?.() === 'swarm' ? { nextStep: SWARM_NEXT_STEP } : {});

  return [
    defineTool({
      name: 'planning_checklist_save',
      description: 'Save the converged requirement-clarification checklist (structured schema) to KB, falling back to a temp dir if KB is unreachable. Returns ref/path + authoritative repo path. restoreRef (optional) = existing KB page path to overwrite in place (recovery path when in-memory context was lost); omit for first-time save (creates a new timestamped page).',
      parameters: { checklist: { type: 'json', required: true, description: 'Structured PlanningChecklist: {requirementName?, spec: {problem, solution, user_stories, impl_decisions, testing, out_of_scope}, manifest, clarifications, doubts: Array<{"q": string, "resolved": boolean, "answer"?: string}>, risks?}. spec.user_stories: array of plain strings — each element ONE sentence "As a <role>, I want <capability>, so that <benefit>"; NEVER objects/nested. spec.impl_decisions: array of plain strings — one decision per element; NEVER objects. clarifications: non-empty required — record every Q&A asked during this planning round; Array<{"q": string, "a": string}> with keys exactly "q"/"a" (NOT "question"/"answer"). risks (optional): Array<{"description": string, "source": string, "mitigation": string}> — register real risks/non-blocking concerns surfaced during clarification; omit or [] when none. checklist.requirementName (optional) = ' + deps.prefixRoutes.plan + ' rest first sentence, used for the checklist page title 【需求】, same source as the task-card title' }, restoreRef: { type: 'string', description: 'Optional KB page path to overwrite in place (recovery path); omit for new save' } },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { checklist: unknown; restoreRef?: string }) {
        const caller = deps.getCaller();
        if (caller.actor !== 'human') throw new Error('permission denied: planning_checklist_save');
        const errors = validatePlanningChecklist(args.checklist);
        if (errors.length > 0) throw new Error('invalid planning checklist: ' + errors.join('; '));
        const checklist = args.checklist as PlanningChecklist;
        const wsDir = deps.resolveWorkspaceDir?.() ?? null;
        if (wsDir && checklist.manifest.repo.localPath !== wsDir) {
          throw new Error(`[workspace-mismatch] 清单 manifest.repo.localPath (${checklist.manifest.repo.localPath}) 与当前工作区 (${wsDir}) 不一致。请在目标仓库工作区内重新执行 ${deps.prefixRoutes.plan} 重新澄清落库（不可跳过）。`);
        }
        const body = formatChecklistBody(checklist);
        // 恢复路径（内存丢失后重建）：传 restoreRef 则覆盖原页，不产生重复页
        if (args.restoreRef && args.restoreRef.startsWith(checklistPrefix)) {
          try {
            await deps.wiki.write(args.restoreRef, body);
            deps.onChecklistSaved?.({ ref: args.restoreRef, source: 'kb', checklist });
            return { ok: true, ref: args.restoreRef, source: 'kb', repoPath: checklist.manifest.repo.localPath, ...swarmNext() } as unknown as JsonValue;
          } catch (err) {
            if (!isWikiError(err)) throw err;
            // KB 不可达 → 落临时目录兜底（不覆盖原页），回调仍回填内存
          }
        }
        const slug = buildChecklistSlug(checklist.requirementName ?? checklist.spec.problem);
        const pagePath = local
          ? `${checklistPrefix}${slug}-${Date.now().toString(36)}.md`
          : `${pagePrefix}${buildRepoSlug(checklist.manifest.repo.localPath)}/checklists/${slug}-${Date.now().toString(36)}.md`;
        try {
          await deps.wiki.write(pagePath, body);
          deps.onChecklistSaved?.({ ref: pagePath, source: 'kb', checklist });
          return { ok: true, ref: pagePath, source: 'kb', repoPath: checklist.manifest.repo.localPath, ...swarmNext() } as unknown as JsonValue;
        } catch (err) {
          if (!isWikiError(err)) throw err;
          // KB 不可达 → 临时目录兜底
          const local = `${deps.tempDir()}/${session}-${Date.now().toString(36)}.md`;
          const { writeFileSync, mkdirSync } = await import('node:fs');
          mkdirSync(deps.tempDir(), { recursive: true });
          writeFileSync(local, body, 'utf8');
          deps.onChecklistSaved?.({ ref: local, source: 'temp', checklist });
          return { ok: true, ref: local, source: 'temp', repoPath: checklist.manifest.repo.localPath, ...swarmNext() } as unknown as JsonValue;
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
      async execute(args: { scope: string; repoPath?: string }, exec?: PrefetchExecContext) {
        const caller = deps.getCaller();
        if (caller.actor !== 'human') throw new Error('permission denied: planning_prefetch');
        const prompt = [
          '# 只读仓库预取（planning_prefetch）',
          `scope: ${args.scope}`,
          `目标仓库路径: ${args.repoPath ?? '(未指定，需你确认绝对路径)'}`,
          '规则：只读采集仓库事实（本地路径/远端 URL/当前分支/未提交改动/目标文件基线），禁止 git 写操作、禁止修改任何文件。',
          '输出：仅输出一个 JSON 对象（无前后缀文字），形如 {"repo":{"localPath":"<绝对路径>","remoteUrl":"<可选>","branch":"<可选>","dirtyFiles":[]},"files":[{"path":"<相对路径>","expected":"exists|absent|content-hash","note":"<可选>"}]}',
        ].join('\n');
        // 官方子代理缝要求 parent（血缘/模型继承/工作目录源）+ signal（取消通道），
        // 均由 agent loop 注入的 ToolRunContext 透传；测试直调无 exec → undefined（stub 不依赖）
        const output = deps.spawnPrefetch
          ? await deps.spawnPrefetch(prompt, args.repoPath ?? '', exec?.agent, exec?.signal)
          : (() => { throw new Error('planning_prefetch: spawnPrefetch not wired — main-session-tools 必须注入只读预取子代理'); })();
        const manifest = parseManifestOutput(output);
        return { ok: true, manifest } as unknown as JsonValue;
      },
    }),
    defineTool({
      name: 'planning_learning_save',
      description: 'Save a distilled learning (experience) to the knowledge base. Remote KB: scope=chain → projects/<repoSlug>/<chainId>/learnings/ (requirement-level); scope=project → projects/<repoSlug>/learnings/ (repo-level). repoSlug is derived from the chain workspaceDir; both scopes require chain.workspaceDir. Local KB: both scopes → wiki/synthesis/learnings/<chainId|repoSlug>/. Returns ref. Soft-fails {ok:false,reason:"kb-unreachable"} when KB is unreachable (no temp fallback).',
      parameters: {
        learning: { type: 'json', required: true, description: 'LearningEntry: { title (≤80 chars), lesson, evidence (mechanical chain/task id — required), tags: string[] — must include one of mistake/reusable/env-trap/collab-contract/efficiency (category criteria enforced) }' },
        scope: { type: 'string', enum: ['chain', 'project'], required: true, description: '"chain" (requirement-level) | "project" (repo-level)' },
        chainId: { type: 'string', required: true, description: 'The chain this learning is distilled from; must exist' },
      },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { learning: unknown; scope: 'chain' | 'project'; chainId: string }) {
        const caller = deps.getCaller();
        if (caller.actor !== 'human') throw new Error('permission denied: planning_learning_save');
        const errors = validateLearning(args.learning);
        if (errors.length > 0) throw new Error('invalid learning: ' + errors.join('; '));
        if (args.scope !== 'chain' && args.scope !== 'project') throw new Error('invalid scope: ' + String(args.scope));
        if (typeof args.chainId !== 'string' || !args.chainId.trim()) throw new Error('chainId required');
        const state = await deps.service.snapshot();
        const chain = state.chains.get(args.chainId);
        if (!chain) throw new Error('unknown chain: ' + args.chainId);
        const entry = args.learning as LearningEntry;
        // A 类硬复核（0.3.1）：mistake 标签须通过机械信号复核（累计 ≥2），不复信模型自报
        if (Array.isArray(entry.tags) && entry.tags.includes('mistake')) {
          const total = countLearningSignals(state, args.chainId);
          if (total < 2) throw new Error(`[mistake-gate] 标记 mistake 需链上 阻塞/返工/评审失败/审计警告 累计 ≥2 次，当前链累计 ${total} 次。请核对证据包；不满足时改用其他类别标签（reusable/env-trap/collab-contract/efficiency）或回复「无新经验」`);
        }
        let prefix: string;
        if (local) {
          // local：scope=chain 直接挂 chainId；scope=project 挂 repoSlug（需 workspaceDir）
          if (args.scope === 'chain') {
            prefix = `${LOCAL_LEARNING_BASE}${args.chainId}/`;
          } else {
            if (!chain.workspaceDir) throw new Error('scope=project requires chain.workspaceDir (target repo) — chain has none');
            prefix = `${LOCAL_LEARNING_BASE}${buildRepoSlug(chain.workspaceDir)}/`;
          }
        } else {
          // remote：两 scope 均要求 chain.workspaceDir，统一挂 projects/<repoSlug>/
          if (!chain.workspaceDir) throw new Error('learning save requires chain.workspaceDir (target repo) — chain has none');
          const wsRoot = `${pagePrefix}${buildRepoSlug(chain.workspaceDir)}/`;
          prefix = args.scope === 'chain' ? `${wsRoot}${args.chainId}/learnings/` : `${wsRoot}learnings/`;
        }
        const pagePath = `${prefix}${buildChecklistSlug(entry.title)}-${Date.now().toString(36)}.md`;
        try {
          await deps.wiki.write(pagePath, formatLearningBody(entry));
          return { ok: true, ref: pagePath, scope: args.scope } as unknown as JsonValue;
        } catch (err) {
          if (isWikiError(err)) return { ok: false, reason: 'kb-unreachable' } as unknown as JsonValue;
          throw err;
        }
      },
    }),
    defineTool({
      name: 'planning_memory_recall',
      description: 'Recall KB memory for planning. path mode: read a full page truncated to 8000 chars. path mode whitelist: remote = ' + KB_PAGE_NAMESPACES_HINT + '; local = any wiki/** relative path inside the local KB root. query mode: full-text search returning top 5 {path,title,score}. Returns {ok:false,reason:"kb-unreachable"} on KB failure; {ok:false,reason:"disabled"} when memory is disabled.',
      parameters: {
        path: { type: 'string', description: 'KB page path to read in full (mutually exclusive with query). remote mode: projects/ namespace path; local mode: wiki/** relative path inside the local KB root.' },
        query: { type: 'string', description: 'Full-text query; returns top 5 result paths (mutually exclusive with path)' },
      },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { path?: string; query?: string }) {
        const caller = deps.getCaller();
        if (caller.actor !== 'human') throw new Error('permission denied: planning_memory_recall');
        if (deps.memoryEnabled === false) return { ok: false, reason: 'disabled' } as unknown as JsonValue;
        const hasPath = typeof args.path === 'string' && args.path.trim().length > 0;
        const hasQuery = typeof args.query === 'string' && args.query.trim().length > 0;
        if (hasPath === hasQuery) throw new Error('provide exactly one of path|query');
        if (hasPath) {
          // path 白名单按 KB 双模式分支：remote → projects/** 命名空间；local → wiki/**（
          // local 的 checklist/learning 全落 wiki/ 前缀，用 projects/ 白名单会把 local 读腿全拒）
          if (local) assertLocalKbPagePath(args.path as string);
          else assertAllowedWikiPagePath(args.path as string);
          try {
            const d = await deps.wiki.read(args.path as string);
            const content = d.rawMd.length > 8000 ? d.rawMd.slice(0, 8000) + '…' : d.rawMd;
            return { ok: true, path: args.path, content } as unknown as JsonValue;
          } catch (err) {
            if (isWikiError(err)) return { ok: false, reason: 'kb-unreachable' } as unknown as JsonValue;
            throw err;
          }
        }
        try {
          const results = (await deps.wiki.search(args.query as string)).slice(0, 5).map((r) => ({ path: r.path, title: r.title, score: r.score }));
          return { ok: true, results } as unknown as JsonValue;
        } catch (err) {
          if (isWikiError(err)) return { ok: false, reason: 'kb-unreachable' } as unknown as JsonValue;
          throw err;
        }
      },
    }),
  ];
}

function parseManifestOutput(output: string): PrefetchManifest {
  const text = output.trim();
  const jsonText = text.startsWith('{') ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error('planning_prefetch: sub-agent did not return valid JSON manifest');
  }
  const errors = validatePrefetchManifest(raw);
  if (errors.length > 0) throw new Error('planning_prefetch: invalid manifest from sub-agent: ' + errors.join('; '));
  return raw as PrefetchManifest;
}
