import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { KanbanTab } from './KanbanTab.js';
import { ConfigSection } from './ConfigSection.js';
import { SWARM_CONFIG_NS } from './config-store.js';
import css from './kanban.css';
import configCss from './config.css';

export const name = 'kanban-board';

/** 所需 client 服务（cordis fiber inject——loader 把模块导出当作对象插件传入）。 */
export const inject = ['slots'];

/** 浏览器半入口（roster 行 id: kanban-board）：把看板挂到 conversation.view（会话中心 tab，additive）。
 *  对齐 DSH 原生注册：对话(id=chat, order=0) → 轨迹(id=trajectory, order=10) → 看板(id=kanban, order=20)。
 *  T9：另把 ConfigSection 挂到 settings.section（id=swarm-config, order=30）。
 *  数据桥为节点端 /kanban HTTP 路由；ui-conversation 包仅运行时声明 slot（dsh.client.inject 排依赖序），浏览器半不直接 import。 */
export function apply(ctx: ClientContext): (() => void) | void {
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
  return () => { if (style) style.remove(); if (configStyle) configStyle.remove(); };
}
