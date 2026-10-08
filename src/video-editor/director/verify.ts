// Conferência automática do rascunho (o "verify_cut / contact_sheet / voice_levels" do FOCO):
// corte no meio de palavra, tela preta, B-roll no gancho, títulos brigando, transições demais,
// voz estourada/baixa, música alta, duração fora do alvo e trechos parados demais para o formato.
// Função pura: o Diretor roda, corrige e roda de novo até não sobrar erro.

import type { Clip, Project } from '../../core/types';
import { toSource } from '../../core/clipTime';
import { clipEnd, projectDuration } from '../../engine/timeline/operations';
import { visualLayersAt } from '../../engine/render/Compositor';
import { cutPairs } from '../../engine/render/transitions';
import type { TlWord } from '../../engine/cut/smartCut';
import { FORMAT_RULES } from '../transitions/director';
import type { EditFormat } from '../transitions/director';
import { presetFor } from '../transitions/library';
import { sentences } from '../skills/common';

export type Severity = 'erro' | 'aviso' | 'dica';

export interface Issue {
  severity: Severity;
  kind: string;
  /** Tempo na timeline (s), quando o problema tem lugar. */
  at?: number;
  message: string;
}

export interface VerifyInput {
  project: Project;
  /** Fala na timeline do rascunho. */
  words: TlWord[];
  /** Níveis RMS (dBFS, `rate` por segundo) por mídia. */
  levels: Map<string, Float32Array>;
  rate: number;
  format: EditFormat;
  targetDuration?: number;
}

/** Trecho máximo sem nenhuma mudança visual, por formato (s). */
export const STATIC_LIMIT: Record<EditFormat, number> = { youtube: 25, interview: 40, shorts: 5, commercial: 4 };

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const isBroll = (p: Project, c: Clip) => p.tracks.find((t) => t.id === c.trackId)?.name === 'B-roll';
const isMusic = (p: Project, c: Clip) => /m[uú]sica|music/i.test(p.tracks.find((t) => t.id === c.trackId)?.name ?? '');

