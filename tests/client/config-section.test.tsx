// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigSection } from '../../client/ConfigSection.js';

describe('ConfigSection', () => {
  it('渲染 baseUrl 输入与提示文案', async () => {
    // config 与 llm-catalog 两个端点按 URL 分发（brief 草图单 mock 共用 payload 会让 catalog 缺 models 字段）
    const fetchMock = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/kanban/llm-catalog')) {
        return { ok: true, json: async () => ({ providers: [], models: {} }) };
      }
      return { ok: true, json: async () => ({ effective: { wikiVault: { baseUrl: '', pagePrefix: '' }, roles: { models: {} } }, sources: {} }) };
    }) as never;
    render(<ConfigSection fetchImpl={fetchMock} close={() => {}} />);
    expect((await screen.findAllByText(/llm-wiki/)).length).toBeGreaterThan(0);
  });
});
