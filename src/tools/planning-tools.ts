// src/tools/planning-tools.ts
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { KanbanService } from '../domain/kanban-service.js';
import type { WikiVaultClient, WikiError } from '../wiki/wiki-vault-client.js';
import { validatePlanningChecklist, formatChecklistBody, type PlanningChecklist } from '../domain/planning-checklist.js';
import { validatePrefetchManifest, type PrefetchManifest } from '../domain/prefetch-manifest.js';
import { buildChecklistSlug, CHECKLIST_PAGE_PREFIX } from '../wiki/page-path.js';
import type { ToolCaller } from './kanban-tools.js';
import type { AgentModelOptions } from '../dispatcher/dispatcher.js';

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
  ownerSessionId?: string;
  defaultModel?: AgentModelOptions;
  /** 清单落库成功回调（kb 与 temp 两分支各调一次），供 main-session-tools 回写 planningBySession。 */
  onChecklistSaved?(saved: { ref: string; source: 'kb' | 'temp'; checklist: PlanningChecklist }): void;
}

const isWikiError = (e: unknown): e is WikiError =>
  e instanceof Error && (e as { code?: string }).code === 'kb-unreachable';

/** 主 agent 规划期工具：需求澄清清单落库（KB 优先/临时目录兜底）+ 只读仓库预取（子代理）。 */
export function buildPlanningTools(deps: PlanningToolDeps) {
  const pagePrefix = deps.pagePrefix ?? 'projects/';
  const session = deps.ownerSessionId ?? 'session_main';

  return [
    defineTool({
      name: 'planning_checklist_save',
      description: 'Save the converged requirement-clarification checklist (structured schema) to KB, falling back to a temp dir if KB is unreachable. Returns ref/path + authoritative repo path. restoreRef (optional) = existing KB page path to overwrite in place (recovery path when in-memory context was lost); omit for first-time save (creates a new timestamped page).',
      parameters: { checklist: { type: 'json', required: true, description: 'Structured PlanningChecklist: spec six sections + manifest(repo.files) + clarifications + doubts. checklist.requirementName (optional) = /plan: rest first sentence, used for the checklist page title 【需求】, same source as the task-card title' }, restoreRef: { type: 'string', description: 'Optional KB page path to overwrite in place (recovery path); omit for new save' } },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { checklist: unknown; restoreRef?: string }) {
        const caller = deps.getCaller();
        if (caller.actor !== 'human') throw new Error('permission denied: planning_checklist_save');
        const errors = validatePlanningChecklist(args.checklist);
        if (errors.length > 0) throw new Error('invalid planning checklist: ' + errors.join('; '));
        const checklist = args.checklist as PlanningChecklist;
        const body = formatChecklistBody(checklist);
        // 恢复路径（内存丢失后重建）：传 restoreRef 则覆盖原页，不产生重复页
        if (args.restoreRef && args.restoreRef.startsWith(pagePrefix)) {
          try {
            await deps.wiki.write(args.restoreRef, body);
            deps.onChecklistSaved?.({ ref: args.restoreRef, source: 'kb', checklist });
            return { ok: true, ref: args.restoreRef, source: 'kb', repoPath: checklist.manifest.repo.localPath } as unknown as JsonValue;
          } catch (err) {
            if (!isWikiError(err)) throw err;
            // KB 不可达 → 落临时目录兜底（不覆盖原页），回调仍回填内存
          }
        }
        const pagePath = `${CHECKLIST_PAGE_PREFIX}${buildChecklistSlug(checklist.requirementName ?? checklist.spec.problem)}-${Date.now().toString(36)}.md`;
        try {
          await deps.wiki.write(pagePath, body);
          deps.onChecklistSaved?.({ ref: pagePath, source: 'kb', checklist });
          return { ok: true, ref: pagePath, source: 'kb', repoPath: checklist.manifest.repo.localPath } as unknown as JsonValue;
        } catch (err) {
          if (!isWikiError(err)) throw err;
          // KB 不可达 → 临时目录兜底
          const local = `${deps.tempDir()}/${session}-${Date.now().toString(36)}.md`;
          const { writeFileSync, mkdirSync } = await import('node:fs');
          mkdirSync(deps.tempDir(), { recursive: true });
          writeFileSync(local, body, 'utf8');
          deps.onChecklistSaved?.({ ref: local, source: 'temp', checklist });
          return { ok: true, ref: local, source: 'temp', repoPath: checklist.manifest.repo.localPath } as unknown as JsonValue;
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
