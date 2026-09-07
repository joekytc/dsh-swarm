import type { Context } from '@deepseek-ai/cordis';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import { KanbanTab } from './KanbanTab.js';

// alpha.2 (0.1.2-rc.1)：dsh-client-runtime 已移除，`slots` service 由宿主 client-modules
// 运行时注入（对齐宿主内置 dsh-client-ui-jobs 的 `inject: ['sessions','slots']` 用法）。
// 类型面无对外发布入口，故本地声明最小契约；运行时形状以宿主注入为准。
declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      inject(name: string, provider: () => unknown): unknown;
      register(options: Record<string, unknown>, component: unknown): unknown;
    };
  }
}
import { ConfigSection } from './ConfigSection.js';
import { SWARM_CONFIG_NS } from './config-store.js';
import { setSessionsService } from './session-bridge.js';
import css from './kanban.css';
import configCss from './config.css';

export const name = 'kanban-board';

/** 所需 client 服务（cordis fiber inject——loader 把模块导出当作对象插件传入）。 */
export const inject = ['slots', 'sessions'];

/** 浏览器半入口（roster 行 id: kanban-board）：把看板挂到 conversation.view（会话中心 tab，additive）。
 *  对齐 DSH 原生注册：对话(id=chat, order=0) → 轨迹(id=trajectory, order=10) → 看板(id=kanban, order=20)。
 *  T9：另把 ConfigSection 挂到 settings.section（id=swarm-config, order=30）。
 *  数据桥为节点端 /kanban HTTP 路由；ui-conversation 包仅运行时声明 slot（dsh.client.inject 排依赖序），浏览器半不直接 import。 */
export function apply(ctx: Context): (() => void) | void {
  // cast：@deepseek-ai/dsh-session（服务端包）也 merge 了 cordis Context.sessions: SessionStore，
  // 类型面被其覆盖；浏览器半运行时注入的实为 dsh-api-session-controller 的 ISessions。
  setSessionsService(ctx.sessions as unknown as ISessions);
  let style: HTMLStyleElement | null = null;
  let configStyle: HTMLStyleElement | null = null;
  if (typeof document !== 'undefined') {
    style = document.head.querySelector<HTMLStyleElement>('style[data-dsh-swarm]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-dsh-swarm', '');
      style.textContent = css;
      document.head.appendChild(style);
    }
    configStyle = document.head.querySelector<HTMLStyleElement>('style[data-dsh-swarm-config]');
    if (!configStyle) {
      configStyle = document.createElement('style');
      configStyle.setAttribute('data-dsh-swarm-config', '');
      configStyle.textContent = configCss;
      document.head.appendChild(configStyle);
    }
  }
  ctx.slots.inject('conversation.view' as never, () =>
    ctx.slots.register(
      { name: 'conversation.view', id: 'kanban', order: 20, label: '看板' } as never,
      KanbanTab as never,
    ),
  );
  ctx.slots.inject('settings.section' as never, () =>
    ctx.slots.register(
      { name: 'settings.section', id: SWARM_CONFIG_NS, order: 30, label: 'Swarm 配置' } as never,
      ConfigSection as never,
    ),
  );
  return () => { if (style) style.remove(); if (configStyle) configStyle.remove(); setSessionsService(null); };
}
