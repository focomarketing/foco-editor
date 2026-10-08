// Biblioteca de transições do FOCO (implementações originais e parametrizadas). Fonte única:
// o compositor desenha pelo `render`, a skill professional-transition-designer escolhe por
// categoria/plataforma/regras e a interface lista daqui. Referências são só conceituais
// (técnicas de montagem conhecidas); nenhum preset comercial foi copiado.

export type TransitionCategory = 'clean' | 'social' | 'youtube' | 'commercial' | 'interview';
export type Platform = 'youtube' | 'shorts' | 'reels' | 'tiktok' | 'commercial' | 'interview';

/** Como o compositor desenha (ver engine/render/transitions.ts). */
export type RenderKind =
  | 'none' // decisão de corte seco (match cut, corte por ação...): nada é desenhado
  | 'dissolve'
  | 'dip'
  | 'zoom'
  | 'whip'
  | 'push'
  | 'spin'
  | 'blur'
  | 'flash'
  | 'shake'
  | 'rgb'
  | 'glitch'
  | 'mask'
  | 'light'
  | 'card'
  | 'punch';

/**
 * Janela no tempo: center = metade antes e metade depois do corte (efeito sobre um quadro só);
 * in = depois do corte, com o último quadro do clipe anterior por baixo (dissolve, máscara, push);
 * hold = o clipe que entra inteiro (punch-in que disfarça corte de salto).
 */
export type Align = 'center' | 'in' | 'hold';

export interface TransitionPreset {
  id: string;
  name: string;
  category: TransitionCategory;
  platforms: Platform[];
  description: string;
  useCases: string[];
  duration: { min: number; recommended: number; max: number };
  parameters: {
    intensity?: number;
    blur?: number;
    scale?: number;
    rotation?: number;
    position?: number;
    opacity?: number;
    easing?: 'linear' | 'smooth' | 'snappy' | 'elastic';
    motionBlur?: boolean;
    soundEffect?: string;
    /** Direção do movimento/máscara. */
    direction?: 'left' | 'right' | 'up' | 'down';
    color?: string;
    shape?: 'linear' | 'circle' | 'diamond' | 'bars' | 'liquid' | 'band' | 'diagonal';
  };
  requirements: { motionMatch?: boolean; beatSync?: boolean; compatibleAspectRatios: string[] };
  render: RenderKind;
  align: Align;
  /** 1 sutil · 2 médio · 3 forte (chamativo). */
  level: 1 | 2 | 3;
  /** Referência conceitual (técnica de montagem), não um arquivo copiado. */
  reference: string;
  previewUrl?: string;
}

const BOTH = ['16:9', '9:16', '1:1', '4:5'];
type P = Omit<TransitionPreset, 'requirements' | 'parameters'> & { parameters?: TransitionPreset['parameters']; requirements?: Partial<TransitionPreset['requirements']> };
const p = (x: P): TransitionPreset => ({ ...x, parameters: { intensity: 0.5, easing: 'smooth', ...x.parameters }, requirements: { compatibleAspectRatios: BOTH, ...x.requirements } });
const D = (min: number, recommended: number, max: number) => ({ min, recommended, max });

