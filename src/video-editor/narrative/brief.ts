// editorial-director: lê o vídeo inteiro uma vez e entrega o mapa narrativo que orienta todas
// as skills — pergunta central, tese, blocos, papel de cada frase (gancho, pergunta, tese,
// capítulo, argumento, clímax, chamada para ação), temas visuais e repetições intencionais.
//
// Com IA: o diretor (LLM) monta o mapa; o resultado é validado e guardado no projeto pelo
// TEXTO das frases (sobrevive aos cortes, que mudam os tempos). Sem IA: regras de linguagem
// (marcadores de bloco, chamadas para ação, anáforas, frases de tese) + temas do perfil.

import { askJson } from '../../engine/ai/providers';
import type { AISettings } from '../../engine/ai/providers';
import { normalizeWord } from '../../engine/analysis/cuts';
import { isParallel as parallelTokens } from '../../engine/cut/smartCut';
import { sentences } from '../skills/common';
import type { Sentence } from '../skills/common';
import { plain, themesOf } from './profiles';
import { applyReference, inputsKey, parseReference } from './reference';
import type { BeatRole, EditorialProfile } from './profiles';

export type SectionKind = 'abertura' | 'bloco' | 'conclusao' | 'cta';

export interface BriefSentence extends Sentence {
  role: BeatRole;
  /** Índice do bloco (em `sections`). */
  section: number;
  /** Temas visuais do perfil que a frase toca. */
  themes: string[];
  /** O que a imagem deveria mostrar e a busca (diretor de IA). */
  visual?: string;
  query?: string;
  /** A mesma frase como está no roteiro de referência (corrige erros da transcrição). */
  script?: string;
}

export interface BriefSection {
  index: number;
  kind: SectionKind;
  title: string;
  start: number;
  end: number;
  /** Índice da frase que abre o bloco. */
  first: number;
  /** Título tirado do roteiro de referência. */
  scripted?: boolean;
}

export interface NarrativeBrief {
  by: 'llm' | 'heuristic';
  profile: string;
  summary: string;
  centralQuestion: string;
  thesis: string;
  tone: string;
  sentences: BriefSentence[];
  sections: BriefSection[];
  /** Repetições intencionais (anáfora, enumeração, paralelismo): o corte não mexe nelas. */
  rhetoric: { start: number; end: number; why: string }[];
  /** Briefing da pessoa (tom, público, objetivo), quando houver. */
  briefing?: string;
}

/** O que fica guardado no projeto (metadata.narrative): preso ao texto, não ao tempo. */
export interface StoredNarrative {
  version: 1;
  by: 'llm';
  profile: string;
  summary: string;
  centralQuestion: string;
  thesis: string;
  tone: string;
  /** Chave de cada frase analisada (para saber se o texto ainda é o mesmo). */
  keys: string[];
  beats: Record<string, { role: BeatRole; visual?: string; query?: string }>;
  sections: { key: string; kind: SectionKind; title: string }[];
  rhetoric: { keys: string[]; why: string }[];
  /** Hash do briefing + roteiro usados (mudou, refaz o mapa). */
  inputs?: string;
}

/** Briefing e roteiro de referência da pessoa (workflow do projeto). */
export interface BriefInputs {
  briefing?: string;
  reference?: string;
}

/** Chave das entradas: vazia quando não há briefing nem roteiro. */
export const keyOf = (i: BriefInputs = {}) => (i.briefing?.trim() || i.reference?.trim() ? inputsKey(i.briefing, i.reference) : '');

/** Aplica o roteiro (se houver) e anexa o briefing ao mapa. */
function withInputs(b: NarrativeBrief, i: BriefInputs = {}): NarrativeBrief {
  const ref = i.reference?.trim() ? parseReference(i.reference) : null;
  const out = ref ? applyReference(b, ref) : b;
  return i.briefing?.trim() ? { ...out, briefing: i.briefing.trim() } : out;
}

type Words = { text: string; start: number; end: number }[];

export const sentenceKey = (text: string) => plain(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const toks = (text: string) =>
  plain(text)
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => normalizeWord(t).norm)
    .filter(Boolean);

// --- regras de linguagem ---------------------------------------------------------------

