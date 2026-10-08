// Etapa 3 · professional-transition-designer: analisa cada corte (movimento, cor, mudança
// visual, fala, batida, energia, legenda) e decide como um diretor de montagem. O padrão é o
// corte seco; transição só quando há motivo. Cada sugestão vem com preset, parâmetros,
// confiança e motivo, e passa pelo preview/aprovação como as outras etapas.

import type { Clip, Project } from '../../core/types';
import { newId } from '../../core/time';
import { sourceEnd, toTimeline } from '../../core/clipTime';
import { clipEnd } from '../../engine/timeline/operations';
import { cutPairs } from '../../engine/render/transitions';
import type { EditCommand } from '../commands/types';
import type { Skill, SkillContext } from '../orchestrator/orchestrator';
import { colorName, detectBeats, energyAt, globalShift, meanColor, motionDirection, motionMatches, toGray, visualDistance } from '../transitions/analysis';
import type { Pixels } from '../transitions/analysis';
import { decide, formatFor, newDirectorState } from '../transitions/director';
import type { CutFeatures, DecisionType, EditFormat } from '../transitions/director';
import { transitionById } from '../transitions/library';

/** Níveis de áudio: 100 valores por segundo (WAVEFORM_RATE). */
const RATE = 100;
const MAX_CUTS = 150;

/** Batidas da música na timeline (faixas de música ou áudio sem fala). */
export async function musicBeats(ctx: SkillContext): Promise<number[]> {
  const p = ctx.project();
  const music = p.tracks.filter((t) => t.kind === 'audio' && !t.muted && /m[uú]sica|music/i.test(t.name)).map((t) => t.id);
  const out: number[] = [];
  for (const c of Object.values(p.clips).filter((x) => music.includes(x.trackId))) {
    const lv = await ctx.services.levels(c.assetId);
    if (!lv) continue;
    for (const s of detectBeats(lv, RATE)) if (s >= c.sourceIn && s <= sourceEnd(c)) out.push(toTimeline(c, s));
  }
  return out.sort((a, b) => a - b);
}

async function look(ctx: SkillContext, c: Clip, srcTime: number): Promise<Pixels | null> {
  if (!ctx.services.pixels) return null;
  try {
    return await ctx.services.pixels(c.assetId, Math.max(0, srcTime), 64);
  } catch {
    return null;
  }
}

/** Características do corte entre A e B. */
export async function cutFeatures(ctx: SkillContext, a: Clip, b: Clip, role: 'main' | 'broll', beats: number[]): Promise<CutFeatures> {
  const p = ctx.project();
  const cut = b.start;
  const still = (c: Clip) => p.assets[c.assetId]?.kind === 'image';
  const [a1, a2, b1, b2] = await Promise.all([
    still(a) ? null : look(ctx, a, sourceEnd(a) - 0.3),
    look(ctx, a, sourceEnd(a) - 0.04),
    look(ctx, b, b.sourceIn + 0.04),
    still(b) ? null : look(ctx, b, b.sourceIn + 0.3),
  ]);
  const shift = (x: Pixels | null, y: Pixels | null) => (x && y && x.width === y.width ? globalShift(toGray(x), toGray(y)) : null);
  const va = shift(a1, a2);
  const vb = shift(b1, b2);
  const words = ctx.words();
  const before = words.filter((w) => w.end <= cut + 0.02).pop();
  const after = words.find((w) => w.start >= cut - 0.02);
  const pauseBefore = before ? Math.max(0, (after?.start ?? cut) - before.end) : 5;
  const cutInWord = words.some((w) => w.start + 0.04 < cut && w.end - 0.04 > cut);
  const keyWordsNear = words.filter((w) => w.end > cut - 0.3 && w.start < cut + 0.3 && w.text.replace(/[^\p{L}]/gu, '').length > 4).length;
  const beat = beats.reduce<number | null>((best, t) => (Math.abs(t - cut) <= 0.15 && (best === null || Math.abs(t - cut) < Math.abs(best - cut)) ? t : best), null);
  const levels = p.assets[b.assetId]?.hasAudio ? await ctx.services.levels(b.assetId) : null;
  const captions = Object.values(p.clips).some((c) => !!c.caption && c.start <= cut && clipEnd(c) > cut);
  return {
    cut,
    aDuration: a.duration,
    bDuration: b.duration,
    jumpCut: a.assetId === b.assetId && b.sourceIn >= sourceEnd(a) - 0.05,
    role,
    motionA: motionDirection(va),
    motionB: motionDirection(vb),
    motionMatch: motionMatches(va, vb),
    visualChange: a2 && b1 ? visualDistance(a2, b1) : null,
    colorA: a2 ? colorName(meanColor(a2)) : undefined,
    colorB: b1 ? colorName(meanColor(b1)) : undefined,
    pauseBefore,
    cutInWord,
    keyWordsNear,
    beat,
    energy: energyAt(levels, RATE, b.sourceIn, b.sourceIn + 0.5),
    captions,
  };
}

