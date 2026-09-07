import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRunner } from '../../src/dispatcher/agent-runner.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { localKbRoot } from '../../src/wiki/local-kb.js';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

/** Task 8：agent-runner KB 模式接线（D7/D8）——configProvider.mode 线程化验证。
 *  覆盖：installRoleTools 收到 kbMode（W 本地不注册 wiki_*）、两段 guard 装配分支
 *  （W/DT local → buildKbWriteGuard；remote → 原护栏；P 恒 plan 护栏）、W/D/DT 本地
 *  上下文注入。护栏/工具注册行为断言（Task 5/6 纯函数测试之上的接线层验证）。 */

type KbMode = 'remote' | 'local';

/** stub ConfigProvider：getEffective() 机械适配 + mode getter（本任务接线消费面）。 */
const stubConfigProvider = (kbMode: KbMode) =>
  ({ getEffective: () => ({}), get mode(): KbMode { return kbMode; } }) as never;

/** 假工具注册表：register 记录 name、guard 捕获守卫函数（对齐宿主 ToolRuntime 能力子集）。 */
function fakeToolRegistry() {
  const names: string[] = [];
  const guards: Array<(e: unknown) => string | undefined> = [];
  return {
    names,
    guards,
    register(def: { name?: string }) { names.push(String(def.name)); },
    get(name: string, _scope?: unknown) { return names.includes(name) ? { name } : undefined; },
    guard: (g: (e: unknown) => string | undefined) => { guards.push(g); },
  };
}

interface RunResult {
  registered: string[];
  guards: Array<(e: unknown) => string | undefined>;
  contextText: string;
  kbRoot: string;
}

/** 跑一次指定角色任务（local/remote KB 模式），捕获注册工具名、guard、followup 上下文文本。
 *  假 agent 以真实 svc.blockTask 收尾（blocked=确定态，不触发 protocol_violation）。 */
