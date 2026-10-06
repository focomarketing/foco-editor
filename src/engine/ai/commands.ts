// Linguagem de comandos do AI Editor.
// Fluxo: pedido do usuário -> LLM (interpretador) -> comandos (JSON neste schema) ->
// VALIDADOR (abaixo) -> executor -> timeline. O LLM nunca altera o estado diretamente.

import type { TitleTemplate } from '../../core/types';
import type { CutLevel } from '../analysis/cuts';
import type { ZoomIntensity } from '../analysis/zoom';
import { CAPTION_PRESETS } from '../captions/captions';
import { COLOR_PRESETS } from '../color/color';
import { AUDIO_PRESETS } from '../audio/audioFx';

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

export type AICommand =
  | { type: 'remove_silences'; level: CutLevel }
  | { type: 'remove_mistakes'; level: CutLevel }
  | { type: 'generate_captions'; preset: string }
  | { type: 'enhance_audio'; preset: string }
  | { type: 'auto_color' }
  | { type: 'color_preset'; preset: string }
  | { type: 'smart_zoom'; intensity: ZoomIntensity }
  | { type: 'add_title'; template: TitleTemplate; text: string; subtitle: string; at: number; duration: number }
  | { type: 'set_format'; aspect: AspectRatio };

const LEVELS = ['safe', 'balanced', 'aggressive'] as const;
const INTENSITIES = ['subtle', 'normal', 'strong'] as const;
const TEMPLATES = ['title', 'lowerThird', 'callout', 'cta'] as const;
const ASPECTS = ['16:9', '9:16', '1:1', '4:5'] as const;
const CAPTION_IDS = CAPTION_PRESETS.map((p) => p.id);
const COLOR_IDS = COLOR_PRESETS.map((p) => p.id);
const AUDIO_IDS = AUDIO_PRESETS.map((p) => p.id);

// --- schema de saída (o mesmo para Claude e Ollama) ----------------------------

const obj = (type: string, props: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: ['type', ...Object.keys(props)],
  properties: { type: { type: 'string', const: type }, ...props },
});

export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'commands'],
  properties: {
    reply: { type: 'string', description: 'Resposta curta em português para o usuário: o que será feito, ou por que não é possível.' },
    commands: {
      type: 'array',
      items: {
        anyOf: [
          obj('remove_silences', { level: { type: 'string', enum: LEVELS } }),
          obj('remove_mistakes', { level: { type: 'string', enum: LEVELS } }),
          obj('generate_captions', { preset: { type: 'string', enum: CAPTION_IDS } }),
          obj('enhance_audio', { preset: { type: 'string', enum: AUDIO_IDS } }),
          obj('auto_color', {}),
          obj('color_preset', { preset: { type: 'string', enum: COLOR_IDS } }),
          obj('smart_zoom', { intensity: { type: 'string', enum: INTENSITIES } }),
          obj('add_title', {
            template: { type: 'string', enum: TEMPLATES },
            text: { type: 'string' },
            subtitle: { type: 'string' },
            at: { type: 'number', description: 'segundos na timeline' },
            duration: { type: 'number', description: 'segundos' },
          }),
          obj('set_format', { aspect: { type: 'string', enum: ASPECTS } }),
        ],
      },
    },
  },
} as const;

export const COMMAND_DOCS = `Comandos disponíveis (use só estes):
- remove_silences {level}: corta pausas. level: safe (só pausas longas), balanced, aggressive (ritmo rápido de redes sociais).
- remove_mistakes {level}: corta vícios ("ééé", "hum"), gagueira, frases repetidas/começos falsos e hesitações. Requer transcrição (é feita automaticamente).
- generate_captions {preset}: legendas palavra por palavra. presets: ${CAPTION_IDS.join(', ')}.
- enhance_audio {preset}: limpa e normaliza a voz. presets: ${AUDIO_IDS.join(', ')}.
- auto_color {}: correção automática de exposição, balanço de branco e contraste a partir dos quadros.
- color_preset {preset}: estilo de cor. presets: ${COLOR_IDS.join(', ')}.
- smart_zoom {intensity}: zooms suaves nas frases importantes. intensity: subtle, normal, strong.
- add_title {template, text, subtitle, at, duration}: gráfico animado. templates: title (título central), lowerThird (nome/cargo no canto), callout (destaque curto), cta (chamada para ação). "at" em segundos da timeline atual. subtitle pode ser "".
- set_format {aspect}: formato do quadro: 16:9, 9:16, 1:1, 4:5.`;

// --- validador ---------------------------------------------------------------------

export interface ValidationContext {
  duration: number;
}

