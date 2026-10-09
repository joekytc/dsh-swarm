import { useSyncExternalStore } from 'react';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';

/** 宿主 sessions 服务桥：client/index.ts apply() 注入；组件只依赖本模块，不直接 import 宿主运行时实现。
 *  注入发生在模块加载（apply 先于 React 渲染），故订阅内读 service 无需响应注入本身。 */
let service: ISessions | null = null;

export function setSessionsService(next: ISessions | null): void {
  service = next;
}

const EMPTY: ReadonlySet<string> = new Set();
let cache: { source: unknown; ids: ReadonlySet<string> } = { source: undefined, ids: EMPTY };

/** 宿主会话 id 集合（未注入=空集）。快照按引用缓存 + ids 内容级稳定化，保证 useSyncExternalStore getSnapshot 引用稳定
 *  （即使宿主 getSnapshot 每次返回新快照对象，只要 ids 内容不变就复用旧 Set 引用，避免无限重渲染）。 */
export function useSessionIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    (onChange) => service?.list.subscribe(onChange) ?? (() => {}),
    () => {
      if (!service) return EMPTY;
      const snap = service.list.getSnapshot();
      if (cache.source !== snap) {
        const next = snap.ids as readonly string[];
        const prev = cache.ids;
        const same = prev.size === next.length && [...next].every((id) => prev.has(id));
        cache = same ? { source: snap, ids: prev } : { source: snap, ids: new Set<string>(next) };
      }
      return cache.ids;
    },
    () => EMPTY,
  );
}

/** 新宿主导航接缝：dsh 0.2.0 起 ISessions.open 移除，会话导航归视图所有者（uiWorkspace.openSession）。
 *  宿主以 getter 惰性供给（uiWorkspace 注册晚于 client apply，apply 期属性访问会在 cordis 上 throw）；
 *  0.1.7 底线宿主无此服务，getter 返回 null 走旧 open 转发。 */
let navigator: (() => { openSession(target: string): void } | null) | null = null;

export function setSessionNavigator(next: (() => { openSession(target: string): void } | null) | null): void {
  navigator = next;
}

/** 应用内跳转到指定会话（调用方须先经 useSessionIds 门控，宿主对不在列表的 id fail loud）。 */
export function openSession(id: string): void {
  // 优先 0.2.0+ 视图所有者导航；解析失败视同服务缺席；旧宿主退回 ISessions.open 转发；两者皆缺则响亮报错。
  if (navigator) {
    let viaWorkspace: { openSession(target: string): void } | null = null;
    try {
      viaWorkspace = navigator();
    } catch {
      viaWorkspace = null;
    }
    if (viaWorkspace) {
      viaWorkspace.openSession(id);
      return;
    }
  }
  if (!service) throw new Error('sessions service unavailable');
  const open = (service as { open?: (target: string) => void }).open;
  if (!open) throw new Error('host exposes neither uiWorkspace nor sessions.open; session jump unavailable');
  open(id);
}
