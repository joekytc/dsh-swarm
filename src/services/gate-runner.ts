// src/services/gate-runner.ts
/** kanban_complete 实测闸执行层（services 层唯一允许 child_process 之处之一）：
 * spawn bash -c 执行 GateCommand，带超时 SIGKILL、输出 256KB 截断、黑名单子串预检（纵深防御，命中即不执行）。
 * 命令串行执行，任一失败（FORBIDDEN/TIMEOUT/SPAWN_FAIL/NONZERO）立即返回，后续命令不再执行。 */
import { spawn } from 'node:child_process';
import type { GateCommand } from '../domain/gate-policy.js';

export interface GateResult { command: string; exitCode: number | null; durationMs: number; output: string; truncated: boolean }
export interface GateRunReport { ok: boolean; results: GateResult[]; failure?: { command: string; code: 'NONZERO' | 'TIMEOUT' | 'FORBIDDEN' | 'SPAWN_FAIL'; detail: string } }

const MAX_OUTPUT = 256 * 1024;

export function runOne(cmd: GateCommand, timeoutMs: number): Promise<GateResult & { timedOut?: boolean }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('bash', ['-c', cmd.command], { cwd: cmd.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const collect = (chunk: Buffer) => {
      if (out.length >= MAX_OUTPUT) { truncated = true; return; }
      out += chunk.toString('utf8');
      if (out.length > MAX_OUTPUT) { out = out.slice(0, MAX_OUTPUT); truncated = true; }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ command: cmd.command, exitCode: null, durationMs: Date.now() - started, output: String(err), truncated, timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ command: cmd.command, exitCode: code, durationMs: Date.now() - started, output: out, truncated, timedOut });
    });
  });
}

export async function runGateCommands(
  commands: GateCommand[],
  cfg: { timeoutMs: number; forbidden: string[] },
  run: typeof runOne = runOne,
): Promise<GateRunReport> {
  const results: GateResult[] = [];
  for (const cmd of commands) {
    if (cfg.forbidden.some((f) => cmd.command.includes(f))) {
      return { ok: false, results, failure: { command: cmd.command, code: 'FORBIDDEN', detail: '黑名单命中（纵深防御，不执行）' } };
    }
    const r = await run(cmd, cfg.timeoutMs);
    results.push({ command: r.command, exitCode: r.exitCode, durationMs: r.durationMs, output: r.output, truncated: r.truncated });
    if (r.timedOut) return { ok: false, results, failure: { command: r.command, code: 'TIMEOUT', detail: `超时（${cfg.timeoutMs}ms）` } };
    if (r.exitCode === null) return { ok: false, results, failure: { command: r.command, code: 'SPAWN_FAIL', detail: r.output } };
    if (r.exitCode !== 0) return { ok: false, results, failure: { command: r.command, code: 'NONZERO', detail: `退出码 ${r.exitCode}` } };
  }
  return { ok: true, results };
}
