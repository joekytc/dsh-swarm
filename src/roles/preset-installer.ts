// src/roles/preset-installer.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSON_SCHEMA, load as loadYaml, Type } from 'js-yaml';

/**
 * 角色裁剪 preset 的双路安装：
 *
 * 路径一 · 目录写（0.1.7-rc.x 宿主的底线）：把包内组合复制到 `$DSH_HOME/.agent-presets/<id>/`，
 * 老宿主的 agent-presets 发现逻辑扫该目录完成装载。0.2.0 宿主不再扫描任何目录，此路不影响新宿主。
 *
 * 路径二 · 运行时注册（0.2.0 起的唯一生效路径）：0.2.0 的 dsh-agent-preset-registry 是纯运行时
 * 服务，preset 定义只经 `agentPresets.register(definition)` 进入（官方 dsh-agent-preset 插件
 * 即在 Service.init 中 yield register(config)），无任何目录发现。本插件经 ctx 取 agentPresets
 * 服务（未就绪则短轮询等待），把与目录写同一份 yml 解析出的定义注册进去，两个路径语义同源。
 *
 * 幂等：目录写覆盖同名文件；运行时注册遇宿主 "Duplicate agent preset" 视为已注册成功。
 * 尽力而为：单 preset 目录写/注册失败仅告警不阻断插件启动，后续挂载失败由 runner 降级日志兜底。
 */
const PRESET_IDS = ['kanban-v', 'kanban-p', 'kanban-w', 'kanban-d', 'kanban-pt', 'kanban-dt', 'swarm'] as const;

/** 等待 agentPresets 服务就绪的超时（宿主组合启动期服务装配可能晚于插件 apply）。 */
const REGISTER_WAIT_MS = 60000;

/** 包内组合目录（随包分发）。src/roles/ 与 lib/roles/ 深度一致，均经 ../../ 回到包根。 */
export function packagePresetsDir(): string {
  return fileURLToPath(new URL('../../personas/', import.meta.url));
}

/** $DSH_HOME/.agent-presets（0.1.7-rc.x 宿主用户预设根；DSH_HOME 缺省 ~/.dsh）。 */
export function userPresetsRoot(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.agent-presets');
}

/** 单条 preset 组合行（官方 PresetDefinition.plugins 行的结构面：cordis entry list）。 */
export interface PresetPluginRow {
  readonly id?: string;
  readonly name: string;
  readonly config?: unknown;
  readonly disabled?: unknown;
}

/** 注册给宿主 registry 的 preset 定义（官方 PresetDefinition 的结构面）。 */
export interface PresetDefinitionLike {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly order?: number;
  readonly plugins: readonly PresetPluginRow[];
}

/** 宿主 agentPresets registry 的结构面（本插件只消费 register）。 */
export interface PresetRegistryLike {
  register(definition: PresetDefinitionLike): Promise<() => Promise<void>>;
}

/** 安装期 ctx 的最小面（只需可选 get）。 */
export interface PresetCtxLike {
  get?(name: string): unknown;
}

// 宿主 entry-list YAML 方言的镜像（@deepseek-ai/cordis-plugin-include 的 entryListSchema）：
// `!!js` 标量解析为 { __jsExpr } 表达式节点，由宿主 Loader 在行激活时求值（组合内
// `disabled: !!js process.platform === 'win32'` 等行依赖此节点形态，禁在解析期求值）。
const JS_EXPR_TAG = new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data: string) => typeof data === 'string',
  construct: (data: string) => ({ __jsExpr: data }),
});
const ENTRY_LIST_SCHEMA = JSON_SCHEMA.extend(JS_EXPR_TAG);

