// Caption Engine: transforma palavras transcritas em clipes de legenda na timeline.
// Cada bloco (1–2 linhas) vira um clipe próprio, editável, que pode ser movido,
// aparado ou apagado como qualquer outro. As palavras guardam o tempo de cada uma,
// então o destaque palavra-por-palavra continua certo depois de cortes.

import type { CaptionStyle, Clip, Project, TranscriptWord } from '../../core/types';
import { DEFAULT_TRANSFORM, NO_ASSET } from '../../core/types';
import { sourceEnd, toTimeline } from '../../core/clipTime';
import { newId } from '../../core/time';
import { addClip, addTrack, clipEnd, deleteClips } from '../timeline/operations';
import { EMPHASIS } from '../analysis/zoom';

export interface CaptionPreset {
  id: string;
  label: string;
  /** Categoria na galeria (Viral, YouTube, Podcast, Minimalista, Cinema, Elegante, Divertido, Meus estilos). */
  category: string;
  style: CaptionStyle;
  maxChars: number;
  maxWords: number;
  /** Estilo salvo pela pessoa ("Meus estilos"). */
  user?: boolean;
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
/** font-family de uma fonte da biblioteca (com o mesmo fallback do seletor de fontes). */
const lib = (family: string) => `"${family}", "Segoe UI", Arial, sans-serif`;

function preset(id: string, label: string, category: string, maxChars: number, maxWords: number, s: Partial<CaptionStyle>): CaptionPreset {
  return { id, label, category, maxChars, maxWords, style: { ...base, ...s, preset: id } };
}

export const CAPTION_CATEGORIES = ['Viral', 'YouTube', 'Podcast', 'Minimalista', 'Cinema', 'Elegante', 'Divertido'] as const;

/** Banco de estilos. Os 8 primeiros (ids antigos) ficam iguais: projetos e fluxos já usam esses ids. */
export const CAPTION_PRESETS: CaptionPreset[] = [
  preset('minimal', 'Minimal', 'Minimalista', 42, 14, { fontWeight: 600, fontSize: 0.045 }),
  preset('podcast', 'Podcast', 'Podcast', 32, 10, { highlightColor: '#ffd400', background: 'rgba(0,0,0,0.6)', shadow: false, mode: 'karaoke', y: 0.82 }),
  preset('bold', 'Bold', 'Viral', 26, 6, { fontFamily: HEAVY, fontWeight: 900, fontSize: 0.06, strokeWidth: 0.14, uppercase: true, y: 0.78 }),
  preset('kinetic', 'Kinetic', 'Viral', 30, 4, { fontFamily: HEAVY, fontWeight: 900, fontSize: 0.09, highlightColor: '#ffe600', strokeWidth: 0.16, uppercase: true, y: 0.6, mode: 'word', pop: true }),
  preset('cinema', 'Cinema', 'Cinema', 44, 14, { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 400, fontSize: 0.042, color: '#f0f0f0', y: 0.9 }),
  preset('social', 'Social', 'Viral', 22, 5, { fontFamily: HEAVY, fontWeight: 900, fontSize: 0.065, highlightColor: '#2ee86b', strokeWidth: 0.15, uppercase: true, y: 0.7, mode: 'karaoke', pop: true }),
  preset('youtube', 'YouTube', 'YouTube', 42, 14, { fontWeight: 600, fontSize: 0.045, background: 'rgba(0,0,0,0.75)', shadow: false, y: 0.88 }),
  preset('shorts', 'Shorts', 'Viral', 16, 3, { fontFamily: HEAVY, fontWeight: 900, fontSize: 0.08, highlightColor: '#ffd400', strokeWidth: 0.16, uppercase: true, y: 0.65, mode: 'karaoke', pop: true }),

  // Viral (Reels, TikTok, Shorts)
  preset('hormozi', 'Destaque verde', 'Viral', 18, 4, { fontFamily: lib('Montserrat'), fontWeight: 900, fontSize: 0.075, highlightColor: '#3dff6e', emphasisColor: '#ffd400', strokeWidth: 0.16, uppercase: true, y: 0.68, mode: 'karaoke', wordAnim: 'pop', animIn: 'pop', animDuration: 0.14 }),
  preset('caixa', 'Caixa na palavra', 'Viral', 18, 4, { fontFamily: lib('Montserrat'), fontWeight: 800, fontSize: 0.07, highlightBg: '#7c3aed', uppercase: true, y: 0.68, mode: 'karaoke', wordAnim: 'pop', animIn: 'fade', animDuration: 0.1 }),
  preset('impacto', 'Impacto', 'Viral', 14, 2, { fontFamily: lib('Anton'), fontWeight: 400, fontSize: 0.11, strokeWidth: 0.12, uppercase: true, y: 0.6, mode: 'word', wordAnim: 'bounce', animDuration: 0.1 }),
  preset('revelar', 'Revelar fala', 'Viral', 24, 6, { fontFamily: lib('Poppins'), fontWeight: 800, fontSize: 0.065, emphasisColor: '#ffcf33', strokeWidth: 0.1, y: 0.7, mode: 'reveal', wordAnim: 'rise' }),
  preset('bebas', 'Alta amarela', 'Viral', 20, 4, { fontFamily: lib('Bebas Neue'), fontWeight: 400, fontSize: 0.1, highlightColor: '#ffd400', strokeWidth: 0.08, letterSpacing: 0.02, y: 0.66, mode: 'karaoke', wordAnim: 'pop' }),
  preset('neon', 'Neon', 'Viral', 20, 4, { fontFamily: lib('Kanit'), fontWeight: 800, fontSize: 0.068, color: '#e8fbff', highlightColor: '#22e4ff', shadowColor: 'rgba(34,228,255,0.9)', shadowBlur: 0.35, shadowOffset: 0, uppercase: true, y: 0.68, mode: 'karaoke', wordAnim: 'pop', animIn: 'blur' }),
  preset('tiktok', 'Fundo branco', 'Viral', 26, 6, { fontFamily: lib('Montserrat'), fontWeight: 700, fontSize: 0.055, color: '#111111', highlightColor: '#111111', background: '#ffffff', shadow: false, backgroundPadding: 0.4, backgroundRadius: 0.3, y: 0.7, animIn: 'pop' }),
  preset('vermelho', 'Vermelho forte', 'Viral', 18, 3, { fontFamily: lib('Archivo Black'), fontWeight: 400, fontSize: 0.075, highlightBg: '#e11d2e', uppercase: true, y: 0.66, mode: 'karaoke', wordAnim: 'bounce' }),

  // YouTube
  preset('youtube-limpo', 'Limpo', 'YouTube', 42, 12, { fontFamily: lib('Inter'), fontWeight: 600, fontSize: 0.045, shadowBlur: 0.2, y: 0.88, animIn: 'fade', animOut: 'fade' }),
  preset('tutorial', 'Tutorial', 'YouTube', 40, 12, { fontFamily: lib('Roboto'), fontWeight: 500, fontSize: 0.043, background: 'rgba(15,23,42,0.85)', shadow: false, backgroundRadius: 0.4, highlightColor: '#7dd3fc', mode: 'karaoke', y: 0.88 }),
  preset('comentario', 'Comentário', 'YouTube', 34, 9, { fontFamily: lib('DM Sans'), fontWeight: 700, fontSize: 0.05, highlightColor: '#ffd400', strokeWidth: 0.08, mode: 'karaoke', y: 0.85, animIn: 'slideUp' }),

  // Podcast
  preset('podcast-caixa', 'Podcast caixa', 'Podcast', 30, 8, { fontFamily: lib('Rubik'), fontWeight: 600, fontSize: 0.05, highlightBg: '#f97316', background: 'rgba(0,0,0,0.55)', shadow: false, mode: 'karaoke', y: 0.82, animIn: 'fade' }),
  preset('conversa', 'Conversa', 'Podcast', 34, 9, { fontFamily: lib('Nunito'), fontWeight: 800, fontSize: 0.05, highlightColor: '#a5b4fc', shadowBlur: 0.25, mode: 'karaoke', y: 0.84, animIn: 'slideUp', animOut: 'fade' }),

  // Minimalista
  preset('discreto', 'Discreto', 'Minimalista', 46, 14, { fontFamily: lib('DM Sans'), fontWeight: 500, fontSize: 0.038, shadowBlur: 0.3, shadowOffset: 0, y: 0.9, animIn: 'fade', animOut: 'fade' }),
  preset('espacado', 'Espaçado', 'Minimalista', 30, 7, { fontFamily: lib('Manrope'), fontWeight: 600, fontSize: 0.04, letterSpacing: 0.12, uppercase: true, shadowBlur: 0.25, y: 0.86, animIn: 'fade', animOut: 'fade', animDuration: 0.3 }),
  preset('caixa-suave', 'Caixa suave', 'Minimalista', 40, 12, { fontFamily: lib('Outfit'), fontWeight: 500, fontSize: 0.042, background: 'rgba(255,255,255,0.14)', shadow: false, backgroundRadius: 0.6, y: 0.87, animIn: 'fade' }),

  // Cinema / documentário
  preset('documentario', 'Documentário', 'Cinema', 44, 14, { fontFamily: lib('Lora'), fontWeight: 500, fontSize: 0.042, color: '#f5f1e8', shadowBlur: 0.3, y: 0.88, animIn: 'fade', animOut: 'fade', animDuration: 0.35 }),
  preset('filme', 'Filme', 'Cinema', 40, 12, { fontFamily: lib('Cormorant Garamond'), fontWeight: 600, fontSize: 0.05, color: '#fffaf0', letterSpacing: 0.03, shadowBlur: 0.35, y: 0.88, animIn: 'blur', animOut: 'fade', animDuration: 0.4 }),
  preset('reflexao', 'Reflexão', 'Cinema', 38, 11, { fontFamily: lib('Playfair Display'), fontWeight: 500, fontSize: 0.046, emphasisColor: '#f4d58d', shadowBlur: 0.3, y: 0.82, mode: 'reveal', wordAnim: 'fade', animOut: 'fade', animDuration: 0.3 }),

  // Elegante
  preset('elegante', 'Elegante', 'Elegante', 34, 9, { fontFamily: lib('Playfair Display'), fontWeight: 700, fontSize: 0.055, highlightColor: '#f4d58d', mode: 'karaoke', y: 0.8, animIn: 'fade', animOut: 'fade' }),
  preset('luxo', 'Luxo dourado', 'Elegante', 28, 6, { fontFamily: lib('Cinzel'), fontWeight: 700, fontSize: 0.05, color: '#f2e2b3', highlightColor: '#d4af37', letterSpacing: 0.08, uppercase: true, shadowBlur: 0.3, mode: 'karaoke', y: 0.82, animIn: 'zoom', animOut: 'fade', animDuration: 0.3 }),
  preset('manuscrita', 'Manuscrita', 'Elegante', 30, 7, { fontFamily: lib('Dancing Script'), fontWeight: 700, fontSize: 0.075, shadowBlur: 0.25, y: 0.8, mode: 'reveal', wordAnim: 'fade', animOut: 'fade' }),

  // Divertido
  preset('quadrinhos', 'Quadrinhos', 'Divertido', 20, 4, { fontFamily: lib('Bangers'), fontWeight: 400, fontSize: 0.085, highlightColor: '#ffe14d', strokeWidth: 0.14, letterSpacing: 0.03, uppercase: true, y: 0.68, mode: 'karaoke', wordAnim: 'bounce', animIn: 'pop' }),
  preset('fofo', 'Fofo', 'Divertido', 24, 6, { fontFamily: lib('Fredoka'), fontWeight: 700, fontSize: 0.065, color: '#3b1d4a', highlightColor: '#3b1d4a', highlightBg: '#ffd1e8', background: '#fff5fb', shadow: false, backgroundRadius: 0.6, y: 0.72, mode: 'karaoke', wordAnim: 'bounce', animIn: 'pop' }),
  preset('marcador', 'Marcador', 'Divertido', 22, 5, { fontFamily: lib('Permanent Marker'), fontWeight: 400, fontSize: 0.07, highlightColor: '#ff6b6b', strokeWidth: 0.08, y: 0.7, mode: 'karaoke', wordAnim: 'shake', animIn: 'slideUp' }),
  preset('gamer', 'Gamer', 'Divertido', 22, 4, { fontFamily: lib('Press Start 2P'), fontWeight: 400, fontSize: 0.04, highlightColor: '#4ade80', strokeWidth: 0.18, uppercase: true, lineHeight: 1.6, y: 0.72, mode: 'karaoke', wordAnim: 'pop' }),
];

// "Meus estilos": preenchido pela camada do app (preferências do navegador).
let userPresets: CaptionPreset[] = [];
export function setUserCaptionPresets(list: CaptionPreset[]) {
  userPresets = list;
}

/** Banco + estilos salvos pela pessoa. */
export const allCaptionPresets = (): CaptionPreset[] => [...CAPTION_PRESETS, ...userPresets];

export const getPreset = (id: string) => allCaptionPresets().find((p) => p.id === id) ?? CAPTION_PRESETS[1];

// Destaque automático: palavras de ênfase, números e valores.
const EMPHASIS_WORDS = new Set([...EMPHASIS, 'grátis', 'dinheiro', 'resultado', 'rápido', 'fácil', 'simples', 'novo', 'nova', 'deus', 'vida', 'morte', 'amor', 'fé']);
const bare = (t: string) => t.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');

/** Marca as palavras de destaque de um bloco de legenda (1 por bloco curto, até 2 nos longos). Função pura. */
export function autoEmphasis(words: TranscriptWord[]): TranscriptWord[] {
  const score = (w: TranscriptWord) => {
    if (/\d/.test(w.text)) return 3; // "500", "100%", "R$50" (o número, não o "R$" solto)
    if (EMPHASIS_WORDS.has(bare(w.text))) return 2;
    if (/!$/.test(w.text) && bare(w.text).length >= 4) return 1.5;
    return 0;
  };
  const pick = new Set(
    words
      .map((w, i) => ({ i, sc: score(w) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, words.length > 8 ? 2 : 1)
      .map((x) => x.i),
  );
  return words.map((w, i) => ({ ...w, emphasis: pick.has(i) || undefined }));
}

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
  // estilos com cor de ênfase já saem com as palavras-chave destacadas
  const emph = (ws: TranscriptWord[]) => (pr.style.emphasisColor ? autoEmphasis(ws) : ws);
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
        words: emph(block.map((w) => ({ text: w.text, start: w.start - start, end: w.end - start }))),
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
