import { EditorialDecisionResult } from './EditorialAgentService';
import { TranscriptionResult } from './TranscriptionService';

export interface TimelineClip {
  id: string;
  asset_path: string;
  trim_in: number;
  trim_out: number;
  start_at_timeline?: number;
  effects?: Array<{ type: string; start: number; duration: number; params?: any }>;
}

export interface TimelineTrack {
  type: 'video' | 'audio' | 'captions';
  layer: number;
  clips: TimelineClip[];
}

export interface FocoTimeline {
  version: string;
  project_fps: number;
  tracks: TimelineTrack[];
}

export class AssemblyEngineService {
  /**
   * Converte o Plano Narrativo abstrato em uma Timeline exata para o FOCO Editor
   */
  static generateTimeline(
    plan: EditorialDecisionResult,
    transcription: TranscriptionResult,
    mainAssetPath: string
  ): FocoTimeline {
    const videoTrack: TimelineTrack = { type: 'video', layer: 1, clips: [] };
    const brollTrack: TimelineTrack = { type: 'video', layer: 2, clips: [] };
    const captionsTrack: TimelineTrack = { type: 'captions', layer: 3, clips: [] };
    
    let currentTimelineTime = 0;

    for (let i = 0; i < plan.narrative_structure.length; i++) {
      const block = plan.narrative_structure[i] as any;
      
      if (block.role === 'exclude') continue;

      const { trimIn, trimOut } = this.resolveTimestamps(block, transcription.words);
      const clipDuration = trimOut - trimIn;

      if (clipDuration <= 0) continue; 

      // 1. Trilha de Vídeo Base
      const mainClip: TimelineClip = {
        id: `clip_${i}_${block.role}`,
        asset_path: mainAssetPath,
        trim_in: trimIn,
        trim_out: trimOut,
        start_at_timeline: currentTimelineTime,
        effects: []
      };

      // 2. Aplicar Direção de Arte Visual (B-Roll Profissional)
      if (block.art_direction?.b_roll_prompt) {
        // O asset path aqui seria o retorno da API de IA geradora após processar o b_roll_prompt
        const mockGeneratedAsset = \`assets/ai_gen_\${i}.mp4\`;
        brollTrack.clips.push({
          id: \`broll_\${i}\`,
          asset_path: mockGeneratedAsset,
          trim_in: 0, 
          trim_out: clipDuration,
          start_at_timeline: currentTimelineTime
        });
      }

      // 3. Aplicar Tipografia Cinética (Legendas Profissionais)
      if (block.art_direction?.motion_graphics === 'kinetic_typography') {
        captionsTrack.clips.push({
          id: \`caption_\${i}\`,
          asset_path: "text_generator",
          trim_in: trimIn,
          trim_out: trimOut,
          start_at_timeline: currentTimelineTime,
          effects: [
            {
              type: 'kinetic_pop',
              start: 0,
              duration: clipDuration,
              params: {
                text: block.text,
                highlight_words: block.art_direction.caption_highlight_words || [],
                style: 'professional_shadow' // Informa o front-end para NÃO usar fundos sólidos bregas
              }
            }
          ]
        });
      }

      videoTrack.clips.push(mainClip);
      currentTimelineTime += clipDuration;
    }

    return {
      version: "1.0",
      project_fps: 30, 
      tracks: [videoTrack, brollTrack, captionsTrack]
    };
  }

  private static resolveTimestamps(block: any, words: Array<{ word: string, start: number, end: number }>): { trimIn: number, trimOut: number } {
    if (block.start_word_index === undefined || block.end_word_index === undefined) {
      return { trimIn: 0, trimOut: 0 };
    }
    const startIndex = Math.max(0, block.start_word_index);
    const endIndex = Math.min(words.length - 1, block.end_word_index);
    return {
      trimIn: words[startIndex]?.start || 0,
      trimOut: words[endIndex]?.end || 0
    };
  }
}
