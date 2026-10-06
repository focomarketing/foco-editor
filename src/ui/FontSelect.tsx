import { availableFonts, fontStack, primaryFamily } from '../engine/fonts/fonts';
import { useEditor, useMediaVersion } from './hooks';

/** Seletor de fonte: importadas pelo usuário primeiro, depois as do sistema. */
export function FontSelect({ value, onChange }: { value: string; onChange: (cssFamily: string) => void }) {
  const { project } = useEditor();
  useMediaVersion();
  const fonts = availableFonts(project);
  const current = primaryFamily(value);
  return (
    <div className="field wide">
      <label>Fonte</label>
      <select value={current} onChange={(e) => onChange(fontStack(e.target.value))} style={{ fontFamily: value }}>
        {!fonts.some((f) => f.family === current) && <option value={current}>{current}</option>}
        {fonts.map((f) => (
          <option key={f.id} value={f.family} style={{ fontFamily: `"${f.family}"` }}>
            {f.family}{f.source === 'imported' ? ' (importada)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
