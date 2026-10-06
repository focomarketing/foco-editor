import { useEffect, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { metrics } from '../engine/diagnostics/metrics';
import { jobs } from '../engine/jobs/JobQueue';
import { playback } from '../app/editor';
import { prefsStore } from '../app/prefs';

const KINDS: [string, string][] = [
  ['import', 'Importação (metadados)'],
  ['thumbnail', 'Thumbnails'],
  ['preview-thumbs', 'Thumbnails de scrubbing'],
  ['waveform', 'Waveform'],
  ['proxy', 'Proxy'],
  ['export', 'Export'],
];

/** Painel de diagnóstico (desenvolvimento): FPS, quadros perdidos, travadas, memória, tempos. */
export function PerformancePanel() {
  useSyncExternalStore(metrics.subscribe, metrics.getVersion);
  useSyncExternalStore(jobs.subscribe, jobs.getVersion);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      // Quadros perdidos pelo decodificador dos <video> do preview.
      let dropped = 0;
      for (const el of (playback as unknown as { pool: Map<string, HTMLMediaElement> }).pool.values()) {
        if (el instanceof HTMLVideoElement) dropped += el.getVideoPlaybackQuality().droppedVideoFrames;
      }
      metrics.droppedFrames = dropped;
      tick((n) => n + 1);
    }, 500);
    return () => window.clearInterval(id);
  }, []);
  const mem = metrics.memory();
  const rate = (k: string) => {
    const t = metrics.last(k);
    if (!t) return '—';
    const speed = t.mediaSeconds ? ` · ${(t.mediaSeconds / (t.ms / 1000)).toFixed(0)}× tempo real` : '';
    return `${t.ms < 1000 ? `${Math.round(t.ms)} ms` : `${(t.ms / 1000).toFixed(1)} s`}${speed}`;
  };

  return (
    <div className="perf-panel" data-testid="perf-panel">
      <div className="row-between">
        <b>Performance</b>
        <button className="btn icon sm" onClick={() => prefsStore.set({ showPerformancePanel: false })} title="Fechar (Ctrl+Shift+P)"><X size={12} /></button>
      </div>
      <table>
        <tbody>
          <tr><td>Preview</td><td>{metrics.previewFps} qps</td></tr>
          <tr><td>Quadros perdidos</td><td>{metrics.droppedFrames}</td></tr>
          <tr><td>Travadas (&gt;50 ms)</td><td>{metrics.longTasks} · máx {Math.round(metrics.maxLongTaskMs)} ms</td></tr>
          <tr><td>Memória JS</td><td>{mem ? `${mem.usedMB.toFixed(0)} MB` : 'indisponível'}</td></tr>
          <tr><td>Tarefas ativas</td><td>{jobs.active.length}</td></tr>
          {KINDS.map(([k, label]) => (
            <tr key={k}><td>{label}</td><td>{rate(k)}</td></tr>
          ))}
          <tr><td>CPU / GPU</td><td className="muted">não expostos ao navegador</td></tr>
        </tbody>
      </table>
      <button className="btn sm" onClick={() => metrics.resetCounters()}>Zerar contadores</button>
    </div>
  );
}
