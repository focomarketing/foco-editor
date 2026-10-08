// Etapa 2 · edit-interview-with-broll (modo pela fala): a fala principal fica intacta e os takes
// de apoio do usuário entram por cima, na frase que fala do que o take mostra. Não repete take,
// volta para o rosto no gancho e no fechamento, e o que casa mal fica para revisão.

import type { Asset } from '../../core/types';
import { newId } from '../../core/time';
import { askJson } from '../../engine/ai/providers';
import { coverScale, kenBurns } from '../../engine/images/broll';
import type { EditCommand } from '../commands/types';
import { matchScore } from '../media-analysis/manifest';
import type { MediaManifest } from '../media-analysis/manifest';
import type { Skill, SkillContext } from '../orchestrator/orchestrator';
import { buildManifests, isShort, llmReady, sentences, supportMedia } from './common';
import type { Sentence } from './common';

export interface Placement {
  sentence: Sentence;
  manifest: MediaManifest;
  /** 0..1: quanto a frase fala do take. */
  fit: number;
  why: string;
  by: 'llm' | 'keywords' | 'spread';
  /** Estende até aqui para emendar no take seguinte (sem um "piscar" de rosto). */
  until?: number;
}

export interface InterviewRules {
  /** Espaço mínimo entre dois takes (s). */
  gap: number;
  /** Duração máxima de um take sobre a fala (s). */
  maxLen: number;
  minLen: number;
  /** Fração máxima do vídeo coberta por takes. */
  maxCoverage: number;
}

export const interviewRules = (short: boolean): InterviewRules =>
  short ? { gap: 1.5, maxLen: 3.5, minLen: 1.2, maxCoverage: 0.6 } : { gap: 5, maxLen: 6, minLen: 2, maxCoverage: 0.45 };

/** Frases onde o rosto fica: gancho (primeira) e fechamento (última). */
export function faceSentences(list: Sentence[]): Set<number> {
  const s = new Set<number>();
  if (list.length) s.add(list[0].index);
  if (list.length > 2) s.add(list[list.length - 1].index);
  return s;
}

const PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assignments', 'keepFace'],
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sentence', 'take', 'fit', 'why'],
        properties: { sentence: { type: 'integer' }, take: { type: 'string' }, fit: { type: 'number' }, why: { type: 'string' } },
      },
    },
    keepFace: { type: 'array', items: { type: 'integer' }, description: 'frases-chave em que o rosto deve aparecer' },
  },
} as const;

/** Casamento local por palavras: cada take vai para a frase que mais fala dele (sem repetir). */
export function keywordPlacements(list: Sentence[], manifests: MediaManifest[], blocked: Set<number>): Placement[] {
  const pairs: Placement[] = [];
  for (const m of manifests) for (const s of list) {
    if (blocked.has(s.index)) continue;
    const fit = matchScore(s.text, m);
    if (fit > 0) pairs.push({ sentence: s, manifest: m, fit, why: `a fala cita ${m.keywords.filter((k) => s.text.toLowerCase().includes(k)).slice(0, 3).join(', ') || 'o que o take mostra'}`, by: 'keywords' });
  }
  pairs.sort((a, b) => b.fit - a.fit);
  const usedTake = new Set<string>();
  const usedSentence = new Set<number>();
  const out: Placement[] = [];
  for (const p of pairs) {
    if (usedTake.has(p.manifest.assetId) || usedSentence.has(p.sentence.index)) continue;
    usedTake.add(p.manifest.assetId);
    usedSentence.add(p.sentence.index);
    out.push(p);
  }
  return out;
}

/**
 * Regras de ritmo: respeita o espaço entre takes e a cobertura máxima, mantendo os de maior
 * encaixe. Takes sem frase que fale deles são espalhados nos vãos (confiança baixa).
 */
