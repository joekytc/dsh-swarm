import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCompletionMessage, buildBlockMessage } from '../domain/im-message.js';
const RETRYABLE_CODES = new Set(['bot-not-connected', 'delivery-failed']);
const DEFAULT_RETRY_DELAYS_MS = [5_000, 10_000, 15_000];
/** dsh-im 未安装的可识别错误前缀（0.3.1：缺插件属环境问题不重试，直接友好提醒安装）。 */
export const DSH_IM_MISSING_PREFIX = 'dsh-im-not-installed';
const DSH_IM_MISSING_ERROR = `${DSH_IM_MISSING_PREFIX}: 未检测到 dsh-im 插件服务，请先安装并启用 @xmanrui/dsh-im（安装后重启 dsh 生效）`;
export const DSH_IM_MISSING_GUIDANCE = '未检测到 dsh-im 插件，无法投递企微消息。请先安装并启用 @xmanrui/dsh-im 插件（安装后重启 dsh 生效），再重试投递。';
export function isDshImLike(svc) {
    const s = svc;
    return typeof s === 'object' && s !== null
        && typeof s.send === 'function'
        && typeof s.listBots === 'function'
        && typeof s.listTargets === 'function';
}
function resolveDshIm(ctx, log) {
    const svc = ctx.get('dshIm');
    if (!isDshImLike(svc)) {
        log('[im-delivery] dshIm 服务缺失或形状不符，显式降级跳过（本次不投递）');
        return null;
    }
    return svc;
}
/** botId/targetId 解析（评审决议）：配置显式指定优先；留空自动发现唯一 wecom bot + 唯一已保存目标（按 kind）。
 *  群/私聊各自仅且只有一个——发现异常返回 error（调用方留痕不投，fail-closed——投错对象比不投更糟）。 */
export async function resolveTarget(im, cfg, kind) {
    let botId = cfg.botId.trim();
    if (!botId) {
        const bots = await im.listBots();
        const wecom = bots.filter((b) => b.channel === 'wecom');
        if (wecom.length !== 1)
            return { error: `企微机器人数量=${wecom.length}（期望 1），请在插件配置 imDelivery.botId 显式指定` };
        botId = wecom[0].botId;
    }
    const explicit = (kind === 'group' ? cfg.targetId : cfg.dmTargetId ?? '').trim();
    let targetId = explicit;
    if (!targetId) {
        const raw = await im.listTargets(botId);
        // 宿主同 Host 服务返回裸数组（PROACTIVE_DELIVERY.md:176）；防御兼容 Connection RPC `target.list` 信封形状。
        const targets = Array.isArray(raw) ? raw : Array.isArray(raw?.targets)
            ? raw.targets
            : [];
        const matched = targets.filter((x) => x.kind === kind);
        const label = kind === 'group' ? '群目标' : '私聊目标';
        const cfgHint = kind === 'group' ? 'imDelivery.targetId' : 'imDelivery.dmTargetId';
        if (matched.length !== 1) {
            const candidates = matched.length > 1 ? '，候选：' + matched.map((x) => `${x.targetId}${x.name ? `(${x.name})` : ''}`).join(' / ') : '';
            return { error: `已保存${label}数量=${matched.length}（期望 1，仅且只有一个）${candidates}。请到 dsh-im 设置→IM机器人 ${matched.length > 1 ? '清理多余目标' : '新建目标'}或在插件配置 ${cfgHint} 显式指定` };
        }
        targetId = matched[0].targetId;
    }
    return { botId, targetId };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 发送 + 退避重试（仅可重试错误码；{sent:true} 即停——dsh-im 无幂等，成功后绝不重发）。 */
export async function sendWithRetry(im, botId, targetId, text, delays, log) {
    for (let attempt = 0;; attempt++) {
        try {
            const r = await im.send(botId, targetId, text);
            if (r?.sent !== true) {
                const e = new Error('dsh-im send 返回 sent!==true');
                e.code = 'delivery-failed';
                throw e;
            }
            return { ok: true };
        }
        catch (err) {
            const code = err.code ?? 'delivery-failed';
            if (attempt >= delays.length || !RETRYABLE_CODES.has(code)) {
                return { ok: false, error: `${code}: ${String(err)}` };
            }
            log(`[im-delivery] send failed (attempt ${attempt + 1}, code=${code})，retry after ${delays[attempt]}ms 后重试`);
            await sleep(delays[attempt]);
        }
    }
}
/** storageDir 派生（config 占位符 $DSH_HOME 替换；auto 与 /sms 手动路径同源）。 */
function deriveStorageDir(configProvider) {
    return configProvider.getEffective().storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? homedir());
}
function makeDefaultLog(storageDir) {
    return (msg) => {
        try {
            writeFileSync(join(storageDir, 'dispatcher.log'), new Date().toISOString() + ' ' + msg + '\n', { flag: 'a' });
        }
        catch { /* 忽略写失败 */ }
    };
}
/** 发送器工厂：resolveDshIm → resolveTarget（fail-closed）→ sendWithRetry → 留痕。
 *  auto 路径（wireImDelivery）失败额外写 chain/im-delivery-failed 链事件；
 *  manual 路径（/sms，opts.manual）仅 dispatcher.log 留痕，错误同步返回给调用方。 */
