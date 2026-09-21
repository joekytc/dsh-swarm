import { describe, it, expect } from 'vitest';
import {
  validatePlanningChecklist, formatChecklistBody, buildChecklistTitle, routePrdPlatform, slicePrdMarkdown,
  FORBIDDEN_SHORTHANDS, type PlanningChecklist,
} from '../../src/domain/planning-checklist.js';

const base = {
  spec: { problem: 'p', solution: 's', user_stories: ['u1'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
  manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
  clarifications: [{ q: '目的?', a: 'A' }],
  doubts: [{ q: '权限细节?', resolved: true, answer: '仅本人' }],
  sources: [{ type: 'TAPD', url: 'https://tapd.cn/123', note: '需求单' }],
  prdCollection: [],
};

describe('planning-checklist schema', () => {
  it('合法清单返回空错误', () => {
    expect(validatePlanningChecklist(base)).toEqual([]);
  });
  it('缺 spec 六段 → 报错', () => {
    const bad = { ...base, spec: { ...base.spec, testing: '' } };
    expect(validatePlanningChecklist(bad).join('; ')).toContain('spec.testing');
  });
  it('spec 数组段非数组 → 报错且文案含 got 回显', () => {
    const bad = { ...base, spec: { ...base.spec, user_stories: 'not-array' as never } };
    const errs = validatePlanningChecklist(bad).join('; ');
    expect(errs).toContain('spec.user_stories');
    expect(errs).toContain('got: "not-array"');
  });
  it('user_stories 传对象数组 → 报错且文案含 got 回显与拍平指引', () => {
    const bad = { ...base, spec: { ...base.spec, user_stories: [{ as_a: 'user', i_want: 'x', so_that: 'y' }] as never } };
    const errs = validatePlanningChecklist(bad).join('; ');
    expect(errs).toContain('spec.user_stories');
    expect(errs).toContain('element 0 is not a string');
    expect(errs).toContain('got: {"as_a":"user","i_want":"x","so_that":"y"}');
    expect(errs).toContain('Flatten objects into one sentence per element');
    expect(errs).toContain('As a <role>, I want <capability>, so that <benefit>');
  });
  it('impl_decisions 含非字符串元素 → 拍平指引带本段字段名', () => {
    const errs = validatePlanningChecklist({ ...base, spec: { ...base.spec, impl_decisions: [42] as never } }).join('; ');
    expect(errs).toContain('spec.impl_decisions');
    expect(errs).toContain('for impl_decisions');
  });
  it('clarifications 空数组 → 被拒，文案含非空要求与 restoreRef 逃生口', () => {
    const errs = validatePlanningChecklist({ ...base, clarifications: [] }).join('; ');
    expect(errs).toContain('clarifications');
    expect(errs).toContain('non-empty');
    expect(errs).toContain('restoreRef');
    expect(errs).toContain('本轮无澄清（恢复重建）');
  });
  it('clarifications [{q,a}] 非空 → 合法（[] 已收紧为非法）', () => {
    expect(validatePlanningChecklist({ ...base, clarifications: [{ q: '目的?', a: 'A' }] })).toEqual([]);
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

describe('validatePlanningChecklist 三道硬闸', () => {
  it('合法清单（含 sources/prdCollection/placeholders）过闸', () => {
    expect(validatePlanningChecklist({ ...base, placeholders: [{ target: '字段 course_id', value: 'TBD', replace: '后端就绪后替换' }] })).toEqual([]);
  });
  it('闸1：缺 sources → 拒收并给无来源逃生口指引', () => {
    const { sources: _s, ...rest } = base;
    const errors = validatePlanningChecklist(rest);
    expect(errors.some((e) => e.includes('checklist.sources') && e.includes('无来源'))).toBe(true);
  });
  it('闸1：sources 空数组 → 拒收', () => {
    expect(validatePlanningChecklist({ ...base, sources: [] }).some((e) => e.includes('checklist.sources'))).toBe(true);
  });
  it('闸1：url 为空时 note 必须非空（无来源原因）', () => {
    const errors = validatePlanningChecklist({ ...base, sources: [{ type: '其他', url: '', note: '' }] });
    expect(errors.some((e) => e.includes('sources[0]'))).toBe(true);
  });
  it('闸2：澄清答案命中禁词（按推荐）→ 拒收并回显索引与禁词', () => {
    const errors = validatePlanningChecklist({ ...base, clarifications: [{ q: '选哪个?', a: '按推荐' }] });
    expect(errors.some((e) => e.includes('clarifications[0]') && e.includes('按推荐'))).toBe(true);
  });
  it('闸2：英文禁词大小写不敏感（Same As Above）', () => {
    const errors = validatePlanningChecklist({ ...base, clarifications: [{ q: 'q', a: 'Same As Above 即可' }] });
    expect(errors.some((e) => e.includes('same as above'))).toBe(true);
  });
  it('闸3：prdCollection 条目 status 非法 → 拒收', () => {
    const errors = validatePlanningChecklist({ ...base, prdCollection: [{ url: 'https://modao.cc/x', status: 'pending', summary: 's' }] });
    expect(errors.some((e) => e.includes('prdCollection[0].status'))).toBe(true);
  });
  it('闸3：blocked 必带 blockedReason', () => {
    const errors = validatePlanningChecklist({ ...base, prdCollection: [{ url: 'https://modao.cc/x', status: 'blocked', summary: 's' }] });
    expect(errors.some((e) => e.includes('blockedReason'))).toBe(true);
  });
  it('闸3：collected 合法条目过闸', () => {
    expect(validatePlanningChecklist({ ...base, prdCollection: [{ url: 'https://modao.cc/x', status: 'collected', summary: 's', pages: ['projects/repo/source-docs/x-part-01.md'] }] })).toEqual([]);
  });
  it('placeholders 可选；存在则三要素非空', () => {
    expect(validatePlanningChecklist({ ...base, placeholders: [{ target: '', value: 'v', replace: 'r' }] }).some((e) => e.includes('placeholders[0]'))).toBe(true);
  });
});

const richBase = {
  requirementName: '为 autoNote 增加专注功能。补充…',
  spec: { problem: '问题', solution: '方案', user_stories: ['u1', 'u2'], impl_decisions: ['d1'], testing: '测试', out_of_scope: '范围外' },
  manifest: { repo: { localPath: '/ws/repo', remoteUrl: 'https://x', branch: 'feat/a', dirtyFiles: ['a.js', 'b/'] }, files: [{ path: 'src/x.ts', expected: 'exists' as const, note: 'n' }] },
  clarifications: [{ q: 'q1', a: 'a1' }],
  doubts: [{ q: 'd1', resolved: false }, { q: 'd2', resolved: true, answer: 'ans' }],
  sources: [{ type: 'TAPD' as const, url: 'https://tapd.cn/123', note: '需求单' }],
  prdCollection: [],
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

describe('formatChecklistBody 新段渲染', () => {
  it('渲染 需求来源 / PRD 采集记录 / 占位策略 三段', () => {
    const body = formatChecklistBody({
      ...base,
      prdCollection: [{ url: 'https://modao.cc/x', status: 'collected', summary: '采到 3 页', pages: ['projects/repo/source-docs/x-part-01.md'], degraded: true }],
      placeholders: [{ target: '字段 course_id', value: 'TBD', replace: '后端就绪替换' }],
    } as PlanningChecklist);
    expect(body).toContain('## 需求来源');
    expect(body).toContain('https://tapd.cn/123');
    expect(body).toContain('## PRD 采集记录');
    expect(body).toContain('projects/repo/source-docs/x-part-01.md');
    expect(body).toContain('degraded');
    expect(body).toContain('## 占位策略');
    expect(body).toContain('字段 course_id');
  });
});

describe('routePrdPlatform 域名路由', () => {
  it('feishu.cn → feishu', () => expect(routePrdPlatform('https://ccnfn01oxywo.feishu.cn/docx/abc')).toBe('feishu'));
  it('doc.weixin.qq.com → wecom', () => expect(routePrdPlatform('https://doc.weixin.qq.com/xxx')).toBe('wecom'));
  it('modao.cc → modao', () => expect(routePrdPlatform('https://modao.cc/app/xyz')).toBe('modao'));
  it('其他域名 → null（LLM 自判）', () => expect(routePrdPlatform('https://example.com/prd')).toBeNull());
  it('非法 URL → null', () => expect(routePrdPlatform('not a url')).toBeNull());
});

describe('slicePrdMarkdown 切片', () => {
  it('按章节切片且每片不超限', () => {
    const md = '# A\n' + 'a'.repeat(100) + '\n# B\n' + 'b'.repeat(100) + '\n# C\n' + 'c'.repeat(100);
    const parts = slicePrdMarkdown(md, 120);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(120);
  });
  it('单章超限按行硬切', () => {
    const md = '# A\n' + Array.from({ length: 50 }, (_, i) => `line-${i}-padding`).join('\n');
    const parts = slicePrdMarkdown(md, 200);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('\n')).toContain('line-49');
  });
});

describe('FORBIDDEN_SHORTHANDS', () => {
  it('含全部约定禁词', () => {
    for (const w of ['按推荐', '同上', '见上', '同前', '如前所述', 'same as above', 'ditto', 'see above']) {
      expect(FORBIDDEN_SHORTHANDS).toContain(w);
    }
  });
});
