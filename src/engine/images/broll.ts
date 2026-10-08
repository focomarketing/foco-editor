// Fase Imagens: escolher os momentos da fala que pedem imagem e montar o B-roll.
// - O "diretor" (LLM) escolhe frase a frase e diz o que buscar; o resultado é validado aqui.
// - Sem IA configurada, uma heurística local escolhe as frases mais fortes.
// - A montagem cobre o quadro, com movimento lento (Ken Burns) e dissolve, numa trilha própria.

import type { Clip, Keyframe, Project } from '../../core/types';
import { DEFAULT_TRANSFORM } from '../../core/types';
import { newId } from '../../core/time';
import { scoreSentences } from '../analysis/zoom';
import type { EditCommand } from '../commands/commands';
import { Cmd } from '../commands/commands';

export const BROLL_TRACK = 'B-roll';

export interface Moment {
  start: number;
  end: number;
  text: string;
  why: string;
  /** Busca principal (em inglês funciona melhor nos acervos) e alternativa. */
  query: string;
  queryAlt: string;
}

export interface DensityOpts {
  short: boolean;
  duration: number;
}

/** Quantas imagens e por quanto tempo, por tipo de vídeo. */
export function density({ short, duration }: DensityOpts) {
  return short
    ? { count: Math.max(2, Math.min(40, Math.round(duration / 5))), min: 1.5, max: 4, gap: 1.5 }
    : { count: Math.max(2, Math.min(30, Math.round(duration / 32))), min: 2.5, max: 8, gap: 6 };
}

// --- diretor (LLM) ------------------------------------------------------------------

export const MOMENTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['moments'],
  properties: {
    moments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start', 'end', 'text', 'why', 'query', 'queryAlt'],
        properties: {
          start: { type: 'number' },
          end: { type: 'number' },
          text: { type: 'string' },
          why: { type: 'string' },
          query: { type: 'string', description: 'busca em inglês para acervos de imagem' },
          queryAlt: { type: 'string', description: 'busca alternativa em inglês' },
        },
      },
    },
  },
} as const;

export function directorPrompt(opts: { kind: string; short: boolean; archive: boolean; count: number; min: number; max: number }) {
  return `Você é o diretor de imagens de um editor de vídeo profissional. Recebe a fala do vídeo com tempos (segundos da timeline) e escolhe os momentos que ganham uma imagem de apoio (B-roll) por cima do vídeo.

Tipo de vídeo: ${opts.kind}.
Regras:
- Nenhuma imagem aleatória. Cada imagem tem que mostrar exatamente o que está sendo dito naquele momento (guerra → guerra; Bíblia/passagem → a cena da passagem; universo → cosmos; sofrimento → sofrimento contextualizado).
- Escolha só momentos que se visualizam bem ou frases fortes (tese, pergunta, virada, conclusão, passagem citada). Frases comuns ficam com a pessoa na tela.
- Cerca de ${opts.count} momentos, bem distribuídos, nunca dois seguidos. Cada um entre ${opts.min} e ${opts.max} s, dentro de uma frase (comece no início da frase).
- ${opts.archive ? 'Prefira arte clássica, gravuras, fotografias históricas e imagens científicas de domínio público (estética de documentário/ensaio). Para Bíblia, pinturas e gravuras da cena.' : 'Prefira fotos reais, nítidas e atuais que mostrem a ação; nada de banco de imagem genérico com gente sorrindo para a câmera.'}
- "query" e "queryAlt": termos de busca curtos em INGLÊS para um acervo de imagens (ex.: "Doré creation of light", "Hubble deep field", "child war ruins 1939"). Sem nomes de marcas.
- "why": em português, uma frase dizendo por que essa imagem ajuda a entender o que foi dito.
- "text": a frase dita (copie da transcrição, sem inventar).
Responda só o JSON.`;
}

/** Confere o que o diretor devolveu: tempos válidos, dentro do vídeo, sem sobreposição. */
export function validateMoments(raw: unknown, duration: number, d: ReturnType<typeof density>): Moment[] {
  const list = (raw as { moments?: unknown[] })?.moments;
  if (!Array.isArray(list)) return [];
  const out: Moment[] = [];
  const items = list
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => ({ raw: m, start: Number(m.start), end: Number(m.end) }))
    .filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end))
    .sort((a, b) => a.start - b.start);
  for (const m of items) {
    const r = m.raw;
    const query = typeof r.query === 'string' ? r.query.trim().slice(0, 80) : '';
    if (!query) continue;
    const start = Math.max(0, Math.min(duration - d.min, m.start));
    const end = Math.min(duration, Math.max(start + d.min, Math.min(m.end, start + d.max)));
    const prev = out.at(-1);
    if (prev && start < prev.end + d.gap * 0.5) continue; // nunca colado no anterior
    out.push({ start, end, text: String(r.text ?? '').slice(0, 300), why: String(r.why ?? '').slice(0, 300), query, queryAlt: typeof r.queryAlt === 'string' ? r.queryAlt.trim().slice(0, 80) : '' });
    if (out.length >= d.count * 1.5) break;
  }
  return out;
}

