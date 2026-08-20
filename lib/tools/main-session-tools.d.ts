import type { Context } from '@deepseek-ai/cordis';
import type { KanbanConfig } from '../config.js';
/** P1-3 主会话工具面：spec_card_view/edit/approve + kanban 只读子集（show/list/comment）+ 前缀路由工具。
 *  主会话无 kanban_create/complete/block（防越权：主会话建卡走 /plan: 路由或 GUI）。 */
export declare function registerMainSessionTools(ctx: Context, config: KanbanConfig): void;
