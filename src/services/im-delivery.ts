// src/services/im-delivery.ts
// IM 主动投递装配层（企微，2026-09-07 评审决议）：订阅 KanbanService 多播事件，
// W3 收尾 → 完成汇报；chain/blocked → 阻塞通知。经 dsh-im 宿主服务（ctx.get('dshIm')）发送。
// 0.1.2 教训红线：宿主服务形状运行时守卫 + 缺失显式降级留痕，禁静默 skip。
// /sms 手动投递（2026-09-07）：消息正文必须由领域函数（buildCompletionMessage/buildBlockMessage）
// 渲染、系统代码发送；主会话模型只转述投递状态，绝不复述/撰写消息正文。
import type { Context } from '@deepseek-ai/cordis';
import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KanbanService } from '../domain/kanban-service.js';
import type { BoardState, KanbanEvent } from '../domain/types.js';
import { buildCompletionMessage, buildBlockMessage } from '../domain/im-message.js';
import type { ConfigProvider } from './config-provider.js';
import { createBotProbe, probeDepsFromCtx, type BotCandidate, type ProbeResult } from './im-bot-probe.js';

/** dsh-im 宿主服务结构接口（形状以 @xmanrui/dsh-im PROACTIVE_DELIVERY.md 为准，运行时守卫校验）。
 *  listTargets 证据（2026-09-07）：PROACTIVE_DELIVERY.md:176 `const targets = await ctx.dshIm.listTargets(botId);
 *  // [{ targetId, name?, kind, route }, ...]`；宿主 lib/index.js 实现为
 *  `listTargets: async Y => (await H.listTargets(Y)).targets`（同 Host 服务返回裸数组）。
 *  `{ botId, channel, targets }` 是 Connection RPC `target.list` 的信封形状，与同 Host 服务不同。 */
export interface DshImLike {
  send(botId: string, targetId: string, text: string, opts?: { signal?: AbortSignal }): Promise<{ sent?: boolean }>;
  listBots(): Promise<Array<{ botId: string; channel: string }>>;
  listTargets(botId: string): Promise<Array<{ targetId: string; name?: string; kind: string; route: Record<string, string> }>>;
}

export interface ImDeliveryOptions {
  /** 缺省写 storageDir/dispatcher.log（[im-delivery] 前缀；评审决议落盘位置）。 */
  log?: (msg: string) => void;
  /** 重试退避间隔（ms）；测试传 [0,0,0]。 */
  retryDelaysMs?: number[];
  /** 手动投递路径（/sms）：失败仅 dispatcher.log 留痕，不写 chain/im-delivery-failed 链事件（用户同步可见错误）。 */
  manual?: boolean;
  /** 投递目标类型（0.3.x 自由投递）：group=群聊；user=私聊（仅且只有一个已保存目标）。缺省 group。 */
  targetKind?: 'group' | 'user';
  /** 手动投递会话的 preset（工具从 session header 注入）：多机器人时用于匹配机器人默认模式。
   *  缺省=无 preset（auto 路径无会话上下文），跳过模式匹配直接走默认/交互。 */
  sessionPreset?: string;
  /** 手动投递会话的 live agent（工具从 exec.agent 注入）：userQuestions 的 GUI answerer 挂在
   *  Agent-scoped waterfall 上，不传 agent 的询问落在根 ctx 无人应答（NO_PROVIDER）。 */
  agent?: unknown;
  /** 测试注入：覆盖机器人决策链的探针/交互/写默认实现（生产由 ctx 与 configProvider 装配）。 */
  botChoice?: Partial<BotChoiceDeps>;
}

const RETRYABLE_CODES = new Set(['bot-not-connected', 'delivery-failed']);
const DEFAULT_RETRY_DELAYS_MS = [5_000, 10_000, 15_000];
/** 机器人交互选择等待上限（5 分钟）：到点 abort 信号 + 竞速超时，按「未选择」fail-closed 不投。 */
const ASK_TIMEOUT_MS = 300_000;
/** 「设为默认」选项文案：提问与应答解析共用一处，改文案两处同步（字符串比对，无 id 兜底）。 */
const ASK_SET_DEFAULT_LABEL = '设为默认';