/** 镜像宿主 registry 的入口列表形状校验：顶层为带 name 的行数组（组行递归其 config）。 */
function entryListProblem(rows: unknown, at = ''): string | undefined {
  if (!Array.isArray(rows)) return at === '' ? 'composition must be a top-level list of plugin rows' : `group ${at} must hold a list of plugin rows`;
  for (const [index, row] of rows.entries()) {
    const label = at === '' ? `row ${String(index + 1)}` : `${at} row ${String(index + 1)}`;
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return `${label} is not a plugin row`;
    const name = (row as { name?: unknown }).name;
    if (typeof name !== 'string' || name === '') return `${label} names no plugin (a "name" string is required)`;
    const config = (row as { config?: unknown; group?: unknown }).config;
    if ((row as { group?: unknown }).group === true && config !== undefined) {
      const nested = entryListProblem(config, label);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

/** 解析包内单个 preset 的组合与元数据为宿主 registry 定义；组合缺失返回 undefined。 */
export function readPresetDefinition(pkgDir: string, id: string): PresetDefinitionLike | undefined {
  const srcFile = join(pkgDir, id, 'agent.cordis.yml');
  if (!existsSync(srcFile)) return undefined;
  let rows: unknown;
  let meta: { name?: unknown; description?: unknown; order?: unknown };
  try {
    rows = loadYaml(readFileSync(srcFile, 'utf8'), { schema: ENTRY_LIST_SCHEMA });
    const metaFile = join(pkgDir, id, 'preset.yml');
    meta = existsSync(metaFile)
      ? loadYaml(readFileSync(metaFile, 'utf8'), { schema: JSON_SCHEMA }) as typeof meta
      : {};
  } catch (err) {
    console.warn('[dsh-swarm] role preset parse failed ' + id + ': ' + String(err));
    return undefined;
  }
  const problem = entryListProblem(rows);
  if (problem !== undefined) {
    console.warn('[dsh-swarm] role preset composition invalid ' + id + ': ' + problem);
    return undefined;
  }
  const definition: { id: string; name?: string; description?: string; order?: number; plugins: readonly PresetPluginRow[] } = {
    id,
    plugins: rows as readonly PresetPluginRow[],
  };
  if (typeof meta.name === 'string') definition.name = meta.name;
  if (typeof meta.description === 'string') definition.description = meta.description;
  if (typeof meta.order === 'number') definition.order = meta.order;
  return definition;
}

/** 路径一：目录写（0.1.7-rc.x 宿主发现根）。返回成功写入的 preset id 列表。 */
function writeUserDirPresets(): string[] {
  const src = packagePresetsDir();
  const dstRoot = userPresetsRoot();
  const written: string[] = [];
  for (const id of PRESET_IDS) {
    const srcFile = join(src, id, 'agent.cordis.yml');
    if (!existsSync(srcFile)) continue;
    try {
      const dstDir = join(dstRoot, id);
      mkdirSync(dstDir, { recursive: true });
      copyFileSync(srcFile, join(dstDir, 'agent.cordis.yml'));
      const meta = join(src, id, 'preset.yml');
      if (existsSync(meta)) copyFileSync(meta, join(dstDir, 'preset.yml'));
      written.push(id);
    } catch (err) {
      // 尽力而为：写入失败（如沙箱/权限拒绝）仅告警，不阻断插件启动
      console.warn('[dsh-swarm] role preset dir write skipped ' + id + ' -> ' + dstRoot + ': ' + String(err));
    }
  }
  return written;
}

/** 路径二：运行时注册全部包内 preset；返回注册成功/失败 id 列表与成功项的撤销句柄（组合缺失的 id 不计）。 */
export async function registerRolePresets(
  registry: PresetRegistryLike,
  ids: readonly string[],
  pkgDir = packagePresetsDir(),
): Promise<{ registered: string[]; failed: string[]; disposers: Array<() => Promise<void>> }> {
  const registered: string[] = [];
  const failed: string[] = [];
  const disposers: Array<() => Promise<void>> = [];
  for (const id of ids) {
    const definition = readPresetDefinition(pkgDir, id);
    if (!definition) continue;
    try {
      disposers.push(await registry.register(definition));
      registered.push(id);
    } catch (err) {
      // 插件重 apply 时定义已在 registry：与首次注册语义等价，按成功计
      if (String(err).includes('Duplicate agent preset')) {
        registered.push(id);
        continue;
      }
      failed.push(id);
      console.warn('[dsh-swarm] role preset runtime register failed ' + id + ': ' + String(err));
    }
  }
  return { registered, failed, disposers };
}

/** 短轮询等待宿主 agentPresets 服务就绪；超时返回 undefined（降级仅目录写）。 */
async function waitForPresets(ctx: PresetCtxLike, timeoutMs: number): Promise<PresetRegistryLike | undefined> {
  const started = Date.now();
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      const found = ctx.get?.('agentPresets');
      if (found) {
        clearInterval(poll);
        resolve(found as PresetRegistryLike);
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(poll);
        resolve(undefined);
      }
    }, 500);
  });
}

