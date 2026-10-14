// "Editar vídeo inteiro": o comando único da edição automática. A pessoa escreve o briefing
// (tom, público, objetivo) e cola o roteiro que gravou; as etapas Corte → Imagens → Transições →
// Efeitos e motion rodam em sequência seguindo o mapa narrativo montado a partir deles.

import { useState } from 'react';
import { Clapperboard, FileText } from 'lucide-react';
import type { Workflow } from '../core/workflow';
import { setBriefing } from '../app/workflow';
import { runAll } from '../app/phases';
import { MUSIC_CHOICES, TONES } from '../video-editor/narrative/tones';
import { useAI, usePhaseRun } from './hooks';

export function BriefingCard({ wf, hasMedia }: { wf: Workflow; hasMedia: boolean }) {
  const [open, setOpen] = useState(false);
  const ai = useAI().settings;
  const busy = !!usePhaseRun()?.running;
  const who = ai.provider === 'claude-code' ? 'com a sua conta Claude' : ai.provider === 'claude' ? 'com o Claude (API)' : 'com a IA local';
  const filled = [wf.brief ? 'briefing' : '', wf.reference || wf.script ? 'roteiro' : '', wf.tone ? `tom ${TONES.find((t) => t.id === wf.tone)?.label.toLowerCase()}` : ''].filter(Boolean);
  return (
    <div className="insp" data-testid="briefing-card">
      <p className="note">
        {filled.length ? `Com ${filled.join(' e ')}: a edição segue a sua narrativa.` : 'Escreva o briefing e cole o roteiro: a edição inteira segue a sua narrativa.'}
      </p>
      <button className="btn sm" onClick={() => setOpen(true)} data-testid="briefing-open">
        <FileText size={12} /> Briefing e roteiro{filled.length ? ' ✓' : ''}
      </button>
      <button className="btn sm primary" disabled={busy || !hasMedia} onClick={() => void runAll()} title={`Corte, imagens, transições e motion em sequência, ${who}`} data-testid="run-all">
        <Clapperboard size={12} /> Editar vídeo inteiro
      </button>
      {ai.provider === 'ollama' && <p className="note bad">Com a IA local, o vídeo é lido pelas regras do editor. Para a leitura profunda, escolha "Minha conta Claude" em IA → configurações.</p>}
      {open && <BriefingDialog wf={wf} onClose={() => setOpen(false)} />}
    </div>
  );
}

function BriefingDialog({ wf, onClose }: { wf: Workflow; onClose: () => void }) {
  const [brief, setBrief] = useState(wf.brief ?? '');
  const [reference, setReference] = useState(wf.reference ?? '');
  const [tone, setTone] = useState(wf.tone ?? 'auto');
  const [music, setMusic] = useState(wf.music ?? 'auto');
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Briefing e roteiro">
        <div className="dialog-head">Briefing e roteiro</div>
        <div className="dialog-body">
          <div className="field">
            <label>Tom do vídeo</label>
            <select value={tone} onChange={(e) => setTone(e.target.value)} data-testid="briefing-tone">
              {TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <p className="note">{TONES.find((t) => t.id === tone)?.hint}. Trilha, ritmo, efeitos, transições e motion casam com o tom.</p>
          <div className="field">
            <label>Música</label>
            <select value={music} onChange={(e) => setMusic(e.target.value)} data-testid="briefing-music">
              {MUSIC_CHOICES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <label className="director-label">Briefing</label>
          <textarea
            className="text-input area"
            rows={5}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Canal, público, objetivo, tom, estilo das imagens e do motion. Ex.: canal cristão moderno, público que duvida; prender a atenção; imagens de arte sacra coerentes com cada bloco; motion elegante."
            data-testid="briefing-text"
          />
          {wf.mode !== 'script-led' && (
            <>
              <label className="director-label">Roteiro de referência</label>
              <textarea
                className="text-input area"
                rows={10}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Cole o texto que você gravou. Títulos em CAIXA ALTA viram os blocos do vídeo (lower thirds); o texto corrige erros da transcrição."
                data-testid="briefing-reference"
              />
            </>
          )}
          <p className="note">Mudou o briefing ou o roteiro? O mapa narrativo é refeito na próxima edição.</p>
        </div>
        <div className="dialog-foot">
          <button className="btn outline" onClick={onClose}>Cancelar</button>
          <button
            className="btn primary"
            onClick={() => {
              setBriefing(brief, reference, tone, music);
              onClose();
            }}
            data-testid="briefing-save"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