export function schedule(placed: Placement[], list: Sentence[], manifests: MediaManifest[], blocked: Set<number>, rules: InterviewRules, duration: number): Placement[] {
  const chosen: Placement[] = [];
  const span = (p: Placement) => {
    const start = p.sentence.start + 0.25;
    return [start, Math.min(p.sentence.end, start + rules.maxLen)] as const;
  };
  // takes casados com a fala podem vir em frases seguidas (viram sequência); os sem frase
  // correspondente respeitam o espaço mínimo para o rosto aparecer
  const fits = (p: Placement) => {
    const [a, b] = span(p);
    if (b - a < rules.minLen) return false;
    return chosen.every((q) => {
      const [c, d] = span(q);
      const gap = p.by === 'spread' || q.by === 'spread' ? rules.gap : 0;
      return b + gap <= c || a >= d + gap;
    });
  };
  let covered = 0;
  for (const p of [...placed].sort((a, b) => b.fit - a.fit)) {
    const [a, b] = span(p);
    if (covered + (b - a) > duration * rules.maxCoverage || !fits(p)) continue;
    chosen.push(p);
    covered += b - a;
  }
  // takes sem frase que fale deles: nas frases livres mais longas, espalhados
  const used = new Set(chosen.map((p) => p.manifest.assetId));
  const rest = manifests.filter((m) => !used.has(m.assetId));
  const free = list.filter((s) => !blocked.has(s.index) && !chosen.some((p) => p.sentence.index === s.index)).sort((a, b) => b.end - b.start - (a.end - a.start));
  for (const m of rest) {
    const s = free.find((x) => fits({ sentence: x, manifest: m, fit: 0, why: '', by: 'spread' }));
    if (!s) break;
    const p: Placement = { sentence: s, manifest: m, fit: 0, why: 'sem frase que cite este take: posição sugerida para revisar', by: 'spread' };
    const [a, b] = span(p);
    if (covered + (b - a) > duration * rules.maxCoverage) break;
    chosen.push(p);
    covered += b - a;
    free.splice(free.indexOf(s), 1);
  }
  chosen.sort((a, b) => a.sentence.start - b.sentence.start);
  for (let i = 0; i + 1 < chosen.length; i++) {
    const end = span(chosen[i])[1];
    const next = span(chosen[i + 1])[0];
    if (next - end > 0 && next - end < 1.5) chosen[i] = { ...chosen[i], until: next };
  }
  return chosen;
}

export function placementConfidence(p: Placement): number {
  if (p.by === 'spread') return 0.4;
  const base = p.by === 'llm' ? 0.5 + 0.4 * p.fit : 0.45 + 0.3 * p.fit;
  return +Math.min(0.9, base * (p.manifest.source === 'filename' && p.by === 'llm' ? 0.9 : 1)).toFixed(2);
}

async function llmPlacements(ctx: SkillContext, list: Sentence[], manifests: MediaManifest[], blocked: Set<number>, names: Map<string, string>): Promise<{ placed: Placement[]; face: number[] } | null> {
  const tag = (i: number) => `T${i + 1}`;
  const takes = manifests
    .map((m, i) => `${tag(i)} · ${names.get(m.assetId)} · ${m.duration.toFixed(1)} s · ${[...m.scenes, ...m.objects].slice(0, 6).join(', ') || m.keywords.slice(0, 8).join(', ') || 'sem descrição'}${m.shotType ? ` · plano ${m.shotType}` : ''}`)
    .join('\n');
  const lines = list.map((s) => `${s.index}${blocked.has(s.index) ? '*' : ''} [${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${s.text}`).join('\n');
  const raw = (await askJson(
    ctx.ai,
    'Você é editor de entrevistas. A fala principal não muda; você escolhe em qual frase cada take de apoio entra por cima (B-roll). Regras: um take por frase, nunca repetir take, só associe quando a frase fala do que o take mostra (fit 0..1 honesto), não cubra frases marcadas com * nem frases-chave de emoção ou tese (liste-as em keepFace). Responda só o JSON.',
    `Takes de apoio:\n${takes}\n\nFrases (índice, tempo, texto):\n${lines}`,
    PICK_SCHEMA as unknown as Record<string, unknown>,
    ctx.signal,
  )) as { assignments?: { sentence: number; take: string; fit: number; why: string }[]; keepFace?: number[] };
  const face = (raw.keepFace ?? []).filter((n) => Number.isInteger(n));
  const usedTake = new Set<string>();
  const usedSentence = new Set<number>();
  const placed: Placement[] = [];
  for (const a of raw.assignments ?? []) {
    const m = manifests[Number(String(a.take).replace(/\D/g, '')) - 1];
    const s = list.find((x) => x.index === a.sentence);
    if (!m || !s || blocked.has(s.index) || face.includes(s.index) || usedTake.has(m.assetId) || usedSentence.has(s.index)) continue;
    usedTake.add(m.assetId);
    usedSentence.add(s.index);
    placed.push({ sentence: s, manifest: m, fit: Math.max(0, Math.min(1, Number(a.fit) || 0)), why: String(a.why ?? '').slice(0, 160), by: 'llm' });
  }
  return { placed: placed.filter((p) => p.fit >= 0.2), face };
}

