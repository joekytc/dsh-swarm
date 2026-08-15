import Schema from '@deepseek-ai/schemastery';
import type { Role } from './domain/types.js';

export interface KanbanConfig {
  storageDir: string;
  wikiVault: { baseUrl: string; pagePrefix: string };
  roles: {
    personaPresets: Record<Role, string>;
    models: Partial<Record<Role, { provider?: string; model?: string }>>;
  };
  dispatcher: { staleTimeoutSeconds: number; maxRetries: number; heartbeatIntervalSeconds: number };
  prefixRoutes: { plan: string; openspec: string };
  ui: {
    enabled: boolean;
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
    personaPresets: Schema.object({
      v: Schema.string().default('dsh-kanban/persona-v'),
      p: Schema.string().default('dsh-kanban/persona-p'),
      w: Schema.string().default('dsh-kanban/persona-w'),
      d: Schema.string().default('dsh-kanban/persona-d'),
    }),
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
    contentMaxWidth: Schema.number().min(320).max(960).default(660),
    sseHeartbeatSeconds: Schema.number().min(5).default(20),
  }),
});
