import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createConfigStore, type EditableSnapshot, type OcrStatus } from './config-store.js';
import { ConfigSelect } from './ConfigSelect.js';

const ROLES = ['v', 'p', 'w', 'd', 'pt', 'dt'] as const;
type Model = { provider: string; model: string; reasoningEffort: string };

/** ocr 卡横幅文案：null=已安装无横幅；安装中不显示横幅（spinner 行替代）。 */
function ocrBanner(ocr: OcrStatus | null, installing: boolean): string | null {
  if (installing) return null;
  if (ocr === null) return 'ocr 状态未知——委托/托管评审可能不可用';
  if (!ocr.installed) return 'ocr 未安装——委托/托管评审均不可用';
  return null;
}

/** T9：settings.section 配置面板——本地 draft 编辑态、下拉选中即存、级联下拉、来源徽章、右下角重置。
 *  第三卡「评审引擎（ocr）」：安装单飞（组件持轮询定时器 1.5s）、模式切换、托管提供方/模型级联、应用到 ocr。 */
export function ConfigSection({ fetchImpl, close }: { fetchImpl?: typeof fetch; close: () => void }) {
  const storeRef = useRef<ReturnType<typeof createConfigStore> | null>(null);
  if (!storeRef.current) storeRef.current = createConfigStore(fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args)));
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const [draft, setDraft] = useState<EditableSnapshot | null>(null);
  const [wireResult, setWireResult] = useState<{ ok: boolean; log: string } | null>(null);

  useEffect(() => {
    void store.load().then(() => setDraft(store.get().effective));
    void store.loadOcrStatus(); // 与 load 并行；失败静默置 null = 未知态
  }, [store]);

  const installing = state.install.phase === 'running';
  // 安装轮询由组件持有：进入 running 立即查一次，此后 1.5s 间隔；终态/卸载由 effect 清理定时器
  useEffect(() => {
    if (!installing) return;
    const tick = () => { void store.loadInstallState(); };
    tick();
    const timer = setInterval(tick, 1500);
    return () => clearInterval(timer);
  }, [store, installing]);

  if (!draft) return <div className="dsh-kb-config">加载中…</div>;

  const commit = (next: EditableSnapshot) => { setDraft(next); void store.save(next); };
  const setModel = (r: string, patch: Partial<Model>) => {
    const prev = draft.roles.models[r] ?? { provider: '', model: '', reasoningEffort: '' };
    commit({ ...draft, roles: { models: { ...draft.roles.models, [r]: { ...prev, ...patch } } } });
  };
  const commitReviewEngine = (mode: 'delegate' | 'managed', managed: { provider: string; model: string }) => {
    commit({ ...draft, reviewEngine: { mode, managed } });
  };
  const onBlur = () => { void store.save(draft); };

  const ocr = state.ocrStatus;
  const banner = ocrBanner(ocr, installing);
  // ocr 不可用（未安装/未知/安装中）时，卡内其余字段整体置灰
  const ocrBlocked = installing || ocr === null || !ocr.installed;
  const re = draft.reviewEngine;
  const managedFieldsEnabled = !ocrBlocked && re.mode === 'managed';

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
      <section className="dsh-kb-config__card">
        <h3>评审引擎（ocr）</h3>
        {installing && (
          <div className="dsh-kb-config__installing">
            <span className="dsh-kb-config__installing-spinner" aria-hidden="true" />
            <span>正在安装 ocr…（npm 全局安装，约 1-2 分钟）</span>
            <button type="button" onClick={() => { void store.cancelInstall(); }}>取消</button>
          </div>
        )}
        {banner && <div className="dsh-kb-config__error" role="alert">{banner}</div>}
        {state.install.phase === 'failed' && (
          <div className="dsh-kb-config__error">安装失败：{state.install.log.slice(0, 200) || 'npm 全局安装未成功，可重试'}</div>
        )}
        {state.install.phase === 'cancelled' && (
          <div className="dsh-kb-config__error">安装已取消，可重新发起</div>
        )}
        {ocr?.installed && <div className="dsh-kb-config__ocr-ok">✓ ocr {ocr.version} 已安装</div>}
        {!installing && (!ocr || !ocr.installed) && (
          <button type="button" onClick={() => { void store.startInstall(); }}>安装 ocr</button>
        )}
        <label className="dsh-kb-config__label">评审模式</label>
        <ConfigSelect value={re.mode} disabled={ocrBlocked} placeholder="选择评审模式"
          options={[
            { value: 'delegate', label: '委托（DT 自己的模型评审，零 key）' },
            { value: 'managed', label: '托管（ocr 用下选模型评审）' },
          ]}
          onChange={(v) => { if (v !== re.mode) commitReviewEngine(v as 'delegate' | 'managed', re.managed); }} />
        <span className="dsh-kb-config__src">{state.sources['reviewEngine.mode'] === 'override' ? '已覆盖' : '继承'}</span>
        <label className="dsh-kb-config__label">提供方</label>
        <ConfigSelect value={re.managed.provider} disabled={!managedFieldsEnabled} placeholder="选择提供方"
          options={state.catalog.providers.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(v) => { if (v !== re.managed.provider) commitReviewEngine(re.mode, { provider: v, model: '' }); }} />
        <label className="dsh-kb-config__label">模型</label>
        <ConfigSelect value={re.managed.model} disabled={!managedFieldsEnabled} placeholder="选择模型"
          options={(state.catalog.models[re.managed.provider] ?? []).map((x) => ({ value: x.id, label: x.name }))}
          onChange={(v) => { if (v !== re.managed.model) commitReviewEngine(re.mode, { ...re.managed, model: v }); }} />
        {ocr?.managedReady === false && re.mode === 'managed' && (
          <div className="dsh-kb-config__ocr-warn">托管未就绪：选好提供方与模型后点『应用到 ocr』写入 ocr 配置；也可在终端手动 ocr config provider（委托模式不受影响）</div>
        )}
        {re.mode === 'managed' && re.managed.provider && re.managed.model && (
          <button type="button" disabled={ocrBlocked}
            onClick={() => { void store.wireOcr(re.managed.provider, re.managed.model).then(setWireResult); }}>
            应用到 ocr
          </button>
        )}
        {wireResult && (
          <div className={wireResult.ok ? 'dsh-kb-config__ocr-ok' : 'dsh-kb-config__error'}>
            {wireResult.ok ? '✓ 已写入 ocr（dsh-managed）' : '写入失败：' + wireResult.log.slice(0, 200)}
          </div>
        )}
        <span className="dsh-kb-config__help">托管评审由 ocr 调用上方选定的提供方/模型执行；接入点由系统自动写入 ocr 自定义配置（dsh-managed），API key 从 dsh 模型配置解析，不在面板明文展示</span>
        <span className="dsh-kb-config__help">
          官方文档：<a href="https://open-codereview.ai/docs/installation" target="_blank" rel="noreferrer">安装指南</a>
          {' · '}
          <a href="https://open-codereview.ai/docs/configuration" target="_blank" rel="noreferrer">模型配置</a>
          {' · '}
          <a href="https://open-codereview.ai/docs/delegate" target="_blank" rel="noreferrer">委托模式说明</a>
        </span>
      </section>
      <div className="dsh-kb-config__footer">
        <button onClick={() => { void store.reset().then((r) => setDraft(r.effective)); }}>重置</button>
      </div>
      {state.error && <div className="dsh-kb-config__error">{state.error}</div>}
    </div>
  );
}
