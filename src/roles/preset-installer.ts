// src/roles/preset-installer.ts
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 角色裁剪 preset 的运行时安装（2026-08-15 取舍记录）：
 * - 组合文件随包分发（personas/kanban-{v,p,w,d}/agent.cordis.yml，随 npm 包分发）。
 *   kanban-v 于 2026-08-17 补充：V=butler·orchestrator 零执行能力，组合仅 persona+instructions。
 * - 官方 dsh-agent-presets 的 roots 在 web 启动的 composeProfile 中被强制覆盖为
 *   官方 shipped root 单一路径（profile-boot 内 SHIPPED_PRESET_ROOT 硬编码），
 *   因此 cordis.patch.yml 追加 roots 指向包内目录在真实 API 下无效；
 *   唯一可发现的自定义根是 includeUserRoot 派生的 `$DSH_HOME/.agent-presets`。
 * - 故插件 apply 时把包内组合复制到 `$DSH_HOME/.agent-presets/<id>/`，
 *   agentPresets.mount(agentCtx, 'kanban-v'|'kanban-p'|'kanban-w'|'kanban-d') 即可解析。
 * - 幂等：重复安装覆盖同名文件；缺组合文件（未随包）则跳过并让 runner 降级日志。
 */
const PRESET_IDS = ['kanban-v', 'kanban-p', 'kanban-w', 'kanban-d', 'kanban-pt', 'kanban-dt', 'swarm'] as const;

/** 包内组合目录（随包分发）。src/roles/ 与 lib/roles/ 深度一致，均经 ../../ 回到包根。 */
export function packagePresetsDir(): string {
  return fileURLToPath(new URL('../../personas/', import.meta.url));
}

/** $DSH_HOME/.agent-presets（agent-presets 服务 includeUserRoot 派生根；DSH_HOME 缺省 ~/.dsh）。 */
export function userPresetsRoot(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.agent-presets');
}

/** 安装角色裁剪 preset 到用户预设根；返回成功安装的 preset id 列表（空=无随包组合）。
 *  尽力而为：单 preset 写失败（用户预设根不可写等）仅告警不抛出，
 *  后续 agentPresets.mount('kanban-<role>') 失败由 runner 降级日志兜底。 */
export function installRolePresets(): string[] {
  const src = packagePresetsDir();
  const dstRoot = userPresetsRoot();
  const installed: string[] = [];
  for (const id of PRESET_IDS) {
    const srcFile = join(src, id, 'agent.cordis.yml');
    if (!existsSync(srcFile)) continue;
    try {
      const dstDir = join(dstRoot, id);
      mkdirSync(dstDir, { recursive: true });
      copyFileSync(srcFile, join(dstDir, 'agent.cordis.yml'));
      const meta = join(src, id, 'preset.yml');
      if (existsSync(meta)) copyFileSync(meta, join(dstDir, 'preset.yml'));
      installed.push(id);
    } catch (err) {
      // 尽力而为：写入失败（如沙箱/权限拒绝）仅告警，不阻断插件启动
      console.warn('[dsh-swarm] role preset install skipped ' + id + ' -> ' + dstRoot + ': ' + String(err));
    }
  }
  return installed;
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
