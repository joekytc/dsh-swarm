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
