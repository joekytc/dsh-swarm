import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateSpecCardForApproval, approveIfReady, MATTPOCOCK_PLANNING_GUIDANCE } from '../../src/routes/planning-driver.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
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
  it('guidance contains v2 flow (grill-me + prefetch + checklist + read-only rule)', () => {
    expect(MATTPOCOCK_PLANNING_GUIDANCE).toContain('grill-me');
    expect(MATTPOCOCK_PLANNING_GUIDANCE).toContain('planning_prefetch');
    expect(MATTPOCOCK_PLANNING_GUIDANCE).toContain('planning_checklist_save');
    expect(MATTPOCOCK_PLANNING_GUIDANCE).toContain('/openspec:');
    expect(MATTPOCOCK_PLANNING_GUIDANCE).toContain('禁止任何 git/源码写入');
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
      const r1 = await approveIfReady('/openspec: 确认执行', svc, { plan: '/plan:', openspec: '/openspec:' }, chain.id, c.id);
      expect(r1.ok).toBe(true);
      const state = await svc.snapshot();
      expect(state.specCards.get(c.id)!.status).toBe('approved');
      expect(state.chains.get(chain.id)!.status).toBe('executing');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('returns missing list with guidance when not ready', async () => {
    const { svc, dir, chain, c } = await fresh();
    try {
      const r = await approveIfReady('/openspec: go', svc, { plan: '/plan:', openspec: '/openspec:' }, chain.id, c.id);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.missing).toContain('attachments:file-prefetch');
        expect(r.guidance).toContain('grill-me');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
