import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  packagePresetsDir,
  readPresetDefinition,
  registerRolePresets,
  installRolePresets,
  userPresetsRoot,
  type PresetDefinitionLike,
  type PresetRegistryLike,
} from '../src/roles/preset-installer.js';

function fakeRegistry(impl?: (definition: PresetDefinitionLike) => Promise<() => Promise<void>>): {
  registry: PresetRegistryLike;
  definitions: PresetDefinitionLike[];
} {
  const definitions: PresetDefinitionLike[] = [];
  const registry: PresetRegistryLike = {
    register: impl ?? (async (definition) => {
      definitions.push(definition);
      return async () => {};
    }),
  };
  return { registry, definitions };
}

describe('readPresetDefinition（包内组合 → 宿主 registry 定义）', () => {
  it('kanban-v：元数据取自 preset.yml，plugins 取自 agent.cordis.yml 行', () => {
    const def = readPresetDefinition(packagePresetsDir(), 'kanban-v');
    expect(def).toBeDefined();
    expect(def?.id).toBe('kanban-v');
    expect(def?.name).toBe('看板编排官（V）');
    expect(typeof def?.description).toBe('string');
    // V 零执行能力：组合仅 persona + agent-instructions 两行
    expect(def?.plugins.map((row) => row.name)).toEqual([
      '@deepseek-ai/dsh-persona',
      '@deepseek-ai/dsh-agent-instructions',
    ]);
  });

  it('!!js disabled 行保持 { __jsExpr } 表达式节点（与宿主 Loader 方言一致，禁解析期求值）', () => {
    const def = readPresetDefinition(packagePresetsDir(), 'kanban-p');
    expect(def).toBeDefined();
    const bash = def?.plugins.find((row) => row.id === 'tool-bash');
    expect(bash).toBeDefined();
    expect(bash?.disabled).toEqual({ __jsExpr: "process.platform === 'win32'" });
  });

  it('组合缺失的 id 返回 undefined', () => {
    expect(readPresetDefinition(packagePresetsDir(), 'no-such-preset')).toBeUndefined();
  });
});

describe('registerRolePresets（运行时注册路径）', () => {
  it('包内每个带组合的 preset 逐个 register，定义 id 与目录一致', async () => {
    const { registry, definitions } = fakeRegistry();
    const { registered, failed } = await registerRolePresets(registry, ['kanban-v', 'kanban-p', 'swarm']);
    expect(failed).toEqual([]);
    expect(registered).toEqual(['kanban-v', 'kanban-p', 'swarm']);
    expect(definitions.map((def) => def.id)).toEqual(['kanban-v', 'kanban-p', 'swarm']);
    for (const def of definitions) {
      expect(def.plugins.length).toBeGreaterThan(0);
      expect(def.plugins.every((row) => typeof row.name === 'string' && row.name !== '')).toBe(true);
    }
  });

  it('宿主报 Duplicate agent preset 视为已注册（重 apply 幂等），不抛出', async () => {
    const { registry } = fakeRegistry(async () => {
      throw new Error('Duplicate agent preset: kanban-v');
    });
    const { registered, failed } = await registerRolePresets(registry, ['kanban-v']);
    expect(registered).toEqual(['kanban-v']);
    expect(failed).toEqual([]);
  });

  it('其余注册错误收集进 failed，不阻断其余 preset', async () => {
    const { registry } = fakeRegistry(async (definition) => {
      if (definition.id === 'kanban-p') throw new Error('boom');
      return async () => {};
    });
    const { registered, failed } = await registerRolePresets(registry, ['kanban-v', 'kanban-p']);
    expect(registered).toEqual(['kanban-v']);
    expect(failed).toEqual(['kanban-p']);
  });
});

describe('installRolePresets（双路安装）', () => {
  it('无 agentPresets 服务：目录写完成、不抛出、如实标注 unavailable', async () => {
    const report = await installRolePresets({}, { registerWaitMs: 5 });
    expect(report.dirWritten).toContain('kanban-v');
    expect(report.runtimeMode).toBe('unavailable');
    expect(report.runtimeRegistered).toEqual([]);
    // 目录写路径的落盘形态保持 0.1.7 兼容：preset 根下存在组合文件
    expect(existsSync(join(userPresetsRoot(), 'kanban-v', 'agent.cordis.yml'))).toBe(true);
  }, 15000);

  it('有 agentPresets 服务：对服务逐个 register（不假阳性）', async () => {
    const { registry, definitions } = fakeRegistry();
    const report = await installRolePresets({ get: (name) => (name === 'agentPresets' ? registry : undefined) }, { registerWaitMs: 5 });
    expect(report.runtimeMode).toBe('runtime');
    expect(report.runtimeRegistered).toEqual(['kanban-v', 'kanban-p', 'kanban-w', 'kanban-d', 'kanban-pt', 'kanban-dt', 'swarm']);
    expect(report.runtimeFailed).toEqual([]);
    expect(definitions.map((def) => def.id)).toEqual(report.runtimeRegistered);
  }, 15000);

  it('agentPresets 服务延迟就绪：轮询等到后照常注册', async () => {
    const { registry, definitions } = fakeRegistry();
    let ready = false;
    setTimeout(() => { ready = true; }, 30);
    const report = await installRolePresets({ get: (name) => (ready && name === 'agentPresets' ? registry : undefined) }, { registerWaitMs: 5000 });
    expect(report.runtimeMode).toBe('runtime');
    expect(definitions.length).toBe(7);
  }, 15000);
});
