// Biblioteca de sons do FOCO: trilhas por clima, efeitos sonoros e ambientes gerados aqui mesmo
// (síntese com Web Audio, renderizada offline). Nada vem de fora: sem licença, sem internet, e o
// mesmo id + duração + semente dá sempre o mesmo som. Sai como WAV para importar na timeline.

export type SoundKind = 'music' | 'sfx' | 'ambience';

export interface SoundDef {
  id: string;
  kind: SoundKind;
  label: string;
  hint: string;
  /** Duração padrão (s); trilhas e ambientes aceitam outra. */
  duration: number;
  tags: string[];
}

export const SOUND_LIBRARY: SoundDef[] = [
  // trilhas
  { id: 'contemplativa', kind: 'music', label: 'Contemplativa', hint: 'pads lentos e piano esparso · reflexão, fé, ensaio', duration: 120, tags: ['cristão', 'reflexão', 'calma'] },
  { id: 'reflexao', kind: 'music', label: 'Reflexão (menor)', hint: 'tom menor, sério e íntimo · perguntas difíceis', duration: 120, tags: ['cristão', 'sério', 'documentário'] },
  { id: 'esperanca', kind: 'music', label: 'Esperança', hint: 'acordes maiores e arpejo que abre · conclusão, virada', duration: 120, tags: ['cristão', 'conclusão', 'inspirador'] },
  { id: 'tensao', kind: 'music', label: 'Tensão', hint: 'drone grave e pulsos · gancho, mistério, dark', duration: 120, tags: ['suspense', 'dark', 'gancho'] },
  { id: 'epica', kind: 'music', label: 'Épica', hint: 'pads cheios e tambores graves · documentário, clímax', duration: 120, tags: ['cinemático', 'clímax'] },
  { id: 'lofi', kind: 'music', label: 'Lo-fi atual', hint: 'acordes de sétima e batida leve · educativo, vlog', duration: 120, tags: ['educativo', 'moderno'] },
  { id: 'energia', kind: 'music', label: 'Energia', hint: 'batida 4/4 e acordes curtos · curtos, venda', duration: 60, tags: ['curto', 'rápido'] },
  // efeitos sonoros
  { id: 'whoosh', kind: 'sfx', label: 'Whoosh', hint: 'passagem rápida · troca de cena', duration: 0.7, tags: ['transição'] },
  { id: 'whoosh-suave', kind: 'sfx', label: 'Whoosh suave', hint: 'passagem longa e grave · entrada de imagem', duration: 1.2, tags: ['transição', 'suave'] },
  { id: 'riser', kind: 'sfx', label: 'Riser', hint: 'subida de tensão até o corte', duration: 2.5, tags: ['tensão', 'capítulo'] },
  { id: 'swell', kind: 'sfx', label: 'Swell', hint: 'onda que cresce e para no corte · novo bloco', duration: 2, tags: ['capítulo', 'suave'] },
  { id: 'impacto', kind: 'sfx', label: 'Impacto', hint: 'golpe grave com cauda · frase de efeito', duration: 2.5, tags: ['ênfase'] },
  { id: 'sub-drop', kind: 'sfx', label: 'Sub drop', hint: 'queda grave · virada', duration: 1.5, tags: ['ênfase', 'grave'] },
  { id: 'pop', kind: 'sfx', label: 'Pop', hint: 'estalo curto · texto na tela', duration: 0.15, tags: ['texto', 'curto'] },
  { id: 'click', kind: 'sfx', label: 'Click', hint: 'clique seco · lista, contagem', duration: 0.06, tags: ['texto'] },
  { id: 'brilho', kind: 'sfx', label: 'Brilho', hint: 'cintilar agudo e leve · título elegante', duration: 2.5, tags: ['texto', 'elegante'] },
  { id: 'sino', kind: 'sfx', label: 'Sino', hint: 'sino com cauda longa · abertura, encerramento', duration: 5, tags: ['sagrado', 'encerramento'] },
  // ambientes
  { id: 'vento', kind: 'ambience', label: 'Vento', hint: 'vento suave', duration: 60, tags: ['natureza'] },
  { id: 'chuva', kind: 'ambience', label: 'Chuva', hint: 'chuva leve', duration: 60, tags: ['natureza'] },
  { id: 'sala', kind: 'ambience', label: 'Ambiente de sala', hint: 'tom de sala para tapar silêncio', duration: 60, tags: ['silêncio'] },
];

