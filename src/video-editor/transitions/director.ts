// Diretor de montagem: decide, para cada corte, se há transição e qual. Regra central:
// uma transição só existe quando melhora o ritmo, a continuidade ou a compreensão do vídeo.
// Matriz: tipo de conteúdo → ritmo → movimento dos clipes → energia do áudio → plataforma.
// Função pura: recebe as características do corte e o estado da sequência, devolve a decisão.

import { transitionById } from './library';
import type { TransitionPreset } from './library';
import type { Direction } from './analysis';

export type EditFormat = 'youtube' | 'shorts' | 'commercial' | 'interview';

export type DecisionType =
  | 'corte-seco'
  | 'corte-por-acao'
  | 'match-cut'
  | 'movimento'
  | 'objeto'
  | 'mascara'
  | 'audio'
  | 'estilizada'
  | 'nenhuma';

export interface CutFeatures {
  /** Tempo do corte na timeline. */
  cut: number;
  aDuration: number;
  bDuration: number;
  /** Mesmo arquivo, trecho seguinte (corte de salto da fala). */
  jumpCut: boolean;
  /** Faixa: principal (fala) ou B-roll. */
  role: 'main' | 'broll';
  motionA: Direction;
  motionB: Direction;
  motionMatch: boolean;
  /** 0..1 (null = sem análise de imagem). */
  visualChange: number | null;
  colorA?: string;
  colorB?: string;
  /** Silêncio da fala logo antes do corte (s). */
  pauseBefore: number;
  /** O corte cai dentro de uma palavra. */
  cutInWord: boolean;
  /** Palavras importantes (> 4 letras) dentro de ±0,3 s do corte. */
  keyWordsNear: number;
  /** Batida da música mais próxima do corte (s, timeline), se a menos de 0,15 s. */
  beat: number | null;
  /** Energia do áudio no corte (0..1). */
  energy: number;
  /** Há legenda na tela no corte. */
  captions: boolean;
}

export interface DirectorState {
  lastTransitionAt: number;
  lastLevel: 0 | 1 | 2 | 3;
  jumpCuts: number;
  applied: number;
  analyzed: number;
  rotation: number;
}

export const newDirectorState = (): DirectorState => ({ lastTransitionAt: -Infinity, lastLevel: 0, jumpCuts: 0, applied: 0, analyzed: 0, rotation: 0 });

export interface Decision {
  type: DecisionType;
  presetId: string | null;
  duration: number;
  intensity: number;
  offset: number;
  direction?: 'left' | 'right' | 'up' | 'down';
  confidence: number;
  reason: string;
}

/** Ritmo e limites por formato. */
export const FORMAT_RULES: Record<EditFormat, { minSpacing: number; maxShare: number; intensity: number }> = {
  youtube: { minSpacing: 10, maxShare: 0.15, intensity: 0.4 },
  interview: { minSpacing: 15, maxShare: 0.1, intensity: 0.3 },
  shorts: { minSpacing: 1.2, maxShare: 0.4, intensity: 0.65 },
  commercial: { minSpacing: 2.5, maxShare: 0.3, intensity: 0.5 },
};

const SHORTS_SCENE = ['flash-cut', 'quick-blur', 'zoom-clean', 'rgb-split', 'snap'];
const SHORTS_IMPACT = ['impact-cut', 'shake-sync', 'beat-zoom'];
const COMMERCIAL_SCENE = ['light-sweep', 'product-reveal', 'push-slide', 'shape-mask', 'branded-wipe'];

const none = (type: DecisionType, reason: string, confidence = 0.8): Decision => ({ type, presetId: null, duration: 0, intensity: 0, offset: 0, confidence, reason });
const whipDir = (d: Direction): 'left' | 'right' | 'up' | 'down' => (d === 'right' ? 'right' : d === 'up' ? 'up' : d === 'down' ? 'down' : 'left');

