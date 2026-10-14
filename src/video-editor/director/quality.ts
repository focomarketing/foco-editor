// Portão de qualidade da entrega: métricas reais da timeline contra as metas do canal (perfil +
// tom). O Diretor não entrega enquanto o vídeo estiver ralo: trecho longo sem mudança visual, pouca
// imagem, pouco lettering, imagem repetida, sem legenda, trilha alta ou efeito demais.

import type { Project } from '../../core/types';
import { clipEnd, projectDuration } from '../../engine/timeline/operations';
import type { EditorialProfile } from '../narrative/profiles';

export interface QualityCheck {
  name: string;
  value: string;
  target: string;
  ok: boolean;
  fix: string;
}

export interface QualityReport {
  checks: QualityCheck[];
  ok: boolean;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Instantes em que algo muda na tela: imagem entra/sai, texto/elemento entra, zoom muda. */
export function visualChanges(p: Project): number[] {
  const byName = new Map(p.tracks.map((t) => [t.id, t.name]));
  const out: number[] = [];
  for (const c of Object.values(p.clips)) {
    const name = byName.get(c.trackId) ?? '';
    if (name === 'B-roll') out.push(c.start, clipEnd(c));
    else if ((c.title || c.element || (c.caption && name !== 'Legendas')) && name !== 'Legendas') out.push(c.start);
    const kf = c.keyframes?.scale;
    if (kf?.length && byName.get(c.trackId) !== 'B-roll') {
      const speed = c.speed || 1;
      for (let i = 1; i < kf.length; i++) if (kf[i].v !== kf[i - 1].v) out.push(c.start + (kf[i].t - c.sourceIn) / speed);
    }
  }
  return out.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
}

/** Maior intervalo sem mudança visual (e onde começa). */
export function longestStatic(p: Project): { seconds: number; at: number } {
  const d = projectDuration(p);
  const ev = [0, ...visualChanges(p).filter((t) => t >= 0 && t <= d), d];
  let best = { seconds: 0, at: 0 };
  for (let i = 1; i < ev.length; i++) if (ev[i] - ev[i - 1] > best.seconds) best = { seconds: ev[i] - ev[i - 1], at: ev[i - 1] };
  return best;
}

export function qualityReport(p: Project, profile: EditorialProfile): QualityReport {
  const d = Math.max(1, projectDuration(p));
  const min = d / 60;
  const byName = (n: string) => {
    const ids = new Set(p.tracks.filter((t) => t.name === n).map((t) => t.id));
    return Object.values(p.clips).filter((c) => ids.has(c.trackId));
  };
  const broll = byName('B-roll');
  const gfx = byName('Gráficos').filter((c) => c.caption || c.title);
  const music = byName('Música');
  const sfx = byName('Efeitos sonoros');
  const caps = byName('Legendas').filter((c) => c.caption);
  const brollSec = broll.reduce((s, c) => s + c.duration, 0);
  const pace = profile.brollPace;
  const every = pace?.every ?? 25;
  const targetCoverage = Math.min(0.45, ((pace?.min ?? 3) + (pace?.max ?? 6)) / 2 / every);
  const st = longestStatic(p);
  const maxStatic = Math.max(10, (profile.punchEvery ?? 8) * 1.8);
  const letterTarget = profile.motionPace ? 60 / profile.motionPace.every : 1;
  const repeated = broll.length - new Set(broll.map((c) => c.assetId)).size;
  const checks: QualityCheck[] = [
    { name: 'maior trecho sem mudança visual', value: `${st.seconds.toFixed(1)} s (em ${fmt(st.at)})`, target: `≤ ${maxStatic.toFixed(0)} s`, ok: st.seconds <= maxStatic, fix: `ponha imagem (find_image), lettering ou aproximação no rosto entre ${fmt(st.at)} e ${fmt(st.at + st.seconds)}` },
    { name: 'cobertura de imagens', value: `${Math.round((brollSec / d) * 100)}% (${broll.length} imagens)`, target: `≥ ${Math.round(targetCoverage * 0.7 * 100)}%`, ok: brollSec / d >= targetCoverage * 0.7, fix: 'mais imagens coerentes com a fala (find_image) nos trechos sem imagem' },
    { name: 'lettering por minuto', value: (gfx.length / min).toFixed(1), target: `${(letterTarget * 0.6).toFixed(1)}–${(letterTarget * 1.6 + 0.5).toFixed(1)}`, ok: gfx.length / min >= letterTarget * 0.6 && gfx.length / min <= letterTarget * 1.6 + 0.5, fix: gfx.length / min < letterTarget * 0.6 ? 'mais frases de impacto em lettering (edit_timeline action lettering), na palavra' : 'menos textos na tela: tire os mais fracos' },
    { name: 'imagens repetidas', value: String(repeated), target: '0', ok: repeated === 0, fix: 'troque as imagens repetidas' },
    { name: 'legenda', value: caps.length ? `${caps.length} blocos` : 'nenhuma', target: 'presente', ok: caps.length > 0 || !p.metadata?.workflow, fix: 'rode run_skill captions' },
    { name: 'trilha', value: music.length ? `${Math.round(Math.max(...music.map((c) => c.volume)) * 100)}%` : 'sem trilha', target: profile.sound.level ? `≤ ${Math.round(Math.max(0.1, profile.sound.level * 1.6) * 100)}%` : 'sem trilha', ok: profile.sound.level ? music.every((c) => c.volume <= Math.max(0.1, profile.sound.level * 1.6)) : true, fix: 'baixe a trilha (volume)' },
    { name: 'efeitos sonoros por minuto', value: (sfx.length / min).toFixed(1), target: '≤ 6', ok: sfx.length / min <= 6, fix: 'tire os efeitos sem motivo (cada som casa com um movimento na tela)' },
  ];
  return { checks, ok: checks.every((c) => c.ok) };
}

export function reportText(r: QualityReport): string {
  return [
    r.ok ? 'PORTÃO DE QUALIDADE: aprovado.' : 'PORTÃO DE QUALIDADE: reprovado. Corrija antes de entregar:',
    ...r.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}: ${c.value} (meta ${c.target})${c.ok ? '' : ` → ${c.fix}`}`),
  ].join('\n');
}
