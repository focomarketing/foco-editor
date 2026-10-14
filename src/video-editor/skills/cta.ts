// Chamadas para o canal na tela, pela transcrição: quando a pessoa fala "se inscreve",
// "compartilha", "ativa o sininho", "comenta" ou "link na descrição", entra a peça certa (botão
// animado, com cursor clicando no de inscrição) na palavra exata, acima da legenda. O som de cada
// peça entra na etapa de trilha e efeitos.

import type { ElementData } from '../../core/types';
import { newId } from '../../core/time';
import { layer } from '../../engine/motion/elementLibrary';

export type CtaKind = 'inscricao' | 'compartilhar' | 'sininho' | 'comentar' | 'link';

export interface CtaCue {
  kind: CtaKind;
  /** Início da palavra que chama (s, timeline). */
  at: number;
  word: string;
}

const norm = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}]/gu, '');

/** Palavras da fala que pedem chamada na tela (uma por tipo a cada 20 s). */
export function ctaCues(words: { text: string; start: number }[]): CtaCue[] {
  const out: CtaCue[] = [];
  const add = (kind: CtaKind, at: number, word: string) => {
    if (out.some((c) => c.kind === kind && Math.abs(c.at - at) < 20)) return;
    if (out.some((c) => Math.abs(c.at - at) < 2.5)) return; // uma peça por vez
    out.push({ kind, at, word });
  };
  words.forEach((w, i) => {
    const t = norm(w.text);
    const near = words.slice(i + 1, i + 4).map((x) => norm(x.text));
    if (/^inscrev/.test(t)) add('inscricao', w.start, w.text);
    else if (/^compartilh/.test(t)) add('compartilhar', w.start, w.text);
    else if (/^(sininho|notificac)/.test(t)) add('sininho', w.start, w.text);
    else if (/^(comenta|comente|comentem)$/.test(t)) add('comentar', w.start, w.text);
    else if (t === 'link' && near.some((x) => /^descri/.test(x))) add('link', w.start, w.text);
  });
  return out.sort((a, b) => a.at - b.at);
}

const withIds = (name: string, preset: string, layers: ReturnType<typeof layer>[]): ElementData => ({ preset, name, layers: layers.map((l) => ({ ...l, id: newId('l') })) });

export interface CtaLook {
  style: 'elegante' | 'youtube';
  /** Espaço livre ao lado do rosto (o botão fica ali, nunca em cima da pessoa). */
  zone?: { cx: number; cy: number; width: number; side: string };
}

/** Botão em pílula: discreto (claro, texto escuro, entra devagar) ou estilo YouTube (cor forte, cursor clicando). */
function pill(text: string, fill: string, fill2: string, cursor: boolean, look: CtaLook) {
  const z = look.zone ?? { cx: 0.5, cy: 0.5, width: 0.4, side: 'below' };
  const x = z.cx;
  const y = z.side === 'below' ? Math.min(0.7, z.cy) : Math.min(0.72, z.cy + 0.16);
  const w = Math.min(0.3, Math.max(0.2, z.width * 0.8));
  if (look.style === 'elegante')
    return [
      layer('rect', { x, y, w, h: 0.075, radius: 0.5, fill: 'rgba(247,242,232,0.94)', shadow: true, animIn: 'slideUp', animDuration: 0.5, animOut: 'fade' }),
      layer('text', { x, y, w: w - 0.04, h: 0.034, text, fill: '#1d1b17', fontWeight: 700, animIn: 'slideUp', animDuration: 0.5, animOut: 'fade' }),
    ];
  return [
    layer('rect', { x, y, w, h: 0.085, radius: 0.5, fill, fill2, shadow: true, animIn: 'pop', animDuration: 0.4, loop: 'pulse', animOut: 'pop' }),
    layer('text', { x, y, w: w - 0.04, h: 0.042, text, fill: '#ffffff', fontWeight: 800, animIn: 'pop', animDuration: 0.4, animOut: 'pop' }),
    ...(cursor ? [layer('arrow', { x: x + w * 0.35, y: y + 0.07, w: 0.08, h: 0.05, rotation: -135, fill: '#ffffff', stroke: '#111111', strokeWidth: 0.004, shadow: true, animIn: 'slideUp', animDuration: 0.6, loop: 'float', animOut: 'fade' })] : []),
  ];
}

export function ctaElement(kind: CtaKind, look: CtaLook = { style: 'youtube' }): ElementData {
  const yt = look.style === 'youtube';
  switch (kind) {
    case 'inscricao':
      return withIds('Inscreva-se', 'cta-inscreva', pill(yt ? 'INSCREVA-SE' : 'Inscreva-se no canal', '#ff0033', '#d1002a', yt, look));
    case 'compartilhar':
      return withIds('Compartilhe', 'cta-compartilhe', pill(yt ? 'COMPARTILHE' : 'Compartilhe com alguém', '#1e88e5', '#1565c0', false, look));
    case 'sininho':
      return withIds('Ative o sininho', 'cta-sininho', pill(yt ? 'ATIVE O SININHO' : 'Ative as notificações', '#ffb300', '#ff8f00', false, look));
    case 'comentar':
      return withIds('Comente', 'cta-comente', pill(yt ? 'COMENTE AQUI' : 'Deixe seu comentário', '#7c4dff', '#5e35b1', false, look));
    case 'link':
      return withIds('Link na descrição', 'cta-link', [
        layer('arrow', { y: 0.72, w: 0.14, h: 0.06, rotation: 90, fill: '#ffffff', strokeWidth: 0.014, shadow: true, animIn: 'slideDown', animDuration: 0.4, loop: yt ? 'float' : undefined, animOut: 'fade' }),
        layer('text', { y: 0.6, w: 0.5, h: 0.055, text: yt ? 'LINK NA DESCRIÇÃO' : 'Link na descrição', fill: '#ffffff', stroke: yt ? '#000000' : null, strokeWidth: yt ? 0.006 : 0, fontWeight: yt ? 900 : 600, shadow: !yt, animIn: 'fade', animDuration: 0.4, animOut: 'fade' }),
      ]);
  }
}

export const CTA_DURATION = 3.5;
