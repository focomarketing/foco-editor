// media-semantic-index: um "manifesto" por mídia de apoio (take, imagem) com o que ela mostra,
// palavras-chave e trechos utilizáveis. Base para casar fala ↔ take sem escolher às cegas.
// Fontes do manifesto: nome do arquivo (sempre), descrição por visão (Claude, quando há) e
// descrição escrita pelo usuário (quando houver).

import { normalizeWord } from '../../engine/analysis/cuts';

export interface MediaManifest {
  assetId: string;
  duration: number;
  scenes: string[];
  objects: string[];
  people: string[];
  cameraMovement?: string;
  shotType?: string;
  qualityScore?: number;
  keywords: string[];
  usableRanges: { start: number; end: number; description?: string }[];
  /** De onde veio a descrição: confiança do casamento depende disso. */
  source: 'filename' | 'vision' | 'user';
}

const STOP = new Set('a o os as um uma de da do das dos em no na nos nas por para com e ou que se eu me te tu ele ela nao sim ja la ai vc pra pro ao img vid video mov mp4 take clip copia copy final edit dsc gopr pxl dji'.split(' '));

/** Palavras (normalizadas, sem acento) de um texto. */
export function tokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => normalizeWord(t).norm)
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

/** Trechos utilizáveis: sem a pontinha do começo/fim (câmera ligando), em pedaços de até 6 s. */
export function usableRanges(duration: number, maxLen = 6): MediaManifest['usableRanges'] {
  const a = Math.min(0.5, duration * 0.1);
  const b = Math.max(a + 0.5, duration - Math.min(0.5, duration * 0.1));
  const out: MediaManifest['usableRanges'] = [];
  for (let t = a; t < b - 0.8; t += maxLen) out.push({ start: +t.toFixed(2), end: +Math.min(b, t + maxLen).toFixed(2) });
  return out.length ? out : [{ start: 0, end: duration }];
}

export function manifestFromName(asset: { id: string; name: string; duration: number; width: number; height: number }): MediaManifest {
  const kw = tokens(asset.name.replace(/\.[^.]+$/, ''));
  return {
    assetId: asset.id,
    duration: asset.duration,
    scenes: [],
    objects: [],
    people: [],
    qualityScore: Math.min(1, Math.max(asset.width, asset.height) / 1920),
    keywords: [...new Set(kw)],
    usableRanges: usableRanges(asset.duration || 5),
    source: 'filename',
  };
}

/** Schema da descrição por visão (o que aparece nos quadros do take). */
export const VISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenes', 'objects', 'people', 'shotType', 'cameraMovement', 'keywords'],
  properties: {
    scenes: { type: 'array', items: { type: 'string' } },
    objects: { type: 'array', items: { type: 'string' } },
    people: { type: 'array', items: { type: 'string' } },
    shotType: { type: 'string', description: 'close, médio, geral, detalhe, aéreo' },
    cameraMovement: { type: 'string', description: 'parada, pan, tilt, drone, mão' },
    keywords: { type: 'array', items: { type: 'string' }, description: 'palavras em português que alguém diria ao falar desta cena' },
  },
} as const;

export function withVision(m: MediaManifest, v: unknown): MediaManifest {
  const o = (v ?? {}) as Record<string, unknown>;
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 60)).slice(0, 12) : []);
  const scenes = arr(o.scenes);
  const objects = arr(o.objects);
  const people = arr(o.people);
  const kw = [...m.keywords, ...arr(o.keywords).flatMap(tokens), ...scenes.flatMap(tokens), ...objects.flatMap(tokens)];
  return { ...m, scenes, objects, people, shotType: typeof o.shotType === 'string' ? o.shotType : undefined, cameraMovement: typeof o.cameraMovement === 'string' ? o.cameraMovement : undefined, keywords: [...new Set(kw)], source: 'vision' };
}

/** Quanto uma frase "fala" deste take (0..1): palavras em comum, ponderado pela fonte. */
export function matchScore(sentence: string, m: MediaManifest): number {
  const st = new Set(tokens(sentence));
  if (!st.size || !m.keywords.length) return 0;
  let hits = 0;
  for (const k of m.keywords) if (st.has(k)) hits++;
  // prefixo comum (piscina/piscinas, casa/casas)
  if (!hits) for (const k of m.keywords) for (const t of st) if (k.length > 4 && t.length > 4 && (k.startsWith(t.slice(0, 5)) || t.startsWith(k.slice(0, 5)))) hits += 0.6;
  const raw = Math.min(1, hits / Math.min(3, m.keywords.length));
  return raw * (m.source === 'filename' ? 0.75 : 1);
}
