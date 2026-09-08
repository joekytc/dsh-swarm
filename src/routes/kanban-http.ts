import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KanbanConfig } from '../config.js';
import type { KanbanProvider } from '../services/kanban-provider.js';
import type { ConfigProvider } from '../services/config-provider.js';
import type { LlmRuntimeLike } from '../services/llm-catalog.js';
import { buildLlmCatalog } from '../services/llm-catalog.js';
import type { EditableSnapshot } from '../domain/config-override.js';
import { INSTALL_GUIDANCE, OCR_PACKAGE, managedProviderReady, probeOcr, wireManagedProvider } from '../services/ocr-cli.js';
import { serveKanbanEvents } from './kanban-sse.js';

interface WebRouteLike {
  kind: 'exact' | 'prefix';
  path: string;
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
}

interface WebServerLike {
  register(route: WebRouteLike): () => void;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** ocr 全局安装器：回调式 npm install -g，onSpawn 转交子进程句柄供取消。 */
export type OcrInstaller = (onSpawn?: (child: { kill(sig?: string): boolean }) => void) => Promise<{ ok: boolean; version?: string; log: string }>;

/** ocr HTTP 分支可注入依赖（测试用）；缺省走真实现。 */
export interface KanbanOcrDeps {
  installer?: OcrInstaller;
  probeFn?: typeof probeOcr;
  managedReadyFn?: typeof managedProviderReady;
  wirer?: (a: { provider: string; model: string }) => Promise<{ ok: boolean; log: string }>;
}

const defaultOcrInstaller: OcrInstaller = (onSpawn) =>
  new Promise((resolve) => {
    const child = execFile('npm', ['install', '-g', OCR_PACKAGE], { timeout: 600_000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, log: `${err.message}\n${String(stderr ?? '')}`.trim() });
      else resolve({ ok: true, log: String(stdout ?? '') });
    });
    onSpawn?.(child as unknown as { kill(sig?: string): boolean });
  });

/** 模块级单飞安装任务态：同一插件进程同时只允许一个 npm 全局安装在跑。 */
let installJob: {
  id: string;
  running: boolean;
  child: { kill(sig?: string): boolean } | null;
  result?: 'ok' | 'failed' | 'cancelled';
  version?: string;
  log: string;
} | null = null;

/** 安装关键事件落盘（与 dispatcher.log 同文件同格式，写失败静默——日志只是观测面）。 */
function logOcrEvent(configProvider: ConfigProvider, msg: string): void {
  try {
    const storageDir = configProvider.getEffective().storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? process.cwd());
    writeFileSync(join(storageDir, 'dispatcher.log'), new Date().toISOString() + ' ' + msg + '\n', { flag: 'a' });
  } catch { /* 忽略写失败 */ }
}

async function runOcrInstall(deps: KanbanOcrDeps | undefined, configProvider: ConfigProvider): Promise<void> {
  const job = installJob;
  if (!job) return;
  try {
    const r = await (deps?.installer ?? defaultOcrInstaller)((child) => { job.child = child; });
    if (!job.running) return; // 已取消：cancelled 是终态，迟到的安装结果不覆盖
    job.running = false;
    job.log = r.log;
    if (r.ok) {
      job.result = 'ok';
      const probe = await (deps?.probeFn ?? probeOcr)();
      job.version = probe.version;
      logOcrEvent(configProvider, '[ocr-install] ok' + (probe.version ? ' version=' + probe.version : ''));
    } else {
      job.result = 'failed';
      logOcrEvent(configProvider, '[ocr-install] failed');
    }
  } catch (err) {
    if (!job.running) return;
    job.running = false;
    job.result = 'failed';
    job.log = String(err);
    logOcrEvent(configProvider, '[ocr-install] failed: ' + String(err));
  }
}

/** wire 降级文案：解析不到该提供方接入信息时，引导终端手动配置（不写半套 ocr 配置）。 */
const OCR_WIRE_DEGRADED =
  '未能从 dsh 解析该提供方的接入信息（baseUrl/apiKey）——请在终端手动执行 ocr config provider 完成托管配置；委托模式不受影响';

