// Perfis editoriais por categoria de vídeo: quem é o canal, o tom, que imagens servem à
// narrativa (e quais nunca), a identidade dos títulos e o vocabulário de transições. Todas as
// skills leem o mesmo perfil, para trabalharem fundo na sua área sem sair da linha do vídeo.

import type { Workflow } from '../../core/workflow';

/** Papel de uma frase na narrativa. */
export type BeatRole = 'hook' | 'question' | 'thesis' | 'chapter' | 'argument' | 'example' | 'scripture' | 'emotion' | 'climax' | 'conclusion' | 'cta';

/** Tema visual: quando a fala toca nele, estas buscas mostram o que está sendo dito. */
export interface VisualTheme {
  id: string;
  label: string;
  /** Testado no texto da frase em minúsculas e sem acento. */
  match: RegExp;
  /** Buscas curadas (inglês), em ordem de preferência; rodam para não repetir imagem. */
  queries: string[];
}

export interface EditorialProfile {
  id: string;
  label: string;
  /** Quem é o canal e para quem fala (entra nos prompts de todas as skills). */
  voice: string;
  /** Estética das imagens (prompt do diretor de imagens). */
  imageStyle: string;
  /** Acervo (arte, arquivo, domínio público) antes de banco de fotos. */
  archive: boolean;
  themes: VisualTheme[];
  /** Título da imagem com estes termos nunca entra (fora do contexto do canal). */
  forbidden: RegExp;
  /** Papéis que podem receber imagem por cima (o resto fica no rosto). */
  brollRoles: BeatRole[];
  /** Ritmo das imagens no vídeo longo: duração mínima/máxima (s) e uma imagem a cada `every` s. */
  brollPace?: { min: number; max: number; every: number };
  /** Ritmo dos títulos/lettering no vídeo longo: um a cada `every` s, até `max`. */
  motionPace?: { every: number; max: number };
  /** Ritmo de agência: com o rosto na tela, um punch-in (troca de enquadramento) se passar disto (s) sem mudança visual. */
  punchEvery?: number;
  /** Zoom no rosto: aproximação lenta (push) ou troca seca de enquadramento (punch). */
  zoomStyle?: 'push' | 'punch';
  /** Tipografia cinética das frases de impacto (palavra por palavra, no tempo da fala, ao lado do rosto). */
  lettering?: LetteringStyle;
  /** Botão de chamada: discreto (elegante) ou no estilo YouTube (vermelho, com cursor). */
  ctaStyle?: 'elegante' | 'youtube';
  motion: {
    titleFont: string;
    bodyFont: string;
    color: string;
    accent: string;
    /** Destaque curto (callout) só na pergunta central e nas frases de tese/clímax. */
    callouts: boolean;
    /** Caixa alta nos textos. */
    upper: boolean;
  };
  /** Trilha e efeitos sonoros (fase Música e efeitos). */
  sound: SoundStyle;
  /** Preset de legenda do canal (sem: o padrão do tipo de vídeo). */
  captionPreset?: string;
  transitions: {
    /** Abertura de um bloco/capítulo. */
    chapter: string;
    /** Entrada da chamada para ação e do encerramento. */
    outro: string;
    /** Corte de salto dentro do mesmo raciocínio. */
    jumpCut: 'seco' | 'punch-enfase' | 'punch-alternado';
    /** Só estes presets entram (os outros viram corte seco). */
    allowed: string[];
  };
}

export interface LetteringStyle {
  fontFamily: string;
  fontWeight: number;
  /** Tamanho em fração do lado menor do quadro. */
  fontSize: number;
  color: string;
  /** Palavra-chave da frase. */
  emphasisColor: string;
  uppercase: boolean;
  letterSpacing: number;
  wordAnim: 'fade' | 'rise' | 'pop';
}

export interface SoundStyle {
  /** Clima da trilha por tipo de bloco (ids da biblioteca de sons); lista = alterna entre os blocos; null = sem música. */
  music: Partial<Record<'abertura' | 'bloco' | 'conclusao' | 'cta', string | string[] | null>>;
  /** Volume da trilha sob a voz (0..1). */
  level: number;
  /** Efeito na abertura de cada bloco, na entrada de título e na entrada de imagem (null = nenhum). */
  sfx: { chapter: string | null; title: string | null; broll: string | null; cta?: boolean };
  sfxLevel: number;
}

