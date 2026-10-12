// Etapa 2 · Imagens: broll-selector (acervos externos pela fala). Tudo parte do mapa narrativo:
// a imagem entra onde a frase carrega uma ideia visual do bloco (tema do perfil do canal), com
// as buscas curadas do perfil ou as do diretor de IA. Cada imagem achada passa pelo filtro de
// contexto (termos proibidos no canal, título que corresponde à busca, tamanho mínimo).

import { newId } from '../../core/time';
import { askJson } from '../../engine/ai/providers';
import { MOMENTS_SCHEMA, density, directorPrompt, kenBurns, validateMoments } from '../../engine/images/broll';
import type { Moment } from '../../engine/images/broll';
import { projectDuration } from '../../engine/timeline/operations';
import type { EditCommand } from '../commands/types';
import type { Skill, SkillContext } from '../orchestrator/orchestrator';
import { findImage, relevantTo } from '../assets/hub';
import { briefText } from '../narrative/brief';
import type { BriefSentence, NarrativeBrief } from '../narrative/brief';
import { imageAllowed, themeById } from '../narrative/profiles';
import type { BeatRole, EditorialProfile } from '../narrative/profiles';
import { llmReady } from './common';

/** Frases com tempo, uma por linha, para o diretor. */
export function speechLines(words: { text: string; start: number; end: number }[]): string[] {
  const lines: string[] = [];
  let cur: string[] = [];
  let t0 = words[0]?.start ?? 0;
  words.forEach((w, i) => {
    cur.push(w.text.trim());
    const next = words[i + 1];
    if (!next || /[.!?…]$/.test(w.text.trim()) || next.start - w.end > 0.8) {
      lines.push(`[${t0.toFixed(1)}–${w.end.toFixed(1)}] ${cur.join(' ')}`);
      cur = [];
      if (next) t0 = next.start;
    }
  });
  return lines;
}

