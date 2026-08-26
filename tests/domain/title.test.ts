import { describe, it, expect } from 'vitest';
import { buildChainTitle } from '../../src/domain/kanban-service.js';

describe('buildChainTitle', () => {
  it('uses /plan: rest first sentence with 【需求】 prefix', () => {
    expect(buildChainTitle('为 autoNote 增加专注功能。补充…', '确认', 'p')).toBe('【需求】为 autoNote 增加专注功能');
  });
  it('falls back to checklist problem first sentence when no /plan: requirementName', () => {
    expect(buildChainTitle('', '确认', '这是一个需求问题描述')).toBe('【需求】这是一个需求问题描述');
  });
  it('falls back to 未命名需求 when both empty', () => {
    expect(buildChainTitle('', '确认', '')).toBe('【需求】未命名需求');
  });
  it('truncates long first sentence to 40 chars', () => {
    const long = '超长'.repeat(30); // 60 chars, no punctuation
    const t = buildChainTitle('', '确认', long);
    expect(t).toBe('【需求】' + '超长'.repeat(20)); // 40 chars
  });
});
