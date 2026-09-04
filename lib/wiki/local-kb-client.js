// src/wiki/local-kb-client.ts
// 本地 KB 客户端（llm-wiki 目录结构）：与 WikiVaultClient 同构的 search/read/write 面，
// local 模式下替换注入（planning 工具 / kb-linkage / memory-recall 复用既有逻辑，零分支扩散）。
// 排序原则 D12：相关性优先 7 : 新鲜度 3（0.7*scoreNorm + 0.3*mtimeNorm）。
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { WikiError } from './wiki-vault-client.js';
import { isInsideKbRoot } from './local-kb.js';
import { assertLocalKbPagePath } from './page-path.js';
export class LocalWikiClient {
    baseUrl = '';
    root;
    constructor(root) { this.root = root; }
    abs(pagePath) {
        assertLocalKbPagePath(pagePath); // Task 1 白名单单一来源（wiki/**、拒 .. 与绝对路径），勿内联重复
        const t = resolve(this.root, pagePath);
        if (!isInsideKbRoot(this.root, t))
            throw new WikiError('kb-rejected', undefined, `kb-rejected: path escapes local KB root: ${pagePath}`);
        return t;
    }
    async write(pagePath, content) {
        const t = this.abs(pagePath);
        try {
            mkdirSync(dirname(t), { recursive: true });
            writeFileSync(t, content, 'utf8');
        }
        catch (err) {
            // §9 降级链依赖：fs 失败归一 kb-unreachable（planning 工具按 code 判定 temp 兜底/软失败，审查 M5）
            throw new WikiError('kb-unreachable', undefined, `kb-unreachable: local KB write failed: ${String(err)}`);
        }
        return { path: pagePath };
    }
    async read(pagePath) {
        const t = this.abs(pagePath);
        if (!existsSync(t))
            throw new WikiError('kb-rejected', undefined, `kb-rejected: page not found: ${pagePath}`);
        try {
            return { rawMd: readFileSync(t, 'utf8') };
        }
        catch (err) {
            throw new WikiError('kb-unreachable', undefined, `kb-unreachable: local KB read failed: ${String(err)}`);
        }
    }
    async search(q) {
        const needle = String(q ?? '').toLowerCase().trim();
        if (!needle)
            return [];
        const hits = [];
        const walk = (dir) => {
            let entries = [];
            try {
                entries = readdirSync(dir);
            }
            catch {
                return;
            }
            for (const e of entries) {
                const p = join(dir, e);
                const st = statSync(p);
                if (st.isDirectory()) {
                    walk(p);
                    continue;
                }
                if (!e.endsWith('.md'))
                    continue;
                let text = '';
                try {
                    text = readFileSync(p, 'utf8');
                }
                catch {
                    continue;
                }
                const lower = text.toLowerCase();
                const n = lower.split(needle).length - 1;
                if (n === 0)
                    continue;
                hits.push({
                    path: p.slice(this.root.length + 1).split(sep).join('/'),
                    title: text.split('\n')[0]?.replace(/^#\s*/, '').trim() || e,
                    score: n,
                    mtime: Math.floor(st.mtimeMs / 1000),
                    hits: n,
                });
            }
        };
        walk(this.root);
        if (hits.length === 0)
            return [];
        const maxHits = Math.max(...hits.map((h) => h.hits));
        const times = hits.map((h) => h.mtime);
        const minT = Math.min(...times);
        const maxT = Math.max(...times);
        const span = maxT - minT || 1;
        return hits
            .map((h) => ({
            ...h,
            score: Number((0.7 * (h.hits / maxHits) + 0.3 * ((h.mtime - minT) / span)).toFixed(4)),
        }))
            .sort((a, b) => b.score - a.score);
    }
}
