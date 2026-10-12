// Modelo de dados do projeto. Tudo aqui é serializável em JSON (salvar/abrir/autosave).
// Referências a arquivos de mídia ficam fora do projeto (MediaEngine + IndexedDB),
// porque o navegador não permite reabrir arquivos por caminho.

/**
 * Tipos de mídia. Previstos para fases futuras (sem suporte ainda):
 * 'effect' | 'transition' | 'motionTemplate'.
 */
export type AssetKind = 'video' | 'audio' | 'image' | 'svg' | 'font' | 'lut';

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  mimeType: string;
  size: number;
  lastModified: number;
  /** Segundos. Para imagens é 0 (duração livre na timeline). */
  duration: number;
  /** Dimensões de exibição (já com rotação aplicada). 0 para áudio. */
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  /** O navegador consegue decodificar o vídeo via WebCodecs (necessário para exportar). */
  videoDecodable: boolean;
  audioDecodable: boolean;
  /** Pasta no Media Bin (null = raiz). */
  folderId?: string | null;
  /**
   * Caminho do arquivo no PC (quando conhecido: app instalado, mídia gravada pelo editor).
   * Vai no projeto: ao reabrir, a mídia é relida direto do disco, sem pedir permissão.
   */
  localPath?: string;
  bitrate?: number;
  audioChannels?: number;
  sampleRate?: number;
  /** Fontes: nome da família registrada no navegador. */
  fontFamily?: string;
  /** LUT (.cube): pontos por eixo da tabela 3D. */
  lutSize?: number;
  /** Identidade do conteúdo (SHA-256 parcial): cache, relink e duplicatas. */
  hash?: string;
  metadata?: MediaMetadata;
  /** Dados de análise por IA (preenchidos em fases futuras). */
  ai?: AiMetadata;
}

/** Metadados técnicos extraídos na importação. */
export interface MediaMetadata {
  container?: string;
  videoCodecString?: string | null;
  audioCodecString?: string | null;
  videoBitrate?: number | null;
  audioBitrate?: number | null;
  rotation?: number;
  hdr?: boolean;
  colorSpace?: { primaries?: string | null; transfer?: string | null; matrix?: string | null; fullRange?: boolean | null } | null;
  /** Unidades por segundo dos timestamps (timebase) da trilha principal. */
  timebase?: number;
  /** fps medido pelos pacotes vs. declarado; "variable" quando muito diferentes. */
  frameRateMode?: 'constant' | 'variable';
  [key: string]: unknown;
}

/** Espaço reservado para a análise de IA por mídia (transcrição, cenas, rostos...). */
export interface AiMetadata {
  transcriptRef?: string;
  scenes?: { start: number; end: number }[];
  faces?: unknown[];
  objects?: unknown[];
  speakers?: unknown[];
  silences?: [number, number][];
  keywords?: string[];
  embeddingsRef?: string;
  qualityScore?: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface Marker {
  id: string;
  /** Tempo na timeline (s). */
  time: number;
  label: string;
  color: string;
}

/** Fonte de texto (sistema, importada ou da biblioteca: seleção embutida + Google Fonts). */
export interface FontInfo {
  id: string;
  family: string;
  style: string;
  weight: number;
  source: 'system' | 'imported' | 'library';
  assetId?: string;
}

export type TrackKind = 'video' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** Silencia o áudio dos clipes da trilha. */
  muted: boolean;
  /** Esconde a imagem dos clipes da trilha (só trilhas de vídeo). */
  hidden: boolean;
  locked: boolean;
}

/** Posição em fração do quadro (0 = centro), escala relativa ao "caber no quadro". */
export interface Transform {
  x: number;
  y: number;
  /** Escala uniforme (é a que os keyframes/zoom animam). */
  scale: number;
  /** Multiplicadores independentes (esticar). */
  scaleX: number;
  scaleY: number;
  rotation: number; // graus
  opacity: number; // 0..1
  /** Ponto de âncora em fração da camada (0.5, 0.5 = centro). */
  anchorX: number;
  anchorY: number;
}

/** Recorte em fração da imagem de origem, a partir de cada borda. */
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'darken' | 'lighten' | 'difference';

/** Palavra transcrita, em tempo da mídia de origem (s). */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  /** 0..1 quando o modelo informar. */
  confidence?: number;
  /** Legendas: palavra em destaque (cor de ênfase), marcada à mão ou pelo destaque automático. */
  emphasis?: boolean;
}

export interface Transcript {
  assetId: string;
  model: string;
  language: string;
  /** 'webgpu' ou 'wasm' */
  device?: string;
  /** Segundos gastos transcrevendo. */
  seconds?: number;
  createdAt: number;
  words: TranscriptWord[];
}