/** 安装结果（如实区分两条路径，不假阳性）。 */
export interface RolePresetInstallReport {
  /** 目录写成功的 preset id（路径一）。 */
  dirWritten: string[];
  /** 运行时注册成功的 preset id（路径二；服务不可用时为空）。 */
  runtimeRegistered: string[];
  /** 运行时注册失败的 preset id。 */
  runtimeFailed: string[];
  /** 路径二实际形态：runtime=已注册；unavailable=宿主无 agentPresets 服务（仅目录写生效）。 */
  runtimeMode: 'runtime' | 'unavailable';
}

/**
 * 双路安装入口。目录写同步完成并即时留痕；运行时注册等服务就绪后完成并留痕。
 * 返回前目录写已落盘；注册部分异步收敛（fire-and-forget 调用方须 catch）。
 */
export async function installRolePresets(ctx: PresetCtxLike, opts: { registerWaitMs?: number } = {}): Promise<RolePresetInstallReport> {
  const dirWritten = writeUserDirPresets();
  console.info('[dsh-swarm] role preset dir write: ' + (dirWritten.length ? dirWritten.join(',') : 'none'));
  const registry = await waitForPresets(ctx, opts.registerWaitMs ?? REGISTER_WAIT_MS);
  if (!registry) {
    console.warn('[dsh-swarm] role presets installed: dir-write=' + (dirWritten.join(',') || 'none')
      + ' runtime-register=none (agentPresets service unavailable; directory write only)');
    return { dirWritten, runtimeRegistered: [], runtimeFailed: [], runtimeMode: 'unavailable' };
  }
  const { registered, failed, disposers } = await registerRolePresets(registry, PRESET_IDS);
  console.info('[dsh-swarm] role presets installed: dir-write=' + (dirWritten.join(',') || 'none')
    + ' runtime-register=' + (registered.join(',') || 'none')
    + (failed.length ? ' failed=' + failed.join(',') : ''));
  // 插件卸载/重载时撤销注册，避免宿主 registry 留下失效定义（官方 register 契约：声明方持有 disposer）。
  (ctx as unknown as { on?(name: string, fn: () => void): unknown }).on?.('dispose', () => {
    for (const dispose of disposers.splice(0)) void dispose().catch(() => {});
  });
  const report: RolePresetInstallReport = { dirWritten, runtimeRegistered: registered, runtimeFailed: failed, runtimeMode: 'runtime' };
  return report;
}

/** 角色 preset 挂载的容器面（dsh-agent-presets roster 的最小结构类型）。 */
export interface PresetMountLike {
  mount(ctx: unknown, id: string): Promise<unknown>;
  /** 官方重链入口（0.1.2-rc.1 起提供）：已绑定 → binding.rebind；未绑定 → bind。 */
  recompose?(ctx: unknown, id: string): Promise<unknown>;
}

/**
 * preset 挂载收敛入口（2026-09-21 事故修复）：宿主 dsh-scope 的 scope key 绑定在进程
 * 生命周期内一次性（bindScopeParent 重复调用抛 "already bound to a parent"），官方重链
 * 入口是 recompose（已绑 → binding.rebind）。同 agentKey 的二次 setup（P/W/D 卡 blocked/
 * unblock 多轮唤醒 resume 同一 session、live 复用 re-setup 补挂）此前直接二次 mount 必炸。
 * 收敛语义：mount 失败且系 already-bound → recompose 重链；其余错误（组合不可用等）原样上抛。
 */
export async function mountOrRecompose(presets: PresetMountLike, agentCtx: unknown, presetId: string): Promise<void> {
  try {
    await presets.mount(agentCtx, presetId);
  } catch (err) {
    if (!String(err).includes('already bound to a parent') || typeof presets.recompose !== 'function') throw err;
    await presets.recompose(agentCtx, presetId);
  }
}
