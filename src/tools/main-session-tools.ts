import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { KanbanConfig } from '../config.js';
import { KanbanProvider } from '../services/kanban-provider.js';
import { buildKanbanTools } from './kanban-tools.js';
import { buildSpecCardTools } from './spec-card-tools.js';
import { buildPlanningTools, type PlanningToolDeps } from './planning-tools.js';
import { handlePlanRoute, handleOpenspecRoute, type OpenspecPlanningInput } from '../routes/prefix-router.js';
import { MATTPOCOCK_PLANNING_GUIDANCE } from '../routes/planning-driver.js';
import { attachSessionToWorkspace, resolveOrCreateWorkspace } from '../dispatcher/workspace-attach.js';
import { PREFETCH_MANIFEST_SCHEMA } from '../domain/prefetch-manifest.js';
import type { PlanningChecklist } from '../domain/planning-checklist.js';
import { WikiVaultClient } from '../wiki/wiki-vault-client.js';

/** v2 规划上下文（/plan: 捕获 → planning_checklist_save 回写 → /openspec: 建链）。模块级内存，随插件进程存活。 */
export interface PlanningContext {
  workspaceDir: string | null;
  sessionId: string;
  checklist: PlanningChecklist | null;
  checklistRef: string | null;
  checklistSource: 'kb' | 'temp' | null;
  /** T7：/plan: rest 原始需求描述（建链默认标题来源，优先级最高）。 */
  requirementName: string | null;
}
export const planningBySession = new Map<string, PlanningContext>();

const KANBAN_HANDOFF_RULE = `
## 主 agent 铁律（看板工作流 v2）
- 你是计划者：只做需求澄清（grill-me）与最终收尾汇报；绝不执行任务本身。
- 最高护栏：只读仓库——禁止 git 操作、禁止 write/edit 任何仓库源码；只允许写 KB（planning_checklist_save）与临时目录兜底。
- 澄清期：调 planning_prefetch（只读子代理）采集仓库事实 → 逐问用户收敛 → 调 planning_checklist_save 存需求澄清清单 → 提醒用户 /openspec: 确认。
- /openspec: 后链路进入 executing，V 自动串行建卡 p→(pt)→w2→d→dt→w3；你不要自己执行。
- 用 kanban_show / kanban_list / spec_card_view 观察进度，链完成后向用户汇报产物链接与轨迹入口。
`;

// 清单获取只有两条路：内存（路由1）> KB 候选页（路由2，LLM 读页重建）。禁止编造其他原因
// （"先重试 / 查服务进程是否重启"类诊断是噪声：内存丢失唯一成因是插件重启，重启后按两条路恢复即可）。
const RECOVERY_KB_GUIDANCE = (candidates: string[]) => `
插件内存中的需求澄清清单已丢失（插件进程重启所致，属预期情况，按两条获取路由恢复即可，勿猜测其他原因）。
知识库中检索到候选清单页：
${candidates.map((c) => '- ' + c).join('\n')}
恢复步骤（严格顺序）：
1. 读取候选页内容，对照当前需求判定哪一页是本次需求的需求澄清清单（页首行标题为「# 【需求】<需求名>」）；
2. 消化该页内容，重建结构化 PlanningChecklist（spec 六段 + manifest + clarifications + doubts，requirementName 取页标题中【需求】后的名称）；
3. 调 planning_checklist_save(checklist, restoreRef=<该候选页路径>) 回存（覆盖原页，勿产生重复页）；
4. 回存成功后提示用户重新发送 /openspec: 确认。
禁止：跳过恢复直接建链建卡；猜测清单内容；把恢复失败归因于"重试/进程检查"之外的任何原因。
`;
const RECOVERY_NONE_GUIDANCE = `
两条获取路由均无本需求的需求澄清清单（内存为空，知识库亦无匹配页）。
处理步骤（严格顺序）：
1. 消化当前对话上下文，判断需求澄清（grill-me 逐问收敛 + planning_prefetch 仓库事实）是否已完成但漏了保存动作；
2. 若已完成澄清——立即调 planning_checklist_save 保存清单；若尚未完成——先完成澄清（缺仓库事实则先 planning_prefetch），再保存；
3. 保存成功后提示用户重新发送 /openspec: 确认。
禁止：在清单落库前建链建卡；编造"先重试 / 查服务进程是否重启"之类与清单无关的诊断。
`;

