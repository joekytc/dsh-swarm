import type { TaskStatus, ChainStatus, SpecCardStatus, EventKind } from './types.js';
export declare const transitionTask: (c: TaskStatus, k: EventKind) => TaskStatus;
export declare const transitionChain: (c: ChainStatus, k: EventKind) => ChainStatus;
export declare const transitionSpecCard: (c: SpecCardStatus, k: EventKind) => SpecCardStatus;
