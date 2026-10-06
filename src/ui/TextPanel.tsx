import { Plus, Upload } from 'lucide-react';
import { snapToFrame } from '../core/time';
import { actions, playback, store } from '../app/editor';
import { Cmd } from '../engine/commands/commands';
import { createdIds } from '../engine/commands/patch';
import { TITLE_TEMPLATES } from '../engine/motion/titles';
import { availableFonts } from '../engine/fonts/fonts';
import { useEditor, useMediaVersion } from './hooks';

const SAMPLE: Record<string, string> = { title: 'Seu título aqui', lowerThird: 'Nome Sobrenome', callout: 'Destaque', cta: 'Inscreva-se' };

/** Texto: inserir textos/gráficos animados no playhead e ver as fontes disponíveis. */
export function TextPanel() {
  const { project } = useEditor();
  useMediaVersion();
  const fonts = availableFonts(project);

  const insert = (template: (typeof TITLE_TEMPLATES)[number]) => {
    const at = snapToFrame(playback.time, project.settings.fps);
    store.execute(
      { ...Cmd.addTitle({ template: template.id, text: SAMPLE[template.id], at, duration: template.duration }), label: `Inserir ${template.label}` },
      (patch) => createdIds(patch, 'clips'),
    );
  };

  return (
    <section className="panel">
      <div className="panel-head"><span className="panel-title">Texto</span></div>
      <div className="panel-body insp">
        <div>
          <h4>Inserir no playhead</h4>
          <div className="text-templates">
            {TITLE_TEMPLATES.map((t) => (
              <button key={t.id} className={`tpl tpl-${t.id}`} onClick={() => insert(t)} data-testid={`insert-${t.id}`}>
                <span className="tpl-preview">{SAMPLE[t.id]}</span>
                <span className="tpl-label"><Plus size={11} /> {t.label} · {t.duration}s</span>
              </button>
            ))}
          </div>
          <p className="note">Cada texto entra na trilha "Gráficos" e pode ser editado no Inspector (texto, fonte, cores, posição, keyframes).</p>
        </div>
        <div>
          <div className="row-between">
            <h4 style={{ margin: 0 }}>Fontes ({fonts.length})</h4>
            <button className="btn sm outline" onClick={() => void actions.importMedia()} title="Importar .ttf, .otf, .woff ou .woff2">
              <Upload size={12} /> Importar fonte
            </button>
          </div>
          <div className="font-list">
            {fonts.map((f) => (
              <div key={f.id} className="font-row" style={{ fontFamily: `"${f.family}"` }}>
                <span>{f.family}</span>
                <em>{f.source === 'imported' ? 'importada' : 'sistema'}</em>
              </div>
            ))}
          </div>
          <p className="note">Biblioteca de fontes da plataforma: Fase 3.</p>
        </div>
      </div>
    </section>
  );
}
