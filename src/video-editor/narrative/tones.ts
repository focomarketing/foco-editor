// Tom do vídeo (escolhido no briefing): emocional, energético, dramático, contemplativo ou
// inspirador. O tom casa tudo com ele por cima do perfil do canal: trilha, ritmo de imagens e de
// títulos, punch-ins, efeitos sonoros e transições. A música também pode ser escolhida à parte.

import { SOUND_LIBRARY } from '../../engine/audio/soundLibrary';
import type { EditorialProfile } from './profiles';

export type VideoTone = 'auto' | 'emocional' | 'energetico' | 'dramatico' | 'contemplativo' | 'inspirador';

export const TONES: { id: VideoTone; label: string; hint: string }[] = [
  { id: 'auto', label: 'Do canal', hint: 'o padrão do tipo de vídeo' },
  { id: 'emocional', label: 'Emocional', hint: 'toca o coração: trilha suave, aproximações lentas, imagens que respiram' },
  { id: 'energetico', label: 'Energético', hint: 'ritmo alto: batida, cortes de enquadramento frequentes, whoosh e pop' },
  { id: 'dramatico', label: 'Dramático', hint: 'tensão e peso: trilha grave, riser nas viradas, impacto nos títulos' },
  { id: 'contemplativo', label: 'Contemplativo', hint: 'calma e reflexão: mais respiro, poucos efeitos' },
  { id: 'inspirador', label: 'Inspirador', hint: 'esperança que cresce: trilha que abre, brilho nos títulos' },
];

/** Músicas da biblioteca (para o briefing escolher) + automático e sem música. */
export const MUSIC_CHOICES: { id: string; label: string }[] = [
  { id: 'auto', label: 'Automática (pelo tom)' },
  ...SOUND_LIBRARY.filter((s) => s.kind === 'music').map((s) => ({ id: s.id, label: `${s.label} — ${s.hint}` })),
  { id: 'none', label: 'Sem música' },
];

type ToneOverride = Partial<Pick<EditorialProfile, 'brollPace' | 'motionPace' | 'punchEvery' | 'zoomStyle'>> & {
  sound?: Partial<EditorialProfile['sound']>;
  transitions?: Partial<EditorialProfile['transitions']>;
  /** Para o diretor editorial e as skills com IA. */
  brief: string;
};

