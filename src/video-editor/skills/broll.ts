// Etapa 2 · Imagens: broll-selector (acervos externos pela fala). O diretor (LLM) escolhe as
// frases e o que buscar; sem IA, heurística local (com confiança baixa: vai para revisão).

import { newId } from '../../core/time';
import { askJson } from '../../engine/ai/providers';
import { MOMENTS_SCHEMA, density, directorPrompt, heuristicMoments, kenBurns, validateMoments } from '../../engine/images/broll';
import type { Moment } from '../../engine/images/broll';
import { projectDuration } from '../../engine/timeline/operations';
import type { EditCommand } from '../commands/types';
import type { Skill, SkillContext } from '../orchestrator/orchestrator';
import { findImage } from '../assets/hub';

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

export const ARCHIVE_SUBTYPES = ['cristao', 'documentario', 'dark'];

export async function chooseMoments(ctx: SkillContext): Promise<{ moments: Moment[]; by: 'llm' | 'heuristic' }> {
  const p = ctx.project();
  const words = ctx.words();
  const duration = projectDuration(p);
  const short = ctx.workflow?.track === 'short' || p.settings.height > p.settings.width;
  const d = density({ short, duration });
  const s = ctx.ai;
  const llmReady = s.provider === 'ollama' || (!!s.claudeKey && s.cloudConsent);
  if (llmReady && words.length) {
    try {
      ctx.progress('O diretor está lendo a fala e escolhendo as imagens…', 0, 1);
      const wf = ctx.workflow;
      const kind = wf ? `${wf.track === 'short' ? 'vídeo curto vertical' : 'vídeo longo'}${wf.subtype ? ` (${wf.subtype})` : ''}` : 'vídeo';
      const archive = !!wf && ARCHIVE_SUBTYPES.includes(wf.subtype ?? '');
      const raw = await askJson(s, directorPrompt({ kind, short, archive, count: d.count, min: d.min, max: d.max }), `Duração: ${duration.toFixed(1)} s\n\n${speechLines(words).join('\n')}`, MOMENTS_SCHEMA as unknown as Record<string, unknown>, ctx.signal);
      const moments = validateMoments(raw, duration, d);
      if (moments.length) return { moments, by: 'llm' };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      ctx.log(`diretor de IA indisponível: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { moments: heuristicMoments(words, duration, d), by: 'heuristic' };
}

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
    if (!moments.length) return { commands: [], warnings: [taken.length ? 'Os takes de apoio já cobrem os momentos que pediam imagem.' : 'Não encontrei momentos que peçam imagem.'] };
    const p = ctx.project();
    const vertical = p.settings.height > p.settings.width;
    const archive = !ctx.workflow || ARCHIVE_SUBTYPES.includes(ctx.workflow.subtype ?? '');
    const picked: { m: Moment; file: File; license: NonNullable<EditCommand['payload']['license']> }[] = [];
    const used = new Set<string>();
    for (const [i, m] of moments.entries()) {
      ctx.signal.throwIfAborted();
      ctx.progress(`Buscando imagem ${i + 1} de ${moments.length}: "${m.query}"`, i, moments.length);
      const hit = await findImage([m.query, m.queryAlt].filter(Boolean), { vertical, preferArchive: archive, exclude: used, signal: ctx.signal });
      if (!hit) continue;
      used.add(hit.license.sourceUrl);
      picked.push({ m, file: hit.file, license: hit.license });
    }
    const missing = moments.length - picked.length;
    if (!picked.length) return { commands: [], warnings: ['Os acervos não devolveram imagens para estas falas (sem mídia compatível).'] };
    ctx.progress(`Preparando ${picked.length} imagens…`, moments.length, moments.length);
    const assets = await ctx.services.importFiles(picked.map((x) => x.file));
    const commands: EditCommand[] = [];
    picked.forEach(({ m, file, license }, i) => {
      const a = assets.get(file.name);
      if (!a || !a.width) return;
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
        confidence: by === 'llm' ? 0.75 : 0.45,
        reason: m.why || `ilustra: "${m.text.slice(0, 80)}"`,
        reversible: true,
        payload: { assetId: a.id, role: 'broll', scale: kb.scale, keyframes: kb.keyframes, license, label: m.query },
      });
    });
    return {
      commands,
      notes: [`${commands.length} imagens sugeridas (${by === 'llm' ? 'diretor de IA' : 'escolha automática local: revise antes de aplicar'}).`],
      warnings: missing > 0 ? [`${missing} momento(s) sem imagem compatível nos acervos.`] : [],
    };
  },
};
