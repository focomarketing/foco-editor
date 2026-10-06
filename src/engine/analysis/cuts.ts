// Sugestões de corte a partir do áudio (silêncio) e, quando existe, da transcrição
// (vícios de linguagem, gagueira, frases repetidas, hesitações). Tudo em tempo da
// mídia de origem. Nada é aplicado aqui: o usuário revisa e escolhe o que cortar.

import type { TranscriptWord } from '../../core/types';
import type { Range } from '../timeline/operations';
import { LEVEL_RATE, detectSilences, noiseProfile, quietFraction } from './silence';

export type CutLevel = 'safe' | 'balanced' | 'aggressive';
export type CutKind = 'silence' | 'filler' | 'stutter' | 'repeat' | 'hesitation';

export interface CutSuggestion {
  id: string;
  kind: CutKind;
  start: number;
  end: number;
  text?: string;
  reason: string;
}

interface LevelConfig {
  minSilence: number;
  /** Respiro mantido em cada lado do silêncio cortado. */
  pad: number;
  allStutters: boolean;
  repeats: boolean;
  /** Intervalo mínimo entre palavras, com som, para virar "hesitação"; null desliga. */
  hesitation: number | null;
}

export const CUT_LEVELS: Record<CutLevel, LevelConfig> = {
  safe: { minSilence: 1.0, pad: 0.25, allStutters: false, repeats: false, hesitation: null },
  balanced: { minSilence: 0.6, pad: 0.15, allStutters: true, repeats: true, hesitation: 0.6 },
  aggressive: { minSilence: 0.35, pad: 0.08, allStutters: true, repeats: true, hesitation: 0.35 },
};

export const CUT_KIND_LABEL: Record<CutKind, string> = {
  silence: 'Pausa',
  filler: 'Vício de linguagem',
  stutter: 'Gagueira',
  repeat: 'Frase repetida',
  hesitation: 'Hesitação',
};

// "um" e "é" sozinhos são palavras comuns em português: só contam como vício se alongados.
const FILLERS = new Set(['ahn', 'ahm', 'hã', 'hum', 'hmm', 'hm', 'uhm', 'eh', 'éh', 'ãh', 'ah', 'ã', 'uh']);
const ELONGATED_FILLERS = new Set(['é', 'e', 'a', 'o', 'u', 'ã']);

/** minúsculas, sem pontuação, letras repetidas colapsadas ("ééé" -> "é"). */
export function normalizeWord(text: string): { norm: string; elongated: boolean } {
  const letters = text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');
  const collapsed = letters.replace(/(\p{L})\1+/gu, '$1');
  return { norm: collapsed, elongated: collapsed.length < letters.length };
}

export function isFiller(text: string): boolean {
  const { norm, elongated } = normalizeWord(text);
  if (!norm) return false;
  return FILLERS.has(norm) || (elongated && ELONGATED_FILLERS.has(norm));
}

export interface SuggestInput {
  levels: Float32Array | null;
  duration: number;
  words: TranscriptWord[] | null;
  level: CutLevel;
}

