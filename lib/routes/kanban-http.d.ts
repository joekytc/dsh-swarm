import type { Context } from '@deepseek-ai/cordis';
import type { KanbanConfig } from '../config.js';
import type { KanbanProvider } from '../services/kanban-provider.js';
import type { ConfigProvider } from '../services/config-provider.js';
import type { LlmRuntimeLike } from '../services/llm-catalog.js';
/** 看板 HTTP 桥（Web GUI 浏览器半消费）：GET /kanban/board 读快照；POST /kanban/action 执行状态操作；
 *  GET/PUT /kanban/config + POST /kanban/config/reset 配置读写；GET /kanban/llm-catalog 模型目录。
 *  仅在 webServer 服务存在时挂载（CLI/headless/测试裸 Context 不挂）。 */
export declare function registerKanbanHttp(ctx: Context, provider: KanbanProvider, configProvider: ConfigProvider, llm: LlmRuntimeLike, config?: Pick<KanbanConfig, 'ui'>): void;
