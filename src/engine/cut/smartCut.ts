// Smart Cut: plano de cortes de uma fala na ordem da timeline.
//
// - Bordas pela onda: o Whisper erra o início/fim das palavras em até ~0,3 s; cada palavra
//   é ajustada ao nível RMS real (início = primeira energia, fim = onde o som realmente cai),
//   para o corte nunca morder uma sílaba.
// - Ritmo por modo (natural / dinâmico / seco): quanto de pausa fica entre as frases, e
//   pausas de ênfase (antes de uma pergunta ou de uma frase forte) podem ser preservadas.
// - Erros: vícios ("ééé"), gagueira ("eu eu"), começos falsos e frases ditas de novo
//   (inclusive em outro take colocado em sequência): fica a versão mais limpa e completa.
//
// Funções puras: entram palavras (com tempo da timeline e da mídia) e níveis de áudio;
// sai a lista de trechos a remover, em tempo da timeline. Nada é aplicado aqui.

import { isFiller, normalizeWord } from '../analysis/cuts';
import { LEVEL_RATE, noiseProfile } from '../analysis/silence';

export type CutMode = 'natural' | 'dynamic' | 'dry';
export type SmartCutKind = 'pause' | 'filler' | 'stutter' | 'falseStart' | 'retake';

export const SMART_CUT_LABEL: Record<SmartCutKind, string> = {
  pause: 'Pausa',
  filler: 'Vício de linguagem',
  stutter: 'Gagueira',
  falseStart: 'Começo falso',
  retake: 'Frase repetida',
};

export interface ModeConfig {
  /** Pausa máxima entre palavras (s); acima disso a pausa é encurtada. */
  maxPause: number;
  /** Quanto de pausa fica depois de encurtar (s). */
  keepPause: number;
  /** Pausa preservada antes de uma pergunta ou frase forte (s); 0 desliga. */
  emphasisPause: number;
}

export const CUT_MODES: Record<CutMode, ModeConfig & { label: string; hint: string }> = {
  natural: { label: 'Natural', hint: 'mantém respiração e pausas de ênfase · ensaio, aula, teologia', maxPause: 0.75, keepPause: 0.45, emphasisPause: 1.1 },
  dynamic: { label: 'Dinâmico', hint: 'tira o que sobra sem correr · YouTube', maxPause: 0.38, keepPause: 0.24, emphasisPause: 0.6 },
  dry: { label: 'Seco', hint: 'emenda frase com frase · Reels, Shorts, anúncio', maxPause: 0.2, keepPause: 0.1, emphasisPause: 0 },
};

export interface SmartCutOptions {
  mode: CutMode;
  pauses: boolean;
  fillers: boolean;
  stutters: boolean;
  /** Começos falsos e frases repetidas (melhor tomada). */
  retakes: boolean;
  /** Preserva pausas de ênfase (modos natural e dinâmico). */
  keepEmphasis: boolean;
}

export const DEFAULT_OPTIONS: SmartCutOptions = { mode: 'natural', pauses: true, fillers: true, stutters: true, retakes: true, keepEmphasis: true };

/** Palavra na timeline, com a origem para consultar a onda. */
export interface TlWord {
  text: string;
  /** Tempo na timeline (s). */
  start: number;
  end: number;
  /** Mídia e tempo de origem (s), para medir a onda. */
  assetId: string;
  srcStart: number;
  srcEnd: number;
  /** Índice do clipe de onde a palavra veio (palavras de clipes diferentes nunca viram "pausa"). */
  seg: number;
}

export interface SmartCut {
  id: string;
  kind: SmartCutKind;
  /** Trecho a remover, em tempo da timeline. */
  start: number;
  end: number;
  reason: string;
  text?: string;
}

export interface SmartCutResult {
  cuts: SmartCut[];
  /** Segundos removidos se tudo for aplicado. */
  removed: number;
}

