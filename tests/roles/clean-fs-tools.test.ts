import { describe, it, expect, vi, afterEach } from 'vitest';
import { installCleanFsTools, ESCALATION_PARAM_KEYS } from '../../src/roles/clean-fs-tools.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { AgentRunner } from '../../src/dispatcher/agent-runner.js';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** 仿宿主 defineTool 编译后的 write 形态（dsh-tool-fs lib/index.js:608-631：parameters 为
 *  parameterSchemaSpecToJsonSchema 产物 = { type:'object', properties, required }，
 *  sandbox_permissions/justification 经 schemaFields() 合入 properties（可选，不入 required）——
 *  默认带毒（有沙箱后端的组合形态），模拟无沙箱组合时传 extraProps 覆盖。 */
function hostLikeDefinition(name: string, extraProps: Record<string, unknown> = {}) {
  return {
    name,
    description: name + ' tool',
    parameters: {
      type: 'object',
      properties: {
        ...(name === 'bash' ? { command: { type: 'string' } } : {}),
        ...(name !== 'bash' ? { file_path: { type: 'string' }, content: { type: 'string' } } : {}),
        sandbox_permissions: { type: 'string', description: 'escalation' },
        justification: { type: 'string', description: 'escalation why' },
        ...extraProps,
      },
      required: name === 'bash' ? ['command'] : ['file_path', 'content'],
    },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: vi.fn(async (_args: unknown, _exec: unknown) => ({ ok: true })),
  };
}

/** 仿 dsh-tools 分层注册表：global 层 + agent own 层（own 覆盖同名 = shadow 语义，
 *  同层重复注册抛错——对齐 dsh-scope ScopedLayers/NamedEntries 行为的最小子集）。 */
