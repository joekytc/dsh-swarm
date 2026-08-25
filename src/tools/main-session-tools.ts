import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import type { KanbanConfig } from '../config.js';
import { KanbanProvider } from '../services/kanban-provider.js';
import { buildKanbanTools } from './kanban-tools.js';
import { buildSpecCardTools } from './spec-card-tools.js';
import { buildPlanningTools, type PlanningToolDeps } from './planning-tools.js';
import { handlePlanRoute, handleOpenspecRoute, type OpenspecPlanningInput } from '../routes/prefix-router.js';
import { MATTPOCOCK_PLANNING_GUIDANCE } from '../routes/planning-driver.js';
import { buildReadOnlyWriteGuard } from '../roles/toolsets.js';
import type { PlanningChecklist } from '../domain/planning-checklist.js';
import { WikiVaultClient } from '../wiki/wiki-vault-client.js';

/** v2 规划上下文（/plan: 捕获 → planning_checklist_save 回写 → /openspec: 建链）。模块级内存，随插件进程存活。 */
export interface PlanningContext {
  workspaceDir: string | null;
  sessionId: string;
  checklist: PlanningChecklist | null;
  checklistRef: string | null;
  checklistSource: 'kb' | 'temp' | null;
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
  // planning 工具（清单落库 + 只读预取）
  const agents = (ctx.get('agents') as { create(o: unknown): Promise<{ agent: unknown }> } | undefined);
  const spawnPrefetch: PlanningToolDeps['spawnPrefetch'] = agents
    ? async (prompt, workspaceDir) => {
        const h = await agents.create({
          sessionId: `kbn-prefetch-${Date.now().toString(36)}`,
          meta: { cwd: workspaceDir || process.cwd() },
          setup: async (agentCtx: Context) => {
            const session = (agentCtx as unknown as { agent?: { session?: { append?(k: string, v: unknown): void } } }).agent?.session;
            session?.append?.('approval/policy', { policy: 'never', source: 'delegation' });
            session?.append?.('sandbox/mode', { mode: 'workspace-write', source: 'delegation' });
            // 只读护栏：拦截仓库写入/git mutation
            const toolsSvc = (agentCtx as { tools?: { guard?: (g: (e: unknown) => string | undefined) => unknown } }).tools;
            const repoRoot = workspaceDir || '/';
            toolsSvc?.guard?.((e: unknown) => buildReadOnlyWriteGuard(repoRoot)(e as { name?: string; arguments?: unknown }));
          },
        });
        // 假实现以会话事件读取返回；真实实现以 agent 最终文本为准（Task 11 重启+运行时验证时替换）
        const a = h.agent as { followup?(msg: unknown): void; whenIdle?(): Promise<void>; run?(msg: unknown): Promise<unknown> };
        if (typeof a.run === 'function') {
          const res = await a.run({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } });
          return String((res as { text?: string })?.text ?? res);
        }
        a.followup?.({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } });
        await a.whenIdle?.();
        return '';
      }
    : undefined;

  for (const tool of buildPlanningTools({
    service, wiki,
    getCaller: caller,
    spawnPrefetch,
    tempDir: () => (config.storageDir ?? '$DSH_HOME/storages/kanban').replace('$DSH_HOME', process.env.DSH_HOME ?? process.cwd()) + '/checklists',
    pagePrefix: config.wikiVault?.pagePrefix ?? 'projects/', // 生成的清单页路径保持在该客户端配置的命名空间内（避免 kb-rejected）
    ownerSessionId: 'session_main',
    onChecklistSaved({ ref, source, checklist }) {
      const cur = planningBySession.get('session_main') ?? { workspaceDir: null, sessionId: 'session_main', checklist: null, checklistRef: null, checklistSource: null };
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
      const workspaceDir = exec?.agent?.session?.header?.cwd ?? null;
      const plan = await handlePlanRoute(args.message, service, config.prefixRoutes, 'session_main');
      if (plan.kind === 'plan') {
        planningBySession.set('session_main', { workspaceDir, sessionId: 'session_main', checklist: null, checklistRef: null, checklistSource: null });
        return { kind: 'plan', guidance: MATTPOCOCK_PLANNING_GUIDANCE + KANBAN_HANDOFF_RULE } as unknown as JsonValue;
      }
      const pctx = planningBySession.get('session_main');
      if (!pctx || !pctx.checklist || !pctx.checklistRef) {
        return { kind: 'openspec', approved: false, reason: 'no-checklist', guidance: '尚未保存需求澄清清单：请先调 planning_prefetch 采集仓库事实、完成 grill-me 澄清后，调 planning_checklist_save 保存清单，再发 /openspec: 确认。' + MATTPOCOCK_PLANNING_GUIDANCE } as unknown as JsonValue;
      }
      const input: OpenspecPlanningInput = { workspaceDir: pctx.workspaceDir, checklist: pctx.checklist, checklistRef: pctx.checklistRef };
      const r = await handleOpenspecRoute(args.message, service, config.prefixRoutes, input, 'session_main');
      return { kind: 'openspec', chainId: r.chainId, specCardId: r.specCardId, approved: true, guidance: KANBAN_HANDOFF_RULE } as unknown as JsonValue;
    },
  }));
  console.info('[dsh-swarm] main-session tools registered (v2: kanban_route + planning + spec view + read-only kanban)');
}
