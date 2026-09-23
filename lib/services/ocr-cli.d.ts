/** ocr CLI runner（@alibaba-group/open-code-review 命令行）：二进制定位、探活、执行与托管 provider 配置。
 * 踩坑警告：插件进程 PATH 常缺 npm 全局 bin 目录，不能裸依赖 PATH 找 ocr（社区方案踩过）——
 * 故按常见 npm 全局 bin 目录逐个探测并进程内缓存定位结果。 */
import { execFile } from 'node:child_process';
export declare const OCR_PACKAGE = "@alibaba-group/open-code-review";
export declare const OCR_MANAGED_PROVIDER_NAME = "dsh-managed";
export declare const INSTALL_GUIDANCE: string;
export type OcrCliDeps = {
    execFileFn?: typeof execFile;
    env?: NodeJS.ProcessEnv;
    homedirFn?: () => string;
};
export declare function probeOcr(deps?: OcrCliDeps): Promise<{
    installed: boolean;
    version: string;
    binPath: string | null;
}>;
export declare function runOcr(args: string[], opts: {
    cwd: string;
    timeoutMs?: number;
}, deps?: OcrCliDeps): Promise<{
    stdout: string;
    stderr: string;
    error?: string;
}>;
/** 托管就绪探测：provider 为 dsh-managed 且模型非空。
 * 踩坑：`ocr config set model <m>` 的落盘位置随当前 provider 类型分流——内置 provider 写顶层
 * `model`，自定义 provider（本插件的 dsh-managed）写 `custom_providers.dsh-managed.model`
 * （沙箱 HOME 实测）。只读顶层 model 会把已接好的托管配置判成未就绪，工具层随即返回
 * 「托管模式未配置 LLM」而永不真正调用 `ocr review`（两处都算就绪）。 */
export declare function managedProviderReady(deps?: OcrCliDeps): boolean;
export declare function wireManagedProvider(a: {
    baseUrl: string;
    protocol: 'openai' | 'anthropic';
    apiKey: string;
    model: string;
}, deps?: OcrCliDeps): Promise<{
    ok: boolean;
    log: string;
}>;
