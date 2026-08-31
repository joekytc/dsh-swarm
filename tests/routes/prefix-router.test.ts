import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePrefix, handlePlanRoute, handleOpenspecRoute, handleLearningRoute } from '../../src/routes/prefix-router.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import type { PlanningChecklist } from '../../src/domain/planning-checklist.js';
import { DEFAULT_PREFIX_ROUTES } from '../../src/config.js';

const cfg = DEFAULT_PREFIX_ROUTES;

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
  it('v2: /plan: 零副作用——不建链、不建规格卡、不建任务卡', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'pr-'))));
    const r = await handlePlanRoute('/plan: 优化登录', svc, cfg, 'session_main');
    expect(r.kind).toBe('plan');
    expect(r.chainId).toBeUndefined();
    const state = await svc.snapshot();
    expect(state.chains.size).toBe(0);
    expect(state.specCards.size).toBe(0);
    expect(state.tasks.size).toBe(0);
  });

  it('v2: /openspec: 用清单建链+规格卡六段+附件+批准', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'pr2-'))));
    const checklist: PlanningChecklist = {
      spec: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
      manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
      clarifications: [], doubts: [],
    };
    const r = await handleOpenspecRoute('/openspec: 确认', svc, cfg, { workspaceDir: '/ws', checklist, checklistRef: 'projects/checklists/session_main.md' }, 'session_main');
    expect(r.kind).toBe('openspec');
    expect(r.chainId).toBeDefined();
    expect(r.specCardId).toBeDefined();
    const state = await svc.snapshot();
    const chain = state.chains.get(r.chainId!)!;
    expect(chain.status).toBe('executing');
    expect(chain.workspaceDir).toBe('/ws');
    const card = state.specCards.get(r.specCardId!)!;
    expect(card.status).toBe('approved');
    expect(card.sections.problem).toBe('p');
    expect(card.attachments.some((a) => a.kind === 'file-prefetch' && a.ref === '/ws/repo')).toBe(true);
    expect(card.attachments.some((a) => a.kind === 'kb' && a.ref === 'projects/checklists/session_main.md')).toBe(true);
  });

  it('detects learning prefix (default and custom)', () => {
    expect(parsePrefix('/learning 优化登录', cfg).kind).toBe('learning');
    expect(parsePrefix('/learning 优化登录', cfg).rest).toContain('优化登录');
    expect(parsePrefix('/learning 优化登录', { plan: '/plan:', openspec: '/openspec:', learning: '/沉淀:' }).kind).toBe('none');
    expect(parsePrefix('/沉淀: x', { plan: '/plan:', openspec: '/openspec:', learning: '/沉淀:' }).kind).toBe('learning');
  });

  it('/learning 精确 chainId → brief + guidance（零副作用）', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'lr1-'))));
    const chain = await svc.createChain({ title: '【需求】A', ownerSessionId: 'session_main' }, 'human');
    const r = await handleLearningRoute('/learning ' + chain.id, svc, cfg, 'session_main');
    expect(r.kind).toBe('learning');
    expect(r.chainId).toBe(chain.id);
    expect(r.brief).toContain('【需求】A');
    expect(r.guidance).toContain('planning_learning_save');
    expect((await svc.snapshot()).chains.size).toBe(1); // 零副作用：不新建链
  });

  it('/learning 空 rest → 最近链', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'lr2-'))));
    await svc.createChain({ title: '【需求】B', ownerSessionId: 'session_main' }, 'human');
    const r = await handleLearningRoute('/learning', svc, cfg, 'session_main');
    expect(r.kind).toBe('learning');
    expect(r.chainId).toBeDefined();
  });

  it('/learning 歧义 → 候选列表（不猜）；无匹配 → 错误文本（不 throw）', async () => {
    const svc = new KanbanService(new FileEventStore(mkdtempSync(join(tmpdir(), 'lr3-'))));
    const c1 = await svc.createChain({ title: '【需求】X', ownerSessionId: 'session_main' }, 'human');
    await svc.createSpecCard(c1.id, { problem: '同问题', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
    const c2 = await svc.createChain({ title: '【需求】Y', ownerSessionId: 'session_main' }, 'human');
    await svc.createSpecCard(c2.id, { problem: '同问题', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
    const r = await handleLearningRoute('/learning 同问题', svc, cfg, 'session_main') as { error?: string; guidance?: string };
    expect(r.error).toBe('chain-ambiguous');
    expect(r.guidance).toContain(c1.id);
    expect(r.guidance).toContain(c2.id);
    const miss = await handleLearningRoute('/learning 没有这条链', svc, cfg, 'session_main') as { error?: string };
    expect(miss.error).toBe('chain-not-found');
  });
});
