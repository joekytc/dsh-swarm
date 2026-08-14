import { useMemo, useState } from 'react';
import type { BoardState } from '../src/domain/types.js';
import { foldBoard } from './board-fold.js';

/** 看板事件流 hook：由浏览器半订阅事件流（dsh-client-connection），此处做纯折叠。 */
export function useKanbanBoard(events: BoardState['events'], state: BoardState) {
  const [selected, setSelected] = useState<string | null>(null);
  const board = useMemo(() => foldBoard([...state.tasks.values()]), [state.tasks]);
  const chainEvents = useMemo(() => {
    const by: Record<string, BoardState['events']> = {};
    for (const ev of events) {
      (by[ev.chainId] ??= []).push(ev);
    }
    return by;
  }, [events]);
  return { board, chainEvents, selected, setSelected };
}
