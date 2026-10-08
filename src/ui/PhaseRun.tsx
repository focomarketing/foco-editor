// Aprovação de uma etapa: progresso da execução, sugestões da IA com skill, confiança e motivo,
// preview, aplicar tudo/selecionados, rejeitar, desfazer a etapa ou um item, regenerar.

import { useState } from 'react';
import { Bot, Eye, EyeOff, Play, RotateCcw, Square, Trash2, Undo2 } from 'lucide-react';
import { applyPending, cancelPhase, currentOperation, imageKeys, rejectPending, runPhase, saveImageKeys, toggleSuggestion, undoItem, undoPhase, undoTransitionItem } from '../app/phases';
import type { PhaseId } from '../core/workflow';
import { formatTimecode } from '../core/time';
import { playback, store } from '../app/editor';
import { previewProject } from '../video-editor/history/operations';
import { MIN_AUTO_CONFIDENCE } from '../video-editor/commands/types';
import type { EditCommand, EditOperation } from '../video-editor/commands/types';
import { useEditor, usePhaseRun } from './hooks';

const KIND: Partial<Record<EditCommand['type'], string>> = {
  ripple_remove: 'Corte',
  add_overlay: 'Imagem',
  add_clip: 'Clipe',
  add_music: 'Música',
  add_sound_effect: 'Efeito sonoro',
  add_caption: 'Legenda',
  add_transition: 'Transição',
  add_effect: 'Efeito',
  apply_lut: 'Cor',
};

export function PhaseRunCard({ phase }: { phase: PhaseId }) {
  const run = usePhaseRun();
  const { project } = useEditor(); // re-renderiza quando o histórico de operações muda
  const mine = run?.phase === phase ? run : null;
  const op = mine && !mine.running ? currentOperation(mine.opId) : null;
  const pct = mine && mine.total > 0 ? Math.min(100, Math.round((mine.done / mine.total) * 100)) : 0;

  return (
    <section className="phase-run" data-testid="phase-run">
      {mine?.running ? (
        <>
          <div className="progress"><div style={{ width: `${pct || 4}%` }} /></div>
          <div className="job-row">
            <span className="muted" data-testid="phase-step">{mine.step}</span>
            <button className="btn icon sm" title="Cancelar" onClick={cancelPhase}><Square size={11} /></button>
          </div>
        </>
      ) : (
        <>
          {mine?.summary && <div className="edit-summary" data-testid="phase-summary">{mine.summary}</div>}
          {mine?.error && <p className="note bad">{mine.error}</p>}
          <div className="row-between">
            <button className="btn sm outline" onClick={() => void runPhase(phase, { regenerate: !!op })} data-testid="phase-run-again" title={op ? 'Gera de novo só esta etapa (itens que você editou ou protegeu ficam)' : ''}>
              {op ? <RotateCcw size={12} /> : <Play size={12} />} {op ? 'Regenerar etapa' : 'Fazer com a IA'}
            </button>
            {op?.status === 'applied' && (
              <button className="btn sm" onClick={() => undoPhase(op.id)} data-testid="phase-undo"><Undo2 size={12} /> Desfazer etapa</button>
            )}
          </div>
        </>
      )}
      {op && <Suggestions op={op} fps={project.settings.fps} />}
      {phase === 'images' && <ImageKeys />}
    </section>
  );
}

