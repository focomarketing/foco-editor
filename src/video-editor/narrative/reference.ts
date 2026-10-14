// Roteiro de referência (modo pela fala): o texto que a pessoa escreveu e gravou. Os títulos
// do roteiro (linhas em CAIXA ALTA) viram os blocos do vídeo, localizados na fala pela primeira
// frase de cada um; e cada frase da transcrição ganha a redação do roteiro, que corrige o que o
// Whisper ouviu errado ("Vem ser" → "Vencer", "Líverbítrio" → "livre-arbítrio").

import { normalizeWord } from '../../engine/analysis/cuts';
import { similarity } from '../../engine/cut/smartCut';
import type { Sentence } from '../skills/common';
import type { BriefSection, NarrativeBrief, SectionKind } from './brief';
import { plain } from './profiles';

export interface RefSection {
  /** Título como escrito no roteiro (caixa alta). */
  heading: string;
  /** Título para a tela (frase normal, nomes próprios com maiúscula). */
  title: string;
  kind: SectionKind;
  sentences: string[];
}

export interface RefScript {
  /** Título do vídeo (primeira linha em caixa alta antes de qualquer texto), se houver. */
  title: string;
  sections: RefSection[];
}

const toks = (text: string) =>
  plain(text)
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => normalizeWord(t).norm)
    .filter(Boolean);

/** Linha de título: tem letras e nenhuma minúscula (ex.: "ESTE MUNDO É PASSAGEM", "CTA"). */
const isHeading = (line: string) => /\p{L}/u.test(line) && !/\p{Ll}/u.test(line) && line.length <= 90;

const PROPER = ['Deus', 'Jesus', 'Cristo', 'Bíblia', 'Reino', 'Lázaro', 'Evangelhos', 'Espírito Santo', 'Senhor', 'Império Romano', 'Terra'];

/** "O MUNDO QUE DEUS CRIOU" → "O mundo que Deus criou". */
export function sentenceCase(heading: string): string {
  let s = heading.toLocaleLowerCase('pt-BR').trim();
  s = s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);
  for (const name of PROPER) s = s.replace(new RegExp(`(^|[^\\p{L}])${name.toLocaleLowerCase('pt-BR')}(?![\\p{L}])`, 'gu'), (_, pre: string) => pre + name);
  return s;
}

function kindOf(heading: string, first: boolean): SectionKind {
  const h = plain(heading);
  if (/^(cta|chamada|inscri)/.test(h)) return 'cta';
  if (/conclus|encerramento|fechamento/.test(h)) return 'conclusao';
  if (first || /^(introducao|abertura|gancho|intro)\b/.test(h)) return 'abertura';
  return 'bloco';
}

const splitSentences = (text: string) =>
  text
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.replace(/^[“"]|[”"]$/g, '').trim())
    .filter((s) => /\p{L}/u.test(s));

/** Lê o roteiro: título do vídeo, blocos pelos títulos em caixa alta e as frases de cada um. */
export function parseReference(text: string): RefScript {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out: RefScript = { title: '', sections: [] };
  let cur: RefSection | null = null;
  for (const line of lines) {
    if (isHeading(line)) {
      // a primeira linha em caixa alta antes de qualquer texto é o título do vídeo
      if (!out.title && !out.sections.length && !cur) {
        out.title = line;
        continue;
      }
      const kind = kindOf(line, !out.sections.length);
      cur = { heading: line, title: kind === 'cta' && /^cta$/i.test(line.trim()) ? 'Chamada' : sentenceCase(line), kind, sentences: [] };
      out.sections.push(cur);
      continue;
    }
    if (!cur) {
      cur = { heading: '', title: 'Abertura', kind: 'abertura', sentences: [] };
      out.sections.push(cur);
    }
    cur.sentences.push(...splitSentences(line));
  }
  return { ...out, sections: out.sections.filter((s) => s.sentences.length) };
}

export interface Alignment {
  /** Frase da fala onde cada bloco do roteiro começa (-1 se não achou). */
  starts: number[];
  /** Redação do roteiro para cada frase da fala (índice da fala → texto). */
  script: Map<number, string>;
}

const MIN_SIM = 0.5;

