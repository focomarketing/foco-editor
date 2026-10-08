// Etapa 1 · Corte: transcription (garante a fala transcrita) e rough-cut-builder (corte pela
// onda, no ritmo do preset/tipo). Cada trecho é uma sugestão separada, com confiança e motivo.

import { newId } from '../../core/time';
import { planSmartCuts, SMART_CUT_LABEL, DEFAULT_OPTIONS } from '../../engine/cut/smartCut';
import type { SmartCutKind } from '../../engine/cut/smartCut';
import type { EditCommand } from '../commands/types';
import type { Skill } from '../orchestrator/orchestrator';

/** Pausas são seguras; repetições pedem mais atenção. */
const CONFIDENCE: Record<SmartCutKind, number> = { pause: 0.92, filler: 0.85, stutter: 0.85, falseStart: 0.75, retake: 0.7 };

export const transcriptionSkill: Skill = {
  id: 'transcription',
  stage: 'cut',
  label: 'Transcrição',
  modes: ['audio-led', 'script-led', 'manual-assisted'],
  core: true,
  async run(ctx) {
    await ctx.services.ensureTranscripts(ctx.progress);
    return { commands: [] };
  },
};

export const roughCutSkill: Skill = {
  id: 'rough-cut-builder',
  stage: 'cut',
  label: 'Corte pela onda',
  modes: ['audio-led', 'script-led', 'manual-assisted'],
  core: true,
  async run(ctx) {
    const words = ctx.words();
    if (!words.length) return { commands: [], warnings: ['Sem fala transcrita na timeline: nada para cortar.'] };
    ctx.progress('Medindo a fala na onda do áudio…', 0, 1);
    const waves = new Map<string, Float32Array>();
    for (const id of new Set(words.map((w) => w.assetId))) {
      const lv = await ctx.services.levels(id);
      if (lv) waves.set(id, lv);
    }
    // aggressive-cut habilitado no preset (curtos) força o ritmo seco
    const aggressive = ctx.workflow?.enabledSkills?.includes('aggressive-cut') && ctx.workflow?.track === 'short';
    const mode = aggressive ? 'dry' : (ctx.workflow?.defaults.cutMode ?? 'natural');
    const { cuts } = planSmartCuts(words, waves, { ...DEFAULT_OPTIONS, mode });
    const p = ctx.project();
    const commands: EditCommand[] = cuts.map((c) => ({
      id: newId('k'),
      projectId: p.id,
      type: 'ripple_remove',
      start: c.start,
      end: c.end,
      createdBy: 'ai',
      skill: 'rough-cut-builder',
      confidence: CONFIDENCE[c.kind],
      reason: `${SMART_CUT_LABEL[c.kind]}: ${c.reason}${c.text ? ` ("${c.text}")` : ''}`,
      reversible: true,
      payload: { ranges: [[c.start, c.end]], label: SMART_CUT_LABEL[c.kind] },
    }));
    const removed = cuts.reduce((s, c) => s + c.end - c.start, 0);
    return {
      commands,
      notes: [cuts.length ? `${cuts.length} trechos para cortar (${removed.toFixed(1).replace('.', ',')} s) no ritmo ${mode}.` : 'A fala já está limpa neste ritmo: nada a cortar.'],
    };
  },
};
