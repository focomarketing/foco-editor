export interface AudioSettings {
  volume: number;           // 0.0 to 1.0+
  normalization: boolean;   // Auto-leveling
  noiseReduction: number;   // 0.0 to 1.0 (intensity)
  compressor: boolean;      // Dynamic range compression
  eqPreset?: 'flat' | 'podcast' | 'vocal_boost' | 'cinematic';
}

/**
 * Audio Processing Engine
 * 
 * Em ambiente real, este motor utiliza Web Audio API (AudioContext) para processamento em tempo real
 * no browser durante o preview, e exporta comandos FFmpeg (-af) equivalentes para o Render Engine final.
 */
export class AudioProcessingEngine {
  
  static getPresetSettings(presetName: 'voice' | 'podcast' | 'youtube' | 'cinematic' | 'social'): AudioSettings {
    switch(presetName) {
      case 'podcast':
      case 'voice':
        return {
          volume: 1.0,
          normalization: true,
          noiseReduction: 0.8,
          compressor: true,
          eqPreset: 'vocal_boost'
        };
      case 'cinematic':
        return {
          volume: 1.0,
          normalization: false, // Maintain dynamic range
          noiseReduction: 0.4,
          compressor: false,
          eqPreset: 'cinematic'
        };
      default:
        return {
          volume: 1.0,
          normalization: true,
          noiseReduction: 0.5,
          compressor: true,
          eqPreset: 'flat'
        };
    }
  }

  /**
   * Applies the audio filters mathematically to an AudioContext node chain.
   * Mock implementation for architecture demonstrability.
   */
  static applyFilters(_audioNode: any, settings: AudioSettings) {
    console.log('[AudioProcessingEngine] Construindo cadeia de nós de áudio (Web Audio API)...');
    
    if (settings.noiseReduction > 0) {
      console.log(`- Adicionando filtro FIR/FFT Noise Reduction (Intensidade: ${Math.round(settings.noiseReduction * 100)}%)`);
    }

    if (settings.compressor) {
      console.log('- Adicionando nó DynamicsCompressorNode (Ratio: 4:1, Threshold: -24dB)');
    }

    if (settings.normalization) {
      console.log('- Adicionando GainNode de Normalização LUFS (-14 LUFS alvo)');
    }

    if (settings.eqPreset) {
      console.log(`- Adicionando BiquadFilterNode array para EQ (${settings.eqPreset.toUpperCase()})`);
    }
  }

  /**
   * Generates FFmpeg audio filter string (-af) for the Export Engine
   */
  static generateFFmpegFilters(settings: AudioSettings): string {
    const filters = [];
    
    if (settings.noiseReduction > 0) {
      filters.push('afftdn=nr=15:nf=-25'); // FFT noise reduction
    }
    
    if (settings.normalization) {
      filters.push('loudnorm=I=-14:LRA=11:TP=-1.5'); // EBU R128 Loudness Normalization
    } else if (settings.compressor) {
      filters.push('acompressor=threshold=-24dB:ratio=4:makeup=8dB');
    }

    return filters.join(',');
  }
}