/** dsh-im 未安装的可识别错误前缀（0.3.1：缺插件属环境问题不重试，直接友好提醒安装）。 */
export const DSH_IM_MISSING_PREFIX = 'dsh-im-not-installed';
const DSH_IM_MISSING_ERROR = `${DSH_IM_MISSING_PREFIX}: 未检测到 dsh-im 插件服务，请先安装并启用 @xmanrui/dsh-im（安装后重启 dsh 生效）`;
export const DSH_IM_MISSING_GUIDANCE = '未检测到 dsh-im 插件，无法投递企微消息。请先安装并启用 @xmanrui/dsh-im 插件（安装后重启 dsh 生效），再重试投递。';

export function isDshImLike(svc: unknown): svc is DshImLike {
  const s = svc as Partial<DshImLike> | null | undefined;
  return typeof s === 'object' && s !== null
    && typeof s.send === 'function'
    && typeof s.listBots === 'function'
    && typeof s.listTargets === 'function';
}

function resolveDshIm(ctx: Context, log: (m: string) => void): DshImLike | null {
  const svc: unknown = ctx.get('dshIm');
  if (!isDshImLike(svc)) {
    log('[im-delivery] dshIm 服务缺失或形状不符，显式降级跳过（本次不投递）');
    return null;
  }
  return svc;
}

// ── 机器人选择（多机器人消歧）─────────────────────────────────────────────────

/** 机器人来源（供调用方在 guidance 里如实转述，勿让模型猜）。 */
export type BotVia = 'explicit' | 'single' | 'preset' | 'fallback' | 'interactive';

export interface BotAskOption { botId: string; label: string }

export interface BotChoiceDeps {
  /** 当前会话 preset（手动投递由工具从 session header 注入）；null/空 = 无法模式匹配（auto 路径）。 */
  sessionPreset: string | null;
  /** 多机器人时读 bot↔preset/连接态；失败=降级（不阻断投递，退化到默认/交互）。 */
  probe: () => Promise<ProbeResult>;
  /** 交互选择；无询问通道返回 null，用户取消/超时也返回 null（fail-closed 不投）。 */
  ask: ((options: BotAskOption[]) => Promise<{ botId: string; setDefault: boolean } | null>) | null;
  /** 写默认机器人；写失败返回 false（本次投递照常，仅默认未落库）。 */
  setFallback: ((botId: string) => Promise<boolean>) | null;
  log: (m: string) => void;
}

export interface BotChoice { botId: string; via: BotVia; fallbackSaved?: boolean }

/** 交互选项展示文案：脱敏名 + id（id 是唯一可靠标识，展示名可能重名）。 */
function askLabel(o: BotAskOption): string {
  return o.label ? `${o.label}（${o.botId}）` : o.botId;
}

/** 多机器人且无法自动决策时的 fail-closed 报错：列候选（有探针数据则带模式与连接态）。 */
function botCandidatesError(ids: string[], probed: BotCandidate[]): string {
  const byId = new Map(probed.map((b) => [b.botId, b]));
  const list = ids.map((id) => {
    const c = byId.get(id);
    if (!c) return id;
    return `${id}(${c.label || '未命名'}·${c.agentPreset || '未设模式'}${c.connected ? '' : '·离线'})`;
  }).join(' / ');
  return `企微机器人数量=${ids.length}（期望 1），无法自动确定投递对象。候选：${list}。请在插件配置 imDelivery.botId 显式指定，或在可交互的手动投递会话重试以选择`;
}

/** 机器人决策链：显式配置 → 唯一机器人 → 会话 preset 命中 → 默认机器人 → 交互选择。
 *  每环都 fail-closed（宁可不投也不投错对象）；探针不可用只失去自动匹配能力，不阻断投递。 */
