import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCompletionMessage, buildBlockMessage } from '../domain/im-message.js';
const RETRYABLE_CODES = new Set(['bot-not-connected', 'delivery-failed']);
const DEFAULT_RETRY_DELAYS_MS = [5_000, 10_000, 15_000];
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
/** botId/targetId 解析（grill Q3/Q9 决议）：配置显式指定优先；留空自动发现唯一 wecom bot + 唯一已保存群目标；
 *  发现异常返回 error（调用方留痕不投，fail-closed——投错群比不投更糟）。 */
export async function resolveTarget(im, cfg) {
    let botId = cfg.botId.trim();
    if (!botId) {
        const bots = await im.listBots();
        const wecom = bots.filter((b) => b.channel === 'wecom');
        if (wecom.length !== 1)
            return { error: `企微机器人数量=${wecom.length}（期望 1），请在插件配置 imDelivery.botId 显式指定` };
        botId = wecom[0].botId;
    }
    let targetId = cfg.targetId.trim();
    if (!targetId) {
        const listing = await im.listTargets(botId);
        const groups = (listing.targets ?? []).filter((x) => x.kind === 'group');
        if (groups.length !== 1)
            return { error: `已保存群目标数量=${groups.length}（期望 1），请到 dsh-im 设置→IM机器人 新建目标或在插件配置 imDelivery.targetId 显式指定` };
        targetId = groups[0].targetId;
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
/** 接线：订阅看板事件多播通道（不动 setOnTaskCompleted 单消费者钩子）。
 *  listener 同步返回，投递全程 fire-and-forget 自兜异常（publish 在 emit 队列内同步调用，不得拖慢落盘）。 */
export function wireImDelivery(ctx, kanban, configProvider, opts = {}) {
    const storageDir = configProvider.getEffective().storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? homedir());
    const log = opts.log ?? ((msg) => {
        try {
            writeFileSync(join(storageDir, 'dispatcher.log'), new Date().toISOString() + ' ' + msg + '\n', { flag: 'a' });
        }
        catch { /* 忽略写失败 */ }
    });
    const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const deliver = async (chainId, text) => {
        const cfg = configProvider.getEffective().imDelivery;
        const im = resolveDshIm(ctx, log);
        if (!im)
            return;
        const t = await resolveTarget(im, cfg);
        if ('error' in t) {
            log(`[im-delivery] target resolve failed chain=${chainId}: ${t.error}`);
            return;
        }
        const r = await sendWithRetry(im, t.botId, t.targetId, text, delays, log);
        if (r.ok) {
            log(`[im-delivery] delivered chain=${chainId} bot=${t.botId} target=${t.targetId}`);
            return;
        }
        // 超限显形（grill Q4=B）：dispatcher.log + events.jsonl 双留痕；投递失败绝不 block 链。
        log(`[im-delivery] FAILED chain=${chainId}: ${r.error}`);
        try {
            await kanban.noteImDeliveryFailed(chainId, `企微投递失败（重试 ${delays.length} 次后放弃）：${r.error}`, 'system');
        }
        catch (err) {
            log(`[im-delivery] noteImDeliveryFailed failed chain=${chainId}: ` + String(err));
        }
    };
    const handle = (ev) => {
        void (async () => {
            const cfg = configProvider.getEffective().imDelivery;
            if (!cfg?.enabled)
                return; // 功能关闭：零开销早退（非异常，不留痕）
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
