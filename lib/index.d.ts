import type { Context } from '@deepseek-ai/cordis';
import { Config, type KanbanConfig } from './config.js';
export declare const name = "dsh-kanban";
export { Config };
export declare function apply(ctx: Context, config: KanbanConfig): void;