/** Primeira escolha para o corte, antes das regras de ritmo da sequência. */
export function choose(f: CutFeatures, format: EditFormat, s: DirectorState): Decision {
  if (Math.min(f.aDuration, f.bDuration) < 0.4) return none('nenhuma', 'clipes curtos demais para transição', 0.9);
  if (f.cutInWord) return none('nenhuma', 'o corte cai dentro de uma palavra: um efeito só chamaria atenção para ele', 0.9);
  const pick = (id: string, type: DecisionType, confidence: number, reason: string, extra: Partial<Decision> = {}): Decision => {
    const p = transitionById(id)!;
    return { type, presetId: id, duration: p.duration.recommended, intensity: FORMAT_RULES[format].intensity, offset: 0, confidence, reason, ...extra };
  };
  const onBeat = f.beat !== null;
  const beatOffset = onBeat ? f.beat! - f.cut : 0;

  if (f.jumpCut) {
    s.jumpCuts++;
    const odd = s.jumpCuts % 2 === 1;
    if (format === 'shorts') {
      if (onBeat) return pick('beat-zoom', 'audio', 0.85, 'corte de salto na batida: zoom no tempo da música', { offset: beatOffset });
      return odd ? pick('punch-in', 'corte-por-acao', 0.74, 'corte de salto: punch-in esconde o pulo e dá ritmo') : none('corte-seco', 'corte de salto alternado: volta ao enquadramento aberto', 0.7);
    }
    if (format === 'commercial') return pick('seamless-cut', 'corte-seco', 0.68, 'corte de salto: micro-dissolve tira o pulo');
    return odd ? pick('punch-in', 'corte-por-acao', 0.78, 'corte de salto na mesma câmera: punch-in disfarça o pulo (corte invisível)', { intensity: 0.4 }) : none('corte-seco', 'corte de salto alternado: o plano aberto volta sem efeito', 0.75);
  }

  if (f.motionMatch) {
    const dir = whipDir(f.motionB);
    if (format === 'shorts') return pick('whip-transition', 'movimento', 0.82, `os dois planos andam para ${dirName(f.motionB)}: whip na mesma direção`, { direction: dir, offset: onBeat ? beatOffset : 0 });
    if (format === 'commercial') return pick('whip-pan-soft', 'movimento', 0.75, `movimento contínuo para ${dirName(f.motionB)}: whip suave`, { direction: dir });
    return none('movimento', `movimento contínuo para ${dirName(f.motionB)}: o corte por movimento já é invisível`, 0.85);
  }

  if (f.visualChange !== null && f.visualChange < 0.12) return none('match-cut', `planos parecidos (${f.colorA ?? 'cor'} → ${f.colorB ?? 'cor'}): match cut seco`, 0.8);

  const bigChange = f.visualChange === null || f.visualChange > 0.35;
  switch (format) {
    case 'youtube':
      if (!bigChange) return none('corte-seco', 'a mudança visual já funciona com corte seco', 0.75);
      if (f.role === 'broll') return pick('broll-bridge', 'corte-seco', 0.66, 'troca de B-roll: fusão curta evita o pulo');
      if (f.pauseBefore >= 1.5) return pick('chapter-transition', 'estilizada', 0.7, `${f.pauseBefore >= 5 ? 'sem fala no corte' : `pausa longa (${f.pauseBefore.toFixed(1)} s)`} e troca de cena: marca novo bloco`);
      if (f.pauseBefore >= 0.6) return pick('cross-dissolve', 'estilizada', 0.64, 'troca de ambiente numa pausa: dissolve discreto');
      return none('corte-seco', 'troca de cena no meio da fala: corte seco mantém o ritmo', 0.72);
    case 'interview':
      if (bigChange && f.pauseBefore >= 0.8) return pick('clean-dissolve', 'estilizada', 0.64, 'troca de resposta numa pausa: dissolve limpo');
      return none('corte-seco', 'depoimento: corte seco não distrai da fala', 0.8);
    case 'shorts': {
      if (onBeat) {
        const list = f.energy > 0.7 ? SHORTS_IMPACT : SHORTS_SCENE;
        const id = list[s.rotation++ % list.length];
        return pick(id, 'audio', 0.84, `corte na batida (energia ${Math.round(f.energy * 100)}%)`, { offset: beatOffset });
      }
      if (bigChange && f.energy > 0.5) {
        const id = SHORTS_SCENE[s.rotation++ % SHORTS_SCENE.length];
        return pick(id, 'estilizada', 0.62, 'troca de cena com energia alta');
      }
      return none('corte-seco', 'corte rápido sem batida: seco é mais forte', 0.7);
    }
    case 'commercial': {
      if (!bigChange) return none('corte-seco', 'mesma paleta: corte limpo', 0.75);
      const id = COMMERCIAL_SCENE[s.rotation++ % COMMERCIAL_SCENE.length];
      return pick(id, id.includes('mask') || id.includes('reveal') ? 'mascara' : 'estilizada', onBeat ? 0.75 : 0.64, onBeat ? 'troca de cena na batida, com acabamento de marca' : 'troca de cena: transição limpa de marca', { offset: beatOffset });
    }
  }
}

