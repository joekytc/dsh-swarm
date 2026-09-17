import { Service, type Context } from '@deepseek-ai/cordis';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { KanbanService } from '../domain/kanban-service.js';
import { FileEventStore } from '../domain/event-store.js';
import { deriveGatePlan, branchMatches, resolveDiffBase } from '../domain/gate-policy.js';
import { runGateCommands } from './gate-runner.js';
import { writeGateLog } from './gate-evidence.js';
import type { GateHookVerdict } from '../domain/kanban-service.js';
import type { KanbanConfig } from '../config.js';
import type { ConfigProvider } from './config-provider.js';

declare module '@deepseek-ai/cordis' {
  interface Context { kanban: KanbanProvider; }
}

export class KanbanProvider extends Service {
  readonly service: KanbanService;
  /** GUI retry 的任务执行器（由 startDispatcher 装配后注入；webServer 先于 agents 就绪时可为 null）。 */
  runner: { runTask(taskId: string): Promise<void> } | null = null;
  /** 整链硬删除后的联动钩子（由 startDispatcher 装配注入）：dispatcher 游标同步 + V 编排 entry 清理。
   *  purge 物理重排 events seq，若不同步则删链后新建链的可唤醒事件被运行中实例永久跳过。 */
  onChainDeleted: ((chainId: string) => Promise<void> | void) | null = null;
  // 经 configProvider getter 读 effective 配置——配置面板改 wikiVault.baseUrl 后 kb_url 前缀校验热生效。
  private readonly gateLogDir: string;
  constructor(ctx: Context, config: KanbanConfig, configProvider: ConfigProvider) {
    super(ctx, 'kanban');
    const dir = config.storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? homedir());
    this.gateLogDir = dir;
    this.service = new KanbanService(new FileEventStore(dir), () => configProvider.getEffective().wikiVault?.baseUrl);
    // P1 实测闸装配（组合根）：complete 前派生 GateOutcome → 分支核对 → 实测执行/打回/警报。
    // hook 绝不 throw：意外异常记日志并返回 null（基建故障静默，既有决议）。
    // diff 实况：base=D 卡 body 的 TARGET_BRANCH（gate-policy resolveDiffBase）；git 失败或无 base → null（派生层保守放行）。
    this.service.setGateHook(async (task, handoff): Promise<GateHookVerdict> => {
      try {
        // 热读取（同 wikiVault.baseUrl 先例，getEffective）：配置面板改 gates 后无需重建即生效。
        const cfg = configProvider.getEffective().gates ?? { enabled: true, timeoutMs: 600000, forbidden: ['rm -rf /', 'git push'] };
        const metadata = (handoff.metadata ?? {}) as Record<string, unknown>;
        const wt = typeof metadata['worktree_dir'] === 'string' ? metadata['worktree_dir'] : '';
        const base = resolveDiffBase(task.body ?? '');
        const diffFiles = wt.trim() && base ? await gitDiffNames(wt, base) : null;
        const outcome = deriveGatePlan({
          assignee: task.assignee, mode: task.mode, handoff,
          config: { enabled: cfg.enabled }, diffFiles,
        });
        if (outcome.kind === 'silent-skip') return null; // 不适用：零事件（旧语义）
        if (outcome.kind === 'alarm-skip') return { skipped: true, reason: outcome.reason };
        if (outcome.kind === 'bounce') return { ok: false, detail: outcome.reason };
        // run：分支一致性核对（⑦ 不一致由静默 skip 升级为 bounce 打回）
        const current = await gitCurrentBranch(outcome.commands[0]!.cwd);
        if (!branchMatches(current, metadata['branch']))
          return { ok: false, detail: `分支不一致：声明 ${String(metadata['branch'] ?? '')}，实际 ${current ?? 'unknown'}——先同步分支再重交` };
        const report = await runGateCommands(outcome.commands, { timeoutMs: cfg.timeoutMs, forbidden: cfg.forbidden });
        // 落盘失败不吞实测结果（评审 Minor）：测量已做，结论必须保住——仅降级 evidence 路径
        let evidencePath = '(log write failed)';
        try { evidencePath = await writeGateLog(this.gateLogDir, task.id, report); }
        catch (logError) { console.error('[dsh-swarm] gate log write failed (result kept): ' + String(logError)); }
        const detail = report.ok
          ? outcome.commands.map((c) => c.command).join(' && ') + ' exit 0\nevidence: ' + evidencePath
          : `${report.failure!.code}: ${report.failure!.command} — ${report.failure!.detail}\n${(report.results.at(-1)?.output ?? '').slice(-2000)}\nevidence: ${evidencePath}`;
        return { ok: report.ok, detail };
      } catch (error) {
        console.error('[dsh-swarm] gate hook failed (zero-awareness skip): ' + String(error));
        return null;
      }
    });
  }
}

function gitCurrentBranch(wt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', wt, 'rev-parse', '--abbrev-ref', 'HEAD'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.trim() || null : null));
  });
}

/** git diff --name-only base...HEAD；任何失败 → null（gate-policy 保守放行）。 */
function gitDiffNames(wt: string, base: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', wt, 'diff', '--name-only', `${base}...HEAD`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      resolve(out.split('\n').map((s) => s.trim()).filter(Boolean));
    });
  });
}