const T: Record<Exclude<VideoTone, 'auto'>, ToneOverride> = {
  emocional: {
    brief: 'Tom EMOCIONAL: tocar o coração. Imagens humanas e sensíveis que respiram, aproximações lentas no rosto nos momentos de emoção, títulos poucos e delicados, trilha suave.',
    sound: { music: { abertura: 'contemplativa', bloco: 'contemplativa', cta: 'contemplativa', conclusao: 'esperanca' }, level: 0.06, sfx: { chapter: null, title: null, broll: null }, sfxLevel: 0.2 },
    brollPace: { min: 4, max: 7, every: 16 },
    motionPace: { every: 28, max: 32 },
    zoomStyle: 'push',
    punchEvery: 10,
    transitions: { chapter: 'cinematic-dissolve', jumpCut: 'punch-enfase' },
  },
  energetico: {
    brief: 'Tom ENERGÉTICO: ritmo alto e moderno. Mudança visual a cada 3–5 s, títulos fortes nas palavras-chave, trocas de enquadramento frequentes, sons de movimento (whoosh, pop) casados com cada animação.',
    sound: { music: { abertura: 'energia', bloco: 'energia', cta: 'energia', conclusao: 'energia' }, level: 0.07, sfx: { chapter: 'whoosh', title: null, broll: 'whoosh-suave', cta: true }, sfxLevel: 0.28 },
    brollPace: { min: 2.5, max: 4.5, every: 9 },
    motionPace: { every: 14, max: 60 },
    zoomStyle: 'punch',
    punchEvery: 4.5,
    transitions: { chapter: 'zoom-clean', jumpCut: 'punch-alternado' },
  },
  dramatico: {
    brief: 'Tom DRAMÁTICO: tensão e peso. Imagens fortes (arquivo histórico, contraste), riser antes das viradas, impacto nos títulos de tese, escurecer nas trocas de bloco, trilha grave.',
    sound: { music: { abertura: 'tensao', bloco: 'tensao', cta: 'reflexao', conclusao: 'epica' }, level: 0.07, sfx: { chapter: 'riser', title: null, broll: null }, sfxLevel: 0.22 },
    brollPace: { min: 3.5, max: 6, every: 13 },
    motionPace: { every: 22, max: 40 },
    zoomStyle: 'punch',
    punchEvery: 6,
    transitions: { chapter: 'dip-black', jumpCut: 'punch-enfase' },
  },
  contemplativo: {
    brief: 'Tom CONTEMPLATIVO: calma e reflexão. Mais respiro, rosto na tela por mais tempo, imagens contemplativas e longas, poucos títulos, quase nenhum efeito.',
    sound: { music: { abertura: 'contemplativa', bloco: 'contemplativa', cta: 'contemplativa', conclusao: 'contemplativa' }, level: 0.05, sfx: { chapter: null, title: null, broll: null }, sfxLevel: 0.2 },
    brollPace: { min: 5, max: 8, every: 22 },
    motionPace: { every: 40, max: 20 },
    zoomStyle: 'push',
    punchEvery: 12,
    transitions: { chapter: 'cinematic-dissolve', jumpCut: 'seco' },
  },
  inspirador: {
    brief: 'Tom INSPIRADOR: esperança que cresce. Trilha que abre aos poucos, imagens luminosas, títulos com brilho nas teses, a conclusão como ponto alto.',
    sound: { music: { abertura: 'contemplativa', bloco: 'esperanca', cta: 'esperanca', conclusao: 'epica' }, level: 0.06, sfx: { chapter: null, title: null, broll: null }, sfxLevel: 0.2 },
    brollPace: { min: 3.5, max: 6, every: 14 },
    motionPace: { every: 22, max: 40 },
    zoomStyle: 'push',
    punchEvery: 7,
    transitions: { chapter: 'cinematic-dissolve', jumpCut: 'punch-enfase' },
  },
};

/**
 * Perfil do canal com o tom e a música do briefing por cima. Música escolhida (id da biblioteca)
 * vale para o vídeo inteiro; "none" tira a trilha. Vídeo curto mantém o próprio ritmo.
 */
export function applyTone(profile: EditorialProfile, tone?: VideoTone | string | null, music?: string | null, short = false): EditorialProfile {
  let p = profile;
  const o = tone && tone !== 'auto' ? T[tone as Exclude<VideoTone, 'auto'>] : undefined;
  if (o) {
    p = {
      ...p,
      sound: { ...p.sound, ...o.sound, sfx: { ...p.sound.sfx, ...o.sound?.sfx } },
      transitions: { ...p.transitions, ...o.transitions, allowed: p.transitions.allowed.length ? [...new Set([...p.transitions.allowed, ...(o.transitions?.chapter ? [o.transitions.chapter] : []), 'punch-in'])] : [] },
      ...(short ? {} : { brollPace: o.brollPace ?? p.brollPace, motionPace: o.motionPace ?? p.motionPace, punchEvery: o.punchEvery ?? p.punchEvery, zoomStyle: o.zoomStyle ?? p.zoomStyle }),
    };
  }
  if (music === 'none') p = { ...p, sound: { ...p.sound, music: {} } };
  else if (music && music !== 'auto' && SOUND_LIBRARY.some((s) => s.id === music && s.kind === 'music')) p = { ...p, sound: { ...p.sound, music: { abertura: music, bloco: music, cta: music, conclusao: music }, level: p.sound.level || 0.06 } };
  return p;
}

/** Texto do tom para o diretor editorial e as skills com IA. */
export function toneBrief(tone?: string | null, music?: string | null): string {
  const parts: string[] = [];
  const o = tone && tone !== 'auto' ? T[tone as Exclude<VideoTone, 'auto'>] : undefined;
  if (o) parts.push(o.brief);
  if (music === 'none') parts.push('Sem música.');
  else if (music && music !== 'auto') parts.push(`Música escolhida: ${MUSIC_CHOICES.find((m) => m.id === music)?.label ?? music}.`);
  return parts.join(' ');
}