// Imagem de banco e acervo que nunca serve a nenhum canal: ícone, logo, diagrama, política
// partidária, ferimento, propaganda.
const COMMON_FORBIDDEN = String.raw`icons?|icons8|logos?|emoji|clip ?art|screenshot|diagrams?|charts?|infographic|coat of arms|flag of|map of|political party|partido|podemos|asamblea|elections?|campaign|rally|protests?|burn\w*|wound\w*|injur\w*|surgery|autopsy|corpses?|cadavers?|nude|naked|advert\w*|bus|tram|parking`;
const forbidden = (extra = '') => new RegExp(`\\b(${COMMON_FORBIDDEN}${extra ? `|${extra}` : ''})\\b`, 'i');

const NO_BROLL: BeatRole[] = ['cta', 'emotion'];
const ALL_ROLES: BeatRole[] = ['hook', 'question', 'thesis', 'chapter', 'argument', 'example', 'scripture', 'emotion', 'climax', 'conclusion', 'cta'];

const t = (id: string, label: string, match: RegExp, queries: string[]): VisualTheme => ({ id, label, match, queries });

// --- Cristão: reflexão, estudo bíblico, apologética ------------------------------------

const CHRISTIAN_THEMES: VisualTheme[] = [
  t('guerra', 'guerra e destruição', /\b(guerras?|bomba|bombas|exercito|soldados?|gatilho|invad\w*)\b/, ['bombed city ruins 1945 photograph', 'Goya Disasters of War', 'war ruins Warsaw 1945', 'Otto Dix war']),
  t('crianca', 'crianças inocentes', /\bcriancas?\b/, ['war orphan child 1940s photograph', 'child refugee 1945 photograph', 'Kathe Kollwitz children']),
  t('lazaro', 'Lázaro', /\b(lazaro|lasar)\b/, ['Raising of Lazarus painting', 'Rembrandt Raising of Lazarus']),
  t('ressurreicao', 'ressurreição', /\b(ressurrei\w*|ressuscit\w*|reissao|tumulo vazio)\b/, ['Resurrection of Christ painting', 'Matthias Grunewald Resurrection', 'empty tomb painting']),
  t('cura', 'milagres de cura', /\b(curou|curar|curava|curado|cura|cegos?|segos|paraliticos?|leprosos?|milagres?)\b/, ['Christ healing the blind painting', 'Rembrandt Christ healing the sick', 'Carl Bloch healing at the pool of Bethesda']),
  t('cruz', 'a cruz', /\b(cruz|crucific\w*|calvario)\b/, ['Velazquez Christ Crucified', 'crucifixion painting', 'Rembrandt Raising of the Cross']),
  t('paixao', 'a paixão de Cristo', /\b(sentiu fome|sentiu dor|traido|rejeitado|humilhado|executado|getsemani)\b/, ['Christ carrying the cross painting', 'Carl Bloch Gethsemane', 'Christ in Gethsemane painting']),
  t('criacao', 'a criação', /\b(criacao|criou o mundo|criado bom|foi criado|criou)\b/, ['Michelangelo Creation of Adam', 'Gustave Dore creation of light', 'Hubble deep field']),
  t('queda', 'a queda', /\b(queda|rebeliao|rebela|homem cai|caiu|corromp\w*|corrupcao|quebrado|ferida)\b/, ['Masaccio Expulsion from the Garden of Eden', 'Thomas Cole Expulsion from the Garden of Eden', 'Gustave Dore Paradise Lost fall']),
  t('restauracao', 'restauração e novos céus', /\b(restaur\w*|novos ceus|nova terra|novas todas as coisas|reino de deus|reino|paraiso|eternidade)\b/, ['Gustave Dore Paradiso Empyrean', 'John Martin Plains of Heaven', 'New Jerusalem painting']),
  t('passagem', 'esta vida é passagem', /\b(passagem|passageira|temporaria|peregrin\w*)\b/, ['Caspar David Friedrich Wanderer above the Sea of Fog', 'pilgrim road landscape painting', 'Friedrich Monk by the Sea']),
  t('biblia', 'a Bíblia', /\b(biblia|escrituras?|versiculo|genesis|apocalipse|salmos?)\b/, ['old Bible manuscript', 'Gutenberg Bible', 'illuminated manuscript Bible']),
  t('roma', 'o Império Romano', /\b(imperio romano|romanos)\b/, ['Roman Forum painting', 'ancient Rome painting']),
  t('doenca', 'doença', /\b(doencas?|doentes?|enferm\w*)\b/, ['Luke Fildes The Doctor', 'sick child painting 19th century', 'Edvard Munch The Sick Child']),
  t('envelhecer', 'envelhecimento', /\b(envelhec\w*|emvelec\w*|velhice|velecem)\b/, ['Rembrandt old man portrait', 'old woman portrait painting', 'elderly hands photograph']),
  t('morte', 'a morte', /\b(morte|morrer|morreria|mortos?|morreu|morta)\b/, ['memento mori vanitas painting', 'Arnold Bocklin Isle of the Dead', 'old cemetery fog photograph']),
  t('injustica', 'injustiça e violência', /\b(injustica|violencia|assassinato)\b/, ['Goya Third of May 1808', 'Cain and Abel painting', 'Goya Disasters of War']),
  t('oracao', 'oração', /\b(oracao|orar|orando|oramos)\b/, ['Albrecht Durer Praying Hands', 'man praying painting', 'Millet The Angelus']),
  t('esperanca', 'esperança', /\b(esperanca|promessa|cumprimento|destino)\b/, ['Caspar David Friedrich sunrise', 'Friedrich Woman before the rising sun', 'sunrise over mountains landscape painting']),
  t('luto', 'luto e lágrimas', /\b(chorar|chora|lagrimas?|luto|perda|sofrimento|dor)\b/, ['Michelangelo Pieta', 'mourning painting 19th century', 'William Bouguereau Pieta']),
  t('familia', 'família', /\b(familia|filhos|maes?)\b/, ['family portrait painting 19th century', 'mother and child painting', 'Mary Cassatt mother and child']),
  t('jesus', 'Jesus e o ministério', /\b(jesus|cristo|evangelhos?|ministerio)\b/, ['Carl Bloch Sermon on the Mount', 'Christ teaching painting', 'Heinrich Hofmann Christ']),
];