export async function chooseBot(
  im: DshImLike, cfg: { botId: string; fallbackBotId?: string }, deps: BotChoiceDeps,
): Promise<({ ok: true } & BotChoice) | { ok: false; error: string }> {
  const explicit = cfg.botId.trim();
  if (explicit) return { ok: true, botId: explicit, via: 'explicit' };
  const wecom = (await im.listBots()).filter((b) => b.channel === 'wecom');
  if (wecom.length === 0) {
    return { ok: false, error: '未检测到企微机器人接入：请先在 dsh-im 设置→IM机器人 接入机器人后重试' };
  }
  const ids = wecom.map((b) => b.botId);
  if (ids.length === 1) return { ok: true, botId: ids[0]!, via: 'single' };
  const fallback = (cfg.fallbackBotId ?? '').trim();
  const preset = (deps.sessionPreset ?? '').trim();
  // 只有「能模式匹配」或「能交互」时才值得探针：纯自动路径 + 无默认 → 直接给候选报错，省一次握手。
  const probed: ProbeResult = (preset || deps.ask) ? await deps.probe() : { ok: false, error: 'probe-skipped' };
  if (!probed.ok && (preset || deps.ask)) deps.log(`[im-delivery] bot probe unavailable: ${probed.error}`);
  const candidates = probed.ok ? probed.bots.filter((b) => ids.includes(b.botId)) : [];
  if (preset && candidates.length) {
    const hit = candidates.filter((b) => b.connected && b.agentPreset === preset);
    if (hit.length === 1) return { ok: true, botId: hit[0]!.botId, via: 'preset' };
    deps.log(hit.length > 1
      ? `[im-delivery] preset ${preset} 命中 ${hit.length} 个已连接机器人，不唯一，转默认/交互`
      : `[im-delivery] preset ${preset} 未命中已连接机器人（候选模式：${candidates.map((b) => b.agentPreset || '未设').join(', ') || '无元数据'}），转默认/交互`);
  }
  if (fallback && ids.includes(fallback)) return { ok: true, botId: fallback, via: 'fallback' };
  if (fallback) deps.log(`[im-delivery] 默认机器人 ${fallback} 不在接入列表，转交互`);
  if (!deps.ask) return { ok: false, error: botCandidatesError(ids, candidates) };
  const options: BotAskOption[] = ids.map((id) => {
    const c = candidates.find((b) => b.botId === id);
    if (!c) return { botId: id, label: '' };
    return { botId: id, label: `${c.label || '未命名'}·${c.agentPreset || '未设模式'}${c.connected ? '' : '·离线'}` };
  });
  const answer = await deps.ask(options);
  if (!answer) return { ok: false, error: '未选择投递机器人（交互取消或超时），本次不投递' };
  if (!answer.setDefault || !deps.setFallback) return { ok: true, botId: answer.botId, via: 'interactive' };
  const saved = await deps.setFallback(answer.botId);
  if (!saved) deps.log('[im-delivery] 默认机器人写入失败（配置未更新），本次仍按所选机器人投递');
  return { ok: true, botId: answer.botId, via: 'interactive', fallbackSaved: saved };
}

/** dsh-im 目标列表（宿主同 Host 服务返回裸数组；防御兼容 Connection RPC `target.list` 信封形状）。 */
async function readTargets(
  im: DshImLike, botId: string,
): Promise<Array<{ targetId: string; name?: string; kind: string; route: Record<string, string> }>> {
  const raw = await im.listTargets(botId) as unknown;
  if (Array.isArray(raw)) return raw as Array<{ targetId: string; name?: string; kind: string; route: Record<string, string> }>;
  const enveloped = (raw as { targets?: unknown })?.targets;
  return Array.isArray(enveloped) ? enveloped as Array<{ targetId: string; name?: string; kind: string; route: Record<string, string> }> : [];
}

/** targetId 解析：配置显式指定优先；留空自动发现该机器人下唯一已保存目标（按 kind）。
 *  群/私聊各自仅且只有一个——发现异常返回 error（调用方留痕不投，fail-closed）。
 *  机器人非显式指定（preset/默认/交互选出）而配置又填死了 targetId 时先校验归属：
 *  targetId 是 per-bot 作用域，填错机器人只会落成 dsh-im 的 unknown-target，这里提前给可行动报错。 */
export async function resolveTargetId(
  im: DshImLike, botId: string, botIdExplicit: boolean,
  cfg: { targetId: string; dmTargetId?: string }, kind: 'group' | 'user',
): Promise<{ targetId: string } | { error: string }> {
  const explicit = (kind === 'group' ? cfg.targetId : cfg.dmTargetId ?? '').trim();
  const label = kind === 'group' ? '群目标' : '私聊目标';
  const cfgHint = kind === 'group' ? 'imDelivery.targetId' : 'imDelivery.dmTargetId';
  if (explicit) {
    if (botIdExplicit) return { targetId: explicit };
    const targets = await readTargets(im, botId);
    const owned = targets.some((x) => x.targetId === explicit);
    if (owned) return { targetId: explicit };
    return { error: `${cfgHint}=${explicit} 不属于本轮选定的机器人 ${botId}（targetId 按机器人隔离）。请清空该字段改由自动发现，或显式指定 imDelivery.botId 固定机器人` };
  }
  const targets = await readTargets(im, botId);
  const matched = targets.filter((x) => x.kind === kind);
  if (matched.length !== 1) {
    const candidates = matched.length > 1 ? '，候选：' + matched.map((x) => `${x.targetId}${x.name ? `(${x.name})` : ''}`).join(' / ') : '';
    return { error: `已保存${label}数量=${matched.length}（期望 1，仅且只有一个）${candidates}。请到 dsh-im 设置→IM机器人 ${matched.length > 1 ? '清理多余目标' : '新建目标'}或在插件配置 ${cfgHint} 显式指定` };
  }
  return { targetId: matched[0]!.targetId };
}

