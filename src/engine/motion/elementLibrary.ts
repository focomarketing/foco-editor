// Biblioteca de elementos prontos (Fase 5). Cada preset é um grupo de camadas editáveis;
// ao inserir, as camadas ganham ids próprios e tudo pode ser mudado no Inspector.

import type { ElementData, ElementLayer, ElementShape, ParticlePreset } from '../../core/types';
import { newId } from '../../core/time';
import { PARTICLE_PRESETS } from './elements';

export interface ElementPreset {
  id: string;
  label: string;
  category: string;
  /** Duração sugerida (s). */
  duration: number;
  layers: Omit<ElementLayer, 'id'>[];
}

export const ELEMENT_CATEGORIES = ['Destaques', 'Setas', 'Selos', 'Formas', 'Partículas', 'Molduras'] as const;

/** Camada com valores padrão (forma branca no centro, sem animação). */
export function layer(kind: ElementShape, p: Partial<Omit<ElementLayer, 'id' | 'kind'>> = {}): Omit<ElementLayer, 'id'> {
  return { kind, x: 0.5, y: 0.5, w: 0.2, h: 0.2, rotation: 0, opacity: 1, fill: '#ffffff', stroke: null, strokeWidth: 0, ...p };
}

const particles = (preset: ParticlePreset, count: number, p: Partial<Omit<ElementLayer, 'id' | 'kind'>> = {}) =>
  layer('particles', { x: 0.5, y: 0.5, w: 1, h: 1, fill: null, animIn: 'fade', animOut: 'fade', animDuration: 0.6, ...p, particles: { preset, count, colors: [...PARTICLE_PRESETS[preset].colors], speed: 1, size: 1, seed: 7 } });