/** block: bloco inteiro · karaoke: destaca a palavra falada · word: uma palavra por vez · reveal: palavras aparecem conforme a fala. */
export type CaptionMode = 'block' | 'karaoke' | 'word' | 'reveal';
/** Entrada/saída do bloco de legenda. */
export type CaptionAnim = 'none' | 'fade' | 'pop' | 'slideUp' | 'slideDown' | 'zoom' | 'blur';
/** Animação da palavra falada (ou de cada palavra que aparece, no modo reveal). */
export type CaptionWordAnim = 'none' | 'pop' | 'bounce' | 'rise' | 'fade' | 'shake';

export interface CaptionStyle {
  preset: string;
  fontFamily: string;
  fontWeight: number;
  /** Tamanho da fonte em fração do lado menor do quadro. */
  fontSize: number;
  color: string;
  highlightColor: string;
  strokeColor: string;
  /** Em fração do tamanho da fonte. */
  strokeWidth: number;
  shadow: boolean;
  background: string | null;
  uppercase: boolean;
  /** Centro vertical da legenda, 0 (topo) a 1 (base). */
  y: number;
  mode: CaptionMode;
  /** Palavra atual cresce e volta (pop). Legado: `wordAnim` manda quando existe. */
  pop: boolean;
  // --- Fase 4 (opcionais: legendas antigas continuam iguais) ---
  /** Espaço entre letras, em fração do tamanho da fonte (0 = normal). */
  letterSpacing?: number;
  /** Altura da linha, em múltiplos do tamanho da fonte (padrão 1.18). */
  lineHeight?: number;
  /** Largura máxima da linha, em fração da largura do quadro (padrão 0.86). */
  maxWidth?: number;
  /** Cor da sombra (padrão preto 65%). */
  shadowColor?: string;
  /** Desfoque da sombra, em fração do tamanho da fonte (padrão 0.12). Com deslocamento 0 vira brilho. */
  shadowBlur?: number;
  /** Deslocamento vertical da sombra, em fração do tamanho da fonte (padrão 0.05). */
  shadowOffset?: number;
  /** Fundo do bloco: folga e cantos, em fração do tamanho da fonte (padrão 0.45 / 0.25). */
  backgroundPadding?: number;
  backgroundRadius?: number;
  /** Caixa colorida atrás da palavra falada (null = sem caixa). */
  highlightBg?: string | null;
  /** Cor das palavras em destaque (`emphasis`); padrão = cor de destaque. */
  emphasisColor?: string;
  /** Entrada e saída do bloco. */
  animIn?: CaptionAnim;
  animOut?: CaptionAnim;
  /** Duração da entrada/saída (s, padrão 0.18). */
  animDuration?: number;
  /** Animação da palavra; ausente = 'pop' se `pop`, senão 'none'. */
  wordAnim?: CaptionWordAnim;
}

/** Legenda: as palavras usam o tempo "de origem" do clipe (como uma mídia). */
export interface CaptionData {
  words: TranscriptWord[];
  style: CaptionStyle;
}

// --- Animação -----------------------------------------------------------------

export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
export type AnimProp = 'scale' | 'x' | 'y' | 'rotation' | 'opacity';

/** Keyframe no tempo "de origem" do clipe: continua preso ao conteúdo depois de cortes. */
export interface Keyframe {
  t: number;
  v: number;
  /** Curva do trecho que COMEÇA neste keyframe. */
  ease: Ease;
}

export type Keyframes = Partial<Record<AnimProp, Keyframe[]>>;

// --- Cor ----------------------------------------------------------------------

/** Correção de cor não destrutiva (aplicada por shader no preview e no export). */
export interface ColorSettings {
  preset: string;
  exposure: number; // EV, -2..2
  contrast: number; // -1..1
  highlights: number; // -1..1
  shadows: number; // -1..1
  saturation: number; // -1..1
  vibrance: number; // -1..1
  temperature: number; // -1 (frio) .. 1 (quente)
  tint: number; // -1 (verde) .. 1 (magenta)
  vignette: number; // 0..1
  /** Look criativo (Fase 7): id da LUT — asset importado (.cube) ou "look:<nome>" pronto. */
  lut?: string;
  /** Intensidade da LUT, 0..1 (padrão 1). */
  lutAmount?: number;
}

// --- Áudio --------------------------------------------------------------------

export interface AudioFx {
  preset: string;
  /** Ganho de normalização (dB), calculado do nível da fala. */
  gainDb: number;
  /** Corte de graves (Hz); 0 desliga. */
  highpass: number;
  /** Equalização em dB: graves (120 Hz), presença (3 kHz), brilho (10 kHz). */
  low: number;
  presence: number;
  air: number;
  compressor: boolean;
  /** Gate de ruído: limiar em dBFS; null desliga. */
  gateDb: number | null;
}

