export const EPS = 1e-6;

export function newId(prefix = ''): string {
  return prefix + crypto.randomUUID().slice(0, 8);
}

/** Arredonda um tempo para o quadro mais próximo. */
export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

export function formatTimecode(t: number, fps: number): string {
  const totalFrames = Math.max(0, Math.round(t * fps));
  const f = totalFrames % Math.round(fps);
  const totalSec = Math.floor(totalFrames / Math.round(fps));
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

export function formatDuration(t: number): string {
  if (!isFinite(t) || t <= 0) return '—';
  const s = Math.round(t);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m % 60)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** HH:MM:SS.mmm */
export function formatTimecodeMs(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
}