/** Frases do mapa com o bloco e o papel (o diretor vê onde cada fala está na narrativa). */
export function briefLines(b: NarrativeBrief): string[] {
  return b.sentences.map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}] (bloco ${s.section} · ${s.role}) ${s.text}`);
}

export const ARCHIVE_SUBTYPES = ['cristao', 'documentario', 'dark'];

/** Peso de cada papel na escolha das imagens (frases que carregam o bloco primeiro). */
const ROLE_WEIGHT: Partial<Record<BeatRole, number>> = { chapter: 3, thesis: 2.5, climax: 2.5, scripture: 2.5, example: 2.2, conclusion: 1.6, question: 1.4, hook: 1.4, argument: 1 };

type D = ReturnType<typeof density>;

/**
 * Momentos pelo mapa: frases com papel que aceita imagem e uma ideia visual (tema do perfil ou
 * o que o diretor de IA descreveu). Espaçadas, sem repetir o mesmo tema perto, buscas curadas.
 */
export function briefMoments(b: NarrativeBrief, profile: EditorialProfile, d: D, duration: number): Moment[] {
  const themeRank = (id: string) => profile.themes.findIndex((t) => t.id === id);
  const cands = b.sentences
    .filter((s) => s.index > 0 && profile.brollRoles.includes(s.role) && (s.query || s.themes.length))
    .map((s) => {
      const theme = s.themes[0];
      const rank = theme ? themeRank(theme) : profile.themes.length;
      const specific = theme ? 2 * (1 - rank / Math.max(1, profile.themes.length)) : 0;
      return { s, theme, score: (ROLE_WEIGHT[s.role] ?? 1) + specific + (s.query ? 1.5 : 0) + Math.min(1, (s.end - s.start) / d.min) * 0.5 };
    })
    .sort((x, y) => y.score - x.score);
  const chosen: typeof cands = [];
  const themeGap = d.gap * 8; // o mesmo tema não volta logo em seguida
  for (const c of cands) {
    if (chosen.length >= d.count) break;
    if (chosen.some((o) => c.s.start < o.s.end + d.gap && c.s.end > o.s.start - d.gap)) continue;
    if (c.theme && chosen.some((o) => o.theme === c.theme && Math.abs(o.s.start - c.s.start) < themeGap)) continue;
    chosen.push(c);
  }
  const used = new Map<string, number>();
  return chosen
    .sort((x, y) => x.s.start - y.s.start)
    .map(({ s, theme }) => {
      const th = theme ? themeById(profile, theme) : undefined;
      let query = s.query ?? '';
      let queryAlt = '';
      if (th) {
        const k = used.get(th.id) ?? 0;
        used.set(th.id, k + 1);
        const rot = (i: number) => th.queries[(k + i) % th.queries.length];
        if (!query) query = rot(0);
        queryAlt = rot(query === rot(0) ? 1 : 0);
      }
      const start = Math.max(0, s.start);
      return { start, end: Math.min(duration, start + Math.min(d.max, Math.max(d.min, s.end - s.start))), text: s.text, why: s.visual || (th ? `${th.label}: mostra a ideia da frase dentro do bloco` : 'ilustra a ideia da frase'), query, queryAlt };
    })
    .filter((m) => m.query);
}

/** Densidade das imagens: a do formato, com o ritmo do perfil no vídeo longo. */
export function paceFor(profile: EditorialProfile, short: boolean, duration: number): D {
  const d = density({ short, duration });
  const pace = !short && profile.brollPace;
  return pace ? { ...d, min: pace.min, max: pace.max, count: Math.max(2, Math.min(30, Math.round(duration / pace.every))) } : d;
}

/** Frase do mapa que contém o instante (para conferir o momento que o diretor devolveu). */
const sentenceOf = (b: NarrativeBrief, t: number): BriefSentence | undefined => b.sentences.find((s) => t >= s.start - 0.3 && t < s.end);

export async function chooseMoments(ctx: SkillContext): Promise<{ moments: Moment[]; by: 'llm' | 'heuristic' }> {
  const p = ctx.project();
  const words = ctx.words();
  const duration = projectDuration(p);
  const short = ctx.workflow?.track === 'short' || p.settings.height > p.settings.width;
  const brief = await ctx.brief();
  if (!brief) return { moments: [], by: 'heuristic' };
  const profile = ctx.profile;
  const d = paceFor(profile, short, duration);
  // o diretor editorial (IA) já disse o que mostrar em cada frase: usa direto
  if (brief.by === 'llm') {
    const fromBrief = briefMoments({ ...brief, sentences: brief.sentences.map((s) => ({ ...s, themes: s.query ? s.themes : [] })) }, profile, d, duration);
    if (fromBrief.length >= Math.min(d.count, 3)) return { moments: fromBrief, by: 'llm' };
  }
  if (llmReady(ctx.ai) && words.length) {
    try {
      ctx.progress('O diretor está lendo a fala e escolhendo as imagens…', 0, 1);
      const kind = `${short ? 'vídeo curto vertical' : 'vídeo longo'} · ${profile.label}`;
      const raw = await askJson(
        ctx.ai,
        directorPrompt({ kind, short, archive: profile.archive, count: d.count, min: d.min, max: d.max, context: briefText(brief, profile), imageStyle: profile.imageStyle }),
        `Duração: ${duration.toFixed(1)} s\n\n${briefLines(brief).join('\n')}`,
        MOMENTS_SCHEMA as unknown as Record<string, unknown>,
        ctx.signal,
      );
      // o diretor não põe imagem em chamada para ação nem em papel que o canal deixa no rosto
      const moments = validateMoments(raw, duration, d).filter((m) => {
        const s = sentenceOf(brief, m.start + 0.05);
        return !s || profile.brollRoles.includes(s.role);
      });
      if (moments.length) return { moments, by: 'llm' };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      ctx.log(`diretor de IA indisponível: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { moments: briefMoments(brief, profile, d, duration), by: 'heuristic' };
}

