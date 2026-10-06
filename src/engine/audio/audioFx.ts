// Audio Engine: cadeia de processamento por clipe, montada com nós da Web Audio API.
// A mesma função monta a cadeia no preview (AudioContext) e no export (OfflineAudioContext),
// então o que se ouve é o que se exporta.

import type { AudioFx } from '../../core/types';
import { noiseProfile } from '../analysis/silence';

export const AUDIO_PRESETS: { id: string; label: string; fx: Omit<AudioFx, 'gainDb' | 'gateDb'> & { gate: boolean; targetDb: number } }[] = [
  { id: 'voice', label: 'Voz', fx: { preset: 'voice', highpass: 80, low: -1, presence: 3, air: 2, compressor: true, gate: true, targetDb: -18 } },
  { id: 'podcast', label: 'Podcast', fx: { preset: 'podcast', highpass: 70, low: 2, presence: 2.5, air: 1.5, compressor: true, gate: true, targetDb: -17 } },
  { id: 'youtube', label: 'YouTube', fx: { preset: 'youtube', highpass: 80, low: 0, presence: 3.5, air: 3, compressor: true, gate: true, targetDb: -16 } },
  { id: 'cinematic', label: 'Cinematic', fx: { preset: 'cinematic', highpass: 40, low: 2, presence: 1, air: 1, compressor: false, gate: false, targetDb: -21 } },
  { id: 'social', label: 'Social', fx: { preset: 'social', highpass: 90, low: -1, presence: 4, air: 3.5, compressor: true, gate: true, targetDb: -15 } },
];

/**
 * Monta os parâmetros a partir do preset e do nível real da mídia: o ganho leva a fala
 * (percentil 90 do RMS) até o alvo do preset; o gate fica um pouco acima do ruído de fundo.
 */
export function audioFxFromPreset(presetId: string, levels: Float32Array | null): AudioFx {
  const pr = AUDIO_PRESETS.find((p) => p.id === presetId) ?? AUDIO_PRESETS[0];
  let gainDb = 0;
  let gateDb: number | null = null;
  if (levels) {
    const prof = noiseProfile(levels);
    gainDb = Math.round(Math.min(18, Math.max(-12, pr.fx.targetDb - prof.speechDb)) * 10) / 10;
    // Só vale a pena com ruído audível e fala bem acima dele.
    if (pr.fx.gate && prof.floorDb > -75 && prof.speechDb - prof.floorDb > 12) gateDb = Math.round(prof.floorDb + 6);
  }
  const { gate: _gate, targetDb: _target, ...rest } = pr.fx;
  void _gate;
  void _target;
  return { ...rest, gainDb, gateDb };
}

const GATE_WORKLET = `
class FocoGate extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'threshold', defaultValue: -60 }]; }
  constructor() { super(); this.env = 0; this.gain = 1; }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!input.length) return true;
    const thr = Math.pow(10, params.threshold[0] / 20);
    const att = Math.exp(-1 / (0.002 * sampleRate)), rel = Math.exp(-1 / (0.12 * sampleRate));
    const gAtt = Math.exp(-1 / (0.005 * sampleRate)), gRel = Math.exp(-1 / (0.08 * sampleRate));
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++) { const v = Math.abs(input[c][i]); if (v > peak) peak = v; }
      this.env = peak > this.env ? att * this.env + (1 - att) * peak : rel * this.env + (1 - rel) * peak;
      // expansor 1:4 abaixo do limiar (atenua ruído sem cortar seco)
      const target = this.env >= thr ? 1 : Math.pow(this.env / thr, 3);
      this.gain = target > this.gain ? gAtt * this.gain + (1 - gAtt) * target : gRel * this.gain + (1 - gRel) * target;
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] ?? input[0])[i] * this.gain;
    }
    return true;
  }
}
registerProcessor('foco-gate', FocoGate);
`;

let workletUrl: string | null = null;
const loaded = new WeakSet<BaseAudioContext>();

/** Registra o processador do gate no contexto (uma vez por contexto). */
export async function prepareContext(ctx: BaseAudioContext) {
  if (loaded.has(ctx)) return;
  workletUrl ??= URL.createObjectURL(new Blob([GATE_WORKLET], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(workletUrl);
  loaded.add(ctx);
}

export interface Chain {
  input: AudioNode;
  output: AudioNode;
  nodes: AudioNode[];
}

const db = (v: number) => Math.pow(10, v / 20);

/** Cadeia: graves → EQ → gate → compressor → ganho → limitador. `prepareContext` antes se houver gate. */
export function buildChain(ctx: BaseAudioContext, fx: AudioFx | undefined, volume: number): Chain {
  const nodes: AudioNode[] = [];
  const input = ctx.createGain();
  input.gain.value = volume;
  nodes.push(input);
  let last: AudioNode = input;
  const add = (n: AudioNode) => {
    last.connect(n);
    nodes.push(n);
    last = n;
  };
  if (fx) {
    if (fx.highpass > 0) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = fx.highpass;
      hp.Q.value = 0.7;
      add(hp);
    }
    const bands: [BiquadFilterType, number, number][] = [
      ['lowshelf', 120, fx.low],
      ['peaking', 3000, fx.presence],
      ['highshelf', 10000, fx.air],
    ];
    for (const [type, f, g] of bands) {
      if (!g) continue;
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.gain.value = g;
      if (type === 'peaking') b.Q.value = 0.9;
      add(b);
    }
    if (fx.gateDb !== null && loaded.has(ctx)) {
      const gate = new AudioWorkletNode(ctx, 'foco-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      gate.parameters.get('threshold')!.value = fx.gateDb;
      add(gate);
    }
    if (fx.compressor) {
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = -24 + Math.max(0, -fx.gainDb) * 0.5;
      c.ratio.value = 3.5;
      c.knee.value = 6;
      c.attack.value = 0.005;
      c.release.value = 0.15;
      add(c);
    }
    if (fx.gainDb) {
      const g = ctx.createGain();
      g.gain.value = db(fx.gainDb + (fx.compressor ? 3 : 0));
      add(g);
    }
    // limitador de segurança: evita clipar depois do ganho
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -1.5;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.05;
    add(lim);
  }
  return { input, output: last, nodes };
}
