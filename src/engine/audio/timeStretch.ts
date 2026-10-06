// Time-stretch WSOLA (Waveform Similarity Overlap-Add): muda a duração do áudio sem
// mudar o tom. Usado no export de clipes com velocidade ≠ 1x (o preview usa o
// preservesPitch nativo do navegador, que produz o mesmo efeito).

const FRAME = 1024;
const HOP = FRAME / 2;
const SEARCH = 240;
/** Correlação calculada a cada 2 amostras (bem mais rápido, quase sem perda). */
const DECIM = 2;

function hann(n: number) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/**
 * @param speed > 1 acelera (fica mais curto), < 1 desacelera.
 * @returns canais com comprimento round(len / speed)
 */
export function timeStretch(channels: Float32Array[], speed: number): Float32Array[] {
  const inLen = channels[0]?.length ?? 0;
  const outLen = Math.max(0, Math.round(inLen / speed));
  if (!inLen || Math.abs(speed - 1) < 1e-6) return channels.map((c) => c.slice(0, outLen));

  const mono = new Float32Array(inLen);
  for (const c of channels) for (let i = 0; i < inLen; i++) mono[i] += c[i] / channels.length;

  const w = hann(FRAME);
  const out = channels.map(() => new Float32Array(outLen + FRAME));
  const norm = new Float32Array(outLen + FRAME);
  const ha = HOP * speed;
  const maxPos = inLen - FRAME;
  let prev = 0;

  for (let k = 0; k * HOP < outLen; k++) {
    let pos: number;
    if (k === 0) {
      pos = 0;
    } else {
      // O trecho que continuaria naturalmente o quadro anterior...
      const natural = prev + HOP;
      const nominal = Math.round(k * ha);
      let best = Math.min(Math.max(0, nominal), Math.max(0, maxPos));
      let bestScore = -Infinity;
      // ...e o ponto, perto do nominal, que mais se parece com ele.
      const lo = Math.max(0, nominal - SEARCH);
      const hi = Math.min(maxPos, nominal + SEARCH);
      if (natural <= maxPos) {
        for (let c = lo; c <= hi; c++) {
          let score = 0;
          for (let j = 0; j < HOP; j += DECIM) score += mono[c + j] * mono[natural + j];
          if (score > bestScore) {
            bestScore = score;
            best = c;
          }
        }
      }
      pos = best;
    }
    if (pos > maxPos) pos = Math.max(0, maxPos);
    const o = k * HOP;
    for (let j = 0; j < FRAME; j++) {
      const src = pos + j;
      if (src >= inLen) break;
      const g = w[j];
      for (let ch = 0; ch < channels.length; ch++) out[ch][o + j] += channels[ch][src] * g;
      norm[o + j] += g;
    }
    prev = pos;
  }
  return out.map((c) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? c[i] / norm[i] : 0;
    return r;
  });
}