// --- Motion graphics ----------------------------------------------------------

export type TitleTemplate = 'title' | 'lowerThird' | 'callout' | 'cta';

export interface TitleData {
  template: TitleTemplate;
  text: string;
  subtitle: string;
  fontFamily: string;
  color: string;
  accent: string;
  /** Centro vertical (0 topo, 1 base). */
  y: number;
}

// --- Elementos (Fase 5): formas, texto e partículas em grupo -------------------------

export type ElementShape = 'rect' | 'ellipse' | 'line' | 'arrow' | 'star' | 'polygon' | 'text' | 'particles';
/** Entrada/saída de uma camada. "draw" desenha o contorno/traço progressivamente; "wipe" revela da esquerda. */
export type ElementAnim = 'none' | 'fade' | 'pop' | 'slideLeft' | 'slideRight' | 'slideUp' | 'slideDown' | 'draw' | 'wipe' | 'spin';
/** Movimento contínuo enquanto a camada está na tela. */
export type ElementLoop = 'none' | 'pulse' | 'rotate' | 'float' | 'blink' | 'wiggle';
export type ParticlePreset = 'confetti' | 'snow' | 'sparkles' | 'bubbles' | 'embers' | 'hearts';

export interface ParticleSpec {
  preset: ParticlePreset;
  /** Quantidade de partículas na tela. */
  count: number;
  colors: string[];
  /** Multiplicador de velocidade (1 = padrão do preset). */
  speed: number;
  /** Multiplicador de tamanho (1 = padrão do preset). */
  size: number;
  /** Semente: mesmo número = mesmo movimento (preview e export iguais). */
  seed: number;
}

/**
 * Camada de um elemento. Posição em fração do quadro (centro, 0..1); tamanho em fração do
 * lado menor do quadro (um quadrado de w = h = 0.2 é quadrado em qualquer formato).
 * Partículas ocupam a caixa x/y/w/h (w/h em fração da largura/altura do quadro).
 */
export interface ElementLayer {
  id: string;
  kind: ElementShape;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Graus. */
  rotation: number;
  /** w/h em fração da largura/altura do quadro (molduras e faixas que acompanham o formato). */
  frameUnits?: boolean;
  opacity: number;
  fill: string | null;
  /** Segunda cor do preenchimento: gradiente linear (esquerda → direita). */
  fill2?: string | null;
  stroke: string | null;
  /** Espessura do contorno em fração do lado menor do quadro. */
  strokeWidth: number;
  /** Cantos do retângulo, em fração do lado menor da forma (0..0.5). */
  radius?: number;
  /** Pontas da estrela / lados do polígono. */
  points?: number;
  /** Estrela: raio interno / externo. */
  innerRatio?: number;
  /** Sombra suave atrás da camada. */
  shadow?: boolean;
  // texto
  text?: string;
  fontFamily?: string;
  fontWeight?: number;
  // animação (s, relativos ao início do clipe)
  animIn?: ElementAnim;
  animOut?: ElementAnim;
  /** Atraso da entrada. */
  delay?: number;
  /** Duração da entrada/saída (padrão 0.4). */
  animDuration?: number;
  loop?: ElementLoop;
  /** Velocidade do loop (1 = padrão). */
  loopSpeed?: number;
  particles?: ParticleSpec;
}

/** Elemento = grupo de camadas desenhadas juntas; o clipe (transform + keyframes) move o grupo. */
export interface ElementData {
  /** Preset de origem (biblioteca de elementos). */
  preset: string;
  name: string;
  layers: ElementLayer[];
}

/**
 * Máscara de um clipe de vídeo/imagem, na área da própria imagem (acompanha posição e escala):
 * centro e tamanho em fração da imagem.
 */
export interface ClipMask {
  shape: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Cantos do retângulo, em fração do lado menor da máscara (0..0.5). */
  radius: number;
  /** Borda suave, em fração do lado menor da imagem. */
  feather: number;
  /** Mostra o lado de fora em vez do de dentro. */
  invert: boolean;
}

// --- Efeitos (Fase 6) ---------------------------------------------------------------------

export type EffectType =
  | 'blur' | 'glow' | 'bw' | 'sepia' | 'duotone' | 'invert' | 'hue' | 'pixelate' | 'rgbSplit' | 'glitch'
  | 'shake' | 'zoomPulse' | 'flip' | 'grain' | 'vhs' | 'vignette' | 'letterbox' | 'lightLeak' | 'flash' | 'look';

/** Um efeito da pilha de um clipe (ou de uma camada de efeito). */
export interface EffectSpec {
  id: string;
  type: EffectType;
  /** Intensidade 0..1. */
  amount: number;
  /** Desligado: fica na lista mas não desenha. */
  enabled?: boolean;
  /** Cores (duotone: sombras/luzes; light leak). */
  color?: string;
  color2?: string;
  /** Ritmo (tremor, pulso, flash, glitch): multiplicador; pulso/flash em batidas por minuto ÷ 60. */
  speed?: number;
  /** Look (LUT): id da LUT (asset .cube ou "look:<nome>"). */
  lut?: string;
}