/** Comando do editor para um take (vídeo mudo por cima da fala; imagem com movimento leve). */
export function takeCommand(ctx: SkillContext, p: Placement, asset: Asset, rules: InterviewRules, i: number, skill: string): EditCommand {
  const proj = ctx.project();
  const start = +(p.sentence.start + 0.25).toFixed(3);
  const range = p.manifest.usableRanges[0];
  const want = p.until !== undefined ? p.until - start : Math.min(p.sentence.end - start, rules.maxLen);
  const len = Math.min(want, asset.kind === 'image' ? want : range.end - range.start);
  const end = +(start + len).toFixed(3);
  const base = { id: newId('k'), projectId: proj.id, start, end, createdBy: 'ai' as const, skill, confidence: placementConfidence(p), reason: `${p.why} · "${p.sentence.text.slice(0, 70)}"`, reversible: true };
  if (asset.kind === 'image') {
    const kb = kenBurns(asset.width, asset.height, proj.settings.width, proj.settings.height, len, i);
    return { ...base, type: 'add_overlay', payload: { assetId: asset.id, role: 'broll', scale: kb.scale, keyframes: kb.keyframes, label: asset.name } };
  }
  const scale = asset.width && asset.height ? +coverScale(asset.width, asset.height, proj.settings.width, proj.settings.height).toFixed(3) : 1;
  return { ...base, type: 'add_clip', payload: { assetId: asset.id, role: 'broll', sourceIn: range.start, volume: 0, scale, label: asset.name } };
}

export const interviewBrollSkill: Skill = {
  id: 'edit-interview-with-broll',
  stage: 'images',
  label: 'Entrevista com takes de apoio',
  modes: ['audio-led'],
  when: (ctx) => supportMedia(ctx.project()).length > 0,
  async run(ctx) {
    const words = ctx.words();
    if (!words.length) return { commands: [], warnings: ['Sem fala transcrita: não sei onde colocar os takes.'] };
    const p = ctx.project();
    const takes = supportMedia(p);
    const list = sentences(words);
    const rules = interviewRules(isShort(ctx));
    const duration = Math.max(...words.map((w) => w.end));
    ctx.progress(`Indexando ${takes.length} take(s) de apoio…`, 0, takes.length);
    const manifests = await buildManifests(ctx, takes);
    const blocked = faceSentences(list);
    let placed: Placement[] = [];
    let by = 'casamento por palavras';
    if (llmReady(ctx.ai)) {
      try {
        ctx.progress('O diretor está casando cada take com a fala…', takes.length, takes.length + 1);
        const r = await llmPlacements(ctx, list, manifests, blocked, new Map(takes.map((a) => [a.id, a.name])));
        if (r) {
          r.face.forEach((n) => blocked.add(n));
          placed = r.placed;
          by = 'diretor de IA';
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        ctx.log(`diretor de IA indisponível: ${e instanceof Error ? e.message : e}`);
      }
    }
    // o que a IA deixou de fora ainda pode casar por palavras (frase e take livres)
    const usedTakes = new Set(placed.map((x) => x.manifest.assetId));
    const usedSentences = new Set([...blocked, ...placed.map((x) => x.sentence.index)]);
    placed = [...placed, ...keywordPlacements(list, manifests.filter((m) => !usedTakes.has(m.assetId)), usedSentences)];
    const chosen = schedule(placed, list, manifests, blocked, rules, duration);
    const byId = new Map(takes.map((a) => [a.id, a]));
    const commands = chosen.map((c, i) => takeCommand(ctx, c, byId.get(c.manifest.assetId)!, rules, i, 'edit-interview-with-broll'));
    const unused = takes.length - new Set(chosen.map((c) => c.manifest.assetId)).size;
    const vision = manifests.filter((m) => m.source === 'vision').length;
    return {
      commands,
      notes: [`${commands.length} take(s) de apoio sobre a fala (${by}${vision ? `, ${vision} take(s) analisados por imagem` : ', takes reconhecidos pelo nome do arquivo'}).`],
      warnings: [
        ...(unused > 0 ? [`${unused} take(s) ficaram de fora para não repetir nem cobrir frases-chave.`] : []),
        ...(commands.some((c) => (c.confidence ?? 0) < 0.6) ? ['Takes sem relação clara com a fala ficaram para revisão.'] : []),
      ],
    };
  },
};
