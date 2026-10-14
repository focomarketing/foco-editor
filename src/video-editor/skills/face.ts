// Onde está o rosto da pessoa no quadro: o texto e os botões entram no espaço livre ao lado dele,
// nunca por cima, e o zoom cresce em direção ao rosto (ele fica parado e enquadrado). Com a IA que
// enxerga, o Claude marca a cabeça em quadros reais (uma vez por mídia); sem ela, um palpite
// conservador (pessoa no centro, cabeça no terço de cima).

import { askJsonVision } from '../../engine/ai/providers';
import type { SkillContext } from '../orchestrator/orchestrator';
import { visionReady } from './common';

/** Caixa da cabeça (cabelo ao queixo), em fração do quadro (0..1). */
export interface FaceBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Medida nos quadros (true) ou palpite (false). */
  seen: boolean;
}

export const GUESS: FaceBox = { x0: 0.38, y0: 0.12, x1: 0.62, y1: 0.55, seen: false };

const cache = new Map<string, FaceBox>();

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'x0', 'y0', 'x1', 'y1'],
  properties: {
    found: { type: 'boolean' },
    x0: { type: 'number' },
    y0: { type: 'number' },
    x1: { type: 'number' },
    y1: { type: 'number' },
  },
} as const;

const clamp01 = (v: unknown) => Math.max(0, Math.min(1, typeof v === 'number' && Number.isFinite(v) ? v : 0));

/** Caixa da cabeça na mídia principal (cache por mídia; câmera parada = uma medida vale o vídeo). */
export async function faceBox(ctx: SkillContext, assetId: string): Promise<FaceBox> {
  const hit = cache.get(assetId);
  if (hit) return hit;
  const a = ctx.project().assets[assetId];
  let box = GUESS;
  if (a && visionReady(ctx.ai) && ctx.services.frames) {
    try {
      ctx.progress('Localizando o rosto nos quadros (o texto entra ao lado dele)…');
      const frames = await ctx.services.frames(assetId, [0.15, 0.5, 0.85].map((k) => a.duration * k));
      if (frames.length) {
        const r = (await askJsonVision(
          ctx.ai,
          'Você marca onde está a cabeça da pessoa principal em quadros de vídeo, para um editor não pôr texto em cima dela. Responda só o JSON.',
          'Nestes quadros (mesma câmera), dê a caixa que contém a CABEÇA da pessoa principal em todos eles (do topo do cabelo ao queixo, de orelha a orelha, com uma pequena folga), em fração da largura (x) e da altura (y) do quadro, de 0 a 1. found=false se não há pessoa.',
          frames.map((base64) => ({ base64, mediaType: 'image/jpeg' as const })),
          SCHEMA as unknown as Record<string, unknown>,
          ctx.signal,
        )) as Record<string, unknown>;
        const b = { x0: clamp01(r.x0), y0: clamp01(r.y0), x1: clamp01(r.x1), y1: clamp01(r.y1) };
        if (r.found !== false && b.x1 - b.x0 > 0.05 && b.y1 - b.y0 > 0.05) box = { ...b, seen: true };
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      ctx.log(`não consegui localizar o rosto: ${e instanceof Error ? e.message : e}`);
    }
  }
  cache.set(assetId, box);
  return box;
}

/** Para testes. */
export const clearFaceCache = () => cache.clear();

/** Caixa já medida (sem chamar a IA); senão, o palpite. */
export const cachedFace = (assetId: string): FaceBox => cache.get(assetId) ?? GUESS;

/** Espaço livre para texto ao lado da cabeça: centro (cx, cy) e largura útil, em fração do quadro. */
export interface Zone {
  cx: number;
  cy: number;
  width: number;
  side: 'left' | 'right' | 'below';
}

const MARGIN = 0.05;

/** O lado com mais espaço ao lado da cabeça; se nenhum tem 26% do quadro, abaixo do rosto (acima da legenda). */
export function freeZone(f: FaceBox): Zone {
  const left = f.x0 - MARGIN - 0.04;
  const right = 1 - f.x1 - MARGIN - 0.04;
  const cy = Math.min(0.6, Math.max(0.3, (f.y0 + f.y1) / 2));
  if (Math.max(left, right) >= 0.26) {
    return right >= left
      ? { cx: f.x1 + 0.04 + right / 2, cy, width: right, side: 'right' }
      : { cx: MARGIN + left / 2, cy, width: left, side: 'left' };
  }
  return { cx: 0.5, cy: Math.min(0.72, f.y1 + 0.1), width: 0.7, side: 'below' };
}

/**
 * Deslocamento que mantém o rosto parado durante um zoom pelo centro: com escala s, a imagem
 * anda (0,5 − centro do rosto) × (s − 1), em fração do quadro. A imagem continua cobrindo o quadro.
 */
export function faceAnchorOffset(f: FaceBox, scale: number): { x: number; y: number } {
  const fx = (f.x0 + f.x1) / 2;
  const fy = (f.y0 + f.y1) / 2;
  return { x: +((0.5 - fx) * (scale - 1)).toFixed(4), y: +((0.5 - fy) * (scale - 1)).toFixed(4) };
}
