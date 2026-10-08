// Etapa 4 · motion-graphics-designer: títulos e destaques animados nas frases que carregam o
// vídeo (tese, pergunta, número, conclusão) e zooms no rosto nessas frases. O texto sai da
// própria fala (nunca inventado). Estilo pelo preset: discreto no longo, forte no curto.

import type { Clip, Keyframe, Project, TitleTemplate } from '../../core/types';
import { newId } from '../../core/time';
import { askJson } from '../../engine/ai/providers';
import { defaultTitle, TITLE_TEMPLATES } from '../../engine/motion/titles';
import { clipEnd } from '../../engine/timeline/operations';
import type { EditCommand } from '../commands/types';
import { tokens } from '../media-analysis/manifest';
import type { Skill } from '../orchestrator/orchestrator';
import { isProtected } from '../validation/validate';
import { isShort, llmReady, sentences } from './common';
import type { Sentence } from './common';

export type MotionKind = 'title' | 'callout' | 'lowerThird';

export interface MotionPick {
  sentence: Sentence;
  kind: MotionKind;
  text: string;
  why: string;
  by: 'llm' | 'heuristic';
}

export interface MotionStyle {
  /** Um gráfico a cada N segundos, no máximo. */
  every: number;
  max: number;
  zoom: number;
  /** Zoom seco (corte) ou empurrão suave. */
  punch: boolean;
  accent: string;
  maxWords: number;
}

export const motionStyle = (short: boolean): MotionStyle =>
  short ? { every: 8, max: 8, zoom: 1.12, punch: true, accent: '#ffd400', maxWords: 5 } : { every: 50, max: 8, zoom: 1.06, punch: false, accent: '#4f8cff', maxWords: 7 };

/** O texto do gráfico tem de sair da frase: ao menos 80% das palavras dele estão nela. */
export function textFromSpeech(text: string, sentence: string): boolean {
  const t = tokens(text);
  if (!t.length) return false;
  const s = new Set(tokens(sentence));
  return t.filter((w) => s.has(w)).length / t.length >= 0.8;
}

/** Corta o texto no limite de palavras sem deixar conectivo pendurado no fim. */
export function trimText(text: string, maxWords: number): string {
  const w = text.replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, maxWords);
  while (w.length > 2 && /^(e|o|a|os|as|de|da|do|que|com|para|em|um|uma|no|na)$/i.test(w[w.length - 1])) w.pop();
  return w.join(' ').replace(/[,;:]$/, '');
}

/** Sem IA: perguntas, frases com número e a última frase (conclusão). */
export function heuristicPicks(list: Sentence[], style: MotionStyle, duration: number): MotionPick[] {
  const cands: MotionPick[] = [];
  for (const s of list) {
    if (s.end - s.start < 1.2) continue;
    if (/\?$/.test(s.text.trim())) cands.push({ sentence: s, kind: 'callout', text: trimText(s.text, style.maxWords + 2), why: 'pergunta que prende a atenção', by: 'heuristic' });
    else if (/\d/.test(s.text)) cands.push({ sentence: s, kind: 'callout', text: trimText(s.text.slice(Math.max(0, s.text.search(/\d/) - 20)).replace(/^\S*\s/, ''), style.maxWords), why: 'número dito na fala', by: 'heuristic' });
  }
  const last = list[list.length - 1];
  if (last && list.length > 3) cands.push({ sentence: last, kind: 'title', text: trimText(last.text, style.maxWords), why: 'fechamento', by: 'heuristic' });
  return spread(cands, style, duration);
}

/** Respeita o ritmo: no máximo um gráfico a cada `every` segundos e `max` no total. */
export function spread(picks: MotionPick[], style: MotionStyle, duration: number): MotionPick[] {
  const limit = Math.min(style.max, Math.max(1, Math.floor(duration / style.every)));
  const out: MotionPick[] = [];
  for (const p of [...picks].sort((a, b) => a.sentence.start - b.sentence.start)) {
    if (out.length >= limit) break;
    if (out.some((q) => Math.abs(q.sentence.start - p.sentence.start) < style.every * 0.6)) continue;
    if (!p.text.trim()) continue;
    out.push(p);
  }
  return out;
}

const PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks'],
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sentence', 'kind', 'text', 'why'],
        properties: {
          sentence: { type: 'integer' },
          kind: { type: 'string', enum: ['title', 'callout', 'lowerThird'] },
          text: { type: 'string', description: 'palavras copiadas da própria frase' },
          why: { type: 'string' },
        },
      },
    },
  },
} as const;

/** Clipe principal (fala com imagem, não criado pela IA, sem B-roll por cima) num instante. */
export function faceClipAt(p: Project, t: number): Clip | null {
  const broll = new Set(p.tracks.filter((x) => x.name === 'B-roll' || x.name === 'Gráficos' || x.name === 'Legendas').map((x) => x.id));
  const covered = Object.values(p.clips).some((c) => broll.has(c.trackId) && !c.title && !c.caption && c.start <= t && clipEnd(c) > t);
  if (covered) return null;
  return (
    Object.values(p.clips).find((c) => {
      const a = p.assets[c.assetId];
      return !broll.has(c.trackId) && !!a?.hasVideo && !c.title && !c.caption && c.origin?.by !== 'ai' && !isProtected(p, c) && c.start <= t && clipEnd(c) > t;
    }) ?? null
  );
}

/** Keyframes de escala (tempo de origem do clipe) para os zooms nas frases escolhidas. */
export function zoomKeyframes(c: Clip, spans: [number, number][], style: MotionStyle): Keyframe[] {
  const speed = c.speed || 1;
  const toSrc = (t: number) => +(c.sourceIn + (t - c.start) * speed).toFixed(3);
  const base = c.transform.scale;
  const kf: Keyframe[] = [{ t: c.sourceIn, v: base, ease: 'hold' }];
  for (const [a, b] of spans.sort((x, y) => x[0] - y[0])) {
    const s0 = toSrc(Math.max(a, c.start));
    const s1 = toSrc(Math.min(b, clipEnd(c) - 0.05));
    if (s1 - s0 < 0.4 || s0 <= kf[kf.length - 1].t) continue;
    if (style.punch) kf.push({ t: s0, v: +(base * style.zoom).toFixed(3), ease: 'hold' });
    else kf.push({ t: s0, v: base, ease: 'easeInOut' }, { t: +(s0 + Math.min(1.2, (s1 - s0) * 0.6)).toFixed(3), v: +(base * style.zoom).toFixed(3), ease: 'hold' });
    kf.push({ t: s1, v: base, ease: 'hold' });
  }
  return kf.length > 1 ? kf : [];
}