export const soundById = (id: string) => SOUND_LIBRARY.find((s) => s.id === id);

// --- WAV ------------------------------------------------------------------------------------

/** PCM 16 bits intercalado num arquivo WAV. */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const n = channels[0]?.length ?? 0;
  const ch = channels.length;
  const buf = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return buf;
}

// --- síntese --------------------------------------------------------------------------------

/** Gerador pseudoaleatório com semente (o mesmo som sempre). */
export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

interface Mood {
  root: number; // nota MIDI da tônica
  /** Acordes em graus (semitons a partir da tônica) — cada acorde dura `chord` s. */
  chords: number[][];
  chord: number;
  bpm: number;
  pad: number;
  piano: number;
  arp: number;
  bass: number;
  drums: 'none' | 'soft' | 'lofi' | 'four' | 'epic';
  drone?: boolean;
  bright: number; // corte do filtro dos pads (Hz)
}

const MOODS: Record<string, Mood> = {
  contemplativa: { root: 50, chords: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]], chord: 8, bpm: 60, pad: 0.22, piano: 0.16, arp: 0, bass: 0.12, drums: 'none', bright: 1400 },
  reflexao: { root: 45, chords: [[0, 3, 7, 10], [8, 12, 15, 19], [3, 7, 10, 14], [10, 14, 17, 21]], chord: 8, bpm: 56, pad: 0.24, piano: 0.14, arp: 0, bass: 0.14, drums: 'none', bright: 1100 },
  esperanca: { root: 52, chords: [[5, 9, 12, 16], [0, 4, 7, 14], [7, 11, 14, 19], [9, 12, 16, 19]], chord: 6, bpm: 72, pad: 0.2, piano: 0.1, arp: 0.08, bass: 0.13, drums: 'none', bright: 2200 },
  tensao: { root: 40, chords: [[0, 7, 13], [0, 6, 12], [0, 7, 13], [1, 8, 13]], chord: 10, bpm: 70, pad: 0.2, piano: 0, arp: 0, bass: 0.2, drums: 'soft', drone: true, bright: 700 },
  epica: { root: 45, chords: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], chord: 4, bpm: 80, pad: 0.24, piano: 0, arp: 0.05, bass: 0.18, drums: 'epic', bright: 1800 },
  lofi: { root: 53, chords: [[0, 4, 7, 11], [9, 12, 16, 19], [2, 5, 9, 12], [7, 11, 14, 17]], chord: 3.2, bpm: 75, pad: 0.1, piano: 0.15, arp: 0, bass: 0.15, drums: 'lofi', bright: 1600 },
  energia: { root: 50, chords: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]], chord: 2, bpm: 120, pad: 0.1, piano: 0, arp: 0.1, bass: 0.18, drums: 'four', bright: 3000 },
};

/** Resposta ao impulso de uma sala (ruído com decaimento) para o reverb. */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number, r: () => number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * (1 - i / len) ** decay;
  }
  return b;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, r: () => number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
  return b;
}

/** Nota com envelope (ataque, sustentação, liberação) numa saída. */
function tone(ctx: BaseAudioContext, out: AudioNode, o: { f: number; t: number; dur: number; type: OscillatorType; gain: number; attack: number; release: number; detune?: number; pan?: number }) {
  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.value = o.f;
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.gain, o.t + o.attack);
  g.gain.setValueAtTime(o.gain, Math.max(o.t + o.attack, o.t + o.dur - o.release));
  g.gain.linearRampToValueAtTime(0, o.t + o.dur);
  osc.connect(g);
  if (o.pan !== undefined && 'createStereoPanner' in ctx) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    g.connect(p).connect(out);
  } else g.connect(out);
  osc.start(o.t);
  osc.stop(o.t + o.dur + 0.05);
}

