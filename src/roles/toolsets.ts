import type { Context } from '@deepseek-ai/cordis';
import { apply as applyBashTool } from '@deepseek-ai/dsh-tool-bash';
import { apply as applyFsTool } from '@deepseek-ai/dsh-tool-fs';
import { apply as applyFsSearchTool } from '@deepseek-ai/dsh-tool-fs-search';
import { KanbanService } from '../domain/kanban-service.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import type { Role } from '../domain/types.js';
import { buildKanbanTools, type ToolCaller } from '../tools/kanban-tools.js';
import { buildSpecCardTools } from '../tools/spec-card-tools.js';
import { buildWikiTools } from '../tools/wiki-tools.js';
import { buildPrefetchTools } from '../tools/prefetch-tools.js';
import { WikiWorker } from './wiki-worker.js';

/** 按角色在 agent scope 注册工具面（P1-3 统一注册策略）：
 *  所有 kanban 工具从 T9 工厂选取 + getCaller 闭包（actor=role、boundTaskId=taskId）。
 *  can() 权限兜底仍保留在工具 execute 内（纵深防御第二道）。 */
export async function installRoleTools(agentCtx: Context, role: Role, deps: { kanban: KanbanService; wiki: WikiVaultClient; taskId?: string }): Promise<void> {
  const caller = (): ToolCaller => ({ actor: role, boundTaskId: deps.taskId });
  const allKanban = buildKanbanTools(deps.kanban, caller);

  // 每角色可用的 kanban 工具名（V 额外编排、P/W/D 任务工具）
  const namesFor: Record<Role, string[]> = {
    v: ['kanban_create', 'kanban_comment', 'kanban_show', 'kanban_list'],
    p: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
    w: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
    d: ['kanban_show', 'kanban_list', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment'],
  };
  const want = new Set(namesFor[role]);
  const registry = agentCtx.tools as { register(def: unknown): () => void } | undefined;
  if (!registry) return; // 无工具服务（测试桩）跳过

  for (const tool of allKanban) {
    const name = (tool as { name?: string }).name;
    if (name && want.has(name)) registry.register(tool);
  }
  // 执行角色（P/W/D）挂载基座工具（bash/fs/fs-search）：角色 agent 用真实 shell/文件能力完成任务。
  if (role === 'p' || role === 'w' || role === 'd') {
    await applyBashTool(agentCtx, {} as never);
    await applyFsTool(agentCtx, {} as never);
    await applyFsSearchTool(agentCtx, {} as never);
  }
  if (role === 'w') {
    for (const tool of buildWikiTools(deps.wiki, caller)) registry.register(tool);
    const worker = new WikiWorker(deps.kanban, deps.wiki, { pagePrefix: 'projects/' });
    const getTask = async (taskId: string) => {
      const state = await deps.kanban.snapshot();
      const t = state.tasks.get(taskId);
      if (!t) throw new Error('unknown task: ' + taskId);
      return t;
    };
    for (const tool of buildPrefetchTools(worker, getTask, caller)) registry.register(tool);
  } else if (role === 'd') {
    // D：只读 KB——只注册 wiki_read
    for (const tool of buildWikiTools(deps.wiki, caller)) {
      if ((tool as { name?: string }).name === 'wiki_read') registry.register(tool);
    }
  } else if (role === 'p') {
    // P：spec_card_view（只读）+ openspec 写工具由 base 提供
    for (const tool of buildSpecCardTools(deps.kanban, caller)) {
      if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
    }
  } else if (role === 'v') {
    for (const tool of buildSpecCardTools(deps.kanban, caller)) {
      if ((tool as { name?: string }).name === 'spec_card_view') registry.register(tool);
    }
  }
}