function fakeRuntime(hostDefs: Record<string, object>) {
  const global = new Map<string, object>();
  const own = new Map<string, object>();
  for (const [n, d] of Object.entries(hostDefs)) global.set(n, d);
  const runtime = {
    register(def: { name: string }) {
      if (own.has(def.name)) throw new Error(`tool "${def.name}" already registered in this scope`);
      own.set(def.name, def);
      return () => own.delete(def.name);
    },
    get(name: string, scope?: unknown) {
      // scope 非空 = agent 视角：own 层 shadow 全局；scope 空 = 全局视角
      if (scope !== undefined && scope !== null) return own.get(name) ?? global.get(name);
      return global.get(name);
    },
  };
  return { runtime, global, own };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('installCleanFsTools（danger-full-access 会话 shadow 去毒，sandbox-menu-align Task 1）', () => {
  it('shadow 注册后模型可见 schema 无 sandbox_permissions/justification，其余参数原样保留', () => {
    const host = {
      write: hostLikeDefinition('write'),
      edit: hostLikeDefinition('edit'),
      bash: hostLikeDefinition('bash'),
    };
    const { runtime, own } = fakeRuntime(host);
    const agentCtx = { tools: runtime } as never;
    const agent = { session: {} };
    installCleanFsTools(agentCtx, agent);
    for (const name of ['write', 'edit', 'bash']) {
      const shadow = own.get(name) as typeof host.write | undefined;
      expect(shadow, name + ' shadow must be registered in agent own layer').toBeTruthy();
      const props = (shadow!.parameters as { properties: Record<string, unknown> }).properties;
      for (const key of ESCALATION_PARAM_KEYS) expect(props, name + '.' + key).not.toHaveProperty(key);
      // 其余参数与宿主一致
      expect(Object.keys(props)).toEqual(Object.keys((host[name as 'write'].parameters as { properties: Record<string, unknown> }).properties).filter((k) => !ESCALATION_PARAM_KEYS.includes(k as never)));
      // required 不含被删字段
      const required = (shadow!.parameters as { required: string[] }).required;
      for (const key of ESCALATION_PARAM_KEYS) expect(required).not.toContain(key);
      // output/description 等其余定义面保持宿主原样（行为 100% 官方的呈现面）
      expect(shadow!.description).toBe(host[name as 'write'].description);
      expect(shadow!.output).toBe(host[name as 'write'].output);
    }
  });

  it('execute 剥参转发：带参调用 → 宿主原工具收到净化参数，exec 原样透传', async () => {
    const host = { write: hostLikeDefinition('write') };
    const { runtime } = fakeRuntime(host);
    installCleanFsTools({ tools: runtime } as never, { session: {} });
    const shadow = runtime.get('write', { session: {} }) as typeof host.write;
    const exec = { callId: 'c1', signal: new AbortController().signal };
    await shadow.execute({ file_path: '/ws/openspec/changes/x.md', content: 'hi', sandbox_permissions: 'workspace-write', justification: 'need' }, exec);
    expect(host.write.execute).toHaveBeenCalledTimes(1);
    const [seenArgs, seenExec] = (host.write.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(seenArgs).toEqual({ file_path: '/ws/openspec/changes/x.md', content: 'hi' });
    expect(seenArgs).not.toHaveProperty('sandbox_permissions');
    expect(seenArgs).not.toHaveProperty('justification');
    expect(seenExec).toBe(exec); // exec 原样透传（callId/signal/agent 不断链）
  });

  it('裸调用（无带毒参数）原对象透传，零拷贝零改写', async () => {
    const host = { bash: hostLikeDefinition('bash') };
    const { runtime } = fakeRuntime(host);
    installCleanFsTools({ tools: runtime } as never, { session: {} });
    const shadow = runtime.get('bash', { session: {} }) as typeof host.bash;
    const args = { command: 'npm test' };
    await shadow.execute(args, { callId: 'c2' });
    expect((host.bash.execute as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(args);
  });

  it('仅一侧带毒参数也归一（历史惯性：只塞 sandbox_permissions 不塞 justification）', async () => {
    const host = { edit: hostLikeDefinition('edit') };
    const { runtime } = fakeRuntime(host);
    installCleanFsTools({ tools: runtime } as never, { session: {} });
    const shadow = runtime.get('edit', { session: {} }) as typeof host.edit;
    await shadow.execute({ file_path: 'a.md', sandbox_permissions: 'workspace-write' }, {});
    expect((host.edit.execute as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ file_path: 'a.md' });
  });

  it('宿主原工具不可达 → 该工具不注册 + console.error 显形（fail-safe：绝不自实现写逻辑）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runtime, own } = fakeRuntime({}); // 空全局层：宿主 write/edit/bash 均不可达
    installCleanFsTools({ tools: runtime } as never, { session: {} });
    expect(own.size).toBe(0);
    for (const name of ['write', 'edit', 'bash']) {
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes(name))).toBe(true);
    }
  });

  it('无 execute 的宿主定义（异常宿主）→ 不注册，绝不落地自实现半成品', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runtime, own } = fakeRuntime({ write: { name: 'write', parameters: { type: 'object', properties: {} } } });
    installCleanFsTools({ tools: runtime } as never, { session: {} });
    expect(own.has('write')).toBe(false);
  });

  it('幂等：setup 重入/live 修复重复安装不重复注册（同层重复注册会抛错）', () => {
    const host = { write: hostLikeDefinition('write') };
    const { runtime, own } = fakeRuntime(host);
    const agent = { session: {} };
    installCleanFsTools({ tools: runtime } as never, agent);
    installCleanFsTools({ tools: runtime } as never, agent);
    expect([...own.keys()].filter((n) => n === 'write')).toHaveLength(1);
  });

  it('同层重复注册冲突被吞掉且显形（宿主版本保持可见，不炸 setup）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = { write: hostLikeDefinition('write') };
    const { runtime, own } = fakeRuntime(host);
    const agent = { session: {} };
    // 占位者 = 带毒定义（schema 含 sandbox_permissions，模拟同层已有人先注册了同名工具）：
    // get(name, agent) 返回它后 poisoned=true，register 真抛同层冲突 → 走 catch 显形降级。
    const placeholder = hostLikeDefinition('write');
    own.set('write', placeholder); // 预先占用 own 层
    expect(() => installCleanFsTools({ tools: runtime } as never, agent)).not.toThrow(); // 不炸 setup
    expect(own.get('write')).toBe(placeholder); // 占位者未被覆盖（register 冲突被吞，shadow 未落地）
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('shadow register failed') && String(c[0]).includes('write'))).toBe(true);
  });

  it('无 tools 服务（测试桩形态）→ 静默跳过不抛', () => {
    expect(() => installCleanFsTools({} as never, { session: {} })).not.toThrow();
  });

  it('宿主 schema 本就干净（无沙箱组合）→ 不 shadow（最小触碰面，不去盖干净的版本）', () => {
    const cleanDef = hostLikeDefinition('write', {}); // 先造带毒形态再手工剥成干净组合形态
    delete (cleanDef.parameters as { properties: Record<string, unknown> }).properties['sandbox_permissions'];
    delete (cleanDef.parameters as { properties: Record<string, unknown> }).properties['justification'];
    const { runtime, own } = fakeRuntime({ write: cleanDef });
    installCleanFsTools({ tools: runtime } as never, { session: {} });
    expect(own.has('write')).toBe(false);
  });
});

