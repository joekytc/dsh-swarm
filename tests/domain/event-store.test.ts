import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEventStore } from '../../src/domain/event-store.js';
import type { KanbanEvent } from '../../src/domain/types.js';

function ev(seq: number): KanbanEvent {
  return { seq, chainId: 'ch_1', taskId: null, kind: 'chain/created', payload: {}, author: 'v', at: 1000 + seq };
}

describe('FileEventStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kanban-ev-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('assigns monotonic seq and persists across reopen', async () => {
    const s1 = new FileEventStore(dir);
    await s1.append(ev(0)); // seq 忽略入参，由存储分配
    const got = await s1.append(ev(0));
    expect(got.seq).toBe(1);
    const s2 = new FileEventStore(dir);
    const all = await s2.readAll();
    expect(all).toHaveLength(2);
    expect(all[0].seq).toBe(0);
    expect(all[1].seq).toBe(1);
  });

  it('readSince returns only newer events', async () => {
    const s = new FileEventStore(dir);
    await s.append(ev(0)); await s.append(ev(0));
    const tail = await s.readSince(1);
    expect(tail.map(e => e.seq)).toEqual([1]);
  });
  it('concurrent appends from two store instances yield unique seq (P1-8)', async () => {
    const s1 = new FileEventStore(dir);
    const s2 = new FileEventStore(dir); // 模拟多进程/多实例同写同一事件日志
    const results = await Promise.all([
      s1.append(ev(0)), s2.append(ev(0)), s1.append(ev(0)), s2.append(ev(0)),
    ]);
    const seqs = results.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(4); // seq 全部唯一（无内存缓存冲突）
  });
});
