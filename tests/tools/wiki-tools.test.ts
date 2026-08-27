import { describe, it, expect, vi } from 'vitest';
import { buildWikiTools } from '../../src/tools/wiki-tools.js';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

describe('buildWikiTools (W 角色 KB 工具)', () => {
  it('Q4: wiki_write 返回完整 kb_url（host 用 config.wikiVault.baseUrl，杜绝 LLM 手写错域名）', async () => {
    const base = 'http://192.168.122.111:3000';
    const wiki = {
      baseUrl: base,
      write: vi.fn(async (p: string) => ({ path: p })),
    } as unknown as WikiVaultClient;
    const tools = buildWikiTools(wiki, () => ({ actor: 'w' as const }));
    const writeTool = tools.find((t) => (t as { name?: string }).name === 'wiki_write')!;
    const out = await (writeTool as unknown as { execute(args: { pagePath: string; content: string }): Promise<unknown> }).execute({
      pagePath: 'projects/ch_1/t_1.md',
      content: '# x',
    });
    expect(out).toEqual({
      path: 'projects/ch_1/t_1.md',
      kb_url: base + '/#/page/projects/ch_1/t_1.md',
    });
  });

  it('Q4: baseUrl 尾斜杠被裁剪，不产生 //#/ 双斜杠', async () => {
    const wiki = {
      baseUrl: 'http://192.168.122.111:3000/',
      write: vi.fn(async (p: string) => ({ path: p })),
    } as unknown as WikiVaultClient;
    const tools = buildWikiTools(wiki, () => ({ actor: 'w' as const }));
    const writeTool = tools.find((t) => (t as { name?: string }).name === 'wiki_write')!;
    const out = await (writeTool as unknown as { execute(args: { pagePath: string; content: string }): Promise<unknown> }).execute({
      pagePath: 'projects/ch_1/t_2.md',
      content: '# x',
    });
    expect(out).toEqual({
      path: 'projects/ch_1/t_2.md',
      kb_url: 'http://192.168.122.111:3000/#/page/projects/ch_1/t_2.md',
    });
  });

  it('Q3&5: wiki_write 拒绝白名单外 pagePath（LLM 自造路径 → kb-rejected）', async () => {
    const wiki = {
      baseUrl: 'http://192.168.122.111:3000',
      write: vi.fn(async (p: string) => ({ path: p })),
    } as unknown as WikiVaultClient;
    const tools = buildWikiTools(wiki, () => ({ actor: 'w' as const }));
    const writeTool = tools.find((t) => (t as { name?: string }).name === 'wiki_write')!;
    const def = writeTool as unknown as { execute(args: { pagePath: string; content: string }): Promise<unknown> };
    // 错误示例：绝对路径/缺 projects/ 前缀/拼错层级——一律拒绝
    for (const bad of ['/kb/x.md', 'kb/x.md', 'projects/x.md', 'projects/ch_1/foo.md']) {
      await expect(def.execute({ pagePath: bad, content: '# x' })).rejects.toThrow(/outside allowed namespaces|kb-rejected/);
    }
    // 合法三类命名空间放行
    await expect(def.execute({ pagePath: 'projects/ch_1/t_1.md', content: '# x' })).resolves.toMatchObject({ path: 'projects/ch_1/t_1.md' });
    await expect(def.execute({ pagePath: 'projects/ch_1/review/r1.md', content: '# x' })).resolves.toMatchObject({ path: 'projects/ch_1/review/r1.md' });
    await expect(def.execute({ pagePath: 'projects/checklists/req.md', content: '# x' })).resolves.toMatchObject({ path: 'projects/checklists/req.md' });
  });
});
