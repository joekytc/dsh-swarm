import type { KanbanEvent } from './types.js';
export interface EventStore {
    append(ev: Omit<KanbanEvent, 'seq'>): Promise<KanbanEvent>;
    readAll(): Promise<KanbanEvent[]>;
    readAllSync(): KanbanEvent[];
    readSince(seq: number): Promise<KanbanEvent[]>;
    /** 物理移除匹配事件行并重排 seq（整链硬删除用；不可恢复）。 */
    purge?(predicate: (ev: KanbanEvent) => boolean): Promise<number>;
}
/** JSONL 事件存储：追加即持久化；重启回放由 readAll 提供。 */
export declare class FileEventStore implements EventStore {
    private readonly file;
    private seq;
    constructor(dir: string);
    append(ev: Omit<KanbanEvent, 'seq'>): Promise<KanbanEvent>;
    readAll(): Promise<KanbanEvent[]>;
    readAllSync(): KanbanEvent[];
    readSince(seq: number): Promise<KanbanEvent[]>;
    purge(predicate: (ev: KanbanEvent) => boolean): Promise<number>;
}