describe('agent-runner 挂载条件（仅 P 与 D(execute) 挂 shadow；W/PT/DT/V 与 D 非 execute 不挂）', () => {
  /** 与 toolsets.test.ts「agent-runner mounts kanban-<role> preset」同款装配：捕获 setup 后
   *  以仿 agentCtx 直呼，断言 shadow 注册面。 */
  async function setupFor(assignee: 'p' | 'w' | 'd' | 'pt' | 'dt', mode: string) {
    const dir = mkdtempSync(join(tmpdir(), 'runner-cleanfs-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: '/ws/main' }, 'human');
      await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: '', out_of_scope: '' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't', assignee, mode: mode as never }, 'v');
      let capturedSetup: unknown = null;
      const agents = {
        create: async (o: { setup?: unknown }) => {
          capturedSetup = o.setup;
          return { agent: { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [] } } };
        },
      };
      const ctx = { get: (n: string) => (n === 'agents' ? agents : undefined) };
      const runner = new AgentRunner(ctx as never, svc, { getEffective: () => ({}) } as never, {} as unknown as WikiVaultClient, undefined,
        // dt 走 spawn 前 ocr 预检：注入已装 fake 保持本文件聚焦 shadow 挂载条件（其他角色不触发探活）
        { probeOcrFn: async () => ({ installed: true, version: 't', binPath: null }) });
      await runner.runTask(t.id);
      return capturedSetup as (agentCtx: unknown) => Promise<void>;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  async function shadowNamesFor(assignee: 'p' | 'w' | 'd' | 'pt' | 'dt', mode: string): Promise<string[]> {
    const setup = await setupFor(assignee, mode);
    const host = {
      write: hostLikeDefinition('write'),
      edit: hostLikeDefinition('edit'),
      bash: hostLikeDefinition('bash'),
      read: hostLikeDefinition('read'),
    };
    const { runtime, own } = fakeRuntime(host);
    const agentCtx = {
      get: () => undefined,
      agent: { session: { append: vi.fn() } },
      on: () => () => {},
      tools: runtime,
    };
    await setup(agentCtx);
    return [...own.keys()].filter((n) => ['write', 'edit', 'bash'].includes(n)).sort();
  }

  it('P(openspec)：挂 write/edit/bash shadow', async () => {
    expect(await shadowNamesFor('p', 'openspec')).toEqual(['bash', 'edit', 'write']);
  });
  it('D(execute)：挂 write/edit/bash shadow', async () => {
    expect(await shadowNamesFor('d', 'execute')).toEqual(['bash', 'edit', 'write']);
  });
  it('D(align 非 execute)：workspace-write 会话不挂（扩权参数是合法功能）', async () => {
    expect(await shadowNamesFor('d', 'align')).toEqual([]);
  });
  it('W：fullAccess 但 I2 全拒 write，shadow 无意义不挂（最小挂载面）', async () => {
    expect(await shadowNamesFor('w', 'kb')).toEqual([]);
  });
  it('PT/DT：workspace-write 评审会话不挂', async () => {
    expect(await shadowNamesFor('pt', 'review-plan')).toEqual([]);
    expect(await shadowNamesFor('dt', 'review-impl')).toEqual([]);
  });
});
