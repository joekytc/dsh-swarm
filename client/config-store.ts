/** settings.section 插槽注册 id（T9）。 */
export const SWARM_CONFIG_NS = 'swarm-config';

/** 手写本地类型：与 src/domain/config-override.ts 的 EditableSnapshot 同形，客户端不 import 服务端。 */
export interface EditableModelSnapshot { provider: string; model: string; reasoningEffort: string; }
export interface EditableSnapshot {
  wikiVault: { baseUrl: string; pagePrefix: string };
  roles: { models: Partial<Record<string, EditableModelSnapshot>> };
  reviewEngine: { mode: 'delegate' | 'managed'; managed: { provider: string; model: string } };
}
export interface ConfigState {
  effective: EditableSnapshot;
  sources: Record<string, string>;
  catalog: { providers: Array<{ id: string; name: string }>; models: Record<string, Array<{ id: string; name: string; efforts: Array<{ id: string; name: string }> }>> };
  saving: boolean;
  error: string | null;
}

/** T9：配置外部 store（GET /kanban/config + /kanban/llm-catalog；PUT 保存；POST reset），fetch 注入便于测试。 */
export function createConfigStore(fetchImpl: typeof fetch) {
  let state: ConfigState = { effective: { wikiVault: { baseUrl: '', pagePrefix: '' }, roles: { models: {} }, reviewEngine: { mode: 'delegate', managed: { provider: '', model: '' } } }, sources: {}, catalog: { providers: [], models: {} }, saving: false, error: null };
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
  return { get, subscribe, load, save, reset };
}
