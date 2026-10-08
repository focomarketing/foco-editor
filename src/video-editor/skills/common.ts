// Utilidades compartilhadas pelas skills de montagem: frases com tempo, mídias de apoio
// (takes que não estão na timeline), índice semântico com visão opcional.

import type { Asset, Project } from '../../core/types';
import { askJsonVision } from '../../engine/ai/providers';
import type { AISettings } from '../../engine/ai/providers';
import { manifestFromName, VISION_SCHEMA, withVision } from '../media-analysis/manifest';
import type { MediaManifest } from '../media-analysis/manifest';
import type { SkillContext } from '../orchestrator/orchestrator';

export interface Sentence {
  index: number;
  text: string;
  start: number;
  end: number;
}

/** Frases da fala (fim por pontuação ou pausa > 0,8 s). */
export function sentences(words: { text: string; start: number; end: number }[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: string[] = [];
  let t0 = words[0]?.start ?? 0;
  words.forEach((w, i) => {
    cur.push(w.text.trim());
    const next = words[i + 1];
    if (!next || /[.!?…]$/.test(w.text.trim()) || next.start - w.end > 0.8) {
      out.push({ index: out.length, text: cur.join(' '), start: t0, end: w.end });
      cur = [];
      if (next) t0 = next.start;
    }
  });
  return out;
}

export const llmReady = (s: AISettings) => s.provider === 'ollama' || (!!s.claudeKey && s.cloudConsent);
export const visionReady = (s: AISettings) => s.provider === 'claude' && !!s.claudeKey && s.cloudConsent;

/** Vídeos e imagens do projeto que não estão em nenhuma faixa: os takes de apoio. */
export function supportMedia(p: Project): Asset[] {
  const used = new Set(Object.values(p.clips).map((c) => c.assetId));
  return Object.values(p.assets).filter((a) => !used.has(a.id) && (a.kind === 'video' || a.kind === 'image'));
}

export const isShort = (ctx: SkillContext) => ctx.workflow?.track === 'short' || ctx.project().settings.height > ctx.project().settings.width;

// Descrições por visão ficam em memória por mídia (não pagar duas vezes ao regenerar).
const visionCache = new Map<string, MediaManifest>();

/**
 * Manifesto de cada mídia de apoio. Com o Claude configurado e o serviço de quadros
 * disponível, olha 3 quadros de cada take (até `maxVision` mídias); senão usa o nome.
 */
export async function buildManifests(ctx: SkillContext, assets: Asset[], maxVision = 16): Promise<MediaManifest[]> {
  const out: MediaManifest[] = [];
  let seen = 0;
  const canSee = visionReady(ctx.ai) && !!ctx.services.frames;
  for (const [i, a] of assets.entries()) {
    ctx.signal.throwIfAborted();
    const base = manifestFromName({ id: a.id, name: a.name, duration: a.kind === 'image' ? 5 : a.duration, width: a.width, height: a.height });
    const cached = visionCache.get(a.id);
    if (cached) {
      out.push(cached);
      continue;
    }
    if (canSee && seen < maxVision) {
      seen++;
      ctx.progress(`Olhando o take ${i + 1} de ${assets.length}: ${a.name}`, i, assets.length);
      try {
        const times = a.kind === 'image' ? [0] : [0.25, 0.5, 0.75].map((k) => a.duration * k);
        const frames = await ctx.services.frames!(a.id, times);
        if (frames.length) {
          const v = await askJsonVision(
            ctx.ai,
            'Você descreve takes de vídeo para um editor. Responda em português, objetivo, só o que aparece nos quadros.',
            `Quadros do take "${a.name}" (${a.kind === 'image' ? 'imagem' : `${a.duration.toFixed(1)} s`}). Descreva cenas, objetos, pessoas, tipo de plano, movimento de câmera e palavras que alguém diria ao falar desta cena.`,
            frames.map((base64) => ({ base64, mediaType: 'image/jpeg' as const })),
            VISION_SCHEMA as unknown as Record<string, unknown>,
            ctx.signal,
          );
          const m = withVision(base, v);
          visionCache.set(a.id, m);
          out.push(m);
          continue;
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        ctx.log(`visão indisponível para ${a.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    out.push(base);
  }
  return out;
}

/** Para testes: esquece as descrições por visão. */
export function clearVisionCache() {
  visionCache.clear();
}