/**
 * 从宿主设置解析所选提供方的接入信息（baseUrl/协议/apiKey）。
 * 事实核查结论（实现期探查）：llm 服务的公开 API 不暴露连接事实，但同进程可经
 * settings 服务的 describe() 读到模型适配器的 provider profile——形如
 * { providers: { <id>: { baseURL, api, apiKey | apiKeyEnv } } }（apiKeyEnv 指向进程环境变量名）。
 * 命中 profile 但字段不全时返回 null 走降级，绝不回传半套配置；apiKey 只透传给 ocr config，不落日志。
 */
function resolveDshProviderAccess(ctx: Context, providerId: string): { baseUrl: string; protocol: 'openai' | 'anthropic'; apiKey: string } | null {
  try {
    const settings = ctx.get('settings') as { describe?: () => Array<{ value: unknown }> } | undefined;
    const descriptors = settings?.describe?.() ?? [];
    for (const d of descriptors) {
      const providers = (d.value as { providers?: Record<string, Record<string, unknown>> } | undefined)?.providers;
      const profile = providers?.[providerId];
      if (!profile || typeof profile !== 'object') continue;
      const baseUrl = typeof profile.baseURL === 'string' ? profile.baseURL : '';
      const api = typeof profile.api === 'string' ? profile.api : '';
      const protocol = api.startsWith('openai') ? 'openai' : api.includes('anthropic') ? 'anthropic' : '';
      let apiKey = typeof profile.apiKey === 'string' ? profile.apiKey : '';
      if (!apiKey && typeof profile.apiKeyEnv === 'string') apiKey = process.env[profile.apiKeyEnv] ?? '';
      return baseUrl && protocol && apiKey ? { baseUrl, protocol, apiKey } : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** 看板 HTTP 桥（Web GUI 浏览器半消费）：GET /kanban/board 读快照；POST /kanban/action 执行状态操作；
 *  GET/PUT /kanban/config + POST /kanban/config/reset 配置读写；GET /kanban/llm-catalog 模型目录；
 *  GET /kanban/ocr/status + POST /kanban/ocr/install(/cancel) + GET install/state + POST /kanban/ocr/wire ocr 评审引擎运维。
 *  仅在 webServer 服务存在时挂载（CLI/headless/测试裸 Context 不挂）。 */
export function registerKanbanHttp(
  ctx: Context,
  provider: KanbanProvider,
  configProvider: ConfigProvider,
  llm: LlmRuntimeLike,
  config?: Pick<KanbanConfig, 'ui'>,
  ocrDeps?: KanbanOcrDeps,
): void {
  // 可选服务：经 ctx.get 读取（cordis 4 直接属性读取需 inject；get 不需要）
  const webServer = ctx.get('webServer') as WebServerLike | undefined;
  if (!webServer) return;
  webServer.register({
    kind: 'prefix',
    path: '/kanban',
    async handler(req, res) {
      try {
        if (req.method === 'GET' && req.url?.startsWith('/kanban/board')) {
          const state = await provider.service.snapshot();
          json(res, 200, {
            chains: [...state.chains.values()],
            tasks: [...state.tasks.values()],
            specCards: [...state.specCards.values()],
            handoffs: [...state.handoffs.entries()].map(([k, v]) => ({ id: k, ...v })),
            auditWarnings: [...state.auditWarnings.entries()].map(([k, v]) => ({ chainId: k, ...v })),
            events: state.events,
            lastSeq: state.events.at(-1)?.seq ?? -1,
          });
          return;
        }
        if (req.method === 'GET' && req.url?.startsWith('/kanban/events')) {
          const heartbeatMs = (config?.ui.sseHeartbeatSeconds ?? 20) * 1000;
          await serveKanbanEvents(req, res, provider.service, { heartbeatMs });
          return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/kanban/action')) {
          const body = JSON.parse((await readBody(req)) || '{}') as {
            type?: string; taskId?: string; chainId?: string; title?: string; reason?: string; summary?: string; metadata?: Record<string, unknown>; body?: string;
          };
          // confirm-audit 是链级 action（无 taskId），提前分流处理
          if (body.type === 'confirm-audit') {
            const chainId = String(body.chainId ?? '').trim();
            if (!chainId) { json(res, 400, { error: 'chainId required' }); return; }
            await provider.service.confirmAudit(chainId, 'human');
            json(res, 200, { ok: true });
            return;
          }
          // 整链硬删除（仅 human；GUI 二次确认）：purge 无事件流，客户端需自行 resync。
          // E/F：删链后联动 dispatcher（游标同步钳回）+ V 编排 entry 清理，防运行中实例跳过后续新链事件。
          if (body.type === 'delete') {
            const chainId = String(body.chainId ?? '').trim();
            if (!chainId) { json(res, 400, { error: 'chainId required' }); return; }
            await provider.service.deleteChain(chainId, 'human');
            if (provider.onChainDeleted) await provider.onChainDeleted(chainId);
            json(res, 200, { ok: true });
            return;
          }
          // rename 是链级或任务级 action（chainId 或 taskId 二选一），在 taskId 守卫前分流
          if (body.type === 'rename') {
            const title = String(body.title ?? '').trim();
            if (!title) { json(res, 400, { error: 'title required' }); return; }
            if (body.chainId) await provider.service.updateChainTitle(String(body.chainId), title, 'human');
            else if (body.taskId) await provider.service.renameTask(String(body.taskId), title, 'human');
            else { json(res, 400, { error: 'chainId or taskId required' }); return; }
            json(res, 200, { ok: true });
            return;
          }
          const t = body.taskId;
          if (!t) { json(res, 400, { error: 'taskId required' }); return; }
          switch (body.type) {
            case 'block': {
              const reason = String(body.reason ?? '').trim();
              if (!reason) { json(res, 400, { error: 'reason required' }); return; }
              await provider.service.blockTask(t, reason, 'human');
              break;
            }
            case 'unblock': await provider.service.unblockTask(t, 'human'); break;
            case 'retry': {
              // retry 走 runner（failed→claim→spawn/resume），而非只 claim 造成 running 悬挂
              const state = await provider.service.snapshot();
              const task = state.tasks.get(t);
              if (!task) { json(res, 404, { error: 'unknown task: ' + t }); return; }
              if (task.status !== 'failed') { json(res, 409, { error: 'invalid state: task ' + t + ' is ' + task.status + ', only failed tasks can be retried' }); return; }
              if (!provider.runner) { json(res, 503, { error: 'dispatcher not ready' }); return; }
              void provider.runner.runTask(t).catch((err) => { console.error('[dsh-swarm] retry dispatch failed: ' + String(err)); });
              break;
            }
            case 'complete': {
              const summary = String(body.summary ?? '').trim();
              if (!summary) { json(res, 400, { error: 'summary required' }); return; }
              await provider.service.completeTask(t, { summary, metadata: body.metadata ?? {}, completedAt: Date.now() }, 'human');
              break;
            }
            case 'archive': await provider.service.archiveTask(t, 'human'); break;
            case 'comment': {
              const bodyText = String(body.body ?? '').trim();
              if (!bodyText) { json(res, 400, { error: 'body required' }); return; }
              await provider.service.comment(t, bodyText, 'human');
              break;
            }
            default: json(res, 400, { error: 'unknown action: ' + String(body.type) }); return;
          }
          json(res, 200, { ok: true });
          return;
        }
        // 配置读写：reset 是 POST，与 GET/PUT config 经 method 区分（reset 分支前置，防前缀遮蔽）
        if (req.method === 'POST' && req.url?.startsWith('/kanban/config/reset')) {
          json(res, 200, configProvider.reset());
          return;
        }
        if (req.method === 'GET' && req.url?.startsWith('/kanban/config')) {
          json(res, 200, configProvider.snapshot());
          return;
        }
        if (req.method === 'PUT' && req.url?.startsWith('/kanban/config')) {
          const raw = JSON.parse((await readBody(req)) || '{}') as Partial<EditableSnapshot>;
          // 归一化缺省字段，保证缺字段走 400 校验失败而非 500。
          // reviewEngine 缺省时回退当前 effective（再兜底默认）：旧客户端 bundle 不带该字段时保存不清空既有评审引擎配置。
          const fb = configProvider.getEffective().reviewEngine;
          const snapshot: EditableSnapshot = {
            wikiVault: { baseUrl: raw.wikiVault?.baseUrl ?? '', pagePrefix: raw.wikiVault?.pagePrefix ?? '' },
            roles: { models: raw.roles?.models ?? {} },
            reviewEngine: {
              mode: raw.reviewEngine?.mode ?? fb?.mode ?? 'delegate',
              managed: {
                provider: raw.reviewEngine?.managed?.provider ?? fb?.managed?.provider ?? '',
                model: raw.reviewEngine?.managed?.model ?? fb?.managed?.model ?? '',
              },
            },
          };
          const r = configProvider.applyOverride(snapshot);
          if (!r.ok) { json(res, 400, { error: 'validation failed', fields: r.errors }); return; }
          json(res, 200, { ok: true, effective: r.effective, sources: r.sources });
          return;
        }
        if (req.method === 'GET' && req.url?.startsWith('/kanban/llm-catalog')) {
          json(res, 200, await buildLlmCatalog(llm));
          return;
        }
        // ocr 运维面：cancel 前置于 install（POST 前缀匹配防遮蔽），install/state 与 install 以 method 区分
        if (req.method === 'POST' && req.url?.startsWith('/kanban/ocr/install/cancel')) {
          if (!installJob?.running) { json(res, 200, { ok: false, error: 'no-install-running' }); return; }
          installJob.child?.kill('SIGTERM');
          installJob.running = false;
          installJob.result = 'cancelled';
          logOcrEvent(configProvider, '[ocr-install] cancelled');
          json(res, 200, { ok: true });
          return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/kanban/ocr/install')) {
          if (installJob?.running) { json(res, 409, { error: 'install-in-progress' }); return; }
          installJob = { id: 'ocr-install-' + Date.now(), running: true, child: null, log: '' };
          logOcrEvent(configProvider, '[ocr-install] start');
          void runOcrInstall(ocrDeps, configProvider);
          json(res, 200, { ok: true, id: installJob.id });
          return;
        }
        if (req.method === 'GET' && req.url?.startsWith('/kanban/ocr/install/state')) {
          json(res, 200, installJob
            ? { running: installJob.running, result: installJob.result, version: installJob.version, log: installJob.log }
            : { running: false, log: '' });
          return;
        }
        if (req.method === 'GET' && req.url?.startsWith('/kanban/ocr/status')) {
          const probe = await (ocrDeps?.probeFn ?? probeOcr)();
          json(res, 200, {
            installed: probe.installed,
            version: probe.version,
            mode: configProvider.getEffective().reviewEngine.mode,
            managedReady: ocrDeps?.managedReadyFn ? ocrDeps.managedReadyFn() : managedProviderReady(),
          });
          return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/kanban/ocr/wire')) {
          const body = JSON.parse((await readBody(req)) || '{}') as { provider?: string; model?: string };
          const providerId = String(body.provider ?? '').trim();
          const model = String(body.model ?? '').trim();
          if (!providerId || !model) { json(res, 400, { error: 'provider and model required' }); return; }
          const probe = await (ocrDeps?.probeFn ?? probeOcr)();
          if (!probe.installed) { json(res, 200, { ok: false, log: INSTALL_GUIDANCE }); return; }
          const access = resolveDshProviderAccess(ctx, providerId);
          if (!access) { json(res, 200, { ok: false, log: OCR_WIRE_DEGRADED }); return; }
          const r = ocrDeps?.wirer
            ? await ocrDeps.wirer({ provider: providerId, model })
            : await wireManagedProvider({ baseUrl: access.baseUrl, protocol: access.protocol, apiKey: access.apiKey, model });
          logOcrEvent(configProvider, '[ocr-wire] ' + (r.ok ? 'ok' : 'fail'));
          json(res, 200, { ok: r.ok, log: r.log });
          return;
        }
        json(res, 404, { error: 'not found' });
      } catch (err) {
        json(res, 500, { error: String(err) });
      }
    },
  });
}
