export interface CatalogProvider {
    id: string;
    name: string;
}
export interface CatalogModel {
    id: string;
    name: string;
    efforts: Array<{
        id: string;
        name: string;
    }>;
}
export interface LlmCatalog {
    providers: CatalogProvider[];
    models: Record<string, CatalogModel[]>;
}
export interface LlmRuntimeLike {
    listProviders(): Array<{
        id: string;
        name: string;
    }>;
    listModels(provider: string): Promise<Array<{
        id: string;
        name: string;
    }>>;
    resolveModelInfo(provider: string, model: string): Promise<{
        reasoning?: {
            efforts?: Array<{
                id: string;
                name: string;
            }>;
        };
    }>;
}
export declare function buildLlmCatalog(llm: LlmRuntimeLike): Promise<LlmCatalog>;
/** 候选模型（与 dispatcher AgentModelOptions 结构同形；不 import 防环）。 */
export interface ModelCandidateLike {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
export interface CandidateReject {
    candidate: ModelCandidateLike;
    reason: string;
}
/** 派发/保存前候选预校验：provider 已配置、model 属该 provider、reasoningEffort ∈ 模型声明集。
 *  fail-open 原则：运行时缺失、provider 枚举失败、单候选探测异常一律放行——只拦「确实查到
 *  不匹配」的组合，目录不可达（网络抖动）≠ 配置错误，不应阻断派发/保存。
 *  effort 声明集为空（resolveModelInfo 降级）时跳过 effort 把关。 */
export declare function filterCandidatesByCatalog(runtime: LlmRuntimeLike | undefined, candidates: readonly ModelCandidateLike[]): Promise<{
    ok: ModelCandidateLike[];
    rejected: CandidateReject[];
}>;
