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

/** 应用内跳转到指定会话（宿主 ISessions.open 对不在列表的 id fail loud，调用方须先经 useSessionIds 门控）。 */
export function openSession(id: string): void {
  if (!service) throw new Error('sessions service unavailable');
  service.open(id as never);
}
