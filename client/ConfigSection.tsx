import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createConfigStore, type EditableSnapshot, type ModelFallback, type OcrStatus } from './config-store.js';
import { ConfigSelect, type ConfigSelectOption } from './ConfigSelect.js';

const ROLES = ['v', 'p', 'w', 'd', 'pt', 'dt'] as const;
type Model = { provider: string; model: string; reasoningEffort: string };
/** 单角色降级候选上限（与服务端 schema/派发链合成同口径）。 */
const MAX_FALLBACKS = 2;
/** 角色名（对齐 personas 各 kanban preset 目录 preset.yml 的 name 字段）。 */
const ROLE_NAMES: Record<(typeof ROLES)[number], string> = {
  v: '看板编排官（V）', p: '规划官（P）', w: '知识官（W）', d: '全栈开发官（D）', pt: '计划审查官（PT）', dt: '交付评审官（DT）',
};

/** ocr 卡横幅文案：null=已安装无横幅；安装中不显示横幅（spinner 行替代）。 */
function ocrBanner(ocr: OcrStatus | null, installing: boolean): string | null {
  if (installing) return null;
  if (ocr === null) return 'ocr 状态未知——委托/托管评审可能不可用';
  if (!ocr.installed) return 'ocr 未安装——委托/托管评审均不可用';
  return null;
}

/** settings.section 配置面板——本地 draft 编辑态、下拉选中即存、级联下拉、来源徽章。
 *  第二卡「模型链」：每角色主模型级联下拉 + 「+ 降级」追加降级行（provider→model→effort 级联 + 删除，
 *  顺序=优先序、上限 2）+「复制本链到全部角色」快捷；官方兜底为全局只读尾行（恒垫链尾，编辑入口在部署配置）。
 *  第三卡「评审引擎（ocr）」：安装单飞（组件持轮询定时器 1.5s）、模式切换、托管提供方/模型级联、应用到 ocr。
 *  无「重置」：各用户模型配置不同，无有意义的公共默认值可回退（历史教训：重置按钮已移除，勿再加回）。 */
