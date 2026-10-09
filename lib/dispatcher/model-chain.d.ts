import type { KanbanConfig } from '../config.js';
import type { AgentModelOptions } from './dispatcher.js';
export interface ModelChainState {
    candidates: AgentModelOptions[];
    index: number;
    taskId?: string;
    comment?: (body: string) => Promise<void>;
}
export declare function registerModelChain(agent: object, state: ModelChainState): void;
export declare function isSwitchableModelFailure(failure: {
    code?: string;
    message?: string;
    status?: number;
}): boolean;
export interface ModelChainHookDeps {
    getConfig: () => KanbanConfig;
    log?: (line: string) => void;
}
export declare function installModelChainHooks(scope: unknown, deps: ModelChainHookDeps): () => void;
