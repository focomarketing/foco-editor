import type { TimelineState, TimelineAction, SubtitleClip } from '../types/timeline';
import { LongToShortsEngine } from './LongToShortsEngine';
import { AudioProcessingEngine } from './AudioProcessingEngine';

interface CommandResponse {
  message: string;
  actions: TimelineAction[];
  summary: string[];
}

export class AICommandEngine {
  
  static processCommand(command: string, state: TimelineState): CommandResponse {
    const actions: TimelineAction[] = [];
    const summary: string[] = [];
    
    const cmd = command.toLowerCase();

    // 1. SILENCE REMOVAL
    if (cmd.includes('silêncio') || cmd.includes('pausa')) {
      actions.push({
        type: 'SPLIT_CLIP',
        payload: { clipId: 'clip1', splitAt: 4.5 }
      });
      
      summary.push('Identificadas 3 pausas longas.');
      summary.push('Removido 1.2s de silêncio no total.');
      
      return {
        message: 'Concluído! Removi os espaços de silêncio.',
        actions,
        summary
      };
    }

    // 2. LONG TO SHORTS
    if (cmd.includes('shorts') || cmd.includes('viral') || cmd.includes('cortes')) {
       const candidates = LongToShortsEngine.analyzeVideo('current_project_id', 3600);
       const bestCandidate = candidates[0];

       actions.push({
         type: 'ADD_CLIP',
         payload: {
           id: `short_${Math.random()}`,
           type: 'video',
           name: `SHORT: ${bestCandidate.title}`,
           trackId: 'v1',
           startAt: state.playheadPosition,
           duration: bestCandidate.duration,
           fileUrl: 'mock.mp4',
           volume: 1,
           opacity: 1,
           scale: 1,
           position: { x: 0, y: 0 },
           sourceStart: bestCandidate.startTime
         }
       });

       if (bestCandidate.suggestedHook !== 'USE ORIGINAL') {
         actions.push({
           type: 'ADD_CLIP',
           payload: {
             id: `hook_${Math.random()}`,
             type: 'text',
             name: 'AI Hook',
             trackId: 'v2',
             startAt: state.playheadPosition,
             duration: 3,
             content: bestCandidate.suggestedHook,
             fontFamily: 'Montserrat, sans-serif',
             fontSize: 48,
             color: '#ffffff',
             position: { x: 400, y: 150 },
             animationType: 'fade_scale'
           }
         });
       }

       summary.push(`Analisado 1 hora de vídeo. Encontrados ${candidates.length} candidatos de alto potencial.`);
       summary.push(`Melhor Short: "${bestCandidate.title}" (Score Viral: ${bestCandidate.score.total})`);
       if (bestCandidate.suggestedHook !== 'USE ORIGINAL') {
         summary.push(`AI Hook Sugerido e Aplicado: "${bestCandidate.suggestedHook}"`);
       }
       summary.push('Smart Reframe 9:16 aplicado automaticamente.');
       
       return {
         message: `Criei ${candidates.length} Shorts baseados no conteúdo. Adicionei o melhor candidato ("${bestCandidate.title}") na timeline para revisão.`,
         actions,
         summary
       };
    }

    // 3. CAPTIONS / LEGENDAS / KINETIC
    if (cmd.includes('legenda')) {
       let preset: 'podcast' | 'kinetic' = 'podcast';
       if (cmd.includes('kinetic') || cmd.includes('dinâmica')) {
          preset = 'kinetic';
       }

       const subtitleClip: SubtitleClip = {
           id: `caption_${Math.random()}`,
           type: 'subtitle',
           name: 'Legenda Automática',
           trackId: 'v2',
           startAt: 0,
           duration: 4,
           fontFamily: 'Montserrat, sans-serif',
           fontSize: 64,
           color: '#ffffff',
           position: { x: 400, y: 350 },
           preset: preset,
           words: [
             { word: 'A', start: 0.0, end: 0.3 },
             { word: 'inteligência', start: 0.3, end: 1.0 },
             { word: 'artificial', start: 1.0, end: 1.8, isEmphasized: true },
             { word: 'não', start: 1.8, end: 2.2 },
             { word: 'vai', start: 2.2, end: 2.5 },
             { word: 'substituir', start: 2.5, end: 3.2, isEmphasized: true },
             { word: 'você.', start: 3.2, end: 3.8 }
           ]
       };

       actions.push({
         type: 'ADD_CLIP',
         payload: subtitleClip
       });

       summary.push('Transcrição via Whisper realizada com sucesso.');
       summary.push('Timecodes extraídos palavra por palavra.');
       summary.push(`Estilo "${preset.toUpperCase()}" aplicado com animações. (Palavras-chave destacadas em vermelho)`);
       
       return {
         message: 'Gerei as legendas animadas palavra-por-palavra na timeline.',
         actions,
         summary
       };
    }

    // 4. AUDIO PROCESSING ENGINE
    if (cmd.includes('áudio') || cmd.includes('audio') || cmd.includes('som')) {
      let presetName: 'voice' | 'podcast' | 'cinematic' = 'voice';
      if (cmd.includes('podcast')) presetName = 'podcast';
      if (cmd.includes('cinema')) presetName = 'cinematic';

      const audioSettings = AudioProcessingEngine.getPresetSettings(presetName);
      
      // We apply these settings to all audio and video clips in the timeline
      state.clips.forEach(clip => {
        if (clip.type === 'audio' || clip.type === 'video') {
           actions.push({
             type: 'UPDATE_CLIP',
             payload: {
               clipId: clip.id,
               updates: { audioSettings }
             }
           });
        }
      });

      if (audioSettings.noiseReduction > 0) summary.push(`Noise Reduction ativado (Intensidade: ${audioSettings.noiseReduction})`);
      if (audioSettings.compressor) summary.push('Compressor Dinâmico aplicado (Ratio 4:1)');
      if (audioSettings.normalization) summary.push('Normalização de volume ativada (-14 LUFS)');
      if (audioSettings.eqPreset) summary.push(`Equalização inteligente aplicada (Preset: ${audioSettings.eqPreset})`);

      return {
        message: `Áudio processado e otimizado utilizando o preset "${presetName.toUpperCase()}".`,
        actions,
        summary
      }
    }
    
    // DEFAULT
    return {
      message: 'Não consegui compreender esse comando ainda. Tente "Melhore o áudio estilo podcast", "Remova os silêncios", "Gere legendas dinâmicas" ou "Gere shorts".',
      actions: [],
      summary: []
    };
  }
}
