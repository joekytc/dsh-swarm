import type { Context } from '@deepseek-ai/cordis';
export const name = 'kanban-board';

/** 浏览器半入口（roster 行 id: kanban-board）。
 *  P2 接入说明：node 半由 cordis.patch.yml 的 `dsh.client` roster 行注册，浏览器半作为
 *  client-plugin 由 web 构建工具链打包（/plugins/kanban-board/client.js）；slot API 对齐
 *  dsh-client-ui-layout（与 dsh-client-ui-jobs 挂载方式一致），实施时以真实 API 为准。 */
export function apply(_ctx: Context) {
  // 浏览器半骨架：挂载点由 T17 接入时以 dsh-client-ui-layout 的 slots/overlay 机制实现。
}
