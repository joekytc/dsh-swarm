// tests/services/gate-runner.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGateCommands } from '../../src/services/gate-runner.js';

const dir = () => mkdtempSync(join(tmpdir(), 'gate-runner-'));
const cfg = { timeoutMs: 10000, forbidden: ['rm -rf /'] };

describe('runGateCommands', () => {
  it('exit 0 → ok', async () => {
    const r = await runGateCommands([{ command: 'true', cwd: dir(), source: 'tdd' }], cfg);
    expect(r.ok).toBe(true);
  });
  it('exit 非 0 → ok=false + NONZERO（后续命令不再执行）', async () => {
    const d = dir();
    const r = await runGateCommands([
      { command: 'false', cwd: d, source: 'tdd' },
      { command: 'true', cwd: d, source: 'tdd' },
    ], cfg);
    expect(r.ok).toBe(false);
    expect(r.failure?.code).toBe('NONZERO');
    expect(r.results).toHaveLength(1);
  });
  it('超时 → TIMEOUT 且进程被杀', async () => {
    const r = await runGateCommands([{ command: 'sleep 5', cwd: dir(), source: 'tdd' }],
      { timeoutMs: 300, forbidden: [] });
    expect(r.ok).toBe(false);
    expect(r.failure?.code).toBe('TIMEOUT');
  }, 10000);
  it('黑名单子串命中 → FORBIDDEN 且不执行', async () => {
    const r = await runGateCommands([{ command: 'rm -rf /tmp/x', cwd: dir(), source: 'tdd' }], cfg);
    expect(r.ok).toBe(false);
    expect(r.failure?.code).toBe('FORBIDDEN');
  });
  it('输出 >256KB 截断且 truncated=true', async () => {
    const d = dir();
    writeFileSync(join(d, 'big.txt'), 'x'.repeat(300 * 1024));
    const r = await runGateCommands([{ command: 'cat big.txt', cwd: d, source: 'tdd' }], cfg);
    expect(r.results[0]!.truncated).toBe(true);
    expect(r.results[0]!.output.length).toBeLessThanOrEqual(256 * 1024);
  });
});
