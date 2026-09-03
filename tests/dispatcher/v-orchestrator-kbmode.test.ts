// tests/dispatcher/v-orchestrator-kbmode.test.ts
import { describe, it, expect } from 'vitest';
import { buildPhaseInstruction, PHASE_INSTRUCTIONS } from '../../src/dispatcher/v-orchestrator.js';

describe('v-orchestrator 指令分模式（D9）', () => {
  const ctx = { chainId: 'ch_c1', taskId: 't_t1' };
  it('w2 local：含 skill/空 kb_url 指令，不含 wiki_write', () => {
    const body = buildPhaseInstruction('w2', ctx, 'local');
    expect(body).toContain('skill');
    expect(body).toContain('wiki/sources/ch_c1/t_t1.md');
    expect(body).toContain('kb_url=""');
    expect(body).not.toContain('wiki_write');
  });
  it('w2 remote：与 PHASE_INSTRUCTIONS 原文一致（护栏测试零改动前提）', () => {
    expect(buildPhaseInstruction('w2', ctx, 'remote')).toBe(PHASE_INSTRUCTIONS['w2'] ?? '');
  });
  it('w3 local：收尾同步指令含空 kb_url（taskId 缺省用占位符）', () => {
    const body = buildPhaseInstruction('w3', { chainId: 'ch_c1' }, 'local');
    expect(body).toContain('wiki/sources/ch_c1/t_<你的任务ID>.md');
    expect(body).toContain('kb_url=""');
  });
  it('d local：读 page_path 本地文件 + skill 召回，不含 wiki_read', () => {
    const body = buildPhaseInstruction('d', ctx, 'local');
    expect(body).toContain('page_path');
    expect(body).not.toContain('wiki_read');
  });
  it('dt local：评审页 fs 写 wiki/queries/（审查 M4）', () => {
    const body = buildPhaseInstruction('dt', ctx, 'local');
    expect(body).toContain('wiki/queries/ch_c1/review/');
  });
});
