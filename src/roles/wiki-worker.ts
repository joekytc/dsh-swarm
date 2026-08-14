import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '../domain/types.js';
import type { KanbanService } from '../domain/kanban-service.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';

function workspaceOf(chainId: string, taskId: string): string {
  return join(process.env.DSH_HOME ?? process.cwd(), 'storages', 'kanban', 'workspaces', chainId, taskId);
}

/** W 角色的领域执行：预取（原汁原味只读）与 KB 同步。 */
export class WikiWorker {
  private readonly kanban: KanbanService;
  private readonly wiki: WikiVaultClient;
  private readonly cfg: { pagePrefix: string };
  constructor(
    kanban: KanbanService,
    wiki: WikiVaultClient,
    cfg: { pagePrefix: string },
  ) { this.kanban = kanban; this.wiki = wiki; this.cfg = cfg; }

  async executePrefetch(task: Task, mode: 'file' | 'external' | 'kb', source: string): Promise<{ ref: string }> {
    const ws = workspaceOf(task.chainId, task.id);
    // P1-6：三模式全部落地；产物一律写入任务工作区（原汁原味，禁压缩/蒸馏）
    if (mode === 'file') {
      // 只读命令由角色 agent 的 terminal 白名单执行；此处仅登记产物引用
      if (!source.startsWith(ws)) throw new Error('prefetch source outside workspace: ' + source);
      return { ref: source };
    }
    if (mode === 'external') {
      // 外网资料查询（multi-search-engine 语义由角色 agent 的 web 工具执行）；
      // 此处登记产物引用：agent 完成检索后把原汁原味结果写入 ws/prefetch-external.md
      const ref = join(ws, 'prefetch-external.md');
      if (!source.startsWith(ws) && source !== '') throw new Error('prefetch source outside workspace: ' + source);
      return { ref: source || ref };
    }
    // kb 模式：知识库查询产物（wiki-vault search/read 由 wiki 工具执行，agent 落盘 ws/prefetch-kb.md）
    const ref = join(ws, 'prefetch-kb.md');
    if (!source.startsWith(ws) && source !== '') throw new Error('prefetch source outside workspace: ' + source);
    return { ref: source || ref };
  }

  async syncToWiki(task: Task, sourceRef: string): Promise<{ kb_url: string; page_path: string }> {
    const content = readFileSync(sourceRef, 'utf8'); // 原汁原味：不压缩不蒸馏
    const pagePath = this.cfg.pagePrefix + task.chainId + '/' + task.id + '.md';
    await this.wiki.write(pagePath, content);
    return { kb_url: this.wikiBase() + '/#/page/' + pagePath, page_path: pagePath };
  }

  private wikiBase(): string {
    return this.wiki.baseUrl; // P2：用 WikiVaultClient 公开 getter，不做类型强转
  }
}
