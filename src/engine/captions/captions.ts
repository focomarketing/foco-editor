// Caption Engine: transforma palavras transcritas em clipes de legenda na timeline.
// Cada bloco (1–2 linhas) vira um clipe próprio, editável, que pode ser movido,
// aparado ou apagado como qualquer outro. As palavras guardam o tempo de cada uma,
// então o destaque palavra-por-palavra continua certo depois de cortes.

import type { CaptionStyle, Clip, Project, TranscriptWord } from '../../core/types';
import { DEFAULT_TRANSFORM, NO_ASSET } from '../../core/types';
import { sourceEnd, toTimeline } from '../../core/clipTime';
import { newId } from '../../core/time';
import { addClip, addTrack, clipEnd, deleteClips } from '../timeline/operations';

export interface CaptionPreset {
  id: string;
  label: string;
  style: CaptionStyle;
  maxChars: number;
  maxWords: number;
}

const base: Omit<CaptionStyle, 'preset'> = {
  fontFamily: 'Segoe UI, Arial, sans-serif',
  fontWeight: 700,
  fontSize: 0.05,
  color: '#ffffff',
  highlightColor: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 0,
  shadow: true,
  background: null,
  uppercase: false,
  y: 0.85,
  mode: 'block',
  pop: false,
};

const HEAVY = '"Arial Black", Impact, "Segoe UI Black", sans-serif';

function preset(id: string, label: string, maxChars: number, maxWords: number, s: Partial<CaptionStyle>): CaptionPreset {
  return { id, label, maxChars, maxWords, style: { ...base, ...s, preset: id } };
}

export const CAPTION_PRESETS: CaptionPreset[] = [
  preset('minimal', 'Minimal', 42, 14, { fontWeight: 600, fontSize: 0.045 }),
  preset('podcast', 'Podcast', 32, 10, { highlightColor: '#ffd400', background: 'rgba(0,0,0,0.6)', shadow: false, mode: 'karaoke', y: 0.82 }),
  preset('bold', 'Bold', 26, 6, { fontFamily: HEAVY, fontWeight: 900, fontSize: 0.06, strokeWidth: 0.14, uppercase: true, y: 0.78 }),
  preset('kinetic', 'Kinetic', 30, 4, { fontFamily: HEAVY, fontWeight: 900, fontSize: 0.09, highlightColor: '#ffe600', strokeWidth: 0.16, uppercase: true, y: 0.6, mode: 'word', pop: true }),
  preset('cinema', 'Cinema', 44, 14, { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 400, fontSize: 0.042, color: '#f0f0f0', y: 0.9 }),
  preset('social', 'Social', 22, 5, { fontFamily: HEAVY, fontWeight: 900, fontSize: 0.065, highlightColor: '#2ee86b', strokeWidth: 0.15, uppercase: true, y: 0.7, mode: 'karaoke', pop: true }),
  preset('youtube', 'YouTube', 42, 14, { fontWeight: 600, fontSize: 0.045, background: 'rgba(0,0,0,0.75)', shadow: false, y: 0.88 }),
  preset('shorts', 'Shorts', 16, 3, { fontFamily: HEAVY, fontWeight: 900, fontSize: 0.08, highlightColor: '#ffd400', strokeWidth: 0.16, uppercase: true, y: 0.65, mode: 'karaoke', pop: true }),
];

export const getPreset = (id: string) => CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[1];

/** Palavra no tempo da timeline; `limit` é o fim do clipe de mídia de onde ela veio. */
export type TimelineWord = TranscriptWord & { limit: number };