async function runKbRole(assignee: 'w' | 'd' | 'dt' | 'p', mode: string, kbMode: KbMode): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), 'runner-kbmode-'));
  const svc = new KanbanService(new FileEventStore(dir));
  try {
    const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: '/ws/main' }, 'human');
    const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
    await svc.approveSpecCard(card.id, 'human');
    const t = await svc.createTask({ chainId: chain.id, title: assignee, assignee, mode: mode as never }, 'v');
    const registry = fakeToolRegistry();
    const captured: string[] = [];
    const fakeAgentCtx = {
      get: (n: string) => (n === 'agentPresets' ? { mount: async () => {} } : undefined),
      agent: { session: { append: () => {} } },
      tools: registry,
      on: () => () => {},
    };
    const agents = {
      create: async (o: { setup?: (c: unknown) => Promise<void> }) => {
        if (o.setup) await o.setup(fakeAgentCtx as never);
        const pending: Promise<void>[] = [];
        const followup = (msg: unknown) => {
          captured.push((msg as { content?: Array<{ type: string; text: string }> })?.content?.[0]?.text ?? '');
          pending.push(svc.blockTask(t.id, 'kbmode capture closeout', assignee, { boundTaskId: t.id }).then(() => {}));
        };
        const whenIdle = async () => { await Promise.all(pending); };
        return { agent: { followup, whenIdle, session: { events: [] } } };
      },
    };
    const runner = new AgentRunner(
      { get: (n: string) => (n === 'agents' ? agents : undefined) } as never,
      svc,
      stubConfigProvider(kbMode),
      {} as unknown as WikiVaultClient,
    );
    await runner.runTask(t.id);
    return { registered: registry.names, guards: registry.guards, contextText: captured.join('\n'), kbRoot: localKbRoot() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('AgentRunner KB mode wiring (Task 8 D7/D8)', () => {
  let dshHome: string;
  let prevDshHome: string | undefined;

  beforeEach(() => {
    // 库根隔离：DSH_HOME 指向临时目录（localKbRoot 在调用时读取 env；vitest 每文件独立 worker）
    dshHome = mkdtempSync(join(tmpdir(), 'kbmode-home-'));
    prevDshHome = process.env.DSH_HOME;
    process.env.DSH_HOME = dshHome;
  });
  afterEach(() => {
    if (prevDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevDshHome;
    rmSync(dshHome, { recursive: true, force: true });
  });

  it('W local: 挂 KB 写护栏（库根内 write 放行；库根外 fs 写与库内 cp bash 均拒）', async () => {
    const { guards, kbRoot } = await runKbRole('w', 'file', 'local');
    expect(guards).toHaveLength(1);
    const g = guards[0] as (e: { name?: string; arguments?: unknown }) => string | undefined;
    // 库根内 write → 豁免（KB 护栏特征，只读护栏会拒绝）
    expect(g({ name: 'write', arguments: { path: join(kbRoot, 'wiki/sources/ch_x/t_1.md') } })).toBeUndefined();
    // 库根外 write → 拒绝（fail-closed base）
    expect(g({ name: 'write', arguments: { path: '/ws/main/src/foo.ts' } })).toMatch(/write-to-repo-source-denied/);
    // 库内复制经 bash cp（源+目标全在库根）→ 放行（extractWriteTargets 动词目标提取，D7 双模式）
    expect(g({ name: 'bash', arguments: { command: `cp ${join(kbRoot, 'a.md')} ${join(kbRoot, 'b.md')}` } })).toBeUndefined();
    // 任一写目标在库根外 → 整体拒绝（fail-closed）
    expect(g({ name: 'bash', arguments: { command: `cp ${join(kbRoot, 'a.md')} /tmp/out.md` } })).toMatch(/write-to-repo-source-denied/);
    // 库根目录已由 ensureLocalKbRoot 幂等创建（setup/buildContext 装配时）
    expect(existsSync(kbRoot)).toBe(true);
  });

  it('W local: installRoleTools 收到 kbMode=local → wiki_* 不注册（skill+fs 自治查写）', async () => {
    const { registered } = await runKbRole('w', 'file', 'local');
    expect(registered).toContain('spec_card_view');
    expect(registered).toContain('kanban_complete');
    expect(registered).not.toContain('wiki_search');
    expect(registered).not.toContain('wiki_read');
    expect(registered).not.toContain('wiki_write');
  });

  it('W remote（默认）: 仍只读护栏（库根写也拒）+ wiki_* 注册 + 上下文不含本地模式块', async () => {
    const { guards, registered, contextText, kbRoot } = await runKbRole('w', 'file', 'remote');
    expect(guards).toHaveLength(1);
    const g = guards[0] as (e: { name?: string; arguments?: unknown }) => string | undefined;
    // remote 模式库根写也拒（未切 KB 护栏）
    expect(g({ name: 'write', arguments: { path: join(kbRoot, 'wiki/sources/ch_x/t_1.md') } })).toMatch(/write-to-repo-source-denied/);
    expect(registered).toContain('wiki_read');
    expect(registered).toContain('wiki_write');
    expect(contextText).not.toContain('## 知识库（本地模式）');
    expect(contextText).not.toContain('## 本地知识库（local KB mode）');
  });

  it('W local: 上下文注入「知识库（本地模式）」五要素 + cp/mv 用 write 补句', async () => {
    const { contextText, kbRoot } = await runKbRole('w', 'file', 'local');
    expect(contextText).toContain('## 知识库（本地模式）');
    expect(contextText).toContain(`- 本地库根：${kbRoot}`);
    // Task 6 评审补句：库内复制/移动必须用 write 工具（cp/mv 会被护栏拒绝）
    expect(contextText).toContain('库内复制/移动一律用 write 工具（cp/mv 会被护栏拒绝）');
    expect(contextText).toContain('检索排序原则：相关性优先 7 : 新鲜度 3');
    expect(contextText).toContain('page_path = 库根下 wiki/** 相对路径');
    expect(contextText).toContain('kb_url = 空串');
    expect(contextText).toContain('不 ingest 外部 URL');
    expect(contextText).toContain('wiki_search/wiki_read/wiki_write 不可用（未注册）');
  });

  it('DT local: 挂 KB 写护栏（库根写放行；库根外拒）+ 上下文注入 local KB mode 评审页行', async () => {
    const { guards, contextText, kbRoot } = await runKbRole('dt', 'review-impl', 'local');
    expect(guards).toHaveLength(1);
    const g = guards[0] as (e: { name?: string; arguments?: unknown }) => string | undefined;
    // local 模式 DT 换 KB 护栏：库根内 fs 写放行（评审页经 fs 写库根），不再走 review namespace 收窄
    expect(g({ name: 'write', arguments: { path: join(kbRoot, 'wiki/queries/ch_x/review/r.md') } })).toBeUndefined();
    expect(g({ name: 'write', arguments: { path: '/ws/main/src/foo.ts' } })).toMatch(/write-to-repo-source-denied/);
    expect(contextText).toContain('## 本地知识库（local KB mode）');
    expect(contextText).toContain(`- 本地库根：${kbRoot}`);
    expect(contextText).toContain('- 评审页经 fs 写 <库根>/wiki/queries/ch_<chainId>/review/<name>.md（库根外一律只读）');
    // DT 不注入 W 的五要素块，也不注入 D 的计划读取行
    expect(contextText).not.toContain('## 知识库（本地模式）');
    expect(contextText).not.toContain('- 实施计划原文 = 父任务交接 page_path');
  });

  it('DT remote: 仍 DT 收窄护栏（库根写拒绝）+ 上下文不含 local KB mode 块', async () => {
    const { guards, contextText, kbRoot } = await runKbRole('dt', 'review-impl', 'remote');
    expect(guards).toHaveLength(1);
    const g = guards[0] as (e: { name?: string; arguments?: unknown }) => string | undefined;
    expect(g({ name: 'write', arguments: { path: join(kbRoot, 'wiki/queries/ch_x/review/r.md') } })).toMatch(/write-to-repo-source-denied/);
    expect(contextText).not.toContain('## 本地知识库（local KB mode）');
  });

  it('D local（align）: 上下文注入 local KB mode 库根 + 计划读取行（fs 读 <库根>/<page_path>）', async () => {
    const { contextText, kbRoot } = await runKbRole('d', 'align', 'local');
    expect(contextText).toContain('## 本地知识库（local KB mode）');
    expect(contextText).toContain(`- 本地库根：${kbRoot}`);
    expect(contextText).toContain('- 实施计划原文 = 父任务交接 page_path（库根下 wiki/** 相对路径）→ 直接 fs 读 <库根>/<page_path>');
    expect(contextText).not.toContain('- 评审页经 fs 写 <库根>/wiki/queries');
  });

  it('P local: 恒 plan 写护栏（openspec/changes 放行；库根写拒）——P 不受 KB 模式影响', async () => {
    const { guards, contextText, kbRoot } = await runKbRole('p', 'openspec', 'local');
    expect(guards).toHaveLength(1);
    const g = guards[0] as (e: { name?: string; arguments?: unknown }) => string | undefined;
    expect(g({ name: 'write', arguments: { path: '/ws/main/openspec/changes/autoNote-tab/design.md' } })).toBeUndefined();
    expect(g({ name: 'write', arguments: { path: join(kbRoot, 'wiki/x.md') } })).toMatch(/plan-guard/);
    expect(contextText).not.toContain('## 知识库（本地模式）');
    expect(contextText).not.toContain('## 本地知识库（local KB mode）');
  });
});
