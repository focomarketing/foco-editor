// Etapa 1 · colorista (skill professional-video-editor do projeto): corrige a cor da gravação
// como um colorista, não como um filtro. Mede o material (exposição, percentis, balanço, croma);
// com a IA que enxerga, o Claude olha quadros reais seguindo a skill do colorista; sem ela, a
// correção automática do editor entra pela metade. Regra da skill: preservar > corrigir > melhorar;
// "nenhuma correção necessária" é uma resposta boa. Limites de segurança em todos os valores.

import type { Clip, ColorSettings, Project } from '../../core/types';
import { newId } from '../../core/time';
import { NEUTRAL_COLOR } from '../../engine/color/color';
import { askJsonVision } from '../../engine/ai/providers';
import type { EditCommand } from '../commands/types';
import type { Skill } from '../orchestrator/orchestrator';
import { skillsFor } from '../knowledge/skills';
import { visionReady } from './common';
import { isProtected } from '../validation/validate';

/** Faixas de segurança: o colorista corrige, não estiliza. */
const LIMITS: Record<'exposure' | 'contrast' | 'highlights' | 'shadows' | 'saturation' | 'vibrance' | 'temperature' | 'tint', number> = {
  exposure: 0.6,
  contrast: 0.2,
  highlights: 0.3,
  shadows: 0.3,
  saturation: 0.15,
  vibrance: 0.2,
  temperature: 0.25,
  tint: 0.2,
};
type Field = keyof typeof LIMITS;
const FIELDS = Object.keys(LIMITS) as Field[];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['needed', 'reason', ...FIELDS],
  properties: {
    needed: { type: 'boolean', description: 'false quando a imagem já está boa (resposta desejável)' },
    reason: { type: 'string', description: 'o que está errado e o que a correção resolve, em português, uma frase' },
    ...Object.fromEntries(FIELDS.map((f) => [f, { type: 'number' }])),
  },
} as const;

/** Clipes principais com câmera (não B-roll, não gráficos, não gerados pela IA, sem cor manual). */
export function mainVideoClips(p: Project): Clip[] {
  const skip = new Set(p.tracks.filter((t) => ['B-roll', 'Gráficos', 'Legendas'].includes(t.name) || t.kind !== 'video').map((t) => t.id));
  return Object.values(p.clips).filter((c) => !skip.has(c.trackId) && p.assets[c.assetId]?.kind === 'video' && c.origin?.by !== 'ai' && !isProtected(p, c) && (!c.color || c.color.preset === 'colorista'));
}

const clamp = (f: Field, v: unknown) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.round(Math.max(-LIMITS[f], Math.min(LIMITS[f], n)) * 100) / 100;
};

/** Valores da correção dentro dos limites; null se nada muda de fato (abaixo do perceptível). */
export function safeCorrection(values: Partial<Record<Field, unknown>>): Partial<ColorSettings> | null {
  const out: Partial<ColorSettings> = {};
  for (const f of FIELDS) out[f] = clamp(f, values[f]);
  const visible = Math.abs(out.exposure!) >= 0.1 || FIELDS.some((f) => f !== 'exposure' && Math.abs(out[f]!) >= 0.04);
  return visible ? out : null;
}

/** Sem IA que enxerga: metade da correção automática do editor (matemática do material). */
export function halfAuto(auto: ColorSettings): Partial<Record<Field, number>> {
  return Object.fromEntries(FIELDS.map((f) => [f, (auto[f] ?? 0) * 0.5])) as Partial<Record<Field, number>>;
}

export const coloristSkill: Skill = {
  id: 'professional-video-editor',
  stage: 'cut',
  label: 'Colorista',
  modes: ['audio-led', 'script-led', 'manual-assisted'],
  core: true,
  when: (ctx) => mainVideoClips(ctx.project()).length > 0 && !!ctx.services.color,
  async run(ctx) {
    const p = ctx.project();
    const clips = mainVideoClips(p);
    const byAsset = new Map<string, Clip[]>();
    for (const c of clips) byAsset.set(c.assetId, [...(byAsset.get(c.assetId) ?? []), c]);
    const commands: EditCommand[] = [];
    const notes: string[] = [];
    let i = 0;
    for (const [assetId, list] of byAsset) {
      ctx.signal.throwIfAborted();
      const a = p.assets[assetId];
      ctx.progress(`Colorista analisando "${a.name}"…`, i++, byAsset.size);
      const measured = await ctx.services.color!(assetId).catch(() => null);
      if (!measured) continue;
      const { stats, settings: auto } = measured;
      let values: Partial<Record<Field, unknown>> | null = null;
      let why = 'correção automática do editor, pela metade (sem IA que enxergue os quadros)';
      if (visionReady(ctx.ai) && ctx.services.frames) {
        try {
          const frames = await ctx.services.frames(assetId, [0.2, 0.5, 0.8].map((k) => a.duration * k));
          if (frames.length) {
            const raw = (await askJsonVision(
              ctx.ai,
              `${skillsFor('color', 14000) || 'Você é colorista profissional: preservar > corrigir > melhorar; prefira não mudar.'}\n\nVocê está dentro do FOCO Editor. Devolva só os ajustes (escala do editor): exposure em EV (-2..2), os outros de -1 a 1 (temperature: + esquenta; tint: + magenta, - verde). needed=false se não há correção significativa. Corrija só o que está errado na gravação (exposição, balanço de branco, contraste lavado); luz colorida de cenário que é intencional (ex.: luz verde no fundo) não se "corrige": proteja a pele.`,
              `Quadros da gravação principal "${a.name}". Medição: luminância média ${stats.luma.toFixed(2)}, preto ${stats.p02.toFixed(2)}, branco ${stats.p98.toFixed(2)}, médias RGB ${stats.r.toFixed(2)}/${stats.g.toFixed(2)}/${stats.b.toFixed(2)}, croma ${stats.chroma.toFixed(2)}. A correção automática da matemática do editor seria: ${JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, auto[f]])))}. Analise, decida e devolva a correção (ou needed=false).`,
              frames.map((base64) => ({ base64, mediaType: 'image/jpeg' as const })),
              SCHEMA as unknown as Record<string, unknown>,
              ctx.signal,
            )) as Record<string, unknown>;
            values = raw.needed === false ? null : raw;
            why = String(raw.reason ?? '').slice(0, 200) || 'correção do colorista';
            if (!values) notes.push(`"${a.name}": o colorista não viu correção necessária (${why}).`);
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          ctx.log(`colorista com IA indisponível: ${e instanceof Error ? e.message : e}`);
          values = halfAuto(auto);
        }
      } else values = halfAuto(auto);
      const corr = values ? safeCorrection(values) : null;
      if (!corr) continue;
      for (const c of list)
        commands.push({
          id: newId('k'),
          projectId: p.id,
          type: 'apply_lut',
          start: c.start,
          createdBy: 'ai',
          skill: 'professional-video-editor',
          confidence: 0.7,
          reason: `colorista: ${why}`,
          reversible: true,
          payload: { clipId: c.id, color: { ...NEUTRAL_COLOR, ...(c.color ?? {}), ...corr, preset: 'colorista' }, label: 'Cor (colorista)' },
        });
      notes.push(`"${a.name}": ${why}.`);
    }
    return { commands, notes };
  },
};
