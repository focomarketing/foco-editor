// LUTs (Fase 7): leitura de arquivos .cube (3D e 1D), looks prontos gerados por código e o
// registro em memória consultado pelo processador de cor (preview e export) na hora do quadro.
//
// Ids: LUT importada = id do asset (kind 'lut'); look pronto = "look:<nome>".

export interface Lut {
  title: string;
  /** Pontos por eixo (tabela size³). */
  size: number;
  /** RGB em ordem .cube: vermelho varia mais rápido, depois verde, depois azul. */
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

/** Lê um .cube (Adobe/Resolve). Tabela 1D vira 3D (cada canal pela sua curva). Lança erro legível. */
export function parseCube(text: string): Lut {
  let title = '';
  let size3 = 0;
  let size1 = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const rows: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (key === 'LUT_3D_SIZE') size3 = Number(parts[1]);
    else if (key === 'LUT_1D_SIZE') size1 = Number(parts[1]);
    else if (key === 'DOMAIN_MIN') domainMin = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    else if (key === 'DOMAIN_MAX') domainMax = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    else if (/^[-+.\d]/.test(parts[0])) {
      if (parts.length < 3) throw new Error(`linha inválida: "${line}"`);
      rows.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
    // outras palavras-chave (LUT_3D_INPUT_RANGE etc.) são ignoradas
  }
  if (rows.some((v) => !Number.isFinite(v))) throw new Error('números inválidos na tabela');
  if (size3) {
    if (size3 < 2 || size3 > 128) throw new Error(`LUT_3D_SIZE fora do intervalo (${size3})`);
    if (rows.length !== size3 ** 3 * 3) throw new Error(`esperava ${size3 ** 3} linhas, achei ${rows.length / 3}`);
    return { title, size: size3, data: Float32Array.from(rows), domainMin, domainMax };
  }
  if (size1) {
    if (rows.length !== size1 * 3) throw new Error(`esperava ${size1} linhas, achei ${rows.length / 3}`);
    const curve = (ch: number, v: number) => {
      const x = Math.min(1, Math.max(0, v)) * (size1 - 1);
      const i = Math.min(size1 - 2, Math.floor(x));
      const f = x - i;
      return rows[i * 3 + ch] * (1 - f) + rows[(i + 1) * 3 + ch] * f;
    };
    const lut = lutFromFunction(33, (r, g, b) => [curve(0, r), curve(1, g), curve(2, b)], title);
    return { ...lut, domainMin, domainMax };
  }
  throw new Error('não é um arquivo .cube (falta LUT_3D_SIZE ou LUT_1D_SIZE)');
}

/** Tabela size³ a partir de uma função (r, g, b em 0..1). */
export function lutFromFunction(size: number, fn: (r: number, g: number, b: number) => [number, number, number], title = ''): Lut {
  const data = new Float32Array(size ** 3 * 3);
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const out = fn(r / (size - 1), g / (size - 1), b / (size - 1));
        data[i++] = clamp01(out[0]);
        data[i++] = clamp01(out[1]);
        data[i++] = clamp01(out[2]);
      }
  return { title, size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

/** Aplica a LUT a uma cor na CPU (interpolação trilinear) — testes e prévias. */
export function sampleLut(lut: Lut, rgb: [number, number, number]): [number, number, number] {
  const n = lut.size;
  const idx = (v: number, ch: number) => Math.min(n - 1, Math.max(0, ((v - lut.domainMin[ch]) / (lut.domainMax[ch] - lut.domainMin[ch] || 1)) * (n - 1)));
  const [x, y, z] = [idx(rgb[0], 0), idx(rgb[1], 1), idx(rgb[2], 2)];
  const x0 = Math.min(n - 2, Math.floor(x)), y0 = Math.min(n - 2, Math.floor(y)), z0 = Math.min(n - 2, Math.floor(z));
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const at = (r: number, g: number, b: number, ch: number) => lut.data[((b * n + g) * n + r) * 3 + ch];
  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const c00 = at(x0, y0, z0, ch) * (1 - fx) + at(x0 + 1, y0, z0, ch) * fx;
    const c10 = at(x0, y0 + 1, z0, ch) * (1 - fx) + at(x0 + 1, y0 + 1, z0, ch) * fx;
    const c01 = at(x0, y0, z0 + 1, ch) * (1 - fx) + at(x0 + 1, y0, z0 + 1, ch) * fx;
    const c11 = at(x0, y0 + 1, z0 + 1, ch) * (1 - fx) + at(x0 + 1, y0 + 1, z0 + 1, ch) * fx;
    out[ch] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  }
  return out;
}

// --- looks prontos ----------------------------------------------------------------------------

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Curva em S suave (contraste) com intensidade k. */
const sCurve = (v: number, k: number) => clamp01(v + k * (v - 0.5) * (1 - Math.abs(2 * v - 1)) * 2);
const sat = (r: number, g: number, b: number, s: number): [number, number, number] => {
  const l = luma(r, g, b);
  return [l + (r - l) * s, l + (g - l) * s, l + (b - l) * s];
};
/** Levanta pretos e baixa brancos (filme/matte). */
const fade = (v: number, black: number, white: number) => black + v * (white - black);

type LookFn = (r: number, g: number, b: number) => [number, number, number];

export const LOOKS: { id: string; label: string; fn: LookFn }[] = [
  {
    id: 'teal-orange', label: 'Teal & Orange',
    fn: (r, g, b) => {
      const l = luma(r, g, b);
      const [R, G, B] = sat(r, g, b, 1.12);
      return [sCurve(R - 0.05 * (1 - l) + 0.07 * l, 0.25), sCurve(G + 0.02 * (1 - l) + 0.02 * l, 0.25), sCurve(B + 0.07 * (1 - l) - 0.06 * l, 0.25)];
    },
  },
  {
    id: 'filme-quente', label: 'Filme quente',
    fn: (r, g, b) => {
      const [R, G, B] = sat(r, g, b, 0.9);
      return [fade(sCurve(R + 0.03, 0.15), 0.04, 0.97), fade(sCurve(G + 0.01, 0.15), 0.035, 0.95), fade(sCurve(B - 0.04, 0.15), 0.05, 0.9)];
    },
  },
  {
    id: 'bleach', label: 'Bleach bypass',
    fn: (r, g, b) => {
      const [R, G, B] = sat(r, g, b, 0.5);
      return [sCurve(R, 0.6), sCurve(G, 0.6), sCurve(B, 0.6)];
    },
  },
  {
    id: 'matte', label: 'Matte',
    fn: (r, g, b) => {
      const [R, G, B] = sat(r, g, b, 0.85);
      return [fade(R, 0.08, 0.93), fade(G, 0.08, 0.93), fade(B, 0.09, 0.94)];
    },
  },
  {
    id: 'noir', label: 'Noir',
    fn: (r, g, b) => {
      const l = sCurve(luma(r, g, b), 0.55);
      return [l * 0.97, l * 0.99, Math.min(1, l * 1.04)];
    },
  },
  {
    id: 'azul-noite', label: 'Azul noite',
    fn: (r, g, b) => {
      const [R, G, B] = sat(r, g, b, 0.7);
      return [R * 0.85, G * 0.95 + 0.01, Math.min(1, B * 1.1 + 0.05)];
    },
  },
  {
    id: 'vintage', label: 'Vintage',
    fn: (r, g, b) => {
      const l = luma(r, g, b);
      const [R, G, B] = sat(r, g, b, 0.75);
      return [fade(R + 0.04 * l + 0.03 * (1 - l), 0.07, 0.95), fade(G + 0.03 * l, 0.06, 0.93), fade(B - 0.05 * l + 0.04 * (1 - l), 0.08, 0.85)];
    },
  },
  {
    id: 'vivido', label: 'Vívido',
    fn: (r, g, b) => {
      const [R, G, B] = sat(r, g, b, 1.35);
      return [sCurve(R, 0.2), sCurve(G, 0.2), sCurve(B, 0.2)];
    },
  },
  {
    id: 'hora-dourada', label: 'Hora dourada',
    fn: (r, g, b) => {
      const l = luma(r, g, b);
      return [r * 1.06 + 0.04 * l, g * 1.0 + 0.02 * l, b * 0.86];
    },
  },
  {
    id: 'cyberpunk', label: 'Cyberpunk',
    fn: (r, g, b) => {
      const l = luma(r, g, b);
      const [R, G, B] = sat(r, g, b, 1.2);
      return [sCurve(R + 0.08 * l, 0.25), sCurve(G * 0.85, 0.25), sCurve(B + 0.1 * (1 - l) + 0.04, 0.25)];
    },
  },
  {
    id: 'pastel', label: 'Pastel',
    fn: (r, g, b) => {
      const [R, G, B] = sat(r, g, b, 0.7);
      return [fade(R, 0.12, 1), fade(G, 0.12, 0.99), fade(B, 0.14, 1)];
    },
  },
];

// --- registro --------------------------------------------------------------------------------

const registry = new Map<string, Lut>();
const listeners = new Set<() => void>();

export const lookId = (id: string) => `look:${id}`;

/** LUT pelo id (look pronto é gerado na primeira vez). null se a LUT importada não está carregada. */
export function getLut(id: string | undefined): Lut | null {
  if (!id) return null;
  let lut = registry.get(id);
  if (!lut && id.startsWith('look:')) {
    const look = LOOKS.find((l) => lookId(l.id) === id);
    if (look) registry.set(id, (lut = lutFromFunction(33, look.fn, look.label)));
  }
  return lut ?? null;
}

/** LUT importada (asset kind 'lut'): fica disponível para preview e export. */
export function registerLut(id: string, lut: Lut) {
  registry.set(id, lut);
  for (const l of listeners) l();
}

export function onLutsChanged(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
