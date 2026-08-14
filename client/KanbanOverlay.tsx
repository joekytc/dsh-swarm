import { useEffect, useState } from 'react';
import type { Chain, SpecCard, Task } from '../src/domain/types.js';
import { KanbanBoard } from './KanbanBoard.js';

/** 浏览器半从节点端 /kanban/board 拉取的看板线格式（Map 已序列化为数组）。 */
interface BoardWire {
  chains: Chain[];
  tasks: Task[];
  specCards: SpecCard[];
  handoffs: Array<{ id: string; summary: string; metadata: Record<string, unknown>; completedAt: number }>;
  events: Array<{ seq: number; chainId: string; taskId: string | null; kind: string; author: string; at: number; payload: Record<string, unknown> }>;
}

const OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed', top: 0, right: 0, bottom: 0, width: 440,
  background: 'var(--dsw-alias-bg-base, #0f172a)',
  borderLeft: '1px solid var(--dsw-alias-border-l2, #334155)',
  color: '#e2e8f0', overflow: 'auto', zIndex: 30, padding: 8,
  pointerEvents: 'auto',
};

/** shell.overlay 看板浮层：轮询节点端快照并渲染 KanbanBoard。 */
export function KanbanOverlay(_props: unknown) {
  const [board, setBoard] = useState<BoardWire | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/kanban/board');
        if (!res.ok) return;
        const data = (await res.json()) as BoardWire;
        if (alive) setBoard(data);
      } catch { /* 后端未就绪时静默重试 */ }
    };
    void load();
    const timer = setInterval(load, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const act = async (action: { type: 'block' | 'unblock' | 'archive' | 'complete'; taskId: string }) => {
    try {
      await fetch('/kanban/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
    } catch { /* 网络错误静默 */ }
  };

  if (!board) return null;
  return (
    <div style={OVERLAY_STYLE}>
      <KanbanBoard
        tasks={board.tasks}
        chains={board.chains}
        specCards={board.specCards}
        events={board.events}
        onAction={act}
        onComment={() => {}}
      />
    </div>
  );
}