// --- bordas pela onda --------------------------------------------------------------

interface Wave {
  levels: Float32Array;
  threshold: number;
}

const SEARCH = 0.35; // quanto procurar além do tempo do Whisper
const PRE_ROLL = 0.03; // respiro antes do primeiro som
const TAIL = 0.05; // cauda depois do último som (consoantes finais fracas)
const QUIET_RUN = 0.04; // silêncio contínuo que confirma o fim de uma palavra

const lvl = (w: Wave, t: number) => w.levels[Math.min(w.levels.length - 1, Math.max(0, Math.round(t * LEVEL_RATE)))] ?? -100;

/** Fim real da palavra: a partir do fim do Whisper, o primeiro ponto com silêncio contínuo. */
export function refineEnd(w: Wave, t: number, limit: number): number {
  const stop = Math.min(limit, t + SEARCH);
  const run = Math.round(QUIET_RUN * LEVEL_RATE);
  for (let x = Math.max(0, t - 0.1); x < stop; x += 1 / LEVEL_RATE) {
    let quiet = true;
    for (let k = 0; k < run && quiet; k++) quiet = lvl(w, x + k / LEVEL_RATE) < w.threshold;
    if (quiet) return Math.min(limit, Math.max(t - 0.1, x) + TAIL);
  }
  return stop;
}

/** Início real da palavra: voltando do início do Whisper, onde a energia começa. */
export function refineStart(w: Wave, t: number, limit: number): number {
  const stop = Math.max(limit, t - SEARCH);
  let onset = t;
  for (let x = t; x > stop; x -= 1 / LEVEL_RATE) {
    if (lvl(w, x) >= w.threshold) onset = x;
    else if (onset - x > QUIET_RUN) break;
  }
  return Math.max(limit, onset - PRE_ROLL);
}

/** Ajusta início e fim de cada palavra à onda, sem invadir a vizinha. */
export function refineWords(words: TlWord[], waves: Map<string, Wave>): TlWord[] {
  const out = words.map((w) => ({ ...w }));
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    const wave = waves.get(w.assetId);
    if (!wave) continue;
    const prev = out[i - 1];
    const next = words[i + 1];
    const sameSegPrev = prev && prev.seg === w.seg;
    const sameSegNext = next && next.seg === w.seg;
    const loS = sameSegPrev ? prev.srcEnd : w.srcStart - SEARCH;
    const hiE = sameSegNext ? next.srcStart : w.srcEnd + SEARCH;
    const s = refineStart(wave, w.srcStart, loS);
    const e = Math.max(s + 0.04, refineEnd(wave, w.srcEnd, hiE));
    // tempo da timeline acompanha a mudança na origem (velocidade 1 por clipe de fala)
    w.start += s - w.srcStart;
    w.end += e - w.srcEnd;
    w.srcStart = s;
    w.srcEnd = e;
  }
  return out;
}

// --- frases ------------------------------------------------------------------------

interface Sentence {
  first: number; // índice da primeira palavra
  last: number; // índice da última palavra
  tokens: string[];
  complete: boolean; // termina em pontuação
}

function sentencesOf(words: TlWord[]): Sentence[] {
  const out: Sentence[] = [];
  let first = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const endsHere = /[.!?…]$/.test(w.text.trim()) || !next || next.seg !== w.seg || next.start - w.end > 0.8;
    if (endsHere) {
      const tokens = words.slice(first, i + 1).map((x) => normalizeWord(x.text).norm).filter(Boolean);
      out.push({ first, last: i, tokens, complete: /[.!?…]$/.test(w.text.trim()) });
      first = i + 1;
    }
  }
  return out;
}

/** Semelhança entre frases: maior subsequência comum / tamanho da maior (0..1). */
export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length] / Math.max(a.length, b.length);
}

