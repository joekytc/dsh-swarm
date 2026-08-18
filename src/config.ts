import Schema from '@deepseek-ai/schemastery';
import type { Role } from './domain/types.js';

export interface KanbanConfig {
  storageDir: string;
  wikiVault: { baseUrl: string; pagePrefix: string };
  roles: {
    models: Partial<Record<Role, { provider?: string; model?: string }>>;
  };
  dispatcher: { staleTimeoutSeconds: number; maxRetries: number; heartbeatIntervalSeconds: number };
  prefixRoutes: { plan: string; openspec: string };
  ui: {
    enabled: boolean;
    /** 看板宽度下界（px）。 */
    contentMinWidth: number;
    /** 看板宽度上界（px）。 */
    contentMaxWidth: number;
    sseHeartbeatSeconds: number;
  };
}

export const Config: Schema<KanbanConfig> = Schema.object({
  storageDir: Schema.string().default('$DSH_HOME/storages/kanban'),
  wikiVault: Schema.object({
    baseUrl: Schema.string().default('http://192.168.122.111:3000'),
    pagePrefix: Schema.string().default('projects/'),
  }),
  roles: Schema.object({
    // 角色系统提示词经 personas/kanban-{v,p,w,d}/agent.cordis.yml 组合装配（agentPresets.mount），
    // 随包安装到 $DSH_HOME/.agent-presets/（preset-installer），不再经 config 引用 md 文本。
    models: Schema.object({}).default({}),
  }),
  dispatcher: Schema.object({
    staleTimeoutSeconds: Schema.number().default(14400),
    maxRetries: Schema.number().default(3),
    heartbeatIntervalSeconds: Schema.number().default(300),
  }),
  prefixRoutes: Schema.object({
    plan: Schema.string().default('/plan:'),
    openspec: Schema.string().default('/openspec:'),
  }),
  ui: Schema.object({
    enabled: Schema.boolean().default(true),
    contentMinWidth: Schema.number().min(320).max(960).default(715), // 看板最小宽度 715px
    contentMaxWidth: Schema.number().min(320).max(960).default(780), // 看板最大宽度 780px
    sseHeartbeatSeconds: Schema.number().min(5).default(20),
  }),
});
