// Etapa 5 · audio-designer: trilha e efeitos sonoros pela narrativa. A trilha muda de clima por
// bloco (perfil do canal: séria na pergunta, contemplativa nos blocos, esperança na conclusão),
// sempre baixa sob a voz e com fades nas trocas; os efeitos marcam a abertura de cada bloco, a
// entrada dos títulos e das imagens, sem empilhar. Os sons vêm da biblioteca do FOCO (gerados
// aqui, sem licença) e entram como mídia do projeto.

import type { Project } from '../../core/types';
import { newId } from '../../core/time';
import { projectDuration } from '../../engine/timeline/operations';
import { soundById } from '../../engine/audio/soundLibrary';
import type { EditCommand } from '../commands/types';
import type { Skill } from '../orchestrator/orchestrator';
import type { NarrativeBrief } from '../narrative/brief';
import type { EditorialProfile } from '../narrative/profiles';

export interface MusicSpan {
  mood: string;
  start: number;
  end: number;
}

export interface SfxCue {
  id: string;
  at: number;
  duration: number;
  why: string;
}

export interface SoundPlan {
  music: MusicSpan[];
  sfx: SfxCue[];
}

/** Clima da trilha de cada bloco (blocos seguidos com o mesmo clima viram um trecho só). */
export function musicSpans(b: NarrativeBrief, profile: EditorialProfile, duration: number): MusicSpan[] {
  const m = profile.sound.music;
  const spans: MusicSpan[] = [];
  let blocks = 0;
  for (const sec of b.sections) {
    const pick = m[sec.kind] ?? null;
    // lista: os blocos alternam os climas na ordem
    const mood = Array.isArray(pick) ? pick[blocks++ % pick.length] : pick;
    if (!mood || !soundById(mood)) continue;
    const end = Math.min(duration, sec.end);
    const last = spans.at(-1);
    if (last && last.mood === mood && sec.start - last.end < 1) last.end = end;
    else spans.push({ mood, start: sec.start, end });
  }
  // a trilha vai até o fim do vídeo (sem buraco entre o último bloco e o fim)
  const last = spans.at(-1);
  if (last) last.end = duration;
  // trecho curto demais para um clima próprio: o vizinho cobre (a trilha não abre buraco)
  const out: MusicSpan[] = [];
  for (const [i, sp] of spans.entries()) {
    if (sp.end - sp.start >= 3) out.push(sp);
    else if (out.length) out[out.length - 1].end = sp.end;
    else if (spans[i + 1]) spans[i + 1].start = sp.start;
  }
  return out;
}

/** Efeitos: abertura de bloco (termina no corte), títulos da IA e entradas de B-roll. Sem sobrepor. */
export function sfxCues(p: Project, b: NarrativeBrief, profile: EditorialProfile): SfxCue[] {
  const fx = profile.sound.sfx;
  const cues: SfxCue[] = [];
  const dur = (id: string) => soundById(id)?.duration ?? 1;
  if (fx.chapter) for (const sec of b.sections.filter((s) => s.index > 0 && s.kind !== 'cta')) {
    const d = dur(fx.chapter);
    // risers e swells crescem até o corte; o resto entra no corte
    const at = /riser|swell/.test(fx.chapter) ? sec.start - d : sec.start - 0.05;
    if (at >= 0) cues.push({ id: fx.chapter, at, duration: d, why: `abre o bloco "${sec.title.slice(0, 50)}"` });
  }
  const tracks = new Map(p.tracks.map((t) => [t.id, t.name]));
  for (const c of Object.values(p.clips)) {
    if (fx.title && c.title && c.origin?.by === 'ai') cues.push({ id: fx.title, at: c.start, duration: dur(fx.title), why: `entrada do título "${c.title.text.slice(0, 40)}"` });
    if (fx.broll && tracks.get(c.trackId) === 'B-roll' && !c.title) cues.push({ id: fx.broll, at: Math.max(0, c.start - 0.25), duration: dur(fx.broll), why: 'entrada da imagem' });
  }
  const out: SfxCue[] = [];
  for (const c of cues.sort((a, b2) => a.at - b2.at)) {
    const prev = out.at(-1);
    if (prev && c.at < prev.at + prev.duration + 0.3) continue; // um efeito por vez
    out.push(c);
  }
  return out;
}

export function planSound(p: Project, b: NarrativeBrief, profile: EditorialProfile): SoundPlan {
  return { music: musicSpans(b, profile, projectDuration(p)), sfx: sfxCues(p, b, profile) };
}