export function createSender(ctx, kanban, configProvider, opts = {}) {
    const log = opts.log ?? makeDefaultLog(deriveStorageDir(configProvider));
    const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const targetKind = opts.targetKind ?? 'group';
    return async (chainId, text) => {
        const cfg = configProvider.getEffective().imDelivery;
        const im = resolveDshIm(ctx, log);
        if (!im) {
            // 缺插件=环境问题（0.3.1）：不进重试，友好提醒安装。auto 路径写链事件让 GUI 可见；manual 路径错误同步返回。
            log(`[im-delivery] FAILED chain=${chainId}: ${DSH_IM_MISSING_ERROR}`);
            if (!opts.manual) {
                try {
                    await kanban.noteImDeliveryFailed(chainId, `企微投递未生效：${DSH_IM_MISSING_GUIDANCE}`, 'system');
                }
                catch (err) {
                    log(`[im-delivery] noteImDeliveryFailed failed chain=${chainId}: ` + String(err));
                }
            }
            return { ok: false, error: DSH_IM_MISSING_ERROR };
        }
        const t = await resolveTarget(im, cfg, targetKind);
        if ('error' in t) {
            log(`[im-delivery] target resolve failed chain=${chainId}: ${t.error}`);
            return { ok: false, error: t.error };
        }
        const r = await sendWithRetry(im, t.botId, t.targetId, text, delays, log);
        if (r.ok) {
            log(`[im-delivery] delivered chain=${chainId} bot=${t.botId} target=${t.targetId}`);
            return { ok: true, botId: t.botId, targetId: t.targetId };
        }
        // 超限显形（评审决议）：dispatcher.log 留痕；auto 路径追加 events.jsonl 双留痕；投递失败绝不 block 链。
        log(`[im-delivery] FAILED chain=${chainId}: ${r.error}`);
        if (!opts.manual) {
            try {
                await kanban.noteImDeliveryFailed(chainId, `企微投递失败（重试 ${delays.length} 次后放弃）：${r.error}`, 'system');
            }
            catch (err) {
                log(`[im-delivery] noteImDeliveryFailed failed chain=${chainId}: ` + String(err));
            }
        }
        return { ok: false, error: r.error };
    };
}
/** 链上最后一个带 taskId 的 task/completed 事件（state.events 按 seq 有序）。 */
function lastCompleted(state, chainId) {
    const last = state.events.filter((e) => e.chainId === chainId && e.kind === 'task/completed' && e.taskId).at(-1);
    return last?.taskId ? { taskId: last.taskId, at: last.at } : null;
}
function lastChainBlockedAt(state, chainId) {
    const last = state.events.filter((e) => e.chainId === chainId && e.kind === 'chain/blocked').at(-1);
    return last?.at ?? -1;
}
/** 全量链内按 精确 id → 唯一 id 后缀 解析（/learning UX：歧义返回候选列表）。 */
function findByIdOrSuffix(chains, query) {
    const exact = chains.find((c) => c.id === query);
    if (exact)
        return { ok: true, chainId: exact.id };
    const matches = chains.filter((c) => c.id.endsWith(query));
    if (matches.length === 1)
        return { ok: true, chainId: matches[0].id };
    if (matches.length === 0)
        return { ok: false, error: 'chain-not-found' };
    return { ok: false, error: 'chain-ambiguous', candidates: matches.map((c) => ({ chainId: c.id, title: c.title })) };
}
/** /sms 链解析（纯函数）。空 query：completion=最近满足 W3 完成判据的链（最后完成事件 at 最大）；
 *  blocked=最近阻塞的链（chain/blocked 事件 at 最大）。显式 query：全量链精确/后缀解析后再验判据。 */