/** 只读预取子代理：经官方子代理缝 `ctx.subagents.start('spawn', ...)` 启动（对齐 2026-08-26-workspace-grouping Future Work）。
 *  缝契约：血缘（parentSession/origin/delegationDepth）、父模型继承（修复 `{{model}}` 变量缺失）、
 *  approval never、toolFilter（deny bash/edit/write = 只读可见性+执行双拒）、outputSchema（seam 侧强制
 *  结构化校验）、maxDepth:1（禁止子代理再派子代理）；run.dispose() 于 finally 回收。
 *  工具面收窄由缝的 toolFilter 承担，不再自建 agents.create + 手动只读 guard。 */
interface SubagentRunLike {
  id: string;
  result: Promise<{ stopReason: string; output: Array<{ type: string; text?: string }>; structured?: unknown; error?: string }>;
  dispose(): Promise<void>;
}
interface SubagentRuntimeLike {
  start(name: string, request: unknown): Promise<SubagentRunLike>;
}

/** 预取子代理禁用的写能力工具（官方全局工具名；deny = 从 prompt 消失 + 拒绝执行，"one visibility"）。 */
const PREFETCH_DENIED_TOOLS = ['bash', 'edit', 'write'] as const;

export function buildSpawnPrefetch(ctx: Context): PlanningToolDeps['spawnPrefetch'] | undefined {
  const subagents = ctx.get('subagents') as SubagentRuntimeLike | undefined;
  if (!subagents?.start) return undefined;
  return async (prompt, workspaceDir, parentAgent, signal) => {
    // 血缘源必须由 agent loop 经 ToolRunContext 透传（planning_prefetch exec.agent）；
    // 无 parent 说明工具面接线缺失，快速失败而非静默退化为无血缘会话。
    if (!parentAgent) throw new Error('planning_prefetch: missing parent agent — 工具运行时未注入 exec.agent');
    const cwd = workspaceDir || process.cwd();
    let run: SubagentRunLike;
    try {
      run = await subagents.start('spawn', {
        label: 'prefetch',
        prompt: [{ type: 'text', text: prompt }],
        parent: parentAgent as Agent,
        signal: signal ?? new AbortController().signal,
        maxDepth: 1,
        toolFilter: { deny: [...PREFETCH_DENIED_TOOLS] },
        outputSchema: PREFETCH_MANIFEST_SCHEMA,
      });
    } catch (err) {
      throw new Error('planning_prefetch: subagent start failed: ' + String(err));
    }
    try {
      // 归组：缝生成的子会话（run.id = 子 session id）attach 到 cwd 对应工作区（失败不阻断只读采集）
      await attachSessionToWorkspace(ctx, run.id, cwd, 'prefetch');
      const result = await run.result;
      // fail-fast：非 completed 终止（error/cancelled/...）抛错带诊断，不做静默兜底
      if (result.stopReason !== 'completed') {
        throw new Error(`planning_prefetch: subagent ended with stopReason=${result.stopReason}${result.error ? ' — ' + result.error : ''}`);
      }
      // outputSchema 由 spawn provider 在子代理侧强制校验；structured 合法即用，文本兜底仅作能力缺失防御
      if (result.structured !== undefined) return JSON.stringify(result.structured);
      return (result.output ?? []).map((b) => b.text ?? '').join('');
    } finally {
      await run.dispose().catch(() => undefined);
    }
  };
}

/** v2 主会话工具面：/plan: 捕获规划上下文（零副作用）→ planning_checklist_save 回写 → /openspec: 用清单建链。
 *  工具面 = kanban_route + 只读 kanban 子集 + spec_card_view + planning 工具；
 *  无 spec_card_edit/approve、无 kanban_create/complete/block（主会话越权写由工具面裁剪 + prefetch 子代理只读护栏双保险）。 */
