// Métodos editoriais do Diretor: como um editor profissional monta cada tipo de vídeo. Texto
// original do FOCO (estrutura, ritmo, B-roll, gráficos, transições, áudio, legenda e checklist).
// Entra no prompt do Diretor conforme o preset e o tipo do projeto.

export interface EditorialMethod {
  id: string;
  name: string;
  /** Estrutura narrativa e para que serve cada parte. */
  structure: string;
  pacing: string;
  broll: string;
  graphics: string;
  transitions: string;
  audio: string;
  checklist: string[];
}

const COMMON_CHECKS = [
  'Nenhum corte no meio de palavra (verify sem erros).',
  'Sem tela preta e sem buraco na imagem.',
  'Rosto visível no gancho e no fechamento quando há apresentador.',
  'Títulos legíveis, um por vez, com texto tirado da fala.',
];

const M: EditorialMethod[] = [
  {
    id: 'youtube-educativo',
    name: 'YouTube · aula / explicação',
    structure: 'Gancho (0–15 s: a promessa ou a pergunta do vídeo) → contexto curto → blocos de conteúdo, cada um com uma ideia → recapitulação → chamada para próximo vídeo. Corte trechos que repetem a mesma ideia; mantenha exemplos.',
    pacing: 'Corte dinâmico: pausas acima de ~0,4 s saem, tropeços e repetições saem. Mantenha respiros curtos antes de frases-chave. Uma mudança visual a cada 10–25 s.',
    broll: 'B-roll ilustra o que é dito (objeto, lugar, tela, exemplo), 3–6 s, cobrindo no máximo ~40% do vídeo; nunca no gancho; volte ao rosto em frases de opinião ou emoção.',
    graphics: 'Lower third no começo de cada bloco com o tema; destaques curtos para números, termos e passos; no máximo um gráfico a cada ~30–50 s.',
    transitions: 'Corte seco por padrão; punch-in alternado nos cortes de salto; dissolve só em troca de bloco com pausa; nada chamativo.',
    audio: 'Voz clara entre −22 e −14 dBFS de média; música opcional bem baixa (≤ 12%), some nos trechos densos.',
    checklist: [...COMMON_CHECKS, 'Cada bloco começa com algo visual (título ou B-roll).', 'Gancho com no máximo 15 s antes do primeiro conteúdo.'],
  },
  {
    id: 'youtube-cristao',
    name: 'YouTube · estudo / pregação / reflexão',
    structure: 'Abertura com o texto ou a pergunta central → leitura/contexto → desenvolvimento em pontos → aplicação → oração ou fechamento. Preserve citações completas (não corte versículos ao meio).',
    pacing: 'Corte natural: mantenha pausas de ênfase e respiração (até ~0,7 s); tire só tropeços, repetições e silêncios longos. O ritmo é contemplativo, não acelerado.',
    broll: 'Imagens de arquivo, arte sacra, paisagens e lugares bíblicos (domínio público), lentas, 4–8 s, com movimento suave; nunca sobre momentos de emoção do pregador.',
    graphics: 'Referências bíblicas como lower third ou título discreto quando citadas; frases de impacto em destaque elegante (fundo escuro, sem cores berrantes).',
    transitions: 'Corte seco e dissolve/cinematic dissolve em mudança de ponto; dip to black em fechamento; nunca glitch, whip ou flash.',
    audio: 'Voz natural, sem compressão exagerada; música instrumental muito baixa (≤ 10%) só em abertura, transições de bloco e fechamento.',
    checklist: [...COMMON_CHECKS, 'Citações e versículos inteiros, sem cortes no meio.', 'Pausas de ênfase preservadas.'],
  },
  {
    id: 'documentario',
    name: 'Documentário / ensaio narrado',
    structure: 'Abertura atmosférica → tese → capítulos (cada um com virada) → síntese. A imagem conta junto com a voz: mais tempo de imagem que de rosto.',
    pacing: 'Corte natural; deixe imagens respirarem (5–10 s); acelere só em sequências de tensão.',
    broll: 'B-roll é a espinha: arquivo, mapas, detalhes, paisagem; cobertura pode passar de 60%; escolha imagens que façam sentido literal ou metafórico com a frase, nunca genéricas.',
    graphics: 'Títulos de capítulo; datas e lugares como lower third; nada de destaques estilo rede social.',
    transitions: 'Cinematic dissolve e dip to black em capítulos; cortes secos dentro das sequências.',
    audio: 'Trilha atmosférica constante e baixa (10–15%), sobe nos capítulos; voz sempre na frente.',
    checklist: [...COMMON_CHECKS, 'Capítulos marcados visualmente.', 'Nenhuma imagem repetida.'],
  },
  {
    id: 'podcast',
    name: 'Podcast / conversa / entrevista',
    structure: 'Melhor trecho como teaser (opcional, 10–20 s) → apresentação → conversa em blocos de assunto → fechamento. Preserve o raciocínio do convidado; corte digressões longas.',
    pacing: 'Corte natural; tire "éé", repetições e silêncios longos, mas mantenha reações e risadas curtas. Cortes invisíveis.',
    broll: 'Pouco B-roll: só quando falam de algo concreto (produto, lugar, foto). Prefira manter as pessoas na tela.',
    graphics: 'Lower third com nome e função na primeira fala de cada pessoa; destaques raros para frases memoráveis.',
    transitions: 'Corte seco; punch-in alternado nos saltos; clean dissolve entre assuntos.',
    audio: 'Equilíbrio entre vozes; sem música sob a conversa (só vinheta).',
    checklist: [...COMMON_CHECKS, 'Toda pessoa identificada na primeira fala.', 'Sem trecho de silêncio acima de 1 s.'],
  },
  {
    id: 'youtube-opiniao',
    name: 'YouTube · opinião / comentário',
    structure: 'Tese no gancho → argumentos (cada um com evidência) → contra-argumento → conclusão firme → chamada.',
    pacing: 'Dinâmico: emende frases, mantenha só pausas dramáticas. Uma mudança visual a cada 8–15 s.',
    broll: 'Prints, manchetes, vídeos citados e exemplos; cubra explicações, não opiniões fortes.',
    graphics: 'Destaques curtos com a frase-tese e números; títulos para cada argumento.',
    transitions: 'Corte seco e punch-in/punch zoom em ênfases; whip pan suave em virada de assunto, com moderação.',
    audio: 'Voz à frente; música leve 10–15%; efeito sonoro curto opcional em destaques.',
    checklist: [...COMMON_CHECKS, 'Tese dita nos primeiros 10 s.'],
  },
  {
    id: 'dark',
    name: 'Dark / narrado sem rosto',
    structure: 'Gancho de mistério → contexto → desenvolvimento com revelações progressivas → clímax → fechamento com pergunta ou chamada.',
    pacing: 'Narração contínua; imagem troca a cada 3–6 s; nunca fique em tela sem imagem.',
    broll: '100% de cobertura com imagens; cada frase com imagem coerente; movimento lento (Ken Burns) em fotos.',
    graphics: 'Datas, nomes e números em destaque discreto; títulos de capítulo.',
    transitions: 'Dissolve curto entre imagens, dip to black em capítulos, flash raro em revelações.',
    audio: 'Trilha de tensão 12–18%, sobe nos clímax; narração sempre clara.',
    checklist: [...COMMON_CHECKS, 'Nenhum segundo sem imagem.', 'Imagens não se repetem.'],
  },
  {
    id: 'curto-narracao',
    name: 'Curto · Reels/TikTok/Shorts (fala ou narração)',
    structure: 'Gancho em 0–2 s (frase mais forte ou pergunta) → desenvolvimento em 2–4 batidas → payoff → chamada curta. Corte tudo que não serve ao gancho.',
    pacing: 'Corte seco: emende frase com frase (pausas ≤ 0,2 s). Mudança visual a cada 2–4 s (punch-in, B-roll, destaque, troca de enquadramento).',
    broll: 'B-roll curto (1,5–3 s) e direto; nunca nos 2 primeiros segundos se há rosto.',
    graphics: 'Destaques fortes com 2–5 palavras da fala, um por vez, na metade de cima (a legenda fica embaixo).',
    transitions: 'Na batida da música: beat zoom, whip, flash; alterne forte e discreto; corte seco no resto.',
    audio: 'Música 18–25% sob a voz, abaixa nas falas; efeitos sonoros curtos nos destaques.',
    checklist: [...COMMON_CHECKS, 'Gancho nos primeiros 2 s.', 'Nenhum trecho de 5 s sem mudança visual.', 'Destaques não cobrem a legenda.'],
  },
  {
    id: 'curto-venda',
    name: 'Curto · vídeo de venda / anúncio / VSL',
    structure: 'Gancho (dor ou resultado) 0–3 s → problema → agitação → solução (produto) → prova (depoimento, número, antes/depois) → oferta → chamada clara (o que fazer agora).',
    pacing: 'Seco e rápido; cada frase empurra para a próxima; mudança visual a cada 2–3 s.',
    broll: 'Produto em uso, detalhes, resultado, prova social; nada genérico de banco de imagem se houver material do produto.',
    graphics: 'Benefícios em destaque curto; preço/oferta em título forte; CTA no final (CTA reveal).',
    transitions: 'Limpas e de marca (light sweep, product reveal, push); corte seco na fala.',
    audio: 'Música enérgica 20–25% com ducking na voz; efeitos nos destaques de benefício.',
    checklist: [...COMMON_CHECKS, 'Oferta e chamada visíveis no fim.', 'Produto aparece antes da metade do vídeo.'],
  },
  {
    id: 'curto-react',
    name: 'Curto · react / tela dividida',
    structure: 'Mostre o trecho original curto → reação → comentário; alterne rápido.',
    pacing: 'Seco; reações curtas; nada de silêncio.',
    broll: 'O vídeo reagido é o "B-roll"; mantenha a pessoa visível (tela dividida ou canto).',
    graphics: 'Setas/destaques mínimos para apontar o momento; legenda grande.',
    transitions: 'Corte seco, zoom punch nas reações.',
    audio: 'Equilíbrio entre o original e a voz; o original abaixa quando a pessoa fala.',
    checklist: [...COMMON_CHECKS, 'Reação sempre visível.'],
  },
];