/** Nota de piano simples: parciais com decaimento exponencial. */
function pianoNote(ctx: BaseAudioContext, out: AudioNode, f: number, t: number, vel: number, len = 3.5) {
  [1, 2, 3, 4.01].forEach((h, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f * h;
    const g = ctx.createGain();
    const a = vel / (1 + i * 1.8);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len / (1 + i * 0.6));
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + len);
  });
}

function kick(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, deep = false) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(deep ? 90 : 140, t);
  osc.frequency.exponentialRampToValueAtTime(deep ? 32 : 45, t + (deep ? 0.6 : 0.25));
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (deep ? 1.2 : 0.4));
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 1.3);
}

function noiseHit(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, len: number, freq: number, type: BiquadFilterType, r: () => number) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, len, r);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

function music(ctx: BaseAudioContext, dest: AudioNode, mood: Mood, dur: number, r: () => number) {
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 3.5, 2.5, r);
  const wet = ctx.createGain();
  wet.gain.value = 0.45;
  verb.connect(wet).connect(dest);
  const dry = ctx.createGain();
  dry.gain.value = 0.8;
  dry.connect(dest);
  const bus = ctx.createGain();
  bus.connect(dry);
  bus.connect(verb);
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = mood.bright;
  padFilter.Q.value = 0.4;
  padFilter.connect(bus);

  const beat = 60 / mood.bpm;
  const nChords = Math.ceil(dur / mood.chord);
  for (let k = 0; k < nChords; k++) {
    const t = k * mood.chord;
    const ch = mood.chords[k % mood.chords.length];
    const len = Math.min(mood.chord + 1.5, dur - t + 0.5);
    // pad: cada nota em duas vozes desafinadas, abertas no estéreo
    for (const [i, deg] of ch.entries()) {
      const f = midi(mood.root + 12 + deg);
      for (const d of [-7, 7]) tone(ctx, padFilter, { f, t, dur: len, type: 'sawtooth', gain: mood.pad / ch.length / 2.2, attack: Math.min(2.5, mood.chord / 3), release: 1.8, detune: d, pan: (i / Math.max(1, ch.length - 1) - 0.5) * 0.8 + d / 40 });
    }
    if (mood.bass) tone(ctx, bus, { f: midi(mood.root - 12 + ch[0]), t, dur: len, type: 'sine', gain: mood.bass, attack: 0.6, release: 1.2 });
    // piano: notas do acorde, poucas e espaçadas
    if (mood.piano) {
      const notes = mood.drums === 'lofi' ? ch.map((_, i) => i) : [0, 1, 2].map(() => Math.floor(r() * ch.length));
      notes.forEach((ni, i) => {
        const at = t + (mood.drums === 'lofi' ? 0.02 * i : (i * mood.chord) / 3 + r() * beat * 0.5);
        if (at < dur - 0.5) pianoNote(ctx, bus, midi(mood.root + 24 + ch[ni]), at, mood.piano * (0.7 + r() * 0.3));
      });
    }
    // arpejo em colcheias
    if (mood.arp) {
      for (let s = 0; s * beat * 0.5 < mood.chord && t + s * beat * 0.5 < dur - 0.2; s++) {
        const deg = ch[s % ch.length] + (s % 8 >= 4 ? 12 : 0);
        tone(ctx, bus, { f: midi(mood.root + 24 + deg), t: t + s * beat * 0.5, dur: beat * 0.45, type: 'triangle', gain: mood.arp, attack: 0.01, release: beat * 0.3, pan: s % 2 ? 0.3 : -0.3 });
      }
    }
  }
  if (mood.drone) tone(ctx, padFilter, { f: midi(mood.root - 12), t: 0, dur, type: 'sawtooth', gain: 0.08, attack: 3, release: 3 });
  // bateria
  const bars = Math.ceil(dur / (beat * 4));
  for (let b = 0; b < bars; b++) {
    for (let q = 0; q < 4; q++) {
      const t = (b * 4 + q) * beat;
      if (t > dur - 0.3) break;
      switch (mood.drums) {
        case 'soft':
          if (q === 0 && b % 2 === 0) kick(ctx, bus, t, 0.35, true);
          break;
        case 'epic':
          if (q === 0 || (q === 2 && b % 2)) kick(ctx, bus, t, 0.55, true);
          if (q === 3 && b % 4 === 3) noiseHit(ctx, bus, t, 0.12, 0.6, 1800, 'bandpass', r);
          break;
        case 'lofi':
          if (q === 0) kick(ctx, bus, t, 0.5);
          if (q === 1) kick(ctx, bus, t + beat / 2, 0.35); // o "e" do 2: o balanço do lo-fi
          if (q === 2) noiseHit(ctx, bus, t, 0.18, 0.18, 1800, 'bandpass', r);
          noiseHit(ctx, bus, t + beat / 2, 0.04, 0.05, 7000, 'highpass', r);
          noiseHit(ctx, bus, t, 0.05, 0.05, 7000, 'highpass', r);
          break;
        case 'four':
          kick(ctx, bus, t, 0.7);
          if (q % 2) noiseHit(ctx, bus, t, 0.2, 0.15, 2000, 'bandpass', r);
          noiseHit(ctx, bus, t + beat / 2, 0.08, 0.04, 8000, 'highpass', r);
          break;
      }
    }
  }
}

