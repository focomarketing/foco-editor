// Etapa 2 · edit-script-to-video (modo pelo roteiro): roteiro → blocos → intenção visual →
// mídia (takes do usuário primeiro, depois acervos livres) → montagem em sequência, sincronizada
// com a narração quando ela existe (ou com tempo estimado de leitura quando não).

import type { Asset } from '../../core/types';
import { newId } from '../../core/time';
import { askJson } from '../../engine/ai/providers';
import { coverScale, kenBurns } from '../../engine/images/broll';
import type { EditCommand } from '../commands/types';
import { findImage } from '../assets/hub';
import { matchScore, tokens } from '../media-analysis/manifest';
import type { MediaManifest } from '../media-analysis/manifest';
import type { Skill, SkillContext } from '../orchestrator/orchestrator';
import { ARCHIVE_SUBTYPES } from './broll';
import { buildManifests, isShort, llmReady, supportMedia } from './common';

export interface ScriptBlock {
  index: number;
  text: string;
  start: number;
  end: number;
  /** O que a imagem deve mostrar (pt) e a busca nos acervos (en). */
  intent: string;
  query: string;
  timing: 'narration' | 'estimated';
}

/** Palavras por segundo de uma leitura em voz alta (pt-BR). */
export const READ_RATE = 2.5;

/** Divide o roteiro em blocos: parágrafos; parágrafos longos viram blocos de ~25 palavras por frase. */
export function splitScript(script: string, maxWords = 40): string[] {
  const out: string[] = [];
  for (const para of script.split(/\n\s*\n|\n(?=[-•*]\s)/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    if (para.split(' ').length <= maxWords) {
      out.push(para);
      continue;
    }
    let cur = '';
    for (const s of para.split(/(?<=[.!?…])\s+/)) {
      if (cur && (cur + ' ' + s).split(' ').length > 25) {
        out.push(cur);
        cur = s;
      } else cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) out.push(cur);
  }
  return out;
}

/**
 * Tempo de cada bloco. Com narração transcrita, acha o início do bloco na fala (primeiras
 * palavras, em ordem); o que não achar é distribuído pela contagem de palavras.
 */
export function timeBlocks(blocks: string[], words: { text: string; start: number; end: number }[]): { start: number; end: number; timing: ScriptBlock['timing'] }[] {
  const counts = blocks.map((b) => Math.max(1, b.split(/\s+/).length));
  if (!words.length) {
    let t = 0;
    return counts.map((n) => {
      const start = t;
      t += n / READ_RATE;
      return { start: +start.toFixed(2), end: +t.toFixed(2), timing: 'estimated' as const };
    });
  }
  const norm = words.map((w) => tokens(w.text)[0] ?? '');
  const starts: (number | null)[] = [];
  let cursor = 0;
  for (const b of blocks) {
    const head = tokens(b).slice(0, 3);
    let found: number | null = null;
    for (let i = cursor; i < norm.length && head.length; i++) {
      // primeiras palavras do bloco (2 de 3 batendo) a partir da posição atual
      let hits = 0;
      for (let k = 0, j = i; k < head.length && j < norm.length; k++) {
        while (j < norm.length && !norm[j]) j++;
        if (norm[j] === head[k]) hits++;
        j++;
      }
      if (hits >= Math.min(2, head.length)) {
        found = i;
        break;
      }
    }
    starts.push(found);
    if (found !== null) cursor = found + 1;
  }
  const total = words[words.length - 1].end;
  const totalWords = counts.reduce((a, b) => a + b, 0);
  let acc = 0;
  const est = counts.map((n) => {
    const t = (acc / totalWords) * total;
    acc += n;
    return t;
  });
  const startAt = blocks.map((_, i) => (starts[i] !== null ? words[starts[i]!].start : est[i]));
  // garante ordem crescente
  for (let i = 1; i < startAt.length; i++) if (startAt[i] <= startAt[i - 1]) startAt[i] = Math.min(total, startAt[i - 1] + 0.5);
  return blocks.map((_, i) => ({
    start: +(i === 0 ? Math.min(startAt[0], words[0].start) : startAt[i]).toFixed(2),
    end: +(i + 1 < blocks.length ? startAt[i + 1] : total).toFixed(2),
    timing: starts[i] !== null ? ('narration' as const) : ('estimated' as const),
  }));
}

const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['blocks'],
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'intent', 'query'],
        properties: {
          index: { type: 'integer' },
          intent: { type: 'string', description: 'o que a imagem mostra, em português, concreto' },
          query: { type: 'string', description: 'busca curta em inglês para banco de imagens (2 a 4 palavras, coisas visíveis)' },
        },
      },
    },
  },
} as const;