export function suggestCuts({ levels, duration, words, level }: SuggestInput): CutSuggestion[] {
  const cfg = CUT_LEVELS[level];
  const found: CutSuggestion[] = [];
  let n = 0;
  const add = (kind: CutKind, start: number, end: number, reason: string, text?: string) => {
    const s = Math.max(0, start);
    const e = Math.min(duration, end);
    if (e - s >= 0.08) found.push({ id: `s${n++}`, kind, start: s, end: e, reason, text });
  };
  const ws = words ?? [];
  const profile = levels ? noiseProfile(levels) : null;

  // 1. Pausas (áudio)
  if (levels && profile) {
    for (const [a, b] of detectSilences(levels, profile.thresholdDb, cfg.minSilence, LEVEL_RATE)) {
      // Se a transcrição tem palavra dentro do "silêncio" (fala baixa), preserva a palavra.
      for (const [s, e] of subtractWords([a + cfg.pad, b - cfg.pad], ws)) {
        add('silence', s, e, `${(b - a).toFixed(1)} s sem fala`);
      }
    }
  }

  if (ws.length) {
    const norm = ws.map((w) => normalizeWord(w.text).norm);

    // 2. Vícios de linguagem
    ws.forEach((w, i) => {
      if (!isFiller(w.text)) return;
      const next = ws[i + 1];
      const end = next ? Math.min(next.start, w.end + 0.3) : w.end;
      add('filler', w.start, end, `"${w.text.trim()}"`, w.text.trim());
    });

    // 3. Frases repetidas / começo falso ("hoje eu quero, hoje eu quero falar")
    const covered = new Set<number>();
    if (cfg.repeats) {
      for (let i = 0; i < ws.length; i++) {
        for (let len = 6; len >= 2; len--) {
          if (i + 2 * len > ws.length) continue;
          let same = true;
          for (let k = 0; k < len && same; k++) same = !!norm[i + k] && norm[i + k] === norm[i + len + k];
          if (!same) continue;
          const text = ws.slice(i, i + len).map((w) => w.text.trim()).join(' ');
          add('repeat', ws[i].start, ws[i + len].start, `repetiu "${text}"`, text);
          for (let k = i; k < i + len; k++) covered.add(k);
          i += len - 1;
          break;
        }
      }
    }

    // 4. Gagueira: mesma palavra duas vezes seguidas ("eu eu")
    for (let i = 0; i + 1 < ws.length; i++) {
      if (covered.has(i) || !norm[i] || norm[i] !== norm[i + 1]) continue;
      if (ws[i + 1].start - ws[i].end > 0.8) continue;
      if (!cfg.allStutters && norm[i].length > 3) continue;
      add('stutter', ws[i].start, ws[i + 1].start, `"${ws[i].text.trim()} ${ws[i + 1].text.trim()}"`, ws[i].text.trim());
    }

    // 5. Hesitação: buraco entre palavras com som (provável "ééé" que o Whisper omitiu)
    if (cfg.hesitation !== null && levels && profile) {
      for (let i = 0; i + 1 < ws.length; i++) {
        const a = ws[i].end;
        const b = ws[i + 1].start;
        if (b - a < cfg.hesitation) continue;
        if (quietFraction(levels, profile.thresholdDb, a, b) > 0.5) continue; // é pausa, já tratada acima
        add('hesitation', a + cfg.pad / 2, b - cfg.pad / 2, `${(b - a).toFixed(1)} s de som sem fala reconhecida`);
      }
    }
  }

  return mergeSuggestions(found);
}

/** Tira de um intervalo os trechos ocupados por palavras. */
function subtractWords([a, b]: Range, words: TranscriptWord[]): Range[] {
  let parts: Range[] = b - a > 0 ? [[a, b]] : [];
  for (const w of words) {
    if (w.end <= a || w.start >= b) continue;
    parts = parts.flatMap(([s, e]): Range[] => {
      if (w.end <= s || w.start >= e) return [[s, e]];
      const out: Range[] = [];
      if (w.start > s) out.push([s, w.start]);
      if (w.end < e) out.push([w.end, e]);
      return out;
    });
  }
  return parts;
}

const PRIORITY: Record<CutKind, number> = { repeat: 5, stutter: 4, filler: 3, hesitation: 2, silence: 1 };

/** Une sugestões sobrepostas, mantendo o tipo mais específico. */
function mergeSuggestions(list: CutSuggestion[]): CutSuggestion[] {
  const sorted = [...list].sort((x, y) => x.start - y.start);
  const out: CutSuggestion[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.start <= last.end + 0.02) {
      const keep = PRIORITY[s.kind] > PRIORITY[last.kind] ? s : last;
      out[out.length - 1] = { ...keep, id: last.id, start: last.start, end: Math.max(last.end, s.end) };
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

export function summarize(list: CutSuggestion[]) {
  const counts: Partial<Record<CutKind, number>> = {};
  let seconds = 0;
  for (const s of list) {
    counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    seconds += s.end - s.start;
  }
  return { counts, seconds };
}