// --- sem IA: heurística -----------------------------------------------------------------

const STOP = new Set('a o os as um uma uns umas de da do das dos em no na nos nas por para pra com sem que se e é ou mas mais muito isso esse essa este esta aquilo eu você ele ela nós eles elas me te lhe meu minha seu sua nosso nossa não sim já quando como onde porque então também só ainda ser estar ter fazer foi era são está tem vai vou'.split(' '));

/** Momentos pelas frases mais fortes (ênfase, perguntas, palavras de destaque), espaçados. */
export function heuristicMoments(words: { text: string; start: number; end: number }[], duration: number, d: ReturnType<typeof density>): Moment[] {
  const ranked = scoreSentences(words, null)
    .filter((s) => s.end - s.start >= 1)
    .sort((a, b) => b.score - a.score);
  const chosen: typeof ranked = [];
  for (const s of ranked) {
    if (chosen.length >= d.count) break;
    if (chosen.some((c) => s.start < c.end + d.gap && s.end > c.start - d.gap)) continue;
    chosen.push(s);
  }
  return chosen
    .sort((a, b) => a.start - b.start)
    .map((s) => {
      const terms = s.text
        .toLowerCase()
        .replace(/[^\p{L}\s]/gu, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 3 && !STOP.has(t))
        .sort((a, b) => b.length - a.length)
        .slice(0, 3);
      const start = Math.max(0, s.start);
      return { start, end: Math.min(duration, start + Math.min(d.max, Math.max(d.min, s.end - s.start))), text: s.text, why: 'frase de destaque', query: terms.join(' '), queryAlt: terms[0] ?? '' };
    })
    .filter((m) => m.query);
}

// --- montagem ---------------------------------------------------------------------------

export interface Placement {
  assetId: string;
  width: number;
  height: number;
  start: number;
  duration: number;
}

/** Escala que cobre o quadro inteiro (o compositor encaixa a imagem: contain × escala). */
export function coverScale(imgW: number, imgH: number, W: number, H: number) {
  const fit = Math.min(W / imgW, H / imgH);
  return Math.max(W / (imgW * fit), H / (imgH * fit)) * 1.02;
}

/** Comandos para pôr as imagens numa trilha "B-roll" acima do vídeo (um passo de undo). */
export function brollCommands(p: Project, items: Placement[], opts: { dissolve?: number; push?: number } = {}): { commands: EditCommand[]; clipIds: string[] } {
  const W = p.settings.width;
  const H = p.settings.height;
  const dissolve = opts.dissolve ?? 0.6;
  const push = opts.push ?? 1.07;
  const commands: EditCommand[] = [];
  let track = p.tracks.find((t) => t.kind === 'video' && t.name === BROLL_TRACK);
  let trackId = track?.id;
  if (!trackId) {
    trackId = newId('t');
    commands.push(Cmd.addTrack('video', { id: trackId, name: BROLL_TRACK }));
  }
  const clipIds: string[] = [];
  items.forEach((it, i) => {
    const cover = coverScale(it.width, it.height, W, H);
    // alterna aproximar e afastar, para o movimento não ficar repetitivo
    const [from, to] = i % 2 === 0 ? [cover, cover * push] : [cover * push, cover];
    const d = it.duration;
    const fi = Math.min(dissolve, d / 3);
    const scale: Keyframe[] = [{ t: 0, v: from, ease: 'linear' }, { t: d, v: to, ease: 'linear' }];
    const opacity: Keyframe[] = [
      { t: 0, v: 0, ease: 'easeInOut' },
      { t: fi, v: 1, ease: 'linear' },
      { t: d - fi, v: 1, ease: 'easeInOut' },
      { t: d, v: 0, ease: 'linear' },
    ];
    const clip: Clip = {
      id: newId('c'),
      assetId: it.assetId,
      trackId: trackId!,
      start: it.start,
      duration: d,
      sourceIn: 0,
      volume: 0,
      speed: 1,
      fadeIn: 0,
      fadeOut: 0,
      transform: { ...DEFAULT_TRANSFORM, scale: from },
      keyframes: { scale, opacity },
    };
    clipIds.push(clip.id);
    commands.push(Cmd.addClip(clip));
  });
  return { commands, clipIds };
}
