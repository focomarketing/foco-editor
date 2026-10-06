import { memo, useEffect, useRef, useState } from 'react';
import { Captions, FileText, Scissors, Sparkles, Square } from 'lucide-react';
import type { Asset, Transcript } from '../core/types';
import { formatDuration, formatTimecode } from '../core/time';
import { toSource } from '../core/clipTime';
import { actions, playback, store, transcripts } from '../app/editor';
import { analysisStore } from '../app/analysis';
import { CUT_KIND_LABEL, summarize } from '../engine/analysis/cuts';
import type { CutKind, CutLevel } from '../engine/analysis/cuts';
import { CAPTION_PRESETS } from '../engine/captions/captions';
import { LANGUAGES, WHISPER_MODELS } from '../engine/transcript/TranscriptEngine';
import { sourceTimeToTimeline } from '../engine/timeline/operations';
import { useAnalysis, useEditor, useMediaVersion, useTranscriptsVersion } from './hooks';
import { AIChat } from './AIChat';
import { useAI } from './hooks';
import { runManual } from '../app/aiEditor';
import { AUDIO_PRESETS } from '../engine/audio/audioFx';
import type { ZoomIntensity } from '../engine/analysis/zoom';
import { Wand2 } from 'lucide-react';

const LEVELS: { id: CutLevel; label: string; hint: string }[] = [
  { id: 'safe', label: 'Seguro', hint: 'só erros e pausas muito claros' },
  { id: 'balanced', label: 'Equilibrado', hint: 'ritmo dinâmico e natural' },
  { id: 'aggressive', label: 'Agressivo', hint: 'bem rápido, para redes sociais' },
];

