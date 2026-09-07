// src/wiki/local-kb.ts
// 本地 KB（llm-wiki）库根工具（设计 D4：独立 <DSH_HOME>/storages/kanban/wiki/，隔离用户个人 ~/.llm-wiki-path）。
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { mkdirSync } from 'node:fs';
export function localKbRoot() {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(dshHome, 'storages', 'kanban', 'wiki');
}
/** 尽力创建库根（幂等）；失败由调用方告警 + block(kb-unreachable)（设计 §9）。 */
export function ensureLocalKbRoot(root = localKbRoot()) {
    mkdirSync(root, { recursive: true });
    return root;
}
/** target 须为绝对路径且解析后落在 root 内（resolve 折叠重复斜杠；相对路径 fail-closed，
 *  因为 bash/fs 里的相对目标语义属会话 cwd 而非库根，护栏不可猜测）。 */
export function isInsideKbRoot(root, target) {
    if (!target)
        return false;
    // 相对路径 fail-closed：不与 root 拼接猜测（相对目标语义属会话 cwd）
    if (resolve(target) !== target)
        return false;
    const r = resolve(root).replace(/\/+$/, '');
    return resolve(target) === r || resolve(target).startsWith(r + sep);
}