function Suggestions({ op, fps }: { op: EditOperation; fps: number }) {
  const [previewing, setPreviewing] = useState(false);
  const preview = op.status === 'preview';
  const selected = new Set(op.selected ?? []);
  const project = store.getState().project;
  const createdClips = Object.values(project.clips).filter((c) => c.origin?.operationId === op.id);
  // clipe criado por uma sugestão: mesma operação e mesmo início
  const clipOf = (c: EditCommand) => (c.start === undefined ? undefined : createdClips.find((x) => Math.abs(x.start - c.start!) < 0.01)?.id);
  const togglePreview = () => {
    if (previewing) playback.setPreviewProject(null);
    else playback.setPreviewProject(previewProject(project, op).project);
    setPreviewing(!previewing);
  };
  return (
    <div className="suggestions" data-testid="suggestions">
      <div className="row-between">
        <span className="muted">
          <Bot size={12} /> {op.commands.length} sugestão(ões) · {op.status === 'preview' ? 'aguardando você' : op.status === 'applied' ? 'aplicada' : op.status === 'reverted' ? 'desfeita' : 'rejeitada'}
        </span>
        {preview && (
          <button className="btn sm" onClick={togglePreview} title="Ver no player como fica, sem mudar a timeline">
            {previewing ? <EyeOff size={12} /> : <Eye size={12} />} {previewing ? 'Sair do preview' : 'Preview'}
          </button>
        )}
      </div>
      {preview && (
        <div className="row-between">
          <button className="btn sm primary" disabled={!selected.size} onClick={() => { playback.setPreviewProject(null); setPreviewing(false); applyPending(op.id, 'selected'); }} data-testid="apply-selected">
            Aplicar selecionados ({selected.size})
          </button>
          <button className="btn sm" onClick={() => { playback.setPreviewProject(null); setPreviewing(false); applyPending(op.id, 'all'); }} data-testid="apply-all">Aplicar tudo</button>
          <button className="btn sm danger" onClick={() => { playback.setPreviewProject(null); setPreviewing(false); rejectPending(op.id); }} data-testid="reject-op">Rejeitar</button>
        </div>
      )}
      <div className="cut-list">
        {op.commands.map((c) => {
          const low = (c.confidence ?? 1) < MIN_AUTO_CONFIDENCE;
          const on = selected.has(c.id);
          const clipId = c.type === 'ripple_remove' || c.type === 'add_transition' || c.type === 'add_effect' ? undefined : clipOf(c);
          // transição aplicada pela IA e ainda igual: dá para desfazer só ela
          const trClip = c.type === 'add_transition' ? project.clips[c.payload.clipId as string] : undefined;
          const trAlive = !!trClip?.transitionIn && trClip.transitionIn.by === 'ai' && trClip.transitionIn.type === c.payload.transitionId;
          const alive = !!clipId;
          return (
            <div key={c.id} className={`cut-row${on || !preview ? ' on' : ''}`} data-testid="suggestion">
              {preview && <input type="checkbox" checked={on} onChange={() => toggleSuggestion(op.id, c.id)} title={low ? 'Confiança baixa: revise antes de aplicar' : ''} />}
              <button className="cut-main" onClick={() => c.start !== undefined && playback.seek(Math.max(0, c.start - 0.8))} title={c.reason}>
                <span className={`chip ${low ? 'k-filler' : 'k-pause'}`}>{c.payload.title ? 'Título' : (c.type === 'add_effect' || c.type === 'add_transition') && c.payload.label ? String(c.payload.label) : KIND[c.type] ?? c.type}</span>
                <span className="tc">{c.start !== undefined ? formatTimecode(c.start, fps).slice(3) : ''}</span>
                <span className="dur">IA · {c.skill} · {Math.round((c.confidence ?? 1) * 100)}%{low ? ' · revisar' : ''}</span>
                <span className="why">{c.reason}{c.payload.license ? ` · ${c.payload.license.author ?? ''} (${c.payload.license.licenseName})` : ''}</span>
              </button>
              {!preview && alive && (
                <button className="btn icon sm" title="Desfazer este item" onClick={() => undoItem(clipId!)}><Trash2 size={11} /></button>
              )}
              {!preview && trAlive && (
                <button className="btn icon sm" title="Tirar esta transição" onClick={() => undoTransitionItem(trClip!.id, c)}><Trash2 size={11} /></button>
              )}
            </div>
          );
        })}
      </div>
      {(op.warnings?.length ?? 0) > 0 && <p className="note">{op.warnings!.join(' · ')}</p>}
    </div>
  );
}

function ImageKeys() {
  const [open, setOpen] = useState(false);
  const [k, setK] = useState(imageKeys);
  if (!open) {
    return (
      <button className="btn sm link" onClick={() => setOpen(true)}>
        Fontes de imagem: Wikimedia{k.pexels ? ' · Pexels' : ''}{k.pixabay ? ' · Pixabay' : ''} — configurar
      </button>
    );
  }
  return (
    <div className="field-group">
      <p className="note">Wikimedia (domínio público) funciona sem chave. Com chaves grátis, a IA também busca no Pexels e no Pixabay.</p>
      <div className="field wide"><label>Pexels</label><input type="password" value={k.pexels ?? ''} placeholder="chave da API" onChange={(e) => setK({ ...k, pexels: e.target.value.trim() })} /></div>
      <div className="field wide"><label>Pixabay</label><input type="password" value={k.pixabay ?? ''} placeholder="chave da API" onChange={(e) => setK({ ...k, pixabay: e.target.value.trim() })} /></div>
      <button className="btn sm primary" onClick={() => { saveImageKeys(k); setOpen(false); }}>Salvar</button>
    </div>
  );
}
