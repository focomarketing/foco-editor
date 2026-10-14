// Etapa 6 · caption-designer: legendas da fala inteira no estilo do canal (perfil) ou do tipo de
// vídeo. Com roteiro de referência, as palavras que o Whisper errou são corrigidas pela redação
// do roteiro onde a troca é segura. Legendas feitas por você ficam: a etapa não duplica nem apaga.

import { newId } from '../../core/time';
import { buildCaptionClips, getPreset } from '../../engine/captions/captions';
import type { TimelineWord } from '../../engine/captions/captions';
import { projectDuration } from '../../engine/timeline/operations';
import type { EditCommand } from '../commands/types';
import type { Skill } from '../orchestrator/orchestrator';
import { fixWords } from '../narrative/reference';

export const captionDesignerSkill: Skill = {
  id: 'caption-designer',
  stage: 'captions',
  label: 'Legendas no estilo do canal',
  modes: ['audio-led', 'script-led', 'manual-assisted'],
  async run(ctx) {
    const raw = ctx.words();
    if (!raw.length) return { commands: [], warnings: ['Sem fala transcrita: não há o que legendar.'] };
    const p = ctx.project();
    const track = p.tracks.find((t) => t.kind === 'video' && t.name === 'Legendas');
    const mine = track ? Object.values(p.clips).filter((c) => c.trackId === track.id && c.caption && c.origin?.by !== 'ai') : [];
    if (mine.length) return { commands: [], warnings: [`Já há ${mine.length} legenda(s) suas na trilha Legendas: ficaram como estão. Para a IA refazer no estilo do canal, apague essa trilha e rode a etapa de novo.`] };
    const presetId = ctx.profile.captionPreset ?? ctx.workflow?.defaults.captionPreset ?? 'youtube';
    const brief = await ctx.brief();
    ctx.progress('Montando as legendas…', 0, 1);
    // a legenda não passa do fim da fala do trecho de onde a palavra veio
    const segEnd = new Map<number, number>();
    for (const w of raw) segEnd.set(w.seg, Math.max(segEnd.get(w.seg) ?? 0, w.end + 0.6));
    let words: TimelineWord[] = raw.map((w) => ({ text: w.text, start: w.start, end: w.end, limit: Math.min(projectDuration(p), segEnd.get(w.seg) ?? w.end + 0.6) }));
    let fixed = 0;
    if (brief?.sentences.some((s) => s.script)) {
      const out: TimelineWord[] = [];
      const taken = new Set<TimelineWord>();
      for (const s of brief.sentences) {
        const inside = words.filter((w) => w.start >= s.start - 0.01 && w.end <= s.end + 0.01);
        inside.forEach((w) => taken.add(w));
        if (!s.script) {
          out.push(...inside);
          continue;
        }
        const f = fixWords(inside, s.script);
        fixed += f.filter((w) => !inside.some((x) => x.start === w.start && x.text === w.text)).length;
        out.push(...f);
      }
      // palavras fora de qualquer frase do mapa continuam como foram ditas
      words = [...out, ...words.filter((w) => !taken.has(w))].sort((a, b) => a.start - b.start);
    }
    const clips = buildCaptionClips(words, 'role:captions', presetId);
    const commands: EditCommand[] = clips.map((c) => ({
      id: newId('k'),
      projectId: p.id,
      type: 'add_caption',
      start: +c.start.toFixed(3),
      end: +(c.start + c.duration).toFixed(3),
      createdBy: 'ai',
      skill: 'caption-designer',
      confidence: 0.8,
      reason: 'legenda da fala',
      reversible: true,
      payload: { role: 'captions', caption: c.caption!, label: c.caption!.words.map((w) => w.text).join(' ').slice(0, 60) },
    }));
    return {
      commands,
      notes: [`${commands.length} legendas no estilo "${getPreset(presetId).label}"${fixed ? `, ${fixed} palavra(s) corrigida(s) pelo roteiro` : ''}.`],
    };
  },
};
