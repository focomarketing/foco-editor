import { actions } from '../app/editor';
import { LOOKS, lookId } from '../engine/color/lut';
import { useEditor, useMediaVersion } from './hooks';

/** Escolhe a LUT: nenhuma, um look pronto ou uma LUT .cube importada no projeto. */
export function LutSelect({ value, onChange, allowNone = true }: { value: string | undefined; onChange: (id: string | undefined) => void; allowNone?: boolean }) {
  const { project } = useEditor();
  useMediaVersion();
  const imported = Object.values(project.assets).filter((a) => a.kind === 'lut');
  const missing = value && !value.startsWith('look:') && !project.assets[value];
  return (
    <div className="field wide">
      <label>Look / LUT</label>
      <select
        value={value ?? ''}
        onChange={(e) => {
          if (e.target.value === '__import') return void actions.importMedia();
          onChange(e.target.value || undefined);
        }}
        data-testid="lut-select"
      >
        {allowNone && <option value="">Nenhum</option>}
        {missing && <option value={value}>LUT ausente do projeto</option>}
        <optgroup label="Looks prontos">
          {LOOKS.map((l) => <option key={l.id} value={lookId(l.id)}>{l.label}</option>)}
        </optgroup>
        {imported.length > 0 && (
          <optgroup label="LUTs importadas (.cube)">
            {imported.map((a) => <option key={a.id} value={a.id}>{a.name.replace(/\.cube$/i, '')}</option>)}
          </optgroup>
        )}
        <option value="__import">Importar .cube…</option>
      </select>
    </div>
  );
}
