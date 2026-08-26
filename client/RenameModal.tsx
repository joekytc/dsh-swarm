import { useState } from 'react';

/** T7：轻量改名弹窗（链标题/任务卡标题共用；GUI 仅 human）。内联实现，无额外依赖。 */
export function RenameModal(props: { title: string; initialValue: string; onSave(title: string): void; onCancel(): void }) {
  const [value, setValue] = useState(props.initialValue);
  const save = () => {
    const next = value.trim();
    if (next) props.onSave(next);
  };
  return (
    <div className="dsh-kb-rename-overlay" onClick={props.onCancel}>
      <div
        className="dsh-kb-rename-modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dsh-kb-rename-modal__label">{props.title}</div>
        <input
          className="dsh-kb-rename-modal__input"
          aria-label={props.title}
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') props.onCancel();
          }}
        />
        <div className="dsh-kb-rename-modal__actions">
          <button type="button" className="dsh-kb-rename-cancel" onClick={props.onCancel}>取消</button>
          <button type="button" className="dsh-kb-rename-save" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
