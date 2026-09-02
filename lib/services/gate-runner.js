// src/services/gate-runner.ts
/** kanban_complete 实测闸执行层（services 层唯一允许 child_process 之处之一）：
 * spawn bash -c 执行 GateCommand，带超时整组 SIGKILL（detached 独立进程组，连孙进程一起杀，
 * 防其持住 stdio 管道导致 close 不触发、Promise 挂死）、输出 256KB 截断、
 * 黑名单子串预检（纵深防御，命中即不执行）。
 * 命令串行执行，任一失败（FORBIDDEN/TIMEOUT/SPAWN_FAIL/NONZERO）立即返回，后续命令不再执行。 */
import { spawn } from 'node:child_process';
const MAX_OUTPUT = 256 * 1024;
/** exit 后 close 迟迟不触发（如整组击杀失败、孙进程仍持管道）时的兜底 resolve 宽限 */
const EXIT_GRACE_MS = 1000;
export function runOne(cmd, timeoutMs) {
    return new Promise((resolve) => {
        const started = Date.now();
        const child = spawn('bash', ['-c', cmd.command], {
            cwd: cmd.cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32', // 独立进程组：超时按组 SIGKILL，防孙进程持管道挂死
        });
        let out = '';
        let truncated = false;
        let timedOut = false;
        let settled = false;
        let exitGrace;
        const finish = (exitCode, output) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (exitGrace !== undefined)
                clearTimeout(exitGrace);
            resolve({ command: cmd.command, exitCode, durationMs: Date.now() - started, output, truncated, timedOut });
        };
        const killGroup = () => {
            if (child.pid === undefined) {
                child.kill('SIGKILL');
                return;
            }
            try {
                process.kill(-child.pid, 'SIGKILL');
            }
            catch {
                child.kill('SIGKILL');
            }
        };
        const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
        const collect = (chunk) => {
            if (out.length >= MAX_OUTPUT) {
                truncated = true;
                return;
            }
            out += chunk.toString('utf8');
            if (out.length > MAX_OUTPUT) {
                out = out.slice(0, MAX_OUTPUT);
                truncated = true;
            }
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.on('error', (err) => {
            finish(null, String(err));
        });
        // close 需 stdio 管道全部关闭；exit 先到而 close 迟迟不来时按宽限兜底 resolve（尽力收集已到输出）
        child.on('exit', (code) => {
            exitGrace = setTimeout(() => finish(code, out), EXIT_GRACE_MS);
        });
        child.on('close', (code) => {
            finish(code, out);
        });
    });
}
export async function runGateCommands(commands, cfg, run = runOne) {
    const results = [];
    for (const cmd of commands) {
        if (cfg.forbidden.some((f) => cmd.command.includes(f))) {
            return { ok: false, results, failure: { command: cmd.command, code: 'FORBIDDEN', detail: '黑名单命中（纵深防御，不执行）' } };
        }
        const r = await run(cmd, cfg.timeoutMs);
        results.push({ command: r.command, exitCode: r.exitCode, durationMs: r.durationMs, output: r.output, truncated: r.truncated });
        if (r.timedOut)
            return { ok: false, results, failure: { command: r.command, code: 'TIMEOUT', detail: `超时（${cfg.timeoutMs}ms）` } };
        if (r.exitCode === null)
            return { ok: false, results, failure: { command: r.command, code: 'SPAWN_FAIL', detail: r.output } };
        if (r.exitCode !== 0)
            return { ok: false, results, failure: { command: r.command, code: 'NONZERO', detail: `退出码 ${r.exitCode}` } };
    }
    return { ok: true, results };
}