/** Qualidade de uma tomada: completa, sem vícios/gagueira, sem buracos longos. */
function takeScore(s: Sentence, words: TlWord[]): number {
  let score = s.complete ? 3 : 0;
  for (let i = s.first; i <= s.last; i++) {
    if (isFiller(words[i].text)) score -= 1;
    if (i > s.first && normalizeWord(words[i].text).norm === normalizeWord(words[i - 1].text).norm) score -= 1;
    if (i > s.first && words[i].start - words[i - 1].end > 0.9) score -= 0.5;
  }
  return score;
}

const STRONG = new Set(['nunca', 'sempre', 'verdade', 'mentira', 'deus', 'morte', 'vida', 'nada', 'tudo', 'jamais', 'ninguém', 'importante', 'problema', 'segredo', 'porque', 'mas']);

/** A frase que começa no índice i merece uma pausa de ênfase antes? */
function emphasisBefore(words: TlWord[], i: number, sentences: Sentence[]): boolean {
  const s = sentences.find((x) => x.first === i);
  if (!s) return false;
  const text = words.slice(s.first, s.last + 1).map((w) => w.text).join(' ');
  if (/\?\s*$/.test(text)) return true; // vem uma pergunta
  if (/[!…]\s*$/.test(text)) return true;
  const prevEnd = words[i - 1]?.text.trim() ?? '';
  if (/[?…]$/.test(prevEnd)) return true; // depois de uma pergunta, deixa respirar
  return s.tokens.slice(0, 4).some((t) => STRONG.has(t));
}

// --- plano -------------------------------------------------------------------------

export function planSmartCuts(rawWords: TlWord[], waves: Map<string, Float32Array>, opts: SmartCutOptions = DEFAULT_OPTIONS): SmartCutResult {
  const waveMap = new Map<string, Wave>();
  for (const [id, levels] of waves) waveMap.set(id, { levels, threshold: noiseProfile(levels).thresholdDb });
  const words = refineWords([...rawWords].sort((a, b) => a.start - b.start), waveMap);
  const cfg = CUT_MODES[opts.mode];
  const sentences = sentencesOf(words);
  const cuts: SmartCut[] = [];
  let n = 0;
  const add = (kind: SmartCutKind, start: number, end: number, reason: string, text?: string) => {
    if (end - start >= 0.06) cuts.push({ id: `k${n++}`, kind, start, end, reason, text });
  };
  const removedWord = new Set<number>();

  // 1. Melhor tomada: começos falsos e frases repetidas (até 3 frases à frente).
  if (opts.retakes) {
    for (let a = 0; a < sentences.length; a++) {
      const A = sentences[a];
      if (A.tokens.length < 2 || removedWord.has(A.first)) continue;
      for (let b = a + 1; b <= Math.min(sentences.length - 1, a + 3); b++) {
        const B = sentences[b];
        const head = Math.min(3, A.tokens.length, B.tokens.length);
        const sameStart = head >= 2 && A.tokens.slice(0, head).join(' ') === B.tokens.slice(0, head).join(' ');
        const sim = similarity(A.tokens, B.tokens);
        let drop: Sentence | null = null;
        let kind: SmartCutKind = 'retake';
        if (sameStart && A.tokens.length < B.tokens.length * 0.8) {
          drop = A; // abandonou no meio e recomeçou
          kind = 'falseStart';
        } else if (sim >= 0.75) {
          // disse de novo: fica a melhor; empate, fica a última (a "tomada boa" costuma vir depois)
          drop = takeScore(A, words) > takeScore(B, words) ? B : A;
        }
        if (!drop) continue;
        const end = drop === A ? words[sentences[a + 1]?.first ?? A.last].start : words[drop.last].end;
        const start = words[drop.first].start;
        const text = words.slice(drop.first, drop.last + 1).map((w) => w.text.trim()).join(' ');
        add(kind, start, drop === A ? end : Math.min(end, words[drop.last + 1]?.start ?? end), kind === 'falseStart' ? 'recomeçou a frase' : 'a mesma frase foi dita de novo; ficou a tomada mais limpa', text);
        for (let i = drop.first; i <= drop.last; i++) removedWord.add(i);
        break;
      }
    }
  }

  // 2. Vícios e gagueira.
  for (let i = 0; i < words.length; i++) {
    if (removedWord.has(i)) continue;
    const w = words[i];
    const next = words[i + 1];
    if (opts.fillers && isFiller(w.text)) {
      const end = next && next.seg === w.seg ? next.start : w.end;
      add('filler', w.start, end, `"${w.text.trim()}"`, w.text.trim());
      removedWord.add(i);
      continue;
    }
    if (opts.stutters && next && next.seg === w.seg && !removedWord.has(i + 1)) {
      const a = normalizeWord(w.text).norm;
      if (a && a === normalizeWord(next.text).norm && next.start - w.end < 0.8) {
        add('stutter', w.start, next.start, `"${w.text.trim()} ${next.text.trim()}"`, w.text.trim());
        removedWord.add(i);
      }
    }
  }

  // 3. Pausas entre palavras que ficam (encurtadas, não zeradas).
  if (opts.pauses) {
    const kept = words.map((w, i) => ({ w, i })).filter((x) => !removedWord.has(x.i));
    for (let k = 1; k < kept.length; k++) {
      const prev = kept[k - 1].w;
      const cur = kept[k].w;
      if (prev.seg !== cur.seg) continue; // entre clipes a emenda já existe
      const gap = cur.start - prev.end;
      const emphasis = opts.keepEmphasis && cfg.emphasisPause > 0 && emphasisBefore(words, kept[k].i, sentences);
      const allowed = emphasis ? cfg.emphasisPause : cfg.maxPause;
      if (gap <= allowed) continue;
      const keep = emphasis ? cfg.emphasisPause * 0.8 : cfg.keepPause;
      const a = prev.end + keep / 2;
      const b = cur.start - keep / 2;
      add('pause', a, b, `${gap.toFixed(1).replace('.', ',')} s de pausa${emphasis ? ' (ênfase: mantive mais)' : ''}`);
    }
  }

  const merged = mergeCuts(cuts);
  return { cuts: merged, removed: merged.reduce((s, c) => s + (c.end - c.start), 0) };
}