const CTA = /\b(se inscrev\w*|inscreva\w*|inscreve\w*|link (na|da) descricao|compartilh\w* (esse|este|o) video|deixa (o |seu |um )?like|ativa o sininho|comenta (aqui|ai)|ate o proximo video)\b/;
/** Abre um bloco novo ("vamos começar", "e aqui chegamos", "então por que..."). */
const SECTION_MARKER = /^(e |mas |agora )?(entao )?(vamos (comecar|la|ver|entender)|e aqui chegamos|aqui chegamos|agora (entao )?(podemos|vamos)|entao eu volto|eu volto a pergunta|isso muda a pergunta|entao por ?que|primeiro,|segundo,|terceiro,|por fim|em resumo|para concluir|concluindo|para fechar)/;
/** Transição pura: o título do bloco é a frase seguinte. */
const PURE_TRANSITION = /^(e |mas |agora )?(entao )?vamos (comecar|la)\b/;
const CONCLUSION = /^(e |mas |agora )?(entao )?(eu volto|em resumo|para concluir|concluindo|para fechar)/;
const SCRIPTURE = /\b(genesis|exodo|levitico|salmos?|proverbios|eclesiastes|isaias|jeremias|daniel|mateus|marcos|lucas|joao|atos|romanos|corintios|galatas|efesios|filipenses|colossenses|hebreus|tiago|pedro|apocalipse)\s+\d+/;
const CONNECTIVE_START = /^(e|mas|porque|por|entao|que|ou|se|nos|eu|ele|ela|eles|isso|essa|esse|isto|aquilo|ai|tipo|so|ja|nao)\b/;
const COPULA = /\b(e|nao e|sao|sera|serao|era|foi)\b/;

/** Frase de passagem ("E isso muda a pergunta.", "Agora podemos voltar..."): abre bloco, não é o tema dele. */
const META = /^(e |mas |agora )?(entao )?(vamos|e aqui chegamos|aqui chegamos|agora (entao )?(podemos|vamos)|podemos voltar|entao eu volto|eu volto|e isso muda|isso muda)/;
export const isMetaTransition = (text: string) => META.test(plain(text).trim());

/** Frase curta, afirmativa, com cópula e sem conectivo no começo: tese ("Este mundo é passagem."). */
export function looksLikeThesis(text: string): boolean {
  const s = plain(text).trim();
  const n = toks(text).length;
  return n >= 3 && n <= 9 && /\.$/.test(s) && !CONNECTIVE_START.test(s) && COPULA.test(s);
}

/**
 * Paralelismo intencional entre duas frases completas: começam igual e cada uma tem palavras
 * de conteúdo próprias ("Não significa que uma mãe..." / "Não significa que devemos...").
 */
export function isParallel(a: string, b: string): boolean {
  const ta = toks(a);
  const tb = toks(b);
  const head = Math.min(2, ta.length, tb.length);
  return head >= 2 && ta.slice(0, head).join(' ') === tb.slice(0, head).join(' ') && parallelTokens(ta, tb, /[.!?…]$/.test(a.trim()), /[.!?…]$/.test(b.trim()));
}

