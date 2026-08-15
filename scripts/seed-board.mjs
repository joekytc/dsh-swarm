// 演示/冒烟用：向看板事件库写入一条链路数据（/kanban/board 立即可见）。
// 用法：node scripts/seed-board.mjs
import { homedir } from 'node:os';
import { join } from 'node:path';
const mod = await import('../lib/index.js');
const { Context } = await import('@deepseek-ai/cordis');
const ctx = new Context();
const cfg = mod.Config({
  storageDir: join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'kanban'),
} as never);
mod.apply(ctx, cfg);
const kb = ctx.get('kanban');
const chain = await kb.service.createChain({ title: 'demo chain ' + new Date().toISOString().slice(11, 19), ownerSessionId: 's_main' }, 'human');
const card = await kb.service.createSpecCard(chain.id, { problem: 'demo', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
await kb.service.approveSpecCard(card.id, 'human');
const t = await kb.service.createTask({ chainId: chain.id, title: 'W1 prefetch', assignee: 'w', mode: 'file' }, 'v');
await kb.service.claimTask(t.id, 'system');
await kb.service.completeTask(t.id, { summary: 'done', metadata: { ref: '/ws/w1' }, completedAt: Date.now() }, 'w', { boundTaskId: t.id });
console.log('seeded chain=' + chain.id + ' task=' + t.id + ' (see http://127.0.0.1:3080/kanban/board)');
process.exit(0);
