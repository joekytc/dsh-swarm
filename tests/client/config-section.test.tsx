// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfigSection } from '../../client/ConfigSection.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** config / catalog / ocr 各端点按 URL 分发；over 里可按用例覆盖各端点响应。 */
function makeFetch(over: {
  config?: unknown;
  catalog?: unknown;
  ocrStatus?: unknown;
  installStateHolder?: { current: unknown };
  wire?: unknown;
} = {}) {
  const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/kanban/llm-catalog')) return jsonResponse(over.catalog ?? { providers: [], models: {} });
    if (url.includes('/kanban/ocr/status')) return jsonResponse(over.ocrStatus ?? { installed: false, version: '', mode: 'delegate', managedReady: false });
    if (url.includes('/kanban/ocr/install/state')) return jsonResponse(over.installStateHolder?.current ?? { running: false, log: '' });
    if (url.includes('/kanban/ocr/install')) return jsonResponse({ ok: true, id: 'i1' });
    if (url.includes('/kanban/ocr/install/cancel')) return jsonResponse({ ok: true });
    if (url.includes('/kanban/ocr/wire')) return jsonResponse(over.wire ?? { ok: true, log: 'ocr managed provider wired: dsh-managed' });
    return jsonResponse(over.config ?? {
      effective: {
        wikiVault: { baseUrl: '', pagePrefix: '' },
        roles: { models: {} },
        reviewEngine: { mode: 'delegate', managed: { provider: '', model: '' } },
      },
      sources: {},
    });
  }) as never;
}

const CATALOG = {
  providers: [{ id: 'gpt', name: 'GPT' }],
  models: { gpt: [{ id: 'm1', name: 'Model One', efforts: [] }] },
};

describe('ConfigSection', () => {
  it('渲染 baseUrl 输入与提示文案', async () => {
    render(<ConfigSection fetchImpl={makeFetch()} close={() => {}} />);
    expect((await screen.findAllByText(/llm-wiki/)).length).toBeGreaterThan(0);
  });

  it('ocr 未安装：红横幅 + 安装按钮，评审模式/提供方/模型置灰', async () => {
    render(<ConfigSection fetchImpl={makeFetch({ ocrStatus: { installed: false, version: '', mode: 'delegate', managedReady: false } })} close={() => {}} />);
    expect(await screen.findByText('ocr 未安装——委托/托管评审均不可用')).toBeTruthy();
    expect(screen.getByRole('button', { name: '安装 ocr' })).toBeTruthy();
    const modeTrigger = screen.getByText('委托（DT 自己的模型评审，零 key）').closest('button');
    expect(modeTrigger?.getAttribute('disabled')).toBe('');
  });

  it('ocr 状态未知（拉取失败置 null）：按未安装 UI 但文案为「ocr 状态未知」', async () => {
    const failing = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/kanban/ocr/status')) throw new Error('down');
      if (String(input).includes('/kanban/llm-catalog')) return { ok: true, json: async () => ({ providers: [], models: {} }) };
      return { ok: true, json: async () => ({ effective: { wikiVault: { baseUrl: '', pagePrefix: '' }, roles: { models: {} }, reviewEngine: { mode: 'delegate', managed: { provider: '', model: '' } } }, sources: {} }) };
    }) as never;
    render(<ConfigSection fetchImpl={failing} close={() => {}} />);
    expect(await screen.findByText('ocr 状态未知——委托/托管评审可能不可用')).toBeTruthy();
  });

  it('点「安装 ocr」→ spinner 与「取消」出现；fake state 终态 ok → 状态行出现且整卡解禁', async () => {
    const installStateHolder = { current: { running: true, log: '' } as unknown };
    const statusHolder = { current: { installed: false, version: '', mode: 'delegate', managedReady: false } as unknown };
    const fetchMock = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/kanban/ocr/install/state')) return { ok: true, status: 200, json: async () => installStateHolder.current };
      if (url.includes('/kanban/ocr/status')) return { ok: true, status: 200, json: async () => statusHolder.current };
      if (url.includes('/kanban/ocr/install')) {
        installStateHolder.current = { running: true, log: '' };
        return { ok: true, status: 200, json: async () => ({ ok: true, id: 'i1' }) };
      }
      if (url.includes('/kanban/llm-catalog')) return { ok: true, json: async () => ({ providers: [], models: {} }) };
      return { ok: true, json: async () => ({ effective: { wikiVault: { baseUrl: '', pagePrefix: '' }, roles: { models: {} }, reviewEngine: { mode: 'delegate', managed: { provider: '', model: '' } } }, sources: {} }) };
    }) as never;
    render(<ConfigSection fetchImpl={fetchMock} close={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '安装 ocr' }));
    expect(await screen.findByText(/正在安装 ocr/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
    // 组件轮询：进入 running 即查一次，1.5s 间隔；把 fake 终态推进去等下一轮
    installStateHolder.current = { running: false, result: 'ok', version: 'ocr v9.9', log: 'added 1 package' };
    statusHolder.current = { installed: true, version: 'ocr v9.9', mode: 'delegate', managedReady: false };
    await screen.findByText('✓ ocr ocr v9.9 已安装', undefined, { timeout: 5000 });
    // 整卡解禁：评审模式可点
    const modeTrigger = screen.getByText('委托（DT 自己的模型评审，零 key）').closest('button');
    expect(modeTrigger?.getAttribute('disabled')).toBeNull();
    expect(screen.queryByRole('button', { name: '安装 ocr' })).toBeNull();
  });

  it('切托管模式：显示提供方/模型下拉（catalog 有数据），提供方来源徽章可见', async () => {
    render(<ConfigSection fetchImpl={makeFetch({
      catalog: CATALOG,
      ocrStatus: { installed: true, version: 'ocr 1.0', mode: 'delegate', managedReady: false },
    })} close={() => {}} />);
    fireEvent.click((await screen.findByText('委托（DT 自己的模型评审，零 key）')).closest('button')!);
    fireEvent.click(screen.getByText('托管（ocr 用下选模型评审）'));
    expect(await screen.findByText('提供方')).toBeTruthy();
    expect(screen.getByText('模型')).toBeTruthy();
    expect(screen.getAllByText(/已覆盖|继承/).length).toBeGreaterThan(0); // 模型链徽章 + 评审模式徽章并存
  });

  it('卡脚文档链接：安装指南/模型配置/委托模式说明 三枚外链', async () => {
    render(<ConfigSection fetchImpl={makeFetch({ ocrStatus: { installed: true, version: 'ocr 1.0', mode: 'delegate', managedReady: true } })} close={() => {}} />);
    expect((await screen.findByRole('link', { name: '安装指南' })).getAttribute('href')).toBe('https://open-codereview.ai/docs/installation');
    expect(screen.getByRole('link', { name: '模型配置' }).getAttribute('href')).toBe('https://open-codereview.ai/docs/configuration');
    expect(screen.getByRole('link', { name: '委托模式说明' }).getAttribute('href')).toBe('https://open-codereview.ai/docs/delegate');
    expect(screen.getByRole('link', { name: '安装指南' }).getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: '安装指南' }).getAttribute('rel')).toBe('noreferrer');
  });
});