function sfx(ctx: BaseAudioContext, dest: AudioNode, id: string, dur: number, r: () => number) {
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 2.5, 3, r);
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  verb.connect(wet).connect(dest);
  const out = ctx.createGain();
  out.connect(dest);
  out.connect(verb);
  const sweep = (from: number, to: number, len: number, gain: number, q = 1.2, shape: 'up' | 'down' | 'arc' = 'arc', start = 0) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, len, r);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(from, start);
    f.frequency.exponentialRampToValueAtTime(to, start + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    if (shape === 'up') {
      g.gain.exponentialRampToValueAtTime(gain, start + len * 0.98);
      g.gain.linearRampToValueAtTime(0, start + len);
    } else if (shape === 'down') {
      g.gain.linearRampToValueAtTime(gain, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + len);
    } else {
      g.gain.exponentialRampToValueAtTime(gain, start + len * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, start + len);
    }
    src.connect(f).connect(g).connect(out);
    src.start(start);
  };
  switch (id) {
    case 'whoosh':
      sweep(300, 4500, dur, 0.9, 1.5);
      break;
    case 'whoosh-suave':
      sweep(180, 1600, dur, 0.6, 0.8);
      break;
    case 'riser':
      sweep(200, 6000, dur, 0.7, 2, 'up');
      tone(ctx, out, { f: 110, t: 0, dur, type: 'sawtooth', gain: 0.08, attack: dur * 0.9, release: 0.05 });
      break;
    case 'swell':
      sweep(800, 9000, dur, 0.5, 0.5, 'up');
      break;
    case 'impacto':
      kick(ctx, out, 0, 1, true);
      noiseHit(ctx, out, 0, 0.5, 0.4, 900, 'lowpass', r);
      break;
    case 'sub-drop': {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(90, 0);
      osc.frequency.exponentialRampToValueAtTime(28, dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, 0);
      g.gain.exponentialRampToValueAtTime(0.0001, dur);
      osc.connect(g).connect(out);
      osc.start(0);
      osc.stop(dur);
      break;
    }
    case 'pop':
      tone(ctx, out, { f: 620, t: 0, dur, type: 'sine', gain: 0.6, attack: 0.003, release: dur * 0.8 });
      tone(ctx, out, { f: 1240, t: 0, dur: dur * 0.5, type: 'sine', gain: 0.2, attack: 0.002, release: dur * 0.4 });
      break;
    case 'click':
      noiseHit(ctx, out, 0, 0.6, dur, 3000, 'bandpass', r);
      break;
    case 'brilho':
      [0, 0.09, 0.18, 0.3, 0.45].forEach((t, i) => pianoNote(ctx, out, midi(86 + [0, 4, 7, 11, 14][i]), t, 0.12, 2));
      break;
    case 'sino':
      [1, 2.76, 5.4, 8.93].forEach((h, i) => {
        const osc = ctx.createOscillator();
        osc.frequency.value = 330 * h;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.35 / (1 + i), 0);
        g.gain.exponentialRampToValueAtTime(0.0001, dur / (1 + i * 0.4));
        osc.connect(g).connect(out);
        osc.start(0);
        osc.stop(dur);
      });
      break;
  }
}