export interface ValidationResult {
  commands: AICommand[];
  errors: string[];
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const inSet = <T extends string>(v: unknown, set: readonly T[]): v is T => isStr(v) && (set as readonly string[]).includes(v);
/** Campo ausente recebe o padrão; campo presente com valor inválido é rejeitado. */
const orDefault = <T extends string>(v: unknown, set: readonly T[], def: T): T | null => (v === undefined || v === null || v === '' ? def : inSet(v, set) ? v : null);
/** Textos como "palavra_principal" ou "<texto>" são marcadores, não conteúdo. */
const looksLikePlaceholder = (t: string) => (/_/.test(t) && !/\s/.test(t)) || /^[<[{].*[>\]}]$/.test(t);

/** Confere cada comando campo a campo; comandos inválidos são descartados com motivo. */
export function validateCommands(raw: unknown, ctx: ValidationContext): ValidationResult {
  const commands: AICommand[] = [];
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { commands, errors: ['a resposta não trouxe uma lista de comandos'] };
  for (const [i, c] of raw.entries()) {
    const bad = (why: string) => errors.push(`comando ${i + 1} (${(c as { type?: unknown })?.type ?? '?'}): ${why}`);
    if (!c || typeof c !== 'object') {
      bad('formato inválido');
      continue;
    }
    const o = c as Record<string, unknown>;
    switch (o.type) {
      case 'remove_silences':
      case 'remove_mistakes': {
        const level = orDefault(o.level, LEVELS, 'balanced');
        if (!level) bad('nível inválido');
        else commands.push({ type: o.type, level });
        break;
      }
      case 'generate_captions': {
        const preset = orDefault(o.preset, CAPTION_IDS, 'podcast');
        if (!preset) bad('estilo de legenda inexistente');
        else commands.push({ type: 'generate_captions', preset });
        break;
      }
      case 'enhance_audio': {
        const preset = orDefault(o.preset, AUDIO_IDS, 'voice');
        if (!preset) bad('preset de áudio inexistente');
        else commands.push({ type: 'enhance_audio', preset });
        break;
      }
      case 'auto_color':
        commands.push({ type: 'auto_color' });
        break;
      case 'color_preset':
        if (!inSet(o.preset, COLOR_IDS)) bad('preset de cor inexistente');
        else commands.push({ type: 'color_preset', preset: o.preset });
        break;
      case 'smart_zoom': {
        const intensity = orDefault(o.intensity, INTENSITIES, 'normal');
        if (!intensity) bad('intensidade inválida');
        else commands.push({ type: 'smart_zoom', intensity });
        break;
      }
      case 'add_title': {
        const text = isStr(o.text) ? o.text.trim() : '';
        const template = orDefault(o.template, TEMPLATES, 'title');
        if (!template) bad('template inexistente');
        else if (!text || text.length > 120) bad('texto vazio ou longo demais');
        else if (looksLikePlaceholder(text)) bad(`"${text}" parece um marcador, não um texto real`);
        else if (typeof o.at !== 'number' || !Number.isFinite(o.at)) bad('tempo inválido');
        else {
          const duration = typeof o.duration === 'number' && Number.isFinite(o.duration) ? Math.min(15, Math.max(0.8, o.duration)) : 3;
          const at = Math.min(Math.max(0, o.at), Math.max(0, ctx.duration - 0.5));
          commands.push({ type: 'add_title', template, text, subtitle: isStr(o.subtitle) ? o.subtitle.trim().slice(0, 120) : '', at, duration });
        }
        break;
      }
      case 'set_format':
        if (!inSet(o.aspect, ASPECTS)) bad('formato inválido');
        else commands.push({ type: 'set_format', aspect: o.aspect });
        break;
      default:
        bad('comando desconhecido');
    }
  }
  return { commands, errors };
}

/** Rótulo legível do comando (para a lista de ações da IA). */
export function describeCommand(c: AICommand): string {
  switch (c.type) {
    case 'remove_silences':
      return `Remover pausas (${levelLabel(c.level)})`;
    case 'remove_mistakes':
      return `Remover erros de fala (${levelLabel(c.level)})`;
    case 'generate_captions':
      return `Legendas estilo ${CAPTION_PRESETS.find((p) => p.id === c.preset)?.label}`;
    case 'enhance_audio':
      return `Melhorar áudio (${AUDIO_PRESETS.find((p) => p.id === c.preset)?.label})`;
    case 'auto_color':
      return 'Correção de cor automática';
    case 'color_preset':
      return `Cor: ${COLOR_PRESETS.find((p) => p.id === c.preset)?.label}`;
    case 'smart_zoom':
      return `Smart zoom (${{ subtle: 'sutil', normal: 'normal', strong: 'forte' }[c.intensity]})`;
    case 'add_title':
      return `Gráfico "${c.text}" em ${c.at.toFixed(1)} s`;
    case 'set_format':
      return `Formato ${c.aspect}`;
  }
}

const levelLabel = (l: CutLevel) => ({ safe: 'seguro', balanced: 'equilibrado', aggressive: 'agressivo' })[l];
