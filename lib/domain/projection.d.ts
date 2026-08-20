import type { BoardState, KanbanEvent } from './types.js';
export declare function applyTo(state: BoardState, ev: KanbanEvent): BoardState;
export declare function project(events: KanbanEvent[]): BoardState;