const christian: EditorialProfile = {
  id: 'cristao',
  label: 'Cristão de estudo',
  voice: 'Canal cristão moderno e atual que fala de Deus com profundidade: enfrenta perguntas difíceis com honestidade, fé e base bíblica. A edição usa recursos modernos (IA, motion, imagens fortes), mas sempre com reverência e sobriedade: nada de sensacionalismo, humor fora de hora, política partidária ou imagem chocante gratuita.',
  imageStyle: 'Arte sacra clássica (Rembrandt, Caravaggio, Doré, Carl Bloch, Michelangelo), gravuras bíblicas, pintura romântica contemplativa (Caspar David Friedrich), fotografia histórica em preto e branco para guerra e sofrimento real, e imagens do cosmos para criação. Cada imagem mostra a ideia teológica da frase (criação, queda, cruz, ressurreição, restauração), nunca uma palavra solta da frase.',
  archive: true,
  themes: CHRISTIAN_THEMES,
  forbidden: forbidden(String.raw`serpents?|snakes?|snake handling|occult\w*|satan\w*|demons?|tarot|witch\w*|horror|halloween|cartoons?|memes?|party|parties|nightclub|beer|wine bottle`),
  brollRoles: ALL_ROLES.filter((r) => !NO_BROLL.includes(r)),
  // ritmo de agência (4–8 s entre mudanças visuais): imagem a cada ~14 s, lettering 2–3 por minuto,
  // punch-in de enquadramento nos trechos de rosto que passam de 7 s sem mudança
  brollPace: { min: 3.5, max: 6, every: 14 },
  motionPace: { every: 22, max: 40 },
  punchEvery: 7,
  motion: { titleFont: '"Playfair Display", Georgia, serif', bodyFont: '"Playfair Display", Georgia, serif', color: '#f5efe3', accent: '#d4a85a', callouts: true, upper: false },
  // trilha discreta: séria na pergunta, contemplativa nos blocos, esperança na conclusão
  // trilha 22–24 dB abaixo da voz (regra das skills de som)
  sound: { music: { abertura: 'contemplativa', cta: 'contemplativa', bloco: 'contemplativa', conclusao: 'esperanca' }, level: 0.05, sfx: { chapter: null, title: null, broll: null }, sfxLevel: 0.25 },
  zoomStyle: 'push',
  lettering: { fontFamily: '"Playfair Display", Georgia, serif', fontWeight: 700, fontSize: 0.068, color: '#f7f2e8', emphasisColor: '#e2b867', uppercase: false, letterSpacing: 0, wordAnim: 'rise' },
  ctaStyle: 'elegante',
  captionPreset: 'reflexao',
  transitions: { chapter: 'cinematic-dissolve', outro: 'dip-black', jumpCut: 'punch-enfase', allowed: ['punch-in', 'cross-dissolve', 'cinematic-dissolve', 'dip-black', 'chapter-transition', 'broll-bridge', 'seamless-cut', 'focus-transition', 'rack-focus', 'clean-dissolve'] },
};

