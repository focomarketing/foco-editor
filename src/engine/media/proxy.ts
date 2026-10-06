// Proxy Media: cópia leve (720p/1080p, keyframes a cada 0,5 s) para preview, scrubbing e
// edição. O original continua sendo usado no export final. A geração é uma transcodificação
// real (WebCodecs, aceleração por hardware quando houver) gravada em streaming no cache.

import { Conversion, Mp4OutputFormat, Output, StreamTarget } from 'mediabunny';
import type { Input, StreamTargetChunk } from 'mediabunny';
import type { Asset } from '../../core/types';

export type ProxyResolution = '720p' | '1080p';
export type ProxyStatus = 'none' | 'queued' | 'processing' | 'ready' | 'failed' | 'cancelled';
type Mode = 'quality' | 'balanced' | 'performance';

export interface ProxyState {
  status: ProxyStatus;
  resolution?: ProxyResolution;
  progress?: number;
  jobId?: string;
  url?: string;
  size?: number;
  error?: string;
}

export const proxyKey = (hash: string, res: ProxyResolution) => `${hash}|${res}`;

/** Motivo para recomendar proxy (null = o arquivo é leve o bastante neste modo). */
export function recommendProxy(a: Asset, mode: Mode): string | null {
  if (a.kind !== 'video' || !a.videoDecodable) return null;
  const pixels = a.width * a.height;
  const mbps = (a.bitrate ?? 0) / 1e6;
  const heavyCodec = a.videoCodec === 'hevc' || a.videoCodec === 'av1';
  const desc = `${a.width}×${a.height}, ${Math.round(a.fps)} fps${mbps ? `, ${Math.round(mbps)} Mbps` : ''}${heavyCodec ? `, ${a.videoCodec?.toUpperCase()}` : ''}`;
  const heavy =
    mode === 'performance'
      ? a.height >= 1080 && (a.height > 1080 || a.fps > 31 || mbps > 25 || heavyCodec)
      : mode === 'balanced'
        ? pixels >= 2560 * 1440 || (a.fps > 50 && a.height >= 1080) || mbps > 60 || (heavyCodec && a.height > 1080)
        : pixels >= 3840 * 2160 && (a.fps > 50 || mbps > 100);
  return heavy ? desc : null;
}

/** Resolução automática conforme a mídia e o modo de performance. */
export function autoResolution(a: Asset, mode: Mode): ProxyResolution {
  if (mode === 'quality' && a.height >= 2160) return '1080p';
  return '720p';
}

export async function buildProxy(
  input: Input,
  asset: Asset,
  res: ProxyResolution,
  writable: FileSystemWritableFileStream,
  signal: AbortSignal,
  progress: (p: number) => void,
): Promise<void> {
  if (signal.aborted) throw new DOMException('cancelado', 'AbortError');
  const targetH = res === '720p' ? 720 : 1080;
  const h = Math.min(targetH, asset.height);
  const w = Math.round((asset.width * h) / asset.height / 2) * 2;
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>, { chunked: true }),
  });
  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: {
      width: w,
      height: h - (h % 2),
      fit: 'contain',
      codec: 'avc',
      bitrate: res === '720p' ? 3_500_000 : 8_000_000,
      // Keyframes frequentes: buscar/scrub decodifica no máximo 0,5 s.
      keyFrameInterval: 0.5,
      frameRate: Math.min(60, asset.fps || 30),
      hardwareAcceleration: 'prefer-hardware',
      forceTranscode: true,
    },
    audio: { codec: 'aac', bitrate: 128_000 },
  });
  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join('; ');
    throw new Error(`Não foi possível criar o proxy (${why || 'conversão inválida'}).`);
  }
  conversion.onProgress = (p) => progress(p);
  // Cancelado durante a preparação: não começa.
  if (signal.aborted) throw new DOMException('cancelado', 'AbortError');
  const onAbort = () => void conversion.cancel();
  signal.addEventListener('abort', onAbort);
  try {
    await conversion.execute();
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  if (signal.aborted) throw new DOMException('cancelado', 'AbortError');
}
