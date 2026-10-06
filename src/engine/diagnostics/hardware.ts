// Detecção de hardware (o que o navegador permite saber) para sugerir o modo de performance.
// O navegador não expõe uso de CPU/GPU nem VRAM exata: isso é medido de fora nos testes de carga.

export interface HardwareInfo {
  cores: number;
  /** GB aproximados (o navegador arredonda e limita a 8+). */
  memoryGB: number | null;
  gpu: string | null;
  webgpu: boolean;
  hwEncodeH264: boolean;
  hwEncodeHEVC: boolean;
  hwDecode4K: boolean;
  /** 0..100 — estimativa grosseira para o modo automático. */
  score: number;
}

let cached: Promise<HardwareInfo> | null = null;

async function encoderSupported(codec: string, w: number, h: number) {
  try {
    const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 8_000_000, hardwareAcceleration: 'prefer-hardware' });
    return !!r.supported;
  } catch {
    return false;
  }
}

async function decoderSupported(codec: string, w: number, h: number) {
  try {
    const r = await VideoDecoder.isConfigSupported({ codec, codedWidth: w, codedHeight: h, hardwareAcceleration: 'prefer-hardware' });
    return !!r.supported;
  } catch {
    return false;
  }
}

function gpuName(): string | null {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : (gl.getParameter(gl.RENDERER) as string);
    return name.replace(/^ANGLE \((.*)\)$/, '$1');
  } catch {
    return null;
  }
}

export function detectHardware(): Promise<HardwareInfo> {
  cached ??= (async () => {
    const cores = navigator.hardwareConcurrency || 4;
    const memoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
    const gpu = gpuName();
    const webgpu = !!(navigator as Navigator & { gpu?: unknown }).gpu;
    const [hwEncodeH264, hwEncodeHEVC, hwDecode4K] = await Promise.all([
      encoderSupported('avc1.640028', 1920, 1080),
      encoderSupported('hvc1.1.6.L120.B0', 1920, 1080),
      decoderSupported('avc1.640033', 3840, 2160),
    ]);
    const dedicatedGpu = /nvidia|geforce|radeon|rtx|gtx|arc/i.test(gpu ?? '');
    let score = Math.min(40, cores * 4) + (memoryGB ? Math.min(20, memoryGB * 2.5) : 10) + (dedicatedGpu ? 25 : 8) + (hwDecode4K ? 15 : 0);
    score = Math.round(Math.min(100, score));
    return { cores, memoryGB, gpu, webgpu, hwEncodeH264, hwEncodeHEVC, hwDecode4K, score };
  })();
  return cached;
}
