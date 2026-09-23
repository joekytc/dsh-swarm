import { defineTool } from '@deepseek-ai/dsh-tools';
import {} from '@deepseek-ai/dsh-util-values';
import { KanbanService } from '../domain/kanban-service.js';
import { can } from '../domain/permissions.js';
function guard(action, caller) {
    if (!can(action, caller.actor, null))
        throw new Error('permission denied: ' + action);
}
/** 逐字段校验 spec card sections：数组进 string 段（如 testing）会在下游 .trim() 崩溃；
 *  非对象（双重编码字符串）先报真因，不产生六字段误导性 undefined 墙。 */
function validateSections(sections) {
    const errors = [];
    if (sections !== undefined && (typeof sections !== 'object' || Array.isArray(sections))) {
        return [`sections must be a JSON object (got ${Array.isArray(sections) ? 'array' : typeof sections}) — pass the object itself, never a JSON-encoded string`];
    }
    const s = (sections ?? {});
    const strFields = [
        ['problem', 'problem'], ['solution', 'solution'], ['testing', 'testing'], ['out_of_scope', 'out_of_scope'],
    ];
    for (const [, key] of strFields) {
        if (typeof s[key] !== 'string')
            errors.push(`sections.${key} must be a string (got: ${JSON.stringify(s[key])})`);
    }
    const arrFields = [['user_stories', 'user_stories'], ['impl_decisions', 'impl_decisions']];
    for (const [, key] of arrFields) {
        if (!Array.isArray(s[key]))
            errors.push(`sections.${key} must be an array`);
        else if (s[key].some((v) => typeof v !== 'string'))
            errors.push(`sections.${key} must be string[]`);
    }
    return errors;
}
/** 规格卡工具工厂：主会话（human）专属——编辑/批准仅 human；查看任意角色可读。 */
export function buildSpecCardTools(service, getCaller) {
    return [
        defineTool({
            name: 'spec_card_view',
            description: 'View a spec card (draft or approved).',
            parameters: { cardId: { type: 'string', required: true, description: 'Spec card id (sc_xxx)' } },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
            async execute(args) {
                const state = await service.snapshot();
                const card = state.specCards.get(args.cardId);
                if (!card)
                    throw new Error('unknown spec card: ' + args.cardId);
                return card;
            },
        }),
        defineTool({
            name: 'spec_card_edit',
            description: 'Edit a draft spec card sections (human only).',
            parameters: {
                cardId: { type: 'string', required: true },
                // 官方 object schema（2026-09-21）：{type:'json'} 不约束，双重编码字符串穿透 validateSections
                // 产出六字段误导性 undefined 墙；open object 运行时拦字符串。
                sections: { type: 'object', required: true, additionalProperties: true, description: 'Six-section spec card body (object with problem/solution/testing/out_of_scope strings + user_stories/impl_decisions string arrays). Pass the object itself — never a JSON-encoded string.' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
            async execute(args) {
                const errs = validateSections(args.sections);
                if (errs.length > 0)
                    throw new Error('invalid spec card sections: ' + errs.join('; '));
                const caller = getCaller();
                guard('spec-edit', caller);
                const card = await service.editSpecCard(args.cardId, args.sections, caller.actor);
                return card;
            },
        }),
        defineTool({
            name: 'spec_card_approve',
            description: 'Approve a spec card and move its chain to executing (human only).',
            parameters: { cardId: { type: 'string', required: true } },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
            async execute(args) {
                const caller = getCaller();
                guard('spec-approve', caller);
                const card = await service.approveSpecCard(args.cardId, caller.actor);
                return card;
            },
        }),
    ];
}