// --- Documentário / dark / ensaio -----------------------------------------------------

const ESSAY_THEMES: VisualTheme[] = [
  t('universo', 'universo', /\b(universo|galaxias?|estrelas?|cosmos|espaco sideral|planetas?)\b/, ['Hubble deep field', 'Milky Way galaxy photograph', 'nebula Hubble']),
  t('guerra', 'guerra', /\b(guerras?|batalha|exercito|soldados?|bomba)\b/, ['World War II ruins photograph', 'soldiers 1944 photograph', 'Goya Disasters of War']),
  t('historia', 'história antiga', /\b(imperio|antiguidade|antigo egito|roma|grecia|medieval)\b/, ['ancient ruins painting', 'Roman Forum painting', 'medieval manuscript']),
  t('mar', 'o mar', /\b(mar|oceano|ondas|navio)\b/, ['stormy sea painting', 'Ivan Aivazovsky sea', 'ocean waves photograph']),
  t('cidade', 'cidade', /\b(cidade|metropole|urbano)\b/, ['city at night aerial photograph', 'old city street 1900 photograph']),
  t('morte', 'morte', /\b(morte|morrer|mortos?)\b/, ['memento mori vanitas painting', 'Arnold Bocklin Isle of the Dead']),
  t('ciencia', 'ciência', /\b(ciencia|cientistas?|laboratorio|experimento)\b/, ['scientist laboratory 1920 photograph', 'Joseph Wright An Experiment on a Bird in the Air Pump']),
];

const documentary: EditorialProfile = {
  id: 'documentario',
  label: 'Documentário / ensaio',
  voice: 'Ensaio narrado: a imagem conta a história junto com a voz, com ritmo contemplativo e tom sério.',
  imageStyle: 'Arquivo histórico, arte clássica, fotografia documental e científica de domínio público; imagens literais ou metafóricas da frase, nunca genéricas.',
  archive: true,
  themes: ESSAY_THEMES,
  forbidden: forbidden(String.raw`cartoons?|memes?`),
  brollRoles: ALL_ROLES.filter((r) => r !== 'cta'),
  // a imagem é a espinha do ensaio: mais imagens, mais longas
  brollPace: { min: 4, max: 9, every: 22 },
  motion: { titleFont: '"Playfair Display", Georgia, serif', bodyFont: 'Georgia, "Times New Roman", serif', color: '#f0f0f0', accent: '#c9a96e', callouts: false, upper: false },
  sound: { music: { abertura: 'reflexao', cta: 'reflexao', bloco: 'reflexao', conclusao: 'epica' }, level: 0.07, sfx: { chapter: null, title: null, broll: null }, sfxLevel: 0.2 },
  zoomStyle: 'push',
  lettering: { fontFamily: '"Playfair Display", Georgia, serif', fontWeight: 500, fontSize: 0.062, color: '#f0f0f0', emphasisColor: '#c9a96e', uppercase: false, letterSpacing: 0, wordAnim: 'fade' },
  ctaStyle: 'elegante',
  captionPreset: 'cinema',
  transitions: { chapter: 'cinematic-dissolve', outro: 'dip-black', jumpCut: 'seco', allowed: ['cross-dissolve', 'cinematic-dissolve', 'dip-black', 'chapter-transition', 'broll-bridge', 'seamless-cut', 'focus-transition', 'rack-focus'] },
};

