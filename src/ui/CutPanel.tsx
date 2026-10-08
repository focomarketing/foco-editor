// Aba Corte: ritmo (natural / dinâmico / seco), o que remover, revisão item a item com
// "ouvir", aplicar como um passo de undo e conferência do resultado.

import { CheckCircle2, Play, Scissors, Sparkles, TriangleAlert } from 'lucide-react';
import { formatTimecode } from '../core/time';
import { actions, playback } from '../app/editor';
import { analyzeSmartCuts, applySmartCuts, smartCutStore } from '../app/smartCut';
import { CUT_MODES, SMART_CUT_LABEL } from '../engine/cut/smartCut';
import type { CutMode, SmartCut, SmartCutKind, SmartCutOptions } from '../engine/cut/smartCut';
import { WHISPER_MODELS } from '../engine/transcript/TranscriptEngine';
import { useEditor, useSmartCut, useTranscriptsVersion } from './hooks';
import { transcripts } from '../app/editor';

const TOGGLES: { key: keyof SmartCutOptions; label: string; hint: string }[] = [
  { key: 'pauses', label: 'Pausas e respiros', hint: 'encurta pelo ritmo escolhido' },
  { key: 'fillers', label: 'Vícios ("ééé", "hum")', hint: 'tira as hesitações faladas' },
  { key: 'stutters', label: 'Gagueira ("eu eu")', hint: 'palavra repetida em seguida' },
  { key: 'retakes', label: 'Começos falsos e frases repetidas', hint: 'fica a tomada mais limpa, mesmo em outro take' },
  { key: 'keepEmphasis', label: 'Manter pausas de ênfase', hint: 'antes de perguntas e frases fortes' },
];

/** Toca o trecho em volta do corte (1,2 s antes e depois), para ouvir o que sai. */
function listen(c: SmartCut) {
  const from = Math.max(0, c.start - 1.2);
  playback.seek(from);
  playback.play();
  const ms = (c.end - from + 1.2) * 1000;
  setTimeout(() => playback.pause(), ms);
}

