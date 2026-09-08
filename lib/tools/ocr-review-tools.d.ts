/** ocr_review 工具：把 ocr CLI 三子命令（preview/rule/managed）封装为 cordis 工具，DT 评审角色工具面注册。
 * 依赖全注入可换 fake（tests），缺省用 ocr-cli 真实现。 */
import { type ToolDefinition as ToolDef } from '@deepseek-ai/dsh-tools';
import { managedProviderReady, probeOcr, runOcr } from '../services/ocr-cli.js';
/** 构造 ocr_review 工具定义（defineTool 返回形态，与 kanban-tools 一致）。 */
export declare function buildOcrReviewTool(deps: {
    runOcrFn?: typeof runOcr;
    probeFn?: typeof probeOcr;
    managedReadyFn?: typeof managedProviderReady;
    cwd?: () => string;
}): ToolDef;