/** Repetições intencionais: frases vizinhas em paralelo (anáfora, enumeração). */
export function rhetoricRuns(list: Sentence[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let i = 0;
  while (i < list.length - 1) {
    let j = i;
    while (j + 1 < list.length && isParallel(list[j].text, list[j + 1].text)) j++;
    if (j > i) out.push({ from: i, to: j });
    i = j + 1;
  }
  return out;
}

/** Mapa narrativo por regras (sem IA). */
export function heuristicBrief(words: Words, profile: EditorialProfile): NarrativeBrief {
  const list = sentences(words);
  const duration = words.length ? words[words.length - 1].end : 0;
  const roles: BeatRole[] = list.map(() => 'argument');
  const opensSection = new Set<number>([0]);
  const kindAt = new Map<number, SectionKind>([[0, 'abertura']]);
  const p = list.map((s) => plain(s.text).trim());
  const marker = p.map((x, i) => i > 0 && SECTION_MARKER.test(x));
  const cta = p.map((x) => CTA.test(x));
  // a apresentação do canal entre a chamada e o "vamos começar" é parte da chamada
  cta.forEach((on, i) => {
    if (!on) return;
    for (let k = 1; k <= 3 && i + k < list.length; k++) {
      if (cta[i + k]) break;
      if (marker[i + k]) {
        for (let j = i + 1; j < i + k; j++) cta[j] = true;
        break;
      }
    }
  });
  // perto do fim, a chamada leva o resto do vídeo junto (agradecimento, despedida)
  const outroFrom = list.findIndex((s, i) => cta[i] && s.start > duration * 0.85);
  if (outroFrom >= 0) for (let i = outroFrom; i < list.length; i++) cta[i] = true;

  list.forEach((s, i) => {
    if (cta[i]) {
      roles[i] = 'cta';
      if (i > 0 && !cta[i - 1]) {
        opensSection.add(i);
        kindAt.set(i, 'cta');
      }
      return;
    }
    if (marker[i] || (i > 0 && cta[i - 1])) {
      opensSection.add(i);
      kindAt.set(i, CONCLUSION.test(p[i]) ? 'conclusao' : 'bloco');
    }
    if (SCRIPTURE.test(p[i])) roles[i] = 'scripture';
    else if (/\?\s*$/.test(s.text)) roles[i] = 'question';
    else if (looksLikeThesis(s.text)) roles[i] = 'thesis';
  });

  // gancho: da primeira frase até o primeiro bloco/chamada (no máximo ~20% do vídeo)
  const firstBreak = Math.min(...[...opensSection].filter((x) => x > 0), list.length);
  let centralQuestion = '';
  for (let i = 0; i < firstBreak && list[i].start < Math.max(30, duration * 0.2); i++) {
    if (roles[i] === 'question' && !centralQuestion) centralQuestion = list[i].text;
    if (roles[i] === 'argument') roles[i] = 'hook';
  }

  // título do bloco: a frase que abre (ou a seguinte, se a que abre é só "vamos começar")
  const starts = [...opensSection].sort((a, b) => a - b);
  const sections: BriefSection[] = starts.map((first, k) => {
    const next = starts[k + 1] ?? list.length;
    const kind = kindAt.get(first) ?? 'bloco';
    const titleAt = PURE_TRANSITION.test(plain(list[first].text).trim()) && first + 1 < next ? first + 1 : first;
    if (kind === 'bloco' || kind === 'conclusao') {
      if (roles[titleAt] === 'argument' || roles[titleAt] === 'thesis' || roles[titleAt] === 'question') roles[titleAt] = 'chapter';
    }
    return { index: k, kind, title: kind === 'abertura' ? 'Abertura' : kind === 'cta' ? 'Chamada' : list[titleAt].text, start: list[first].start, end: list[next - 1].end, first };
  });
  // clímax: teses do bloco de conclusão
  for (const sec of sections.filter((x) => x.kind === 'conclusao')) {
    for (let i = sec.first; i < list.length && list[i].start < sec.end; i++) if (roles[i] === 'thesis' || roles[i] === 'argument') roles[i] = roles[i] === 'thesis' ? 'climax' : 'conclusion';
  }

  const sectionOf = (i: number) => {
    let k = 0;
    for (const s of sections) if (s.first <= i) k = s.index;
    return k;
  };
  const rhetoric = rhetoricRuns(list).map((r) => ({ start: list[r.from].start, end: list[r.to].end, why: 'repetição intencional (paralelismo)' }));
  return {
    by: 'heuristic',
    profile: profile.id,
    summary: '',
    centralQuestion,
    thesis: '',
    tone: '',
    sentences: list.map((s, i) => ({ ...s, role: roles[i], section: sectionOf(i), themes: roles[i] === 'cta' ? [] : themesOf(s.text, profile) })),
    sections,
    rhetoric,
  };
}

// --- diretor de IA ----------------------------------------------------------------------

const ROLES: BeatRole[] = ['hook', 'question', 'thesis', 'chapter', 'argument', 'example', 'scripture', 'emotion', 'climax', 'conclusion', 'cta'];

export const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'centralQuestion', 'thesis', 'tone', 'sections', 'beats', 'rhetoric'],
  properties: {
    summary: { type: 'string', description: 'do que o vídeo trata e aonde ele quer levar quem assiste (2 a 3 frases)' },
    centralQuestion: { type: 'string', description: 'a pergunta que move o vídeo, como foi dita' },
    thesis: { type: 'string', description: 'a resposta/tese do vídeo, em uma frase' },
    tone: { type: 'string', description: 'tom e emoção dominantes' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sentence', 'kind', 'title'],
        properties: {
          sentence: { type: 'integer', description: 'índice da frase que abre o bloco' },
          kind: { type: 'string', enum: ['abertura', 'bloco', 'conclusao', 'cta'] },
          title: { type: 'string', description: 'tema do bloco em até 6 palavras, tirado da fala' },
        },
      },
    },
    beats: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sentence', 'role', 'visual', 'query'],
        properties: {
          sentence: { type: 'integer' },
          role: { type: 'string', enum: ROLES },
          visual: { type: 'string', description: 'o que uma imagem mostraria para servir à ideia (vazio se o rosto deve ficar)' },
          query: { type: 'string', description: 'busca curta em inglês para acervo de imagens (vazio se não há imagem)' },
        },
      },
    },
    rhetoric: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'why'],
        properties: { from: { type: 'integer' }, to: { type: 'integer' }, why: { type: 'string' } },
      },
    },
  },
} as const;

