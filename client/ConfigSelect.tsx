import { useEffect, useRef, useState } from 'react';

export interface ConfigSelectOption { value: string; label: string }

/**
 * DSH 风格下拉：trigger 行（值 + › chevron）+ 弹出菜单（选中打勾、hover 高亮）。
 * 对齐 dsh settings 页 picker 交互：点击外部/Esc 关闭，选中即提交。
 */
export function ConfigSelect({ value, options, placeholder, onChange, onCommit }: {
  value: string;
  options: ConfigSelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  return (
    <div className="dsh-kb-config__select" ref={rootRef}>
      <button type="button" className="dsh-kb-config__select-trigger" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        <span className={current ? undefined : 'dsh-kb-config__select-placeholder'}>{current?.label ?? placeholder}</span>
        <span className="dsh-kb-config__select-chevron" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 16 16">
            <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <ul className="dsh-kb-config__menu" role="listbox">
          {options.map((o) => (
            <li key={o.value || '__empty__'}>
              <button type="button" role="option" aria-selected={o.value === value}
                className="dsh-kb-config__option" data-selected={o.value === value || undefined}
                onClick={() => { onChange(o.value); setOpen(false); onCommit?.(); }}>
                <span>{o.label}</span>
                {o.value === value && (
                  <span className="dsh-kb-config__option-check" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16">
                      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.5"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