const PRIORITY: Record<SmartCutKind, number> = { retake: 5, falseStart: 5, stutter: 4, filler: 3, pause: 1 };

function mergeCuts(list: SmartCut[]): SmartCut[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: SmartCut[] = [];
  for (const c of sorted) {
    const last = out.at(-1);
    if (last && c.start <= last.end + 0.02) {
      const keep = PRIORITY[c.kind] > PRIORITY[last.kind] ? c : last;
      out[out.length - 1] = { ...keep, id: last.id, start: last.start, end: Math.max(last.end, c.end) };
    } else out.push({ ...c });
  }
  return out;
}

// --- conferência depois de aplicar -----------------------------------------------------

export interface CutCheck {
  /** Pausas que ainda passam do limite do modo (na timeline). */
  longPauses: { at: number; seconds: number }[];
  /** Emendas onde ainda há som de fala (risco de palavra mordida). */
  riskySplices: number[];
}

/** Confere a fala já cortada: pausas acima do modo e emendas no meio de som. */
export function checkCut(words: TlWord[], mode: CutMode, spliceTimes: number[], soundAt: (t: number) => boolean): CutCheck {
  const cfg = CUT_MODES[mode];
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const longPauses: CutCheck['longPauses'] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].start - sorted[i - 1].end;
    if (gap > Math.max(cfg.maxPause, cfg.emphasisPause) + 0.15) longPauses.push({ at: sorted[i - 1].end, seconds: gap });
  }
  return { longPauses, riskySplices: spliceTimes.filter((t) => soundAt(t - 0.02) && soundAt(t + 0.02)) };
}

