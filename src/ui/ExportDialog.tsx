import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes, formatDuration } from '../core/time';
import { media, store } from '../app/editor';
import { EXPORT_PRESETS, exportProblems, exportProject, supportedVideoCodecs } from '../engine/export/ExportEngine';
import type { ExportProgress, VideoCodecChoice } from '../engine/export/ExportEngine';
import { downloadBlob, fsAccessSupported, isAbort, pickSaveFile } from '../engine/platform/fs';
import { projectDuration } from '../engine/timeline/operations';
import { useEditor, useMediaVersion } from './hooks';
import { jobs } from '../engine/jobs/JobQueue';
import { metrics } from '../engine/diagnostics/metrics';
import { notify } from '../app/notify';

const QUALITY = [
  { id: 'std', label: 'Padrão', k: 1 },
  { id: 'high', label: 'Alta', k: 1.6 },
  { id: 'web', label: 'Leve (web)', k: 0.55 },
];

type Phase =
  | { kind: 'config' }
  | { kind: 'running'; progress: ExportProgress | null }
  | { kind: 'done'; seconds: number; fileName: string; size: number | null }
  | { kind: 'error'; message: string };

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { project } = useEditor();
  useMediaVersion();
  const seqPreset = `seq`;
  const [presetId, setPresetId] = useState(() => {
    const match = EXPORT_PRESETS.find((p) => p.width === project.settings.width && p.height === project.settings.height);
    return match?.id ?? seqPreset;
  });
  const [quality, setQuality] = useState('std');
  const [codec, setCodec] = useState<VideoCodecChoice>('avc');
  const [codecs, setCodecs] = useState<VideoCodecChoice[] | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'config' });
  const jobRef = useRef<string | null>(null);

  const preset = EXPORT_PRESETS.find((p) => p.id === presetId);
  const width = preset?.width ?? project.settings.width;
  const height = preset?.height ?? project.settings.height;
  const baseBitrate = preset?.bitrate ?? Math.round(width * height * project.settings.fps * 0.19);
  const bitrate = Math.round(baseBitrate * (QUALITY.find((q) => q.id === quality)?.k ?? 1));
  const duration = projectDuration(project);
  const problems = useMemo(() => exportProblems(project, media), [project]);

  useEffect(() => {
    let alive = true;
    void supportedVideoCodecs(width, height, bitrate).then((list) => {
      if (!alive) return;
      setCodecs(list);
      setCodec((c) => (list.includes(c) || !list.length ? c : list[0]));
    });
    return () => {
      alive = false;
    };
  }, [width, height, bitrate]);

  const start = async () => {
    const p = store.getState().project;
    const fileName = `${p.name}.mp4`;
    let handle: FileSystemFileHandle | null = null;
    let writable: FileSystemWritableFileStream | null = null;
    try {
      if (fsAccessSupported) {
        handle = await pickSaveFile(fileName, [{ description: 'Vídeo MP4', accept: { 'video/mp4': ['.mp4'] } }], 'foco-export');
        writable = await handle.createWritable();
      }
    } catch (e) {
      if (!isAbort(e)) setPhase({ kind: 'error', message: String(e) });
      return;
    }

    setPhase({ kind: 'running', progress: null });
    const t0 = performance.now();
    const outName = handle?.name ?? fileName;
    // O export é um job da fila: continua se o diálogo for fechado, aparece no painel
    // de tarefas e pode ser cancelado de lá. Vários exports entram em fila.
    const job = jobs.add({ type: 'export', label: `Export ${width}×${height} ${codec === 'avc' ? 'H.264' : 'H.265'} · ${outName}`, priority: 'high' }, (ctx) =>
      exportProject(
        p,
        media,
        { width, height, fps: p.settings.fps, bitrate, codec },
        writable ? { kind: 'stream', writable } : { kind: 'buffer' },
        (progress) => {
          ctx.progress(progress.frame / progress.totalFrames, `${progress.speed.toFixed(0)} qps`);
          setPhase({ kind: 'running', progress });
        },
        ctx.signal,
      ),
    );
    jobRef.current = job.id;
    try {
      const result = await job.done;
      metrics.record('export', outName, performance.now() - t0, projectDuration(p));
      let size: number | null = null;
      if (result.blob) {
        downloadBlob(result.blob, fileName);
        size = result.blob.size;
      } else if (handle) {
        size = (await handle.getFile()).size;
      }
      setPhase({ kind: 'done', seconds: (performance.now() - t0) / 1000, fileName: outName, size });
      notify(`Export concluído: ${outName}${size !== null ? ` (${formatBytes(size)})` : ''}.`, 'success', 8000);
    } catch (e) {
      const removable = handle as (FileSystemFileHandle & { remove?: () => Promise<void> }) | null;
      await removable?.remove?.().catch(() => {});
      if (isAbort(e) || (e instanceof Error && e.name === 'AbortError')) setPhase({ kind: 'config' });
      else {
        setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
        notify(`O export de ${outName} falhou: ${e instanceof Error ? e.message : String(e)}`, 'error', 10000);
      }
    } finally {
      jobRef.current = null;
    }
  };

  const running = phase.kind === 'running';
  const prog = phase.kind === 'running' ? phase.progress : null;
  const pct = prog ? (prog.frame / prog.totalFrames) * 100 : 0;
  const eta = prog && prog.speed > 0 ? (prog.totalFrames - prog.frame) / prog.speed : null;

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Exportar">
        <div className="dialog-head">Exportar vídeo</div>
        <div className="dialog-body">
          {phase.kind === 'config' && (
            <>
              <div className="field">
                <label>Preset</label>
                <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                  {EXPORT_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label} · {p.width}×{p.height}</option>
                  ))}
                  <option value={seqPreset}>Igual à sequência · {project.settings.width}×{project.settings.height}</option>
                </select>
              </div>
              <div className="field">
                <label>Qualidade</label>
                <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                  {QUALITY.map((q) => (
                    <option key={q.id} value={q.id}>{q.label} · {(Math.round(baseBitrate * q.k / 1e5) / 10).toFixed(1)} Mbps</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Codec</label>
                <select value={codec} onChange={(e) => setCodec(e.target.value as VideoCodecChoice)} disabled={!codecs?.length}>
                  {(codecs ?? ['avc']).map((c) => (
                    <option key={c} value={c}>{c === 'avc' ? 'H.264 (MP4)' : 'H.265 / HEVC (MP4)'}</option>
                  ))}
                </select>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {formatDuration(duration)} · {project.settings.fps} fps · áudio AAC 48 kHz estéreo. Renderização local, nada é
                enviado para a internet.
                {codecs && !codecs.includes('hevc') && ' H.265 não está disponível neste navegador/GPU.'}
              </p>
              {codecs?.length === 0 && <ul className="problems"><li>Este navegador não consegue codificar vídeo nesta resolução.</li></ul>}
              {problems.length > 0 && (
                <ul className="problems">
                  {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
            </>
          )}

          {running && (
            <>
              <div className="progress"><div style={{ width: `${pct}%` }} /></div>
              <div className="muted" data-testid="export-progress">
                {prog
                  ? `Quadro ${prog.frame} de ${prog.totalFrames} · ${pct.toFixed(1)}% · ${prog.speed.toFixed(1)} qps · restante ~${formatDuration(eta ?? 0)}`
                  : 'Preparando encoder…'}
              </div>
            </>
          )}

          {phase.kind === 'done' && (
            <div>
              <b>Exportado:</b> {phase.fileName}
              <div className="muted">
                {phase.size !== null && `${formatBytes(phase.size)} · `}em {formatDuration(phase.seconds)}
              </div>
            </div>
          )}

          {phase.kind === 'error' && (
            <>
              <ul className="problems"><li>O export falhou: {phase.message}</li></ul>
              <p className="muted" style={{ margin: 0 }}>O arquivo parcial foi descartado. Você pode tentar de novo ou mudar preset/codec.</p>
            </>
          )}
        </div>
        <div className="dialog-foot">
          {running ? (
            <>
              <button className="btn outline" onClick={() => jobRef.current && jobs.cancel(jobRef.current)}>Cancelar export</button>
              <button className="btn primary" onClick={onClose} title="O export continua; acompanhe em Tarefas">Continuar em segundo plano</button>
            </>
          ) : (
            <>
              <button className="btn outline" onClick={onClose}>{phase.kind === 'done' ? 'Fechar' : 'Cancelar'}</button>
              {phase.kind === 'error' && (
                <button className="btn outline" onClick={() => setPhase({ kind: 'config' })}>Ajustar configurações</button>
              )}
              {phase.kind !== 'done' && (
                <button className="btn primary" disabled={problems.length > 0 || !codecs?.length} onClick={() => void start()} data-testid="export-start">
                  {phase.kind === 'error' ? 'Tentar de novo' : 'Exportar'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