export function AIPanel({ mode }: { mode: 'ai' | 'captions' }) {
  const { project, selection } = useEditor();
  useMediaVersion();
  useTranscriptsVersion();
  const analysis = useAnalysis();

  const audioAssets = Object.values(project.assets).filter((a) => a.hasAudio && a.audioDecodable);
  const fromSelection = selection.length === 1 ? project.clips[selection[0]]?.assetId : undefined;
  const onTimeline = new Set(Object.values(project.clips).map((c) => c.assetId));
  const [picked, setPicked] = useState<string | null>(null);
  const assetId =
    (picked && project.assets[picked] ? picked : null) ??
    (fromSelection && project.assets[fromSelection]?.hasAudio ? fromSelection : null) ??
    audioAssets.find((a) => onTimeline.has(a.id))?.id ??
    audioAssets[0]?.id ??
    null;
  const asset = assetId ? project.assets[assetId] : undefined;

  if (!asset) {
    return (
      <div className="insp ai">
        {mode === 'ai' && <AIChat />}
        <div className="empty">
          Importe um vídeo ou áudio com fala para transcrever, detectar pausas e erros e gerar legendas.
        </div>
      </div>
    );
  }

  return (
    <div className="insp ai">
      {mode === 'ai' && <AIChat />}
      {mode === 'ai' && <QuickActions />}
      <div className="field wide">
        <label>Mídia</label>
        <select value={asset.id} onChange={(e) => setPicked(e.target.value)}>
          {audioAssets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {onTimeline.has(a.id) ? '' : ' (fora da timeline)'}
            </option>
          ))}
        </select>
      </div>
      <TranscriptSection asset={asset} />
      {mode === 'ai' && <CutsSection asset={asset} analysis={analysis} />}
      {mode === 'captions' && <CaptionsSection asset={asset} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Atalhos que passam pelo mesmo executor de comandos do chat. */
function QuickActions() {
  const ai = useAI();
  const [audio, setAudio] = useState('voice');
  const [zoom, setZoom] = useState<ZoomIntensity>('normal');
  const busy = !!ai.busy;
  return (
    <section>
      <h4><Wand2 size={12} /> Ações rápidas</h4>
      <div className="quick">
        <select value={audio} onChange={(e) => setAudio(e.target.value)} disabled={busy}>
          {AUDIO_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button className="btn sm outline" disabled={busy} onClick={() => void runManual({ type: 'enhance_audio', preset: audio })}>Melhorar áudio</button>
      </div>
      <div className="quick">
        <span />
        <button className="btn sm outline" disabled={busy} onClick={() => void runManual({ type: 'auto_color' })}>Cor automática</button>
      </div>
      <div className="quick">
        <select value={zoom} onChange={(e) => setZoom(e.target.value as ZoomIntensity)} disabled={busy}>
          <option value="subtle">Sutil</option>
          <option value="normal">Normal</option>
          <option value="strong">Forte</option>
        </select>
        <button className="btn sm outline" disabled={busy} onClick={() => void runManual({ type: 'smart_zoom', intensity: zoom })}>Smart zoom</button>
      </div>
    </section>
  );
}

function TranscriptSection({ asset }: { asset: Asset }) {
  const [model, setModel] = useState(WHISPER_MODELS[0].id);
  const [language, setLanguage] = useState('portuguese');
  const t = transcripts.get(asset.id);
  const job = transcripts.job(asset.id);
  const m = WHISPER_MODELS.find((x) => x.id === model)!;
  const running = job && job.phase !== 'error';

  return (
    <section>
      <h4><FileText size={12} /> Transcrição</h4>
      {!running && (
        <>
          <div className="field wide">
            <label>Modelo</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {WHISPER_MODELS.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </select>
          </div>
          <div className="field wide">
            <label>Idioma</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </div>
          <button
            className="btn sm primary"
            onClick={() => {
              try {
                localStorage.setItem('foco.whisperModel', model);
              } catch {
                /* ok */
              }
              void actions.transcribe(asset.id, model, language);
            }}
          >
            <Sparkles size={13} /> {t ? 'Transcrever de novo' : 'Transcrever'}
          </button>
          <p className="note">
            Roda neste computador — o áudio não é enviado para a internet. Na primeira vez o modelo é baixado
            (~{m.mbGpu} MB com GPU, ~{m.mbCpu} MB sem) e fica guardado no navegador.
          </p>
        </>
      )}
      {job?.phase === 'loading-model' && (
        <Progress
          value={job.total ? job.loaded / job.total : 0}
          label={job.total ? `Baixando modelo · ${(job.loaded / 1e6).toFixed(0)} de ${(job.total / 1e6).toFixed(0)} MB` : 'Carregando modelo…'}
          onCancel={() => transcripts.cancel(asset.id)}
        />
      )}
      {job?.phase === 'transcribing' && (
        <Progress
          value={job.done / Math.max(1, job.total)}
          label={`Transcrevendo trecho ${job.done + 1} de ${job.total} · ${job.device === 'webgpu' ? 'GPU' : 'CPU'}${etaLabel(job)}`}
          onCancel={() => transcripts.cancel(asset.id)}
        />
      )}
      {job?.phase === 'error' && <p className="note bad">Falhou: {job.message}</p>}
      {t && !running && <TranscriptView transcript={t} asset={asset} />}
    </section>
  );
}

function etaLabel(job: { done: number; total: number; startedAt: number }) {
  if (job.done < 1) return '';
  const elapsed = (performance.now() - job.startedAt) / 1000;
  return ` · ~${formatDuration((elapsed / job.done) * (job.total - job.done))} restantes`;
}

function Progress({ value, label, onCancel }: { value: number; label: string; onCancel: () => void }) {
  return (
    <div className="job">
      <div className="progress"><div style={{ width: `${Math.round(value * 100)}%` }} /></div>
      <div className="job-row">
        <span className="muted" data-testid="ai-progress">{label}</span>
        <button className="btn icon sm" title="Cancelar" onClick={onCancel}><Square size={11} /></button>
      </div>
    </div>
  );
}

/** Texto clicável; a palavra que está tocando fica destacada. Duplo clique edita. */
const TranscriptView = memo(function TranscriptView({ transcript, asset }: { transcript: Transcript; asset: Asset }) {
  const ref = useRef<HTMLDivElement>(null);
  const words = transcript.words;

  useEffect(() => {
    let last: HTMLElement | null = null;
    const update = () => {
      const p = store.getState().project;
      const t = playback.getSnapshot().time;
      // tempo da timeline -> tempo da mídia (clipe deste asset sob o playhead)
      const clip = Object.values(p.clips).find((c) => c.assetId === asset.id && !c.caption && t >= c.start && t < c.start + c.duration);
      let el: HTMLElement | null = null;
      if (clip) {
        const src = toSource(clip, t);
        let lo = 0;
        let hi = words.length - 1;
        let idx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (words[mid].start <= src) {
            idx = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        if (idx >= 0 && src < words[idx].end + 0.3) el = ref.current?.querySelector(`[data-i="${idx}"]`) ?? null;
      }
      if (el !== last) {
        last?.classList.remove('now');
        el?.classList.add('now');
        if (el && playback.getSnapshot().playing) el.scrollIntoView({ block: 'nearest' });
        last = el;
      }
    };
    update();
    const unsubscribe = playback.subscribe(update);
    return () => {
      unsubscribe();
    };
  }, [words, asset.id]);

  const seekTo = (i: number) => {
    const t = sourceTimeToTimeline(store.getState().project, asset.id, words[i].start);
    if (t !== null) playback.seek(t);
  };

  const edit = (i: number) => {
    const text = prompt('Corrigir palavra:', words[i].text);
    if (text === null || !text.trim() || text.trim() === words[i].text) return;
    const next = words.map((w, k) => (k === i ? { ...w, text: text.trim() } : w));
    void transcripts.setWords(asset, next);
  };

  return (
    <>
      <div className="muted" style={{ margin: '6px 0 4px' }}>
        {words.length} palavras · {transcript.model.split('/').pop()?.replace('_timestamped', '')} · clique para ir, duplo clique para corrigir
      </div>
      <div className="transcript" ref={ref} data-testid="transcript">
        {words.length === 0 && <span className="muted">Nenhuma fala reconhecida.</span>}
        {words.map((w, i) => (
          <span key={i} data-i={i} onClick={() => seekTo(i)} onDoubleClick={() => edit(i)}>
            {w.text}{' '}
          </span>
        ))}
      </div>
    </>
  );
});

// ---------------------------------------------------------------------------

function CutsSection({ asset, analysis }: { asset: Asset; analysis: ReturnType<typeof useAnalysis> }) {
  const { project } = useEditor();
  const [level, setLevel] = useState<CutLevel>(analysis.level);
  const hasTranscript = !!transcripts.get(asset.id);
  const mine = analysis.assetId === asset.id;
  const list = mine ? analysis.suggestions : [];
  const chosen = list.filter((s) => analysis.selected.has(s.id));
  const sum = summarize(chosen);
  const fps = project.settings.fps;

  return (
    <section>
      <h4><Scissors size={12} /> Cortes automáticos</h4>
      <div className="seg">
        {LEVELS.map((l) => (
          <button key={l.id} className={`btn sm${level === l.id ? ' active' : ''}`} title={l.hint} onClick={() => setLevel(l.id)}>
            {l.label}
          </button>
        ))}
      </div>
      <button className="btn sm primary" onClick={() => void actions.analyzeCuts(asset.id, level)}>
        <Sparkles size={13} /> Encontrar cortes
      </button>
      <p className="note">
        {hasTranscript
          ? 'Usa o áudio (pausas, hesitações) e a transcrição (vícios, gagueira, frases repetidas).'
          : 'Sem transcrição, detecta só pausas pelo áudio. Transcreva para detectar erros de fala.'}
      </p>

      {mine && list.length > 0 && (
        <>
          <div className="cut-summary">
            <b>{chosen.length}</b> de {list.length} marcados · <b>{sum.seconds.toFixed(1)} s</b> a remover
            <div className="chips">
              {(Object.entries(summarize(list).counts) as [CutKind, number][]).map(([k, n]) => (
                <span key={k} className={`chip k-${k}`}>{CUT_KIND_LABEL[k]} {n}</span>
              ))}
            </div>
          </div>
          <div className="row-between">
            <label className="check">
              <input type="checkbox" checked={chosen.length === list.length} onChange={(e) => analysisStore.setAll(e.target.checked)} />
              todos
            </label>
            <button className="btn sm primary" disabled={!chosen.length} onClick={() => actions.applyCuts()} data-testid="apply-cuts">
              Aplicar {chosen.length} corte{chosen.length === 1 ? '' : 's'}
            </button>
          </div>
          <div className="cut-list">
            {list.map((s) => {
              const tl = sourceTimeToTimeline(project, asset.id, s.start);
              return (
                <div key={s.id} className={`cut-row${analysis.selected.has(s.id) ? ' on' : ''}`}>
                  <input type="checkbox" checked={analysis.selected.has(s.id)} onChange={() => analysisStore.toggle(s.id)} />
                  <button
                    className="cut-main"
                    title={tl === null ? 'Este trecho não está na timeline' : 'Ir para o trecho (1 s antes)'}
                    onClick={() => tl !== null && playback.seek(Math.max(0, tl - 1))}
                  >
                    <span className={`chip k-${s.kind}`}>{CUT_KIND_LABEL[s.kind]}</span>
                    <span className="tc">{tl === null ? '—' : formatTimecode(tl, fps).slice(3)}</span>
                    <span className="dur">{(s.end - s.start).toFixed(1)} s</span>
                    <span className="why">{s.reason}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {analysis.lastEdit && (
        <div className="edit-summary" data-testid="edit-summary">
          <b>Última edição automática</b>
          <ul>
            {(Object.entries(analysis.lastEdit.counts) as [CutKind, number][]).map(([k, n]) => (
              <li key={k}>{n}× {CUT_KIND_LABEL[k].toLowerCase()}</li>
            ))}
          </ul>
          {analysis.lastEdit.cuts} corte(s) na timeline · {analysis.lastEdit.seconds.toFixed(1)} s removidos. Ctrl+Z desfaz.
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function CaptionsSection({ asset }: { asset: Asset }) {
  const [preset, setPreset] = useState('podcast');
  const { project } = useEditor();
  const has = !!transcripts.get(asset.id);
  const count = Object.values(project.clips).filter((c) => c.caption).length;
  return (
    <section>
      <h4><Captions size={12} /> Legendas</h4>
      <div className="field wide">
        <label>Estilo</label>
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          {CAPTION_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>
      <div className="row-between">
        <button className="btn sm primary" disabled={!has} onClick={() => actions.generateCaptions(asset.id, preset)} data-testid="gen-captions">
          <Sparkles size={13} /> Gerar legendas
        </button>
        <button className="btn sm outline" disabled={!count} onClick={() => void actions.exportSRT()}>Exportar .srt</button>
      </div>
      <p className="note">
        {has
          ? `Cria uma trilha "Legendas" com cada bloco editável. Palavras com tempo próprio — o destaque acompanha a fala, mesmo depois de cortes.`
          : 'Transcreva a mídia primeiro.'}
        {count > 0 && ` ${count} legenda(s) na timeline.`}
      </p>
    </section>
  );
}