/** botId+targetId 一步解析（无交互/无探针的简化入口，保留给单机器人场景与单测）。 */
export async function resolveTarget(
  im: DshImLike, cfg: { botId: string; targetId: string; dmTargetId?: string; fallbackBotId?: string }, kind: 'group' | 'user',
): Promise<{ botId: string; targetId: string } | { error: string }> {
  const choice = await chooseBot(im, cfg, {
    sessionPreset: null, probe: async () => ({ ok: false, error: 'probe-skipped' }), ask: null, setFallback: null, log: () => {},
  });
  if (!choice.ok) return { error: choice.error };
  const t = await resolveTargetId(im, choice.botId, cfg.botId.trim() !== '', cfg, kind);
  if ('error' in t) return t;
  return { botId: choice.botId, targetId: t.targetId };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 发送 + 退避重试（仅可重试错误码；{sent:true} 即停——dsh-im 无幂等，成功后绝不重发）。 */
export async function sendWithRetry(
  im: DshImLike, botId: string, targetId: string, text: string,
  delays: number[], log: (m: string) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await im.send(botId, targetId, text);
      if (r?.sent !== true) {
        const e = new Error('dsh-im send 返回 sent!==true');
        (e as Error & { code: string }).code = 'delivery-failed';
        throw e;
      }
      return { ok: true };
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'delivery-failed';
      if (attempt >= delays.length || !RETRYABLE_CODES.has(code)) {
        return { ok: false, error: `${code}: ${String(err)}` };
      }
      log(`[im-delivery] send failed (attempt ${attempt + 1}, code=${code})，retry after ${delays[attempt]}ms 后重试`);
      await sleep(delays[attempt]!);
    }
  }
}

/** storageDir 派生（config 占位符 $DSH_HOME 替换；auto 与 /sms 手动路径同源）。 */
function deriveStorageDir(configProvider: ConfigProvider): string {
  return configProvider.getEffective().storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? homedir());
}

function makeDefaultLog(storageDir: string): (msg: string) => void {
  return (msg: string) => {
    try { writeFileSync(join(storageDir, 'dispatcher.log'), new Date().toISOString() + ' ' + msg + '\n', { flag: 'a' }); } catch { /* 忽略写失败 */ }
  };
}

export type SendResult =
  | { ok: true; botId: string; targetId: string; via: BotVia; fallbackSaved?: boolean }
  | { ok: false; error: string };

/** duck-typed userQuestions 服务面（dsh-user-questions 注册为 ctx.userQuestions；custom 为自由文本 Other 答案）。
 *  ask 的 agent/signal 为官方契约：GUI answerer 组合在 Agent-scoped waterfall 上，agent 缺省即无人应答。 */
interface UserQuestionsLike {
  ask(req: {
    questions: Array<{
      id: string; question: string; detail?: string; header?: string;
      options?: Array<{ label: string; description?: string }>;
    }>;
    agent?: unknown;
    signal?: AbortSignal;
  }): Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }>;
}

/** 交互选择接线（仅手动投递路径）：两问一次弹——选机器人 + 是否设为默认。
 *  agent 必传（exec.agent 的 live 实例）：GUI 弹窗按 agent 路由；无询问通道返回 null（调用方 fail-closed 列候选），
 *  取消/超时/服务端拒绝同样返回 null（不投），失败原因进日志（只带错误码，不含任何敏感载荷）。 */
