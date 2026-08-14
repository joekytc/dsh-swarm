import { describe, it, expect } from 'vitest';
import { parsePrefix } from '../../src/routes/prefix-router.js';

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
});
