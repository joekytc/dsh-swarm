import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePrefix, handlePlanRoute } from '../../src/routes/prefix-router.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';

const cfg = { plan: '/plan:', openspec: '/openspec:' };

describe('prefix router', () => {
  it('detects plan prefix and strips it', () => {
    const r = parsePrefix('/plan: 优化登录模块 / 项目A / auth API', cfg);
    expect(r.kind).toBe('plan');
    expect(r.rest).toContain('优化登录模块');
  });
  it('detects openspec prefix', () => {
    expect(parsePrefix('/openspec: 确认执行', cfg).kind).toBe('openspec');
  });
  it('plain message is none', () => {
    expect(parsePrefix('帮我看看这个', cfg).kind).toBe('none');
  });
  it('distinguishes from slash commands', () => {
    expect(parsePrefix('/plan 项目X', cfg).kind).toBe('none'); // 斜杠命令不带冒号
    expect(parsePrefix('/execute-plan t_1', cfg).kind).toBe('none');
  });
  it('M2(Q5): handlePlanRoute 把发起会话工作目录写到 Chain.workspaceDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const ws = '/Users/jc/Documents/work/workspace/dsh-dashboard';
      const route = await handlePlanRoute('/plan: 优化登录 / projA / api', svc, cfg, 'session_main', ws);
      const state = await svc.snapshot();
      expect(state.chains.get(route.chainId!)!.workspaceDir).toBe(ws);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
