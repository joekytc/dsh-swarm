// tests/services/im-bot-probe.test.ts
import { describe, it, expect } from 'vitest';
import { createBotProbe, parseBotCandidates, pickAuthCookie, type ProbeDeps } from '../../src/services/im-bot-probe.js';

/** 最小 Response 替身：只实现探针用到的 status/ok/headers/json（含 getSetCookie 与单值兜底两条读法）。 */
function resp(status: number, body: unknown, cookies: string[] = []): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      getSetCookie: () => cookies,
      get: (name: string) => (name.toLowerCase() === 'set-cookie' ? cookies[0] ?? null : null),
    } as unknown as Headers,
    json: async () => body,
  } as unknown as Response;
}

const STATUS_BODY = {
  result: {
    ok: true,
    value: {
      bots: [
        { botId: 'wecom_a', connected: true, agentPreset: 'swarm', bot: { appIdMasked: 'aibA••••1' } },
        { botId: 'wecom_b', connected: false, bot: { appIdMasked: 'aibB••••2' } },
      ],
    },
  },
};

interface Call { url: string; init: RequestInit | undefined }

function deps(overrides: Partial<ProbeDeps> = {}): { deps: ProbeDeps; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/wecom/connection.status')) return resp(200, STATUS_BODY);
    return resp(302, null, ['other=x; Path=/', 'dsh-auth-abc=v1.body.sig; Max-Age=2592000; Path=/; HttpOnly']);
  }) as unknown as typeof fetch;
  return {
    calls,
    deps: { port: () => 3080, authenticatedUrl: (base) => `${base}?token=launch`, fetchImpl, ...overrides },
  };
}

describe('parseBotCandidates', () => {
  it('正常信封 → 候选（缺失字段归一：preset 空串、connected false、label 空串）', () => {
    expect(parseBotCandidates(STATUS_BODY)).toEqual([
      { botId: 'wecom_a', agentPreset: 'swarm', connected: true, label: 'aibA••••1' },
      { botId: 'wecom_b', agentPreset: '', connected: false, label: 'aibB••••2' },
    ]);
  });
  it('形状不符（无 result.value.bots / bots 非数组 / botId 缺失）→ null（fail-closed 降级）', () => {
    expect(parseBotCandidates(null)).toBeNull();
    expect(parseBotCandidates({})).toBeNull();
    expect(parseBotCandidates({ result: { value: { bots: 'nope' } } })).toBeNull();
    expect(parseBotCandidates({ result: { value: { bots: [{ connected: true }] } } })).toBeNull();
  });
});

describe('pickAuthCookie', () => {
  it('挑 dsh-auth- 前缀项并剥属性；无该项返回 null', () => {
    expect(pickAuthCookie(['other=1; Path=/', 'dsh-auth-k=v1.a.b; HttpOnly'])).toBe('dsh-auth-k=v1.a.b');
    expect(pickAuthCookie(['other=1'])).toBeNull();
    expect(pickAuthCookie([])).toBeNull();
  });
});

describe('createBotProbe', () => {
  it('token 换 cookie → 带 cookie 调 connection.status，返回候选（cookie 不带属性）', async () => {
    const { deps: d, calls } = deps();
    const probe = createBotProbe(d);
    const r = await probe();
    expect(r).toEqual({ ok: true, bots: [
      { botId: 'wecom_a', agentPreset: 'swarm', connected: true, label: 'aibA••••1' },
      { botId: 'wecom_b', agentPreset: '', connected: false, label: 'aibB••••2' },
    ] });
    expect(calls[0]!.url).toBe('http://127.0.0.1:3080/?token=launch');
    expect(calls[0]!.init?.redirect).toBe('manual');
    expect(calls[1]!.url).toBe('http://127.0.0.1:3080/wecom/connection.status');
    const headers = calls[1]!.init?.headers as Record<string, string>;
    expect(headers['cookie']).toBe('dsh-auth-abc=v1.body.sig');
    expect(headers['origin']).toBe('http://127.0.0.1:3080');
    expect(String(calls[1]!.init?.body)).toContain('"method":"connection.status"');
  });

  it('结果短期缓存：TTL 内不再握手，过期后重探', async () => {
    let clock = 1_000;
    const { deps: d, calls } = deps({ now: () => clock });
    const probe = createBotProbe(d);
    await probe();
    await probe();
    expect(calls).toHaveLength(2);
    clock += 30_001;
    await probe();
    expect(calls).toHaveLength(4);
  });

  it('端口未就绪 / connection 缺失 → 降级 error（不抛）', async () => {
    const noPort = createBotProbe(deps({ port: () => null }).deps);
    await expect(noPort()).resolves.toEqual({ ok: false, error: 'probe-unavailable: web-server-port' });
    const noConn = createBotProbe(deps({ authenticatedUrl: () => null }).deps);
    await expect(noConn()).resolves.toEqual({ ok: false, error: 'probe-unavailable: connection' });
  });

  it('换 cookie 失败（无 Set-Cookie）→ probe-unauthorized 带状态码', async () => {
    const { deps: d } = deps({ fetchImpl: (async () => resp(401, null)) as unknown as typeof fetch });
    await expect(createBotProbe(d)()).resolves.toEqual({ ok: false, error: 'probe-unauthorized: 401' });
  });

  it('RPC 非 2xx → probe-http；形状不符 → probe-shape-mismatch', async () => {
    let call = 0;
    const httpFail = deps({
      fetchImpl: (async () => {
        call += 1;
        return call === 1 ? resp(302, null, ['dsh-auth-a=b']) : resp(500, null);
      }) as unknown as typeof fetch,
    });
    await expect(createBotProbe(httpFail.deps)()).resolves.toEqual({ ok: false, error: 'probe-http: 500' });

    let call2 = 0;
    const shapeFail = deps({
      fetchImpl: (async () => {
        call2 += 1;
        return call2 === 1 ? resp(302, null, ['dsh-auth-a=b']) : resp(200, { result: { ok: true, value: {} } });
      }) as unknown as typeof fetch,
    });
    await expect(createBotProbe(shapeFail.deps)()).resolves.toEqual({ ok: false, error: 'probe-shape-mismatch' });
  });

  it('异常 → probe-failed 只带错误码/名（不含 URL 与请求头：日志红线）', async () => {
    const boom = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3080?token=launch'), { code: 'ECONNREFUSED' });
    const { deps: d } = deps({ fetchImpl: (async () => { throw boom; }) as unknown as typeof fetch });
    const r = await createBotProbe(d)();
    expect(r).toEqual({ ok: false, error: 'probe-failed: ECONNREFUSED' });
    expect(JSON.stringify(r)).not.toContain('token');
    expect(JSON.stringify(r)).not.toContain('127.0.0.1');
  });
});
