import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import type { KanbanConfig } from '../config.js';
import { KanbanProvider } from '../services/kanban-provider.js';
import { buildKanbanTools } from './kanban-tools.js';
import { buildSpecCardTools } from './spec-card-tools.js';
import { handlePlanRoute } from '../routes/prefix-router.js';
import { approveIfReady, MATTPOCOCK_PLANNING_GUIDANCE } from '../routes/planning-driver.js';

/** 主会话最近一次 /plan: 路由创建的链路（供 /openspec: 路由定位规格卡，P1-5 主会话经路由建卡）。 */
const lastPlan: Map<string, { chainId: string; specCardId: string }> = new Map();

/** 主 agent 看板工作流铁律：路由后只做规划/汇报，禁止自己执行任务，等 V 派单。 */
const KANBAN_HANDOFF_RULE = `
## 主 agent 铁律（看板工作流）
- 你只负责阶段 0 规划对话（/plan: 后）与最终收尾汇报（W3 完成后）。
- 禁止用 bash/fs/write/edit 等工具执行任务本身（改代码、建分支、推送等）。
- /plan: 路由后：只做 mattpocock 澄清，等待 V 编排 agent 在看板建卡派单；不要自己实现。
- /openspec: 批准后：链路进入 executing，V 会自动按 R20 建卡并调度 P/W/D 角色 agent；你不要自己执行。
- 用 kanban_show / kanban_list 观察进度，等链完成后向用户汇报产物链接与轨迹入口。
`;

/** P1-3 主会话工具面：spec_card_view/edit/approve + kanban 只读子集（show/list/comment）+ 前缀路由工具。
 *  主会话无 kanban_create/complete/block（防越权：主会话建卡走 /plan: 路由或 GUI）。 */
export function registerMainSessionTools(ctx: Context, config: KanbanConfig): void {
  const registry = ctx.get('tools') as { register(def: unknown): () => void } | undefined;
  if (!registry) return; // 测试裸 Context 无 tools 服务（P1-9 无 inject 依赖），跳过注册
  const provider = ctx.get('kanban') as KanbanProvider | undefined;
  if (!provider) return;
  const service = provider.service;
  const caller = () => ({ actor: 'human' as const });

  const readOnly = new Set(['kanban_show', 'kanban_list', 'kanban_comment']);
  for (const tool of buildKanbanTools(service, caller)) {
    const name = (tool as { name?: string }).name;
    if (name && readOnly.has(name)) registry.register(tool);
  }
  for (const tool of buildSpecCardTools(service, caller)) registry.register(tool);

  registry.register(defineTool({
    name: 'kanban_route',
    description: 'MUST be called when the human message starts with the custom prefix /plan: or /openspec: (trailing colon included). This is dsh-kanban planning, NOT the built-in /plan plan mode. Do not enter plan mode for these prefixes; route them here.',
    parameters: {
      message: { type: 'string', required: true, description: 'Full user message starting with /plan: or /openspec:' },
      chainId: { type: 'string', description: 'Chain id for /openspec: (optional; defaults to the last /plan: chain of this session)' },
      specCardId: { type: 'string', description: 'Spec card id for /openspec: (optional; defaults to the last /plan: card)' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args: { message: string; chainId?: string; specCardId?: string }) {
      const route = await handlePlanRoute(args.message, service, config.prefixRoutes, 'session_main');
      if (route.kind === 'plan') {
        lastPlan.set('session_main', { chainId: route.chainId!, specCardId: route.specCardId! });
        return { kind: 'plan', chainId: route.chainId, specCardId: route.specCardId, guidance: MATTPOCOCK_PLANNING_GUIDANCE + KANBAN_HANDOFF_RULE } as unknown as JsonValue;
      }
      const plan = lastPlan.get('session_main');
      const chainId = args.chainId ?? plan?.chainId;
      const cardId = args.specCardId ?? plan?.specCardId;
      if (!chainId || !cardId) return { kind: 'none' } as unknown as JsonValue;
      const r = await approveIfReady(args.message, service, config.prefixRoutes, chainId, cardId);
      if (r.ok) return { kind: 'openspec', chainId, specCardId: cardId, approved: true, guidance: KANBAN_HANDOFF_RULE } as unknown as JsonValue;
      return { kind: 'openspec', chainId, specCardId: cardId, approved: false, missing: r.missing, guidance: r.guidance } as unknown as JsonValue;
    },
  }));
  console.info('[dsh-kanban] main-session tools registered (kanban_route + spec/read-only)');
}