export function briefPrompt(profile: EditorialProfile, kind: string, inputs: BriefInputs = {}): string {
  const extra = [
    inputs.briefing?.trim() ? `\nBRIEFING DA PESSOA (manda no tom, no público e no objetivo):\n${inputs.briefing.trim()}` : '',
    inputs.reference?.trim()
      ? `\nROTEIRO DE REFERÊNCIA (o texto que foi gravado; os títulos em CAIXA ALTA são os blocos do vídeo). Use os blocos e os títulos dele em "sections" (título em frase normal), e use a redação dele quando a transcrição tiver errado uma palavra:\n${inputs.reference.trim().slice(0, 40_000)}`
      : '',
  ].join('\n');
  return `${extra ? `${extra.trim()}\n\n` : ''}Você é o diretor editorial de um editor de vídeo profissional. Antes de qualquer corte, imagem, transição ou título, você lê o vídeo INTEIRO e entrega o mapa narrativo que todas as outras áreas vão seguir.

Canal: ${profile.voice}
Tipo de vídeo: ${kind}.

Entregue:
- summary, centralQuestion, thesis, tone: a linha do vídeo (o que ele pergunta, o que responde, com que emoção).
- sections: os blocos na ordem (abertura/gancho, chamadas para ação, cada bloco de conteúdo, conclusão). O "title" é o tema do bloco em até 6 palavras, tirado da fala.
- beats: as frases que NÃO são argumento comum: hook (gancho), question (pergunta que move o vídeo ou o bloco), thesis (afirmação central), chapter (frase que anuncia o tema do bloco), example (história ou exemplo concreto), scripture (citação bíblica/fonte), emotion (momento de emoção do apresentador: o rosto fica), climax (a virada/resposta), conclusion, cta (inscrição, compartilhar, link, despedida). Para cada beat, "visual" diz o que uma imagem mostraria para servir à IDEIA da frase dentro da narrativa (não uma palavra solta: "passageira" não é ônibus, "superficial" não é queimadura, "podemos" não é partido) e "query" é a busca em inglês no estilo: ${profile.imageStyle} Deixe visual e query vazios quando o rosto deve ficar (emoção, cta, pergunta pessoal).
- rhetoric: repetições INTENCIONAIS (anáfora, enumeração, perguntas em série, paralelismo como "curou alguns... ressuscitou alguns..."): de "from" a "to" (índices das frases). O corte nunca remove essas frases.
Use os índices das frases como estão. Responda só o JSON.`;
}