export function formatOfProject(ctx: SkillContext): EditFormat {
  const p = ctx.project();
  return formatFor(ctx.workflow?.template, ctx.workflow?.subtype, p.settings.height > p.settings.width);
}

const TYPE_LABEL: Record<DecisionType, string> = {
  'corte-seco': 'corte seco',
  'corte-por-acao': 'corte por ação',
  'match-cut': 'match cut',
  movimento: 'por movimento',
  objeto: 'por objeto',
  mascara: 'por máscara',
  audio: 'na batida',
  estilizada: 'estilizada',
  nenhuma: 'sem transição',
};

export const transitionDesignerSkill: Skill = {
  id: 'professional-transition-designer',
  stage: 'transitions',
  label: 'Transições profissionais',
  modes: ['audio-led', 'script-led', 'manual-assisted'],
  when: (ctx) => cutPairs(ctx.project()).length > 0,
  async run(ctx) {
    const p: Project = ctx.project();
    const pairs = cutPairs(p).slice(0, MAX_CUTS);
    const format = formatOfProject(ctx);
    ctx.progress('Ouvindo a música para achar as batidas…', 0, pairs.length + 1);
    const beats = await musicBeats(ctx);
    const roleOf = (trackId: string) => (p.tracks.find((t) => t.id === trackId)?.name === 'B-roll' ? 'broll' : 'main');
    const state = newDirectorState();
    const commands: EditCommand[] = [];
    const tally = new Map<DecisionType, number>();
    let kept = 0;
    for (const [i, { a, b, trackId }] of pairs.entries()) {
      ctx.signal.throwIfAborted();
      ctx.progress(`Analisando o corte ${i + 1} de ${pairs.length}`, i + 1, pairs.length + 1);
      // a escolha manual do usuário fica como está
      if (b.transitionIn && b.transitionIn.by !== 'ai') {
        kept++;
        continue;
      }
      const f = await cutFeatures(ctx, a, b, roleOf(trackId), beats);
      const d = decide(f, format, state, pairs.length);
      tally.set(d.type, (tally.get(d.type) ?? 0) + 1);
      if (!d.presetId) continue;
      const preset = transitionById(d.presetId)!;
      const params = d.direction ? { direction: d.direction } : undefined;
      const transition = { type: preset.id, duration: d.duration, intensity: d.intensity, easing: preset.parameters.easing, ...(d.offset ? { offset: +d.offset.toFixed(3) } : {}), ...(params ? { params } : {}) };
      const start = preset.align === 'center' ? b.start + d.offset - d.duration / 2 : b.start;
      commands.push({
        id: newId('k'),
        projectId: p.id,
        type: 'add_transition',
        start: +start.toFixed(3),
        end: +(preset.align === 'hold' ? clipEnd(b) : start + d.duration).toFixed(3),
        createdBy: 'ai',
        skill: 'professional-transition-designer',
        confidence: d.confidence,
        reason: d.reason,
        reversible: true,
        payload: { clipId: b.id, clipBeforeId: a.id, transitionId: preset.id, transition, prevTransition: b.transitionIn ?? null, label: preset.name, decision: d.type },
      });
    }
    const dry = pairs.length - kept - commands.length;
    const detail = [...tally].filter(([, n]) => n).map(([t, n]) => `${n} ${TYPE_LABEL[t]}`).join(', ');
    return {
      commands,
      notes: [`${pairs.length} corte(s) analisados (${format}): ${commands.length} com transição, ${dry} no corte seco${beats.length ? `, ${beats.length} batidas na música` : ''}. ${detail}.`],
      warnings: [
        ...(kept ? [`${kept} transição(ões) escolhidas por você foram mantidas.`] : []),
        ...(cutPairs(p).length > MAX_CUTS ? [`Analisei os primeiros ${MAX_CUTS} cortes.`] : []),
        ...(!ctx.services.pixels ? ['Sem leitura de quadros: decisões só pela fala e pelo áudio.'] : []),
      ],
    };
  },
};
