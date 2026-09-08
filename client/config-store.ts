/** settings.section 插槽注册 id（T9）。 */
export const SWARM_CONFIG_NS = 'swarm-config';

/** 手写本地类型：与 src/domain/config-override.ts 的 EditableSnapshot 同形，客户端不 import 服务端。 */
export interface EditableModelSnapshot { provider: string; model: string; reasoningEffort: string; }
export interface EditableSnapshot {
  wikiVault: { baseUrl: string; pagePrefix: string };
  roles: { models: Partial<Record<string, EditableModelSnapshot>> };
  reviewEngine: { mode: 'delegate' | 'managed'; managed: { provider: string; model: string } };
}
/** GET /kanban/ocr/status 响应镜像；null = 尚未拉到/拉取失败（状态未知）。 */
export interface OcrStatus { installed: boolean; version: string; mode: string; kbMode: 'remote' | 'local'; managedReady: boolean; }
export type InstallPhase = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
export interface ConfigState {
  effective: EditableSnapshot;
  sources: Record<string, string>;
  catalog: { providers: Array<{ id: string; name: string }>; models: Record<string, Array<{ id: string; name: string; efforts: Array<{ id: string; name: string }> }>> };
  ocrStatus: OcrStatus | null;
  install: { phase: InstallPhase; log: string };
  saving: boolean;
  error: string | null;
}

/** 配置外部 store（GET /kanban/config + /kanban/llm-catalog + ocr 运维面；PUT 保存；POST reset），fetch 注入便于测试。 */
export function createConfigStore(fetchImpl: typeof fetch) {
  let state: ConfigState = { effective: { wikiVault: { baseUrl: '', pagePrefix: '' }, roles: { models: {} }, reviewEngine: { mode: 'delegate', managed: { provider: '', model: '' } } }, sources: {}, catalog: { providers: [], models: {} }, ocrStatus: null, install: { phase: 'idle', log: '' }, saving: false, error: null };
  const listeners = new Set<() => void>();
  const setState = (patch: Partial<ConfigState>) => { state = { ...state, ...patch }; for (const l of [...listeners]) l(); };
  const get = () => state;
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const load = async () => {
    const [cfg, cat] = await Promise.all([
      fetchImpl('/kanban/config').then((r) => r.json()),
      fetchImpl('/kanban/llm-catalog').then((r) => r.json()),
    ]);
    setState({ effective: cfg.effective, sources: cfg.sources, catalog: cat });
  };
  const save = async (snap: EditableSnapshot) => {
    setState({ saving: true, error: null });
    try {
      const r = await fetchImpl('/kanban/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snap),
      });
      const d = await r.json();
      if (!r.ok) { setState({ error: (d.fields ?? []).join(', ') || 'save failed' }); return false; }
      setState({ effective: d.effective, sources: d.sources });
      return true;
    } catch (e) { setState({ error: String(e) }); return false; }
    finally { setState({ saving: false }); }
  };
  const reset = async () => {
    const r = await fetchImpl('/kanban/config/reset', { method: 'POST' }).then((x) => x.json());
    setState({ effective: r.effective, sources: r.sources });
    return r;
  };
  // ocr 运维面：状态探测 + 安装单飞（轮询由组件驱动，store 不持定时器）+ 托管接入写入
  const loadOcrStatus = async () => {
    try {
      const r = await fetchImpl('/kanban/ocr/status');
      if (!r.ok) { setState({ ocrStatus: null }); return; }
      setState({ ocrStatus: await r.json() });
    } catch { setState({ ocrStatus: null }); }
  };
  const startInstall = async () => {
    setState({ install: { phase: 'running', log: '' } });
    try {
      const r = await fetchImpl('/kanban/ocr/install', { method: 'POST' });
      // 409 = 已有安装进行中：同样转轮询跟踪该任务；其余失败态才回落 failed
      if (!r.ok && r.status !== 409) setState({ install: { phase: 'failed', log: 'POST /kanban/ocr/install → ' + r.status } });
    } catch (e) { setState({ install: { phase: 'failed', log: String(e) } }); }
  };
  const cancelInstall = async () =>
    fetchImpl('/kanban/ocr/install/cancel', { method: 'POST' }).then((x) => x.json());
  const loadInstallState = async () => {
    try {
      const r = await fetchImpl('/kanban/ocr/install/state').then((x) => x.json());
      const phase: InstallPhase = r.running ? 'running'
        : r.result === 'ok' ? 'done'
        : r.result === 'failed' ? 'failed'
        : r.result === 'cancelled' ? 'cancelled'
        : 'idle';
      setState({ install: { phase, log: String(r.log ?? '') } });
      if (phase === 'done') await loadOcrStatus(); // 安装成功 → 刷新状态解禁整卡并取版本号
    } catch { /* 轮询失败静默，下一轮重试 */ }
  };
  const wireOcr = async (provider: string, model: string): Promise<{ ok: boolean; log: string }> => {
    try {
      const r = await fetchImpl('/kanban/ocr/wire', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model }),
      });
      const d = await r.json().catch(() => ({}));
      return { ok: Boolean(d.ok), log: String(d.log ?? '') };
    } catch (e) { return { ok: false, log: String(e) }; }
  };
  return { get, subscribe, load, save, reset, loadOcrStatus, startInstall, cancelInstall, loadInstallState, wireOcr };
}