export function resolveReportChainId(state, variant, query) {
    const q = query.trim();
    const chains = [...state.chains.values()];
    if (variant === 'blocked') {
        const blockedChains = chains.filter((c) => c.status === 'blocked');
        if (!q) {
            if (blockedChains.length === 0)
                return { ok: false, error: 'chain-not-found' };
            let best = blockedChains[0];
            let bestAt = lastChainBlockedAt(state, best.id);
            for (const c of blockedChains.slice(1)) {
                const at = lastChainBlockedAt(state, c.id);
                if (at > bestAt) {
                    best = c;
                    bestAt = at;
                }
            }
            return { ok: true, chainId: best.id };
        }
        const resolved = findByIdOrSuffix(chains, q);
        if (!resolved.ok)
            return resolved;
        const chain = state.chains.get(resolved.chainId);
        if (chain.status !== 'blocked')
            return { ok: false, error: 'not-blocked' };
        return { ok: true, chainId: chain.id };
    }
    // completion：判据即 buildCompletionMessage !== null（W3 收尾机械判据，防 W2 中间态误报）
    const candidates = chains.filter((c) => {
        const lc = lastCompleted(state, c.id);
        return lc !== null && buildCompletionMessage(state, c.id, lc.taskId, Date.now()) !== null;
    });
    if (!q) {
        if (candidates.length === 0)
            return { ok: false, error: 'chain-not-found' };
        let best = candidates[0];
        let bestAt = lastCompleted(state, best.id)?.at ?? -1;
        for (const c of candidates.slice(1)) {
            const at = lastCompleted(state, c.id)?.at ?? -1;
            if (at > bestAt) {
                best = c;
                bestAt = at;
            }
        }
        return { ok: true, chainId: best.id };
    }
    const resolved = findByIdOrSuffix(chains, q);
    if (!resolved.ok)
        return resolved;
    if (!candidates.some((c) => c.id === resolved.chainId))
        return { ok: false, error: 'completion-not-met' };
    return { ok: true, chainId: resolved.chainId };
}
/** /sms rest 三岔判定（纯函数，不查看板状态）：先剥独立 '-s' token（'-sx' 粘连不算，防误伤正文）；
 *  blocked 前缀 → 链阻塞汇报（词边界：'blockedx' 等粘连 token 是正文不算）；空 → 最近完成链；
 *  其余非空 → free（是否真指链由调用方 resolveReportChainId 复判——显式 id 是强信号，先链后自由）。 */
