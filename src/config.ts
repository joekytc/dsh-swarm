import Schema from '@deepseek-ai/schemastery';
import type { Role } from './domain/types.js';

/** 斜杠命令前缀路由（单一事实源，决策12）：plan/openspec/learning 已实现，run/changeset/archive 待落地时追加。 */
export interface PrefixRoutes {
  plan: string;
  openspec: string;
  learning: string;
}

export const DEFAULT_PREFIX_ROUTES: PrefixRoutes = {
  plan: '/plan:',
  openspec: '/openspec:',
  learning: '/learning',
};

export interface KanbanConfig {
  storageDir: string;
  wikiVault: { baseUrl: string; pagePrefix: string };
  roles: {
    models: Partial<Record<Role, {
      provider: string;
      model: string;
      reasoningEffort?: string;
      fallbacks?: Array<{ provider: string; model: string; reasoningEffort?: string }>;
    }>>;
  };
  dispatcher: {
    staleTimeoutSeconds: number;
    maxRetries: number;
    heartbeatIntervalSeconds: number;
    /** 协议违规护栏：连续 protocol_violation 阻塞 ≥ 此值后，下次违规直接 gave_up 不再恢复。默认 2。 */
    maxProtocolViolations: number;
    /** 评审返工护栏：pt/dt 各自最大返工次数（超限 review/gave-up + [review-final]）。默认 pt=2 dt=3。 */
    maxReworksPerRole: { pt: number; dt: number };
  };
  prefixRoutes: PrefixRoutes;
  memory: {
    enabled: boolean;
    maxIndexEntries: number;
  };
  ui: {
    enabled: boolean;
    /** 看板宽度下界（px）。 */
    contentMinWidth: number;
    /** 看板宽度上界（px）。 */
    contentMaxWidth: number;
    sseHeartbeatSeconds: number;
  };
}

const modelItemSchema = () =>
  Schema.object({
    provider: Schema.string().required(),
    model: Schema.string().required(),
    reasoningEffort: Schema.string().default('high'),
    fallbacks: Schema.array(Schema.object({
      provider: Schema.string().required(),
      model: Schema.string().required(),
      reasoningEffort: Schema.string().default('high'),
    })).default([]),
  });

export const Config: Schema<KanbanConfig> = Schema.object({
  storageDir: Schema.string().default('$DSH_HOME/storages/kanban'),
  wikiVault: Schema.object({
    baseUrl: Schema.string().default(''),
    pagePrefix: Schema.string().default('projects/'),
  }),
  roles: Schema.object({
    // 角色系统提示词经 personas/kanban-{v,p,w,d}/agent.cordis.yml 组合装配（agentPresets.mount），
    // 随包安装到 $DSH_HOME/.agent-presets/（preset-installer），不再经 config 引用 md 文本。
    models: Schema.dict(modelItemSchema()).default({}),
  }),
  dispatcher: Schema.object({
    staleTimeoutSeconds: Schema.number().default(14400),
    maxRetries: Schema.number().default(3),
    heartbeatIntervalSeconds: Schema.number().default(300),
    maxProtocolViolations: Schema.number().min(1).default(2),
    maxReworksPerRole: Schema.object({
      pt: Schema.number().min(1).default(2),
      dt: Schema.number().min(1).default(3),
    }),
  }),
  prefixRoutes: Schema.object({
    plan: Schema.string().default(DEFAULT_PREFIX_ROUTES.plan),
    openspec: Schema.string().default(DEFAULT_PREFIX_ROUTES.openspec),
    learning: Schema.string().default(DEFAULT_PREFIX_ROUTES.learning),
  }),
  memory: Schema.object({
    enabled: Schema.boolean().default(true),
    maxIndexEntries: Schema.number().min(1).max(20).default(8),
  }).default({ enabled: true, maxIndexEntries: 8 }),
  ui: Schema.object({
    enabled: Schema.boolean().default(true),
    contentMinWidth: Schema.number().min(320).max(960).default(715), // 看板最小宽度 715px
    contentMaxWidth: Schema.number().min(320).max(960).default(780), // 看板最大宽度 780px
    sseHeartbeatSeconds: Schema.number().min(5).default(20),
  }),
});
