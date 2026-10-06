// Gerador de mídia longa para testes de carga (só em dev).
// Codifica de verdade um trecho curto (um GOP) e repete os pacotes já codificados com
// tempos deslocados até a duração pedida, gravando em streaming no OPFS (disco), sem
// segurar o arquivo na RAM. O resultado é um MP4 válido de horas, decodificado de verdade.

import {
  ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSource, EncodedAudioPacketSource, EncodedPacket,
  EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output, StreamTarget,
} from 'mediabunny';
import type { StreamTargetChunk } from 'mediabunny';

export interface LongVideoOptions {
  name: string;
  seconds: number;
  width: number;
  height: number;
  fps: 30 | 60;
  /** Bits por segundo do vídeo de origem (afeta o tamanho do arquivo). */
  bitrate: number;
  hue?: number;
}

/** Período que fecha com quadros inteiros (30/60 fps) e pacotes AAC inteiros (1024 amostras @ 48 kHz). */
const PERIOD = 1.6;

async function encodeSegment(o: LongVideoOptions) {
  const canvas = new OffscreenCanvas(o.width, o.height);
  const ctx = canvas.getContext('2d')!;
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: o.bitrate, keyFrameInterval: PERIOD });
  const audio = new AudioBufferSource({ codec: 'aac', bitrate: 128_000 });
  out.addVideoTrack(video, { frameRate: o.fps });
  out.addAudioTrack(audio);
  await out.start();
  const frames = Math.round(PERIOD * o.fps);
  for (let i = 0; i < frames; i++) {
    const k = i / frames;
    ctx.fillStyle = `hsl(${o.hue ?? 200}, 50%, ${18 + 10 * Math.sin(k * Math.PI * 2)}%)`;
    ctx.fillRect(0, 0, o.width, o.height);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(o.height / 8)}px sans-serif`;
    ctx.fillText(`${o.name} ${o.width}x${o.height}`, o.width * 0.05 + k * o.width * 0.3, o.height / 2);
    await video.add(i / o.fps, 1 / o.fps);
  }
  // Fala sintética: tom modulado com uma pausa (para waveform e detecção de silêncio realistas).
  const sr = 48000;
  const buf = new AudioBuffer({ length: Math.round(PERIOD * sr), numberOfChannels: 2, sampleRate: sr });
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      d[i] = t > 1.1 ? 0.002 * Math.sin(i) : 0.3 * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));
    }
  }
  await audio.add(buf);
  await out.finalize();
  return (out.target as BufferTarget).buffer!;
}

export async function makeLongVideo(o: LongVideoOptions): Promise<File> {
  const segment = await encodeSegment(o);
  const input = new Input({ source: new BlobSource(new Blob([segment])), formats: ALL_FORMATS });
  const vt = (await input.getPrimaryVideoTrack())!;
  const at = (await input.getPrimaryAudioTrack())!;
  const vConfig = await vt.getDecoderConfig();
  const aConfig = await at.getDecoderConfig();
  const vPackets: EncodedPacket[] = [];
  const aPackets: EncodedPacket[] = [];
  for await (const p of new EncodedPacketSink(vt).packets()) vPackets.push(p);
  for await (const p of new EncodedPacketSink(at).packets()) aPackets.push(p);

  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('loadtest', { create: true });
  const fileName = `${o.name}.mp4`;
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  const out = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>, { chunked: true }),
  });
  const vs = new EncodedVideoPacketSource('avc');
  const as = new EncodedAudioPacketSource('aac');
  out.addVideoTrack(vs, { frameRate: o.fps });
  out.addAudioTrack(as);
  await out.start();
  const reps = Math.ceil(o.seconds / PERIOD);
  for (let r = 0; r < reps; r++) {
    const off = r * PERIOD;
    for (const [i, p] of vPackets.entries()) {
      await vs.add(new EncodedPacket(p.data, p.type, p.timestamp + off, p.duration), r === 0 && i === 0 ? { decoderConfig: vConfig! } : undefined);
    }
    for (const [i, p] of aPackets.entries()) {
      await as.add(new EncodedPacket(p.data, p.type, p.timestamp + off, p.duration), r === 0 && i === 0 ? { decoderConfig: aConfig! } : undefined);
    }
  }
  await out.finalize();
  input.dispose();
  const file = await handle.getFile();
  return new File([file], fileName, { type: 'video/mp4', lastModified: file.lastModified });
}

/** Remove os arquivos de teste gerados. */
export async function clearLoadFiles() {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry('loadtest', { recursive: true }).catch(() => {});
}
