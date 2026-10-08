import { SettingsManager } from './SettingsManager';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  full_text: string;
  words: WordTimestamp[];
}

export class TranscriptionService {
  /**
   * Extrai a transcrição do áudio com word-level timestamps.
   * Decide automaticamente se usa a versão local ou nuvem baseado nas configurações.
   */
  static async transcribe(filepath: string): Promise<TranscriptionResult> {
    const settings = SettingsManager.getSettings();

    if (settings.transcriptionProvider === 'local') {
      return this.transcribeLocal(filepath, settings.localWhisperPath);
    } else {
      return this.transcribeCloud(filepath, settings.transcriptionProvider, settings.apiKeys);
    }
  }

  private static async transcribeLocal(filepath: string, whisperPath?: string): Promise<TranscriptionResult> {
    // Aqui nós implementaríamos a chamada via child_process para o binário local
    // Exemplo: whisper.cpp ou uma lib Python instalada no ambiente
    console.log(`[Transcription] Rodando Whisper local no arquivo: ${filepath}`);
    
    // MOCK: Simulando o retorno esperado de uma transcrição com words array
    return {
      full_text: "A piscina é o grande diferencial desta casa.",
      words: [
        { word: "A", start: 0.5, end: 0.6 },
        { word: "piscina", start: 0.6, end: 1.2 },
        { word: "é", start: 1.2, end: 1.4 },
        { word: "o", start: 1.4, end: 1.5 },
        { word: "grande", start: 1.5, end: 2.0 },
        { word: "diferencial", start: 2.0, end: 3.0 },
        { word: "desta", start: 3.0, end: 3.5 },
        { word: "casa.", start: 3.5, end: 4.2 }
      ]
    };
  }

  private static async transcribeCloud(filepath: string, provider: string, apiKeys: any): Promise<TranscriptionResult> {
    console.log(`[Transcription] Rodando Whisper na nuvem via ${provider}`);
    
    if (provider === 'openai' && !apiKeys.openai) {
      throw new Error('Chave da API da OpenAI não configurada.');
    }
    
    // Aqui entraria a chamada fetch/axios para a API da OpenAI ou Groq
    // Requer formData enviando o arquivo de áudio e a flag timestamp_granularities=["word"]

    // MOCK
    return {
      full_text: "Exemplo gerado pela Nuvem.",
      words: [
        { word: "Exemplo", start: 0.0, end: 1.0 },
        { word: "gerado", start: 1.0, end: 2.0 },
        { word: "pela", start: 2.0, end: 2.5 },
        { word: "Nuvem.", start: 2.5, end: 3.5 }
      ]
    };
  }
}