/** Intenção visual sem IA: as palavras mais "visuais" do bloco. */
export function heuristicIntent(text: string): { intent: string; query: string } {
  const t = tokens(text).filter((w) => w.length > 4);
  const top = [...new Set(t)].sort((a, b) => b.length - a.length).slice(0, 3);
  return { intent: top.join(', ') || text.slice(0, 60), query: top.slice(0, 2).join(' ') || text.split(' ').slice(0, 3).join(' ') };
}

export const scriptToVideoSkill: Skill = {
  id: 'edit-script-to-video',
  stage: 'images',
  label: 'Montagem pelo roteiro',
  modes: ['script-led'],
  async run(ctx) {
    const script = ctx.workflow?.script?.trim();
    if (!script) return { commands: [], warnings: ['Este projeto não tem roteiro. Cole o roteiro ao criar o projeto (modo "Pelo roteiro").'] };
    const p = ctx.project();
    const short = isShort(ctx);
    const words = ctx.words();
    const texts = splitScript(script);
    const times = timeBlocks(texts, words);
    let blocks: ScriptBlock[] = texts.map((text, i) => ({ index: i, text, ...times[i], ...heuristicIntent(text) }));
    let by: 'llm' | 'heuristic' = 'heuristic';
    if (llmReady(ctx.ai)) {
      try {
        ctx.progress('O diretor está lendo o roteiro e definindo o que mostrar…', 0, 1);
        const raw = (await askJson(
          ctx.ai,
          'Você é diretor de vídeo. Para cada bloco do roteiro, diga o que a imagem deve mostrar (concreto, filmável) e uma busca curta em inglês para banco de imagens. Responda só o JSON.',
          blocks.map((b) => `${b.index}. ${b.text}`).join('\n'),
          INTENT_SCHEMA as unknown as Record<string, unknown>,
          ctx.signal,
        )) as { blocks?: { index: number; intent: string; query: string }[] };
        for (const r of raw.blocks ?? []) {
          const b = blocks.find((x) => x.index === r.index);
          if (b && typeof r.intent === 'string' && typeof r.query === 'string' && r.query.trim()) blocks = blocks.map((x) => (x === b ? { ...x, intent: r.intent.slice(0, 120), query: r.query.slice(0, 60) } : x));
        }
        by = 'llm';
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        ctx.log(`diretor de IA indisponível: ${e instanceof Error ? e.message : e}`);
      }
    }
    const own = supportMedia(p);
    const manifests = own.length ? await buildManifests(ctx, own) : [];
    const byId = new Map(own.map((a) => [a.id, a]));
    const hasVisual = Object.values(p.clips).some((c) => p.assets[c.assetId]?.hasVideo || p.assets[c.assetId]?.kind === 'image');
    const role = hasVisual ? 'broll' : 'main';
    const maxLen = short ? 3 : 6;
    const vertical = p.settings.height > p.settings.width;
    const archive = !ctx.workflow || ARCHIVE_SUBTYPES.includes(ctx.workflow.subtype ?? '');
    const usedOwn = new Set<string>();
    const usedWeb = new Set<string>();
    const commands: EditCommand[] = [];
    const missing: number[] = [];
    let searches = 0;
    const segCount = blocks.reduce((n, b) => n + Math.max(1, Math.ceil((b.end - b.start) / maxLen)), 0);
    let done = 0;
    for (const b of blocks) {
      const n = Math.max(1, Math.ceil((b.end - b.start) / maxLen));
      const len = (b.end - b.start) / n;
      let blockHit = false;
      for (let k = 0; k < n; k++) {
        ctx.signal.throwIfAborted();
        ctx.progress(`Bloco ${b.index + 1} de ${blocks.length}: ${b.intent.slice(0, 50)}`, done++, segCount);
        const start = +(b.start + k * len).toFixed(3);
        const end = +(b.start + (k + 1) * len).toFixed(3);
        // 1) mídia do usuário que fala do bloco
        const own = bestOwn(manifests, `${b.text} ${b.intent}`, usedOwn);
        if (own) {
          usedOwn.add(own.m.assetId);
          commands.push(mediaCommand(ctx, byId.get(own.m.assetId)!, own.m, { start, end, role, i: commands.length, confidence: +(0.5 + 0.4 * own.score).toFixed(2), reason: `${b.intent} · sua mídia "${byId.get(own.m.assetId)!.name}"` }));
          blockHit = true;
          continue;
        }
        // 2) acervos livres (limite de buscas por execução)
        if (searches >= 40) continue;
        searches++;
        const hit = await findImage([b.query, b.intent], { vertical, preferArchive: archive, exclude: usedWeb, signal: ctx.signal });
        if (!hit) continue;
        usedWeb.add(hit.license.sourceUrl);
        const assets = await ctx.services.importFiles([hit.file]);
        const a = assets.get(hit.file.name);
        if (!a || !a.width) continue;
        const kb = kenBurns(a.width, a.height, p.settings.width, p.settings.height, end - start, commands.length);
        commands.push({
          id: newId('k'),
          projectId: p.id,
          type: 'add_overlay',
          start,
          end,
          createdBy: 'ai',
          skill: 'edit-script-to-video',
          confidence: by === 'llm' ? 0.7 : 0.45,
          reason: `${b.intent} · "${b.text.slice(0, 60)}"`,
          reversible: true,
          payload: { assetId: a.id, role, scale: kb.scale, keyframes: kb.keyframes, license: hit.license, label: b.query },
        });
        blockHit = true;
      }
      if (!blockHit) missing.push(b.index + 1);
    }
    const estimated = blocks.filter((b) => b.timing === 'estimated').length;
    return {
      commands,
      notes: [
        `${blocks.length} bloco(s) do roteiro, ${commands.length} mídia(s) sugeridas (${by === 'llm' ? 'diretor de IA' : 'escolha local: revise antes de aplicar'}).`,
        words.length ? `Sincronizado com a narração${estimated ? ` (${estimated} bloco(s) com tempo estimado)` : ''}.` : `Sem narração gravada: tempo estimado de leitura (${READ_RATE} palavras/s).`,
      ],
      warnings: missing.length ? [`Sem mídia compatível para o(s) bloco(s) ${missing.join(', ')}.`] : [],
    };
  },
};

