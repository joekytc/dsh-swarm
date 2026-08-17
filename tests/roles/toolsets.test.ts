import { describe, it, expect, vi } from 'vitest';
import { installRoleTools } from '../../src/roles/toolsets.js';

async function registeredFor(role: 'v' | 'p' | 'w' | 'd') {
  const names: string[] = [];
  const ctx = { tools: { register: vi.fn((def: { name?: string }) => { names.push(def.name ?? ''); }) } };
  await installRoleTools(ctx as never, role, { kanban: {} as never, wiki: {} as never });
  return names;
}

describe('role tool surfaces (design §3 工具面隔离)', () => {
  it('V: orchestration + complete/block/heartbeat + spec view; no write tools', async () => {
    const names = await registeredFor('v');
    expect(names).toEqual(expect.arrayContaining([
      'kanban_create', 'kanban_complete', 'kanban_block', 'kanban_heartbeat',
      'kanban_comment', 'kanban_show', 'kanban_list', 'spec_card_view',
    ]));
    // kanban_link/chain_show 在 src/tools/kanban-tools.ts 未实现 → 保持不注册（差异见 toolsets.ts 注释）
    expect(names).not.toContain('kanban_link');
    expect(names).not.toContain('chain_show');
    expect(names).not.toContain('wiki_write');
    expect(names).not.toContain('spec_card_edit');
    expect(names).not.toContain('spec_card_approve');
  });
  it('W: task tools + spec view + wiki + prefetch', async () => {
    const names = await registeredFor('w');
    expect(names).toEqual(expect.arrayContaining([
      'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'spec_card_view',
      'wiki_search', 'wiki_read', 'wiki_write', 'prefetch_file', 'prefetch_external', 'prefetch_kb',
    ]));
    expect(names).not.toContain('kanban_create');
  });
  it('D: read-only KB (search+read) + spec view; no wiki_write/create', async () => {
    const names = await registeredFor('d');
    expect(names).toEqual(expect.arrayContaining([
      'wiki_search', 'wiki_read', 'spec_card_view', 'kanban_complete', 'kanban_block', 'kanban_heartbeat',
    ]));
    expect(names).not.toContain('wiki_write');
    expect(names).not.toContain('kanban_create');
  });
  it('P: task tools + spec view; no create/wiki', async () => {
    const names = await registeredFor('p');
    expect(names).toEqual(expect.arrayContaining([
      'spec_card_view', 'kanban_complete', 'kanban_block', 'kanban_heartbeat',
    ]));
    expect(names).not.toContain('kanban_create');
    expect(names).not.toContain('wiki_write');
    expect(names).not.toContain('wiki_search');
  });
});
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { AgentRunner } from '../../src/dispatcher/agent-runner.js';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface PresetRow { id?: string; name?: string; disabled?: boolean }

/** 读取包内裁剪组合文件（D22：随包分发 personas/<preset-id>/agent.cordis.yml）。 */
function loadComposition(presetId: string): PresetRow[] {
  const filePath = join(REPO_ROOT, 'personas', presetId, 'agent.cordis.yml');
  expect(existsSync(filePath), 'missing composition: ' + filePath).toBe(true);
  // 用真实 loader 方言解析（entryListSchema 处理 !!js 标量），与 agent-presets 加载语义一致
  const parsed = load(readFileSync(filePath, 'utf8'), { schema: entryListSchema }) as unknown;
  if (!Array.isArray(parsed)) throw new Error('composition must be a list of rows: ' + presetId);
  return parsed as PresetRow[];
}

const rowIds = (rows: PresetRow[]): string[] => rows.map((r) => r.id).filter((x): x is string => Boolean(x));

