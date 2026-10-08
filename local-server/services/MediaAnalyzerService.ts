import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface MediaInfo {
  technical: {
    resolution: string;
    fps: number;
    duration_sec: number;
  };
  audio_health: {
    average_db: number | null;
    has_clipping: boolean;
  };
}

export class MediaAnalyzerService {
  /**
   * Extrai metadados técnicos básicos e analisa o áudio de um arquivo de mídia usando ffprobe/ffmpeg.
   */
  static async analyze(filepath: string): Promise<MediaInfo> {
    try {
      // 1. Extração de metadados técnicos via ffprobe
      const technicalData = await this.getTechnicalMetadata(filepath);
      
      // 2. Análise de áudio (Níveis e Clipping) via ffmpeg (volumedetect)
      // Nota: Esta etapa pode demorar dependendo do tamanho do vídeo, pois processa o áudio.
      const audioHealth = await this.getAudioHealth(filepath);

      return {
        technical: technicalData,
        audio_health: audioHealth,
      };
    } catch (error) {
      console.error('Erro ao analisar mídia:', error);
      throw new Error(`Falha na análise de mídia: ${error}`);
    }
  }

  private static async getTechnicalMetadata(filepath: string) {
    // ffprobe command para extrair json
    const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${filepath}"`;
    const { stdout } = await execAsync(cmd);
    
    const data = JSON.parse(stdout);
    
    const videoStream = data.streams.find((s: any) => s.codec_type === 'video');
    const duration = data.format.duration ? parseFloat(data.format.duration) : 0;
    
    let fps = 0;
    if (videoStream && videoStream.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/');
        fps = num && den ? parseFloat(num) / parseFloat(den) : 0;
    }

    return {
      resolution: videoStream ? \`\${videoStream.width}x\${videoStream.height}\` : '0x0',
      fps: Math.round(fps * 100) / 100, // Arredondar 2 casas decimais
      duration_sec: duration,
    };
  }

  private static async getAudioHealth(filepath: string) {
    // Usamos o ffmpeg com o filtro volumedetect.
    // O output do volumedetect vai para o stderr.
    const cmd = \`ffmpeg -i "\${filepath}" -af "volumedetect" -vn -sn -dn -f null /dev/null\`;
    
    let meanVolume = null;
    let maxVolume = null;
    
    try {
      const { stderr } = await execAsync(cmd);
      
      // Extraindo mean_volume
      const meanMatch = stderr.match(/mean_volume:\s*([-.\d]+)\s*dB/);
      if (meanMatch) {
        meanVolume = parseFloat(meanMatch[1]);
      }

      // Extraindo max_volume
      const maxMatch = stderr.match(/max_volume:\s*([-.\d]+)\s*dB/);
      if (maxMatch) {
        maxVolume = parseFloat(maxMatch[1]);
      }
    } catch (error: any) {
      // execAsync lança erro se o ffmpeg retornar exit code não-zero, 
      // mas no windows o dev/null não existe, então ajustamos o comando
      // para compatibilidade cross-platform (usar NUL no windows)
      
      const isWindows = process.platform === "win32";
      const nullDevice = isWindows ? "NUL" : "/dev/null";
      const cmdFix = \`ffmpeg -i "\${filepath}" -af "volumedetect" -vn -sn -dn -f null \${nullDevice}\`;
      
      try {
          const { stderr: stderrFix } = await execAsync(cmdFix);
          const meanMatch = stderrFix.match(/mean_volume:\s*([-.\d]+)\s*dB/);
          if (meanMatch) meanVolume = parseFloat(meanMatch[1]);
          
          const maxMatch = stderrFix.match(/max_volume:\s*([-.\d]+)\s*dB/);
          if (maxMatch) maxVolume = parseFloat(maxMatch[1]);
      } catch (innerError) {
          console.warn("Aviso: Não foi possível analisar a saúde do áudio.", innerError);
      }
    }

    // Clipping geralmente ocorre se o pico estiver muito próximo de 0.0 dB
    const hasClipping = maxVolume !== null && maxVolume >= 0.0;

    return {
      average_db: meanVolume,
      has_clipping: hasClipping,
    };
  }
}
