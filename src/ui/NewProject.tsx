// Novo projeto: escolher a trilha (skill), o tipo de vídeo, o nome e o formato.
// Ao criar, pede os vídeos e abre o projeto na primeira fase da trilha.

import { useState } from 'react';
import { ArrowLeft, Film, Hand, Smartphone, UserRound } from 'lucide-react';
import { TRACKS, trackDef } from '../core/workflow';
import type { TrackId } from '../core/workflow';
import type { AspectRatio } from '../engine/ai/commands';
import { createGuidedProject, goHome } from '../app/workflow';
import { viewStore } from '../app/view';
import { MODE_LABEL, presetById } from '../video-editor/presets';
import type { EditMode } from '../video-editor/presets';

const ICON: Record<TrackId, typeof Film> = { youtube: Film, short: Smartphone, avatar: UserRound, manual: Hand };
const ASPECTS: { id: AspectRatio; label: string }[] = [
  { id: '16:9', label: '16:9 horizontal' },
  { id: '9:16', label: '9:16 vertical' },
  { id: '4:5', label: '4:5 feed' },
  { id: '1:1', label: '1:1 quadrado' },
];

export function NewProject() {
  const [track, setTrack] = useState<TrackId | null>(null);
  const [subtype, setSubtype] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [aspect, setAspect] = useState<AspectRatio | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<EditMode | null>(null);
  const [script, setScript] = useState('');
  const t = track ? trackDef(track) : null;
  const preset = t ? presetById(t.template) : null;
  const effMode: EditMode | null = preset ? (mode && preset.modes.includes(mode) ? mode : preset.defaultMode) : null;
  const needsSubtype = !!t && t.subtypes.length > 0;
  const canCreate = !!t && (!needsSubtype || !!subtype) && !busy && (effMode !== 'script-led' || script.trim().length > 20);

  const create = async () => {
    if (!t) return;
    setBusy(true);
    try {
      await createGuidedProject({ name: name || (t.subtypes.find((s) => s.id === subtype)?.label ?? t.label), track: t.id, subtype, aspect: aspect ?? t.aspect, mode: effMode ?? undefined, script: effMode === 'script-led' ? script.trim() : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home" data-testid="new-project">
      <div className="home-head">
        <div>
          <button className="btn sm" onClick={() => (track ? setTrack(null) : void goHome())}><ArrowLeft size={13} /> {track ? 'Trocar trilha' : 'Projetos'}</button>
          <h1>Novo projeto</h1>
          <p className="muted">{t ? t.hint : 'Escolha o tipo de edição. Cada um já vem com o ritmo, o formato e as fases certas.'}</p>
        </div>
      </div>

      {!t && (
        <div className="track-grid">
          {TRACKS.map((tr) => {
            const Icon = ICON[tr.id];
            return (
              <button
                key={tr.id}
                className="track-card"
                disabled={!tr.available}
                onClick={() => {
                  setTrack(tr.id);
                  setSubtype(null);
                  setAspect(null);
                  setMode(null);
                }}
                data-testid={`track-${tr.id}`}
              >
                <Icon size={22} />
                <b>{tr.label}</b>
                <span>{tr.hint}</span>
                {!tr.available && <em>em breve</em>}
              </button>
            );
          })}
        </div>
      )}

      {t && (
        <div className="new-form">
          {needsSubtype && (
            <>
              <label className="f">Tipo de vídeo</label>
              <div className="sub-grid">
                {t.subtypes.map((s) => (
                  <button key={s.id} className={`sub-card${subtype === s.id ? ' on' : ''}`} onClick={() => setSubtype(s.id)} data-testid={`sub-${s.id}`}>
                    <b>{s.label}</b>
                    <span>{s.hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {preset && preset.modes.length > 1 && (
            <>
              <label className="f">Como montar</label>
              <div className="sub-grid">
                {preset.modes.map((m) => (
                  <button key={m} className={`sub-card${effMode === m ? ' on' : ''}`} onClick={() => setMode(m)} data-testid={`mode-${m}`}>
                    <b>{MODE_LABEL[m].label}</b>
                    <span>{MODE_LABEL[m].hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {effMode === 'script-led' && (
            <>
              <label className="f">Roteiro ou narração</label>
              <textarea className="text-input area" rows={7} value={script} onChange={(e) => setScript(e.target.value)} placeholder="Cole o roteiro. Cada parágrafo vira um bloco; a IA busca as imagens de cada um." data-testid="new-script" />
            </>
          )}
          <label className="f">Nome do projeto</label>
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Estudo de Eclesiastes — parte 1" data-testid="new-name" />
          <label className="f">Formato</label>
          <div className="seg">
            {ASPECTS.map((a) => (
              <button key={a.id} className={`btn sm${(aspect ?? t.aspect) === a.id ? ' active' : ''}`} onClick={() => setAspect(a.id)}>{a.label}</button>
            ))}
          </div>
          <p className="note">
            {t.id === 'manual'
              ? 'Abre direto no editor. Você chama a IA para cada tarefa (legenda, cortes, B-roll, música…) quando quiser.'
              : effMode === 'script-led'
                ? `Fases: ${t.phases.length - 1} etapas guiadas. Escolha a narração e os takes/imagens que tiver (pode ser só o roteiro).`
                : `Fases: ${t.phases.length - 1} etapas guiadas e depois o editor completo. Escolha o vídeo principal e os takes de apoio.`}
          </p>
          <div className="row">
            <button className="btn primary" disabled={!canCreate} onClick={() => void create()} data-testid="new-create">
              {busy ? 'Criando…' : effMode === 'script-led' ? 'Criar e escolher as mídias' : 'Criar e escolher os vídeos'}
            </button>
            <button className="btn" onClick={() => viewStore.set('home')}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
