// Análise de uma passagem entre dois clipes: movimento de câmera (deslocamento global entre dois
// quadros), cor dominante, quanto a imagem muda no corte, batidas da música e energia do áudio.
// Funções puras sobre pixels/níveis: a skill busca os dados e decide com estes números.

export interface Gray {
  data: Float32Array;
  width: number;
  height: number;
}

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function toGray(px: Pixels): Gray {
  const out = new Float32Array(px.width * px.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * px.data[i * 4] + 0.587 * px.data[i * 4 + 1] + 0.114 * px.data[i * 4 + 2];
  return { data: out, width: px.width, height: px.height };
}

export function meanColor(px: Pixels): [number, number, number] {
  let r = 0, g = 0, b = 0;
  const n = px.width * px.height;
  for (let i = 0; i < n; i++) {
    r += px.data[i * 4];
    g += px.data[i * 4 + 1];
    b += px.data[i * 4 + 2];
  }
  return [r / n, g / n, b / n];
}

/** Nome da cor dominante (para o motivo e para o relatório). */
export function colorName([r, g, b]: [number, number, number]): string {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 45) return 'escuro';
  if (max - min < 18) return max > 200 ? 'branco' : 'cinza';
  if (r >= g && r >= b) return g > b * 1.25 ? (g > r * 0.75 ? 'amarelo' : 'laranja') : 'vermelho';
  if (g >= r && g >= b) return 'verde';
  return r > g ? 'roxo' : 'azul';
}

/** Diferença visual 0..1 entre dois quadros (cor média + estrutura em grade 8x8). */
export function visualDistance(a: Pixels, b: Pixels): number {
  const grid = (px: Pixels) => {
    const cells = new Float32Array(64 * 3);
    const counts = new Float32Array(64);
    for (let y = 0; y < px.height; y++)
      for (let x = 0; x < px.width; x++) {
        const c = Math.min(7, Math.floor((y / px.height) * 8)) * 8 + Math.min(7, Math.floor((x / px.width) * 8));
        const i = (y * px.width + x) * 4;
        cells[c * 3] += px.data[i];
        cells[c * 3 + 1] += px.data[i + 1];
        cells[c * 3 + 2] += px.data[i + 2];
        counts[c]++;
      }
    for (let c = 0; c < 64; c++) for (let k = 0; k < 3; k++) cells[c * 3 + k] /= Math.max(1, counts[c]);
    return cells;
  };
  const ga = grid(a), gb = grid(b);
  let d = 0;
  for (let i = 0; i < ga.length; i++) d += Math.abs(ga[i] - gb[i]);
  return Math.min(1, d / ga.length / 90);
}

/**
 * Deslocamento global entre dois quadros (fração da largura/altura): para onde a imagem andou.
 * Busca exaustiva pequena (±R pixels) minimizando a diferença média na área comum.
 */
export function globalShift(a: Gray, b: Gray, R = 6): { dx: number; dy: number; error: number } {
  let best = { dx: 0, dy: 0, error: Infinity };
  const { width: w, height: h } = a;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      let sum = 0, n = 0;
      for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y += 1)
        for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x += 1) {
          sum += Math.abs(a.data[y * w + x] - b.data[(y + dy) * w + x + dx]);
          n++;
        }
      const e = sum / Math.max(1, n);
      if (e < best.error - 1e-9 || (Math.abs(e - best.error) < 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, error: e };
    }
  return { dx: best.dx / w, dy: best.dy / h, error: best.error };
}

export type Direction = 'left' | 'right' | 'up' | 'down' | 'static';

/** Direção do movimento de câmera (a imagem anda para um lado; a câmera vai para o outro). */
export function motionDirection(v: { dx: number; dy: number } | null, min = 0.02): Direction {
  if (!v || Math.hypot(v.dx, v.dy) < min) return 'static';
  if (Math.abs(v.dx) >= Math.abs(v.dy)) return v.dx < 0 ? 'left' : 'right';
  return v.dy < 0 ? 'up' : 'down';
}

/** Os dois planos andam na mesma direção, com força parecida? (corte por movimento / whip). */
export function motionMatches(a: { dx: number; dy: number } | null, b: { dx: number; dy: number } | null, min = 0.02): boolean {
  if (!a || !b) return false;
  const ma = Math.hypot(a.dx, a.dy), mb = Math.hypot(b.dx, b.dy);
  if (ma < min || mb < min) return false;
  const cos = (a.dx * b.dx + a.dy * b.dy) / (ma * mb);
  return cos > 0.7 && Math.max(ma, mb) / Math.min(ma, mb) < 3;
}

/**
 * Batidas a partir dos níveis RMS (dBFS, `rate` por segundo): subidas bruscas de energia acima
 * da média local, separadas por pelo menos `minGap` s. Devolve tempos na mídia.
 */
export function detectBeats(levelsDb: Float32Array, rate: number, minGap = 0.25): number[] {
  const n = levelsDb.length;
  if (n < rate) return [];
  const lin = Float32Array.from(levelsDb, (db) => Math.pow(10, Math.max(-80, db) / 20));
  const flux = new Float32Array(n);
  const win = Math.max(2, Math.round(rate * 0.12));
  for (let i = win; i < n; i++) {
    let m = 0;
    for (let k = i - win; k < i; k++) m += lin[k];
    flux[i] = Math.max(0, lin[i] - m / win);
  }
  let mean = 0;
  for (const f of flux) mean += f;
  mean /= n;
  let sd = 0;
  for (const f of flux) sd += (f - mean) ** 2;
  sd = Math.sqrt(sd / n);
  const thr = mean + 1.5 * sd;
  const out: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (flux[i] < thr || flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    const t = i / rate;
    if (out.length && t - out[out.length - 1] < minGap) continue;
    out.push(t);
  }
  return out;
}

/** Energia 0..1 do áudio em [t0, t1) da mídia (RMS médio em dB → escala de -50 a -6 dB). */
export function energyAt(levelsDb: Float32Array | null, rate: number, t0: number, t1: number): number {
  if (!levelsDb) return 0.5;
  const a = Math.max(0, Math.floor(t0 * rate)), b = Math.min(levelsDb.length, Math.ceil(t1 * rate));
  if (b <= a) return 0.5;
  let s = 0;
  for (let i = a; i < b; i++) s += levelsDb[i];
  const db = s / (b - a);
  return Math.max(0, Math.min(1, (db + 50) / 44));
}
