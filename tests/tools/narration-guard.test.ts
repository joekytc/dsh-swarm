import { describe, it, expect } from 'vitest';
import { buildOpenspecNarrationRule, KANBAN_HANDOFF_RULE } from '../../src/tools/main-session-tools.js';
import type { PrefixRoutes } from '../../src/config.js';

const routes = { plan: '/plan:', openspec: '/openspec:', learning: '/learning' } as unknown as PrefixRoutes;

describe('narration guard keywords（护栏测试：文案被删/被改即红）', () => {
  it('静态铁律锁「逐字复制 + 禁止编造」', () => {
    const s = KANBAN_HANDOFF_RULE(routes);
    expect(s).toContain('只能逐字复制自工具结果');
    expect(s).toContain('禁止编造或沿用旧对话里的编号');
  });

  it('动态规则逐字引用 chainId/specCardId 与首卡成功', () => {
    const s = buildOpenspecNarrationRule({ chainId: 'ch_1_x', specCardId: 'sc_2_y', firstCard: { taskId: 't_1_z', status: 'todo' } });
    expect(s).toContain('chainId=ch_1_x');
    expect(s).toContain('specCardId=sc_2_y');
    expect(s).toContain('taskId=t_1_z');
    expect(s).toContain('首卡已创建');
    expect(s).toContain('禁止出现本结果之外的任何编号');
  });

  it('动态规则对 pending 超时必须声明「首卡尚未创建」', () => {
    const s = buildOpenspecNarrationRule({ chainId: 'ch_1_x', specCardId: 'sc_2_y', firstCard: { pending: true } });
    expect(s).toContain('首卡尚未创建');
    expect(s).toContain('禁止声称建卡成功');
  });

  it('无 firstCard（旧返回体）时要求复核后再汇报', () => {
    const s = buildOpenspecNarrationRule({ chainId: 'ch_1_x', specCardId: 'sc_2_y' });
    expect(s).toContain('以 kanban_show 复核后再汇报');
  });
});

describe('KANBAN_HANDOFF_RULE swarm 分叉', () => {
  it('swarm 形态：确认闸 + intent 建链，无「提醒用户 /openspec:」', () => {
    const s = KANBAN_HANDOFF_RULE(routes, { swarm: true });
    expect(s).toContain('确认闸');
    expect(s).toContain("intent:'openspec'");
    expect(s).toContain('确认/开干/开跑/开始/go');
    expect(s).not.toContain('提醒用户 ' + routes.openspec);
    expect(s).toContain('逐字复制'); // 叙述铁律两形态共有
  });
  it('前缀形态（缺省）：文本与旧版一致（兼容铁律）', () => {
    const s = KANBAN_HANDOFF_RULE(routes);
    expect(s).toContain('提醒用户 ' + routes.openspec);
    expect(s).not.toContain('intent');
  });
});
