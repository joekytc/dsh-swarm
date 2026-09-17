// src/services/gate-evidence.ts
/** gate 实测日志落盘（PR1 P3 存档）：pass 也留原始输出，事后可翻账对质（issue #2 verify.sh 模式的 D 侧落点）。
 * 追加写（每轮一条时间戳头），单文件 per task，路径进 gate detail 供 agent/human 引用。 */
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function writeGateLog(dir, taskId, report) {
    const logDir = join(dir, 'gate-logs');
    await mkdir(logDir, { recursive: true });
    const path = join(logDir, `${taskId}.log`);
    const lines = [`== ${new Date().toISOString()} ok=${report.ok}`];
    for (const r of report.results) {
        lines.push(`-- ${r.command}`);
        lines.push(`exit=${r.exitCode} durationMs=${r.durationMs} truncated=${r.truncated}`);
        if (r.output)
            lines.push(r.output);
    }
    if (report.failure)
        lines.push(`-- failure: ${report.failure.code}: ${report.failure.detail}`);
    await appendFile(path, lines.join('\n') + '\n');
    return path;
}