/** Valida o que o diretor devolveu e guarda preso ao texto das frases. */
export function storeFromLlm(raw: unknown, list: Sentence[], profile: EditorialProfile): StoredNarrative | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const str = (v: unknown, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const at = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < list.length ? list[v as number] : null);
  const beats: StoredNarrative['beats'] = {};
  for (const b of Array.isArray(r.beats) ? r.beats : []) {
    const s = at((b as Record<string, unknown>)?.sentence);
    const role = ROLES.find((x) => x === (b as Record<string, unknown>).role);
    if (!s || !role) continue;
    const visual = str((b as Record<string, unknown>).visual, 160);
    const query = str((b as Record<string, unknown>).query, 80);
    beats[sentenceKey(s.text)] = { role, ...(visual ? { visual } : {}), ...(query ? { query } : {}) };
  }
  const kinds: SectionKind[] = ['abertura', 'bloco', 'conclusao', 'cta'];
  const sections = (Array.isArray(r.sections) ? r.sections : [])
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({ s: at(x.sentence), kind: kinds.find((k) => k === x.kind), title: str(x.title, 80) }))
    .filter((x): x is { s: Sentence; kind: SectionKind; title: string } => !!x.s && !!x.kind)
    .sort((a, b) => a.s.index - b.s.index)
    .map((x) => ({ key: sentenceKey(x.s.text), kind: x.kind, title: x.title }));
  const rhetoric = (Array.isArray(r.rhetoric) ? r.rhetoric : [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => at(x.from) && at(x.to) && (x.to as number) >= (x.from as number) && (x.to as number) - (x.from as number) <= 8)
    .map((x) => ({ keys: list.slice(x.from as number, (x.to as number) + 1).map((s) => sentenceKey(s.text)), why: str(x.why, 120) || 'repetição intencional' }));
  if (!sections.length && !Object.keys(beats).length) return null;
  return { version: 1, by: 'llm', profile: profile.id, summary: str(r.summary, 600), centralQuestion: str(r.centralQuestion), thesis: str(r.thesis), tone: str(r.tone, 120), keys: list.map((s) => sentenceKey(s.text)), beats, sections, rhetoric };
}

/** O mapa guardado ainda vale para a fala atual? (os cortes só tiram frases; o texto fica) */
export function storedFits(stored: StoredNarrative | null | undefined, list: Sentence[], profileId: string, inputs = ''): stored is StoredNarrative {
  if (!stored || stored.version !== 1 || stored.profile !== profileId || !list.length) return false;
  if ((stored.inputs ?? '') !== inputs) return false; // briefing ou roteiro mudou
  const known = new Set(stored.keys);
  return list.filter((s) => known.has(sentenceKey(s.text))).length / list.length >= 0.85;
}

/** Aplica o mapa guardado (por texto) sobre a fala atual (com os tempos de agora). */
export function resolveStored(stored: StoredNarrative, words: Words, profile: EditorialProfile): NarrativeBrief {
  const base = heuristicBrief(words, profile);
  const list = base.sentences;
  const byKey = new Map(list.map((s) => [sentenceKey(s.text), s]));
  const starts = stored.sections.map((x) => ({ s: byKey.get(x.key), kind: x.kind, title: x.title })).filter((x) => x.s) as { s: BriefSentence; kind: SectionKind; title: string }[];
  if (!starts.length || starts[0].s.index !== 0) starts.unshift({ s: list[0], kind: 'abertura', title: 'Abertura' });
  const sections: BriefSection[] = starts.map((x, k) => {
    const next = starts[k + 1]?.s.index ?? list.length;
    return { index: k, kind: x.kind, title: x.title || x.s.text, start: x.s.start, end: list[next - 1].end, first: x.s.index };
  });
  const sectionOf = (i: number) => {
    let k = 0;
    for (const s of sections) if (s.first <= i) k = s.index;
    return k;
  };
  const sentencesOut: BriefSentence[] = list.map((s, i) => {
    const b = stored.beats[sentenceKey(s.text)];
    const role: BeatRole = b?.role ?? (sections[sectionOf(i)].kind === 'cta' ? 'cta' : 'argument');
    return { ...s, role, section: sectionOf(i), themes: role === 'cta' ? [] : s.themes, ...(b?.visual ? { visual: b.visual } : {}), ...(b?.query ? { query: b.query } : {}) };
  });
  const rhetoric = stored.rhetoric
    .map((r) => r.keys.map((k) => byKey.get(k)).filter((s): s is BriefSentence => !!s))
    .filter((ss) => ss.length)
    .map((ss) => ({ start: Math.min(...ss.map((s) => s.start)), end: Math.max(...ss.map((s) => s.end)), why: stored.rhetoric.find((r) => r.keys.includes(sentenceKey(ss[0].text)))?.why ?? 'repetição intencional' }));
  return { by: 'llm', profile: profile.id, summary: stored.summary, centralQuestion: stored.centralQuestion, thesis: stored.thesis, tone: stored.tone, sentences: sentencesOut, sections, rhetoric: mergeRanges([...rhetoric, ...base.rhetoric]) };
}

