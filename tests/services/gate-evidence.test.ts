// tests/services/gate-evidence.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGateLog } from '../../src/services/gate-evidence.js';

const report = {
  ok: false,
  results: [{ command: 'npx --no-install vitest run tests/a.test.ts', exitCode: 1, durationMs: 120, output: 'FAIL src/a.ts', truncated: false }],
  failure: { command: 'npx --no-install vitest run tests/a.test.ts', code: 'NONZERO' as const, detail: '退出码 1' },
};

describe('writeGateLog', () => {
  it('追加写 gate-logs/<taskId>.log，含时间戳/命令/exit/输出尾', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gate-log-'));
    const p1 = await writeGateLog(dir, 't1', report);
    const p2 = await writeGateLog(dir, 't1', report);
    expect(p1).toBe(p2);
    const text = await readFile(p1, 'utf8');
    expect(text.match(/== /g)!.length).toBe(2); // 两轮各一条时间戳头（追加不覆盖）
    expect(text).toContain('npx --no-install vitest run tests/a.test.ts');
    expect(text).toContain('exit=1');
    expect(text).toContain('FAIL src/a.ts');
    expect(text).toContain('NONZERO: 退出码 1');
  });
});