describe('role preset trimming (D22: per-role minimal capability, no full code preset)', () => {
  // P/W 共同禁用的基座能力（对应设计 §4 裁剪列）
  const P_W_BANNED = [
    'tool-presentation', // run_code
    'tool-jobs',
    'skill-filesystem',
    'tool-skill',
    'tool-goal',
    'planning',
    'compaction',
    'delegation', // subagent/fork/workflow/ralph
    'tool-ask-user',
    'tool-todo',
    'tool-web',
  ];
  it('kanban-p: keeps persona/instructions/bash/fs/fs-search; no run_code/jobs/skill/goal/plan/compaction/delegation/web/todo/ask-user', () => {
    const list = rowIds(loadComposition('kanban-p'));
    expect(list).toEqual(expect.arrayContaining(['persona', 'agent-instructions', 'tool-bash', 'tool-fs', 'tool-fs-search']));
    for (const banned of P_W_BANNED) expect(list, 'kanban-p must not contain ' + banned).not.toContain(banned);
    // 明确断言无 delegation 子行（subagent / workflow / ralph）
    expect(list.some((id) => id.startsWith('tool-subagent') || id === 'tool-workflow' || id === 'tool-ralph')).toBe(false);
  });
  it('kanban-w: keeps persona/instructions/bash/fs/fs-search; same execution+delegation trim as P', () => {
    const list = rowIds(loadComposition('kanban-w'));
    expect(list).toEqual(expect.arrayContaining(['persona', 'agent-instructions', 'tool-bash', 'tool-fs', 'tool-fs-search']));
    for (const banned of P_W_BANNED) expect(list, 'kanban-w must not contain ' + banned).not.toContain(banned);
    expect(list.some((id) => id.startsWith('tool-subagent') || id === 'tool-workflow' || id === 'tool-ralph')).toBe(false);
  });
  it('kanban-d: keeps full dev set (run_code/jobs/skill/todo/ask-user) but disables delegation/goal/plan-mode/web', () => {
    const list = rowIds(loadComposition('kanban-d'));
    expect(list).toEqual(expect.arrayContaining([
      'persona', 'agent-instructions', 'tool-bash', 'tool-fs', 'tool-fs-search',
      'tool-jobs', 'skill-filesystem', 'tool-skill', 'tool-todo', 'tool-ask-user', 'tool-presentation',
    ]));
    for (const banned of ['delegation', 'tool-goal', 'planning', 'tool-web']) {
      expect(list, 'kanban-d must not contain ' + banned).not.toContain(banned);
    }
    expect(list.some((id) => id.startsWith('tool-subagent') || id === 'tool-workflow' || id === 'tool-ralph')).toBe(false);
  });
  it('agent-runner mounts kanban-<role> trimmed preset (not full code) for p/w/d', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-preset-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: '', out_of_scope: '' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'p1', assignee: 'p', mode: 'openspec' }, 'v');
      const mounts: string[] = [];
      const fakePresets = { mount: async (_ctx: unknown, id?: string) => { mounts.push(id ?? ''); } };
      let capturedSetup: unknown = null;
      const agents = {
        create: async (o: { setup?: unknown }) => {
          capturedSetup = o.setup;
          return { agent: { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [{ type: 'tool-call', name: 'kanban_complete' }] } } };
        },
      };
      const ctx = { get: (n: string) => (n === 'agents' ? agents : n === 'agentPresets' ? fakePresets : undefined) };
      const runner = new AgentRunner(ctx as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      const setup = capturedSetup as (agentCtx: unknown) => Promise<void>;
      const agentCtx = {
        get: (n: string) => (n === 'agentPresets' ? fakePresets : undefined),
        agent: { session: { append: vi.fn() } },
      };
      await setup(agentCtx);
      expect(mounts).toEqual(['kanban-p']);
      expect(mounts).not.toContain('code');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
import { installRolePresets, userPresetsRoot } from '../../src/roles/preset-installer.js';

describe('role preset installer (D22: runtime write to $DSH_HOME/.agent-presets)', () => {
  it('installs kanban-p/w/d composition files under $DSH_HOME/.agent-presets (idempotent)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    const prev = process.env.DSH_HOME;
    try {
      process.env.DSH_HOME = dir;
      const installed = installRolePresets();
      expect(installed.sort()).toEqual(['kanban-d', 'kanban-p', 'kanban-w']);
      for (const id of ['kanban-p', 'kanban-w', 'kanban-d']) {
        const comp = join(userPresetsRoot(), id, 'agent.cordis.yml');
        expect(existsSync(comp), 'missing ' + comp).toBe(true);
        const list = rowIds(loadComposition(id)); // 复用真实 loader 方言解析已安装副本
        expect(list.length).toBeGreaterThan(0);
      }
      // 幂等：再次安装不报错、文件仍存在
      const again = installRolePresets();
      expect(again.sort()).toEqual(['kanban-d', 'kanban-p', 'kanban-w']);
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});


