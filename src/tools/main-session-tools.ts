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
    description: 'Route /plan: and /openspec: messages into the kanban planning pipeline (human main session).',
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
        return { kind: 'plan', chainId: route.chainId, specCardId: route.specCardId, guidance: MATTPOCOCK_PLANNING_GUIDANCE } as unknown as JsonValue;
      }
      const plan = lastPlan.get('session_main');
      const chainId = args.chainId ?? plan?.chainId;
      const cardId = args.specCardId ?? plan?.specCardId;
      if (!chainId || !cardId) return { kind: 'none' } as unknown as JsonValue;
      const r = await approveIfReady(args.message, service, config.prefixRoutes, chainId, cardId);
      if (r.ok) return { kind: 'openspec', chainId, specCardId: cardId, approved: true } as unknown as JsonValue;
      return { kind: 'openspec', chainId, specCardId: cardId, approved: false, missing: r.missing, guidance: r.guidance } as unknown as JsonValue;
    },
  }));
}