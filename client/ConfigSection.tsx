import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createConfigStore, type EditableSnapshot } from './config-store.js';
import { ConfigSelect } from './ConfigSelect.js';

const ROLES = ['v', 'p', 'w', 'd', 'pt', 'dt'] as const;
type Model = { provider: string; model: string; reasoningEffort: string };

/** T9：settings.section 配置面板——本地 draft 编辑态、下拉选中即存、级联下拉、来源徽章、右下角重置。 */
export function ConfigSection({ fetchImpl, close }: { fetchImpl?: typeof fetch; close: () => void }) {
  const storeRef = useRef<ReturnType<typeof createConfigStore> | null>(null);
  if (!storeRef.current) storeRef.current = createConfigStore(fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args)));
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const [draft, setDraft] = useState<EditableSnapshot | null>(null);

  useEffect(() => {
    void store.load().then(() => setDraft(store.get().effective));
  }, [store]);

  if (!draft) return <div className="dsh-kb-config">加载中…</div>;

  const commit = (next: EditableSnapshot) => { setDraft(next); void store.save(next); };
  const setModel = (r: string, patch: Partial<Model>) => {
    const prev = draft.roles.models[r] ?? { provider: '', model: '', reasoningEffort: '' };
    commit({ ...draft, roles: { models: { ...draft.roles.models, [r]: { ...prev, ...patch } } } });
  };
  const onBlur = () => { void store.save(draft); };

  return (
    <div className="dsh-kb-config">
      <section className="dsh-kb-config__card">
        <h3>知识库</h3>
        <label className="dsh-kb-config__label">baseUrl</label>
        <input value={draft.wikiVault.baseUrl} onBlur={onBlur}
          onChange={(e) => setDraft({ ...draft, wikiVault: { ...draft.wikiVault, baseUrl: e.target.value } })} />
        <span className="dsh-kb-config__help">llm-wiki 知识库外链 HTTP 地址（如 http://192.168.122.111:3000）；留空则使用本地 llm-wiki 兜底</span>
        <label className="dsh-kb-config__label">pagePrefix</label>
        <input value={draft.wikiVault.pagePrefix} onBlur={onBlur}
          onChange={(e) => setDraft({ ...draft, wikiVault: { ...draft.wikiVault, pagePrefix: e.target.value } })} />
        <span className="dsh-kb-config__help">llm-wiki 页面路径前缀（如 projects/）</span>
      </section>
      <section className="dsh-kb-config__card">
        <h3>模型链</h3>
        {ROLES.map((r) => {
          const m = draft.roles.models[r] ?? { provider: '', model: '', reasoningEffort: '' };
          const providerModels = state.catalog.models[m.provider] ?? [];
          const efforts = providerModels.find((x) => x.id === m.model)?.efforts ?? [];
          return (
            <div key={r} className="dsh-kb-config__role">
              <strong>{r}</strong>
              <ConfigSelect value={m.provider} placeholder="选择 provider"
                options={state.catalog.providers.map((p) => ({ value: p.id, label: p.name }))}
                onChange={(v) => { if (v !== m.provider) setModel(r, { provider: v, model: '', reasoningEffort: '' }); }} />
              <ConfigSelect value={m.model} placeholder="选择模型"
                options={providerModels.map((x) => ({ value: x.id, label: x.name }))}
                onChange={(v) => { if (v !== m.model) setModel(r, { model: v, reasoningEffort: '' }); }} />
              <ConfigSelect value={m.reasoningEffort} placeholder="跟随默认"
                options={efforts.map((x) => ({ value: x.id, label: x.name }))}
                onChange={(v) => { if (v !== m.reasoningEffort) setModel(r, { reasoningEffort: v }); }} />
              <span className="dsh-kb-config__src">{state.sources[`roles.models.${r}.model`] === 'override' ? '已覆盖' : '继承'}</span>
            </div>
          );
        })}
      </section>
      <div className="dsh-kb-config__footer">
        <button onClick={() => { void store.reset().then((r) => setDraft(r.effective)); }}>重置</button>
      </div>
      {state.error && <div className="dsh-kb-config__error">{state.error}</div>}
    </div>
  );
}
