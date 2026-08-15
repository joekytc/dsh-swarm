import { useSyncExternalStore } from 'react';
import type { BoardStore } from './board-store.js';

/** 看板外部 store 的 React 桥（T24）：只订阅快照，不复制领域状态机。 */
export function useKanbanBoard(store: BoardStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