function buildBotAsk(ctx: Context, agent: unknown, log: (m: string) => void): BotChoiceDeps['ask'] {
  const uq = (ctx as unknown as { get?(n: string): unknown }).get?.('userQuestions') as UserQuestionsLike | undefined;
  if (typeof uq?.ask !== 'function') {
    log('[im-delivery] 机器人交互不可用：无 userQuestions 服务');
    return null;
  }
  return async (options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, ASK_TIMEOUT_MS);
    try {
      const ans = await Promise.race([
        uq.ask({
          questions: [
            {
              id: 'im-bot',
              header: '投递机器人',
              question: '本轮企微投递用哪个机器人？（当前会话模式未匹配到任何机器人）',
              detail: '展示名·默认模式；离线机器人不保证能发出。选择只作用于本次投递。',
              options: options.map((o) => ({ label: askLabel(o), description: o.botId })),
            },
            {
              id: 'im-bot-default',
              header: '设为默认',
              question: '是否把所选机器人设为默认机器人？（之后模式未命中时直接使用，不再询问）',
              detail: '写入插件配置 imDelivery.fallbackBotId（可在设置面板看到来源标记）。',
              options: [{ label: ASK_SET_DEFAULT_LABEL }, { label: '仅本次' }],
            },
          ],
          ...(agent === undefined ? {} : { agent }),
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('im-bot-ask-timeout')), ASK_TIMEOUT_MS)),
      ]);
      const pick = ans.answers?.find((a) => a.id === 'im-bot');
      const typed = pick?.custom?.trim() ?? '';
      const selected = pick?.selected?.[0]?.trim() ?? '';
      // 自由文本也接受，但必须是候选之一——防手写错 id 投到未知对象。
      const botId = options.find((o) => askLabel(o) === selected || o.botId === selected || o.botId === typed)?.botId ?? '';
      if (!botId) {
        log('[im-delivery] 机器人交互已应答但未映射到候选（selected 与候选不符）');
        return null;
      }
      const setDefault = (ans.answers?.find((a) => a.id === 'im-bot-default')?.selected ?? []).includes(ASK_SET_DEFAULT_LABEL);
      return { botId, setDefault };
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      const name = (err as { name?: unknown }).name;
      log(`[im-delivery] 机器人交互未完成: ${typeof code === 'string' && code ? code : typeof name === 'string' && name ? name : 'unknown'}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** 写默认机器人接线：经 ConfigProvider.applyOverride 落 config-override.json + 审计留痕。 */
function buildSetFallback(configProvider: ConfigProvider): (botId: string) => Promise<boolean> {
  return async (botId) => {
    try {
      const snap = configProvider.snapshot().effective;
      return configProvider.applyOverride({ ...snap, imDelivery: { fallbackBotId: botId } }).ok;
    } catch {
      return false;
    }
  };
}

/** 发送器工厂：resolveDshIm → chooseBot（fail-closed）→ resolveTargetId → sendWithRetry → 留痕。
 *  auto 路径（wireImDelivery）失败额外写 chain/im-delivery-failed 链事件；
 *  manual 路径（/sms，opts.manual）仅 dispatcher.log 留痕，错误同步返回给调用方。 */
export function createSender(
  ctx: Context, kanban: KanbanService, configProvider: ConfigProvider, opts: ImDeliveryOptions = {},
): (chainId: string, text: string) => Promise<SendResult> {
  const log = opts.log ?? makeDefaultLog(deriveStorageDir(configProvider));
  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const targetKind = opts.targetKind ?? 'group';
  // 探针单飞缓存挂在发送器上（连发 /sms 不重复握手）；交互与写默认只在手动路径接线（后台 auto 路径无人应答）。
  const probe = opts.botChoice?.probe ?? createBotProbe(probeDepsFromCtx(ctx as unknown as { get(name: string): unknown }));
  const ask = opts.botChoice?.ask !== undefined ? opts.botChoice.ask
    : (opts.manual ? buildBotAsk(ctx, opts.agent, log) : null);
  const setFallback = opts.botChoice?.setFallback !== undefined ? opts.botChoice.setFallback
    : (opts.manual ? buildSetFallback(configProvider) : null);
  return async (chainId: string, text: string) => {
    const cfg = configProvider.getEffective().imDelivery;
    const im = resolveDshIm(ctx, log);
    if (!im) {
      // 缺插件=环境问题（0.3.1）：不进重试，友好提醒安装。auto 路径写链事件让 GUI 可见；manual 路径错误同步返回。
      log(`[im-delivery] FAILED chain=${chainId}: ${DSH_IM_MISSING_ERROR}`);
      if (!opts.manual) {
        try {
          await kanban.noteImDeliveryFailed(chainId, `企微投递未生效：${DSH_IM_MISSING_GUIDANCE}`, 'system');
        } catch (err) {
          log(`[im-delivery] noteImDeliveryFailed failed chain=${chainId}: ` + String(err));
        }
      }
      return { ok: false, error: DSH_IM_MISSING_ERROR };
    }
    const choice = await chooseBot(im, cfg, {
      sessionPreset: opts.sessionPreset ?? null, probe, ask, setFallback, log,
    });
    if (!choice.ok) {
      log(`[im-delivery] bot resolve failed chain=${chainId}: ${choice.error}`);
      return { ok: false, error: choice.error };
    }
    const t = await resolveTargetId(im, choice.botId, cfg.botId.trim() !== '', cfg, targetKind);
    if ('error' in t) {
      log(`[im-delivery] target resolve failed chain=${chainId}: ${t.error}`);
      return { ok: false, error: t.error };
    }
    const r = await sendWithRetry(im, choice.botId, t.targetId, text, delays, log);
    if (r.ok) {
      log(`[im-delivery] delivered chain=${chainId} bot=${choice.botId} target=${t.targetId} via=${choice.via}`);
      return { ok: true, botId: choice.botId, targetId: t.targetId, via: choice.via, ...(choice.fallbackSaved === undefined ? {} : { fallbackSaved: choice.fallbackSaved }) };
    }
    // 超限显形（评审决议）：dispatcher.log 留痕；auto 路径追加 events.jsonl 双留痕；投递失败绝不 block 链。
    log(`[im-delivery] FAILED chain=${chainId}: ${r.error}`);
    if (!opts.manual) {
      try {
        await kanban.noteImDeliveryFailed(chainId, `企微投递失败（重试 ${delays.length} 次后放弃）：${r.error}`, 'system');
      } catch (err) {
        log(`[im-delivery] noteImDeliveryFailed failed chain=${chainId}: ` + String(err));
      }
    }
    return { ok: false, error: r.error };
  };
}

// ── /sms 手动投递（2026-09-07）：链解析 + 报告渲染 + 发送 ──────────────────────

export type ReportVariant = 'completion' | 'blocked';

/** 链上最后一个带 taskId 的 task/completed 事件（state.events 按 seq 有序）。 */
function lastCompleted(state: BoardState, chainId: string): { taskId: string; at: number } | null {
  const last = state.events.filter((e) => e.chainId === chainId && e.kind === 'task/completed' && e.taskId).at(-1);
  return last?.taskId ? { taskId: last.taskId, at: last.at } : null;
}

function lastChainBlockedAt(state: BoardState, chainId: string): number {
  const last = state.events.filter((e) => e.chainId === chainId && e.kind === 'chain/blocked').at(-1);
  return last?.at ?? -1;
}

/** 全量链内按 精确 id → 唯一 id 后缀 解析（/learning UX：歧义返回候选列表）。 */
function findByIdOrSuffix(
  chains: Array<{ id: string; title: string }>, query: string,
): { ok: true; chainId: string } | { ok: false; error: string; candidates?: Array<{ chainId: string; title: string }> } {
  const exact = chains.find((c) => c.id === query);
  if (exact) return { ok: true, chainId: exact.id };
  const matches = chains.filter((c) => c.id.endsWith(query));
  if (matches.length === 1) return { ok: true, chainId: matches[0]!.id };
  if (matches.length === 0) return { ok: false, error: 'chain-not-found' };
  return { ok: false, error: 'chain-ambiguous', candidates: matches.map((c) => ({ chainId: c.id, title: c.title })) };
}

/** /sms 链解析（纯函数）。空 query：completion=最近满足 W3 完成判据的链（最后完成事件 at 最大）；
 *  blocked=最近阻塞的链（chain/blocked 事件 at 最大）。显式 query：全量链精确/后缀解析后再验判据。 */
export function resolveReportChainId(
  state: BoardState, variant: ReportVariant, query: string,
): { ok: true; chainId: string } | { ok: false; error: string; candidates?: Array<{ chainId: string; title: string }> } {
  const q = query.trim();
  const chains = [...state.chains.values()];
  if (variant === 'blocked') {
    const blockedChains = chains.filter((c) => c.status === 'blocked');
    if (!q) {
      if (blockedChains.length === 0) return { ok: false, error: 'chain-not-found' };
      let best = blockedChains[0]!;
      let bestAt = lastChainBlockedAt(state, best.id);
      for (const c of blockedChains.slice(1)) {
        const at = lastChainBlockedAt(state, c.id);
        if (at > bestAt) { best = c; bestAt = at; }
      }
      return { ok: true, chainId: best.id };
    }
    const resolved = findByIdOrSuffix(chains, q);
    if (!resolved.ok) return resolved;
    const chain = state.chains.get(resolved.chainId)!;
    if (chain.status !== 'blocked') return { ok: false, error: 'not-blocked' };
    return { ok: true, chainId: chain.id };
  }
  // completion：判据即 buildCompletionMessage !== null（W3 收尾机械判据，防 W2 中间态误报）
  const candidates = chains.filter((c) => {
    const lc = lastCompleted(state, c.id);
    return lc !== null && buildCompletionMessage(state, c.id, lc.taskId, Date.now()) !== null;
  });
  if (!q) {
    if (candidates.length === 0) return { ok: false, error: 'chain-not-found' };
    let best = candidates[0]!;
    let bestAt = lastCompleted(state, best.id)?.at ?? -1;
    for (const c of candidates.slice(1)) {
      const at = lastCompleted(state, c.id)?.at ?? -1;
      if (at > bestAt) { best = c; bestAt = at; }
    }
    return { ok: true, chainId: best.id };
  }
  const resolved = findByIdOrSuffix(chains, q);
  if (!resolved.ok) return resolved;
  if (!candidates.some((c) => c.id === resolved.chainId)) return { ok: false, error: 'completion-not-met' };
  return { ok: true, chainId: resolved.chainId };
}

export type ParsedSendRequest = { variant: 'blocked' | 'completion' | 'free'; query: string; dm: boolean };

/** /sms rest 三岔判定（纯函数，不查看板状态）：先剥独立 '-s' token（'-sx' 粘连不算，防误伤正文）；
 *  blocked 前缀 → 链阻塞汇报（词边界：'blockedx' 等粘连 token 是正文不算）；空 → 最近完成链；
 *  其余非空 → free（是否真指链由调用方 resolveReportChainId 复判——显式 id 是强信号，先链后自由）。 */
export function parseSendRequest(rest: string): ParsedSendRequest {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  const dm = tokens.includes('-s');
  const query = tokens.filter((t) => t !== '-s').join(' ');
  if (/^blocked(\s|$)/.test(query)) return { variant: 'blocked', query: query.slice('blocked'.length).trim(), dm };
  if (!query) return { variant: 'completion', query: '', dm };
  return { variant: 'free', query, dm };
}

/** /sms 失败 guidance（主会话模型原样转述给用户；绝不生成消息正文）。 */
function reportGuidance(error: string, candidates: Array<{ chainId: string; title: string }> | undefined, sendCmd: string): string {
  if (error === 'chain-ambiguous' && candidates?.length) {
    const list = candidates.map((c) => `- ${c.chainId} ${c.title}`).join('\n');
    return `匹配到多条链，请用 ${sendCmd} <chainId> 精确指定：\n${list}`;
  }
  if (error === 'chain-not-found') return `未找到可汇报的链。可用 ${sendCmd} <chainId> 指定（完成后自动汇报的链），或 ${sendCmd} blocked [chainId] 重发阻塞通知。`;
  if (error === 'completion-not-met') return '该链不满足完成汇报判据（W3 未收尾或中间态）。';
  if (error === 'not-blocked') return '链未处于阻塞态，无阻塞通知可发。';
  return '投递失败，请将 error 字段原样转告用户，勿自行编造原因、勿复述消息正文。';
}

/** /sms 手动投递：解析链 → 领域函数渲染正文（红线：正文只出自 buildCompletionMessage/buildBlockMessage，
 *  绝不返回给模型）→ createSender 发送。不受 imDelivery.enabled 门控（显式人工调用即意图），
 *  但仍要求 dshIm 服务在位且形状合法、目标可解析（同 auto 路径 fail-closed 规则）。 */
export async function sendChainReport(
  ctx: Context, kanban: KanbanService, configProvider: ConfigProvider,
  opts: ImDeliveryOptions, variant: ReportVariant, query: string,
): Promise<{ ok: true; chainId: string; botId: string; targetId: string; via: BotVia; fallbackSaved?: boolean } | { ok: false; error: string; guidance?: string }> {
  const state = await kanban.snapshot();
  const resolved = resolveReportChainId(state, variant, query);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, guidance: reportGuidance(resolved.error, resolved.candidates, configProvider.getEffective().prefixRoutes.send) };
  }
  const chainId = resolved.chainId;
  let text: string;
  if (variant === 'completion') {
    const lc = lastCompleted(state, chainId);
    const rendered = lc !== null ? buildCompletionMessage(state, chainId, lc.taskId, Date.now()) : null;
    if (rendered === null) return { ok: false, error: 'completion-not-met' };
    text = rendered;
  } else {
    const reason = state.events.filter((e) => e.chainId === chainId && e.kind === 'chain/blocked').at(-1)?.payload['reason'];
    text = buildBlockMessage(state, chainId, String(reason ?? ''), deriveStorageDir(configProvider));
  }
  const r = await createSender(ctx, kanban, configProvider, { ...opts, manual: true })(chainId, text);
  if (!r.ok) {
    // 缺插件错误附安装指引，主 agent 原样转告用户（0.3.1 友好提醒）。
    return r.error.startsWith(DSH_IM_MISSING_PREFIX)
      ? { ok: false, error: r.error, guidance: DSH_IM_MISSING_GUIDANCE }
      : { ok: false, error: r.error };
  }
  return { ok: true, chainId, botId: r.botId, targetId: r.targetId, via: r.via, ...(r.fallbackSaved === undefined ? {} : { fallbackSaved: r.fallbackSaved }) };
}

/** 接线：订阅看板事件多播通道（不动 setOnTaskCompleted 单消费者钩子）。
 *  listener 同步返回，投递全程 fire-and-forget 自兜异常（publish 在 emit 队列内同步调用，不得拖慢落盘）。 */
export function wireImDelivery(ctx: Context, kanban: KanbanService, configProvider: ConfigProvider, opts: ImDeliveryOptions = {}): () => void {
  const storageDir = deriveStorageDir(configProvider);
  const log = opts.log ?? makeDefaultLog(storageDir);
  const deliver = createSender(ctx, kanban, configProvider, opts);

  const handle = (ev: KanbanEvent): void => {
    void (async () => {
      const cfg = configProvider.getEffective().imDelivery;
      if (!cfg?.enabled) return; // 功能关闭：零开销早退（非异常，不留痕）
      // 仅 task/completed（带 taskId）/ chain/blocked / review/gave-up 关心事件流；其余早退，避免每个无关事件触发 snapshot 全量重放。
      // 2026-09-15：+ review/gave-up（评审超限待裁决）——不再静默等看门狗 block，人工在 gave-up 时刻即获通知与两条出口。
      if (!((ev.kind === 'task/completed' && ev.taskId) || ev.kind === 'chain/blocked' || ev.kind === 'review/gave-up')) return;
      const state = await kanban.snapshot();
      if (ev.kind === 'task/completed' && ev.taskId) {
        const msg = buildCompletionMessage(state, ev.chainId, ev.taskId, Date.now());
        if (msg) await deliver(ev.chainId, msg);
      } else if (ev.kind === 'chain/blocked') {
        const chain = state.chains.get(ev.chainId);
        if (!chain) return;
        const msg = buildBlockMessage(state, ev.chainId, String(ev.payload['reason'] ?? ''), storageDir);
        await deliver(ev.chainId, msg);
      } else if (ev.kind === 'review/gave-up') {
        const chain = state.chains.get(ev.chainId);
        if (!chain) return;
        const reviewTaskId = String(ev.payload['reviewTaskId'] ?? '');
        const targetTaskId = String(ev.payload['targetTaskId'] ?? '');
        const msg = [
          `【评审超限待裁决】${chain.title || ev.chainId} 的评审卡 ${reviewTaskId} 超限放弃（${String(ev.payload['reason'] ?? '')}）。`,
          `被评审卡：${targetTaskId}`,
          '两条出口：',
          '① 人工豁免评审 → 计划评审按通过继续（GUI 任务详情「豁免评审」按钮 / 主会话 kanban_waive_review）；',
          '② 人工恢复链后按需返工（GUI 链头「人工恢复」按钮 / 主会话 kanban_reopen_chain）。',
          '若无人处置，看门狗将在链持续无进展后把链置 blocked（届时可人工恢复）。',
        ].join('\n');
        await deliver(ev.chainId, msg);
      }
    })().catch((err) => log('[im-delivery] handler failed ev=' + ev.kind + ': ' + String(err)));
  };

  return kanban.subscribe(handle);
}