export const TRANSITIONS: TransitionPreset[] = [
  // --- clean e profissionais -------------------------------------------------------------------
  p({ id: 'smart-cut', name: 'Corte seco inteligente', category: 'clean', platforms: ['youtube', 'shorts', 'reels', 'tiktok', 'commercial', 'interview'], description: 'Sem efeito: o corte no ponto certo já resolve.', useCases: ['fala contínua', 'ritmo', 'clareza'], duration: D(0, 0, 0), render: 'none', align: 'center', level: 1, reference: 'hard cut / corte seco (montagem clássica)' }),
  p({ id: 'match-cut', name: 'Match cut', category: 'clean', platforms: ['youtube', 'shorts', 'reels', 'tiktok', 'commercial'], description: 'Corte seco entre planos com forma, cor ou enquadramento parecidos.', useCases: ['continuidade visual', 'troca de cena elegante'], duration: D(0, 0, 0), render: 'none', align: 'center', level: 1, reference: 'match cut (Eisenstein, Kubrick)', requirements: { motionMatch: true } }),
  p({ id: 'action-cut', name: 'Corte por ação', category: 'clean', platforms: ['youtube', 'shorts', 'reels', 'tiktok', 'commercial'], description: 'Corta no meio de um gesto; a ação continua no plano seguinte.', useCases: ['gesto', 'movimento de pessoa'], duration: D(0, 0, 0), render: 'none', align: 'center', level: 1, reference: 'cutting on action' }),
  p({ id: 'motion-cut', name: 'Corte por movimento', category: 'clean', platforms: ['youtube', 'shorts', 'reels', 'tiktok', 'commercial'], description: 'Dois planos com o mesmo movimento de câmera: o corte some.', useCases: ['câmera em movimento', 'drone', 'travelling'], duration: D(0, 0, 0), render: 'none', align: 'center', level: 1, reference: 'motion-matched cut', requirements: { motionMatch: true } }),
  p({ id: 'whip-pan-soft', name: 'Whip pan suave', category: 'clean', platforms: ['youtube', 'commercial', 'reels'], description: 'Chicote de câmera curto e com pouco desfoque.', useCases: ['mudança de lugar', 'movimento lateral'], duration: D(0.2, 0.32, 0.5), parameters: { intensity: 0.4, blur: 0.02, direction: 'left', motionBlur: true }, render: 'whip', align: 'center', level: 2, reference: 'whip pan (swish pan)', requirements: { motionMatch: true } }),
  p({ id: 'push-slide', name: 'Push slide', category: 'clean', platforms: ['youtube', 'commercial', 'reels', 'tiktok'], description: 'O plano novo empurra o anterior para fora.', useCases: ['lista de itens', 'antes e depois'], duration: D(0.25, 0.4, 0.8), parameters: { intensity: 0.5, direction: 'left', easing: 'snappy' }, render: 'push', align: 'in', level: 2, reference: 'push transition' }),
  p({ id: 'zoom-clean', name: 'Zoom clean', category: 'clean', platforms: ['youtube', 'commercial', 'reels', 'tiktok', 'shorts'], description: 'Aproxima saindo e chega no plano novo, com desfoque leve.', useCases: ['entrar num detalhe', 'virada de assunto'], duration: D(0.25, 0.4, 0.7), parameters: { intensity: 0.4, scale: 0.25, blur: 0.01 }, render: 'zoom', align: 'center', level: 2, reference: 'zoom transition' }),
  p({ id: 'rack-focus', name: 'Rack focus', category: 'clean', platforms: ['youtube', 'commercial', 'interview'], description: 'O foco sai do plano e volta no seguinte.', useCases: ['reflexão', 'passagem de tempo curta'], duration: D(0.4, 0.7, 1.2), parameters: { intensity: 0.45, blur: 0.025, scale: 0.03 }, render: 'blur', align: 'center', level: 1, reference: 'rack focus / pull focus' }),
  p({ id: 'blur-transition', name: 'Blur transition', category: 'clean', platforms: ['youtube', 'commercial', 'reels', 'tiktok', 'shorts'], description: 'Desfoca, troca e volta a focar.', useCases: ['troca suave de cena'], duration: D(0.3, 0.5, 0.9), parameters: { intensity: 0.5, blur: 0.03 }, render: 'blur', align: 'center', level: 1, reference: 'defocus transition' }),
  p({ id: 'seamless-cut', name: 'Seamless cut', category: 'clean', platforms: ['youtube', 'commercial', 'interview', 'reels'], description: 'Micro-dissolve (3 a 5 quadros) que tira o "pulo" do corte.', useCases: ['corte de salto discreto', 'emenda'], duration: D(0.08, 0.14, 0.25), parameters: { intensity: 1 }, render: 'dissolve', align: 'in', level: 1, reference: 'morph cut / micro dissolve' }),
  p({ id: 'speed-ramp-cut', name: 'Speed ramp cut', category: 'clean', platforms: ['shorts', 'reels', 'tiktok', 'commercial', 'youtube'], description: 'Acelera saindo e desacelera chegando (zoom + rastro).', useCases: ['viagem', 'ação', 'energia'], duration: D(0.3, 0.45, 0.8), parameters: { intensity: 0.55, scale: 0.18, blur: 0.02, motionBlur: true, easing: 'snappy' }, render: 'zoom', align: 'center', level: 2, reference: 'speed ramp', requirements: { beatSync: true } }),
  p({ id: 'masked-reveal', name: 'Masked reveal', category: 'clean', platforms: ['youtube', 'commercial', 'reels'], description: 'O plano novo aparece por uma máscara que corre a tela.', useCases: ['revelação', 'troca de ambiente'], duration: D(0.35, 0.55, 1), parameters: { intensity: 0.5, shape: 'linear', direction: 'left', easing: 'smooth' }, render: 'mask', align: 'in', level: 2, reference: 'mask transition / wipe' }),

  // --- Reels, TikTok e Shorts --------------------------------------------------------------------
  p({ id: 'beat-zoom', name: 'Beat zoom', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Zoom seco na batida da música.', useCases: ['corte na batida', 'montagem rápida'], duration: D(0.12, 0.2, 0.35), parameters: { intensity: 0.65, scale: 0.22, easing: 'snappy' }, render: 'zoom', align: 'center', level: 3, reference: 'beat sync zoom', requirements: { beatSync: true } }),
  p({ id: 'punch-zoom', name: 'Punch zoom', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Soco de zoom no rosto, sem desfoque.', useCases: ['ênfase', 'corte de salto'], duration: D(0.1, 0.18, 0.3), parameters: { intensity: 0.6, scale: 0.15, easing: 'snappy' }, render: 'zoom', align: 'center', level: 2, reference: 'punch-in zoom (talking head)' }),
  p({ id: 'whip-transition', name: 'Whip', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Chicote rápido com rastro de movimento.', useCases: ['troca de cena', 'mudança de lugar'], duration: D(0.18, 0.28, 0.45), parameters: { intensity: 0.75, blur: 0.04, direction: 'left', motionBlur: true }, render: 'whip', align: 'center', level: 3, reference: 'whip pan / swish', requirements: { motionMatch: true } }),
  p({ id: 'controlled-shake', name: 'Shake controlado', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Tremida curta e contida no corte.', useCases: ['impacto', 'batida forte'], duration: D(0.15, 0.25, 0.45), parameters: { intensity: 0.5, position: 0.02 }, render: 'shake', align: 'center', level: 2, reference: 'camera shake', requirements: { beatSync: true } }),
  p({ id: 'snap', name: 'Snap', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Deslize curtíssimo com estalo (6 quadros).', useCases: ['ritmo', 'lista rápida'], duration: D(0.1, 0.16, 0.25), parameters: { intensity: 0.7, direction: 'up', blur: 0.02, easing: 'snappy' }, render: 'whip', align: 'center', level: 2, reference: 'snap transition' }),
  p({ id: 'spin', name: 'Spin', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Giro com zoom e rastro.', useCases: ['viagem', 'virada', 'humor'], duration: D(0.25, 0.4, 0.6), parameters: { intensity: 0.6, rotation: 180, scale: 0.2, blur: 0.02 }, render: 'spin', align: 'center', level: 3, reference: 'spin transition' }),
  p({ id: 'flash-cut', name: 'Flash cut', category: 'social', platforms: ['shorts', 'reels', 'tiktok', 'youtube'], description: 'Clarão branco de 2 a 4 quadros no corte.', useCases: ['batida', 'foto', 'virada'], duration: D(0.08, 0.15, 0.3), parameters: { intensity: 0.7, color: '#ffffff' }, render: 'flash', align: 'center', level: 2, reference: 'flash frame', requirements: { beatSync: true } }),
  p({ id: 'velocity', name: 'Velocity', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Zoom com aceleração forte e rastro (estilo edit de velocidade).', useCases: ['montagem musical', 'energia alta'], duration: D(0.25, 0.4, 0.6), parameters: { intensity: 0.8, scale: 0.35, blur: 0.035, motionBlur: true, easing: 'snappy' }, render: 'zoom', align: 'center', level: 3, reference: 'velocity edit / speed ramp', requirements: { beatSync: true } }),
  p({ id: 'object-wipe', name: 'Object wipe', category: 'social', platforms: ['shorts', 'reels', 'tiktok', 'commercial'], description: 'Uma faixa escura passa pela tela e troca o plano (simula objeto passando).', useCases: ['passagem de objeto', 'troca de roupa/lugar'], duration: D(0.25, 0.4, 0.6), parameters: { intensity: 0.6, shape: 'band', direction: 'left', color: '#0b0b0d' }, render: 'mask', align: 'in', level: 2, reference: 'object wipe (objeto em primeiro plano)' }),
  p({ id: 'hand-cover', name: 'Hand cover', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'A tela escurece como se uma mão cobrisse a lente e reabre no plano novo.', useCases: ['transformação', 'troca de look'], duration: D(0.2, 0.35, 0.5), parameters: { intensity: 0.7, shape: 'band', direction: 'up', color: '#120d0b' }, render: 'mask', align: 'in', level: 2, reference: 'hand cover transition' }),
  p({ id: 'shake-sync', name: 'Camera shake sincronizado', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Tremida mais forte, alinhada à batida, com desfoque.', useCases: ['drop da música', 'impacto'], duration: D(0.2, 0.3, 0.5), parameters: { intensity: 0.75, position: 0.035, blur: 0.01 }, render: 'shake', align: 'center', level: 3, reference: 'beat shake', requirements: { beatSync: true } }),
  p({ id: 'impact-cut', name: 'Impact cut', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Flash + tremida + zoom curto num quadro de impacto.', useCases: ['frase de efeito', 'drop'], duration: D(0.15, 0.24, 0.4), parameters: { intensity: 0.8, scale: 0.12, position: 0.02, color: '#ffffff' }, render: 'flash', align: 'center', level: 3, reference: 'impact frame', requirements: { beatSync: true } }),
  p({ id: 'frame-skip', name: 'Frame skip', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Engasgo digital curto: fatias deslocadas por poucos quadros.', useCases: ['tecnologia', 'humor', 'erro proposital'], duration: D(0.12, 0.2, 0.35), parameters: { intensity: 0.5 }, render: 'glitch', align: 'center', level: 2, reference: 'stutter / frame skip' }),
  p({ id: 'digital-swipe', name: 'Digital swipe', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Deslize lateral com separação de cor.', useCases: ['tecnologia', 'tela de app'], duration: D(0.2, 0.3, 0.45), parameters: { intensity: 0.6, direction: 'left', blur: 0.015 }, render: 'whip', align: 'center', level: 2, reference: 'swipe + chromatic aberration' }),
  p({ id: 'quick-blur', name: 'Quick blur', category: 'social', platforms: ['shorts', 'reels', 'tiktok'], description: 'Desfoque rápido e forte no corte.', useCases: ['troca rápida', 'suavizar corte seco'], duration: D(0.12, 0.2, 0.35), parameters: { intensity: 0.6, blur: 0.04 }, render: 'blur', align: 'center', level: 1, reference: 'blur cut' }),
  p({ id: 'rgb-split', name: 'RGB split sutil', category: 'social', platforms: ['shorts', 'reels', 'tiktok', 'youtube'], description: 'Canais de cor se separam por um instante.', useCases: ['batida', 'tecnologia'], duration: D(0.12, 0.2, 0.35), parameters: { intensity: 0.4, position: 0.012 }, render: 'rgb', align: 'center', level: 2, reference: 'chromatic aberration / RGB split' }),

  // --- YouTube -----------------------------------------------------------------------------------
  p({ id: 'clean-cut', name: 'Clean cut', category: 'youtube', platforms: ['youtube', 'interview'], description: 'Corte seco: o padrão do YouTube.', useCases: ['talking head', 'tutorial'], duration: D(0, 0, 0), render: 'none', align: 'center', level: 1, reference: 'hard cut' }),
  p({ id: 'dip-black', name: 'Dip to black', category: 'youtube', platforms: ['youtube', 'commercial', 'interview'], description: 'Escurece e volta: fim de bloco, passagem de tempo.', useCases: ['mudança de capítulo', 'final'], duration: D(0.4, 0.8, 1.6), parameters: { intensity: 1, color: '#000000' }, render: 'dip', align: 'center', level: 1, reference: 'fade through black' }),
  p({ id: 'dip-white', name: 'Dip to white', category: 'youtube', platforms: ['youtube', 'commercial'], description: 'Clareia e volta: memória, sonho, virada positiva.', useCases: ['lembrança', 'revelação'], duration: D(0.3, 0.6, 1.2), parameters: { intensity: 1, color: '#ffffff' }, render: 'dip', align: 'center', level: 2, reference: 'fade through white' }),
  p({ id: 'cross-dissolve', name: 'Cross dissolve', category: 'youtube', platforms: ['youtube', 'commercial', 'interview'], description: 'Fusão clássica entre dois planos.', useCases: ['passagem de tempo', 'B-roll'], duration: D(0.3, 0.6, 1.5), parameters: { intensity: 1 }, render: 'dissolve', align: 'in', level: 1, reference: 'cross dissolve' }),
  p({ id: 'chapter-transition', name: 'Chapter transition', category: 'youtube', platforms: ['youtube'], description: 'Escurece com leve aproximação: marca troca de capítulo.', useCases: ['novo capítulo', 'novo tópico'], duration: D(0.8, 1.2, 2), parameters: { intensity: 1, color: '#000000', scale: 0.04 }, render: 'dip', align: 'center', level: 1, reference: 'chapter break (fade + scale)' }),
  p({ id: 'broll-bridge', name: 'B-roll bridge', category: 'youtube', platforms: ['youtube', 'interview', 'commercial'], description: 'Fusão curta para entrar/sair de B-roll sem pulo.', useCases: ['B-roll sobre a fala'], duration: D(0.2, 0.35, 0.6), parameters: { intensity: 1 }, render: 'dissolve', align: 'in', level: 1, reference: 'B-roll bridge dissolve' }),
  p({ id: 'animated-wipe', name: 'Animated wipe', category: 'youtube', platforms: ['youtube', 'commercial'], description: 'Cortina diagonal com borda de cor.', useCases: ['lista', 'seção nova'], duration: D(0.35, 0.5, 0.9), parameters: { intensity: 0.6, shape: 'diagonal', direction: 'right', color: '#4f8cff' }, render: 'mask', align: 'in', level: 2, reference: 'wipe' }),
  p({ id: 'subtle-push', name: 'Subtle push', category: 'youtube', platforms: ['youtube', 'interview', 'commercial'], description: 'Push curto e suave (desloca pouco).', useCases: ['troca de exemplo', 'antes e depois'], duration: D(0.25, 0.4, 0.7), parameters: { intensity: 0.3, direction: 'left', easing: 'smooth' }, render: 'push', align: 'in', level: 1, reference: 'push' }),
  p({ id: 'focus-transition', name: 'Focus transition', category: 'youtube', platforms: ['youtube', 'interview'], description: 'Desfoca com leve aproximação e reabre no plano novo.', useCases: ['reflexão', 'detalhe'], duration: D(0.4, 0.6, 1), parameters: { intensity: 0.4, blur: 0.02, scale: 0.05 }, render: 'blur', align: 'center', level: 1, reference: 'focus pull' }),
  p({ id: 'cinematic-dissolve', name: 'Cinematic dissolve', category: 'youtube', platforms: ['youtube', 'commercial'], description: 'Fusão longa com leve aproximação, para ensaios e documentários.', useCases: ['documentário', 'ensaio', 'abertura'], duration: D(0.8, 1.2, 2.5), parameters: { intensity: 1, scale: 0.04 }, render: 'dissolve', align: 'in', level: 1, reference: 'film dissolve' }),

  // --- comerciais --------------------------------------------------------------------------------
  p({ id: 'product-reveal', name: 'Product reveal', category: 'commercial', platforms: ['commercial', 'reels', 'shorts', 'tiktok'], description: 'Círculo que abre do centro revelando o produto.', useCases: ['produto', 'resultado'], duration: D(0.35, 0.55, 0.9), parameters: { intensity: 0.6, shape: 'circle', easing: 'smooth' }, render: 'mask', align: 'in', level: 2, reference: 'iris reveal' }),
  p({ id: 'light-sweep', name: 'Light sweep', category: 'commercial', platforms: ['commercial', 'youtube', 'reels'], description: 'Faixa de luz atravessa a tela no corte.', useCases: ['produto premium', 'logo'], duration: D(0.3, 0.5, 0.9), parameters: { intensity: 0.6, color: '#fff6e0', direction: 'right' }, render: 'light', align: 'center', level: 2, reference: 'light sweep / sheen' }),
  p({ id: 'light-leak', name: 'Light leak', category: 'commercial', platforms: ['commercial', 'youtube', 'reels', 'tiktok'], description: 'Vazamento de luz quente e orgânico.', useCases: ['lifestyle', 'memória', 'casamento'], duration: D(0.4, 0.7, 1.4), parameters: { intensity: 0.55, color: '#ff9a3c' }, render: 'light', align: 'center', level: 2, reference: 'film light leak' }),
  p({ id: 'shape-mask', name: 'Shape mask', category: 'commercial', platforms: ['commercial', 'reels', 'shorts'], description: 'Losango que cresce e revela o plano novo.', useCases: ['marca', 'seção'], duration: D(0.35, 0.5, 0.9), parameters: { intensity: 0.6, shape: 'diamond' }, render: 'mask', align: 'in', level: 2, reference: 'shape transition' }),
  p({ id: 'liquid-mask', name: 'Liquid mask', category: 'commercial', platforms: ['commercial', 'reels', 'tiktok'], description: 'Borda ondulada que escorre revelando o plano.', useCases: ['bebida', 'cosmético', 'fluidez'], duration: D(0.45, 0.7, 1.1), parameters: { intensity: 0.6, shape: 'liquid', direction: 'down' }, render: 'mask', align: 'in', level: 2, reference: 'liquid transition' }),
  p({ id: 'parallax', name: 'Parallax', category: 'commercial', platforms: ['commercial', 'youtube', 'reels'], description: 'Push com camadas em velocidades diferentes (profundidade).', useCases: ['produto', 'portfólio'], duration: D(0.4, 0.6, 1), parameters: { intensity: 0.5, direction: 'left', easing: 'smooth' }, render: 'push', align: 'in', level: 2, reference: 'parallax slide' }),
  p({ id: 'card-3d', name: '3D card', category: 'commercial', platforms: ['commercial', 'reels', 'shorts'], description: 'O plano vira como um cartão e revela o seguinte.', useCases: ['comparação', 'catálogo'], duration: D(0.4, 0.6, 1), parameters: { intensity: 0.6 }, render: 'card', align: 'in', level: 3, reference: 'card flip' }),
  p({ id: 'color-match-dissolve', name: 'Match color', category: 'commercial', platforms: ['commercial', 'youtube'], description: 'Fusão curta entre planos de mesma paleta (continuidade de cor).', useCases: ['paleta da marca', 'continuidade'], duration: D(0.2, 0.35, 0.6), parameters: { intensity: 1 }, render: 'dissolve', align: 'in', level: 1, reference: 'color match cut' }),
  p({ id: 'branded-wipe', name: 'Branded wipe', category: 'commercial', platforms: ['commercial', 'youtube', 'reels'], description: 'Faixa na cor da marca varre a tela.', useCases: ['identidade visual', 'seção'], duration: D(0.35, 0.5, 0.8), parameters: { intensity: 0.7, shape: 'band', direction: 'right', color: '#4f8cff' }, render: 'mask', align: 'in', level: 2, reference: 'brand wipe' }),
  p({ id: 'cta-reveal', name: 'CTA reveal', category: 'commercial', platforms: ['commercial', 'reels', 'shorts', 'tiktok'], description: 'O plano final sobe de baixo para a chamada.', useCases: ['chamada para ação', 'oferta'], duration: D(0.35, 0.5, 0.8), parameters: { intensity: 0.6, shape: 'linear', direction: 'up' }, render: 'mask', align: 'in', level: 2, reference: 'reveal from bottom' }),

  // --- entrevistas e depoimentos -------------------------------------------------------------------
  p({ id: 'invisible-cut', name: 'Corte invisível', category: 'interview', platforms: ['interview', 'youtube'], description: 'Corte seco no respiro: ninguém percebe.', useCases: ['depoimento', 'entrevista'], duration: D(0, 0, 0), render: 'none', align: 'center', level: 1, reference: 'invisible edit' }),
  p({ id: 'punch-in', name: 'Punch-in', category: 'interview', platforms: ['interview', 'youtube', 'shorts', 'reels', 'tiktok'], description: 'Enquadramento mais fechado no trecho seguinte: disfarça o corte de salto.', useCases: ['corte de salto', 'ênfase'], duration: D(0, 0, 0), parameters: { intensity: 0.5, scale: 0.12 }, render: 'punch', align: 'hold', level: 1, reference: 'punch-in (digital zoom on jump cut)' }),
  p({ id: 'punch-out', name: 'Punch-out', category: 'interview', platforms: ['interview', 'youtube'], description: 'Começa fechado e abre suavemente para o plano normal.', useCases: ['respiro depois de ênfase'], duration: D(0.2, 0.4, 0.8), parameters: { intensity: 0.5, scale: 0.12, easing: 'smooth' }, render: 'zoom', align: 'in', level: 1, reference: 'punch-out' }),
  p({ id: 'clean-dissolve', name: 'Clean dissolve', category: 'interview', platforms: ['interview', 'youtube'], description: 'Fusão curta e limpa entre respostas.', useCases: ['troca de resposta', 'outro dia de gravação'], duration: D(0.2, 0.4, 0.8), parameters: { intensity: 1 }, render: 'dissolve', align: 'in', level: 1, reference: 'soft dissolve' }),
  p({ id: 'motivated-cut', name: 'Corte motivado', category: 'interview', platforms: ['interview', 'youtube', 'commercial'], description: 'Corte seco puxado por um olhar, gesto ou som.', useCases: ['reação', 'troca de câmera'], duration: D(0, 0, 0), render: 'none', align: 'center', level: 1, reference: 'motivated cut' }),
];

export const transitionById = (id: string) => TRANSITIONS.find((t) => t.id === id);

/** Ids antigos (antes da biblioteca) → preset atual. */
export const LEGACY_TRANSITION: Record<string, string> = {
  cut: 'clean-cut', fade: 'cross-dissolve', dissolve: 'cross-dissolve', 'dip-black': 'dip-black', zoom: 'zoom-clean',
  slide: 'push-slide', push: 'push-slide', blur: 'blur-transition', flash: 'flash-cut', whip: 'whip-transition',
};

export const presetFor = (type: string) => transitionById(type) ?? transitionById(LEGACY_TRANSITION[type] ?? '');

export const CATEGORY_LABEL: Record<TransitionCategory, string> = {
  clean: 'Clean e profissionais',
  social: 'Reels, TikTok e Shorts',
  youtube: 'YouTube',
  commercial: 'Comerciais',
  interview: 'Entrevistas e depoimentos',
};

export const LEVEL_LABEL = { 1: 'sutil', 2: 'médio', 3: 'forte' } as const;
