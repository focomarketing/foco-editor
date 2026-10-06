// Validação de formato e extração de metadados (sem decodificar o arquivo inteiro).

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { Asset, MediaMetadata } from '../../core/types';
import { newId } from '../../core/time';

export const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
export const AUDIO_EXT = /\.(mp3|wav|aac|m4a|flac|ogg|oga|opus)$/i;
export const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
export const SVG_EXT = /\.svg$/i;
export const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
/** Formatos conhecidos que o decodificador do navegador ainda não lê. */
const KNOWN_UNSUPPORTED: [RegExp, string][] = [
  [/\.avi$/i, 'AVI ainda não é suportado pelo decodificador do editor. Converta para MP4 ou MOV.'],
  [/\.(mxf|r3d|braw|ari)$/i, 'Formato de câmera profissional ainda não suportado. Converta para MP4/MOV (ex.: ProRes → H.264).'],
];

/** Valida antes de abrir o arquivo. Lança erro com motivo real. */
export function validateFile(file: File) {
  if (file.size === 0) throw new Error('O arquivo está vazio.');
  for (const [re, msg] of KNOWN_UNSUPPORTED) if (re.test(file.name)) throw new Error(msg);
  const known = VIDEO_EXT.test(file.name) || AUDIO_EXT.test(file.name) || IMAGE_EXT.test(file.name) || SVG_EXT.test(file.name) || FONT_EXT.test(file.name);
  const knownMime = /^(video|audio|image|font)\//.test(file.type);
  if (!known && !knownMime) throw new Error(`Tipo de arquivo não suportado (${file.name.split('.').pop() || 'sem extensão'}).`);
}

