export interface ViralityScore {
  hook: number;
  retention: number;
  clarity: number;
  emotion: number;
  curiosity: number;
  shareability: number;
  total: number;
}

export interface ShortCandidate {
  id: string;
  title: string;
  topic: string;
  startTime: number;
  endTime: number;
  duration: number;
  score: ViralityScore;
  suggestedHook: string;
  hasBrollSuggestions: boolean;
  brollKeywords: string[];
}

export class LongToShortsEngine {
  
  /**
   * Mocks the process of analyzing a 1h+ video and extracting high-retention shorts.
   * In a real environment, this receives the full transcript JSON and passes it to an LLM chain.
   */
  static analyzeVideo(videoId: string, durationSeconds: number): ShortCandidate[] {
    
    console.log(`[LongToShortsEngine] Analysing full transcript for video ${videoId} (${durationSeconds}s)`);
    console.log(`[LongToShortsEngine] Running Semantic Segmentation...`);
    
    // Simulating semantic segmentation and scoring
    const candidates: ShortCandidate[] = [
      {
         id: 'short_01',
         title: 'A Maior Mentira sobre o Dinheiro',
         topic: 'Finanças / Mindset',
         startTime: 124.5,
         endTime: 168.2,
         duration: 43.7,
         score: {
           hook: 92,
           retention: 85,
           clarity: 90,
           emotion: 74,
           curiosity: 96,
           shareability: 88,
           total: 87.5
         },
         suggestedHook: 'Existe uma mentira sobre o seu dinheiro que o banco não quer que você saiba.',
         hasBrollSuggestions: true,
         brollKeywords: ['dinheiro', 'banco', 'engrenagem', 'segredo']
      },
      {
         id: 'short_02',
         title: 'Como a Disciplina vence o Talento',
         topic: 'Motivacional',
         startTime: 1850.0,
         endTime: 1905.5,
         duration: 55.5,
         score: {
           hook: 82,
           retention: 92,
           clarity: 88,
           emotion: 95,
           curiosity: 80,
           shareability: 94,
           total: 88.5
         },
         suggestedHook: 'Eu vi pessoas geniais fracassarem porque faltou apenas uma coisa.',
         hasBrollSuggestions: true,
         brollKeywords: ['atleta treinando', 'suor', 'foco', 'resultado']
      },
      {
         id: 'short_03',
         title: 'O Segredo da Felicidade no Trabalho',
         topic: 'Carreira',
         startTime: 3420.1,
         endTime: 3470.9,
         duration: 50.8,
         score: {
           hook: 88,
           retention: 84,
           clarity: 95,
           emotion: 88,
           curiosity: 85,
           shareability: 82,
           total: 87.0
         },
         suggestedHook: 'USE ORIGINAL', // Keep original hook if it's already strong
         hasBrollSuggestions: false,
         brollKeywords: []
      }
    ];

    // Sort by best total score
    return candidates.sort((a, b) => b.score.total - a.score.total);
  }

  static applySmartReframe(candidate: ShortCandidate) {
    // Pipeline to center the subject in 9:16 aspect ratio
    console.log(`[LongToShortsEngine] Applying 9:16 Reframe with FaceTracking for short ${candidate.id}`);
  }

  static generateBroll(candidate: ShortCandidate) {
    // Triggers image/video generation or fetch based on brollKeywords
    console.log(`[LongToShortsEngine] Generating B-roll suggestions: ${candidate.brollKeywords.join(', ')}`);
  }
}
