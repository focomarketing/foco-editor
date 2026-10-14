// Etapa 4 · motion-graphics-designer: títulos e destaques animados nas frases que carregam o
// vídeo (tese, pergunta, número, conclusão) e zooms no rosto nessas frases. O texto sai da
// própria fala (nunca inventado). Estilo pelo preset: discreto no longo, forte no curto.

import type { CaptionData, CaptionStyle, Clip, Keyframe, Project } from '../../core/types';
import { newId } from '../../core/time';
import { askJson } from '../../engine/ai/providers';
import { autoEmphasis } from '../../engine/captions/captions';
import { clipEnd } from '../../engine/timeline/operations';
import type { EditCommand } from '../commands/types';
import { tokens } from '../media-analysis/manifest';
import type { Skill } from '../orchestrator/orchestrator';
import { isProtected } from '../validation/validate';
import { isShort, llmReady, sentences } from './common';
import type { Sentence } from './common';
import { isGraphic } from '../../core/types';
import { briefText, isMetaTransition } from '../narrative/brief';
import type { NarrativeBrief } from '../narrative/brief';
import type { EditorialProfile, LetteringStyle } from '../narrative/profiles';
import { faceAnchorOffset, faceBox, freeZone, GUESS } from './face';
import type { Zone } from './face';
import { skillsFor } from '../knowledge/skills';
import { CTA_DURATION, ctaCues, ctaElement } from './cta';

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
  short ? { every: 8, max: 8, zoom: 1.12, punch: true, accent: '#ffd400', maxWords: 5 } : { every: 50, max: 12, zoom: 1.06, punch: false, accent: '#4f8cff', maxWords: 7 };

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