function ambience(ctx: BaseAudioContext, dest: AudioNode, id: string, dur: number, r: () => number) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur, r);
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  if (id === 'vento') {
    f.type = 'bandpass';
    f.Q.value = 0.7;
    for (let t = 0; t < dur; t += 4) f.frequency.linearRampToValueAtTime(300 + r() * 500, t);
    g.gain.value = 0.35;
  } else if (id === 'chuva') {
    f.type = 'highpass';
    f.frequency.value = 2500;
    g.gain.value = 0.18;
  } else {
    f.type = 'lowpass';
    f.frequency.value = 400;
    g.gain.value = 0.08;
  }
  src.connect(f).connect(g).connect(dest);
  src.start(0);
}

export interface RenderOpts {
  duration?: number;
  seed?: number;
  sampleRate?: number;
}

/** Renderiza um som da biblioteca (precisa de OfflineAudioContext: no editor, não nos testes). */
export async function renderSound(id: string, o: RenderOpts = {}): Promise<{ channels: Float32Array[]; sampleRate: number; duration: number }> {
  const def = soundById(id);
  if (!def) throw new Error(`som desconhecido: ${id}`);
  const duration = Math.max(0.05, o.duration ?? def.duration);
  const sampleRate = o.sampleRate ?? (def.kind === 'sfx' ? 44100 : 24000);
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const r = rng(o.seed ?? 7 + id.length * 131);
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  master.connect(comp).connect(ctx.destination);
  // fades nas pontas: a trilha entra e sai sem estalo
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(1, Math.min(def.kind === 'sfx' ? 0.005 : 1.5, duration / 4));
  master.gain.setValueAtTime(1, Math.max(0, duration - (def.kind === 'sfx' ? 0.02 : 2.5)));
  master.gain.linearRampToValueAtTime(0, duration);
  if (def.kind === 'music') music(ctx, master, MOODS[id], duration, r);
  else if (def.kind === 'sfx') sfx(ctx, master, id, duration, r);
  else ambience(ctx, master, id, duration, r);
  const out = await ctx.startRendering();
  // normaliza o pico em -1 dBFS
  const channels = [out.getChannelData(0), out.getChannelData(1)].map((c) => new Float32Array(c));
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  const k = peak > 0 ? 0.89 / peak : 1;
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= k;
  return { channels, sampleRate, duration };
}

/** Som da biblioteca como arquivo WAV pronto para importar. */
export async function soundFile(id: string, o: RenderOpts = {}): Promise<File> {
  const r = await renderSound(id, o);
  const def = soundById(id)!;
  const name = `${def.kind === 'music' ? 'trilha' : def.kind === 'sfx' ? 'efeito' : 'ambiente'}-${id}-${Math.round(r.duration)}s-${Date.now().toString(36)}.wav`;
  return new File([encodeWav(r.channels, r.sampleRate)], name, { type: 'audio/wav', lastModified: Date.now() });
}