const dark: EditorialProfile = { ...documentary, id: 'dark', label: 'Dark / narrado', voice: 'Canal narrado sem rosto: mistério, suspense e revelação; a imagem carrega o vídeo inteiro.', motion: { ...documentary.motion, accent: '#b3261e', titleFont: '"Cinzel", Georgia, serif', upper: true }, sound: { music: { abertura: 'tensao', cta: 'tensao', bloco: 'tensao', conclusao: 'epica' }, level: 0.16, sfx: { chapter: 'riser', title: 'sub-drop', broll: 'whoosh-suave' }, sfxLevel: 0.3 } };

// --- Educativo / opinião / podcast ------------------------------------------------------

const GENERAL_THEMES: VisualTheme[] = [
  ...ESSAY_THEMES,
  t('dinheiro', 'dinheiro', /\b(dinheiro|investiment\w*|salario|economia|inflacao)\b/, ['money banknotes photograph', 'stock market screen']),
  t('tecnologia', 'tecnologia', /\b(tecnologia|computador|internet|inteligencia artificial|celular)\b/, ['computer code screen', 'smartphone in hand', 'data center servers']),
  t('saude', 'saúde', /\b(saude|medico|hospital)\b/, ['doctor hospital corridor', 'stethoscope doctor']),
  t('estudo', 'estudo', /\b(estudar|estudo|aprender|escola|universidade)\b/, ['student studying library', 'university lecture hall']),
];

const educational: EditorialProfile = {
  id: 'educativo',
  label: 'Educativo',
  voice: 'Aula clara e direta: cada bloco explica uma ideia; a imagem mostra o exemplo concreto do que é dito.',
  imageStyle: 'Fotos reais, nítidas e atuais que mostram o objeto, o lugar ou a ação explicada; nada de banco de imagem genérico com gente sorrindo para a câmera.',
  archive: false,
  themes: GENERAL_THEMES,
  forbidden: forbidden(),
  brollRoles: ['example', 'argument', 'scripture', 'chapter', 'thesis'],
  motion: { titleFont: '"Arial Black", "Segoe UI Black", sans-serif', bodyFont: '"Segoe UI", Arial, sans-serif', color: '#ffffff', accent: '#4f8cff', callouts: true, upper: false },
  sound: { music: { abertura: 'lofi', cta: 'lofi', bloco: 'lofi', conclusao: 'lofi' }, level: 0.06, sfx: { chapter: 'whoosh-suave', title: null, broll: null, cta: true }, sfxLevel: 0.22 },
  zoomStyle: 'punch',
  lettering: { fontFamily: '"Montserrat", "Segoe UI", Arial, sans-serif', fontWeight: 800, fontSize: 0.062, color: '#ffffff', emphasisColor: '#4f8cff', uppercase: false, letterSpacing: -0.01, wordAnim: 'rise' },
  ctaStyle: 'youtube',
  brollPace: { min: 3, max: 6, every: 12 },
  motionPace: { every: 18, max: 45 },
  punchEvery: 6,
  transitions: { chapter: 'chapter-transition', outro: 'dip-black', jumpCut: 'punch-alternado', allowed: ['punch-in', 'cross-dissolve', 'chapter-transition', 'broll-bridge', 'seamless-cut', 'subtle-push', 'zoom-clean', 'dip-black', 'animated-wipe'] },
};

