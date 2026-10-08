// Modelo de dados do projeto. Tudo aqui é serializável em JSON (salvar/abrir/autosave).
// Referências a arquivos de mídia ficam fora do projeto (MediaEngine + IndexedDB),
// porque o navegador não permite reabrir arquivos por caminho.

/**
 * Tipos de mídia. Previstos para fases futuras (sem suporte ainda):
 * 'lut' | 'effect' | 'transition' | 'motionTemplate' | 'captionPreset'.
 */
export type AssetKind = 'video' | 'audio' | 'image' | 'svg' | 'font';

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
  bitrate?: number;
  audioChannels?: number;
  sampleRate?: number;
  /** Fontes: nome da família registrada no navegador. */
  fontFamily?: string;
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

/** Fonte de texto (sistema, importada ou da biblioteca — esta última numa fase futura). */
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

export type CaptionMode = 'block' | 'karaoke' | 'word';

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
  /** Palavra atual cresce e volta (pop). */
  pop: boolean;
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

/** assetId de clipes que não vêm de um arquivo (legendas). */
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
