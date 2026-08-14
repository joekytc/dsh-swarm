import type { Context } from '@deepseek-ai/cordis';
import { KanbanProvider } from './services/kanban-provider.js';
import { Config, type KanbanConfig } from './config.js';
import { registerMainSessionTools } from './tools/main-session-tools.js';
import { registerKanbanHttp } from './routes/kanban-http.js';
import { startDispatcher } from './dispatcher/dispatcher.js';

export const name = 'dsh-kanban';
export { Config };
// P1-9：无 inject——KanbanProvider 只用文件系统（FileEventStore），不依赖 ctx.storage 等任何服务。

export function apply(ctx: Context, config: KanbanConfig) {
  // cordis 4：Service 构造即注册（super(ctx,'kanban') 调 ctx.reflect.provide），无需手动 provide。
  const provider = new KanbanProvider(ctx, config);
  // Web GUI 数据桥：GET /kanban/board + POST /kanban/action（仅 webServer 存在时挂载）。
  registerKanbanHttp(ctx, provider);
  // P1-3：主会话工具面在此注册（spec_card_view/edit/approve + kanban 只读子集 + 前缀路由工具，
  // getCaller 返回 {actor:'human'}）；角色工具面在 T15 installRoleTools 按 agent scope 装配。
  registerMainSessionTools(ctx, config);
  // 调度层：事件唤醒 V（R20）+ 每任务 agent runner + 看门狗（仅 agents 可用时启动）。
  startDispatcher(ctx, config);
}