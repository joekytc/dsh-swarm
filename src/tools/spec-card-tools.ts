import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import { KanbanService } from '../domain/kanban-service.js';
import { can } from '../domain/permissions.js';
import type { SpecCardSections } from '../domain/types.js';
import type { ToolCaller } from './kanban-tools.js';

function guard(action: Parameters<typeof can>[0], caller: ToolCaller) {
  if (!can(action, caller.actor, null)) throw new Error('permission denied: ' + action);
}

/** 规格卡工具工厂：主会话（human）专属——编辑/批准仅 human；查看任意角色可读。 */
export function buildSpecCardTools(service: KanbanService, getCaller: () => ToolCaller) {
  return [
    defineTool({
      name: 'spec_card_view',
      description: 'View a spec card (draft or approved).',
      parameters: { cardId: { type: 'string', required: true, description: 'Spec card id (sc_xxx)' } },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { cardId: string }) {
        const state = await service.snapshot();
        const card = state.specCards.get(args.cardId);
        if (!card) throw new Error('unknown spec card: ' + args.cardId);
        return card as unknown as JsonValue;
      },
    }),
    defineTool({
      name: 'spec_card_edit',
      description: 'Edit a draft spec card sections (human only).',
      parameters: {
        cardId: { type: 'string', required: true },
        sections: { type: 'json', required: true, description: 'Six-section spec card body' },
      },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { cardId: string; sections: JsonValue }) {
        const caller = getCaller();
        guard('spec-edit', caller);
        const card = await service.editSpecCard(args.cardId, args.sections as unknown as SpecCardSections, caller.actor);
        return card as unknown as JsonValue;
      },
    }),
    defineTool({
      name: 'spec_card_approve',
      description: 'Approve a spec card and move its chain to executing (human only).',
      parameters: { cardId: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { cardId: string }) {
        const caller = getCaller();
        guard('spec-approve', caller);
        const card = await service.approveSpecCard(args.cardId, caller.actor);
        return card as unknown as JsonValue;
      },
    }),
  ];
}