/** Comprimento máximo de cada trilha gerada (trechos maiores encadeiam a mesma trilha). */
const MAX_BED = 180;

export const audioDesignerSkill: Skill = {
  id: 'audio-designer',
  stage: 'audio',
  label: 'Trilha e efeitos sonoros',
  modes: ['audio-led', 'script-led', 'manual-assisted'],
  async run(ctx) {
    const brief = await ctx.brief();
    if (!brief) return { commands: [], warnings: ['Sem fala transcrita: não sei onde ficam os blocos do vídeo.'] };
    if (!ctx.services.sound) return { commands: [], warnings: ['A biblioteca de sons não está disponível aqui.'] };
    const p = ctx.project();
    const profile = ctx.profile;
    const musicTrack = p.tracks.find((t) => t.kind === 'audio' && t.name === 'Música');
    const userMusic = musicTrack && Object.values(p.clips).some((c) => c.trackId === musicTrack.id && c.origin?.by !== 'ai');
    const plan = planSound(p, brief, profile);
    if (userMusic) plan.music = [];
    const commands: EditCommand[] = [];
    const warnings: string[] = userMusic ? ['Você já pôs uma música na faixa Música: a trilha ficou a sua.'] : [];

    // gera cada som uma vez (trilhas com o comprimento do maior trecho, até 3 min)
    const need = new Map<string, number>();
    for (const s of plan.music) need.set(s.mood, Math.max(need.get(s.mood) ?? 0, Math.min(MAX_BED, s.end - s.start)));
    for (const c of plan.sfx) need.set(c.id, soundById(c.id)!.duration);
    if (!need.size) return { commands: [], notes: ['Este tipo de vídeo fica sem trilha e sem efeitos.'], warnings };
    const files = new Map<string, File>();
    let i = 0;
    for (const [id, duration] of need) {
      ctx.signal.throwIfAborted();
      ctx.progress(`Gerando "${soundById(id)!.label}" na biblioteca de sons…`, i++, need.size);
      files.set(id, await ctx.services.sound(id, { duration: Math.ceil(duration) }));
    }
    ctx.progress('Importando os sons…', need.size, need.size);
    const assets = await ctx.services.importFiles([...files.values()]);
    const assetOf = (id: string) => assets.get(files.get(id)!.name);

    for (const span of plan.music) {
      const a = assetOf(span.mood);
      if (!a) continue;
      const bed = a.duration || MAX_BED;
      // trechos longos encadeiam a trilha; fade longo nas pontas do trecho, curto nas emendas
      for (let t = span.start; t < span.end - 1; t += bed) {
        const end = Math.min(span.end, t + bed);
        commands.push({
          id: newId('k'),
          projectId: p.id,
          type: 'add_music',
          start: +t.toFixed(3),
          end: +end.toFixed(3),
          createdBy: 'ai',
          skill: 'audio-designer',
          confidence: 0.72,
          reason: `trilha "${soundById(span.mood)!.label}" sob o trecho ${fmt(span.start)}–${fmt(span.end)}`,
          reversible: true,
          payload: { assetId: a.id, role: 'music', volume: profile.sound.level, fadeIn: t === span.start ? 2 : 0.6, fadeOut: end >= span.end ? 2.5 : 0.6, label: soundById(span.mood)!.label },
        });
      }
    }
    for (const c of plan.sfx) {
      const a = assetOf(c.id);
      if (!a) continue;
      commands.push({
        id: newId('k'),
        projectId: p.id,
        type: 'add_sound_effect',
        start: +c.at.toFixed(3),
        end: +(c.at + (a.duration || c.duration)).toFixed(3),
        createdBy: 'ai',
        skill: 'audio-designer',
        confidence: 0.68,
        reason: `${soundById(c.id)!.label}: ${c.why}`,
        reversible: true,
        payload: { assetId: a.id, role: 'sfx', volume: profile.sound.sfxLevel, label: soundById(c.id)!.label },
      });
    }
    const moods = [...new Set(plan.music.map((s) => soundById(s.mood)!.label))];
    return {
      commands,
      notes: [`${plan.music.length ? `Trilha por bloco (${moods.join(' → ')}) a ${Math.round(profile.sound.level * 100)}% sob a voz` : 'Sem trilha'}; ${plan.sfx.length} efeito(s) sonoro(s).`],
      warnings,
    };
  },
};

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