const opinion: EditorialProfile = { ...educational, id: 'opiniao', label: 'Opinião / comentário', voice: 'Pessoa falando para a câmera com opinião forte: o rosto é o centro; imagem só quando prova o que é dito.', brollRoles: ['example', 'argument'] };
const podcast: EditorialProfile = { ...educational, id: 'podcast', label: 'Podcast / conversa', voice: 'Conversa: as pessoas são o vídeo; quase nada por cima da fala.', brollRoles: ['example'], sound: { music: {}, level: 0, sfx: { chapter: null, title: null, broll: null }, sfxLevel: 0 }, transitions: { ...educational.transitions, jumpCut: 'seco', allowed: ['clean-dissolve', 'seamless-cut', 'dip-black', 'cross-dissolve'] } };

// --- Curtos -------------------------------------------------------------------------------

const short: EditorialProfile = {
  id: 'curto',
  label: 'Vídeo curto',
  voice: 'Vídeo curto vertical: gancho nos primeiros segundos, uma ideia só, ritmo seco e legenda forte.',
  imageStyle: 'Fotos e vídeos atuais, verticais, com ação e contraste; uma imagem por ideia.',
  archive: false,
  themes: GENERAL_THEMES,
  forbidden: forbidden(),
  brollRoles: ALL_ROLES.filter((r) => r !== 'cta'),
  motion: { titleFont: '"Arial Black", "Segoe UI Black", sans-serif', bodyFont: '"Arial Black", "Segoe UI Black", sans-serif', color: '#ffffff', accent: '#ffd400', callouts: true, upper: true },
  sound: { music: { abertura: 'energia', cta: 'energia', bloco: 'energia', conclusao: 'energia' }, level: 0.12, sfx: { chapter: 'whoosh', title: null, broll: 'whoosh', cta: true }, sfxLevel: 0.3 },
  zoomStyle: 'punch',
  lettering: { fontFamily: '"Montserrat", "Arial Black", sans-serif', fontWeight: 900, fontSize: 0.08, color: '#ffffff', emphasisColor: '#ffd400', uppercase: true, letterSpacing: 0.01, wordAnim: 'pop' },
  ctaStyle: 'youtube',
  transitions: { chapter: 'zoom-clean', outro: 'cta-reveal', jumpCut: 'punch-alternado', allowed: [] },
};

const generic: EditorialProfile = { ...educational, id: 'youtube', label: 'YouTube', voice: 'Vídeo de YouTube falado para a câmera.' };

const PROFILES: Record<string, EditorialProfile> = { cristao: christian, documentario: documentary, dark, educativo: educational, opiniao: opinion, podcast };

/** Perfil do projeto: pelo tipo escolhido; curtos e projetos sem tipo caem no genérico. */
export function profileFor(wf: Pick<Workflow, 'track' | 'subtype'> | null | undefined): EditorialProfile {
  if (wf?.subtype && PROFILES[wf.subtype]) {
    const p = PROFILES[wf.subtype];
    // o mesmo tipo num curto mantém tema e imagens, mas com o ritmo e a letra do curto
    return wf.track === 'short' ? { ...p, motion: { ...short.motion, accent: p.motion.accent }, transitions: short.transitions, sound: { ...short.sound, music: p.sound.level ? short.sound.music : {} } } : p;
  }
  return wf?.track === 'short' ? short : generic;
}

/** Texto em minúsculas e sem acento (para casar os temas). */
export const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Temas visuais que a frase toca, na ordem do perfil. */
export function themesOf(text: string, profile: EditorialProfile): string[] {
  const s = plain(text);
  return profile.themes.filter((th) => th.match.test(s)).map((th) => th.id);
}

export const themeById = (profile: EditorialProfile, id: string) => profile.themes.find((th) => th.id === id);

/** A imagem do acervo cabe no canal? (título/descrição sem termo proibido). */
export const imageAllowed = (title: string, profile: EditorialProfile) => !profile.forbidden.test(plain(title));

/** Preset de transição cabe no perfil? (lista vazia = todos). */
export const transitionAllowed = (id: string, profile: EditorialProfile) => !profile.transitions.allowed.length || profile.transitions.allowed.includes(id);
