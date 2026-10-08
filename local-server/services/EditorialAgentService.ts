import { SettingsManager } from './SettingsManager';
import { TranscriptionResult, MediaInfo } from './TranscriptionService';

export interface EditorialDecisionResult {
  editorial_decision: {
    model_chosen: string;
    pacing: string;
    music_vibe: string;
  };
  narrative_structure: Array<{
    role: 'hook' | 'exclude' | 'core_message' | 'transition';
    start_word_index?: number;
    end_word_index?: number;
    text?: string;
    
    // Novas propriedades de Direção de Arte Avançada
    art_direction?: {
      b_roll_prompt?: string; // Prompt hiper detalhado para evitar imagens fora de contexto
      motion_graphics?: 'kinetic_typography' | 'zoom_in_slow' | 'none';
      caption_highlight_words?: string[]; // Palavras que devem piscar em cor de destaque (ex: amarelo)
    };
  }>;
}

export class EditorialAgentService {
  /**
   * O Agente Diretor: Toma o mapa da mídia e o briefing e decide o plano de edição com rigor artístico.
   */
  static async createEditorialPlan(
    briefing: string, 
    mediaMap: { transcription: TranscriptionResult; technical: any; audio_health: any }
  ): Promise<EditorialDecisionResult> {
    
    const settings = SettingsManager.getSettings();
    console.log(`[EditorialAgent] Gerando plano de Alta Retenção usando: ${settings.aiProvider}`);
    
    // System Prompt evoluído com Direção de Arte e Regras Cinéticas
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(briefing, mediaMap);

    // MOCK: Simulação do retorno de um LLM treinado com regras rígidas de arte.
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          editorial_decision: {
            model_chosen: "Anuncio de Alta Retencao",
            pacing: "fast",
            music_vibe: "upbeat, bass heavy"
          },
          narrative_structure: [
            {
              role: "hook",
              start_word_index: 0,
              end_word_index: 7, // "A piscina é o grande diferencial desta casa."
              text: "A piscina é o grande diferencial desta casa.",
              art_direction: {
                // Ao invés de sugerir "piscina", o LLM cria uma cena de cinema.
                b_roll_prompt: "Cinematic drone tracking shot over a modern luxury pool with crystal clear blue water reflecting the bright sun, 4k, photorealistic, architectural digest style.",
                motion_graphics: "kinetic_typography",
                caption_highlight_words: ["piscina", "grande diferencial"] // Estas palavras farão "Pop" e ficarão amarelas
              }
            }
          ]
        });
      }, 1500);
    });
  }

  private static buildSystemPrompt(): string {
    return `
Você é o Agente Diretor Sênior de um software de edição de vídeo (FOCO Editor).
Sua missão é criar vídeos extremamente profissionais que prendem a atenção. O usuário odeia amadorismo.

=== REGRAS DE DIREÇÃO DE ARTE (B-ROLL) ===
1. NUNCA gere sugestões literais, simples ou fora de contexto. Se a pessoa falar "banco", você precisa inferir se é assento ou finanças baseado no texto inteiro.
2. O campo \`b_roll_prompt\` DEVE ser uma descrição de cena digna de Hollywood, pronta para ser usada por IAs geradoras de vídeo (Midjourney/Runway) ou busca em stock. Especifique iluminação, movimento de câmera (ex: tracking shot, drone, slow pan) e estilo.

=== REGRAS DE RETENÇÃO (TIPOGRAFIA CINÉTICA) ===
1. Nós não usamos fundos de legenda bregas ou caixas sólidas.
2. Use o campo \`caption_highlight_words\` para escolher as 1 ou 2 palavras mais importantes da frase. Na montagem, essas palavras sofrerão um efeito de "Pop" e mudarão de cor, segurando o olhar do espectador.
3. Se o trecho for um "hook" (gancho inicial), marque o \`motion_graphics\` como 'kinetic_typography'.

Retorne APENAS o JSON estruturado.
    `.trim();
  }

  private static buildUserPrompt(briefing: string, mediaMap: any): string {
    return `
Briefing do Usuário: "${briefing}"

Mapa da Mídia:
${JSON.stringify(mediaMap, null, 2)}
    `.trim();
  }
}
