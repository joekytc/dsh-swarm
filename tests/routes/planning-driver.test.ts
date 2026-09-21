import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateSpecCardForApproval, approveIfReady, buildPlanningGuidance } from '../../src/routes/planning-driver.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { DEFAULT_PREFIX_ROUTES } from '../../src/config.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpecCard } from '../../src/domain/types.js';

const FULL_SECTIONS = { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: ['d'], testing: 't', out_of_scope: 'o' };
const card: SpecCard = { id: 'sc_1', chainId: 'ch_1', status: 'draft', sections: FULL_SECTIONS, attachments: [], rawDialogueRef: null, approvedAt: null, approvedBy: null };

async function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'plan-drv-'));
  const svc = new KanbanService(new FileEventStore(dir));
  const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
  const c = await svc.createSpecCard(chain.id, FULL_SECTIONS, 'human');
  return { svc, dir, chain, c };
}

describe('planning driver (phase 0)', () => {
  it('guidance contains v5 flow (ten clarification rules: source, prd collect, scope, traceability)', () => {
    const guidance = buildPlanningGuidance(DEFAULT_PREFIX_ROUTES);
    expect(guidance).toContain('# 阶段 0 规划对话（v5：grill-me frontier 分轮 + 需求澄清十规则）');
    expect(guidance).toContain('grill-me');
    expect(guidance).toContain('frontier'); // 节奏对齐 skills/grill-me：分轮整批问
    expect(guidance).toContain('推荐答案');
    expect(guidance).not.toContain('一次只问一个问题'); // 单问旧节奏已废弃
    expect(guidance).toContain('人话硬规则');
    expect(guidance).toContain('需求来源必挂');
    expect(guidance).toContain('planning_prd_collect'); // PRD 链接必采集（采集缝工具引导）
    expect(guidance).toContain('范围边界');
    expect(guidance).toContain('planning_prefetch');
    expect(guidance).toContain('planning_checklist_save');
    expect(guidance).toContain('每条决策可追溯（问答编号/仓库源码路径/接口文档位置至少其一）'); // 来源三有：决策有依据
    expect(guidance).toContain('【已调整】/【已确认】'); // 来源三有：冲突有标记
    expect(guidance).toContain('无来源记录的决策会被视为 agent 自行默认'); // 来源三有：责任可区分
    expect(guidance).toContain(DEFAULT_PREFIX_ROUTES.openspec);
    expect(guidance).toContain('禁止任何 git/源码写入');
    expect(guidance).toContain('greenfield'); // 绿地判定：无 .git 目标目录声明 greenfield:true
    expect(guidance).toContain('清单声明 greenfield:true');
  });

  it('rejects approval when sections incomplete', () => {
    const missing = validateSpecCardForApproval({ ...card, sections: { ...FULL_SECTIONS, testing: '' } });
    expect(missing).toContain('testing');
  });

  it('rejects approval without file-prefetch attachment', () => {
    const missing = validateSpecCardForApproval(card); // attachments 空
    expect(missing).toContain('attachments:file-prefetch');
  });

  it('approves only after attachment added and sections complete', async () => {
    const { svc, dir, chain, c } = await fresh();
    try {
      await svc.addSpecCardAttachment(c.id, { name: 'repo-facts', kind: 'file-prefetch', ref: '/ws/w1pre' }, 'v');
      const r1 = await approveIfReady('/openspec: 确认执行', svc, DEFAULT_PREFIX_ROUTES, chain.id, c.id);
      expect(r1.ok).toBe(true);
      const state = await svc.snapshot();
      expect(state.specCards.get(c.id)!.status).toBe('approved');
      expect(state.chains.get(chain.id)!.status).toBe('executing');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('returns missing list with guidance when not ready', async () => {
    const { svc, dir, chain, c } = await fresh();
    try {
      const r = await approveIfReady('/openspec: go', svc, DEFAULT_PREFIX_ROUTES, chain.id, c.id);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.missing).toContain('attachments:file-prefetch');
        expect(r.guidance).toContain('grill-me');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
