// Smart zoom: escolhe as frases mais importantes (ênfase na voz, palavras de destaque,
// exclamações/perguntas) e cria keyframes de escala que aproximam e voltam suavemente.

import type { Keyframe, TranscriptWord } from '../../core/types';
import { LEVEL_RATE, noiseProfile } from './silence';

export type ZoomIntensity = 'subtle' | 'normal' | 'strong';

const CONFIG: Record<ZoomIntensity, { share: number; zoom: number; strongZoom: number; minGap: number }> = {
  subtle: { share: 0.15, zoom: 1.06, strongZoom: 1.1, minGap: 6 },
  normal: { share: 0.25, zoom: 1.08, strongZoom: 1.15, minGap: 4 },
  strong: { share: 0.4, zoom: 1.1, strongZoom: 1.2, minGap: 2.5 },
};

const EMPHASIS = new Set([
  'nunca', 'sempre', 'muito', 'importante', 'segredo', 'verdade', 'atenção', 'cuidado', 'erro', 'mentira',
  'principal', 'melhor', 'pior', 'jamais', 'todos', 'ninguém', 'agora', 'hoje', 'grande', 'incrível',
  'never', 'always', 'secret', 'truth', 'important', 'best', 'worst',
]);

export interface Sentence {
  start: number;
  end: number;
  text: string;
  score: number;
}

export function sentencesOf(words: TranscriptWord[]): Omit<Sentence, 'score'>[] {
  const out: Omit<Sentence, 'score'>[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => {
    if (cur.length) out.push({ start: cur[0].start, end: cur.at(-1)!.end, text: cur.map((w) => w.text).join(' ') });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && w.start - cur.at(-1)!.end > 0.7) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return out;
}

function meanDb(levels: Float32Array, a: number, b: number) {
  const i0 = Math.max(0, Math.floor(a * LEVEL_RATE));
  const i1 = Math.min(levels.length, Math.ceil(b * LEVEL_RATE));
  let sum = 0;
  let n = 0;
  for (let i = i0; i < i1; i++) {
    if (levels[i] > -90) {
      sum += levels[i];
      n++;
    }
  }
  return n ? sum / n : -100;
}

export function scoreSentences(words: TranscriptWord[], levels: Float32Array | null): Sentence[] {
  const speech = levels ? noiseProfile(levels).speechDb : 0;
  return sentencesOf(words).map((s) => {
    let score = 0;
    if (levels) score += (meanDb(levels, s.start, s.end) - (speech - 6)) * 0.4; // fala mais forte que o normal
    const tokens = s.text.toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}]/gu, ''));
    score += tokens.filter((t) => EMPHASIS.has(t)).length * 1.5;
    if (/!/.test(s.text)) score += 2;
    if (/\?/.test(s.text)) score += 1;
    if (s.end - s.start < 1.2) score -= 3; // curta demais para um zoom confortável
    return { ...s, score };
  });
}

/** Keyframes de escala (tempo da mídia) para os momentos escolhidos. */
export function smartZoomKeyframes(words: TranscriptWord[], levels: Float32Array | null, intensity: ZoomIntensity): { keyframes: Keyframe[]; moments: Sentence[] } {
  const cfg = CONFIG[intensity];
  const scored = scoreSentences(words, levels).filter((s) => s.end - s.start >= 1.2);
  if (!scored.length) return { keyframes: [], moments: [] };
  const want = Math.max(1, Math.round(scored.length * cfg.share));
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const chosen: Sentence[] = [];
  for (const s of ranked) {
    if (chosen.length >= want) break;
    if (chosen.some((c) => s.start < c.end + cfg.minGap && s.end > c.start - cfg.minGap)) continue;
    chosen.push(s);
  }
  chosen.sort((a, b) => a.start - b.start);
  const strongCut = [...chosen].sort((a, b) => b.score - a.score)[Math.floor(chosen.length / 3)]?.score ?? Infinity;

  const kfs: Keyframe[] = [];
  for (const s of chosen) {
    const z = s.score > strongCut ? cfg.strongZoom : cfg.zoom;
    const inAt = Math.max(0, s.start - 0.1);
    kfs.push({ t: inAt, v: 1, ease: 'easeInOut' });
    kfs.push({ t: inAt + 0.4, v: z, ease: 'linear' });
    kfs.push({ t: s.end, v: z, ease: 'easeInOut' });
    kfs.push({ t: s.end + 0.6, v: 1, ease: 'linear' });
  }
  return { keyframes: kfs, moments: chosen };
}