/** Lê SVG via <img> (createImageBitmap não aceita SVG direto) e rasteriza em boa resolução. */
export async function rasterizeSvg(file: Blob, maxSide = 2048): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const width = img.naturalWidth || 1024;
    const height = img.naturalHeight || 1024;
    const k = maxSide / Math.max(width, height);
    const bitmap = await createImageBitmap(img, { resizeWidth: Math.round(width * k), resizeHeight: Math.round(height * k) });
    return { bitmap, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const fontFamilyFor = (fileName: string) => fileName.replace(FONT_EXT, '').replace(/[-_]+/g, ' ').trim();

/** Registra a fonte no navegador (fica disponível para títulos e legendas). */
export async function registerFont(file: Blob, family: string) {
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
}

/** Lê metadados reais do arquivo. Lança erro legível quando não suportado. */
export async function probe(file: File, hash?: string): Promise<Asset> {
  validateFile(file);
  const base = { id: newId('a'), name: file.name, mimeType: file.type, size: file.size, lastModified: file.lastModified, hash };
  const still = { duration: 0, fps: 0, hasAudio: false, videoCodec: null, audioCodec: null, audioDecodable: false } as const;

  if (file.type === 'image/svg+xml' || SVG_EXT.test(file.name)) {
    const { bitmap, width, height } = await rasterizeSvg(file).catch(() => {
      throw new Error('SVG inválido ou corrompido.');
    });
    bitmap.close();
    return { ...base, ...still, kind: 'svg', width, height, hasVideo: true, videoDecodable: true };
  }
  if (FONT_EXT.test(file.name) || file.type.startsWith('font/')) {
    const family = fontFamilyFor(file.name);
    await registerFont(file, family).catch(() => {
      throw new Error('Arquivo de fonte inválido ou corrompido.');
    });
    return { ...base, ...still, kind: 'font', width: 0, height: 0, hasVideo: false, videoDecodable: false, fontFamily: family };
  }
  if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) {
    const bmp = await createImageBitmap(file).catch(() => {
      throw new Error('Imagem em formato não suportado ou corrompida.');
    });
    const asset: Asset = { ...base, ...still, kind: 'image', width: bmp.width, height: bmp.height, hasVideo: true, videoDecodable: true };
    bmp.close();
    return asset;
  }

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new Error('O conteúdo do arquivo não é um container de mídia reconhecido (MP4, MOV, WebM, MKV, MP3, WAV, FLAC, OGG…).');
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video && !audio) throw new Error('O arquivo não tem trilhas de vídeo nem de áudio.');

    const duration = (await input.getDurationFromMetadata().catch(() => null)) ?? (await input.computeDuration());
    if (!(duration > 0)) throw new Error('Não foi possível determinar a duração do arquivo.');

    const meta: MediaMetadata = { container: await input.getMimeType().catch(() => file.type) };
    let fps = 0;
    let bitrate: number | undefined;
    if (video) {
      const stats = await video.computePacketStats(120).catch(() => null);
      fps = stats?.averagePacketRate ? Math.round(stats.averagePacketRate * 1000) / 1000 : 30;
      meta.videoCodecString = await video.getCodecParameterString().catch(() => null);
      meta.videoBitrate = stats?.averageBitrate ? Math.round(stats.averageBitrate) : null;
      meta.rotation = await video.getRotation().catch(() => 0);
      meta.hdr = await video.hasHighDynamicRange().catch(() => false);
      const cs = await video.getColorSpace().catch(() => null);
      meta.colorSpace = cs ? { primaries: cs.primaries ?? null, transfer: cs.transfer ?? null, matrix: cs.matrix ?? null, fullRange: cs.fullRange ?? null } : null;
      meta.timebase = await video.getTimeResolution().catch(() => undefined);
      bitrate = meta.videoBitrate ?? undefined;
    }
    let audioChannels: number | undefined;
    let sampleRate: number | undefined;
    if (audio) {
      audioChannels = await audio.getNumberOfChannels().catch(() => undefined);
      sampleRate = await audio.getSampleRate().catch(() => undefined);
      meta.audioCodecString = await audio.getCodecParameterString().catch(() => null);
      const aStats = await audio.computePacketStats(200).catch(() => null);
      meta.audioBitrate = aStats?.averageBitrate ? Math.round(aStats.averageBitrate) : null;
      if (!video) meta.timebase = await audio.getTimeResolution().catch(() => undefined);
    }
    if (!bitrate) bitrate = Math.round((file.size * 8) / duration);

    return {
      ...base,
      kind: video ? 'video' : 'audio',
      duration,
      width: video ? await video.getDisplayWidth() : 0,
      height: video ? await video.getDisplayHeight() : 0,
      fps,
      hasVideo: !!video,
      hasAudio: !!audio,
      videoCodec: video ? await video.getCodec() : null,
      audioCodec: audio ? await audio.getCodec() : null,
      videoDecodable: video ? await video.canDecode() : false,
      audioDecodable: audio ? await audio.canDecode() : false,
      bitrate,
      audioChannels,
      sampleRate,
      metadata: meta,
    };
  } finally {
    input.dispose();
  }
}

/** Texto curto tipo "1920×1080 · 29.97 fps · H.264 · 48 kHz · estéreo". */
export function describeAsset(a: Asset): string {
  const codec: Record<string, string> = { avc: 'H.264', hevc: 'H.265', vp8: 'VP8', vp9: 'VP9', av1: 'AV1', aac: 'AAC', opus: 'Opus', mp3: 'MP3', flac: 'FLAC', vorbis: 'Vorbis', pcm: 'PCM' };
  const parts = [
    a.width ? `${a.width}×${a.height}` : null,
    a.fps ? `${Math.round(a.fps * 100) / 100} fps` : null,
    a.videoCodec ? (codec[a.videoCodec] ?? a.videoCodec) : null,
    a.bitrate ? `${(a.bitrate / 1e6).toFixed(a.bitrate > 1e7 ? 0 : 1)} Mbps` : null,
    a.audioCodec ? (codec[a.audioCodec] ?? a.audioCodec) : null,
    a.sampleRate ? `${a.sampleRate / 1000} kHz` : null,
    a.audioChannels ? (a.audioChannels === 1 ? 'mono' : a.audioChannels === 2 ? 'estéreo' : `${a.audioChannels} canais`) : null,
  ];
  return parts.filter(Boolean).join(' · ');
}