/** Palavras do asset mapeadas para o tempo da timeline, respeitando cortes e trims. */
export function timelineWords(p: Project, assetId: string, words: TranscriptWord[]): TimelineWord[] {
  const out: TimelineWord[] = [];
  for (const c of Object.values(p.clips)) {
    if (c.assetId !== assetId || c.caption) continue;
    const srcEnd = sourceEnd(c);
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid < c.sourceIn || mid >= srcEnd) continue;
      const start = Math.max(c.start, toTimeline(c, w.start));
      const end = Math.min(clipEnd(c), toTimeline(c, w.end));
      out.push({ text: w.text, start, end: Math.max(end, start + 0.05), limit: clipEnd(c) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Agrupa palavras em blocos legíveis (limite de caracteres/palavras, pausas e pontuação). */
export function segmentWords<W extends TranscriptWord>(words: W[], maxChars: number, maxWords: number): W[][] {
  const blocks: W[][] = [];
  let cur: W[] = [];
  let chars = 0;
  for (const w of words) {
    const prev = cur.at(-1);
    const breakHere =
      prev &&
      (chars + 1 + w.text.length > maxChars ||
        cur.length >= maxWords ||
        w.start - prev.end > 0.6 ||
        /[.?!…]$/.test(prev.text) ||
        w.end - cur[0].start > 5);
    if (breakHere) {
      blocks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(w);
    chars += (cur.length > 1 ? 1 : 0) + w.text.length;
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

export function buildCaptionClips(words: TimelineWord[], trackId: string, presetId: string): Clip[] {
  const pr = getPreset(presetId);
  const blocks = segmentWords(words, pr.maxChars, pr.maxWords);
  return blocks.map((block, i) => {
    const start = block[0].start;
    const next = blocks[i + 1]?.[0].start ?? Infinity;
    // Segura a legenda um pouco depois da última palavra, sem invadir a próxima.
    // ...e sem passar do fim da mídia de onde a fala veio.
    const end = Math.min(next, block.at(-1)!.limit, Math.max(block.at(-1)!.end + 0.25, start + 0.6));
    return {
      id: newId('c'),
      assetId: NO_ASSET,
      trackId,
      start,
      duration: end - start,
      sourceIn: 0,
      volume: 0,
      speed: 1,
      fadeIn: 0,
      fadeOut: 0,
      transform: { ...DEFAULT_TRANSFORM },
      caption: {
        style: { ...pr.style },
        words: block.map((w) => ({ text: w.text, start: w.start - start, end: w.end - start })),
      },
    };
  });
}

/** Texto visível de um clipe de legenda (palavras dentro do trecho aparado). */
export function captionText(c: Clip): string {
  if (!c.caption) return '';
  return c.caption.words
    .filter((w) => w.end > c.sourceIn && w.start < sourceEnd(c))
    .map((w) => w.text)
    .join(' ');
}

function srtTime(t: number) {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/** Legendas da timeline em formato SRT (trilhas visíveis). */
export function toSRT(p: Project): string {
  const hidden = new Set(p.tracks.filter((t) => t.hidden).map((t) => t.id));
  const clips = Object.values(p.clips)
    .filter((c) => c.caption && !hidden.has(c.trackId))
    .sort((a, b) => a.start - b.start);
  return clips
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(clipEnd(c))}\n${captionText(c)}\n`)
    .join('\n');
}

/** Substitui as legendas da trilha "Legendas" (criando-a se preciso). Função pura. */
export function applyCaptions(p: Project, words: TimelineWord[], presetId: string, trackName = 'Legendas'): { project: Project; count: number } {
  const existing = p.tracks.find((tr) => tr.kind === 'video' && tr.name === trackName);
  let next = p;
  let trackId = existing?.id;
  if (!trackId) {
    trackId = `t${crypto.randomUUID().slice(0, 8)}`;
    next = addTrack(next, 'video', { id: trackId, name: trackName });
  }
  const old = Object.values(next.clips).filter((c) => c.trackId === trackId && c.caption).map((c) => c.id);
  next = deleteClips(next, old);
  const clips = buildCaptionClips(words, trackId, presetId);
  for (const c of clips) next = addClip(next, c);
  return { project: next, count: clips.length };
}