export function CutPanel() {
  const { project } = useEditor();
  useTranscriptsVersion();
  const s = useSmartCut();
  const fps = project.settings.fps;
  const o = s.options;
  const chosen = s.cuts.filter((c) => s.selected.has(c.id));
  const seconds = chosen.reduce((acc, c) => acc + c.end - c.start, 0);
  const counts = s.cuts.reduce<Partial<Record<SmartCutKind, number>>>((acc, c) => ({ ...acc, [c.kind]: (acc[c.kind] ?? 0) + 1 }), {});
  const missing = s.missing.filter((id) => project.assets[id] && !transcripts.get(id));
  const transcribing = missing.some((id) => transcripts.job(id));

  return (
    <div className="insp ai" data-testid="cut-panel">
      <section>
        <h4><Scissors size={12} /> Ritmo</h4>
        <div className="seg">
          {(Object.keys(CUT_MODES) as CutMode[]).map((m) => (
            <button key={m} className={`btn sm${o.mode === m ? ' active' : ''}`} title={CUT_MODES[m].hint} onClick={() => smartCutStore.setOptions({ mode: m })} data-testid={`cut-mode-${m}`}>
              {CUT_MODES[m].label}
            </button>
          ))}
        </div>
        <p className="note">{CUT_MODES[o.mode].hint}</p>
      </section>

      <section>
        <h4>O que remover</h4>
        {TOGGLES.map((t) => (
          <label key={t.key} className="check" title={t.hint}>
            <input
              type="checkbox"
              checked={!!o[t.key]}
              disabled={t.key === 'keepEmphasis' && (o.mode === 'dry' || !o.pauses)}
              onChange={(e) => smartCutStore.setOptions({ [t.key]: e.target.checked } as Partial<SmartCutOptions>)}
            />
            {t.label}
          </label>
        ))}
        <button className="btn sm primary" disabled={s.busy} onClick={() => void analyzeSmartCuts()} data-testid="cut-analyze">
          <Sparkles size={13} /> {s.busy ? 'Analisando…' : 'Analisar a fala'}
        </button>
        <p className="note">Mede cada corte na onda do áudio para não morder palavras. Nada muda até você aplicar.</p>
        {missing.length > 0 && (
          <div className="note bad">
            {missing.length} mídia(s) sem transcrição: só dá para cortar a fala transcrita.{' '}
            <button
              className="btn sm outline"
              disabled={transcribing}
              onClick={() => {
                const model = (() => {
                  try {
                    return localStorage.getItem('foco.whisperModel') || WHISPER_MODELS[0].id;
                  } catch {
                    return WHISPER_MODELS[0].id;
                  }
                })();
                for (const id of missing) void actions.transcribe(id, model, 'portuguese');
              }}
            >
              {transcribing ? 'Transcrevendo…' : 'Transcrever agora'}
            </button>
          </div>
        )}
      </section>

      {s.cuts.length > 0 && (
        <section>
          <div className="cut-summary" data-testid="cut-summary">
            <b>{chosen.length}</b> de {s.cuts.length} marcados · <b>{seconds.toFixed(1).replace('.', ',')} s</b> a remover
            {s.before > 0 && <> · fala {formatTimecode(s.before, fps).slice(3, 8)} → {formatTimecode(Math.max(0, s.before - seconds), fps).slice(3, 8)}</>}
            <div className="chips">
              {(Object.entries(counts) as [SmartCutKind, number][]).map(([k, n]) => (
                <span key={k} className={`chip k-${k}`}>{SMART_CUT_LABEL[k]} {n}</span>
              ))}
            </div>
          </div>
          <div className="row-between">
            <label className="check">
              <input type="checkbox" checked={chosen.length === s.cuts.length} onChange={(e) => smartCutStore.setAll(e.target.checked)} />
              todos
            </label>
            <button className="btn sm primary" disabled={!chosen.length} onClick={() => void applySmartCuts()} data-testid="cut-apply">
              Aplicar {chosen.length} corte{chosen.length === 1 ? '' : 's'}
            </button>
          </div>
          <div className="cut-list">
            {s.cuts.map((c) => (
              <div key={c.id} className={`cut-row${s.selected.has(c.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={s.selected.has(c.id)} onChange={() => smartCutStore.toggle(c.id)} />
                <button className="cut-main" title="Ir para o trecho (1 s antes)" onClick={() => playback.seek(Math.max(0, c.start - 1))}>
                  <span className={`chip k-${c.kind}`}>{SMART_CUT_LABEL[c.kind]}</span>
                  <span className="tc">{formatTimecode(c.start, fps).slice(3)}</span>
                  <span className="dur">{(c.end - c.start).toFixed(1)} s</span>
                  <span className="why">{c.text ? `"${c.text}" · ` : ''}{c.reason}</span>
                </button>
                <button className="btn icon sm" title="Ouvir em volta do corte" onClick={() => listen(c)}><Play size={11} /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      {s.lastApply && (
        <section>
          <div className="edit-summary" data-testid="cut-check">
            <b>Conferência do corte</b>
            <div>{s.lastApply.count} trechos removidos · {s.lastApply.removed.toFixed(1).replace('.', ',')} s a menos · Ctrl+Z desfaz tudo.</div>
            {s.lastApply.check.longPauses.length === 0 && s.lastApply.check.riskySplices.length === 0 ? (
              <div><CheckCircle2 size={12} /> Sem pausas acima do ritmo e nenhuma emenda no meio de som.</div>
            ) : (
              <>
                {s.lastApply.check.longPauses.length > 0 && (
                  <div>
                    <TriangleAlert size={12} /> {s.lastApply.check.longPauses.length} pausa(s) ainda longas:{' '}
                    {s.lastApply.check.longPauses.slice(0, 6).map((p) => (
                      <button key={p.at} className="chip-btn" onClick={() => playback.seek(Math.max(0, p.at - 1))}>{formatTimecode(p.at, fps).slice(3, 8)}</button>
                    ))}
                  </div>
                )}
                {s.lastApply.check.riskySplices.length > 0 && (
                  <div>
                    <TriangleAlert size={12} /> {s.lastApply.check.riskySplices.length} emenda(s) com som (ouça se não mordeu palavra):{' '}
                    {s.lastApply.check.riskySplices.slice(0, 6).map((t) => (
                      <button key={t} className="chip-btn" onClick={() => playback.seek(Math.max(0, t - 1))}>{formatTimecode(t, fps).slice(3, 8)}</button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