export function registerMainSessionTools(ctx: Context, config: KanbanConfig): void {
  const registry = ctx.get('tools') as { register(def: unknown): () => void } | undefined;
  if (!registry) return; // 测试裸 Context 无 tools 服务（P1-9 无 inject 依赖），跳过注册
  const provider = ctx.get('kanban') as KanbanProvider | undefined;
  if (!provider) return;
  const service = provider.service;
  // 生产 wiring（src/index.ts:44）仅保证 tools+kanban 可用，无 wiki 服务 → 用 config.wikiVault 自建
  //（与 dispatcher 构造同源）；测试经 ctx.get('wiki') 注入 mock 客户端。
  const wiki = (ctx.get('wiki') as WikiVaultClient | undefined) ?? new WikiVaultClient(config.wikiVault);
  const caller = () => ({ actor: 'human' as const });

  // 只读 kanban 子集（无 create/complete/block）
  const readOnly = new Set(['kanban_show', 'kanban_list', 'kanban_comment']);
  for (const tool of buildKanbanTools(service, caller)) {
    const name = (tool as { name?: string }).name;
    if (name && readOnly.has(name)) registry.register(tool);
  }
  // spec_card_view 仅保留（主 agent 只读规格卡；编辑/批准经清单→/openspec: 建链，GUI 走 HTTP 桥）
  for (const tool of buildSpecCardTools(service, caller)) {
    if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
  }
  // planning 工具（清单落库 + 只读预取）——spawnPrefetch 由模块级 buildSpawnPrefetch 提供（可单测）

  for (const tool of buildPlanningTools({
    service, wiki,
    getCaller: caller,
    spawnPrefetch: buildSpawnPrefetch(ctx),
    tempDir: () => (config.storageDir ?? '$DSH_HOME/storages/kanban').replace('$DSH_HOME', process.env.DSH_HOME ?? process.cwd()) + '/checklists',
    pagePrefix: config.wikiVault?.pagePrefix ?? 'projects/', // 生成的清单页路径保持在该客户端配置的命名空间内（避免 kb-rejected）
    ownerSessionId: 'session_main',
    onChecklistSaved({ ref, source, checklist }) {
      const cur = planningBySession.get('session_main') ?? { workspaceDir: null, sessionId: 'session_main', checklist: null, checklistRef: null, checklistSource: null, requirementName: null };
      planningBySession.set('session_main', { ...cur, checklist, checklistRef: ref, checklistSource: source });
    },
  })) registry.register(tool);

  // kanban_route：/plan: 捕获规划上下文；/openspec: 用清单建链
  registry.register(defineTool({
    name: 'kanban_route',
    description: 'MUST be called when the human message starts with /plan: or /openspec:. This is dsh-swarm planning, NOT the built-in /plan plan mode. /plan: = zero side-effect + start grill-me; /openspec: = create chain from saved checklist and start execution.',
    parameters: { message: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args: { message: string }, exec?: { agent?: { session?: { header?: { cwd?: string } } } }) {
      // M2(Q5)+归组：仅 /plan: 分支捕获主 agent 工作空间并可能询问注册——/openspec:/none 不触发，
      // 避免死代码副作用多弹一次 ask（/openspec: 实际用的是 planningBySession 已存的 workspaceDir）。
      // header.cwd 缺失或未注册时询问用户注册工作区；仍不可得保持 null（链任务随后 block 'workspace-unknown'）。
      const plan = await handlePlanRoute(args.message, service, config.prefixRoutes, 'session_main');
      if (plan.kind === 'plan') {
        const headerCwd = exec?.agent?.session?.header?.cwd ?? null;
        const workspaceDir = await resolveOrCreateWorkspace(ctx, headerCwd, '主 agent 会话');
        planningBySession.set('session_main', { workspaceDir, sessionId: 'session_main', checklist: null, checklistRef: null, checklistSource: null, requirementName: plan.rest });
        return { kind: 'plan', guidance: MATTPOCOCK_PLANNING_GUIDANCE + KANBAN_HANDOFF_RULE } as unknown as JsonValue;
      }
      if (plan.kind === 'none') return { kind: 'none' } as unknown as JsonValue;
      // 路由1（内存）：planningBySession 命中 → 直接建链
      const pctx = planningBySession.get('session_main');
      if (pctx?.checklist && pctx.checklistRef) {
        const input: OpenspecPlanningInput = { workspaceDir: pctx.workspaceDir, checklist: pctx.checklist, checklistRef: pctx.checklistRef, requirementName: pctx.requirementName };
        const r = await handleOpenspecRoute(args.message, service, config.prefixRoutes, input, 'session_main');
        return { kind: 'openspec', chainId: r.chainId, specCardId: r.specCardId, approved: true, guidance: KANBAN_HANDOFF_RULE } as unknown as JsonValue;
      }
      // 路由2（知识库）：内存丢失（插件重启）→ 搜 KB 候选清单页供 LLM 读页重建；搜不到/不可达 → 两条路皆空
      let candidates: string[] = [];
      try {
        const pagePrefix = config.wikiVault?.pagePrefix ?? 'projects/';
        candidates = (await wiki.search('【需求】')).map((r) => r.path).filter((p) => p.startsWith(pagePrefix)).slice(0, 5);
      } catch { /* KB 不可达/搜索失败 → 候选为空，走两条路皆空分支 */ }
      return {
        kind: 'openspec', approved: false, reason: 'no-checklist',
        recovery: candidates.length > 0 ? 'kb' : 'none',
        checklistCandidates: candidates,
        guidance: candidates.length > 0 ? RECOVERY_KB_GUIDANCE(candidates) : RECOVERY_NONE_GUIDANCE,
      } as unknown as JsonValue;
    },
  }));
  console.info('[dsh-swarm] main-session tools registered (v2: kanban_route + planning + spec view + read-only kanban)');
}
