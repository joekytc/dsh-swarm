import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KanbanEvent } from './types.js';

export interface EventStore {
  append(ev: Omit<KanbanEvent, 'seq'>): Promise<KanbanEvent>;
  readAll(): Promise<KanbanEvent[]>;
  readAllSync(): KanbanEvent[]; // 服务构造时同步重投影用（P0-3）
  readSince(seq: number): Promise<KanbanEvent[]>;
  /** 物理移除匹配事件行并重排 seq（整链硬删除用；不可恢复）。 */
  purge?(predicate: (ev: KanbanEvent) => boolean): Promise<number>;
}

/** JSONL 事件存储：追加即持久化；重启回放由 readAll 提供。 */
export class FileEventStore implements EventStore {
  private readonly file: string;
  private seq = 0;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'events.jsonl');
    try {
      const lines = readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        this.seq = JSON.parse(lines[lines.length - 1]!).seq + 1;
      }
    } catch {
      this.seq = 0; // 文件不存在或为空
    }
  }

  async append(ev: Omit<KanbanEvent, 'seq'>): Promise<KanbanEvent> {
    // P1-8：seq 每次从文件尾行重读分配（跨进程安全，多 dsh 实例并发追加时 seq 唯一）；
    // appendFileSync 单行 JSONL 追加在 POSIX 上原子（行 < 4KB，无锁无残留）。
    const all = this.readAllSync();
    const seq = all.length > 0 ? all[all.length - 1]!.seq + 1 : 0;
    const full: KanbanEvent = { ...ev, seq };
    const line = JSON.stringify(full) + '\n';
    appendFileSync(this.file, line);
    return full;
  }

  async readAll(): Promise<KanbanEvent[]> {
    return this.readAllSync();
  }

  readAllSync(): KanbanEvent[] {
    try {
      const text = readFileSync(this.file, 'utf8');
      return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as KanbanEvent);
    } catch {
      return [];
    }
  }

  async readSince(seq: number): Promise<KanbanEvent[]> {
    const all = await this.readAll();
    return all.filter((e) => e.seq >= seq);
  }

  async purge(predicate: (ev: KanbanEvent) => boolean): Promise<number> {
    const all = this.readAllSync();
    const kept = all.filter((e) => !predicate(e)).map((e, i) => ({ ...e, seq: i }));
    writeFileSync(this.file, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length > 0 ? '\n' : ''));
    this.seq = kept.length;
    return all.length - kept.length;
  }
}