/**
 * Alinha roteiro e fala em ordem (a gravação segue o roteiro, com cortes e improvisos): cada
 * frase da fala procura a mais parecida entre as próximas do roteiro.
 */
export function alignReference(list: Sentence[], ref: RefScript): Alignment {
  // o título entra como primeira "frase" do bloco: muitas vezes ele é dito na gravação
  const flat = ref.sections.flatMap((sec, k) => [...(sec.heading && toks(sec.heading).length >= 3 ? [sec.title] : []), ...sec.sentences].map((text) => ({ text, section: k, toks: toks(text) })));
  const script = new Map<number, string>();
  const starts = ref.sections.map(() => -1);
  let j = 0;
  for (const s of list) {
    const st = toks(s.text);
    if (st.length < 2) continue;
    let best = -1;
    let bestSim = MIN_SIM;
    for (let k = j; k < Math.min(flat.length, j + 12); k++) {
      const sim = similarity(st, flat[k].toks);
      if (sim > bestSim) {
        bestSim = sim;
        best = k;
      }
    }
    if (best < 0) continue;
    script.set(s.index, flat[best].text);
    // o bloco começa na primeira frase da fala que casa com qualquer frase dele
    if (starts[flat[best].section] < 0) starts[flat[best].section] = s.index;
    j = best + 1;
  }
  return { starts, script };
}

/**
 * Aplica o roteiro ao mapa: blocos com os títulos do roteiro (quando a maioria foi achada na
 * fala), a frase que abre cada bloco vira "capítulo", os blocos de chamada viram CTA, e cada
 * frase guarda a redação do roteiro.
 */
export function applyReference(b: NarrativeBrief, ref: RefScript): NarrativeBrief {
  if (!ref.sections.length || !b.sentences.length) return b;
  const al = alignReference(b.sentences, ref);
  const sentences = b.sentences.map((s) => (al.script.has(s.index) ? { ...s, script: al.script.get(s.index) } : { ...s }));
  const found = ref.sections.map((sec, k) => ({ sec, at: al.starts[k] })).filter((x) => x.at >= 0);
  if (found.length < Math.max(2, ref.sections.length * 0.6)) return { ...b, sentences };
  // ordem crescente na fala; a abertura sempre na primeira frase
  const ordered = found.sort((x, y) => x.at - y.at).filter((x, i, arr) => i === 0 || x.at > arr[i - 1].at);
  if (ordered[0].at !== 0) ordered.unshift({ sec: { heading: '', title: 'Abertura', kind: 'abertura', sentences: [] }, at: 0 });
  else ordered[0] = { ...ordered[0], sec: { ...ordered[0].sec, kind: 'abertura' } };
  // a chamada final costuma vir dentro da conclusão do roteiro, sem título: mantém a das regras
  const outro = b.sections.at(-1);
  if (outro?.kind === 'cta' && outro.first > ordered[ordered.length - 1].at) ordered.push({ sec: { heading: '', title: 'Chamada final', kind: 'cta', sentences: [] }, at: outro.first });
  const sections: BriefSection[] = ordered.map((x, k) => {
    const next = ordered[k + 1]?.at ?? sentences.length;
    return { index: k, kind: x.sec.kind, title: x.sec.title, start: sentences[x.at].start, end: sentences[next - 1].end, first: x.at, scripted: true };
  });
  for (const sec of sections) {
    const last = sections[sec.index + 1]?.first ?? sentences.length;
    for (let i = sec.first; i < last; i++) {
      sentences[i].section = sec.index;
      if (sec.kind === 'cta') {
        sentences[i].role = 'cta';
        sentences[i].themes = [];
      } else if (sentences[i].role === 'cta' && !/inscrev|compartilh|link/.test(plain(sentences[i].text))) sentences[i].role = 'argument';
    }
    if (sec.kind === 'bloco' || sec.kind === 'conclusao') sentences[sec.first].role = 'chapter';
  }
  return { ...b, sentences, sections };
}

/** Hash curto (FNV-1a) do briefing + roteiro: mudou qualquer um, o mapa guardado não vale mais. */
export function inputsKey(...parts: (string | undefined)[]): string {
  let h = 0x811c9dc5;
  for (const ch of parts.map((p) => (p ?? '').trim()).join('\u0001')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