export const METHODS = M;

/** Método do projeto (preset + tipo). */
export function methodFor(template: string | undefined, subtype: string | null | undefined, vertical: boolean): EditorialMethod {
  const by = (id: string) => M.find((m) => m.id === id)!;
  if (template === 'short-form' || (template === 'manual' && vertical)) {
    if (subtype === 'venda') return by('curto-venda');
    if (subtype === 'react' || subtype === 'dividida') return by('curto-react');
    return by('curto-narracao');
  }
  switch (subtype) {
    case 'cristao':
      return by('youtube-cristao');
    case 'documentario':
      return by('documentario');
    case 'podcast':
      return by('podcast');
    case 'opiniao':
      return by('youtube-opiniao');
    case 'dark':
      return by('dark');
    default:
      return by('youtube-educativo');
  }
}

export function methodText(m: EditorialMethod): string {
  return [
    `MÉTODO EDITORIAL: ${m.name}`,
    `Estrutura: ${m.structure}`,
    `Ritmo: ${m.pacing}`,
    `B-roll: ${m.broll}`,
    `Gráficos: ${m.graphics}`,
    `Transições: ${m.transitions}`,
    `Áudio: ${m.audio}`,
    `Checklist de entrega:\n${m.checklist.map((c) => `- ${c}`).join('\n')}`,
  ].join('\n');
}
