// Validação de comandos da IA contra o projeto atual. Nada chega à timeline sem passar aqui:
// mídia existente, tempos válidos, faixas e clipes bloqueados respeitados, sem sobreposição.

import type { Clip, Project } from '../../core/types';
import { clipEnd } from '../../engine/timeline/operations';
import type { EditCommand } from '../commands/types';

const EPS = 1e-3;

/** O clipe está protegido contra a IA (faixa travada ou "não alterar")? */
export function isProtected(p: Project, c: Clip): boolean {
  const track = p.tracks.find((t) => t.id === c.trackId);
  return !!track?.locked || !!c.origin?.locked;
}

/** O clipe foi criado pela IA e não foi mexido à mão depois? */
export function isUntouchedAi(c: Clip): boolean {
  return c.origin?.by === 'ai' && !c.origin.locked && (!c.origin.stamp || c.origin.stamp === clipStamp(c));
}

/** Impressão do que importa num clipe (posição, mídia, efeitos) para detectar edição manual. */
export function clipStamp(c: Clip): string {
  return JSON.stringify([c.assetId, c.trackId, +c.start.toFixed(3), +c.duration.toFixed(3), +c.sourceIn.toFixed(3), c.keyframes ?? null, c.title?.text ?? null, c.caption?.words?.length ?? null, c.transform.scale]);
}

/** Erro em português, ou null se o comando pode ser aplicado. */
export function validateCommand(cmd: EditCommand, p: Project, occupied: Map<string, [number, number][]> = new Map()): string | null {
  const pl = cmd.payload;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const clipOf = (id: unknown) => (typeof id === 'string' ? p.clips[id] : undefined);
  switch (cmd.type) {
    case 'add_clip':
    case 'add_overlay':
    case 'add_music':
    case 'add_sound_effect':
    case 'add_caption': {
      if (!num(cmd.start) || !num(cmd.end) || cmd.start! < -EPS || cmd.end! <= cmd.start! + 0.05) return 'tempo inválido';
      const isGraphic = !!pl.title || !!pl.caption;
      if (!isGraphic && (!pl.assetId || !p.assets[pl.assetId])) return 'mídia inexistente no projeto';
      if (cmd.trackId) {
        const t = p.tracks.find((x) => x.id === cmd.trackId);
        if (!t) return 'faixa inexistente';
        if (t.locked) return 'faixa bloqueada';
      }
      // sobreposição com o que já está (ou já foi planejado) na mesma faixa
      const key = cmd.trackId ?? `role:${pl.role ?? 'broll'}`;
      const busy = occupied.get(key) ?? [];
      if (busy.some(([a, b]) => cmd.start! < b - EPS && cmd.end! > a + EPS)) return 'conflito: já há um item nesse trecho da faixa';
      occupied.set(key, [...busy, [cmd.start!, cmd.end!]]);
      return null;
    }
    case 'remove_clip':
    case 'trim_clip':
    case 'move_clip':
    case 'split_clip':
    case 'add_transition':
    case 'add_effect':
    case 'apply_lut': {
      const c = clipOf(pl.clipId);
      if (!c) return 'clipe inexistente';
      if (isProtected(p, c)) return 'clipe protegido (faixa bloqueada ou "não alterar")';
      if (c.origin?.by !== 'ai' && (cmd.type === 'remove_clip' || cmd.type === 'move_clip')) return 'clipe criado pelo usuário: a IA não remove nem move sem confirmação';
      if (cmd.type === 'trim_clip' && (!num(pl.time) || (pl.edge !== 'start' && pl.edge !== 'end'))) return 'aparo inválido';
      if (cmd.type === 'split_clip' && (!num(pl.time) || pl.time! <= c.start + EPS || pl.time! >= clipEnd(c) - EPS)) return 'corte fora do clipe';
      if (cmd.type === 'move_clip' && (!num(pl.to) || pl.to! < 0)) return 'destino inválido';
      if (cmd.type === 'add_transition' && (!pl.transition || !num(pl.transition.duration) || pl.transition.duration <= 0 || pl.transition.duration > Math.min(2, c.duration / 2))) return 'transição inválida';
      if (cmd.type === 'apply_lut' && !pl.color) return 'cor ausente';
      return null;
    }
    case 'ripple_remove': {
      const ranges = pl.ranges;
      if (!Array.isArray(ranges) || !ranges.length) return 'nenhum trecho';
      if (ranges.some((r) => !Array.isArray(r) || !num(r[0]) || !num(r[1]) || r[1] <= r[0])) return 'trecho inválido';
      return null;
    }
  }
}

/** Ocupação atual de cada faixa (para checar conflitos de novos itens). */
export function occupancy(p: Project): Map<string, [number, number][]> {
  const m = new Map<string, [number, number][]>();
  for (const c of Object.values(p.clips)) {
    const list = m.get(c.trackId) ?? [];
    list.push([c.start, clipEnd(c)]);
    m.set(c.trackId, list);
  }
  return m;
}
