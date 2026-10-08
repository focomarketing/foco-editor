// Cartão da execução automática de uma fase: barra de progresso, etapa atual, resumo,
// desfazer/refazer e (na fase Imagens) a lista de imagens colocadas com os créditos.

import { useState } from 'react';
import { Play, RotateCcw, Square, Trash2, Undo2 } from 'lucide-react';
import { cancelPhase, imageKeys, removePlacedImage, runPhase, saveImageKeys, undoPhase } from '../app/phases';
import type { PhaseId } from '../core/workflow';
import { formatTimecode } from '../core/time';
import { playback } from '../app/editor';
import { useEditor, usePhaseRun } from './hooks';

export function PhaseRunCard({ phase }: { phase: PhaseId }) {
  const run = usePhaseRun();
  const { project } = useEditor();
  const mine = run?.phase === phase ? run : null;
  const pct = mine && mine.total > 0 ? Math.min(100, Math.round((mine.done / mine.total) * 100)) : 0;
  const fps = project.settings.fps;

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
            <button className="btn sm outline" onClick={() => void runPhase(phase)} data-testid="phase-run-again">
              {mine ? <RotateCcw size={12} /> : <Play size={12} />} {mine ? 'Refazer com a IA' : 'Fazer com a IA'}
            </button>
            {mine?.undoLabel && (
              <button className="btn sm" onClick={undoPhase} data-testid="phase-undo"><Undo2 size={12} /> Desfazer esta fase</button>
            )}
          </div>
        </>
      )}

      {phase === 'images' && mine && !mine.running && mine.images.length > 0 && (
        <div className="cut-list" data-testid="placed-images">
          {mine.images.map((im) => (
            <div key={im.clipId} className="cut-row on">
              <button className="cut-main" title={im.why} onClick={() => playback.seek(Math.max(0, im.start - 0.5))}>
                <span className="chip k-retake">{im.credit.source}</span>
                <span className="tc">{formatTimecode(im.start, fps).slice(3)}</span>
                <span className="dur">{im.query}</span>
                <span className="why">{im.credit.title} · {im.credit.author} · {im.credit.license}</span>
              </button>
              <button className="btn icon sm" title="Tirar esta imagem" onClick={() => removePlacedImage(im.clipId)}><Trash2 size={11} /></button>
            </div>
          ))}
        </div>
      )}
      {phase === 'images' && <ImageKeys />}
    </section>
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