/** Tira o conectivo do começo ("Então por que..." → "Por que..."), que não cabe num título. */
export function titleText(text: string): string {
  return text
    .replace(/[“”"]/g, '')
    .trim()
    .replace(/^((e|mas|agora|então|entao|ou seja|porque|e aqui|ora),?\s+)+/i, '')
    .replace(/^\p{Ll}/u, (c) => c.toUpperCase());
}

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/**
 * Pelo mapa narrativo: o tema de cada bloco (lower third), as teses e o clímax curtos (título
 * no centro) e a pergunta central quando cabe num destaque. Nada em chamada para ação. Prioridade
 * para o que estrutura o vídeo; o ritmo do estilo decide quantos entram.
 */
export function briefPicks(b: NarrativeBrief, style: MotionStyle, duration: number, profile: EditorialProfile): MotionPick[] {
  const cands: (MotionPick & { prio: number })[] = [];
  const fits = (t: string, extra = 0) => wordCount(t) >= 2 && wordCount(t) <= style.maxWords + extra;
  for (const s of b.sentences) {
    if (s.role === 'cta' || s.end - s.start < 1.2) continue;
    const text = titleText(s.script ?? s.text);
    // bloco com título do roteiro: o lower third mostra o título que a pessoa escreveu
    const sec = b.sections[s.section];
    if (s.role === 'chapter' && sec?.scripted && sec.first === s.index && fits(sec.title, 6)) {
      cands.push({ sentence: s, kind: 'lowerThird', text: sec.title, why: `tema do bloco ${s.section} (roteiro)`, by: 'heuristic', prio: 3 });
      continue;
    }
    if (s.role === 'chapter' && !isMetaTransition(s.text) && fits(text, 2)) cands.push({ sentence: s, kind: 'lowerThird', text: trimText(text, style.maxWords + 2), why: `tema do bloco ${s.section}`, by: 'heuristic', prio: 3 });
    else if ((s.role === 'thesis' || s.role === 'climax') && fits(text, 1)) cands.push({ sentence: s, kind: 'title', text: trimText(text, style.maxWords + 1), why: s.role === 'climax' ? 'a resposta do vídeo' : 'afirmação central do bloco', by: 'heuristic', prio: s.role === 'climax' ? 2.5 : 2 });
    else if (profile.motion.callouts && s.role === 'question' && b.centralQuestion === s.text && fits(text)) cands.push({ sentence: s, kind: 'callout', text: trimText(text, style.maxWords), why: 'a pergunta que move o vídeo', by: 'heuristic', prio: 2.8 });
  }
  const limit = Math.min(style.max, Math.max(1, Math.floor(duration / style.every)));
  const out: MotionPick[] = [];
  for (const c of [...cands].sort((x, y) => y.prio - x.prio || x.sentence.start - y.sentence.start)) {
    if (out.length >= limit) break;
    if (out.some((q) => Math.abs(q.sentence.start - c.sentence.start) < style.every * 0.6)) continue;
    out.push({ sentence: c.sentence, kind: c.kind, text: c.text, why: c.why, by: c.by });
  }
  return out.sort((x, y) => x.sentence.start - y.sentence.start);
}

/** Início da palavra que abre o texto do destaque dentro da frase (0,1 s antes); senão, o começo da frase. */
export function wordStart(words: { text: string; start: number; end: number }[], sentence: Sentence, text: string): number {
  const first = tokens(text)[0];
  if (!first) return sentence.start;
  const w = words.find((x) => x.start >= sentence.start - 0.05 && x.end <= sentence.end + 0.05 && tokens(x.text)[0] === first);
  return w ? Math.max(sentence.start, w.start - 0.1) : sentence.start;
}

/** Inícios de mudanças visuais que já existem: imagens (B-roll) e gráficos na timeline. */
export function visualEvents(p: Project): number[] {
  const ids = new Set(p.tracks.filter((t) => t.name === 'B-roll' || t.name === 'Gráficos' || t.name === 'Chamadas').map((t) => t.id));
  return Object.values(p.clips).filter((c) => ids.has(c.trackId)).flatMap((c) => [c.start, clipEnd(c)]);
}

/**
 * Trocas de enquadramento no ritmo: andando pelas frases, quando passar de `every` s desde a última
 * mudança visual, a frase seguinte (que não seja chamada) entra mais fechada e volta ao plano aberto
 * no fim dela (ou da seguinte, se for curta). Alterna aberto/fechado como duas câmeras.
 */
export function punchSpans(list: { start: number; end: number; role?: string }[], events: number[], every: number): [number, number][] {
  const out: [number, number][] = [];
  let last = 0;
  let e = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    while (e < events.length && events[e] <= s.start) last = Math.max(last, events[e++]);
    if (s.role === 'cta' || s.start - last < every) continue;
    let end = s.end;
    if (end - s.start < 2.5 && list[i + 1]) end = list[i + 1].end;
    end = Math.min(end, s.start + 6);
    if (end - s.start < 1.5) continue;
    out.push([s.start, end]);
    last = end;
  }
  return out;
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
  const broll = new Set(p.tracks.filter((x) => x.name === 'B-roll' || x.name === 'Gráficos' || x.name.startsWith('Gráficos ') || x.name === 'Legendas').map((x) => x.id));
  const covered = Object.values(p.clips).some((c) => broll.has(c.trackId) && !isGraphic(c) && c.start <= t && clipEnd(c) > t);
  if (covered) return null;
  return (
    Object.values(p.clips).find((c) => {
      const a = p.assets[c.assetId];
      return !broll.has(c.trackId) && !!a?.hasVideo && !c.title && !c.caption && c.origin?.by !== 'ai' && !isProtected(p, c) && c.start <= t && clipEnd(c) > t;
    }) ?? null
  );
}

/** Trecho de zoom: [início, fim] e, opcionalmente, o jeito (punch = troca seca de enquadramento). */
export type ZoomSpan = [number, number] | [number, number, 'punch' | 'push'];

/** Punch de ritmo: troca seca de enquadramento (como um corte para uma segunda câmera mais fechada). */
export const PUNCH_ZOOM = 1.08;

/** Keyframes de escala (tempo de origem do clipe) para os zooms nas frases escolhidas. */
export function zoomKeyframes(c: Clip, spans: ZoomSpan[], style: MotionStyle): Keyframe[] {
  const speed = c.speed || 1;
  const toSrc = (t: number) => +(c.sourceIn + (t - c.start) * speed).toFixed(3);
  const base = c.transform.scale;
  const kf: Keyframe[] = [{ t: c.sourceIn, v: base, ease: 'hold' }];
  for (const [a, b, how] of [...spans].sort((x, y) => x[0] - y[0])) {
    const s0 = toSrc(Math.max(a, c.start));
    const s1 = toSrc(Math.min(b, clipEnd(c) - 0.05));
    if (s1 - s0 < 0.4 || s0 <= kf[kf.length - 1].t) continue;
    if (how === 'punch') kf.push({ t: s0, v: +(base * PUNCH_ZOOM).toFixed(3), ease: 'hold' });
    else if (style.punch) kf.push({ t: s0, v: +(base * style.zoom).toFixed(3), ease: 'hold' });
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
    const profile = ctx.profile;
    // ritmo do canal (perfil) no vídeo longo
    const style = { ...motionStyle(short), ...(!short && profile.motionPace ? profile.motionPace : {}) };
    const brief = await ctx.brief();
    const list: (Sentence & { role?: string; section?: number; script?: string })[] = brief?.sentences ?? sentences(words);
    const duration = Math.max(...words.map((w) => w.end));
    let picks: MotionPick[] = [];
    if (llmReady(ctx.ai)) {
      try {
        ctx.progress('O diretor está escolhendo as frases para destacar…', 0, 1);
        const limit = Math.min(style.max, Math.max(1, Math.floor(duration / style.every)));
        const raw = (await askJson(
          ctx.ai,
          `Você é motion designer de ${short ? 'vídeos curtos (estilo forte, ritmo rápido)' : 'vídeos longos de YouTube (estilo discreto, elegante)'}.${brief ? `\n\nMAPA NARRATIVO (os gráficos marcam a estrutura do vídeo):\n${briefText(brief, profile)}\n` : ''}
Escolha até ${limit} frases que carregam o vídeo e a sua estrutura (ritmo de agência: lettering das frases de impacto, 2 a 3 por minuto, espalhadas pelo vídeo inteiro). Para cada uma: kind (title = tese ou virada no centro; callout = a pergunta central ou um número; lowerThird = o TEMA de um bloco quando ele começa, ou a referência bíblica/fonte citada; nunca um pedaço solto de frase), e text com no máximo ${style.maxWords} palavras COPIADAS da própria frase, formando uma ideia completa (não reescreva, não invente, não corte no meio da ideia). Nunca em chamada para ação (inscrição, compartilhar, link). Responda só o JSON.`,
          `${list.map((s) => `${s.index} [${s.start.toFixed(1)}–${s.end.toFixed(1)}]${s.role ? ` (bloco ${s.section} · ${s.role})` : ''} ${s.script ?? s.text}`).join('\n')}\n\n${skillsFor('motion', 30000)}`,
          PICK_SCHEMA as unknown as Record<string, unknown>,
          ctx.signal,
        )) as { picks?: { sentence: number; kind: string; text: string; why: string }[] };
        const valid: MotionPick[] = [];
        for (const r of raw.picks ?? []) {
          const s = list.find((x) => x.index === r.sentence);
          const kind = (['title', 'callout', 'lowerThird'] as const).find((k) => k === r.kind);
          const text = trimText(String(r.text ?? ''), style.maxWords);
          // o texto sai da fala, da redação do roteiro ou do título do bloco no roteiro; inventado fica fora
          const sec = brief && s?.section !== undefined ? brief.sections[s.section] : undefined;
          const fromScript = !!s && ((!!s.script && textFromSpeech(text, s.script)) || (!!sec?.scripted && textFromSpeech(text, sec.title)));
          if (!s || !kind || !(textFromSpeech(text, s.text) || fromScript)) continue;
          if (s.role === 'cta') continue; // chamada para ação não vira título
          valid.push({ sentence: s, kind, text, why: String(r.why ?? '').slice(0, 140), by: 'llm' });
        }
        picks = spread(valid, style, duration);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        ctx.log(`diretor de IA indisponível: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (!picks.length) picks = brief ? briefPicks(brief, style, duration, profile) : heuristicPicks(list, style, duration);
    if (!picks.length) return { commands: [], notes: ['Nenhuma frase pediu destaque animado.'] };

    const commands: EditCommand[] = [];
    const confidence = (pk: MotionPick) => (pk.by === 'llm' ? 0.75 : 0.5);
    // onde está o rosto: o texto entra no espaço livre ao lado dele e o zoom cresce na direção dele
    const main = faceClipAt(p, picks[0]?.sentence.start ?? 0) ?? mainTalkingClip(p);
    const face = main ? await faceBox(ctx, main.assetId) : GUESS;
    const zone = freeZone(face);
    const L = profile.lettering ?? DEFAULT_LETTERING;
    let lastEnd = -1;
    const zoomSpans = new Map<string, { clip: Clip; spans: ZoomSpan[]; picks: MotionPick[] }>();
    const zoomHow: 'punch' | 'push' = short ? 'punch' : profile.zoomStyle ?? 'push';
    let placed = 0;
    for (const pk of picks) {
      // as palavras ditas da frase de destaque (com o tempo de cada uma), na redação do roteiro se houver
      const phrase = phraseWords(words, pk.sentence, pk.text);
      if (!phrase.length) continue;
      const start = +Math.max(phrase[0].start - 0.12, lastEnd + 0.15).toFixed(3);
      const end = +Math.min(duration, phrase[phrase.length - 1].end + 1.4).toFixed(3);
      if (end - start < 1.2) continue;
      lastEnd = end;
      const chapter = pk.kind === 'lowerThird';
      const caption = letteringCaption(phrase, start, L, zone, chapter, short);
      commands.push({
        id: newId('k'),
        projectId: p.id,
        type: 'add_overlay',
        start,
        end,
        createdBy: 'ai',
        skill: 'motion-graphics-designer',
        confidence: confidence(pk),
        reason: `${pk.why || 'frase-chave'} · lettering palavra por palavra ${zone.side === 'below' ? 'abaixo do rosto' : `à ${zone.side === 'left' ? 'esquerda' : 'direita'} do rosto`}`,
        reversible: true,
        payload: { role: 'overlay', caption, x: +(zone.cx - 0.5).toFixed(3), label: pk.text },
      });
      placed++;
      // aproximação no rosto só nas frases de peso (tese, virada, pergunta central), não em capítulo
      const fc = faceClipAt(p, pk.sentence.start + 0.05);
      if (fc && !chapter) {
        const z = zoomSpans.get(fc.id) ?? { clip: fc, spans: [], picks: [] };
        z.spans.push([phrase[0].start, Math.max(pk.sentence.end, phrase[phrase.length - 1].end + 0.6), zoomHow]);
        z.picks.push(pk);
        zoomSpans.set(fc.id, z);
      }
    }
    // chamadas para o canal na palavra exata da transcrição ("se inscreve", "compartilha"...), ao lado do rosto
    const ctas = ctaCues(words);
    for (const c of ctas) {
      const start = +Math.max(0, c.at - 0.1).toFixed(3);
      const el = ctaElement(c.kind, { style: profile.ctaStyle ?? 'youtube', zone });
      commands.push({
        id: newId('k'),
        projectId: p.id,
        type: 'add_overlay',
        start,
        end: +Math.min(duration + 1, start + CTA_DURATION).toFixed(3),
        createdBy: 'ai',
        skill: 'motion-graphics-designer',
        confidence: 0.8,
        reason: `chamada na tela na palavra "${c.word}"`,
        reversible: true,
        payload: { role: 'cta', element: el, label: el.name },
      });
    }
    // ritmo: trechos de rosto longos sem mudança visual ganham aproximação, mas só em frase com peso
    let punches = 0;
    if (!short && profile.punchEvery && brief) {
      const weighty = brief.sentences.filter((s) => WEIGHTY.has(s.role));
      const events = [...visualEvents(p), ...picks.map((pk) => pk.sentence.start)].sort((a, b) => a - b);
      for (const sp of punchSpans(weighty, events, profile.punchEvery)) {
        const fc = faceClipAt(p, sp[0] + 0.05);
        if (!fc || !faceClipAt(p, Math.min(sp[1] - 0.1, sp[0] + 1))) continue;
        const z = zoomSpans.get(fc.id) ?? { clip: fc, spans: [], picks: [] };
        z.spans.push([sp[0], sp[1], zoomHow]);
        zoomSpans.set(fc.id, z);
        punches++;
      }
    }
    // zoom: um comando por clipe, ancorado no rosto (ele fica parado e a imagem cresce em volta)
    for (const { clip, spans, picks: pks } of zoomSpans.values()) {
      if (clip.keyframes?.scale?.length) continue;
      const scale = zoomKeyframes(clip, spans, style);
      if (!scale.length) continue;
      const base = clip.transform.scale;
      const off = (v: number) => faceAnchorOffset(face, 1 + (v - base));
      const x = scale.map((k) => ({ ...k, v: +(clip.transform.x + off(k.v).x).toFixed(4) }));
      const y = scale.map((k) => ({ ...k, v: +(clip.transform.y + off(k.v).y).toFixed(4) }));
      commands.push({
        id: newId('k'),
        projectId: p.id,
        type: 'add_effect',
        start: spans[0][0],
        createdBy: 'ai',
        skill: 'motion-graphics-designer',
        confidence: pks.length ? Math.min(...pks.map(confidence)) : 0.7,
        reason: `${zoomHow === 'punch' ? 'troca de enquadramento' : 'aproximação lenta'} no rosto em ${spans.length} frase(s) de peso`,
        reversible: true,
        payload: { clipId: clip.id, keyframes: { scale, x, y }, prevKeyframes: clip.keyframes ?? null, label: 'Zoom no rosto' },
      });
    }
    return {
      commands,
      notes: [`${placed} frase(s) em tipografia cinética ${face.seen ? 'ao lado do rosto' : '(rosto não localizado: posição padrão)'}${zoomSpans.size ? `, aproximações no rosto${punches ? ` (${punches} de ritmo)` : ''}` : ''}${ctas.length ? `, ${ctas.length} chamada(s) na tela` : ''} (${picks[0].by === 'llm' ? 'diretor de IA' : 'escolha local: revise antes de aplicar'}).`],
    };
  },
};

/** Papéis de frase que merecem aproximação no rosto. */
const WEIGHTY = new Set(['thesis', 'climax', 'question', 'emotion', 'scripture', 'conclusion']);

/** Primeiro clipe de fala com câmera (para localizar o rosto quando o destaque cai sobre imagem). */
function mainTalkingClip(p: Project): Clip | null {
  const skip = new Set(p.tracks.filter((t) => ['B-roll', 'Gráficos', 'Legendas', 'Chamadas'].includes(t.name)).map((t) => t.id));
  return Object.values(p.clips).find((c) => !skip.has(c.trackId) && p.assets[c.assetId]?.kind === 'video' && c.origin?.by !== 'ai') ?? null;
}

export const DEFAULT_LETTERING: LetteringStyle = { fontFamily: '"Playfair Display", Georgia, serif', fontWeight: 700, fontSize: 0.064, color: '#ffffff', emphasisColor: '#e2b867', uppercase: false, letterSpacing: 0, wordAnim: 'rise' };

const norm = (t: string) => tokens(t)[0] ?? '';

/**
 * As palavras ditas que formam o destaque, dentro da frase: a janela da fala que começa na primeira
 * palavra do texto e cobre o mesmo número de palavras. Se o texto veio do roteiro (redação corrigida),
 * as palavras ganham essa redação, mantendo os tempos da fala.
 */
export function phraseWords(words: { text: string; start: number; end: number }[], sentence: { start: number; end: number }, text: string): { text: string; start: number; end: number }[] {
  const inside = words.filter((w) => w.start >= sentence.start - 0.05 && w.end <= sentence.end + 0.05);
  const target = text.replace(/[“”"]/g, '').trim().split(/\s+/).filter(Boolean);
  if (!inside.length || !target.length) return [];
  const first = norm(target[0]);
  let i = inside.findIndex((w) => norm(w.text) === first);
  if (i < 0) i = 0;
  const span = inside.slice(i, i + target.length);
  return span.map((w, k) => ({ text: target[k] ?? w.text, start: w.start, end: w.end }));
}

/** Legenda-lettering: palavra por palavra no tempo da fala, sem caixa, palavra-chave em destaque. */
export function letteringCaption(phrase: { text: string; start: number; end: number }[], start: number, L: LetteringStyle, zone: Zone, chapter: boolean, short: boolean): CaptionData {
  const marked = autoEmphasis(phrase.map((w) => ({ text: w.text, start: w.start - start, end: w.end - start })));
  // sem palavra marcada pelo dicionário: a mais longa vira a palavra-chave
  if (!chapter && !marked.some((w) => w.emphasis)) {
    let best = 0;
    marked.forEach((w, i) => (w.text.replace(/[^\p{L}]/gu, '').length > marked[best].text.replace(/[^\p{L}]/gu, '').length ? (best = i) : 0));
    marked[best] = { ...marked[best], emphasis: true };
  }
  const style: CaptionStyle = {
    preset: chapter ? 'lettering-capitulo' : 'lettering',
    fontFamily: L.fontFamily,
    fontWeight: chapter ? Math.min(700, L.fontWeight) : L.fontWeight,
    fontSize: chapter ? L.fontSize * 0.62 : short ? L.fontSize * 1.15 : L.fontSize,
    color: chapter ? L.emphasisColor : L.color,
    highlightColor: L.color,
    strokeColor: '#000000',
    strokeWidth: 0,
    shadow: true,
    background: null,
    uppercase: chapter || L.uppercase,
    y: chapter ? Math.max(0.12, zone.cy - 0.14) : zone.cy,
    mode: chapter ? 'block' : 'reveal',
    pop: false,
    letterSpacing: chapter ? 0.14 : L.letterSpacing,
    lineHeight: 1.12,
    maxWidth: Math.min(0.86, zone.width),
    shadowColor: 'rgba(0,0,0,0.55)',
    shadowBlur: 0.4,
    shadowOffset: 0.03,
    emphasisColor: L.emphasisColor,
    animIn: 'fade',
    animOut: 'blur',
    animDuration: 0.35,
    wordAnim: chapter ? 'none' : L.wordAnim,
  };
  return { style, words: marked };
}