function bestOwn(manifests: MediaManifest[], text: string, used: Set<string>) {
  let best: { m: MediaManifest; score: number } | null = null;
  for (const m of manifests) {
    if (used.has(m.assetId)) continue;
    const score = matchScore(text, m);
    if (score > 0 && (!best || score > best.score)) best = { m, score };
  }
  return best;
}

function mediaCommand(ctx: SkillContext, a: Asset, m: MediaManifest, o: { start: number; end: number; role: 'broll' | 'main'; i: number; confidence: number; reason: string }): EditCommand {
  const p = ctx.project();
  const base = { id: newId('k'), projectId: p.id, start: o.start, end: o.end, createdBy: 'ai' as const, skill: 'edit-script-to-video', confidence: o.confidence, reason: o.reason, reversible: true };
  if (a.kind === 'image') {
    const kb = kenBurns(a.width, a.height, p.settings.width, p.settings.height, o.end - o.start, o.i);
    return { ...base, type: 'add_overlay', payload: { assetId: a.id, role: o.role, scale: kb.scale, keyframes: kb.keyframes, label: a.name } };
  }
  const range = m.usableRanges[0];
  const end = Math.min(o.end, o.start + (range.end - range.start));
  return { ...base, end, type: 'add_clip', payload: { assetId: a.id, role: o.role, sourceIn: range.start, volume: 0, scale: a.width ? +coverScale(a.width, a.height, p.settings.width, p.settings.height).toFixed(3) : 1, label: a.name } };
}