/** Decisão final: aplica as regras de ritmo da sequência e de qualidade (fala, legenda, densidade). */
export function decide(f: CutFeatures, format: EditFormat, s: DirectorState, totalCuts: number): Decision {
  s.analyzed++;
  let d = choose(f, format, s);
  if (!d.presetId) return d;
  const preset = transitionById(d.presetId)!;
  const rules = FORMAT_RULES[format];
  const hold = preset.align === 'hold';
  if (!hold) {
    if (f.cut - s.lastTransitionAt < rules.minSpacing) return none('corte-seco', 'transição recente: corte seco mantém o ritmo', 0.7);
    if (s.applied + 1 > Math.max(1, Math.ceil(totalCuts * rules.maxShare))) return none('corte-seco', 'limite de transições do formato atingido: o resto fica no corte seco', 0.7);
  }
  if (preset.level === 3 && s.lastLevel === 3) {
    const calmer = transitionById(format === 'shorts' ? 'quick-blur' : 'blur-transition')!;
    d = { ...d, presetId: calmer.id, duration: calmer.duration.recommended, reason: `${d.reason} · trocada por uma mais discreta (duas fortes seguidas cansam)`, confidence: d.confidence - 0.05 };
  }
  // fala importante sob o efeito
  if (f.keyWordsNear > 0 && !hold && preset.level >= 2) {
    if (format === 'interview') return none('nenhuma', 'a transição cobriria uma palavra importante do depoimento', 0.8);
    d = { ...d, intensity: d.intensity * 0.6, confidence: d.confidence - 0.1, reason: `${d.reason} · intensidade reduzida (palavra importante no corte)` };
  }
  if (f.captions && ['flash', 'light', 'dip', 'glitch', 'rgb'].includes(preset.render)) {
    d = { ...d, intensity: d.intensity * 0.6, reason: `${d.reason} · reduzida para não atrapalhar a legenda` };
  }
  // duração: recomendada do preset, cabendo nos dois clipes
  if (!hold) {
    const maxD = Math.min(preset.duration.max, f.bDuration / 2, preset.align === 'center' ? f.aDuration - 2 * Math.abs(d.offset) : f.bDuration / 2);
    const dur = Math.min(d.duration, maxD);
    if (dur < preset.duration.min) return none('nenhuma', 'não há espaço nos clipes para a duração mínima da transição', 0.75);
    d = { ...d, duration: +dur.toFixed(3), offset: Math.max(-dur / 2, Math.min(dur / 2, d.offset)) };
    s.lastTransitionAt = f.cut;
    s.applied++;
  }
  s.lastLevel = preset.level;
  return { ...d, intensity: +Math.max(0.05, Math.min(1, d.intensity)).toFixed(2), confidence: +Math.max(0.3, Math.min(0.95, d.confidence)).toFixed(2) };
}

/** Formato editorial do projeto (preset + tipo). */
export function formatFor(template: string | undefined, subtype: string | null | undefined, vertical: boolean): EditFormat {
  if (template === 'short-form') return subtype === 'venda' ? 'commercial' : 'shorts';
  if (template === 'youtube-long') return subtype === 'podcast' ? 'interview' : 'youtube';
  return vertical ? 'shorts' : 'youtube';
}

function dirName(d: Direction) {
  return d === 'left' ? 'a esquerda' : d === 'right' ? 'a direita' : d === 'up' ? 'cima' : d === 'down' ? 'baixo' : 'parado';
}

export type { TransitionPreset };
