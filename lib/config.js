import Schema from '@deepseek-ai/schemastery';
export const DEFAULT_PREFIX_ROUTES = {
    plan: '/plan:',
    openspec: '/openspec:',
    learning: '/learning',
    send: '/sms', // 手动投递斜杠命令
};
const modelItemSchema = () => Schema.object({
    provider: Schema.string().required(),
    model: Schema.string().required(),
    reasoningEffort: Schema.string().default('high'),
    fallbacks: Schema.array(Schema.object({
        provider: Schema.string().required(),
        model: Schema.string().required(),
        reasoningEffort: Schema.string().default('high'),
    })).default([]),
});
export const Config = Schema.object({
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
            pt: Schema.number().min(1).default(3),
            dt: Schema.number().min(1).default(3),
        }),
    }),
    prefixRoutes: Schema.object({
        plan: Schema.string().default(DEFAULT_PREFIX_ROUTES.plan),
        openspec: Schema.string().default(DEFAULT_PREFIX_ROUTES.openspec),
        learning: Schema.string().default(DEFAULT_PREFIX_ROUTES.learning),
        send: Schema.string().default(DEFAULT_PREFIX_ROUTES.send),
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
    gates: Schema.object({
        enabled: Schema.boolean().default(true),
        timeoutMs: Schema.number().min(1000).default(600000),
        forbidden: Schema.array(Schema.string()).default(['rm -rf /', 'git push']),
    }).default({ enabled: true, timeoutMs: 600000, forbidden: ['rm -rf /', 'git push'] }),
    imDelivery: Schema.object({
        enabled: Schema.boolean().default(false),
        botId: Schema.string().default(''),
        targetId: Schema.string().default(''),
        dmTargetId: Schema.string().default(''),
    }).default({ enabled: false, botId: '', targetId: '', dmTargetId: '' }),
    reviewEngine: Schema.object({
        mode: Schema.union(['delegate', 'managed']).default('delegate'),
        managed: Schema.object({
            provider: Schema.string().default(''),
            model: Schema.string().default(''),
        }),
    }).default({ mode: 'delegate', managed: { provider: '', model: '' } }),
});