/** assetId de clipes que não vêm de um arquivo (legendas, gráficos e elementos). */
export const NO_ASSET = '';

export interface Clip {
  id: string;
  /** NO_ASSET para legendas. */
  assetId: string;
  trackId: string;
  /** Posição na timeline (s). */
  start: number;
  /** Duração na timeline (s). */
  duration: number;
  /** Ponto de entrada na mídia de origem (s). */
  sourceIn: number;
  /** 0..1 */
  volume: number;
  /** Silencia só este clipe. */
  muted?: boolean;
  /** Velocidade (1 = normal). A mídia consumida é duration × speed. */
  speed: number;
  /** Fade de áudio (s). */
  fadeIn: number;
  fadeOut: number;
  transform: Transform;
  crop?: Crop;
  blendMode?: BlendMode;
  caption?: CaptionData;
  title?: TitleData;
  /** Elemento (formas, texto, partículas) — Fase 5. */
  element?: ElementData;
  /** Máscara (só clipes de vídeo/imagem). */
  mask?: ClipMask;
  /** Efeitos aplicados à imagem do clipe, na ordem (Fase 6). */
  effects?: EffectSpec[];
  /**
   * Camada de efeito: clipe sem mídia que aplica `effects` em tudo que está nas trilhas de baixo
   * durante o trecho. A opacidade (e seus keyframes) dosa a intensidade.
   */
  adjustment?: boolean;
  keyframes?: Keyframes;
  color?: ColorSettings;
  audio?: AudioFx;
  /** Quem criou o clipe e se ele está protegido ("não alterar"). Ausente = criado pelo usuário. */
  origin?: ClipOrigin;
  /** Transição de entrada (preset editável, aplicada no início do clipe). */
  transitionIn?: TransitionSpec;
}

/** Id de um preset da biblioteca de transições (video-editor/transitions/library.ts). */
export type TransitionType = string;

/**
 * Transição de entrada de um clipe (preset parametrizado). Não altera a mídia: o compositor
 * desenha no preview e no export a partir do clipe anterior da mesma faixa.
 */
export interface TransitionSpec {
  type: TransitionType;
  /** Segundos. */
  duration: number;
  /** 0..1 (padrão: o do preset). */
  intensity?: number;
  easing?: 'linear' | 'smooth' | 'snappy' | 'elastic';
  /** Desloca o centro da janela em relação ao corte (s) — p.ex. para cair na batida. */
  offset?: number;
  /** Parâmetros do preset sobrescritos (direção, cor, escala...). */
  params?: Record<string, number | string | boolean>;
  /** Quem escolheu: a IA nunca substitui uma transição escolhida pelo usuário. */
  by?: 'ai' | 'user';
}

/** Proveniência de um clipe: criado pela IA (skill/operação) ou protegido pelo usuário. */
export interface ClipOrigin {
  by: 'ai' | 'user';
  skill?: string;
  operationId?: string;
  confidence?: number;
  reason?: string;
  /** "Não alterar": a IA nunca move, apaga ou regenera este clipe. */
  locked?: boolean;
  /** Impressão do clipe no momento em que a IA o criou (para detectar edição manual). */
  stamp?: string;
}

export interface SequenceSettings {
  width: number;
  height: number;
  fps: number;
}

export const PROJECT_VERSION = 2;

export interface Project {
  version: 2;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: SequenceSettings;
  assets: Record<string, Asset>;
  /** Ordem de exibição: vídeos de cima para baixo (V2, V1), depois áudios (A1, A2). */
  tracks: Track[];
  clips: Record<string, Clip>;
  folders: Record<string, Folder>;
  markers: Marker[];
  metadata: Record<string, unknown>;
}

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 };
export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

export const SEQUENCE_PRESETS: { id: string; label: string; width: number; height: number }[] = [
  { id: '16:9', label: '16:9 · 1920×1080', width: 1920, height: 1080 },
  { id: '9:16', label: '9:16 · 1080×1920', width: 1080, height: 1920 },
  { id: '1:1', label: '1:1 · 1080×1080', width: 1080, height: 1080 },
  { id: '4:5', label: '4:5 · 1080×1350', width: 1080, height: 1350 },
];

/** Clipe desenhado pelo editor (legenda, título, elemento ou camada de efeito), sem arquivo de mídia. */
export const isGraphic = (c: Pick<Clip, 'caption' | 'title' | 'element' | 'adjustment'>) => !!(c.caption || c.title || c.element || c.adjustment);
