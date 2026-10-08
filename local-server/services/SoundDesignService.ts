import { FocoTimeline, TimelineClip, TimelineTrack } from './AssemblyEngineService';

export interface AudioAsset {
  id: string;
  path: string;
  type: 'sfx_pop' | 'sfx_whoosh' | 'sfx_riser' | 'music_upbeat' | 'music_cinematic' | 'music_lofi';
}

export class SoundDesignService {
  /**
   * O Especialista de Áudio (Sound Designer).
   * Analisa a timeline visual gerada pela Montagem e injeta efeitos sonoros (SFX),
   * trilha sonora e faz a mixagem inteligente (Audio Ducking).
   */
  static applySoundDesign(timeline: FocoTimeline, musicVibe: string): FocoTimeline {
    console.log(`[SoundDesign] Iniciando design de som com vibe: ${musicVibe}`);

    const sfxTrack: TimelineTrack = { type: 'audio', layer: 4, clips: [] };
    const musicTrack: TimelineTrack = { type: 'audio', layer: 5, clips: [] };

    const videoTrack = timeline.tracks.find(t => t.type === 'video' && t.layer === 1);
    const captionsTrack = timeline.tracks.find(t => t.type === 'captions');

    if (!videoTrack) return timeline;

    // 1. Trilha Sonora e Audio Ducking (Mixagem)
    this.applyMusicAndDucking(videoTrack, musicTrack, musicVibe);

    // 2. Efeitos Sonoros para Transições (Jump Cuts grandes)
    this.applyTransitionSFX(videoTrack, sfxTrack);

    // 3. Efeitos Sonoros para Tipografia Cinética (Pops)
    if (captionsTrack) {
      this.applyKineticTypographySFX(captionsTrack, sfxTrack);
    }

    timeline.tracks.push(sfxTrack, musicTrack);
    return timeline;
  }

  /**
   * Escolhe uma trilha sonora e aplica Audio Ducking baseado na fala (V1).
   */
  private static applyMusicAndDucking(videoTrack: TimelineTrack, musicTrack: TimelineTrack, vibe: string) {
    // MOCK: O sistema escolheria a música da biblioteca local baseada na 'vibe' pedida pelo Diretor
    let chosenMusic = 'assets/music/lofi_chill.mp3';
    if (vibe.includes('upbeat') || vibe.includes('fast')) chosenMusic = 'assets/music/upbeat_energetic.mp3';

    // Para saber o tamanho total do vídeo, pegamos o fim do último clipe
    const lastClip = videoTrack.clips[videoTrack.clips.length - 1];
    const totalDuration = lastClip ? (lastClip.start_at_timeline! + (lastClip.trim_out - lastClip.trim_in)) : 0;

    if (totalDuration === 0) return;

    // O Volume Keyframing (Ducking Automático)
    // Regra: Música fica a -20dB quando a pessoa fala, e sobe para -8dB nos silêncios.
    const volumeKeyframes: Array<{ time: number, level: number }> = [];

    let currentCursor = 0;
    videoTrack.clips.forEach((clip, index) => {
      const clipStart = clip.start_at_timeline!;
      const clipDuration = clip.trim_out - clip.trim_in;
      const clipEnd = clipStart + clipDuration;

      // Se há um buraco entre o cursor atual e o início deste clipe, é silêncio puro! Sobe a música.
      if (clipStart > currentCursor + 0.5) {
         volumeKeyframes.push({ time: currentCursor, level: -8 }); // Sobe a música
         volumeKeyframes.push({ time: clipStart - 0.2, level: -20 }); // Baixa a música pouco antes da fala
      } else if (index === 0) {
         volumeKeyframes.push({ time: 0, level: -20 }); // Começa baixo se já começa falando
      }

      currentCursor = clipEnd;
    });

    // Sobrenatural no final
    volumeKeyframes.push({ time: currentCursor, level: -8 }); // Música sobe no final
    volumeKeyframes.push({ time: totalDuration, level: -40 }); // Fade out

    musicTrack.clips.push({
      id: 'bg_music',
      asset_path: chosenMusic,
      trim_in: 0,
      trim_out: totalDuration,
      start_at_timeline: 0,
      effects: [
        { type: 'volume_ducking', start: 0, duration: totalDuration, params: { keyframes: volumeKeyframes } }
      ]
    });
  }

  /**
   * Adiciona Efeitos Sonoros 'Whoosh' em mudanças drásticas de cena ou cortes longos.
   */
  private static applyTransitionSFX(videoTrack: TimelineTrack, sfxTrack: TimelineTrack) {
    for (let i = 1; i < videoTrack.clips.length; i++) {
      const prevClip = videoTrack.clips[i - 1];
      const currentClip = videoTrack.clips[i];

      const gap = currentClip.start_at_timeline! - (prevClip.start_at_timeline! + (prevClip.trim_out - prevClip.trim_in));
      
      // Se houve um salto de tempo significativo (Jump Cut duro), aplica um Whoosh suave
      if (gap > 0.3) {
        sfxTrack.clips.push({
          id: \`sfx_whoosh_\${i}\`,
          asset_path: 'assets/sfx/whoosh_transition.wav',
          trim_in: 0,
          trim_out: 1.0, // SFX rápido
          start_at_timeline: currentClip.start_at_timeline! - 0.5, // Antecipa meio segundo
          effects: [{ type: 'volume', start: 0, duration: 1.0, params: { level: -12 } }]
        });
      }
    }
  }

  /**
   * Adiciona o efeito sonoro de 'Pop' para a Tipografia Cinética.
   */
  private static applyKineticTypographySFX(captionsTrack: TimelineTrack, sfxTrack: TimelineTrack) {
    captionsTrack.clips.forEach((cap, index) => {
      // Se a legenda tiver a ordem de dar 'Pop' nas palavras
      const hasPop = cap.effects?.some(e => e.type === 'kinetic_pop');
      if (hasPop) {
        sfxTrack.clips.push({
          id: \`sfx_pop_\${index}\`,
          asset_path: 'assets/sfx/mouth_pop.wav',
          trim_in: 0,
          trim_out: 0.2,
          start_at_timeline: cap.start_at_timeline,
          effects: [{ type: 'volume', start: 0, duration: 0.2, params: { level: -6 } }]
        });
      }
    });
  }
}
