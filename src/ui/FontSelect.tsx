import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { fontStack, primaryFamily } from '../engine/fonts/fonts';
import { FontBrowser } from './FontBrowser';

/** Seletor de fonte: botão com a fonte atual e, ao abrir, o navegador de fontes (biblioteca + Google Fonts). */
export function FontSelect({ value, onChange }: { value: string; onChange: (cssFamily: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false));
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  return (
    <div className="field wide">
      <label>Fonte</label>
      <div className="font-select" ref={ref}>
        <button className="font-current" style={{ fontFamily: value }} onClick={() => setOpen((o) => !o)} data-testid="font-select">
          <span>{primaryFamily(value)}</span>
          <ChevronDown size={12} />
        </button>
        {open && (
          <div className="font-pop">
            <FontBrowser
              autoFocus
              value={value}
              onPick={(family) => {
                onChange(fontStack(family));
                setOpen(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
