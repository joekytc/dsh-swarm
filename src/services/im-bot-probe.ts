// src/services/im-bot-probe.ts
// 多机器人消歧探针：读 dsh-im 侧每个企微机器人的 agentPreset（默认 dsh 模式）与连接态。
//
// 数据源是 dsh-im 的管理 RPC `/wecom/connection.status`（WECOM_ENDPOINTS.status）。该通道只对浏览器开放
// （loopback authority + dsh-auth cookie），宿主插件侧没有本地 invoke 面（HostConnectionRpc 只有
// handle/intercept），故这里走「进程 token 换 cookie 再自调用」的公开路径：
//   ctx.connection.authenticatedUrl(base) → GET `/` 拿 Set-Cookie → 带 cookie POST 该 RPC。
// launchToken 只存在于进程内存（WeakMap），不落盘；cookie 是自包含 HMAC，重铸成本极低。
//
// 红线（本模块唯一允许接触 cookie 的地方）：
//   1. cookie / token / URL / 请求头绝不进任何日志、错误消息或链事件（dispatcher.log 与 events.jsonl 都长期留盘）；
//   2. 探针失败一律降级（返回 {ok:false}），绝不让投递整体失败——调用方退化到默认机器人/交互选择；
//   3. 上游改 RPC 形状 → parseBotCandidates 返回 null → fail-closed 同样走降级，不静默投错对象。

/** 一个企微机器人的探针视图（字段取自 connection.status 的 bots[]，缺失值归一为空/离线）。 */
export interface BotCandidate {
  botId: string;
  /** 该机器人的默认 dsh 模式（dsh-im 设置页的 agentPreset）；未设置时为空串。 */
  agentPreset: string;
  connected: boolean;
  /** 展示名（appIdMasked，脱敏 id），仅用于交互提示。 */
  label: string;
}

export type ProbeResult =
  | { ok: true; bots: BotCandidate[] }
  | { ok: false; error: string };

/** 探针依赖（全部注入，便于测试与惰性读取）。 */
export interface ProbeDeps {
  /** 监听端口；未就绪（webServer 未挂载/未 listen）返回 null。 */
  port: () => number | null;
  /** 进程 token 换 cookie 的入口（ctx.connection.authenticatedUrl）；服务缺失返回 null。 */
  authenticatedUrl: (base: string) => string | null;
  fetchImpl: typeof fetch;
  /** 时钟（缓存 TTL 测试用）。 */
  now?: () => number;
}

const PROBE_TIMEOUT_MS = 1_500;
const CACHE_TTL_MS = 30_000;
const STATUS_PATH = '/wecom/connection.status';
const COOKIE_PREFIX = 'dsh-auth-';

type FetchLike = typeof fetch;

/** connection.status 响应信封 → 候选数组。形状不符返回 null（上游改形状即降级，不猜字段）。 */
export function parseBotCandidates(raw: unknown): BotCandidate[] | null {
  const bots = (raw as { result?: { value?: { bots?: unknown } } } | null)?.result?.value?.bots;
  if (!Array.isArray(bots)) return null;
  const out: BotCandidate[] = [];
  for (const entry of bots) {
    const botId = (entry as { botId?: unknown } | null)?.botId;
    if (typeof botId !== 'string' || !botId) return null;
    const preset = (entry as { agentPreset?: unknown }).agentPreset;
    const label = (entry as { bot?: { appIdMasked?: unknown } } | null)?.bot?.appIdMasked;
    out.push({
      botId,
      agentPreset: typeof preset === 'string' ? preset : '',
      connected: (entry as { connected?: unknown }).connected === true,
      label: typeof label === 'string' ? label : '',
    });
  }
  return out;
}

/** Set-Cookie 头 → `name=value` 片段（剥属性）。无 dsh-auth 前缀项返回 null。 */
export function pickAuthCookie(lines: readonly string[]): string | null {
  for (const line of lines) {
    const pair = line.split(';')[0]?.trim() ?? '';
    if (pair.startsWith(COOKIE_PREFIX)) return pair;
  }
  return null;
}

function setCookieLines(headers: Headers): string[] {
  const multi = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
  if (Array.isArray(multi) && multi.length > 0) return multi;
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

/** 错误归一：只取错误码/名，绝不带 URL、请求头或 cookie（日志红线）。 */
function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code) return code;
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name ? name : 'probe-failed';
}

async function runProbe(deps: ProbeDeps): Promise<ProbeResult> {
  const port = deps.port();
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0) {
    return { ok: false, error: 'probe-unavailable: web-server-port' };
  }
  const base = `http://127.0.0.1:${port}`;
  const exchangeUrl = deps.authenticatedUrl(`${base}/`);
  if (!exchangeUrl) return { ok: false, error: 'probe-unavailable: connection' };
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, PROBE_TIMEOUT_MS);
  try {
    // 进程 token → cookie：GET 应用根，白拿 Set-Cookie（不跟随重定向，避免多一次无用请求）。
    const index = await deps.fetchImpl(exchangeUrl, { redirect: 'manual', signal: controller.signal });
    const cookie = pickAuthCookie(setCookieLines(index.headers));
    if (!cookie) return { ok: false, error: `probe-unauthorized: ${index.status}` };
    const res = await deps.fetchImpl(base + STATUS_PATH, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', origin: base, cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: 'dsh-swarm-bot-probe', method: 'connection.status', payload: {} }),
    });
    if (!res.ok) return { ok: false, error: `probe-http: ${res.status}` };
    const bots = parseBotCandidates(await res.json());
    if (bots === null) return { ok: false, error: 'probe-shape-mismatch' };
    return { ok: true, bots };
  } catch (err) {
    return { ok: false, error: `probe-failed: ${errorCode(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 探针工厂：同一实例内结果短期缓存（连发 /sms 不重复握手），失败同样缓存以免每次重试打满超时。 */
export function createBotProbe(deps: ProbeDeps): () => Promise<ProbeResult> {
  const now = deps.now ?? Date.now;
  let cached: { at: number; result: ProbeResult } | null = null;
  return async () => {
    if (cached && now() - cached.at < CACHE_TTL_MS) return cached.result;
    const result = await runProbe(deps);
    cached = { at: now(), result };
    return result;
  };
}

/** 从 cordis ctx 装配探针依赖（惰性：每次调用才读端口与 connection，避免 apply 期缓存未就绪的值）。 */
export function probeDepsFromCtx(ctx: { get(name: string): unknown }): ProbeDeps {
  return {
    port: () => {
      const ws = ctx.get('webServer') as { port?: unknown } | undefined;
      return typeof ws?.port === 'number' ? ws.port : null;
    },
    authenticatedUrl: (base) => {
      const conn = ctx.get('connection') as { authenticatedUrl?: unknown } | undefined;
      if (typeof conn?.authenticatedUrl !== 'function') return null;
      return (conn.authenticatedUrl as (b: string) => string)(base);
    },
    fetchImpl: ((...args: Parameters<FetchLike>) => fetch(...args)) as FetchLike,
  };
}