/** Lado menor abaixo disto fica borrado em tela cheia (ícone, miniatura). */
const MIN_SIDE = 600;

export const brollSelectorSkill: Skill = {
  id: 'broll-selector',
  stage: 'images',
  label: 'Imagens de acervo pela fala',
  modes: ['audio-led', 'manual-assisted'],
  async run(ctx) {
    if (!ctx.words().length) return { commands: [], warnings: ['Sem fala transcrita: não há o que ilustrar.'] };
    const chosen = await chooseMoments(ctx);
    const by = chosen.by;
    // trechos que outra skill desta etapa já ocupou (ex.: takes do usuário) ficam com ela
    const taken = ctx.planned.filter((c) => (c.type === 'add_clip' || c.type === 'add_overlay') && !c.payload.title && c.start !== undefined && c.end !== undefined);
    const moments = chosen.moments.filter((m) => !taken.some((c) => m.start < c.end! + 1 && m.end > c.start! - 1));
    if (!moments.length) return { commands: [], warnings: [taken.length ? 'Os takes de apoio já cobrem os momentos que pediam imagem.' : 'Nenhuma frase pede imagem dentro da linha do vídeo: o rosto fica.'] };
    const p = ctx.project();
    const vertical = p.settings.height > p.settings.width;
    const profile = ctx.profile;
    const accept = (title: string, query: string) => imageAllowed(title, profile) && relevantTo(title, query);
    const picked: { m: Moment; file: File; license: NonNullable<EditCommand['payload']['license']>; title: string }[] = [];
    const used = new Set<string>();
    for (const [i, m] of moments.entries()) {
      ctx.signal.throwIfAborted();
      ctx.progress(`Buscando imagem ${i + 1} de ${moments.length}: "${m.query}"`, i, moments.length);
      const hit = await findImage([m.query, m.queryAlt].filter(Boolean), { vertical, preferArchive: profile.archive, exclude: used, signal: ctx.signal, accept });
      if (!hit) continue;
      used.add(hit.license.sourceUrl);
      picked.push({ m, file: hit.file, license: hit.license, title: hit.title });
    }
    if (!picked.length) return { commands: [], warnings: ['Os acervos não devolveram imagens que caibam no contexto destas falas: o rosto fica.'] };
    ctx.progress(`Preparando ${picked.length} imagens…`, moments.length, moments.length);
    const assets = await ctx.services.importFiles(picked.map((x) => x.file));
    const commands: EditCommand[] = [];
    let small = 0;
    picked.forEach(({ m, file, license, title }, i) => {
      const a = assets.get(file.name);
      if (!a || !a.width) return;
      if (Math.min(a.width, a.height) < MIN_SIDE) {
        small++;
        return;
      }
      const dur = m.end - m.start;
      const kb = kenBurns(a.width, a.height, p.settings.width, p.settings.height, dur, i);
      commands.push({
        id: newId('k'),
        projectId: p.id,
        type: 'add_overlay',
        start: m.start,
        end: m.end,
        createdBy: 'ai',
        skill: 'broll-selector',
        confidence: by === 'llm' ? 0.78 : 0.62,
        reason: `${m.why || `ilustra: "${m.text.slice(0, 80)}"`} · ${title.slice(0, 60)}`,
        reversible: true,
        payload: { assetId: a.id, role: 'broll', scale: kb.scale, keyframes: kb.keyframes, license, label: m.query },
      });
    });
    const missing = moments.length - commands.length;
    return {
      commands,
      notes: [`${commands.length} imagens dentro da linha do vídeo (${by === 'llm' ? 'diretor de IA' : `temas do perfil ${profile.label}: revise antes de aplicar`}).`],
      warnings: [
        ...(missing > 0 ? [`${missing} momento(s) ficaram no rosto: nenhuma imagem dos acervos coube no contexto.`] : []),
        ...(small ? [`${small} imagem(ns) pequena(s) demais para tela cheia descartada(s).`] : []),
      ],
    };
  },
};