export const ELEMENT_PRESETS: ElementPreset[] = [
  // Destaques
  { id: 'circulo', label: 'Círculo desenhado', category: 'Destaques', duration: 3, layers: [layer('ellipse', { w: 0.42, h: 0.26, rotation: -6, fill: null, stroke: '#ff3b3b', strokeWidth: 0.012, animIn: 'draw', animDuration: 0.6, animOut: 'fade' })] },
  { id: 'sublinhado', label: 'Sublinhado', category: 'Destaques', duration: 3, layers: [layer('line', { y: 0.62, w: 0.46, h: 0.02, fill: '#ffd400', strokeWidth: 0.014, animIn: 'draw', animDuration: 0.45, animOut: 'fade' })] },
  { id: 'marca-texto', label: 'Marca-texto', category: 'Destaques', duration: 3, layers: [layer('rect', { w: 0.5, h: 0.09, radius: 0.15, fill: 'rgba(255,212,0,0.55)', animIn: 'wipe', animDuration: 0.4, animOut: 'fade' })] },
  { id: 'foco-quadrado', label: 'Caixa de foco', category: 'Destaques', duration: 3, layers: [layer('rect', { w: 0.4, h: 0.3, radius: 0.08, fill: null, stroke: '#3dd5f3', strokeWidth: 0.008, animIn: 'draw', animDuration: 0.55, loop: 'pulse', animOut: 'fade' })] },
  { id: 'xis', label: 'Errado (X)', category: 'Destaques', duration: 2.5, layers: [
    layer('line', { w: 0.22, h: 0.02, rotation: 45, fill: '#ff3b3b', strokeWidth: 0.02, animIn: 'draw', animDuration: 0.25 }),
    layer('line', { w: 0.22, h: 0.02, rotation: -45, fill: '#ff3b3b', strokeWidth: 0.02, animIn: 'draw', animDuration: 0.25, delay: 0.2 }),
  ] },
  { id: 'certo', label: 'Certo (✓)', category: 'Destaques', duration: 2.5, layers: [
    layer('ellipse', { w: 0.24, h: 0.24, fill: '#22c55e', animIn: 'pop', animDuration: 0.35, shadow: true }),
    layer('text', { w: 0.16, h: 0.15, text: '✓', fill: '#ffffff', fontWeight: 900, animIn: 'pop', delay: 0.12, animDuration: 0.3 }),
  ] },

  // Setas
  { id: 'seta', label: 'Seta', category: 'Setas', duration: 3, layers: [layer('arrow', { w: 0.3, h: 0.08, rotation: 20, fill: '#ffffff', strokeWidth: 0.014, shadow: true, animIn: 'draw', animDuration: 0.45, loop: 'float', animOut: 'fade' })] },
  { id: 'seta-amarela', label: 'Seta apontando', category: 'Setas', duration: 3, layers: [layer('arrow', { x: 0.36, y: 0.62, w: 0.26, h: 0.08, rotation: -30, fill: '#ffd400', strokeWidth: 0.016, shadow: true, animIn: 'slideLeft', animDuration: 0.4, loop: 'wiggle', animOut: 'fade' })] },
  { id: 'seta-baixo', label: 'Olha aqui embaixo', category: 'Setas', duration: 3.5, layers: [
    layer('arrow', { y: 0.7, w: 0.16, h: 0.06, rotation: 90, fill: '#ffffff', strokeWidth: 0.014, shadow: true, animIn: 'slideDown', animDuration: 0.4, loop: 'float' }),
    layer('text', { y: 0.56, w: 0.5, h: 0.06, text: 'LINK NA DESCRIÇÃO', fill: '#ffffff', stroke: '#000000', strokeWidth: 0.006, fontWeight: 900, animIn: 'fade', animDuration: 0.4 }),
  ] },

  // Selos
  { id: 'selo-novo', label: 'Selo NOVO', category: 'Selos', duration: 3, layers: [
    layer('star', { x: 0.78, y: 0.24, w: 0.22, h: 0.22, points: 12, innerRatio: 0.82, fill: '#ff3b3b', shadow: true, animIn: 'spin', animDuration: 0.5, loop: 'pulse', animOut: 'pop' }),
    layer('text', { x: 0.78, y: 0.24, w: 0.15, h: 0.055, text: 'NOVO', fill: '#ffffff', fontWeight: 900, rotation: -12, animIn: 'spin', animDuration: 0.5, animOut: 'pop' }),
  ] },
  { id: 'selo-oferta', label: 'Oferta', category: 'Selos', duration: 3, layers: [
    layer('rect', { x: 0.8, y: 0.2, w: 0.26, h: 0.09, radius: 0.5, fill: '#ffd400', fill2: '#ff9500', rotation: 8, shadow: true, animIn: 'pop', animDuration: 0.4, loop: 'pulse', animOut: 'pop' }),
    layer('text', { x: 0.8, y: 0.2, w: 0.22, h: 0.05, text: '-50% HOJE', fill: '#1a1a1a', fontWeight: 900, rotation: 8, animIn: 'pop', animDuration: 0.4, animOut: 'pop' }),
  ] },
  { id: 'inscreva', label: 'Inscreva-se', category: 'Selos', duration: 4, layers: [
    layer('rect', { y: 0.82, w: 0.34, h: 0.085, radius: 0.5, fill: '#ff0033', shadow: true, animIn: 'slideUp', animDuration: 0.45, loop: 'pulse', animOut: 'slideDown' }),
    layer('text', { y: 0.82, w: 0.28, h: 0.045, text: 'INSCREVA-SE', fill: '#ffffff', fontWeight: 800, animIn: 'slideUp', animDuration: 0.45, animOut: 'slideDown' }),
  ] },
  { id: 'ao-vivo', label: 'AO VIVO', category: 'Selos', duration: 4, layers: [
    layer('rect', { x: 0.14, y: 0.1, w: 0.17, h: 0.06, radius: 0.2, fill: '#e11d2e', animIn: 'fade', animDuration: 0.3 }),
    layer('ellipse', { x: 0.087, y: 0.1, w: 0.018, h: 0.018, fill: '#ffffff', loop: 'blink', animIn: 'fade', animDuration: 0.3 }),
    layer('text', { x: 0.155, y: 0.1, w: 0.1, h: 0.032, text: 'AO VIVO', fill: '#ffffff', fontWeight: 800, animIn: 'fade', animDuration: 0.3 }),
  ] },

  // Formas
  { id: 'faixa', label: 'Faixa', category: 'Formas', duration: 3, layers: [layer('rect', { y: 0.82, w: 1, h: 0.14, frameUnits: true, fill: 'rgba(10,12,16,0.75)', animIn: 'wipe', animDuration: 0.5, animOut: 'fade' })] },
  { id: 'estrela', label: 'Estrela', category: 'Formas', duration: 3, layers: [layer('star', { w: 0.2, h: 0.2, fill: '#ffd400', fill2: '#ff9500', shadow: true, animIn: 'spin', animDuration: 0.5, loop: 'rotate', loopSpeed: 0.4, animOut: 'pop' })] },
  { id: 'bolinha', label: 'Ponto pulsante', category: 'Formas', duration: 3, layers: [
    layer('ellipse', { w: 0.08, h: 0.08, fill: 'rgba(79,140,255,0.35)', loop: 'pulse', loopSpeed: 1.5, animIn: 'pop' }),
    layer('ellipse', { w: 0.035, h: 0.035, fill: '#4f8cff', animIn: 'pop' }),
  ] },
  { id: 'hexagono', label: 'Hexágono', category: 'Formas', duration: 3, layers: [layer('polygon', { w: 0.22, h: 0.22, points: 6, fill: null, stroke: '#ffffff', strokeWidth: 0.008, animIn: 'draw', animDuration: 0.6, loop: 'rotate', loopSpeed: 0.3, animOut: 'fade' })] },

  // Partículas
  { id: 'confete', label: 'Confete', category: 'Partículas', duration: 4, layers: [particles('confetti', 80)] },
  { id: 'neve', label: 'Neve', category: 'Partículas', duration: 6, layers: [particles('snow', 90)] },
  { id: 'brilhos', label: 'Brilhos', category: 'Partículas', duration: 4, layers: [particles('sparkles', 40)] },
  { id: 'bolhas', label: 'Bolhas', category: 'Partículas', duration: 5, layers: [particles('bubbles', 35)] },
  { id: 'faiscas', label: 'Faíscas', category: 'Partículas', duration: 5, layers: [particles('embers', 70, { y: 0.75, h: 0.5 })] },
  { id: 'coracoes', label: 'Corações', category: 'Partículas', duration: 4, layers: [particles('hearts', 22, { x: 0.82, w: 0.3 })] },

  // Molduras
  { id: 'moldura', label: 'Moldura', category: 'Molduras', duration: 4, layers: [layer('rect', { w: 0.94, h: 0.9, frameUnits: true, fill: null, stroke: '#ffffff', strokeWidth: 0.012, radius: 0.04, animIn: 'draw', animDuration: 0.8, animOut: 'fade' })] },
  { id: 'rec', label: 'Gravando (REC)', category: 'Molduras', duration: 4, layers: [
    layer('rect', { w: 0.92, h: 0.86, frameUnits: true, fill: null, stroke: 'rgba(255,255,255,0.85)', strokeWidth: 0.004, radius: 0.03, animIn: 'fade', animDuration: 0.4 }),
    layer('ellipse', { x: 0.09, y: 0.13, w: 0.024, h: 0.024, fill: '#ff3b3b', loop: 'blink', animIn: 'fade', animDuration: 0.4 }),
    layer('text', { x: 0.14, y: 0.13, w: 0.08, h: 0.032, text: 'REC', fill: '#ffffff', fontWeight: 700, animIn: 'fade', animDuration: 0.4 }),
  ] },
];

export const getElementPreset = (id: string) => ELEMENT_PRESETS.find((p) => p.id === id);

/** Elemento novo a partir de um preset (camadas com ids próprios). */
export function elementFromPreset(p: ElementPreset): ElementData {
  return { preset: p.id, name: p.label, layers: p.layers.map((l) => ({ ...structuredClone(l), id: newId('l') })) };
}
