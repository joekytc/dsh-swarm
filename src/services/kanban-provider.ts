import { Service, type Context } from '@deepseek-ai/cordis';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { KanbanService } from '../domain/kanban-service.js';
import { FileEventStore } from '../domain/event-store.js';
import { deriveGatePlan, isGatePlan, branchMatches } from '../domain/gate-policy.js';
import { runGateCommands } from './gate-runner.js';
import type { KanbanConfig } from '../config.js';
import type { ConfigProvider } from './config-provider.js';

declare module '@deepseek-ai/cordis' {
  interface Context { kanban: KanbanProvider; }
}

export class KanbanProvider extends Service {
  readonly service: KanbanService;
  /** T32 fix：GUI retry 的任务执行器（由 startDispatcher 装配后注入；webServer 先于 agents 就绪时可为 null）。 */
  runner: { runTask(taskId: string): Promise<void> } | null = null;
  /** 整链硬删除后的联动钩子（由 startDispatcher 装配注入）：dispatcher 游标同步 + V 编排 entry 清理。
   *  purge 物理重排 events seq，若不同步则删链后新建链的可唤醒事件被运行中实例永久跳过。 */
  onChainDeleted: ((chainId: string) => Promise<void> | void) | null = null;
  // Task 6：经 configProvider getter 读 effective 配置——配置面板改 wikiVault.baseUrl 后 kb_url 前缀校验热生效。
  constructor(ctx: Context, config: KanbanConfig, configProvider: ConfigProvider) {
    super(ctx, 'kanban');
    const dir = config.storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? homedir());
    this.service = new KanbanService(new FileEventStore(dir), () => configProvider.getEffective().wikiVault?.baseUrl);
    // P1 实测闸装配（组合根）：complete 前派生 GatePlan → 分支一致性核对 → 实测执行。
    // hook 绝不 throw：意外异常记日志并返回 null（零感知 skip，fail-open 与分支不一致语义一致）。
    this.service.setGateHook(async (task, handoff) => {
      try {
        // 热读取（同 wikiVault.baseUrl 先例，getEffective）：配置面板改 gates 后无需重建即生效。
        const cfg = configProvider.getEffective().gates ?? { enabled: true, timeoutMs: 600000, forbidden: ['rm -rf /', 'git push'] };
        const plan = deriveGatePlan({ assignee: task.assignee, mode: task.mode, handoff, config: { enabled: cfg.enabled } });
        if (!isGatePlan(plan)) return null; // skip：disabled/非 D/旧卡/路径违规
        const wt = plan.commands[0]!.cwd;
        // 分支一致性核对（防报假 worktree 绕闸）：查询失败或与 metadata.branch 不一致 → skip 零感知。
        const current = await new Promise<string | null>((resolve) => {
          const child = spawn('git', ['-C', wt, 'rev-parse', '--abbrev-ref', 'HEAD'], { stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '';
          child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
          child.on('error', () => resolve(null));
          child.on('close', (code) => resolve(code === 0 ? out.trim() || null : null));
        });
        if (!branchMatches(current, handoff.metadata?.['branch'])) return null;
        const report = await runGateCommands(plan.commands, { timeoutMs: cfg.timeoutMs, forbidden: cfg.forbidden });
        const detail = report.ok
          ? plan.commands.map((c) => c.command).join(' && ') + ' exit 0'
          : `${report.failure!.code}: ${report.failure!.command} — ${report.failure!.detail}\n${(report.results.at(-1)?.output ?? '').slice(-2000)}`;
        return { ok: report.ok, detail };
      } catch (error) {
        console.error('[dsh-swarm] gate hook failed (zero-awareness skip): ' + String(error));
        return null;
      }
    });
  }
}
