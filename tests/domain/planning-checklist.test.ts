import { describe, it, expect } from 'vitest';
import { buildChecklistTitle, formatChecklistBody, validatePlanningChecklist } from '../../src/domain/planning-checklist.js';

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
  it('clarifications 元素键名错（question/answer）→ 报错并指认确切键名 q/a', () => {
    const bad = { ...base, clarifications: [{ question: '目的?', answer: 'A' }] };
    const errs = validatePlanningChecklist(bad);
    expect(errs.join('; ')).toContain('clarifications[0]');
    expect(errs.join('; ')).toContain('"q"');
  });
  it('clarifications 元素缺 a 或空串 → 报错', () => {
    expect(validatePlanningChecklist({ ...base, clarifications: [{ q: '目的?' }] }).join('; ')).toContain('clarifications[0]');
    expect(validatePlanningChecklist({ ...base, clarifications: [{ q: '目的?', a: '  ' }] }).join('; ')).toContain('clarifications[0]');
  });
  it('doubts 元素键名错/resolved 非布尔 → 报错', () => {
    expect(validatePlanningChecklist({ ...base, doubts: [{ question: 'x', resolved: true }] }).join('; ')).toContain('doubts[0]');
    expect(validatePlanningChecklist({ ...base, doubts: [{ q: 'x', resolved: 'yes' }] }).join('; ')).toContain('doubts[0]');
  });
  it('带 risks 的合法清单 → 校验通过（含空数组 []）', () => {
    expect(validatePlanningChecklist({ ...base, risks: [{ description: '键名漂移', source: 'guidance 第4条', mitigation: 'schema 锁键名' }] })).toEqual([]);
    expect(validatePlanningChecklist({ ...base, risks: [] })).toEqual([]);
  });
  it('risks 元素键名错（desc/from/fix）→ 报错并指认 risks[0] 与确切键名 "description"', () => {
    const errs = validatePlanningChecklist({ ...base, risks: [{ desc: 'x', from: 'y', fix: 'z' }] });
    expect(errs.join('; ')).toContain('risks[0]');
    expect(errs.join('; ')).toContain('"description"');
  });
  it('risks 元素存在空串 → 报错', () => {
    expect(validatePlanningChecklist({ ...base, risks: [{ description: 'x', source: '  ', mitigation: 'z' }] }).join('; ')).toContain('risks[0]');
  });
  it('risks 非数组 → 报错', () => {
    expect(validatePlanningChecklist({ ...base, risks: 'no' as never }).join('; ')).toContain('risks');
  });
  it('requirementName 存在但非空字符串 → 合法；空串 → 报错', () => {
    expect(validatePlanningChecklist({ ...base, requirementName: '为 autoNote 增加专注功能' })).toEqual([]);
    expect(validatePlanningChecklist({ ...base, requirementName: '  ' }).join('; ')).toContain('requirementName');
  });
});

const richBase = {
  requirementName: '为 autoNote 增加专注功能。补充…',
  spec: { problem: '问题', solution: '方案', user_stories: ['u1', 'u2'], impl_decisions: ['d1'], testing: '测试', out_of_scope: '范围外' },
  manifest: { repo: { localPath: '/ws/repo', remoteUrl: 'https://x', branch: 'feat/a', dirtyFiles: ['a.js', 'b/'] }, files: [{ path: 'src/x.ts', expected: 'exists' as const, note: 'n' }] },
  clarifications: [{ q: 'q1', a: 'a1' }],
  doubts: [{ q: 'd1', resolved: false }, { q: 'd2', resolved: true, answer: 'ans' }],
};

describe('buildChecklistTitle', () => {
  it('标题 = 【需求】+ 首句（与任务卡 title 同源同逻辑）', () => {
    expect(buildChecklistTitle(richBase)).toBe('【需求】为 autoNote 增加专注功能');
  });
  it('无 requirementName 回退 spec.problem 首句', () => {
    expect(buildChecklistTitle({ ...richBase, requirementName: undefined })).toBe('【需求】问题');
  });
});

describe('formatChecklistBody', () => {
  it('首行 # 【需求】…；Spec/Repo/澄清问答/疑问点 均格式化（非裸 JSON）', () => {
    const body = formatChecklistBody(richBase);
    expect(body.startsWith('# 【需求】为 autoNote 增加专注功能')).toBe(true);
    expect(body).toContain('## Spec');
    expect(body).toContain('### 问题描述 (problem)');
    expect(body).toContain('### 用户故事 (user_stories)');
    expect(body).toContain('- u1');
    expect(body).toContain('## Repo 事实 (manifest)');
    expect(body).toContain('| src/x.ts | exists | n |');
    expect(body).toContain('### Q1. q1');
    expect(body).toContain('- **A**: a1');
    expect(body).toContain('- [ ] d1');
    expect(body).toContain('- [x] d2 — ans');
    expect(body).not.toContain('"problem"');
  });
  it('带 risks：## 风险点 节在 ## 疑问点 之前，每条 - description（来源: …；缓解: …）', () => {
    const withRisks = { ...richBase, risks: [{ description: '键名漂移', source: 'guidance 第4条', mitigation: 'schema 锁键名' }] };
    const body = formatChecklistBody(withRisks);
    expect(body).toContain('## 风险点');
    expect(body).toContain('- 键名漂移（来源: guidance 第4条；缓解: schema 锁键名）');
    expect(body.indexOf('## 风险点')).toBeLessThan(body.indexOf('## 疑问点'));
  });
  it('risks 缺省：合法且渲染 ## 风险点 + （无）', () => {
    expect(validatePlanningChecklist(richBase)).toEqual([]);
    const body = formatChecklistBody(richBase);
    expect(body).toContain('## 风险点');
    expect(body).toContain('（无）');
  });
});