export function ConfigSection({ fetchImpl, close }: { fetchImpl?: typeof fetch; close: () => void }) {
  const storeRef = useRef<ReturnType<typeof createConfigStore> | null>(null);
  if (!storeRef.current) storeRef.current = createConfigStore(fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args)));
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const [draft, setDraft] = useState<EditableSnapshot | null>(null);
  const [wireResult, setWireResult] = useState<{ ok: boolean; log: string } | null>(null);
  // 手风琴展开态：undefined=用户未点过（默认展开第一个已配置角色）；null=用户全部收起；字符串=用户点开的角色。
  const [openRole, setOpenRole] = useState<string | null | undefined>(undefined);

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
  const roleEntry = (r: string) => draft.roles.models[r] ?? { provider: '', model: '', reasoningEffort: '', fallbacks: [] as ModelFallback[] };
  const setModel = (r: string, patch: Partial<Model> & { fallbacks?: ModelFallback[] }) => {
    commit({ ...draft, roles: { models: { ...draft.roles.models, [r]: { ...roleEntry(r), ...patch } } } });
  };
  const setFallback = (r: string, idx: number, patch: Partial<Model>) => {
    const fbs = [...roleEntry(r).fallbacks];
    const cur = fbs[idx] ?? { provider: '', model: '', reasoningEffort: '' };
    fbs[idx] = { ...cur, ...patch };
    setModel(r, { fallbacks: fbs });
  };
  const addFallback = (r: string) => {
    const fbs = roleEntry(r).fallbacks;
    if (fbs.length >= MAX_FALLBACKS) return;
    setModel(r, { fallbacks: [...fbs, { provider: '', model: '', reasoningEffort: '' }] });
  };
  const removeFallback = (r: string, idx: number) => {
    setModel(r, { fallbacks: roleEntry(r).fallbacks.filter((_, i) => i !== idx) });
  };
  /** 主模型+降级链整体深拷贝到其余角色（顺序=优先序原样保留）。 */
  const copyChainToAll = (r: string) => {
    const src = roleEntry(r);
    if (!(src.provider && src.model)) return;
    const models = { ...draft.roles.models };
    for (const o of ROLES) {
      if (o === r) continue;
      models[o] = { provider: src.provider, model: src.model, reasoningEffort: src.reasoningEffort, fallbacks: src.fallbacks.map((f) => ({ ...f })) };
    }
    commit({ ...draft, roles: { models } });
  };
  const commitReviewEngine = (mode: 'delegate' | 'managed', managed: { provider: string; model: string }) => {
    commit({ ...draft, reviewEngine: { mode, managed } });
  };
  const onBlur = () => { void store.save(draft); };
  /** 链字段：label 在上 + 全宽下拉（宿主 provider 卡排版）。 */
  const chainField = (label: string, value: string, placeholder: string, options: ConfigSelectOption[], onPick: (v: string) => void) => (
    <label className="dsh-kb-config__field">
      <span className="dsh-kb-config__field-label">{label}</span>
      <ConfigSelect value={value} placeholder={placeholder} options={options} onChange={onPick} />
    </label>
  );
  /** 折叠态链摘要：provider/model · N 降级；未配置明示。 */
  const chainSummary = (m: { provider: string; model: string; fallbacks?: ModelFallback[] }) => {
    if (!(m.provider && m.model)) return '未配置';
    const n = (m.fallbacks ?? []).filter((f) => f.provider && f.model).length;
    return `${m.provider} / ${m.model}` + (n ? ` · ${n} 降级` : '');
  };
  const providerOptions = state.catalog.providers.map((p) => ({ value: p.id, label: p.name }));
  // 手风琴：同一时刻至多一个角色展开；用户未点过时默认展开第一个已配置角色。
  const expandedRole = openRole === undefined ? ROLES.find((x) => {
    const e = draft.roles.models[x];
    return Boolean(e?.provider && e?.model);
  }) ?? null : openRole;

  const ocr = state.ocrStatus;
  const banner = ocrBanner(ocr, installing);
  // ocr 不可用（未安装/未知/安装中）时，卡内其余字段整体置灰
  const ocrBlocked = installing || ocr === null || !ocr.installed;
  const re = draft.reviewEngine;
  const managedFieldsEnabled = !ocrBlocked && re.mode === 'managed';
  // 版本倾斜防御：旧服务端 bundle 快照缺 chainFallback/fallbacks 字段时按空值处理，不崩面板。
  const cf = draft.chainFallback ?? { provider: '', model: '', reasoningEffort: 'high' };

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
          const m = roleEntry(r);
          const fbs = m.fallbacks ?? [];
          const configured = Boolean(m.provider && m.model);
          const open = expandedRole === r;
          const providerModels = state.catalog.models[m.provider] ?? [];
          const efforts = providerModels.find((x) => x.id === m.model)?.efforts ?? [];
          return (
            <div key={r} className="dsh-kb-config__role-block">
              <button type="button" className="dsh-kb-config__role-head" aria-expanded={open}
                onClick={() => setOpenRole(open ? null : r)}>
                <span className={'dsh-kb-config__chevron' + (open ? ' dsh-kb-config__chevron--open' : '')} aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 16 16">
                    <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <strong>{ROLE_NAMES[r]}</strong>
                {!open && <span className="dsh-kb-config__role-summary">{chainSummary(m)}</span>}
              </button>
              {open && (
                <div className="dsh-kb-config__role-body">
                  <span className="dsh-kb-config__group-label">主模型</span>
                  {chainField('供应商', m.provider, '选择 provider', providerOptions,
                    (v) => { if (v !== m.provider) setModel(r, { provider: v, model: '', reasoningEffort: '' }); })}
                  {chainField('模型', m.model, '选择模型', providerModels.map((x) => ({ value: x.id, label: x.name })),
                    (v) => { if (v !== m.model) setModel(r, { model: v, reasoningEffort: '' }); })}
                  {chainField('思考等级', m.reasoningEffort, '跟随默认', efforts.map((x) => ({ value: x.id, label: x.name })),
                    (v) => { if (v !== m.reasoningEffort) setModel(r, { reasoningEffort: v }); })}
                  <span className="dsh-kb-config__group-label">降级（最多 2 个，顺序 = 切换优先序）</span>
                  {fbs.map((f, i) => {
                    const fProviderModels = state.catalog.models[f.provider] ?? [];
                    const fEfforts = fProviderModels.find((x) => x.id === f.model)?.efforts ?? [];
                    return (
                      <div key={i} className="dsh-kb-config__fb-group">
                        <div className="dsh-kb-config__fb-head">
                          <span className="dsh-kb-config__fb-title">降级 {i + 1}</span>
                          <button type="button" className="dsh-kb-config__row-btn" title="删除该降级候选"
                            onClick={() => removeFallback(r, i)}>删除</button>
                        </div>
                        {chainField('供应商', f.provider, '选择 provider', providerOptions,
                          (v) => { if (v !== f.provider) setFallback(r, i, { provider: v, model: '', reasoningEffort: '' }); })}
                        {chainField('模型', f.model, '选择模型', fProviderModels.map((x) => ({ value: x.id, label: x.name })),
                          (v) => { if (v !== f.model) setFallback(r, i, { model: v, reasoningEffort: '' }); })}
                        {chainField('思考等级', f.reasoningEffort, '跟随默认', fEfforts.map((x) => ({ value: x.id, label: x.name })),
                          (v) => { if (v !== f.reasoningEffort) setFallback(r, i, { reasoningEffort: v }); })}
                      </div>
                    );
                  })}
                  <div className="dsh-kb-config__role-actions">
                    {fbs.length < MAX_FALLBACKS && (
                      <button type="button" className="dsh-kb-config__row-btn" disabled={!configured}
                        title={configured ? '追加一个降级候选' : '先选好主模型（provider+模型）再追加降级'}
                        onClick={() => addFallback(r)}>+ 降级</button>
                    )}
                    <button type="button" className="dsh-kb-config__row-btn" disabled={!configured}
                      title="把该角色的主模型+降级链整体复制到其余角色"
                      onClick={() => copyChainToAll(r)}>复制本链到全部角色</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div className="dsh-kb-config__role dsh-kb-config__role--official">
          <span className="dsh-kb-config__badge">官方兜底</span>
          {cf.provider && cf.model
            ? <span>{cf.provider} / {cf.model}（reasoningEffort={cf.reasoningEffort}）</span>
            : <span className="dsh-kb-config__muted">未配置——角色链全空时走宿主默认模型</span>}
        </div>
        <span className="dsh-kb-config__help">
          派发顺序：主模型 → 降级（顺序=优先序，最多 2 个）→ 官方兜底（恒垫链尾）→ 宿主默认模型；候选不可用（含官方账号未登录）静默切换并留 [model-fallback] 评论
        </span>
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
        {ocr?.kbMode === 'local' && (
          <span className="dsh-kb-config__help">本地知识库模式下独立评审报告暂不落 wiki，请直接留存对话</span>
        )}
      </section>
      {state.error && <div className="dsh-kb-config__error">{state.error}</div>}
    </div>
  );
}
