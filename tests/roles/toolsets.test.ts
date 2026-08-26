import { describe, it, expect, vi } from 'vitest';
import { installRoleTools, buildReadOnlyWriteGuard, buildDTWriteGuard, buildPlanWriteGuard, isReviewNamespacePath, resolveReviewEngine, buildSubagentTreeGuard, registerDtTaskChain, unregisterDtTaskChain } from '../../src/roles/toolsets.js';

async function registeredFor(role: 'v' | 'p' | 'w' | 'd' | 'pt' | 'dt') {
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
  it('PT: task tools + spec view; no create/wiki/exec', async () => {
    const names = await registeredFor('pt');
    expect(names).toEqual(expect.arrayContaining([
      'spec_card_view', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment', 'kanban_show', 'kanban_list',
    ]));
    expect(names).not.toContain('kanban_create');
    expect(names).not.toContain('wiki_write');
    expect(names).not.toContain('wiki_search');
    expect(names).not.toContain('run_code');
  });
  it('PT ToolGuard denies source writes, allows read commands', async () => {
    const repo = '/ws/repo';
    const guard = buildReadOnlyWriteGuard(repo);
    // tracked source 写 → 拒绝
    expect(guard({ name: 'write', arguments: { path: repo + '/src/a.ts', content: 'x' } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(guard({ name: 'edit', arguments: { file_path: repo + '/README.md' } } as never)).toMatch(/write-to-repo-source-denied/);
    // git mutation → 拒绝
    expect(guard({ name: 'bash', arguments: { command: 'cd ' + repo + ' && git apply p.diff' } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(guard({ name: 'bash', arguments: { command: 'git -C ' + repo + ' push' } } as never)).toMatch(/write-to-repo-source-denied/);
    // 含写标记且指向 repo → 拒绝
    expect(guard({ name: 'bash', arguments: { command: 'touch ' + repo + '/a.txt' } } as never)).toMatch(/write-to-repo-source-denied/);
    // 只读命令 → 放行（undefined）
    expect(guard({ name: 'bash', arguments: { command: 'git -C ' + repo + ' show HEAD' } } as never)).toBeUndefined();
    expect(guard({ name: 'bash', arguments: { command: 'cat ' + repo + '/src/a.ts' } } as never)).toBeUndefined();
    expect(guard({ name: 'read', arguments: { path: repo + '/src/a.ts' } } as never)).toBeUndefined();
  });
  it('DT: task tools + spec view + KB read/write (review namespace); no create', async () => {
    const names = await registeredFor('dt');
    expect(names).toEqual(expect.arrayContaining([
      'wiki_read', 'wiki_search', 'wiki_write', 'spec_card_view',
      'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment', 'kanban_show', 'kanban_list',
    ]));
    expect(names).not.toContain('kanban_create');
  });
  it('DT wiki_write only allows projects/<chain>/review namespace', () => {
    expect(isReviewNamespacePath('projects/ch_1/review/dt_1.md', 'ch_1')).toBe(true);
    expect(isReviewNamespacePath('projects/ch_1/review/dt_1', 'ch_1')).toBe(true);
    expect(isReviewNamespacePath('projects/ch_1/other.md', 'ch_1')).toBe(false); // 普通 projects 路径拒绝
    expect(isReviewNamespacePath('projects/other_chain/review/x.md', 'ch_1')).toBe(false); // 跨链拒绝
    expect(isReviewNamespacePath('../etc/passwd', 'ch_1')).toBe(false); // 绝对/../ 拒绝
    expect(isReviewNamespacePath('/etc/passwd', 'ch_1')).toBe(false);
  });
  it('DT ToolGuard denies source writes and allows verification commands', async () => {
    const repo = '/ws/repo';
    const guard = buildDTWriteGuard(repo, 'ch_1');
    // 写源码 → 拒绝
    expect(guard({ name: 'write', arguments: { path: repo + '/src/a.ts', content: 'x' } } as never)).toMatch(/write-to-repo-source-denied/);
    // run_code 子调用写源码（code 含写标记 + repo 路径）→ 拒绝
    expect(guard({ name: 'run_code', arguments: { code: 'fs.writeFileSync("' + repo + '/src/a.ts", "x")' } } as never)).toMatch(/write-to-repo-source-denied/);
    // git mutation → 拒绝
    expect(guard({ name: 'bash', arguments: { command: 'git -C ' + repo + ' commit -m x' } } as never)).toMatch(/write-to-repo-source-denied/);
    // wiki_write 越出 review namespace → 拒绝
    expect(guard({ name: 'wiki_write', arguments: { pagePath: 'projects/ch_1/other.md', content: 'x' } } as never)).toMatch(/wiki-write-outside-review-namespace/);
    // wiki_write 在 review namespace → 放行
    expect(guard({ name: 'wiki_write', arguments: { pagePath: 'projects/ch_1/review/dt_1.md', content: 'x' } } as never)).toBeUndefined();
    // 验证命令（无写标记）→ 放行
    expect(guard({ name: 'bash', arguments: { command: 'cd ' + repo + ' && npm test' } } as never)).toBeUndefined();
    expect(guard({ name: 'bash', arguments: { command: 'cd ' + repo + ' && tsc --noEmit' } } as never)).toBeUndefined();
  });
  it('OCR unavailable falls back to superpowers code-review', () => {
    expect(resolveReviewEngine({ ocr: true, codeReview: true })).toBe('ocr');
    expect(resolveReviewEngine({ ocr: false, codeReview: true })).toBe('code-review');
    expect(resolveReviewEngine({ ocr: true, codeReview: false })).toBe('ocr');
    expect(resolveReviewEngine({ ocr: false, codeReview: false })).toBe('review-tool-unavailable');
  });
});

describe('buildPlanWriteGuard（P 写护栏，Q3：禁改动源码为工具级硬约束）', () => {
  const guard = buildPlanWriteGuard('/ws/main');
  const planFile = '/ws/main/openspec/changes/autoNote-tab/design.md';
  it('读任意路径放行（含跨目录 /tmp）', () => {
    expect(guard({ name: 'read', arguments: { path: '/tmp/plan.md' } } as never)).toBeUndefined();
  });
  it('直接写工具写 openspec/changes/** 放行（write 的 path / edit 的 file_path 均解析）', () => {
    expect(guard({ name: 'write', arguments: { path: planFile } } as never)).toBeUndefined();
    expect(guard({ name: 'edit', arguments: { file_path: planFile } } as never)).toBeUndefined();
  });
  it('直接写工具写源码拒绝（禁改动源码硬性）', () => {
    expect(guard({ name: 'write', arguments: { path: '/ws/main/src/foo.ts' } } as never)).toContain('openspec/changes');
    expect(guard({ name: 'edit', arguments: { file_path: '/ws/main/src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('bash 写命令含 openspec/changes 子串放行（相对路径也命中）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'cat > openspec/changes/autoNote-tab/tasks.md' } } as never)).toBeUndefined();
  });
  it('bash 写源码拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x >> src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('git mutation 一律拒绝（含 git -C 形态）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git commit -m x' } } as never)).toContain('git');
    expect(guard({ name: 'bash', arguments: { command: 'cd /ws/main && git push origin main' } } as never)).toContain('git');
  });
  it('git 只读命令放行（status/log/show 不被 GIT_WRITE_RE 拒）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git status' } } as never)).toBeUndefined();
    expect(guard({ name: 'bash', arguments: { command: 'git -C /ws/main log --oneline -5' } } as never)).toBeUndefined();
    expect(guard({ name: 'bash', arguments: { command: 'git show HEAD' } } as never)).toBeUndefined();
  });
  it('W 用只读护栏：一切 fs 写拒绝（含 openspec/changes 内）', () => {
    const wg = buildReadOnlyWriteGuard('/ws/main');
    expect(wg({ name: 'write', arguments: { path: planFile } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  // ── Fix round 1/5：对抗性回归（M1-M4 绕过向量 + m1/m2 回归）────────────────
  it('B1: .. 路径穿越写拒绝（write file_path 解析后落源码）', () => {
    expect(guard({ name: 'write', arguments: { file_path: '/ws/main/openspec/changes/../../src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('B2: 前缀边界逃逸拒绝（/ws/main2 兄弟仓库 openspec/changes）', () => {
    expect(guard({ name: 'write', arguments: { file_path: '/ws/main2/openspec/changes/evil.md' } } as never)).toContain('openspec/changes');
  });
  it('B3: bash 无空格重定向写拒绝（echo x>f 绕过 \\s>>?）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x>src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('B4: node -e 解释器文件写 API 拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: "node -e require('fs').writeFileSync('/ws/main/src/foo.ts','x')" } } as never)).toContain('openspec/changes');
  });
  it('B5: python -c 解释器文件写 API 拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: "python -c open('/ws/main/src/foo.ts','w').write('x')" } } as never)).toContain('openspec/changes');
  });
  it('B6: git checkout（非只读动词）拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git checkout -- src/foo.ts' } } as never)).toContain('git');
  });
  it('B7: git branch（非只读动词）拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git branch fix/x' } } as never)).toContain('git');
  });
  it('m1 regression: 写内容含 git 文本但路径合法 plan 路径 → 放行（git 判定仅命令文本，不扫内容）', () => {
    expect(guard({ name: 'write', arguments: { file_path: '/ws/main/openspec/changes/x/tasks.md', content: 'run git commit then push' } } as never)).toBeUndefined();
  });
  it('m2 regression: 相对 openspec/changes 路径经 write 工具放行', () => {
    expect(guard({ name: 'write', arguments: { file_path: 'openspec/changes/x/design.md' } } as never)).toBeUndefined();
  });
  // ── Fix round 2/5：git 分段判定 + 全局选项 fail-closed + fd2 豁免收窄 + POSIX 反斜杠 ──
  it('R2-F1: git 链式命令分段判定（&& 分隔：git status 打头后跟 git commit）拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git status && git commit -m x' } } as never)).toContain('git');
  });
  it('R2-F2: git 链式命令分段判定（; 分隔：git log 后跟 git checkout）拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git log; git checkout -- src/foo.ts' } } as never)).toContain('git');
  });
  it('R2-F3: git 链式命令分段判定（| 分隔：git status 后跟 git push）拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git status | git push origin main' } } as never)).toContain('git');
  });
  it('R2-F4: git 全局选项前缀 fall-through 拒绝（--no-pager）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git --no-pager checkout -- src/foo.ts' } } as never)).toContain('git');
  });
  it('R2-F5: git 全局选项前缀 fall-through 拒绝（-c key=value）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git -c core.hooksPath=/x checkout -- src/foo.ts' } } as never)).toContain('git');
  });
  it('R2-F6: 显式 fd1 stdout 重定向（1> 等价 >）写源码拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo PAYLOAD 1>src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('R2-F7: POSIX 反斜杠目录名不归一化（src/openspec\\changes 非相邻段）→ 拒绝', () => {
    expect(guard({ name: 'write', arguments: { file_path: '/ws/main/src/openspec\\changes/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('R2-A1: stderr 重定向 2> 豁免（只读，不写源码）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x 2>/dev/null' } } as never)).toBeUndefined();
  });
  it('R2-A2: git 只读 + 良性 echo 放行', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git status && echo ok' } } as never)).toBeUndefined();
  });
  it('R2-A3: git 只读 + 全局选项放行', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git --no-pager status' } } as never)).toBeUndefined();
  });
  it('R2-A4: 写内容含 git 文本但路径合法 plan 路径 → 放行（git 判定仅命令文本）', () => {
    expect(guard({ name: 'write', arguments: { file_path: '/ws/main/openspec/changes/x/design.md', content: 'run git commit then push' } } as never)).toBeUndefined();
  });
  it('跨目录读仍放行（read /tmp/x）', () => {
    expect(guard({ name: 'read', arguments: { path: '/tmp/x' } } as never)).toBeUndefined();
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
  it('kanban-v (R21 butler·orchestrator): persona/instructions ONLY — zero execution/exploration tools', () => {
    const list = rowIds(loadComposition('kanban-v'));
    expect(list).toEqual(expect.arrayContaining(['persona', 'agent-instructions']));
    // 零执行能力（R21：V disabled browser/file/web/search/delegation/code_execution；只路由）
    for (const banned of ['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-presentation', 'tool-jobs', 'skill-filesystem', 'tool-skill', 'tool-goal', 'planning', 'compaction', 'delegation', 'tool-ask-user', 'tool-todo', 'tool-web']) {
      expect(list, 'kanban-v must not contain ' + banned).not.toContain(banned);
    }
    expect(list.some((id) => id.startsWith('tool-subagent') || id === 'tool-workflow' || id === 'tool-ralph')).toBe(false);
  });
  it('kanban-d: keeps full dev set + delegation(spawn/fork/control/list-agents) + goal; no workflow/ralph/plan-mode/web', () => {
    const list = rowIds(loadComposition('kanban-d'));
    expect(list).toEqual(expect.arrayContaining([
      'persona', 'agent-instructions', 'tool-bash', 'tool-fs', 'tool-fs-search',
      'tool-jobs', 'skill-filesystem', 'tool-skill', 'tool-todo', 'tool-ask-user', 'tool-presentation',
      // 0.1.0 delegation：D 可派单（子代理继承 D 权限，产物归 D feature 分支）+ goal（条件启用）
      'tool-subagent', 'tool-subagent-fork', 'tool-subagent-control', 'tool-subagent-list-agents', 'tool-goal',
    ]));
    for (const banned of ['planning', 'tool-web', 'tool-workflow', 'tool-ralph']) {
      expect(list, 'kanban-d must not contain ' + banned).not.toContain(banned);
    }
  });
  it('kanban-d tool-presentation mode is both (B1: 直接 bash/kanban_* 可调用 + run_code 可用)', () => {
    const rows = loadComposition('kanban-d');
    const pres = rows.find((r) => r.id === 'tool-presentation');
    expect(pres).toBeTruthy();
    // code 模式会令注册表把直接调用 bash/kanban_* 解析为 UNKNOWN_TOOL（仅 run_code 可直呼）；
    // native 又隐藏 run_code。both = 原生工具 schema + run_code 并存——D 执行者工具面。
    expect((pres as { config?: { mode?: string } }).config?.mode).toBe('both');
  });
  it('kanban-dt: spawn-only delegation (parallel read-only review); no fork/control/goal/workflow/ralph', () => {
    const list = rowIds(loadComposition('kanban-dt'));
    expect(list).toEqual(expect.arrayContaining(['persona', 'agent-instructions', 'tool-bash', 'tool-fs', 'tool-fs-search', 'tool-presentation', 'tool-subagent']));
    for (const banned of ['tool-subagent-fork', 'tool-subagent-control', 'tool-subagent-list-agents', 'tool-goal', 'tool-workflow', 'tool-ralph', 'planning', 'tool-web']) {
      expect(list, 'kanban-dt must not contain ' + banned).not.toContain(banned);
    }
  });
  it('agent-runner mounts kanban-<role> trimmed preset (not full code) for p/w/d', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-preset-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: '/ws/main' }, 'human');
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
        on: () => () => {}, // setup 注册 agent/request waterfall（强制思考等级）需要 on
      };
      await setup(agentCtx);
      expect(mounts).toEqual(['kanban-p']);
      expect(mounts).not.toContain('code');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
import { installRolePresets, userPresetsRoot } from '../../src/roles/preset-installer.js';

describe('role preset installer (D22: runtime write to $DSH_HOME/.agent-presets)', () => {
  it('installs kanban-v/p/w/d/pt/dt composition files under $DSH_HOME/.agent-presets (idempotent)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    const prev = process.env.DSH_HOME;
    try {
      process.env.DSH_HOME = dir;
      const installed = installRolePresets();
      expect(installed.sort()).toEqual(['kanban-d', 'kanban-dt', 'kanban-p', 'kanban-pt', 'kanban-v', 'kanban-w']);
      for (const id of ['kanban-v', 'kanban-p', 'kanban-w', 'kanban-d', 'kanban-pt', 'kanban-dt']) {
        const comp = join(userPresetsRoot(), id, 'agent.cordis.yml');
        expect(existsSync(comp), 'missing ' + comp).toBe(true);
        const list = rowIds(loadComposition(id)); // 复用真实 loader 方言解析已安装副本
        expect(list.length).toBeGreaterThan(0);
      }
      // 幂等：再次安装不报错、文件仍存在
      const again = installRolePresets();
      expect(again.sort()).toEqual(['kanban-d', 'kanban-dt', 'kanban-p', 'kanban-pt', 'kanban-v', 'kanban-w']);
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('subagent tree guard (0.1.0 delegation: DT 子代理强制只读，D 系放行)', () => {
  const dtHeader = { cwd: '/ws/repo', parentSession: 'kbn-t_dtx', agentPreset: 'kanban-dt' };
  const dHeader = { cwd: '/ws/repo', parentSession: 'kbn-t_dx', agentPreset: 'kanban-d' };
  const mainSubHeader = { cwd: '/ws/repo', parentSession: 'user-main-session' };
  const exec = (name: string, args: unknown, header: Record<string, unknown> | undefined) =>
    ({ name, arguments: args, agent: header ? { session: { header } } : undefined }) as never;
  const guard = buildSubagentTreeGuard();

  it('DT subagent: direct write tool targeting repo → denied', () => {
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, dtHeader))).toMatch(/write-to-repo-source-denied/);
  });
  it('DT subagent: bash write marker targeting repo → denied', () => {
    expect(guard(exec('bash', { command: 'touch /ws/repo/a.txt' }, dtHeader))).toMatch(/write-to-repo-source-denied/);
  });
  it('DT subagent: run_code write marker → denied', () => {
    expect(guard(exec('run_code', { code: 'fs.writeFileSync("/ws/repo/src/a.ts","x")' }, dtHeader))).toMatch(/write-to-repo-source-denied/);
  });
  it('DT subagent: wiki_write resolved via chainId cache (registerDtTaskChain)', () => {
    registerDtTaskChain('t_dtx', 'ch_9');
    try {
      expect(guard(exec('wiki_write', { pagePath: 'projects/ch_9/review/dt_1.md' }, dtHeader))).toBeUndefined();
      expect(guard(exec('wiki_write', { pagePath: 'projects/ch_9/other.md' }, dtHeader))).toMatch(/wiki-write-outside-review-namespace/);
    } finally { unregisterDtTaskChain('t_dtx'); }
  });
  it('DT subagent: chainId unresolved → wiki_write fail-closed (deny all)', () => {
    expect(guard(exec('wiki_write', { pagePath: 'projects/ch_9/review/dt_1.md' }, dtHeader))).toMatch(/wiki-write-outside-review-namespace/);
  });
  it('D subagent: same writes → allowed (inherits D permission — RED LINE)', () => {
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, dHeader))).toBeUndefined();
    expect(guard(exec('bash', { command: 'touch /ws/repo/a.txt' }, dHeader))).toBeUndefined();
    expect(guard(exec('run_code', { code: 'fs.writeFileSync("/ws/repo/src/a.ts","x")' }, dHeader))).toBeUndefined();
  });
  it('main-session subagent / no preset mark / headerless execution → untouched (fail-open)', () => {
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, mainSubHeader))).toBeUndefined();
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, undefined))).toBeUndefined();
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, { cwd: '/ws/repo' }))).toBeUndefined();
  });
  it('getTaskChainId dep overrides module cache', () => {
    const g2 = buildSubagentTreeGuard({ getTaskChainId: () => 'ch_dep' });
    expect(g2(exec('wiki_write', { pagePath: 'projects/ch_dep/review/x.md' }, dtHeader))).toBeUndefined();
  });
  it('DT parent-session (无 parentSession / 非 kbn- 前缀 parent) → 全局护栏不拦截 (pass-through，只读由 agent.ctx guard 兜底)', () => {
    // DT 父会话自身：parentSession 缺失或非 kbn- 前缀（如主会话直接派生），chainId 解析不到，
    // 全局护栏应放行（undefined）；其只读由 agent.ctx guard 保证，误拦会拒掉 DT 评审写入。
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, { cwd: '/ws/repo', agentPreset: 'kanban-dt' }))).toBeUndefined();
    expect(guard(exec('wiki_write', { pagePath: 'projects/ch_9/review/dt_1.md' }, { cwd: '/ws/repo', agentPreset: 'kanban-dt' }))).toBeUndefined();
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, { cwd: '/ws/repo', parentSession: 'user-main-session', agentPreset: 'kanban-dt' }))).toBeUndefined();
  });
});


