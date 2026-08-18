import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WikiWorker } from '../../src/roles/wiki-worker.js';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';
import type { Task } from '../../src/domain/types.js';

const task: Task = { id: 't_2', chainId: 'ch_1', title: 'w2', body: '', assignee: 'w', status: 'ready', mode: 'kb', priority: 1, parents: ['t_1'], children: [], createdBy: 'v', attempts: 0, heartbeats: [], sessionId: 'kbn-t_2', reworkOfTaskId: null, resumeSessionId: null, reviewAttempt: 0, reviewStatus: 'not-required' };

describe('WikiWorker', () => {
  it('syncs P artifact to wiki and returns kb_url', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wiki-wk-'));
    const ws = join(dir, 'workspaces', 'ch_1', 't_2');
    mkdirSync(ws, { recursive: true });
    const src = join(ws, 'plan.md');
    writeFileSync(src, '# plan content');
    try {
      const wiki = { write: vi.fn(async (p: string) => ({ path: p })), baseUrl: 'http://mock' } as unknown as WikiVaultClient;
      const kanban = {} as never;
      const worker = new WikiWorker(kanban, wiki, { pagePrefix: 'projects/' } as never);
      const out = await worker.syncToWiki(task, src);
      expect(out.page_path).toContain('projects/');
      expect(out.page_path).toContain('ch_1'); // kb_url/page 保留链 id，便于溯源
      expect(wiki.write).toHaveBeenCalledWith(expect.stringContaining('ch_1'), expect.any(String));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('file prefetch rejects non-readonly writes', async () => {
    const wiki = {} as never;
    const worker = new WikiWorker({} as never, wiki, { pagePrefix: 'projects/' } as never);
    // 只读校验：产物 ref 必须在任务工作区下
    await expect(worker.executePrefetch(task, 'file', '/etc/passwd')).rejects.toThrow(/workspace/);
  });
  it('external prefetch registers workspace artifact (P1-6)', async () => {
    const worker = new WikiWorker({} as never, {} as never, { pagePrefix: 'projects/' } as never);
    const out = await worker.executePrefetch(task, 'external', '');
    expect(out.ref).toContain('prefetch-external.md');
  });
  it('kb prefetch registers workspace artifact (P1-6)', async () => {
    const worker = new WikiWorker({} as never, {} as never, { pagePrefix: 'projects/' } as never);
    const out = await worker.executePrefetch(task, 'kb', '');
    expect(out.ref).toContain('prefetch-kb.md');
  });
});
