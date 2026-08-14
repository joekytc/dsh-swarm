import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { KanbanOverlay } from './KanbanOverlay.js';

export const name = 'kanban-board';

/** 所需 client 服务（cordis fiber inject——loader 把模块导出当作对象插件传入）。 */
export const inject = ['slots'];

/** 浏览器半入口（roster 行 id: kanban-board）：把看板挂到 shell.overlay（frame-wide 列表槽，additive）。
 *  P2 对齐：dsh-client-ui-layout 声明 shell.overlay；数据桥为节点端 /kanban HTTP 路由。 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay' as never, () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'kanban-board', order: 100, label: 'kanban' } as never,
      KanbanOverlay as never,
    ),
  );
}