// Tela do Diretor de edição: briefing → o Diretor trabalha num rascunho (log ao vivo, custo) →
// entrega com plano, mudanças e problemas restantes → ver no player, aplicar (um undo),
// descartar ou pedir ajuste em linguagem natural.

import { useState, useSyncExternalStore } from 'react';
import { Check, Clapperboard, Eye, EyeOff, Play, Square, Trash2, Wand2 } from 'lucide-react';
import { adjustDirector, applyDirector, cancelDirector, directorBudget, directorStore, discardDirector, previewDraft, startDirector, stopPreview } from '../app/director';
import type { LogEntry } from '../app/director';
import { aiStore } from '../app/aiEditor';

const useDirector = () => useSyncExternalStore(directorStore.subscribe, directorStore.get);
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const usd = (v: number) => `US$ ${v.toFixed(v < 1 ? 3 : 2)}`;

export function DirectorPanel() {
  const d = useDirector();
  const [brief, setBrief] = useState('');
  const [adjust, setAdjust] = useState('');
  const [budget, setBudget] = useState(directorBudget.get());
  const ai = aiStore.get().settings;
  const ready = ai.provider === 'claude' && !!ai.claudeKey && ai.cloudConsent;
  const running = d.status === 'running';

  return (
    <div className="director" data-testid="director-panel">
      {d.status === 'idle' && (
        <>
          <p className="note">
            O Diretor edita como um editor profissional: lê a fala, planeja, monta com as skills do FOCO, <b>olha os quadros</b>, mede o áudio, verifica e corrige — e só então entrega para você aprovar. A timeline não muda até você aplicar.
          </p>
          <label className="director-label">Briefing</label>
          <textarea
            className="text-input area"
            rows={6}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={'Ex.: vídeo para o YouTube sobre fé e ansiedade, público de 25–40 anos, tom acolhedor, ~8 min. Manter as pausas de ênfase, destacar os versículos citados, B-roll de natureza.'}
            data-testid="director-brief"
          />
          <div className="field">
            <label>Limite de gasto</label>
            <input type="number" min={0.5} max={20} step={0.5} value={budget} onChange={(e) => { const v = Number(e.target.value); setBudget(v); if (v > 0) directorBudget.set(v); }} />
            <span className="ro">US$</span>
          </div>
          {!ready && <p className="note bad">O Diretor usa o Claude: configure a chave da API e autorize o envio na aba IA → configurações.</p>}
          <button className="btn primary" disabled={!ready} onClick={() => void startDirector(brief)} data-testid="director-start">
            <Clapperboard size={14} /> Editar com o Diretor
          </button>
          <p className="note">Modelo: {ai.claudeModel}. Para gastar menos, troque para o Sonnet nas configurações de IA.</p>
        </>
      )}

      {d.status !== 'idle' && (
        <>
          <div className="row-between director-meta">
            <span className="muted">{running ? 'Trabalhando…' : d.stopped === 'finished' ? 'Entregue' : 'Parado'} · {d.turns} passo(s) · {usd(d.costUsd)}</span>
            {running && <button className="btn sm" onClick={cancelDirector} data-testid="director-cancel"><Square size={11} /> Parar</button>}
          </div>
          {running && <div className="progress"><div className="indeterminate" /></div>}

          {d.plan && (
            <div className="director-plan" data-testid="director-plan">
              <b>Plano</b>
              <p>{d.plan.summary}{d.plan.targetDuration ? ` · alvo ${fmt(d.plan.targetDuration)}` : ''}</p>
              {d.plan.structure.length > 0 && (
                <ol>{d.plan.structure.map((s, i) => <li key={i}><span className="tc">{fmt(s.start)}–{fmt(s.end)}</span> {s.part}{s.note ? ` — ${s.note}` : ''}</li>)}</ol>
              )}
            </div>
          )}

          {d.finished && (
            <div className="edit-summary" data-testid="director-finished">
              <p>{d.finished.summary}</p>
              {d.finished.changes.length > 0 && <ul>{d.finished.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
              {d.finished.openQuestions.length > 0 && (
                <>
                  <b>Para você decidir:</b>
                  <ul>{d.finished.openQuestions.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </>
              )}
            </div>
          )}
          {d.message && <p className={`note${d.stopped === 'error' || d.stopped === 'refusal' ? ' bad' : ''}`}>{d.message}</p>}
          {!running && d.issues && d.issues.length > 0 && (
            <div className="director-issues">
              <b>Última verificação</b>
              <ul>{d.issues.slice(0, 12).map((x, i) => <li key={i} className={`sev-${x.severity}`}>[{x.severity}] {x.message}</li>)}</ul>
            </div>
          )}

          {!running && d.hasDraft && (
            <>
              <div className="row director-actions">
                <button className="btn sm" onClick={() => (d.previewing ? stopPreview() : previewDraft())} data-testid="director-preview">
                  {d.previewing ? <EyeOff size={12} /> : <Eye size={12} />} {d.previewing ? 'Sair do preview' : 'Ver no player'}
                </button>
                <button className="btn sm primary" onClick={() => applyDirector()} data-testid="director-apply"><Check size={12} /> Aplicar</button>
                <button className="btn sm danger" onClick={discardDirector} data-testid="director-discard"><Trash2 size={12} /> Descartar</button>
              </div>
              <label className="director-label">Pedir ajuste</label>
              <textarea className="text-input area" rows={3} value={adjust} onChange={(e) => setAdjust(e.target.value)} placeholder="Ex.: o gancho ficou longo, comece direto na pergunta; menos títulos; mais B-roll no bloco 2." data-testid="director-adjust" />
              <button className="btn sm" disabled={!adjust.trim()} onClick={() => { void adjustDirector(adjust); setAdjust(''); }} data-testid="director-adjust-send"><Wand2 size={12} /> Pedir ajuste</button>
            </>
          )}

          <DirectorLog entries={d.log} />
        </>
      )}
    </div>
  );
}

function DirectorLog({ entries }: { entries: LogEntry[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="director-log" data-testid="director-log">
      {[...entries].reverse().slice(0, 120).map((e) => (
        <div key={e.id} className={`dl dl-${e.kind}${e.isError ? ' bad' : ''}`} onClick={() => setOpen(open === e.id ? null : e.id)}>
          {e.kind === 'tool' && <Play size={10} />} {e.kind === 'thinking' ? <i>{open === e.id ? e.text : e.text.slice(0, 160)}</i> : open === e.id || e.kind !== 'tool_result' ? e.text : e.text.slice(0, 160)}
          {e.image && <img src={`data:image/jpeg;base64,${e.image}`} alt="quadros vistos pelo Diretor" />}
        </div>
      ))}
    </div>
  );
}
