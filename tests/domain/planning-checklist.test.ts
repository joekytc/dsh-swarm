import { describe, it, expect } from 'vitest';
import { validatePlanningChecklist } from '../../src/domain/planning-checklist.js';

const base = {
  spec: { problem: 'p', solution: 's', user_stories: ['u1'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
  manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
  clarifications: [{ q: '目的?', a: 'A' }],
  doubts: [{ q: '权限细节?', resolved: true, answer: '仅本人' }],
};

describe('planning-checklist schema', () => {
  it('合法清单返回空错误', () => {
    expect(validatePlanningChecklist(base)).toEqual([]);
  });
  it('缺 spec 六段 → 报错', () => {
    const bad = { ...base, spec: { ...base.spec, testing: '' } };
    expect(validatePlanningChecklist(bad).join('; ')).toContain('spec.testing');
  });
  it('spec 数组段非数组 → 报错', () => {
    const bad = { ...base, spec: { ...base.spec, user_stories: 'not-array' as never } };
    expect(validatePlanningChecklist(bad).join('; ')).toContain('spec.user_stories');
  });
  it('manifest 非法（复用 validatePrefetchManifest）→ 报错', () => {
    const bad = { ...base, manifest: { repo: { localPath: '' }, files: [] } };
    expect(validatePlanningChecklist(bad).join('; ')).toContain('localPath');
  });
  it('clarifications/doubts 非数组 → 报错', () => {
    expect(validatePlanningChecklist({ ...base, clarifications: 'x' as never })).not.toEqual([]);
  });
});
