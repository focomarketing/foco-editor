import { FocoTimeline, TimelineClip, TimelineTrack } from './AssemblyEngineService';

export interface AuditError {
  type: 'FLASH_FRAME' | 'PACING_VIOLATION' | 'AUDIO_COLLISION' | 'JUMP_CUT_VIOLATION';
  clip_id: string;
  description: string;
  suggested_fix: string;
}

export interface AuditResult {
  status: 'APPROVED' | 'FAILED';
  errors: AuditError[];
}

export class ReviewAuditService {
  
  // Constantes de regra de negócio
  private static readonly MIN_CLIP_DURATION = 0.5; // Segundos
  private static readonly MAX_STATIC_PACING = 5.0; // Segundos sem variação visual

  /**
   * Avalia a timeline gerada antes de enviá-la para o cliente.
   */
  static validateTimeline(timeline: FocoTimeline): AuditResult {
    const errors: AuditError[] = [];

    timeline.tracks.forEach(track => {
      // 1. Validar Flash Frames em todas as trilhas de vídeo
      if (track.type === 'video') {
        this.checkFlashFrames(track, errors);
      }
      
      // 2. Validar Pacing apenas na trilha principal (Layer 1)
      if (track.type === 'video' && track.layer === 1) {
        this.checkPacing(track, timeline, errors);
      }
    });

    return {
      status: errors.length === 0 ? 'APPROVED' : 'FAILED',
      errors
    };
  }

  private static checkFlashFrames(track: TimelineTrack, errors: AuditError[]) {
    for (const clip of track.clips) {
      const duration = clip.trim_out - clip.trim_in;
      if (duration < this.MIN_CLIP_DURATION) {
        errors.push({
          type: 'FLASH_FRAME',
          clip_id: clip.id,
          description: \`Clipe muito curto (\${duration.toFixed(2)}s). Mínimo exigido: \${this.MIN_CLIP_DURATION}s.\`,
          suggested_fix: 'extend_duration_or_remove'
        });
      }
    }
  }

  private static checkPacing(mainTrack: TimelineTrack, fullTimeline: FocoTimeline, errors: AuditError[]) {
    // Busca a track de B-Roll (Layer 2) para saber se a imagem foi coberta
    const brollTrack = fullTimeline.tracks.find(t => t.type === 'video' && t.layer === 2);
    
    for (const clip of mainTrack.clips) {
      const duration = clip.trim_out - clip.trim_in;
      
      if (duration > this.MAX_STATIC_PACING) {
        // Verifica se tem efeito (zoom, etc) ou B-Roll em cima deste tempo
        const hasEffects = clip.effects && clip.effects.length > 0;
        
        // Forma simplificada de checar cobertura de B-Roll (no tempo real precisaria de intersecção de tempo)
        const hasBrollCovering = brollTrack?.clips.some(
          bclip => bclip.start_at_timeline === clip.start_at_timeline
        );

        if (!hasEffects && !hasBrollCovering) {
           errors.push({
             type: 'PACING_VIOLATION',
             clip_id: clip.id,
             description: \`Trecho de fala longo (\${duration.toFixed(2)}s) sem variação visual (B-Roll ou Zoom).\`,
             suggested_fix: 'add_broll_or_zoom_effect'
           });
        }
      }
    }
  }
}