function mergeRanges(list: NarrativeBrief['rhetoric']): NarrativeBrief['rhetoric'] {
  const out: NarrativeBrief['rhetoric'] = [];
  for (const r of [...list].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && r.start <= last.end + 0.05) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export interface BriefDeps {
  words: Words;
  profile: EditorialProfile;
  kind: string;
  ai: AISettings;
  llm: boolean;
  stored: StoredNarrative | null | undefined;
  /** Briefing e roteiro de referência (opcionais). */
  inputs?: BriefInputs;
  signal: AbortSignal;
  log(msg: string): void;
  progress(step: string): void;
}

/** Mapa narrativo da fala atual: reaproveita o do projeto, pede ao diretor de IA ou usa as regras. */
export async function buildBrief(d: BriefDeps): Promise<{ brief: NarrativeBrief; store: StoredNarrative | null }> {
  const list = sentences(d.words);
  const key = keyOf(d.inputs);
  if (storedFits(d.stored, list, d.profile.id, key)) return { brief: withInputs(resolveStored(d.stored, d.words, d.profile), d.inputs), store: null };
  if (d.llm && list.length) {
    try {
      d.progress(`O diretor editorial está lendo o vídeo inteiro${d.ai.provider === 'claude-code' ? ' com a sua conta Claude' : ''} (narrativa, blocos e tese; cerca de 1 minuto)…`);
      const raw = await askJson(d.ai, briefPrompt(d.profile, d.kind, d.inputs), list.map((s) => `${s.index} [${s.start.toFixed(1)}] ${s.text}`).join('\n'), BRIEF_SCHEMA as unknown as Record<string, unknown>, d.signal);
      const stored = storeFromLlm(raw, list, d.profile);
      if (stored) {
        const store = { ...stored, ...(key ? { inputs: key } : {}) };
        return { brief: withInputs(resolveStored(store, d.words, d.profile), d.inputs), store };
      }
      d.log('diretor editorial devolveu um mapa vazio: usando as regras locais');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      d.log(`diretor editorial indisponível: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { brief: withInputs(heuristicBrief(d.words, d.profile), d.inputs), store: null };
}

/** Mapa sem chamar a IA: o guardado no projeto (se ainda vale) ou o das regras. */
export function quickBrief(words: Words, profile: EditorialProfile, stored: StoredNarrative | null | undefined, inputs: BriefInputs = {}): NarrativeBrief {
  const base = storedFits(stored, sentences(words), profile.id, keyOf(inputs)) ? resolveStored(stored, words, profile) : heuristicBrief(words, profile);
  return withInputs(base, inputs);
}

// --- consulta pelas skills ---------------------------------------------------------------

/** Frase do mapa num instante da timeline. */
export const sentenceAt = (b: NarrativeBrief, t: number) => b.sentences.find((s) => s.start <= t + 0.05 && s.end >= t - 0.05) ?? b.sentences.find((s) => s.start >= t) ?? null;

/** O instante cai na abertura de um bloco (até `tol` s depois do início)? */
export const sectionStartNear = (b: NarrativeBrief, t: number, tol = 1.5) => b.sections.find((s) => s.index > 0 && t >= s.start - tol && t <= s.start + tol) ?? null;

/** Texto curto do mapa para os prompts das skills e do Diretor. */
export function briefText(b: NarrativeBrief, profile: EditorialProfile): string {
  const lines = [`CANAL: ${profile.voice}`];
  if (b.briefing) lines.push(`BRIEFING: ${b.briefing.slice(0, 1500)}`);
  if (b.summary) lines.push(`RESUMO: ${b.summary}`);
  if (b.centralQuestion) lines.push(`PERGUNTA CENTRAL: ${b.centralQuestion}`);
  if (b.thesis) lines.push(`TESE: ${b.thesis}`);
  if (b.tone) lines.push(`TOM: ${b.tone}`);
  lines.push('BLOCOS:');
  for (const s of b.sections) lines.push(`- [${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${s.kind}: ${s.title.slice(0, 90)}`);
  if (b.rhetoric.length) lines.push(`REPETIÇÕES INTENCIONAIS (não cortar): ${b.rhetoric.map((r) => `${r.start.toFixed(1)}–${r.end.toFixed(1)}`).join(', ')}`);
  return lines.join('\n');
}