export function verifyProject(v: VerifyInput): Issue[] {
  const { project: p, words, format } = v;
  const issues: Issue[] = [];
  const duration = projectDuration(p);
  if (duration <= 0) return [{ severity: 'erro', kind: 'vazio', message: 'A timeline está vazia.' }];

  // 1) corte no meio de uma palavra
  for (const { b } of cutPairs(p)) {
    const w = words.find((x) => x.start + 0.04 < b.start && x.end - 0.04 > b.start);
    if (w) issues.push({ severity: 'erro', kind: 'corte-na-palavra', at: b.start, message: `Corte em ${fmt(b.start)} cai dentro da palavra "${w.text.trim()}".` });
  }

  // 2) tela preta / buraco na imagem
  let gapStart: number | null = null;
  for (let t = 0; t <= duration; t += 0.25) {
    const hasPicture = visualLayersAt(p, Math.min(t, duration - 0.01)).some((l) => !!l.asset);
    if (!hasPicture && gapStart === null) gapStart = t;
    if ((hasPicture || t + 0.25 > duration) && gapStart !== null) {
      const len = (hasPicture ? t : duration) - gapStart;
      if (len >= 0.25) issues.push({ severity: 'erro', kind: 'tela-preta', at: gapStart, message: `Tela sem imagem de ${fmt(gapStart)} a ${fmt(gapStart + len)} (${len.toFixed(1)} s).` });
      gapStart = null;
    }
  }

  // 3) B-roll no gancho / no fechamento (o rosto deve aparecer)
  const list = sentences(words);
  const faceVideo = Object.values(p.clips).some((c) => !isBroll(p, c) && !c.title && !c.caption && p.assets[c.assetId]?.hasVideo && p.assets[c.assetId]?.hasAudio);
  if (faceVideo && list.length > 2) {
    const brolls = Object.values(p.clips).filter((c) => isBroll(p, c));
    const hook = list[0];
    const close = list[list.length - 1];
    if (brolls.some((c) => c.start < Math.min(hook.end, hook.start + 2.5) && clipEnd(c) > hook.start + 0.2)) issues.push({ severity: 'aviso', kind: 'broll-no-gancho', at: hook.start, message: 'B-roll cobre o gancho: o rosto deve aparecer nos primeiros segundos.' });
    if (brolls.some((c) => c.start < close.end && clipEnd(c) > close.start + 0.3)) issues.push({ severity: 'aviso', kind: 'broll-no-fecho', at: close.start, message: 'B-roll cobre a frase final: volte para o rosto no fechamento.' });
  }

  // 4) títulos brigando entre si ou com a legenda
  const titles = Object.values(p.clips).filter((c) => c.title).sort((a, b) => a.start - b.start);
  for (let i = 1; i < titles.length; i++) {
    if (titles[i].start < clipEnd(titles[i - 1]) - 0.05) issues.push({ severity: 'erro', kind: 'titulos-sobrepostos', at: titles[i].start, message: `Dois títulos ao mesmo tempo em ${fmt(titles[i].start)}.` });
  }
  const captions = Object.values(p.clips).filter((c) => c.caption);
  for (const t of titles) {
    if ((t.title?.y ?? 0.5) < 0.62) continue; // legenda fica embaixo: só briga com título baixo
    const c = captions.find((x) => x.start < clipEnd(t) && clipEnd(x) > t.start);
    if (c) issues.push({ severity: 'aviso', kind: 'titulo-sobre-legenda', at: t.start, message: `Título "${t.title?.text.slice(0, 30)}" disputa a parte de baixo da tela com a legenda em ${fmt(t.start)}.` });
  }

  // 5) transições demais / fortes seguidas
  const pairs = cutPairs(p);
  const withFx = pairs.filter(({ b }) => b.transitionIn && presetFor(b.transitionIn.type)?.render !== 'none');
  const rules = FORMAT_RULES[format];
  if (pairs.length >= 4 && withFx.length / pairs.length > rules.maxShare * 1.5) issues.push({ severity: 'aviso', kind: 'transicoes-demais', message: `${withFx.length} de ${pairs.length} cortes têm transição — acima do ritmo do formato (${Math.round(rules.maxShare * 100)}%). Prefira corte seco.` });
  for (let i = 1; i < withFx.length; i++) {
    const a = presetFor(withFx[i - 1].b.transitionIn!.type)!;
    const b = presetFor(withFx[i].b.transitionIn!.type)!;
    if (a.level === 3 && b.level === 3 && withFx[i].b.start - withFx[i - 1].b.start < rules.minSpacing * 3) issues.push({ severity: 'aviso', kind: 'transicoes-fortes-seguidas', at: withFx[i].b.start, message: `Duas transições fortes seguidas (${a.name} e ${b.name}).` });
  }

  // 6) áudio: voz estourada, baixa ou alta demais; música alta sob a fala
  const speechClips = Object.values(p.clips).filter((c) => !c.muted && c.volume > 0 && !isMusic(p, c) && p.assets[c.assetId]?.hasAudio && words.some((w) => w.assetId === c.assetId));
  let clipped = 0;
  let sum = 0;
  let n = 0;
  for (const c of speechClips) {
    const lv = v.levels.get(c.assetId);
    if (!lv) continue;
    const gain = 20 * Math.log10(Math.max(1e-4, c.volume));
    for (const w of words.filter((x) => x.assetId === c.assetId && x.start >= c.start && x.end <= clipEnd(c))) {
      for (let t = w.start; t < w.end; t += 1 / v.rate) {
        const db = lv[Math.floor(toSource(c, t) * v.rate)] + gain;
        if (!Number.isFinite(db)) continue;
        if (db > -1) clipped++;
        sum += db;
        n++;
      }
    }
  }
  if (n > 0) {
    const avg = sum / n;
    if (clipped > v.rate * 0.3) issues.push({ severity: 'erro', kind: 'voz-estourada', message: `A voz bate no limite (${(clipped / v.rate).toFixed(1)} s estourados): baixe o volume da fala.` });
    if (avg < -30) issues.push({ severity: 'aviso', kind: 'voz-baixa', message: `A voz está baixa (média ${avg.toFixed(0)} dBFS; alvo entre −22 e −14).` });
    else if (avg > -10) issues.push({ severity: 'aviso', kind: 'voz-alta', message: `A voz está alta demais (média ${avg.toFixed(0)} dBFS).` });
  }
  const music = Object.values(p.clips).filter((c) => isMusic(p, c) && !c.muted);
  if (words.length && music.some((c) => c.volume > 0.35)) issues.push({ severity: 'aviso', kind: 'musica-alta', message: 'Música acima de 35% de volume sob a fala: a voz perde clareza.' });

  // 7) duração fora do alvo
  if (v.targetDuration && Math.abs(duration - v.targetDuration) > v.targetDuration * 0.15) issues.push({ severity: 'aviso', kind: 'duracao', message: `Duração ${duration.toFixed(0)} s, alvo ${v.targetDuration.toFixed(0)} s.` });

  // 8) trechos parados demais (nenhum corte, B-roll, título ou zoom)
  const events = new Set<number>([0, duration]);
  for (const c of Object.values(p.clips)) {
    events.add(+c.start.toFixed(2));
    events.add(+clipEnd(c).toFixed(2));
    for (const k of c.keyframes?.scale ?? []) events.add(+(c.start + (k.t - c.sourceIn) / (c.speed || 1)).toFixed(2));
  }
  const ev = [...events].filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b);
  const limit = STATIC_LIMIT[format];
  for (let i = 1; i < ev.length; i++) {
    if (ev[i] - ev[i - 1] > limit) issues.push({ severity: 'dica', kind: 'trecho-parado', at: ev[i - 1], message: `${(ev[i] - ev[i - 1]).toFixed(0)} s sem mudança visual a partir de ${fmt(ev[i - 1])} (limite do formato: ${limit} s). Um B-roll, zoom ou destaque ajuda.` });
  }

  const order: Record<Severity, number> = { erro: 0, aviso: 1, dica: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.at ?? 0) - (b.at ?? 0));
}

/** Texto compacto para o Diretor ler. */
export function issuesText(list: Issue[]): string {
  if (!list.length) return 'Nenhum problema encontrado.';
  const count = (s: Severity) => list.filter((i) => i.severity === s).length;
  return `${count('erro')} erro(s), ${count('aviso')} aviso(s), ${count('dica')} dica(s):\n${list.map((i) => `- [${i.severity}] ${i.message}`).join('\n')}`;
}
