import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import { can } from '../domain/permissions.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import type { ToolCaller } from './kanban-tools.js';

function guard(action: Parameters<typeof can>[0], caller: ToolCaller) {
  if (!can(action, caller.actor, null)) throw new Error('permission denied: ' + action);
}

/** wiki-vault 工具工厂（W 角色 agent scope）：search/read/write，权限兜底 wiki-read=w/d、wiki-write=w。 */
export function buildWikiTools(wiki: WikiVaultClient, getCaller: () => ToolCaller) {
  return [
    defineTool({
      name: 'wiki_search',
      description: 'Search the wiki-vault knowledge base.',
      parameters: { q: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { q: string }) {
        const caller = getCaller();
        guard('wiki-read', caller);
        const results = await wiki.search(args.q);
        return results as unknown as JsonValue;
      },
    }),
    defineTool({
      name: 'wiki_read',
      description: 'Read a wiki-vault page (read-only KB access).',
      parameters: { pagePath: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args: { pagePath: string }) {
        const caller = getCaller();
        guard('wiki-read', caller);
        const page = await wiki.read(args.pagePath);
        return page as unknown as JsonValue;
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
      async execute(args: { pagePath: string; content: string }) {
        const caller = getCaller();
        guard('wiki-write', caller);
        const out = await wiki.write(args.pagePath, args.content);
        return out as unknown as JsonValue;
      },
    }),
  ];
}
