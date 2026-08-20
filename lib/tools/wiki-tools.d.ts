import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import type { ToolCaller } from './kanban-tools.js';
/** wiki-vault 工具工厂（W 角色 agent scope）：search/read/write，权限兜底 wiki-read=w/d、wiki-write=w。 */
export declare function buildWikiTools(wiki: WikiVaultClient, getCaller: () => ToolCaller): import("@deepseek-ai/dsh-tools").ToolDefinition[];
