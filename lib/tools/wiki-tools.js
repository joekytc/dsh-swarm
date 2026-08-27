import { defineTool } from '@deepseek-ai/dsh-tools';
import { can } from '../domain/permissions.js';
import { assertAllowedWikiPagePath } from '../wiki/page-path.js';
function guard(action, caller) {
    if (!can(action, caller.actor, null))
        throw new Error('permission denied: ' + action);
}
/** wiki-vault 工具工厂（W 角色 agent scope）：search/read/write，权限兜底 wiki-read=w/d、wiki-write=w。 */
export function buildWikiTools(wiki, getCaller) {
    return [
        defineTool({
            name: 'wiki_search',
            description: 'Search the wiki-vault knowledge base.',
            parameters: { q: { type: 'string', required: true } },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
            async execute(args) {
                const caller = getCaller();
                guard('wiki-read', caller);
                const results = await wiki.search(args.q);
                return results;
            },
        }),
        defineTool({
            name: 'wiki_read',
            description: 'Read a wiki-vault page (read-only KB access).',
            parameters: { pagePath: { type: 'string', required: true } },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
            async execute(args) {
                const caller = getCaller();
                guard('wiki-read', caller);
                const page = await wiki.read(args.pagePath);
                return page;
            },
        }),
        defineTool({
            name: 'wiki_write',
            description: 'Write a wiki-vault page under the configured pagePrefix (W only).',
            parameters: {
                pagePath: { type: 'string', required: true },
                content: { type: 'string', required: true },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
            async execute(args) {
                const caller = getCaller();
                guard('wiki-write', caller);
                // Q3&5：工具边界强校验——只允许 projects/checklists/、projects/ch_*/t_*.md、projects/ch_*/review/
                // 三类命名空间（page-path.ts 白名单），杜绝 LLM 自造路径/拼错层级导致 kb_url 无法跳转。
                assertAllowedWikiPagePath(args.pagePath);
                const out = await wiki.write(args.pagePath, args.content);
                // Q4：工具直接拼完整 kb_url（host 用 config.wikiVault.baseUrl，杜绝 LLM 手写错域名）。
                // W 角色交付闸（kanban_complete w:kb）同时校验 host 前缀，双保险。
                const base = wiki.baseUrl.replace(/\/$/, '');
                return { path: out.path, kb_url: `${base}/#/page/${args.pagePath}` };
            },
        }),
    ];
}