export const motionDesignerSkill: Skill = {
  id: 'motion-graphics-designer',
  stage: 'motion',
  label: 'Títulos animados e zooms',
  modes: ['audio-led', 'script-led', 'manual-assisted'],
  async run(ctx) {
    const words = ctx.words();
    if (!words.length) return { commands: [], warnings: ['Sem fala transcrita: não há frases para destacar.'] };
    const p = ctx.project();
    const short = isShort(ctx);
    const style = motionStyle(short);
    const list = sentences(words);
    const duration = Math.max(...words.map((w) => w.end));
    let picks: MotionPick[] = [];
    if (llmReady(ctx.ai)) {
      try {
        ctx.progress('O diretor está escolhendo as frases para destacar…', 0, 1);
        const limit = Math.min(style.max, Math.max(1, Math.floor(duration / style.every)));
        const raw = (await askJson(
          ctx.ai,
          `Você é motion designer de ${short ? 'vídeos curtos (estilo forte, ritmo rápido)' : 'vídeos longos de YouTube (estilo discreto, elegante)'}. Escolha até ${limit} frases que carregam o vídeo: tese, pergunta, número, virada, conclusão. Para cada uma: kind (title = frase de impacto no centro; callout = destaque curto; lowerThird = nome/assunto na base), e text com no máximo ${style.maxWords} palavras COPIADAS da própria frase (não reescreva, não invente). Responda só o JSON.`,
          list.map((s) => `${s.index} [${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${s.text}`).join('\n'),
          PICK_SCHEMA as unknown as Record<string, unknown>,
          ctx.signal,
        )) as { picks?: { sentence: number; kind: string; text: string; why: string }[] };
        const valid: MotionPick[] = [];
        for (const r of raw.picks ?? []) {
          const s = list.find((x) => x.index === r.sentence);
          const kind = (['title', 'callout', 'lowerThird'] as const).find((k) => k === r.kind);
          const text = trimText(String(r.text ?? ''), style.maxWords);
          if (!s || !kind || !textFromSpeech(text, s.text)) continue; // texto inventado: fora
          valid.push({ sentence: s, kind, text, why: String(r.why ?? '').slice(0, 140), by: 'llm' });
        }
        picks = spread(valid, style, duration);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        ctx.log(`diretor de IA indisponível: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (!picks.length) picks = heuristicPicks(list, style, duration);
    if (!picks.length) return { commands: [], notes: ['Nenhuma frase pediu destaque animado.'] };

    const commands: EditCommand[] = [];
    const confidence = (pk: MotionPick) => (pk.by === 'llm' ? 0.72 : 0.45);
    let lastEnd = -1;
    const zoomSpans = new Map<string, { clip: Clip; spans: [number, number][]; picks: MotionPick[] }>();
    for (const pk of picks) {
      const template: TitleTemplate = pk.kind;
      const tplDur = TITLE_TEMPLATES.find((t) => t.id === template)?.duration ?? 3;
      const start = +Math.max(pk.sentence.start, lastEnd + 0.1).toFixed(3);
      const end = +Math.min(duration, Math.max(start + 1.8, Math.min(pk.sentence.end + 0.4, start + tplDur + 1))).toFixed(3);
      if (end - start < 1.2) continue;
      lastEnd = end;
      const title = { ...defaultTitle(template, short ? pk.text.toUpperCase() : pk.text), accent: template === 'callout' ? style.accent : defaultTitle(template).accent };
      if (template === 'lowerThird') title.subtitle = '';
      commands.push({
        id: newId('k'),
        projectId: p.id,
        type: 'add_overlay',
        start,
        end,
        createdBy: 'ai',
        skill: 'motion-graphics-designer',
        confidence: confidence(pk),
        reason: `${pk.why || 'frase-chave'} · "${pk.sentence.text.slice(0, 70)}"`,
        reversible: true,
        payload: { role: 'overlay', title, label: pk.text },
      });
      const face = faceClipAt(p, pk.sentence.start + 0.05);
      if (face) {
        const z = zoomSpans.get(face.id) ?? { clip: face, spans: [], picks: [] };
        z.spans.push([pk.sentence.start, pk.sentence.end]);
        z.picks.push(pk);
        zoomSpans.set(face.id, z);
      }
    }
    // zoom: um comando por clipe (os keyframes do clipe são um conjunto só); não mexe em quem já tem zoom manual
    for (const { clip, spans, picks: pks } of zoomSpans.values()) {
      if (clip.keyframes?.scale?.length) continue;
      const scale = zoomKeyframes(clip, spans, style);
      if (!scale.length) continue;
      commands.push({
        id: newId('k'),
        projectId: p.id,
        type: 'add_effect',
        start: spans[0][0],
        createdBy: 'ai',
        skill: 'motion-graphics-designer',
        confidence: Math.min(...pks.map(confidence)),
        reason: `${style.punch ? 'zoom seco' : 'aproximação suave'} em ${spans.length} frase(s)-chave`,
        reversible: true,
        payload: { clipId: clip.id, keyframes: { scale }, prevKeyframes: clip.keyframes ?? null, label: 'Zoom' },
      });
    }
    return {
      commands,
      notes: [`${picks.length} destaque(s) animado(s)${zoomSpans.size ? ' com zoom no rosto' : ''} (${picks[0].by === 'llm' ? 'diretor de IA' : 'escolha local: revise antes de aplicar'}).`],
    };
  },
};
