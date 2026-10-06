// Color Engine: presets, correção automática (a partir de estatísticas reais dos quadros)
// e o processador WebGL2 que aplica a correção em cada quadro (preview e export).

import type { ColorSettings } from '../../core/types';

export const NEUTRAL_COLOR: ColorSettings = {
  preset: 'none',
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  vignette: 0,
};

const p = (preset: string, s: Partial<ColorSettings>): ColorSettings => ({ ...NEUTRAL_COLOR, ...s, preset });

export const COLOR_PRESETS: { id: string; label: string; settings: ColorSettings }[] = [
  { id: 'clean', label: 'Clean', settings: p('clean', { contrast: 0.08, saturation: 0.05, vibrance: 0.1 }) },
  { id: 'cinematic', label: 'Cinematic', settings: p('cinematic', { contrast: 0.18, highlights: -0.25, shadows: 0.05, saturation: -0.12, temperature: 0.06, tint: -0.04, vignette: 0.35 }) },
  { id: 'warm', label: 'Warm', settings: p('warm', { contrast: 0.06, temperature: 0.35, saturation: 0.05 }) },
  { id: 'cool', label: 'Cool', settings: p('cool', { contrast: 0.06, temperature: -0.35, tint: 0.05 }) },
  { id: 'film', label: 'Film', settings: p('film', { contrast: -0.08, highlights: -0.15, shadows: 0.2, saturation: -0.2, temperature: 0.1, vignette: 0.25 }) },
  { id: 'youtube', label: 'YouTube', settings: p('youtube', { exposure: 0.1, contrast: 0.12, saturation: 0.15, vibrance: 0.25 }) },
  { id: 'commercial', label: 'Commercial', settings: p('commercial', { exposure: 0.05, contrast: 0.15, highlights: -0.1, shadows: 0.1, saturation: 0.1, vibrance: 0.2 }) },
  { id: 'social', label: 'Social Media', settings: p('social', { exposure: 0.1, contrast: 0.2, saturation: 0.25, vibrance: 0.3 }) },
];

export const colorPreset = (id: string) => COLOR_PRESETS.find((x) => x.id === id)?.settings ?? NEUTRAL_COLOR;

export function isNeutral(c: ColorSettings | undefined) {
  if (!c) return true;
  return (Object.keys(NEUTRAL_COLOR) as (keyof ColorSettings)[]).every((k) => k === 'preset' || c[k] === 0);
}

// ---------------------------------------------------------------------------
// Correção automática

export interface FrameStats {
  /** Médias em sRGB 0..1 */
  r: number;
  g: number;
  b: number;
  /** Luminância sRGB: média e percentis 2% / 98% */
  luma: number;
  p02: number;
  p98: number;
  /** Croma médio (max-min por pixel) */
  chroma: number;
}

const clampN = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Correção técnica: exposição, balanço de branco, contraste e saturação a partir das estatísticas. */
export function autoColorFromStats(s: FrameStats): ColorSettings {
  const lin = (v: number) => Math.pow(Math.max(v, 1e-4), 2.2);
  const exposure = clampN(Math.log2(lin(0.45) / lin(s.luma)), -1.5, 1.5);
  const mean = (s.r + s.g + s.b) / 3 || 1e-3;
  // mundo cinza: puxa a média de R e B para o mesmo valor, e G para a média dos dois
  const temperature = clampN(((s.b - s.r) / mean) * 1.5, -0.6, 0.6);
  const tint = clampN(((s.g - (s.r + s.b) / 2) / mean) * 2, -0.5, 0.5);
  const spread = s.p98 - s.p02;
  const contrast = spread < 0.75 ? clampN((0.85 - spread) * 0.6, 0, 0.35) : spread > 0.97 ? -0.05 : 0.04;
  const saturation = s.chroma < 0.12 ? 0.12 : s.chroma > 0.35 ? -0.08 : 0.04;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    ...NEUTRAL_COLOR,
    preset: 'auto',
    exposure: round(exposure),
    temperature: round(temperature),
    tint: round(tint),
    contrast: round(contrast),
    saturation: round(saturation),
    vibrance: 0.1,
  };
}

/** Estatísticas de um conjunto de quadros (ImageData pequenos). */
export function statsFromPixels(frames: { data: Uint8ClampedArray | Uint8Array }[]): FrameStats {
  let r = 0;
  let g = 0;
  let b = 0;
  let chroma = 0;
  let n = 0;
  const hist = new Uint32Array(256);
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i] / 255;
      const G = d[i + 1] / 255;
      const B = d[i + 2] / 255;
      r += R;
      g += G;
      b += B;
      chroma += Math.max(R, G, B) - Math.min(R, G, B);
      hist[Math.round((0.2126 * R + 0.7152 * G + 0.0722 * B) * 255)]++;
      n++;
    }
  }
  n = Math.max(1, n);
  const pct = (q: number) => {
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= q * n) return i / 255;
    }
    return 1;
  };
  let lumaSum = 0;
  for (let i = 0; i < 256; i++) lumaSum += hist[i] * (i / 255);
  return { r: r / n, g: g / n, b: b / n, luma: lumaSum / n, p02: pct(0.02), p98: pct(0.98), chroma: chroma / n };
}

// ---------------------------------------------------------------------------
// Processador WebGL2

const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = (p + 1.0) * 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D tex;
uniform float exposure, contrast, highlights, shadows, saturation, vibrance, temperature, tint, vignette;
in vec2 uv;
out vec4 o;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);
void main() {
  vec3 c = texture(tex, vec2(uv.x, 1.0 - uv.y)).rgb;
  vec3 lin = pow(c, vec3(2.2)) * exp2(exposure);
  lin *= vec3(1.0 + temperature * 0.12, 1.0 - tint * 0.08, 1.0 - temperature * 0.12);
  c = pow(max(lin, 0.0), vec3(1.0 / 2.2));
  float l = dot(c, W);
  float sh = 1.0 - smoothstep(0.0, 0.5, l);
  float hi = smoothstep(0.5, 1.0, l);
  c += vec3(shadows * 0.22 * sh + highlights * 0.22 * hi);
  c = (c - 0.5) * (1.0 + contrast) + 0.5;
  l = dot(c, W);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, 1.0 + saturation + vibrance * (1.0 - clamp(sat, 0.0, 1.0)));
  vec2 d = uv - 0.5;
  c *= 1.0 - vignette * smoothstep(0.35, 0.85, length(d) * 1.25);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const UNIFORMS = ['exposure', 'contrast', 'highlights', 'shadows', 'saturation', 'vibrance', 'temperature', 'tint', 'vignette'] as const;

export class ColorProcessor {
  private canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext | null;
  private loc: Record<string, WebGLUniformLocation | null> = {};

  constructor() {
    this.canvas = new OffscreenCanvas(2, 2);
    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!this.gl) return;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aP = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(aP);
    gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const u of UNIFORMS) this.loc[u] = gl.getUniformLocation(prog, u);
  }

  get available() {
    return !!this.gl;
  }

  /** Aplica a correção e devolve um canvas (reutilizado: desenhe-o antes da próxima chamada). */
  process(source: TexImageSource, width: number, height: number, c: ColorSettings): OffscreenCanvas | null {
    const gl = this.gl;
    if (!gl) return null;
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    for (const u of UNIFORMS) gl.uniform1f(this.loc[u], c[u]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

let shared: ColorProcessor | null = null;
export function colorProcessor(): ColorProcessor {
  shared ??= new ColorProcessor();
  return shared;
}
