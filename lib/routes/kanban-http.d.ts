import type { Context } from '@deepseek-ai/cordis';
import type { KanbanConfig } from '../config.js';
import type { KanbanProvider } from '../services/kanban-provider.js';
import type { ConfigProvider } from '../services/config-provider.js';
import type { LlmRuntimeLike } from '../services/llm-catalog.js';
import { managedProviderReady, probeOcr } from '../services/ocr-cli.js';
/** ocr 全局安装器：回调式 npm install -g，onSpawn 转交子进程句柄供取消。 */
export type OcrInstaller = (onSpawn?: (child: {
    kill(sig?: string): boolean;
}) => void) => Promise<{
    ok: boolean;
    version?: string;
    log: string;
}>;
/** ocr HTTP 分支可注入依赖（测试用）；缺省走真实现。 */
export interface KanbanOcrDeps {
    installer?: OcrInstaller;
    probeFn?: typeof probeOcr;
    managedReadyFn?: typeof managedProviderReady;
    wirer?: (a: {
        provider: string;
        model: string;
    }) => Promise<{
        ok: boolean;
        log: string;
    }>;
}
/** 看板 HTTP 桥（Web GUI 浏览器半消费）：GET /kanban/board 读快照；POST /kanban/action 执行状态操作；
 *  GET/PUT /kanban/config 配置读写（无 reset：各用户模型配置不同，无公共默认值）；GET /kanban/llm-catalog 模型目录；
 *  GET /kanban/ocr/status + POST /kanban/ocr/install(/cancel) + GET install/state + POST /kanban/ocr/wire ocr 评审引擎运维。
 *  仅在 webServer 服务存在时挂载（CLI/headless/测试裸 Context 不挂）。 */
export declare function registerKanbanHttp(ctx: Context, provider: KanbanProvider, configProvider: ConfigProvider, llm: LlmRuntimeLike, config?: Pick<KanbanConfig, 'ui'>, ocrDeps?: KanbanOcrDeps): void;