export function parseSendRequest(rest) {
    const tokens = rest.trim().split(/\s+/).filter(Boolean);
    const dm = tokens.includes('-s');
    const query = tokens.filter((t) => t !== '-s').join(' ');
    if (/^blocked(\s|$)/.test(query))
        return { variant: 'blocked', query: query.slice('blocked'.length).trim(), dm };
    if (!query)
        return { variant: 'completion', query: '', dm };
    return { variant: 'free', query, dm };
}
/** /sms 失败 guidance（主会话模型原样转述给用户；绝不生成消息正文）。 */
function reportGuidance(error, candidates, sendCmd) {
    if (error === 'chain-ambiguous' && candidates?.length) {
        const list = candidates.map((c) => `- ${c.chainId} ${c.title}`).join('\n');
        return `匹配到多条链，请用 ${sendCmd} <chainId> 精确指定：\n${list}`;
    }
    if (error === 'chain-not-found')
        return `未找到可汇报的链。可用 ${sendCmd} <chainId> 指定（完成后自动汇报的链），或 ${sendCmd} blocked [chainId] 重发阻塞通知。`;
    if (error === 'completion-not-met')
        return '该链不满足完成汇报判据（W3 未收尾或中间态）。';
    if (error === 'not-blocked')
        return '链未处于阻塞态，无阻塞通知可发。';
    return '投递失败，请将 error 字段原样转告用户，勿自行编造原因、勿复述消息正文。';
}
/** /sms 手动投递：解析链 → 领域函数渲染正文（红线：正文只出自 buildCompletionMessage/buildBlockMessage，
 *  绝不返回给模型）→ createSender 发送。不受 imDelivery.enabled 门控（显式人工调用即意图），
 *  但仍要求 dshIm 服务在位且形状合法、目标可解析（同 auto 路径 fail-closed 规则）。 */
export async function sendChainReport(ctx, kanban, configProvider, opts, variant, query) {
    const state = await kanban.snapshot();
    const resolved = resolveReportChainId(state, variant, query);
    if (!resolved.ok) {
        return { ok: false, error: resolved.error, guidance: reportGuidance(resolved.error, resolved.candidates, configProvider.getEffective().prefixRoutes.send) };
    }
    const chainId = resolved.chainId;
    let text;
    if (variant === 'completion') {
        const lc = lastCompleted(state, chainId);
        const rendered = lc !== null ? buildCompletionMessage(state, chainId, lc.taskId, Date.now()) : null;
        if (rendered === null)
            return { ok: false, error: 'completion-not-met' };
        text = rendered;
    }
    else {
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
    return { ok: true, chainId, botId: r.botId, targetId: r.targetId };
}
/** 接线：订阅看板事件多播通道（不动 setOnTaskCompleted 单消费者钩子）。
 *  listener 同步返回，投递全程 fire-and-forget 自兜异常（publish 在 emit 队列内同步调用，不得拖慢落盘）。 */
export function wireImDelivery(ctx, kanban, configProvider, opts = {}) {
    const storageDir = deriveStorageDir(configProvider);
    const log = opts.log ?? makeDefaultLog(storageDir);
    const deliver = createSender(ctx, kanban, configProvider, opts);
    const handle = (ev) => {
        void (async () => {
            const cfg = configProvider.getEffective().imDelivery;
            if (!cfg?.enabled)
                return; // 功能关闭：零开销早退（非异常，不留痕）
            // 仅 task/completed（带 taskId）与 chain/blocked 关心事件流；其余早退，避免每个无关事件触发 snapshot 全量重放
            if (!((ev.kind === 'task/completed' && ev.taskId) || ev.kind === 'chain/blocked'))
                return;
            const state = await kanban.snapshot();
            if (ev.kind === 'task/completed' && ev.taskId) {
                const msg = buildCompletionMessage(state, ev.chainId, ev.taskId, Date.now());
                if (msg)
                    await deliver(ev.chainId, msg);
            }
            else if (ev.kind === 'chain/blocked') {
                const chain = state.chains.get(ev.chainId);
                if (!chain)
                    return;
                const msg = buildBlockMessage(state, ev.chainId, String(ev.payload['reason'] ?? ''), storageDir);
                await deliver(ev.chainId, msg);
            }
        })().catch((err) => log('[im-delivery] handler failed ev=' + ev.kind + ': ' + String(err)));
    };
    return kanban.subscribe(handle);
}
